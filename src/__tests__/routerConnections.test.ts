import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const root = process.cwd();
const proxyRequire = createRequire(resolve(root, 'proxy/server.js'));
const { open } = proxyRequire('sqlite');
const sqlite3 = proxyRequire('sqlite3');
const source = readFileSync(resolve(root, 'api-backend/server.js'), 'utf8');
const parsed = ts.createSourceFile('server.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const nodes: ts.Node[] = [];
const visit = (node: ts.Node) => {
    nodes.push(node);
    ts.forEachChild(node, visit);
};
visit(parsed);

// Run production functions in isolation, never importing the server or opening its database.
const initializer = (name: string, context: Record<string, unknown>) => {
    const declaration = nodes.find((node): node is ts.VariableDeclaration =>
        ts.isVariableDeclaration(node) && node.name.getText(parsed) === name);
    if (!declaration?.initializer) throw new Error(`Missing initializer: ${name}`);
    return runInNewContext(`(${declaration.initializer.getText(parsed)})`, context);
};

const routeHandler = (method: string, path: string, context: Record<string, unknown>) => {
    const call = nodes.find((node): node is ts.CallExpression =>
        ts.isCallExpression(node) && node.expression.getText(parsed) === `app.${method}` &&
        ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === path);
    if (!call) throw new Error(`Missing route: ${method} ${path}`);
    return runInNewContext(`(${call.arguments[call.arguments.length - 1].getText(parsed)})`, context);
};

const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn(), setTimeout: vi.fn() });
const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
};
const dueDate = (day: number) => new Date(2026, 3, day, 12).toISOString().split('T')[0];

const mockRouter = () => {
    const secret = { '.id': '*1', name: 'ppp-user', comment: JSON.stringify({
        planType: 'postpaid', fixedDay: 5, dueDate: '2026-03-05T12:00:00'
    }) };
    let connected = false;
    const instance = {
        secret,
        beforeWrite: vi.fn(async () => {}),
        readSecret: vi.fn(async () => [{ ...secret }]),
        connect: vi.fn(async () => { connected = true; }),
        close: vi.fn(async () => { connected = false; }),
        write: vi.fn(async (query: string | string[], args?: string[]) => {
            const command = Array.isArray(query) ? query[0] : query;
            if (!connected) throw new Error('Legacy connection is closed');
            if (command === '/ppp/secret/print') return instance.readSecret();
            if (command === '/ppp/secret/set') {
                await instance.beforeWrite();
                if (!connected) throw new Error('Legacy connection closed during payment');
                secret.comment = args!.find(arg => arg.startsWith('=comment='))!.slice('=comment='.length);
            }
            return [];
        }),
        get: vi.fn(async (url: string) => ({
            data: url.startsWith('/ppp/secret?') ? await instance.readSecret() : []
        })),
        patch: vi.fn(async (_url: string, payload: { comment: string }) => {
            await instance.beforeWrite();
            secret.comment = payload.comment;
        }),
        put: vi.fn(async () => {}),
        delete: vi.fn(async () => {})
    };
    return instance;
};

const connectionHarness = () => {
    const sharedHttpAgent = initializer('sharedHttpAgent', { http });
    const sharedHttpsAgent = initializer('sharedHttpsAgent', { https });
    const RouterOSAPI = vi.fn(function (_config: unknown) { return mockRouter(); });
    const axios = { create: vi.fn((defaults: unknown) => ({
        ...mockRouter(), defaults, interceptors: { response: { use: vi.fn() } }
    })) };
    const createRouterInstance = initializer('createRouterInstance', {
        RouterOSAPI, axios, sharedHttpAgent, sharedHttpsAgent
    });
    const routerInstanceCache = new Map();
    const getRouterInstance = initializer('getRouterInstance', { createRouterInstance, routerInstanceCache });
    return { getRouterInstance, routerInstanceCache, RouterOSAPI, axios, sharedHttpAgent, sharedHttpsAgent };
};
const routerConfig = { id: 'r1', host: '192.0.2.1', port: 8728, user: 'admin', password: 'test', api_type: 'legacy' };

describe('Router connection ownership', () => {
    it('creates fresh legacy clients and retains the existing legacy timeout/TLS options', () => {
        const harness = connectionHarness();
        const first = harness.getRouterInstance(routerConfig);
        const second = harness.getRouterInstance({ ...routerConfig });
        expect(first).not.toBe(second);
        expect(harness.routerInstanceCache.size).toBe(0);
        expect(harness.RouterOSAPI).toHaveBeenCalledTimes(2);
        expect(harness.RouterOSAPI).toHaveBeenCalledWith(expect.objectContaining({ timeout: 15, port: 8728, tls: false }));
        harness.getRouterInstance({ ...routerConfig, port: 8729 });
        expect(harness.RouterOSAPI).toHaveBeenLastCalledWith(expect.objectContaining({
            port: 8729, tls: true, tlsOptions: { rejectUnauthorized: false, minVersion: 'TLSv1.2' }
        }));
    });

    it.each([80, 443])('reuses REST clients and shared keep-alive agents on port %s', port => {
        const harness = connectionHarness();
        const config = { ...routerConfig, api_type: 'rest', port };
        const first = harness.getRouterInstance(config);
        expect(harness.getRouterInstance({ ...config })).toBe(first);
        const other = harness.getRouterInstance({ ...config, id: 'r2' });
        expect(other).not.toBe(first);
        const agentKey = port === 443 ? 'httpsAgent' : 'httpAgent';
        const agent = port === 443 ? harness.sharedHttpsAgent : harness.sharedHttpAgent;
        expect(first.defaults[agentKey]).toBe(agent);
        expect(other.defaults[agentKey]).toBe(agent);
        expect(agent.options).toMatchObject({ keepAlive: true, maxSockets: 4 });
        expect(first.defaults.timeout).toBe(15000);
        expect(harness.axios.create).toHaveBeenCalledTimes(2);
        expect(harness.RouterOSAPI).not.toHaveBeenCalled();
    });

    it.each([
        { host: '192.0.2.2' }, { port: 443 }, { user: 'other' }, { password: 'changed' }, { api_type: 'rest-v7' }
    ])('invalidates cached REST configuration for %j', change => {
        const harness = connectionHarness();
        const config = { ...routerConfig, api_type: 'rest', port: 80 };
        const original = harness.getRouterInstance(config);
        const changed = harness.getRouterInstance({ ...config, ...change });
        expect(changed).not.toBe(original);
        expect(harness.getRouterInstance({ ...config, ...change })).toBe(changed);
        expect(harness.axios.create).toHaveBeenCalledTimes(2);
    });

    it('never hands a cached REST client to a legacy request after an API type change', () => {
        const harness = connectionHarness();
        const rest = harness.getRouterInstance({ ...routerConfig, api_type: 'rest' });
        const legacy = harness.getRouterInstance(routerConfig);
        expect(legacy).not.toBe(rest);
        expect(harness.getRouterInstance(routerConfig)).not.toBe(legacy);
        expect(harness.getRouterInstance({ ...routerConfig, api_type: 'rest' })).toBe(rest);
    });
});

describe('PPP payment customer due dates', () => {
    let db: any;
    let context: Record<string, any>;
    let payment: any;

    beforeEach(async () => {
        db = await open({ filename: ':memory:', driver: sqlite3.Database });
        await db.exec(`
            CREATE TABLE customers (id TEXT PRIMARY KEY, username TEXT, accountNumber TEXT, pppoeSecret TEXT, routerId TEXT, dueDate TEXT);
            CREATE TABLE ppp_grace (router_id TEXT, name TEXT, original_plan_type TEXT);
        `);
        context = {
            getDb: vi.fn(async () => db),
            console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
            safeStringify: JSON.stringify,
            maskSensitive: (value: unknown) => value,
            writeLegacySafe: initializer('writeLegacySafe', {}),
            normalizeLegacyObject: initializer('normalizeLegacyObject', {})
        };
        payment = routeHandler('post', '/:routerId/ppp/payment/process', context);
    });

    afterEach(async () => { await db.close(); });

    const addCustomer = async (id: string, fields: Record<string, unknown> = {}) => {
        const row = { username: `login-${id}`, accountNumber: `account-${id}`, pppoeSecret: null,
            routerId: 'r1', dueDate: '2026-03-15T12:00:00', ...fields };
        await db.run('INSERT INTO customers VALUES (?, ?, ?, ?, ?, ?)',
            [id, row.username, row.accountNumber, row.pppoeSecret, row.routerId, row.dueDate]);
    };
    const request = (api_type: string, routerInstance = mockRouter()) => ({
        params: { routerId: 'r1' }, router: { ...routerConfig, api_type }, routerInstance,
        body: { secret: { name: 'ppp-user', comment: routerInstance.secret.comment },
            plan: { name: 'Monthly', pppoeProfile: 'paid', cycleDays: 30 }, paymentDate: '2026-03-20T12:00:00' }
    });
    const dates = () => db.all('SELECT id, dueDate FROM customers ORDER BY id');

    describe.each(['legacy', 'rest'])('%s', apiType => {
        it.each(['prepaid', 'postpaid'])('resolves an explicit link once and updates only that customer after %s router success', async planType => {
            // Same-name rows elsewhere and account numbers must not influence resolution or updates.
            await addCustomer('other-router', { username: 'ppp-user', pppoeSecret: 'ppp-user', routerId: 'r2', dueDate: '2026-03-27T12:00:00' });
            await addCustomer('account-only', { accountNumber: 'ppp-user', dueDate: '2026-03-28T12:00:00' });
            await addCustomer('linked-elsewhere', { username: 'ppp-user', pppoeSecret: 'different-secret', dueDate: '2026-03-29T12:00:00' });
            await addCustomer('target', { pppoeSecret: 'ppp-user' });
            const before = await dates();
            const req = request(apiType);
            req.body.secret.comment = JSON.stringify({ planType, fixedDay: 5, dueDate: '2026-03-05T12:00:00' });
            req.routerInstance.secret.comment = req.body.secret.comment;
            const all = vi.spyOn(db, 'all');
            const run = vi.spyOn(db, 'run');
            req.routerInstance.beforeWrite.mockImplementationOnce(async () => {
                expect(await db.get('SELECT dueDate FROM customers WHERE id = ?', 'target'))
                    .toEqual({ dueDate: '2026-03-15T12:00:00' });
                expect(run).not.toHaveBeenCalled();
            });
            const res = response();
            await payment(req, res);
            expect(res.status).not.toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith({ secrets: [expect.objectContaining({ name: 'ppp-user' })] });
            expect(JSON.parse(req.routerInstance.secret.comment)).toMatchObject({ fixedDay: 15, dueDate: dueDate(15), planType });
            expect(all).toHaveBeenCalledTimes(1);
            expect(all).toHaveBeenCalledWith(expect.stringContaining('SELECT id, dueDate, pppoeSecret FROM customers'), ['ppp-user', 'ppp-user', 'r1']);
            const updates = run.mock.calls.filter(([sql]) => String(sql).startsWith('UPDATE customers'));
            expect(updates).toEqual([["UPDATE customers SET dueDate = ? WHERE id = ? AND routerId = ? AND COALESCE(pppoeSecret, '') = ?", [dueDate(15), 'target', 'r1', 'ppp-user']]]);
            expect(await dates()).toEqual(before.map((row: any) => row.id === 'target' ? { ...row, dueDate: dueDate(15) } : row));
            if (apiType === 'legacy') expect(req.routerInstance.close).toHaveBeenCalledOnce();
        });

        it.each([null, ''])('uses exact username fallback only when pppoeSecret is %j', async pppoeSecret => {
            await addCustomer('fallback', { username: 'ppp-user', pppoeSecret });
            const req = request(apiType);
            const res = response();
            await payment(req, res);
            expect(res.status).not.toHaveBeenCalled();
            expect(await dates()).toEqual([{ id: 'fallback', dueDate: dueDate(15) }]);
        });

        it.each([null, '', 'ppp-user'])('uses the confirmed customer ID with link %j without renaming or prematurely linking', async pppoeSecret => {
            await addCustomer('target', { username: 'billing-identity', pppoeSecret });
            const req = request(apiType);
            req.routerInstance.beforeWrite.mockImplementationOnce(async () => {
                expect(await db.get('SELECT username, pppoeSecret, dueDate FROM customers WHERE id = ?', 'target'))
                    .toEqual({ username: 'billing-identity', pppoeSecret, dueDate: '2026-03-15T12:00:00' });
            });
            const res = response();
            await payment({ ...req, body: { ...req.body, customerId: 'target' } }, res);
            expect(res.status).not.toHaveBeenCalled();
            expect(JSON.parse(req.routerInstance.secret.comment)).toMatchObject({ fixedDay: 15, dueDate: dueDate(15) });
            expect(await db.get('SELECT username, pppoeSecret, dueDate FROM customers WHERE id = ?', 'target'))
                .toEqual({ username: 'billing-identity', pppoeSecret, dueDate: dueDate(15) });
        });

        it.each(['missing', 'other router', 'changed link', 'owned explicit', 'owned username'])('rejects a confirmed customer with %s before router writes', async conflict => {
            if (conflict !== 'missing') await addCustomer('target', {
                routerId: conflict === 'other router' ? 'r2' : 'r1',
                pppoeSecret: conflict === 'changed link' ? 'different-secret' : null
            });
            if (conflict === 'owned explicit') await addCustomer('owner', { pppoeSecret: 'ppp-user' });
            if (conflict === 'owned username') await addCustomer('owner', { username: 'ppp-user' });
            const before = await dates();
            const req = request(apiType);
            const res = response();
            await payment({ ...req, body: { ...req.body, customerId: 'target' } }, res);
            expect(res.status).toHaveBeenCalledWith(409);
            expect(req.routerInstance.connect).not.toHaveBeenCalled();
            expect(req.routerInstance.write).not.toHaveBeenCalled();
            expect(req.routerInstance.get).not.toHaveBeenCalled();
            expect(req.routerInstance.patch).not.toHaveBeenCalled();
            expect(await dates()).toEqual(before);
        });

        it.each([null, '', 123, {}])('rejects invalid customerId %j before database or router operations', async customerId => {
            const req = request(apiType);
            const res = response();
            await payment({ ...req, body: { ...req.body, customerId } }, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(context.getDb).not.toHaveBeenCalled();
            expect(req.routerInstance.connect).not.toHaveBeenCalled();
            expect(req.routerInstance.get).not.toHaveBeenCalled();
        });

        it('does not update the confirmed customer when the router write fails', async () => {
            await addCustomer('target');
            const before = await dates();
            const req = request(apiType);
            req.routerInstance.beforeWrite.mockRejectedValueOnce(new Error('Router write failed'));
            const res = response();
            await payment({ ...req, body: { ...req.body, customerId: 'target' } }, res);
            expect(res.status).toHaveBeenCalledWith(500);
            expect(await dates()).toEqual(before);
            expect((await db.get('SELECT pppoeSecret FROM customers WHERE id = ?', 'target')).pppoeSecret).toBeNull();
        });

        it('succeeds without a matching customer and ignores unrelated identities', async () => {
            await addCustomer('other-router', { username: 'ppp-user', routerId: 'r2' });
            await addCustomer('account-only', { accountNumber: 'ppp-user' });
            await addCustomer('linked-elsewhere', { username: 'ppp-user', pppoeSecret: 'another-secret' });
            await addCustomer('case-mismatch', { pppoeSecret: 'PPP-USER' });
            const before = await dates();
            const req = request(apiType);
            const res = response();
            await payment(req, res);
            expect(res.status).not.toHaveBeenCalled();
            expect(JSON.parse(req.routerInstance.secret.comment)).toMatchObject({ fixedDay: 5, dueDate: dueDate(5) });
            expect(await dates()).toEqual(before);
        });

        it('succeeds with an empty customers table', async () => {
            const req = request(apiType);
            const res = response();
            await payment(req, res);
            expect(res.status).not.toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith({ secrets: [expect.objectContaining({ name: 'ppp-user' })] });
            expect(await dates()).toEqual([]);
        });

        it.each(['explicit', 'fallback', 'mixed'])('rejects ambiguous %s matches before contacting the router', async kind => {
            await addCustomer('first', kind === 'fallback' ? { username: 'ppp-user' } : { pppoeSecret: 'ppp-user' });
            await addCustomer('second', kind === 'explicit' ? { pppoeSecret: 'ppp-user' } : { username: 'ppp-user', pppoeSecret: '' });
            const before = await dates();
            const req = request(apiType);
            const res = response();
            await payment(req, res);
            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith({ message: 'Multiple customers match this PPP secret on this router.' });
            expect(req.routerInstance.connect).not.toHaveBeenCalled();
            expect(req.routerInstance.write).not.toHaveBeenCalled();
            expect(req.routerInstance.get).not.toHaveBeenCalled();
            expect(req.routerInstance.patch).not.toHaveBeenCalled();
            expect(await dates()).toEqual(before);
        });

        it.each(['missing secret', 'write failure', 'final read failure'])('does not advance a customer due date on %s', async failure => {
            await addCustomer('target', { pppoeSecret: 'ppp-user' });
            const before = await dates();
            const req = request(apiType);
            if (failure === 'missing secret') req.routerInstance.readSecret.mockResolvedValue([]);
            if (failure === 'write failure') req.routerInstance.beforeWrite.mockRejectedValueOnce(new Error('Router write failed'));
            if (failure === 'final read failure') {
                req.routerInstance.readSecret.mockResolvedValueOnce([{ ...req.routerInstance.secret }])
                    .mockRejectedValueOnce(new Error('Router read failed'));
            }
            const res = response();
            await payment(req, res);
            expect(res.status).toHaveBeenCalledWith(failure === 'missing secret' ? 404 : 500);
            expect(await dates()).toEqual(before);
            if (apiType === 'legacy') expect(req.routerInstance.close).toHaveBeenCalledOnce();
        });

        it('fails closed if customer identity lookup fails', async () => {
            await addCustomer('target', { pppoeSecret: 'ppp-user' });
            const before = await dates();
            vi.spyOn(db, 'all').mockRejectedValueOnce(new Error('Customer lookup failed'));
            const req = request(apiType);
            const res = response();
            await payment(req, res);
            expect(res.status).toHaveBeenCalledWith(500);
            expect(req.routerInstance.connect).not.toHaveBeenCalled();
            expect(req.routerInstance.get).not.toHaveBeenCalled();
            expect(await dates()).toEqual(before);
        });

        it('reports a due-date write failure as payment success with a warning, without repeating router writes', async () => {
            await addCustomer('target', { pppoeSecret: 'ppp-user' });
            const run = db.run.bind(db);
            vi.spyOn(db, 'run').mockImplementation(async (sql, ...args) => {
                if (String(sql).startsWith('UPDATE customers')) throw new Error('SQLITE_BUSY');
                return run(sql, ...args);
            });
            const req = request(apiType);
            const res = response();
            await payment(req, res);
            expect(res.status).not.toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith({
                secrets: [expect.objectContaining({ name: 'ppp-user' })],
                warning: expect.stringContaining('do not pay again')
            });
            expect(req.routerInstance.beforeWrite).toHaveBeenCalledOnce();
            expect(JSON.parse(req.routerInstance.secret.comment).dueDate).toBe(dueDate(15));
            expect(await dates()).toEqual([{ id: 'target', dueDate: '2026-03-15T12:00:00' }]);
        });

        it.each(['routerId', 'pppoeSecret'])('does not update a customer whose %s changed during processing', async field => {
            await addCustomer('target', { pppoeSecret: 'ppp-user' });
            const req = request(apiType);
            req.routerInstance.beforeWrite.mockImplementationOnce(async () => {
                await db.run(`UPDATE customers SET ${field} = 'changed' WHERE id = 'target'`);
            });
            const res = response();
            await payment(req, res);
            expect(res.status).not.toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ warning: expect.stringContaining('record changed') }));
            expect(await dates()).toEqual([{ id: 'target', dueDate: '2026-03-15T12:00:00' }]);
        });
    });

    it('does not advance the due date when REST scheduler processing fails', async () => {
        await addCustomer('target', { pppoeSecret: 'ppp-user' });
        const req = request('rest');
        req.routerInstance.put.mockRejectedValueOnce(new Error('Scheduler write failed'));
        const res = response();
        await payment(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(await dates()).toEqual([{ id: 'target', dueDate: '2026-03-15T12:00:00' }]);
    });

    it('closing a concurrent legacy PPP read cannot interrupt an active payment write', async () => {
        await addCustomer('target', { pppoeSecret: 'ppp-user' });
        const harness = connectionHarness();
        const writer = harness.getRouterInstance(routerConfig);
        const reader = harness.getRouterInstance({ ...routerConfig });
        const started = deferred();
        const release = deferred();
        writer.beforeWrite.mockImplementationOnce(async () => { started.resolve(); await release.promise; });
        const paymentRes = response();
        const pending = payment(request('legacy', writer), paymentRes);
        await started.promise;
        try {
            const readRes = response();
            const read = routeHandler('get', '/:routerId/ppp/active/print', context);
            await read({ ...request('legacy', reader), setTimeout: vi.fn() }, readRes);
            expect(readRes.status).not.toHaveBeenCalled();
            expect(reader.close).toHaveBeenCalledOnce();
            expect(writer.close).not.toHaveBeenCalled();
            expect(await dates()).toEqual([{ id: 'target', dueDate: '2026-03-15T12:00:00' }]);
        } finally {
            release.resolve();
            await pending;
        }
        expect(writer).not.toBe(reader);
        expect(paymentRes.status).not.toHaveBeenCalled();
        expect(writer.close).toHaveBeenCalledOnce();
        expect(await dates()).toEqual([{ id: 'target', dueDate: dueDate(15) }]);
    });
});
