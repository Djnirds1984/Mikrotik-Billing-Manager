import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as crypto from 'node:crypto';
import ts from 'typescript';
import { License } from '../../components/License.tsx';

const proxyPath = resolve(process.cwd(), 'proxy/server.js');
const proxyRequire = createRequire(proxyPath);
const { open } = proxyRequire('sqlite');
const sqlite3 = proxyRequire('sqlite3');
const source = readFileSync(proxyPath, 'utf8');
const parsed = ts.createSourceFile('server.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const nodes: ts.Node[] = [];
const visit = (node: ts.Node) => {
    nodes.push(node);
    ts.forEachChild(node, visit);
};
visit(parsed);

// Exercise the actual handlers without starting the server, timers, or installed databases.
const routeHandler = (router: string, method: string, path: string, context: Record<string, unknown>) => {
    const call = nodes.find((node): node is ts.CallExpression => {
        if (!ts.isCallExpression(node) || node.expression.getText(parsed) !== `${router}.${method}`) return false;
        const first = node.arguments[0];
        if (!first) return false;
        const paths = ts.isArrayLiteralExpression(first) ? first.elements : [first];
        return paths.some(value => ts.isStringLiteral(value) && value.text === path);
    });
    if (!call) throw new Error(`Missing route: ${router}.${method} ${path}`);
    return runInNewContext(`(${call.arguments[call.arguments.length - 1].getText(parsed)})`, context);
};

const initializer = (name: string, context: Record<string, unknown>) => {
    const declaration = nodes.find((node): node is ts.VariableDeclaration =>
        ts.isVariableDeclaration(node) && node.name.getText(parsed) === name);
    if (!declaration?.initializer) throw new Error(`Missing initializer: ${name}`);
    return runInNewContext(`(${declaration.initializer.getText(parsed)})`, context);
};

const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });

afterEach(cleanup);

describe('Local-mode backend', () => {
    let db: any;
    let context: Record<string, any>;

    beforeEach(async () => {
        db = await open({ filename: ':memory:', driver: sqlite3.Database });
        await db.exec(`
            CREATE TABLE customers (id TEXT PRIMARY KEY, username TEXT UNIQUE, routerId TEXT, accountNumber TEXT, fullName TEXT);
            CREATE TABLE routers (id TEXT PRIMARY KEY, name TEXT);
            CREATE TABLE client_invoices (
                id TEXT PRIMARY KEY, routerId TEXT, username TEXT, status TEXT, amount REAL,
                invoiceType TEXT, category TEXT, description TEXT, planName TEXT, currency TEXT,
                laborCost REAL, partsCost REAL
            );
            CREATE TABLE sales_records (
                id TEXT PRIMARY KEY, routerId TEXT, date TEXT, clientName TEXT, planName TEXT,
                planPrice REAL, discountAmount REAL, finalAmount REAL, routerName TEXT, currency TEXT,
                clientAddress TEXT, clientContact TEXT, clientEmail TEXT, invoiceId TEXT,
                coveredMonth TEXT, processedBy TEXT
            );
        `);
        context = {
            db,
            DB_PATH: ':memory:',
            crypto,
            console: { log: vi.fn(), error: vi.fn() },
            generateAccountNumber: vi.fn().mockResolvedValue('ACC-001'),
            getDeviceId: vi.fn().mockResolvedValue('local-device')
        };
    });

    afterEach(async () => { await db.close(); });

    it('has no Supabase runtime client or declared dependency', () => {
        expect(source).not.toMatch(/supabase/i);
        const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'proxy/package.json'), 'utf8'));
        const lock = readFileSync(resolve(process.cwd(), 'proxy/package-lock.json'), 'utf8');
        expect(manifest.dependencies).not.toHaveProperty('@supabase/supabase-js');
        expect(lock).not.toMatch(/@supabase\//);
    });

    it('creates, updates, reads, and deletes customers using only SQLite', async () => {
        const post = routeHandler('dbRouter', 'post', '/customers', context);
        const res = response();
        await post({ body: { id: 'c1', username: 'customer', routerId: 'r1', fullName: 'Local Customer' } }, res);
        expect(res.status).not.toHaveBeenCalled();
        expect(await db.get('SELECT accountNumber FROM customers WHERE id = ?', 'c1')).toEqual({ accountNumber: 'ACC-001' });

        await post({ body: { username: 'customer', routerId: 'r1', fullName: 'Updated Customer' } }, res);
        await routeHandler('dbRouter', 'patch', '/customers/:id', context)(
            { params: { id: 'c1' }, body: { fullName: 'Patched Customer' } }, res);
        const readRes = response();
        await routeHandler('dbRouter', 'get', '/customers', context)({ query: { routerId: 'r1' } }, readRes);
        expect(readRes.json).toHaveBeenCalledWith([expect.objectContaining({ fullName: 'Patched Customer' })]);
        const otherRouter = response();
        await routeHandler('dbRouter', 'get', '/customers', context)({ query: { routerId: 'r2' } }, otherRouter);
        expect(otherRouter.json).toHaveBeenCalledWith([]);

        await routeHandler('dbRouter', 'delete', '/customers/:id', context)({ params: { id: 'c1' } }, res);
        expect(await db.get('SELECT * FROM customers WHERE id = ?', 'c1')).toBeUndefined();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('records local sales and paid invoices without cloud calls or duplicate invoice sales', async () => {
        const handlers: Record<string, any> = {};
        const dbRouter = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [
            method, (path: string, handler: any) => { handlers[`${method}:${path}`] = handler; }
        ]));
        const createCrud = initializer('createCrud', { ...context, dbRouter });
        createCrud('/sales', 'sales_records');
        createCrud('/client-invoices', 'client_invoices');
        const res = response();
        await handlers['post:/sales']({ body: { id: 's1', routerId: 'r1', finalAmount: 500 } }, res);
        expect(await db.get('SELECT finalAmount FROM sales_records WHERE id = ?', 's1')).toEqual({ finalAmount: 500 });

        await db.run('INSERT INTO routers (id, name) VALUES (?, ?)', ['r1', 'Local Router']);
        await db.run(`INSERT INTO client_invoices (id, routerId, username, status, amount, invoiceType, laborCost, partsCost)
            VALUES ('i1', 'r1', 'customer', 'PENDING', 0, 'custom', 100, 200)`);
        const req = { params: { id: 'i1' }, body: { status: 'PAID' }, user: { username: 'admin' } };
        await handlers['patch:/client-invoices/:id'](req, res);
        await handlers['patch:/client-invoices/:id'](req, res);
        expect(res.status).not.toHaveBeenCalled();
        expect(await db.all('SELECT finalAmount FROM sales_records WHERE invoiceId = ?', 'i1')).toEqual([{ finalAmount: 300 }]);
        expect(await db.get('SELECT status FROM client_invoices WHERE id = ?', 'i1')).toEqual({ status: 'PAID' });
    });

    it.each(['/customers/sync', '/mikrotik-sales-logs', '/sales/sync-to-mikrotik', '/sales/bulk-sync-to-mikrotik'])(
        'explicitly retires %s', async path => {
            const res = response();
            await routeHandler('dbRouter', 'all', path, {})({}, res);
            expect(res.status).toHaveBeenCalledWith(410);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('stored locally') }));
        }
    );

    it('preserves local panel access without a license key', async () => {
        const res = response();
        await routeHandler('licenseRouter', 'get', '/status', context)({}, res);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            licensed: true, mode: 'local', deviceId: 'local-device', maxRouters: 999
        }));
        expect(res.json.mock.calls[0][0]).not.toHaveProperty('licenseKey');
    });

    it.each(['/activate', '/revoke'])('rejects obsolete licensing action %s without changing data', async path => {
        const res = response();
        await routeHandler('licenseRouter', 'post', path, {})({}, res);
        expect(res.status).toHaveBeenCalledWith(410);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('keeps currency conversion used by local payment processing', () => {
        const convert = initializer('convertCurrencyToCode', {});
        expect(convert('₱')).toBe('PHP');
        expect(convert('R$')).toBe('BRL');
        expect(convert('USD')).toBe('USD');
    });
});

describe('Local-mode license page', () => {
    it('explains local mode and has no activation or revoke controls', () => {
        render(<License onLicenseChange={vi.fn()} licenseStatus={{ licensed: true, mode: 'local', deviceId: 'local-device', maxRouters: 999 }} />);
        expect(screen.getByRole('heading', { name: 'Local Mode' })).toBeInTheDocument();
        expect(screen.getByLabelText('Your CPU Hardware ID')).toHaveValue('local-device');
        expect(screen.queryByText('Revoke License')).not.toBeInTheDocument();
        expect(screen.queryByText('Validate & Activate')).not.toBeInTheDocument();
    });

    it('offers a retry on server errors instead of license activation', () => {
        const retry = vi.fn();
        render(<License onLicenseChange={retry} licenseStatus={{ licensed: false, error: 'Server unavailable' }} />);
        expect(screen.getByText('Server unavailable')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(retry).toHaveBeenCalledOnce();
    });
});
