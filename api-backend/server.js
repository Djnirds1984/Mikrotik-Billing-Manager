

const express = require('express');
const cors = require('cors');
const { RouterOSAPI } = require('node-routeros-v2');
const axios = require('axios');
const https = require('https');
const path = require('path');
const sqlite3 = require('@vscode/sqlite3');
const { open } = require('sqlite');

const app = express();
const PORT = 3002;

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
    const started = Date.now();
    let body = '';
    try { body = JSON.stringify(req.body); } catch {}
    if (body) body = body.replace(/"password"\s*:\s*".*?"/gi, '"password":"***"');
    console.log(`[REQ] ${req.method} ${req.originalUrl} body=${body.slice(0,1000)}`);
    res.on('finish', () => {
        console.log(`[RES] ${req.method} ${req.originalUrl} status=${res.statusCode} time=${Date.now()-started}ms`);
    });
    next();
});

// Database setup - pointing to the proxy's DB
const DB_PATH = path.resolve(__dirname, '../proxy/panel.db');

let db;
async function getDb() {
    if (!db) {
        console.log(`[Backend] Connecting to DB at: ${DB_PATH}`);
        db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });
        
        // Enable WAL mode for concurrency
        await db.exec('PRAGMA journal_mode = WAL;');
        
        // Resilience: Ensure routers table exists
        await db.exec(`
            CREATE TABLE IF NOT EXISTS routers (
                id TEXT PRIMARY KEY,
                name TEXT,
                host TEXT,
                user TEXT,
                password TEXT,
                port INTEGER,
                api_type TEXT
            );
        `);
    }
    return db;
}

// Helper to create router instance based on config
const createRouterInstance = (config) => {
    if (!config || !config.host || !config.user) {
        throw new Error('Invalid router configuration');
    }
    
    if (config.api_type === 'legacy') {
        const isTls = config.port === 8729;
        return new RouterOSAPI({
            host: config.host,
            user: config.user,
            password: config.password || '',
            port: config.port || 8728,
            timeout: 15,
            tls: isTls,
            tlsOptions: isTls ? { rejectUnauthorized: false, minVersion: 'TLSv1.2' } : undefined,
        });
    }

    const protocol = config.port === 443 ? 'https' : 'http';
    const baseURL = `${protocol}://${config.host}:${config.port}/rest`;
    const auth = { username: config.user, password: config.password || '' };

    const instance = axios.create({ 
        baseURL, 
        auth,
        httpsAgent: new https.Agent({ rejectUnauthorized: false, minVersion: 'TLSv1.2' }),
        timeout: 15000
    });

    // Normalize ID fields
    instance.interceptors.response.use(response => {
        const mapId = (item) => {
            if (item && typeof item === 'object' && '.id' in item) {
                return { ...item, id: item['.id'] };
            }
            return item;
        };

        if (response.data && typeof response.data === 'object') {
            if (Array.isArray(response.data)) {
                response.data = response.data.map(mapId);
            } else {
                response.data = mapId(response.data);
            }
        }
        return response;
    }, error => Promise.reject(error));

    return instance;
};

// Middleware to attach router config based on ID
const getRouter = async (req, res, next) => {
    try {
        const routerId = req.params.routerId;
        if (!routerId) return res.status(400).json({ message: 'Router ID missing' });
        
        const database = await getDb();
        const router = await database.get('SELECT * FROM routers WHERE id = ?', [routerId]);
        if (!router) {
            console.warn(`[Backend] Router ID ${routerId} not found in DB.`);
            return res.status(404).json({ message: 'Router not found' });
        }
        
        req.router = router;
        req.routerInstance = createRouterInstance(router);
        next();
    } catch (e) {
        console.error("DB Error in getRouter:", e);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

// Helper for Legacy Writes
const writeLegacySafe = async (client, query) => {
    try {
        return await client.write(query);
    } catch (error) {
        // Suppress "empty response" errors which are common in node-routeros-v2 for empty lists
        if (error.errno === 'UNKNOWNREPLY' && error.message.includes('!empty')) {
            return [];
        }
        throw error;
    }
};

const normalizeLegacyObject = (obj) => {
     if (!obj || typeof obj !== 'object') return obj;
    const newObj = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            newObj[key.replace(/_/g, '-')] = obj[key];
        }
    }
    if (newObj['.id']) newObj.id = newObj['.id'];
    return newObj;
}

// --- SPECIAL ENDPOINTS (must come before the generic proxy) ---

// 0. Test Connection (does not use getRouter middleware as router isn't saved yet)
app.post('/test/test-connection', async (req, res) => {
    const config = req.body;
    try {
        if (!config || !config.host || !config.user || !config.api_type) {
            return res.status(400).json({ success: false, message: 'Incomplete router configuration provided for testing.' });
        }

        const client = createRouterInstance(config);
        
        if (config.api_type === 'legacy') {
            await client.connect();
            // A quick command to verify we can interact
            await writeLegacySafe(client, ['/system/resource/print']);
            await client.close();
        } else {
            // For REST, a simple GET request is enough to test connection and auth
            await client.get('/system/resource');
        }
        res.json({ success: true, message: 'Connection successful!' });
    } catch (e) {
        console.error("Test Connection Error:", e.message);
        const status = e.response ? e.response.status : 500;
        const msg = e.response?.data?.message || e.response?.data?.detail || e.message;
        res.status(status).json({ success: false, message: `Connection failed: ${msg}` });
    }
});


// 1. SPECIAL ENDPOINT: Interface Stats
// This logic was previously in proxy/server.js but belongs here because Nginx routes /mt-api here.
app.get('/:routerId/interface/stats', getRouter, async (req, res) => {
    try {
        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                // For Legacy API, we need specific commands to get stats
                const result = await writeLegacySafe(client, ['/interface/print', 'stats', 'detail', 'without-paging']);
                res.json(result.map(normalizeLegacyObject));
            } finally {
                await client.close();
            }
        } else {
            // REST API (v7+)
            const response = await req.routerInstance.post('/interface/print', { 'stats': true, 'detail': true });
            res.json(response.data);
        }
    } catch (e) {
        console.error("Stats Error:", e.message);
        res.status(500).json({ message: e.message });
    }
});

// 1b. Interfaces List
app.get('/:routerId/interface/print', getRouter, async (req, res) => {
    try {
        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                const result = await writeLegacySafe(client, ['/interface/print']);
                res.json(result.map(normalizeLegacyObject));
            } finally {
                await client.close();
            }
        } else {
            const response = await req.routerInstance.get('/interface');
            res.json(response.data);
        }
    } catch (e) {
        console.error("Interface Print Error:", e.message);
        const status = e.response ? e.response.status : 500;
        const msg = e.response?.data?.message || e.response?.data?.detail || e.message;
        res.status(status).json({ message: msg });
    }
});

// 2b. System Resource Print
app.get('/:routerId/system/resource/print', getRouter, async (req, res) => {
    try {
        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                const result = await writeLegacySafe(client, ['/system/resource/print']);
                // Legacy returns array with single object; normalize for consistency
                const normalized = Array.isArray(result) ? result.map(normalizeLegacyObject) : [normalizeLegacyObject(result)];
                res.json(normalized);
            } finally {
                await client.close();
            }
        } else {
            const response = await req.routerInstance.get('/system/resource');
            res.json(response.data);
        }
    } catch (e) {
        console.error("System Resource Error:", e.message);
        const status = e.response ? e.response.status : 500;
        const msg = e.response?.data?.message || e.response?.data?.detail || e.message;
        res.status(status).json({ message: msg });
    }
});

// 3. PPP Active Print
app.get('/:routerId/ppp/active/print', getRouter, async (req, res) => {
    try {
        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                const result = await writeLegacySafe(client, ['/ppp/active/print']);
                res.json(result.map(normalizeLegacyObject));
            } finally {
                await client.close();
            }
        } else {
            const response = await req.routerInstance.get('/ppp/active');
            res.json(response.data);
        }
    } catch (e) {
        console.error("PPP Active Error:", e.message);
        const status = e.response ? e.response.status : 500;
        const msg = e.response?.data?.message || e.response?.data?.detail || e.message;
        res.status(status).json({ message: msg });
    }
});

app.post('/:routerId/ppp/user/save', getRouter, async (req, res) => {
    const data = req.body || {};
    try {
        const secretData = data.secretData || data;
        const initialSecret = data.initialSecret || null;
        const subscription = data.subscriptionData || null;
        let id = secretData['.id'] || secretData.id || initialSecret?.id;

        const toRosPayload = (obj) => {
            if (!obj || typeof obj !== 'object') return obj;
            const allowed = new Set(['name','service','profile','comment','disabled','password']);
            const out = {};
            for (const k of Object.keys(obj)) {
                if (k === 'id' || k === '.id') continue;
                if (!allowed.has(k)) continue;
                const key = k.replace(/_/g, '-');
                let val = obj[k];
                if (key === 'service' && !val) val = 'pppoe';
                if (key === 'disabled' && typeof val === 'boolean') val = val ? 'true' : 'false';
                if (key === 'password' && !val) continue;
                out[key] = val;
            }
            return out;
        };

        const profileName = secretData.profile;

        // Ensure profile exists when requested (composite op)
        const ensureProfileIfMissing = async () => {
            if (!profileName) return;
            const profilePayload = toRosPayload(data.profileData || { name: profileName });
            if (req.router.api_type === 'legacy') {
                const client = req.routerInstance;
                await client.connect();
                try {
                    const existing = await writeLegacySafe(client, ['/ppp/profile/print', '?name=' + profileName]);
                    if (!existing || existing.length === 0) {
                        await client.write('/ppp/profile/add', { name: profileName, ...profilePayload });
                    }
                } finally {
                    await client.close();
                }
            } else {
                const listResp = await req.routerInstance.get('/ppp/profile');
                const exists = Array.isArray(listResp.data) && listResp.data.some(p => p.name === profileName);
                if (!exists) {
                    await req.routerInstance.post('/ppp/profile', { name: profileName, ...profilePayload });
                }
            }
        };

        // Attempt to resolve secret id by name if missing
        const ensureSecretId = async () => {
            if (id) return;
            const name = secretData.name || initialSecret?.name;
            if (!name) return;
            if (req.router.api_type === 'legacy') {
                const client = req.routerInstance;
                await client.connect();
                try {
                    const found = await writeLegacySafe(client, ['/ppp/secret/print', '?name=' + name]);
                    if (Array.isArray(found) && found[0] && found[0]['.id']) {
                        id = found[0]['.id'];
                    }
                } finally { await client.close(); }
            } else {
                const list = await req.routerInstance.get('/ppp/secret');
                const item = (Array.isArray(list.data) ? list.data : []).find(s => s.name === name);
                if (item && item.id) id = item.id;
            }
        };

        // Save PPP secret
        const saveSecret = async () => {
            if (req.router.api_type === 'legacy') {
                const client = req.routerInstance;
                await client.connect();
                try {
                    if (id) {
                        await client.write('/ppp/secret/set', { '.id': id, ...toRosPayload(secretData) });
                    } else {
                        await client.write('/ppp/secret/add', toRosPayload(secretData));
                    }
                } finally {
                    await client.close();
                }
            } else {
                const payload = toRosPayload(secretData);
                if (id) {
                    await req.routerInstance.put(`/ppp/secret/${encodeURIComponent(id)}`, payload);
                } else {
                    await req.routerInstance.post('/ppp/secret', payload);
                }
            }
        };

        // Optional scheduler to switch profile on due date/grace (composite op)
        const upsertScheduler = async () => {
            if (!subscription) return;
            const username = secretData.name || initialSecret?.name;
            if (!username) return;
            const targetProfile = subscription.nonPaymentProfile;
            const graceDays = subscription.graceDays;
            const graceTime = subscription.graceTime; // HH:mm
            const dueDateIso = subscription.dueDate;
            let scheduleDate = null;
            if (dueDateIso) {
                scheduleDate = new Date(dueDateIso);
            } else if (graceDays) {
                const now = new Date();
                if (graceTime) {
                    const [h, m] = String(graceTime).split(':').map(Number);
                    now.setHours(h || 0, m || 0, 0, 0);
                }
                scheduleDate = new Date(now.getTime() + (Number(graceDays) * 24 * 60 * 60 * 1000));
            }
            if (!scheduleDate || !targetProfile) return;

            const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
            const startDate = `${months[scheduleDate.getMonth()]}/${String(scheduleDate.getDate()).padStart(2,'0')}/${scheduleDate.getFullYear()}`;
            const startTime = scheduleDate.toTimeString().split(' ')[0];
            const schedName = `deactivate-ppp-${username}`;
            const onEvent = `/ppp secret set [find where name=\"${username}\"] profile=\"${targetProfile}\"`;

            if (req.router.api_type === 'legacy') {
                const client = req.routerInstance;
                await client.connect();
                try {
                    const existing = await writeLegacySafe(client, ['/system/scheduler/print', '?name=' + schedName]);
                    if (existing && existing.length > 0) {
                        await client.write('/system/scheduler/set', { '.id': existing[0]['.id'], 'name': schedName, 'start-date': startDate, 'start-time': startTime, 'on-event': onEvent });
                    } else {
                        await client.write('/system/scheduler/add', { name: schedName, 'start-date': startDate, 'start-time': startTime, 'on-event': onEvent });
                    }
                } finally { await client.close(); }
            } else {
                const list = await req.routerInstance.get('/system/scheduler');
                const existing = (Array.isArray(list.data) ? list.data : []).find(s => s.name === schedName);
                const payload = { name: schedName, 'start-date': startDate, 'start-time': startTime, 'on-event': onEvent };
                if (existing && existing.id) {
                    await req.routerInstance.put(`/system/scheduler/${encodeURIComponent(existing.id)}`, payload);
                } else {
                    await req.routerInstance.post('/system/scheduler', payload);
                }
            }
        };

        await ensureProfileIfMissing();
        await ensureSecretId();
        await saveSecret();
        await upsertScheduler();

        // Upsert simple queue based on rate-limit and active address
        const upsertSimpleQueueFromProfile = async () => {
            try {
                const username = secretData.name || initialSecret?.name;
                if (!username) return;
                // Determine rate-limit from profile (do not set on secret)
                let rate = null;
                if (profileName) {
                    if (req.router.api_type === 'legacy') {
                        const client = req.routerInstance;
                        await client.connect();
                        try {
                            const prof = await writeLegacySafe(client, ['/ppp/profile/print', '?name=' + profileName]);
                            rate = Array.isArray(prof) && prof[0] ? (prof[0]['rate-limit'] || prof[0]['rate_limit']) : null;
                        } finally { await client.close(); }
                    } else {
                        const listResp = await req.routerInstance.get('/ppp/profile');
                        const prof = (Array.isArray(listResp.data) ? listResp.data : []).find(p => p.name === profileName);
                        rate = prof ? (prof['rate-limit'] || prof.rate_limit || null) : null;
                    }
                }
                if (!rate) return; // No rate to enforce

                // Find active address for target
                let address = null;
                if (req.router.api_type === 'legacy') {
                    const client = req.routerInstance;
                    await client.connect();
                    try {
                        const active = await writeLegacySafe(client, ['/ppp/active/print', '?name=' + username]);
                        address = Array.isArray(active) && active[0] ? (active[0].address || active[0]['address']) : null;
                    } finally { await client.close(); }
                } else {
                    const activeResp = await req.routerInstance.get('/ppp/active');
                    const found = (Array.isArray(activeResp.data) ? activeResp.data : []).find(a => a.name === username);
                    address = found ? (found.address || found['address']) : null;
                }
                if (!address) return; // No active IP, skip queue creation

                const limitString = typeof rate === 'string' ? rate : String(rate);
                if (req.router.api_type === 'legacy') {
                    const client = req.routerInstance;
                    await client.connect();
                    try {
                        const queues = await writeLegacySafe(client, ['/queue/simple/print', '?name=' + username]);
                        if (queues && queues.length > 0) {
                            await client.write('/queue/simple/set', { '.id': queues[0]['.id'], 'max-limit': limitString, target: address });
                        } else {
                            await client.write('/queue/simple/add', { name: username, target: address, 'max-limit': limitString });
                        }
                    } finally { await client.close(); }
                } else {
                    const list = await req.routerInstance.get('/queue/simple');
                    const existing = (Array.isArray(list.data) ? list.data : []).find(q => q.name === username);
                    const payload = { name: username, target: address, 'max-limit': limitString };
                    if (existing && existing.id) {
                        await req.routerInstance.put(`/queue/simple/${encodeURIComponent(existing.id)}`, payload);
                    } else {
                        await req.routerInstance.post('/queue/simple', payload);
                    }
                }
            } catch (_) {
                // Non-fatal; continue
            }
        };

        await upsertSimpleQueueFromProfile();

        // Persist customer info to app DB if provided
        try {
            const customerData = data.customerData || data.customer || null;
            const username = secretData.name || initialSecret?.name;
            if (customerData && username) {
                const database = await getDb();
                const newId = `cust_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                await database.run(
                    `INSERT INTO customers (id, username, routerId, fullName, address, contactNumber, email)
                     VALUES (?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(username) DO UPDATE SET 
                        fullName=excluded.fullName,
                        address=excluded.address,
                        contactNumber=excluded.contactNumber,
                        email=excluded.email,
                        routerId=excluded.routerId`,
                    [
                        newId,
                        username,
                        req.router.id,
                        customerData.fullName || '',
                        customerData.address || '',
                        customerData.contactNumber || '',
                        customerData.email || ''
                    ]
                );
            }
        } catch (e) {
            console.warn('Customer persistence warning:', e.message);
        }

        res.json({ message: 'Saved', composite: true });
    } catch (e) {
        const status = e.response ? e.response.status : 400;
        const details = e.response?.data;
        console.error('[ERROR] ppp/user/save', e.message, details);
        const msg = e.response?.data?.message || e.response?.data?.detail || e.message;
        res.status(status).json({ message: msg, details });
    }
});

app.patch('/:routerId/ppp/user/save', getRouter, async (req, res) => {
    const data = req.body || {};
    try {
        const secretData = data.secretData || data;
        const initialSecret = data.initialSecret || null;
        const subscription = data.subscriptionData || null;
        let id = secretData['.id'] || secretData.id || initialSecret?.id;

        const toRosPayload = (obj) => {
            if (!obj || typeof obj !== 'object') return obj;
            const allowed = new Set(['name','service','profile','comment','disabled','password']);
            const out = {};
            for (const k of Object.keys(obj)) {
                if (k === 'id' || k === '.id') continue;
                if (!allowed.has(k)) continue;
                const key = k.replace(/_/g, '-');
                let val = obj[k];
                if (key === 'service' && !val) val = 'pppoe';
                if (key === 'disabled' && typeof val === 'boolean') val = val ? 'true' : 'false';
                if (key === 'password' && !val) continue;
                out[key] = val;
            }
            return out;
        };

        const profileName = secretData.profile;

        const ensureProfileIfMissing = async () => {
            if (!profileName) return;
            const profilePayload = toRosPayload(data.profileData || { name: profileName });
            if (req.router.api_type === 'legacy') {
                const client = req.routerInstance;
                await client.connect();
                try {
                    const existing = await writeLegacySafe(client, ['/ppp/profile/print', '?name=' + profileName]);
                    if (!existing || existing.length === 0) {
                        await client.write('/ppp/profile/add', { name: profileName, ...profilePayload });
                    }
                } finally {
                    await client.close();
                }
            } else {
                const listResp = await req.routerInstance.get('/ppp/profile');
                const exists = Array.isArray(listResp.data) && listResp.data.some(p => p.name === profileName);
                if (!exists) {
                    await req.routerInstance.post('/ppp/profile', { name: profileName, ...profilePayload });
                }
            }
        };

        const ensureSecretId = async () => {
            if (id) return;
            const name = secretData.name || initialSecret?.name;
            if (!name) return;
            if (req.router.api_type === 'legacy') {
                const client = req.routerInstance;
                await client.connect();
                try {
                    const found = await writeLegacySafe(client, ['/ppp/secret/print', '?name=' + name]);
                    if (Array.isArray(found) && found[0] && found[0]['.id']) {
                        id = found[0]['.id'];
                    }
                } finally { await client.close(); }
            } else {
                const list = await req.routerInstance.get('/ppp/secret');
                const item = (Array.isArray(list.data) ? list.data : []).find(s => s.name === name);
                if (item && item.id) id = item.id;
            }
        };

        const saveSecret = async () => {
            if (req.router.api_type === 'legacy') {
                const client = req.routerInstance;
                await client.connect();
                try {
                    if (id) {
                        await client.write('/ppp/secret/set', { '.id': id, ...toRosPayload(secretData) });
                    } else {
                        await client.write('/ppp/secret/add', toRosPayload(secretData));
                    }
                } finally {
                    await client.close();
                }
            } else {
                const payload = toRosPayload(secretData);
                if (id) {
                    await req.routerInstance.put(`/ppp/secret/${encodeURIComponent(id)}`, payload);
                } else {
                    await req.routerInstance.post('/ppp/secret', payload);
                }
            }
        };

        const upsertScheduler = async () => {
            if (!subscription) return;
            const username = secretData.name || initialSecret?.name;
            if (!username) return;
            const targetProfile = subscription.nonPaymentProfile;
            const graceDays = subscription.graceDays;
            const graceTime = subscription.graceTime;
            const dueDateIso = subscription.dueDate;
            let scheduleDate = null;
            if (dueDateIso) {
                scheduleDate = new Date(dueDateIso);
            } else if (graceDays) {
                const now = new Date();
                if (graceTime) {
                    const [h, m] = String(graceTime).split(':').map(Number);
                    now.setHours(h || 0, m || 0, 0, 0);
                }
                scheduleDate = new Date(now.getTime() + (Number(graceDays) * 24 * 60 * 60 * 1000));
            }
            if (!scheduleDate || !targetProfile) return;

            const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
            const startDate = `${months[scheduleDate.getMonth()]}/${String(scheduleDate.getDate()).padStart(2,'0')}/${scheduleDate.getFullYear()}`;
            const startTime = scheduleDate.toTimeString().split(' ')[0];
            const schedName = `deactivate-ppp-${username}`;
            const onEvent = `/ppp secret set [find where name=\"${username}\"] profile=\"${targetProfile}\"`;

            if (req.router.api_type === 'legacy') {
                const client = req.routerInstance;
                await client.connect();
                try {
                    const existing = await writeLegacySafe(client, ['/system/scheduler/print', '?name=' + schedName]);
                    if (existing && existing.length > 0) {
                        await client.write('/system/scheduler/set', { '.id': existing[0]['.id'], 'name': schedName, 'start-date': startDate, 'start-time': startTime, 'on-event': onEvent });
                    } else {
                        await client.write('/system/scheduler/add', { name: schedName, 'start-date': startDate, 'start-time': startTime, 'on-event': onEvent });
                    }
                } finally { await client.close(); }
            } else {
                const list = await req.routerInstance.get('/system/scheduler');
                const existing = (Array.isArray(list.data) ? list.data : []).find(s => s.name === schedName);
                const payload = { name: schedName, 'start-date': startDate, 'start-time': startTime, 'on-event': onEvent };
                if (existing && existing.id) {
                    await req.routerInstance.put(`/system/scheduler/${encodeURIComponent(existing.id)}`, payload);
                } else {
                    await req.routerInstance.post('/system/scheduler', payload);
                }
            }
        };

        await ensureProfileIfMissing();
        await ensureSecretId();
        await saveSecret();
        await upsertScheduler();

        const upsertSimpleQueueFromProfile = async () => {
            try {
                const username = secretData.name || initialSecret?.name;
                if (!username) return;
                let rate = null;
                if (profileName) {
                    if (req.router.api_type === 'legacy') {
                        const client = req.routerInstance;
                        await client.connect();
                        try {
                            const prof = await writeLegacySafe(client, ['/ppp/profile/print', '?name=' + profileName]);
                            rate = Array.isArray(prof) && prof[0] ? (prof[0]['rate-limit'] || prof[0]['rate_limit']) : null;
                        } finally { await client.close(); }
                    } else {
                        const listResp = await req.routerInstance.get('/ppp/profile');
                        const prof = (Array.isArray(listResp.data) ? listResp.data : []).find(p => p.name === profileName);
                        rate = prof ? (prof['rate-limit'] || prof.rate_limit || null) : null;
                    }
                }
                if (!rate) return;

                let address = null;
                if (req.router.api_type === 'legacy') {
                    const client = req.routerInstance;
                    await client.connect();
                    try {
                        const active = await writeLegacySafe(client, ['/ppp/active/print', '?name=' + username]);
                        address = Array.isArray(active) && active[0] ? (active[0].address || active[0]['address']) : null;
                    } finally { await client.close(); }
                } else {
                    const activeResp = await req.routerInstance.get('/ppp/active');
                    const found = (Array.isArray(activeResp.data) ? activeResp.data : []).find(a => a.name === username);
                    address = found ? (found.address || found['address']) : null;
                }
                if (!address) return;

                const limitString = typeof rate === 'string' ? rate : String(rate);
                if (req.router.api_type === 'legacy') {
                    const client = req.routerInstance;
                    await client.connect();
                    try {
                        const queues = await writeLegacySafe(client, ['/queue/simple/print', '?name=' + username]);
                        if (queues && queues.length > 0) {
                            await client.write('/queue/simple/set', { '.id': queues[0]['.id'], 'max-limit': limitString, target: address });
                        } else {
                            await client.write('/queue/simple/add', { name: username, target: address, 'max-limit': limitString });
                        }
                    } finally { await client.close(); }
                } else {
                    const list = await req.routerInstance.get('/queue/simple');
                    const existing = (Array.isArray(list.data) ? list.data : []).find(q => q.name === username);
                    const payload = { name: username, target: address, 'max-limit': limitString };
                    if (existing && existing.id) {
                        await req.routerInstance.put(`/queue/simple/${existing.id}`, payload);
                    } else {
                        await req.routerInstance.post('/queue/simple', payload);
                    }
                }
            } catch (_) { }
        };

        await upsertSimpleQueueFromProfile();
        try {
            const customerData = data.customerData || data.customer || null;
            const username = secretData.name || initialSecret?.name;
            if (customerData && username) {
                const database = await getDb();
                const newId = `cust_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                await database.run(
                    `INSERT INTO customers (id, username, routerId, fullName, address, contactNumber, email)
                     VALUES (?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(username) DO UPDATE SET 
                        fullName=excluded.fullName,
                        address=excluded.address,
                        contactNumber=excluded.contactNumber,
                        email=excluded.email,
                        routerId=excluded.routerId`,
                    [
                        newId,
                        username,
                        req.router.id,
                        customerData.fullName || '',
                        customerData.address || '',
                        customerData.contactNumber || '',
                        customerData.email || ''
                    ]
                );
            }
        } catch (e) {
            console.warn('Customer persistence warning:', e.message);
        }

        res.json({ message: 'Saved', composite: true });
    } catch (e) {
        const status = e.response ? e.response.status : 400;
        const details = e.response?.data;
        console.error('[ERROR] ppp/user/save(PATCH)', e.message, details);
        const msg = e.response?.data?.message || e.response?.data?.detail || e.message;
        res.status(status).json({ message: msg, details });
    }
});

// Payment processing: apply paid profile, remove non-payment scheduler, update queue
app.post('/:routerId/ppp/payment/process', getRouter, async (req, res) => {
    try {
        const data = req.body || {};
        const secretData = data.secretData || data.secret || {};
        const payment = data.paymentData || data.payment || {};
        const subscription = data.subscriptionData || data.subscription || {};
        let username = secretData.name || payment.username || (data.secret && data.secret.name);
        let targetProfile = secretData.profile || payment.profile || (payment.plan && payment.plan.pppoeProfile);
        const nonPaymentProfile = subscription.nonPaymentProfile || payment.nonPaymentProfile;
        const paymentDateStr = payment.paymentDate || payment.dueDate || subscription.dueDate || new Date().toISOString().split('T')[0];
        const graceDays = subscription.graceDays || payment.graceDays || payment.discountDays;
        const graceTime = subscription.graceTime || payment.graceTime;

        if (!username || !targetProfile) {
            return res.status(400).json({ message: 'Missing username or target profile' });
        }

        // Resolve secret id by name
        let id = null;
        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                const found = await writeLegacySafe(client, ['/ppp/secret/print', '?name=' + username]);
                if (Array.isArray(found) && found[0] && found[0]['.id']) id = found[0]['.id'];
            } finally { await client.close(); }
        } else {
            const list = await req.routerInstance.get('/ppp/secret');
            const item = username ? (Array.isArray(list.data) ? list.data : []).find(s => s.name === username) : null;
            if (item && item.id) id = item.id;
            if (!username && item && item.name) username = item.name;
        }

        // Calculate next due date: add cycle months
        const addMonths = (d, m) => {
            const date = new Date(d.getTime());
            const day = date.getDate();
            date.setMonth(date.getMonth() + m);
            if (date.getDate() !== day) { date.setDate(0); }
            return date;
        };
        const cycleToMonths = (cycle) => cycle === 'Yearly' ? 12 : cycle === 'Quarterly' ? 3 : 1;
        const paymentDate = new Date(paymentDateStr);
        const monthsToAdd = cycleToMonths(payment?.plan?.cycle);
        const nextDue = addMonths(paymentDate, monthsToAdd);
        const nextDueDateStr = nextDue.toISOString().split('T')[0];
        const nextDueTimeStr = nextDue.toTimeString().split(' ')[0];

        // Update secret: set profile, enable, and update comment dueDate
        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                if (!id) {
                    await client.write('/ppp/secret/add', { name: username, service: 'pppoe', profile: targetProfile, disabled: 'false', comment: (() => {
                        let c = {};
                        try { c = JSON.parse(secretData.comment || '{}'); } catch {}
                        c.dueDate = nextDueDateStr;
                        c.dueDateTime = `${nextDueDateStr} ${nextDueTimeStr}`;
                        c.planType = (subscription.planType || payment.plan?.cycle ? 'postpaid' : c.planType);
                        return JSON.stringify(c);
                    })() });
                } else {
                    await client.write('/ppp/secret/set', { '.id': id, profile: targetProfile, disabled: 'false', comment: (() => {
                        let c = {};
                        try { c = JSON.parse(secretData.comment || '{}'); } catch {}
                        c.dueDate = nextDueDateStr;
                        c.dueDateTime = `${nextDueDateStr} ${nextDueTimeStr}`;
                        c.planType = (subscription.planType || payment.plan?.cycle ? 'postpaid' : c.planType);
                        return JSON.stringify(c);
                    })() });
                }
            } finally { await client.close(); }
            } else {
                if (!id) {
                    let c = {};
                    try { c = JSON.parse(secretData.comment || '{}'); } catch {}
                    c.dueDate = nextDueDateStr;
                    c.dueDateTime = `${nextDueDateStr} ${nextDueTimeStr}`;
                    c.planType = (subscription.planType || payment.plan?.cycle ? 'postpaid' : c.planType);
                    await req.routerInstance.post('/ppp/secret', { name: username, service: 'pppoe', profile: targetProfile, disabled: false, comment: JSON.stringify(c) });
                } else {
                    let c = {};
                    try { c = JSON.parse(secretData.comment || '{}'); } catch {}
                    c.dueDate = nextDueDateStr;
                    c.dueDateTime = `${nextDueDateStr} ${nextDueTimeStr}`;
                    c.planType = (subscription.planType || payment.plan?.cycle ? 'postpaid' : c.planType);
                    await req.routerInstance.put(`/ppp/secret/${encodeURIComponent(id)}`, { profile: targetProfile, disabled: false, comment: JSON.stringify(c) });
                }
            }

        // Remove existing deactivate scheduler and (re)create for next due date if provided
        const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        let scheduleDate = null;
        if (nextDue) {
            scheduleDate = nextDue;
        } else if (graceDays) {
            const now = new Date();
            if (graceTime) {
                const [h, m] = String(graceTime).split(':').map(Number);
                now.setHours(h || 0, m || 0, 0, 0);
            }
            scheduleDate = new Date(now.getTime() + (Number(graceDays) * 24 * 60 * 60 * 1000));
        }

        const schedName = `deactivate-ppp-${username}`;
        const startDate = scheduleDate ? `${months[scheduleDate.getMonth()]}/${String(scheduleDate.getDate()).padStart(2,'0')}/${scheduleDate.getFullYear()}` : null;
        const startTime = scheduleDate ? scheduleDate.toTimeString().split(' ')[0] : null;
        const onEvent = nonPaymentProfile ? `/ppp secret set [find where name=\"${username}\"] profile=\"${nonPaymentProfile}\"` : '';

        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                const existing = await writeLegacySafe(client, ['/system/scheduler/print', '?name=' + schedName]);
                if (existing && existing.length > 0) {
                    await client.write('/system/scheduler/remove', { '.id': existing[0]['.id'] });
                }
                if (scheduleDate && nonPaymentProfile) {
                    await client.write('/system/scheduler/add', { name: schedName, 'start-date': startDate, 'start-time': startTime, 'on-event': onEvent });
                }
            } finally { await client.close(); }
        } else {
            const list = await req.routerInstance.get('/system/scheduler');
            const existing = (Array.isArray(list.data) ? list.data : []).find(s => s.name === schedName);
            if (existing && existing.id) {
                await req.routerInstance.delete(`/system/scheduler/${encodeURIComponent(existing.id)}`);
            }
            if (scheduleDate && nonPaymentProfile) {
                await req.routerInstance.post('/system/scheduler', { name: schedName, 'start-date': startDate, 'start-time': startTime, 'on-event': onEvent });
            }
        }

        // Queue update based on profile rate-limit similar to save path
        try {
            let rate = null;
            if (req.router.api_type === 'legacy') {
                const client = req.routerInstance;
                await client.connect();
                try {
                    const prof = await writeLegacySafe(client, ['/ppp/profile/print', '?name=' + targetProfile]);
                    rate = Array.isArray(prof) && prof[0] ? (prof[0]['rate-limit'] || prof[0]['rate_limit']) : null;
                    if (rate) {
                        const active = await writeLegacySafe(client, ['/ppp/active/print', '?name=' + username]);
                        const address = Array.isArray(active) && active[0] ? (active[0].address || active[0]['address']) : null;
                        if (address) {
                            const queues = await writeLegacySafe(client, ['/queue/simple/print', '?name=' + username]);
                            const limitString = String(rate);
                            if (queues && queues.length > 0) {
                                await client.write('/queue/simple/set', { '.id': queues[0]['.id'], 'max-limit': limitString, target: address });
                            } else {
                                await client.write('/queue/simple/add', { name: username, target: address, 'max-limit': limitString });
                            }
                        }
                    }
                } finally { await client.close(); }
            } else {
                const listResp = await req.routerInstance.get('/ppp/profile');
                const prof = (Array.isArray(listResp.data) ? listResp.data : []).find(p => p.name === targetProfile);
                rate = prof ? (prof['rate-limit'] || prof.rate_limit) : null;
                if (rate) {
                    const activeResp = await req.routerInstance.get('/ppp/active');
                    const found = (Array.isArray(activeResp.data) ? activeResp.data : []).find(a => a.name === username);
                    const address = found ? (found.address || found['address']) : null;
                    if (address) {
                        const qList = await req.routerInstance.get('/queue/simple');
                        const existing = (Array.isArray(qList.data) ? qList.data : []).find(q => q.name === username);
                        const payload = { name: username, target: address, 'max-limit': String(rate) };
                        if (existing && existing.id) {
                            await req.routerInstance.put(`/queue/simple/${encodeURIComponent(existing.id)}`, payload);
                        } else {
                            await req.routerInstance.post('/queue/simple', payload);
                        }
                    }
                }
            }
        } catch (_) {}

        res.json({ message: 'Payment processed' });
    } catch (e) {
        const status = e.response ? e.response.status : 400;
        const details = e.response?.data;
        console.error('[ERROR] ppp/payment/process', e.message, details);
        const msg = e.response?.data?.message || e.response?.data?.detail || e.message;
        res.status(status).json({ message: msg, details });
    }
});

// 2. DHCP Client Update Endpoint
app.post('/:routerId/dhcp-client/update', getRouter, async (req, res) => {
    const { 
        macAddress, address, customerInfo, 
        plan, downtimeDays, planType, graceDays, graceTime, 
        expiresAt: manualExpiresAt, contactNumber, email, speedLimit 
    } = req.body;

    try {
        // Calculate Expiration Date/Time
        let expiresAt;
        if (manualExpiresAt) {
            expiresAt = new Date(manualExpiresAt);
        } else if (graceDays) {
            const now = new Date();
            if (graceTime) {
                const [hours, minutes] = graceTime.split(':').map(Number);
                now.setHours(hours, minutes, 0, 0);
            }
            expiresAt = new Date(now.getTime() + (graceDays * 24 * 60 * 60 * 1000));
        } else if (plan && plan.cycle_days) {
            const now = new Date();
            expiresAt = new Date(now.getTime() + (plan.cycle_days * 24 * 60 * 60 * 1000));
        } else {
            expiresAt = new Date(); 
        }

        const commentData = {
            customerInfo,
            contactNumber,
            email,
            planName: plan ? plan.name : '',
            dueDate: expiresAt.toISOString().split('T')[0],
            dueDateTime: expiresAt.toISOString(),
            planType: planType || 'prepaid'
        };

        // Common Scheduler Script (RouterOS format)
        const schedName = `deactivate-dhcp-${address.replace(/\./g, '-')}`;
        const onEvent = `/ip firewall address-list remove [find where address="${address}" and list="authorized-dhcp-users"]; /ip firewall connection remove [find where src-address~"^${address}"]; :local leaseId [/ip dhcp-server lease find where address="${address}"]; if ([:len $leaseId] > 0) do={ /ip firewall address-list add address="${address}" list="pending-dhcp-users" timeout=1d comment="${macAddress}"; }`;
        
        const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
        const rosDate = `${months[expiresAt.getMonth()]}/${String(expiresAt.getDate()).padStart(2,'0')}/${expiresAt.getFullYear()}`;
        const rosTime = expiresAt.toTimeString().split(' ')[0];

        // --- API Interaction ---
        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();

            // 1. Update Address List Comment
            const addressLists = await writeLegacySafe(client, ['/ip/firewall/address-list/print', '?address=' + address, '?list=authorized-dhcp-users']);
            if (addressLists.length > 0) {
                await client.write('/ip/firewall/address-list/set', {
                    '.id': addressLists[0]['.id'],
                    comment: JSON.stringify(commentData)
                });
            }

            // 2. Update/Create Simple Queue (Speed Limit)
            if (speedLimit) {
                const limitString = `${speedLimit}M/${speedLimit}M`;
                const queues = await writeLegacySafe(client, ['/queue/simple/print', '?name=' + customerInfo]);
                if (queues.length > 0) {
                    await client.write('/queue/simple/set', {
                        '.id': queues[0]['.id'],
                        'max-limit': limitString
                    });
                } else {
                    await client.write('/queue/simple/add', {
                        name: customerInfo,
                        target: address,
                        'max-limit': limitString
                    });
                }
            }
            
            // 3. Manage Scheduler
            const scheds = await writeLegacySafe(client, ['/system/scheduler/print', '?name=' + schedName]);
            if (scheds.length > 0) {
                await client.write('/system/scheduler/remove', { '.id': scheds[0]['.id'] });
            }
            await client.write('/system/scheduler/add', {
                name: schedName,
                'start-date': rosDate,
                'start-time': rosTime,
                interval: '0s',
                'on-event': onEvent
            });

            await client.close();
        } else {
            // REST API Logic
            const instance = req.routerInstance;

            // 1. Update Address List
            try {
                const alRes = await instance.get(`/ip/firewall/address-list?address=${address}&list=authorized-dhcp-users`);
                if (alRes.data && alRes.data.length > 0) {
                    await instance.patch(`/ip/firewall/address-list/${alRes.data[0]['.id']}`, {
                        comment: JSON.stringify(commentData)
                    });
                }
            } catch (e) { console.warn("Address list update warning", e.message); }

            // 2. Update Queue
            if (speedLimit) {
                 const limitString = `${speedLimit}M/${speedLimit}M`;
                 try {
                    const qRes = await instance.get(`/queue/simple?name=${customerInfo}`);
                    if (qRes.data && qRes.data.length > 0) {
                        await instance.patch(`/queue/simple/${qRes.data[0]['.id']}`, { 'max-limit': limitString });
                    } else {
                        await instance.put(`/queue/simple`, {
                           name: customerInfo,
                           target: address,
                           'max-limit': limitString
                        });
                    }
                 } catch (e) { console.error("Queue update error", e.message); }
            }

            // 3. Update Scheduler
            try {
                const sRes = await instance.get(`/system/scheduler?name=${schedName}`);
                if (sRes.data && sRes.data.length > 0) {
                    await instance.delete(`/system/scheduler/${sRes.data[0]['.id']}`);
                }
                
                await instance.put(`/system/scheduler`, {
                    name: schedName,
                    'start-date': rosDate,
                    'start-time': rosTime,
                    interval: '0s',
                    'on-event': onEvent
                });
            } catch (e) { console.error("Scheduler update error", e.message); }
        }
        
        res.json({ message: 'Updated successfully' });
    } catch (e) {
        console.error("Update Error:", e.message);
        res.status(500).json({ message: e.message });
    }
});

// 3. Generic Proxy Handler for all other MikroTik calls
app.all('/:routerId/:endpoint(*)', getRouter, async (req, res) => {
    const { endpoint } = req.params;
    const method = req.method;
    const body = req.body;

    try {
        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();

            const cmd = '/' + endpoint;

            if (method === 'POST' && body) {
                await client.write(cmd, body);
                res.json({ message: 'Command executed' });
            } else {
                const data = await writeLegacySafe(client, [cmd]);
                res.json(data.map(normalizeLegacyObject));
            }
            await client.close();
        } else {
            // REST API translation layer for legacy-style endpoints
            const instance = req.routerInstance;

            const translateToRest = (ep, m, b) => {
                const parts = ep.split('/').filter(Boolean);
                const last = parts[parts.length - 1];
                let restMethod = m.toUpperCase();
                let restUrl = '/' + parts.join('/');
                let restData = b;

                if (last === 'print') {
                    parts.pop();
                    restUrl = '/' + parts.join('/');
                    restMethod = 'GET';
                    restData = undefined;
                } else if (last === 'add') {
                    parts.pop();
                    restUrl = '/' + parts.join('/');
                    restMethod = 'POST';
                } else if (last === 'set') {
                    parts.pop();
                    const id = b?.['.id'] || b?.id;
                    if (!id) throw new Error('Missing .id for set operation');
                    restUrl = '/' + parts.join('/') + '/' + id;
                    restMethod = 'PATCH';
                    // Remove legacy id field
                    if (restData?.['.id']) delete restData['.id'];
                } else if (last === 'remove') {
                    parts.pop();
                    const id = b?.['.id'] || b?.id;
                    if (!id) throw new Error('Missing .id for remove operation');
                    restUrl = '/' + parts.join('/') + '/' + id;
                    restMethod = 'DELETE';
                    restData = undefined;
                }

                return { restMethod, restUrl, restData };
            };

            const { restMethod, restUrl, restData } = translateToRest(endpoint, method, body);
            console.log(`[REST Proxy] ${restMethod} ${restUrl}`);

            const response = await instance.request({
                method: restMethod,
                url: restUrl,
                data: restData
            });
            res.json(response.data);
        }
    } catch (e) {
        console.error(`Proxy Error (${endpoint}):`, e.message);
        const status = e.response ? e.response.status : 500;
        const msg = e.response?.data?.message || e.response?.data?.detail || e.message;
        res.status(status).json({ message: msg });
    }
});

app.listen(PORT, () => {
    console.log(`MikroTik API Backend listening on port ${PORT}`);
});
