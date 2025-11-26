

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
            CREATE TABLE IF NOT EXISTS ppp_grace (
                router_id TEXT NOT NULL,
                name TEXT NOT NULL,
                activated_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                original_profile TEXT,
                original_plan_type TEXT,
                metadata TEXT,
                PRIMARY KEY (router_id, name)
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

const maskSensitive = (obj) => {
    try {
        if (!obj || typeof obj !== 'object') return obj;
        const copy = JSON.parse(JSON.stringify(obj));
        const mask = (o) => {
            if (!o || typeof o !== 'object') return;
            for (const k of Object.keys(o)) {
                if (k.toLowerCase().includes('password')) o[k] = '***';
                else if (typeof o[k] === 'object') mask(o[k]);
            }
        };
        mask(copy);
        return copy;
    } catch (_) { return obj; }
};
const safeStringify = (obj) => { try { return JSON.stringify(obj); } catch (_) { return '[unserializable]'; } };

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
        let resource;
        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                const result = await writeLegacySafe(client, ['/system/resource/print']);
                const normalized = Array.isArray(result) ? result.map(normalizeLegacyObject) : [normalizeLegacyObject(result)];
                resource = normalized[0] || {};
            } finally { await client.close(); }
        } else {
            const response = await req.routerInstance.get('/system/resource');
            resource = Array.isArray(response.data) ? response.data[0] : response.data;
        }
        const parseMemory = (memStr) => {
            if (!memStr || typeof memStr !== 'string') return 0;
            const value = parseFloat(memStr);
            const s = memStr.toLowerCase();
            if (s.includes('kib')) return value * 1024;
            if (s.includes('mib')) return value * 1024 * 1024;
            if (s.includes('gib')) return value * 1024 * 1024 * 1024;
            return value;
        };
        const formatBytes = (bytes) => {
            if (!bytes || bytes <= 0) return '0 B';
            const k = 1024; const sizes = ['B','KB','MB','GB','TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            const v = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
            return `${v}${sizes[i]}`;
        };
        const totalMemoryBytes = parseMemory(resource['total-memory']);
        const freeMemoryBytes = parseMemory(resource['free-memory']);
        const usedMemoryBytes = totalMemoryBytes > 0 ? (totalMemoryBytes - freeMemoryBytes) : 0;
        const memoryUsage = totalMemoryBytes > 0 ? parseFloat(((usedMemoryBytes / totalMemoryBytes) * 100).toFixed(1)) : 0;
        res.json({
            boardName: resource['board-name'] || resource['boardName'] || '',
            version: resource.version || '',
            cpuLoad: Number(resource['cpu-load'] || resource['cpuLoad'] || 0),
            uptime: resource.uptime || '',
            memoryUsage,
            totalMemory: formatBytes(totalMemoryBytes)
        });
    } catch (e) {
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

// 4. PPP User Save
app.post('/:routerId/ppp/user/save', getRouter, async (req, res) => {
    const { initialSecret, secretData, subscriptionData } = req.body;
    console.log('[ppp/user/save] router:', req.params.routerId, 'branch:', req.router.api_type, 'payload:', safeStringify(maskSensitive({ initialSecret: initialSecret ? { id: initialSecret.id, name: initialSecret.name } : null, secretData, subscriptionData })));
    if (!secretData || !secretData.name || String(secretData.name).trim() === '') return res.status(400).json({ message: 'Invalid input: secretData.name is required.' });
    try {
        const schedName = `ppp-auto-kick-${String(secretData.name)}`;
        const due = subscriptionData?.dueDateTime || subscriptionData?.dueDate;
        const d = due ? new Date(due) : null;
        const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const rosDate = d ? `${months[d.getMonth()]}/${String(d.getDate()).padStart(2,'0')}/${d.getFullYear()}` : null;
        const rosTime = d ? d.toTimeString().split(' ')[0] : null;
        const onEventProfile = subscriptionData?.nonPaymentProfile ? ` ; /ppp/secret/set [find name=\"${String(secretData.name)}\"] profile=${String(subscriptionData.nonPaymentProfile)}` : '';
const onEvent = `/log info \"PPPoE auto-kick: ${String(secretData.name)}\"; :do { /ppp/active/remove [find name=\"${String(secretData.name)}\"]; }` + onEventProfile;
        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance; await client.connect();
            try {
                let targetId = initialSecret?.id;
                if (!targetId) { const existing = await writeLegacySafe(client, ['/ppp/secret/print', '?name=' + String(secretData.name)]); if (Array.isArray(existing) && existing.length > 0) targetId = existing[0]['.id']; }
                const payload = {};
                if (targetId) payload['.id'] = targetId;
                if (secretData.name != null) payload['name'] = String(secretData.name);
                if (secretData.password != null) payload['password'] = String(secretData.password);
                if (secretData.profile != null) payload['profile'] = String(secretData.profile);
                if (secretData.service != null) payload['service'] = String(secretData.service); else if (!targetId) payload['service'] = 'pppoe';
                if (typeof secretData.disabled === 'boolean') payload['disabled'] = secretData.disabled ? 'yes' : 'no';
                if (subscriptionData != null) {
                    const meta = await writeLegacySafe(client, ['/ppp/secret/print', '?name=' + String(secretData.name)]);
                    let preservedPlanType = '';
                    try { const c = JSON.parse(meta[0]?.comment || '{}'); preservedPlanType = (c.planType || '').toLowerCase(); } catch (_) {}
                    const db = await getDb(); const row = await db.get('SELECT original_plan_type FROM ppp_grace WHERE router_id = ? AND name = ?', [req.params.routerId, String(secretData.name)]);
                    if (row?.original_plan_type) preservedPlanType = (row.original_plan_type || '').toLowerCase();
                    let base = {}; try { base = JSON.parse(meta[0]?.comment || '{}'); } catch (_) {}
                    const merged = { ...base, ...subscriptionData, planType: preservedPlanType || (subscriptionData.planType || '').toLowerCase() };
                    payload['comment'] = JSON.stringify(merged);
                    console.log('[ppp/user/save] preserve planType:', preservedPlanType || subscriptionData.planType || 'unknown');
                }
                if (targetId) await client.write('/ppp/secret/set', payload); else await client.write('/ppp/secret/add', payload);
                if (d) {
                    const s = await writeLegacySafe(client, ['/system/scheduler/print', `?name=${schedName}`]);
                    if (Array.isArray(s) && s.length > 0) await client.write('/system/scheduler/remove', { '.id': s[0]['.id'] });
                    await client.write('/system/scheduler/add', { name: schedName, 'start-date': rosDate, 'start-time': rosTime, interval: '0s', 'on-event': onEvent });
                }
                const saved = await writeLegacySafe(client, ['/ppp/secret/print', '?name=' + String(secretData.name)]);
                res.json(saved.map(normalizeLegacyObject));
            } finally { await client.close(); }
        } else {
            const instance = req.routerInstance; const name = encodeURIComponent(String(secretData.name));
            const qRes = await instance.get(`/ppp/secret?name=${name}`); const existing = Array.isArray(qRes.data) && qRes.data.length > 0 ? qRes.data[0] : null;
            const payload = {};
            if (secretData.name != null) payload['name'] = String(secretData.name);
            if (secretData.password != null) payload['password'] = String(secretData.password);
            if (secretData.profile != null) payload['profile'] = String(secretData.profile);
            if (secretData.service != null) payload['service'] = String(secretData.service); else if (!existing) payload['service'] = 'pppoe';
            if (typeof secretData.disabled === 'boolean') payload['disabled'] = secretData.disabled ? 'yes' : 'no';
            if (subscriptionData != null) {
                const encName = encodeURIComponent(String(secretData.name));
                const s = await instance.get(`/ppp/secret?name=${encName}`);
                let preservedPlanType = '';
                try { const c = JSON.parse((Array.isArray(s.data) && s.data[0]?.comment) || '{}'); preservedPlanType = (c.planType || '').toLowerCase(); } catch (_) {}
                const db = await getDb(); const row = await db.get('SELECT original_plan_type FROM ppp_grace WHERE router_id = ? AND name = ?', [req.params.routerId, String(secretData.name)]);
                if (row?.original_plan_type) preservedPlanType = (row.original_plan_type || '').toLowerCase();
                let base = {}; try { base = JSON.parse((Array.isArray(s.data) && s.data[0]?.comment) || '{}'); } catch (_) {}
                const merged = { ...base, ...subscriptionData, planType: preservedPlanType || (subscriptionData.planType || '').toLowerCase() };
                payload['comment'] = JSON.stringify(merged);
                console.log('[ppp/user/save] preserve planType:', preservedPlanType || subscriptionData.planType || 'unknown');
            }
            if (existing) await instance.patch(`/ppp/secret/${existing['.id']}`, payload); else await instance.put(`/ppp/secret`, payload);
            if (d) {
                const sch = await instance.get(`/system/scheduler?name=${encodeURIComponent(schedName)}`);
                if (Array.isArray(sch.data) && sch.data.length > 0) await instance.delete(`/system/scheduler/${sch.data[0]['.id']}`);
                await instance.put(`/system/scheduler`, { name: schedName, 'start-date': rosDate, 'start-time': rosTime, interval: '0s', 'on-event': onEvent });
            }
            const savedRes = await instance.get(`/ppp/secret?name=${name}`);
            const database = await getDb(); await database.run('DELETE FROM ppp_grace WHERE router_id = ? AND name = ?', [req.params.routerId, String(secretData.name)]);
            res.json(savedRes.data);
        }
    } catch (e) {
        console.error('[ppp/user/save] error:', safeStringify({ routerId: req.params.routerId, message: e.message, status: e.response?.status, data: e.response?.data }));
        const status = e.response ? e.response.status : 500; const msg = e.response?.data?.message || e.response?.data?.detail || e.message; res.status(status).json({ message: msg });
    }
});

// 5. PPP Payment Process
app.post('/:routerId/ppp/payment/process', getRouter, async (req, res) => {
    const { secret, plan, nonPaymentProfile, discountDays, paymentDate } = req.body;
    console.log('[ppp/payment/process] router:', req.params.routerId, 'branch:', req.router.api_type, 'payload:', safeStringify(maskSensitive({ secret: secret ? { id: secret.id, name: secret.name } : null, plan, nonPaymentProfile, discountDays, paymentDate })));
    if (!secret || !secret.name) return res.status(400).json({ message: 'Invalid input: secret.name is required.' });
    if (!plan || !plan.pppoeProfile) return res.status(400).json({ message: 'Invalid input: plan.pppoeProfile is required.' });
    try {
        const cycleDays = Number(plan.cycleDays ?? plan.cycle_days ?? 30);
        const discount = Number(discountDays ?? 0);
        const effectiveDays = Math.max(0, cycleDays - discount);
        const start = paymentDate ? new Date(paymentDate) : new Date();
        const expires = new Date(start.getTime() + effectiveDays * 24 * 60 * 60 * 1000);
        const commentData = { planName: plan?.name || '', dueDate: expires.toISOString().split('T')[0], dueDateTime: expires.toISOString(), paymentDate: start.toISOString(), discountDays: discount, kickFlag: true };
        const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const rosDate = `${months[expires.getMonth()]}/${String(expires.getDate()).padStart(2,'0')}/${expires.getFullYear()}`;
        const rosTime = expires.toTimeString().split(' ')[0];
        const schedName = `ppp-auto-kick-${String(secret.name)}`;
        const onEventProfile = nonPaymentProfile ? ` ; /ppp/secret/set [find name=\"${String(secret.name)}\"] profile=${String(nonPaymentProfile)}` : '';
const onEvent = `/log info \"PPPoE auto-kick: ${String(secret.name)}\"; :do { /ppp/active/remove [find name=\"${String(secret.name)}\"]; }` + onEventProfile;
        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance; await client.connect();
            try {
                const existing = await writeLegacySafe(client, ['/ppp/secret/print', '?name=' + String(secret.name)]);
                if (!Array.isArray(existing) || existing.length === 0) return res.status(404).json({ message: 'PPP secret not found.' });
                const id = existing[0]['.id']; const currentComment = existing[0]['comment']; let preservedPlanType = '';
                try { const c = JSON.parse(currentComment || '{}'); preservedPlanType = (c.planType || '').toLowerCase(); } catch (_) {}
                const db = await getDb(); const row = await db.get('SELECT original_plan_type FROM ppp_grace WHERE router_id = ? AND name = ?', [req.params.routerId, String(secret.name)]);
                if (row?.original_plan_type) preservedPlanType = (row.original_plan_type || '').toLowerCase();
                const finalComment = JSON.stringify({ ...commentData, planType: preservedPlanType || (plan.planType || '').toLowerCase() });
                console.log('[ppp/payment/process] preserve planType:', preservedPlanType || plan.planType || 'unknown');
                await client.write('/ppp/secret/set', { '.id': id, 'profile': String(plan.pppoeProfile), 'comment': finalComment });
                const s = await writeLegacySafe(client, ['/system/scheduler/print', `?name=${schedName}`]);
                if (Array.isArray(s) && s.length > 0) await client.write('/system/scheduler/remove', { '.id': s[0]['.id'] });
                await client.write('/system/scheduler/add', { name: schedName, 'start-date': rosDate, 'start-time': rosTime, interval: '0s', 'on-event': onEvent });
                await writeLegacySafe(client, ['/ppp/active/remove', `?name=${String(secret.name)}`]);
                const saved = await writeLegacySafe(client, ['/ppp/secret/print', '?name=' + String(secret.name)]);
                const database = await getDb(); await database.run('DELETE FROM ppp_grace WHERE router_id = ? AND name = ?', [req.params.routerId, String(secret.name)]);
                res.json(saved.map(normalizeLegacyObject));
            } finally { await client.close(); }
        } else {
            const instance = req.routerInstance;
            const name = encodeURIComponent(String(secret.name));
            const sRes = await instance.get(`/ppp/secret?name=${name}`);
            if (!Array.isArray(sRes.data) || sRes.data.length === 0) return res.status(404).json({ message: 'PPP secret not found.' });
            const id = sRes.data[0]['.id']; const currentComment = sRes.data[0]['comment']; let preservedPlanType = '';
            try { const c = JSON.parse(currentComment || '{}'); preservedPlanType = (c.planType || '').toLowerCase(); } catch (_) {}
            const db = await getDb(); const row = await db.get('SELECT original_plan_type FROM ppp_grace WHERE router_id = ? AND name = ?', [req.params.routerId, String(secret.name)]);
            if (row?.original_plan_type) preservedPlanType = (row.original_plan_type || '').toLowerCase();
            const finalComment = JSON.stringify({ ...commentData, planType: preservedPlanType || (plan.planType || '').toLowerCase() });
            console.log('[ppp/payment/process] preserve planType:', preservedPlanType || plan.planType || 'unknown');
            await instance.patch(`/ppp/secret/${id}`, { 'profile': String(plan.pppoeProfile), 'comment': finalComment });
            const sch = await instance.get(`/system/scheduler?name=${encodeURIComponent(schedName)}`);
            if (Array.isArray(sch.data) && sch.data.length > 0) await instance.delete(`/system/scheduler/${sch.data[0]['.id']}`);
            await instance.put(`/system/scheduler`, { name: schedName, 'start-date': rosDate, 'start-time': rosTime, interval: '0s', 'on-event': onEvent });
            try { await instance.post('/ppp/active/remove', { name: String(secret.name) }); } catch (_) {}
            const savedRes = await instance.get(`/ppp/secret?name=${name}`);
            res.json(savedRes.data);
        }
    } catch (e) {
        console.error('[ppp/payment/process] error:', safeStringify({ routerId: req.params.routerId, message: e.message, status: e.response?.status, data: e.response?.data }));
        const status = e.response ? e.response.status : 500; const msg = e.response?.data?.message || e.response?.data?.detail || e.message; res.status(status).json({ message: msg });
    }
});

// PPP Grace: Grant
app.post('/:routerId/ppp/grace/grant', getRouter, async (req, res) => {
    const { name, graceDays, originalPlanType, originalProfile } = req.body; if (!name || !graceDays) return res.status(400).json({ message: 'name and graceDays are required' });
    try {
        const database = await getDb();
        const existing = await database.get('SELECT * FROM ppp_grace WHERE router_id = ? AND name = ?', [req.params.routerId, String(name)]);
        if (existing) return res.status(409).json({ message: 'Grace period already active for this user' });
        const now = new Date(); const activatedAt = now.toISOString(); const expiresAt = new Date(now.getTime() + Number(graceDays) * 86400000);
        const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const rosDate = `${months[expiresAt.getMonth()]}/${String(expiresAt.getDate()).padStart(2,'0')}/${expiresAt.getFullYear()}`; const rosTime = expiresAt.toTimeString().split(' ')[0];
        const schedName = `ppp-grace-expire-${String(name)}`;
        const onEventProfile = (originalProfile ? ` ; /ppp/secret/set [find name=\"${String(name)}\"] profile=${String(originalProfile)}` : '');
        const onEvent = `/log info \"PPPoE grace expired: ${String(name)}\"; :do { /ppp/active/remove [find name=\"${String(name)}\"]; }` + onEventProfile;
        const commentExtend = { graceDays: Number(graceDays), graceActivatedAt: activatedAt, kickFlag: true, originalPlanType: originalPlanType || '' };
        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance; await client.connect();
            try {
                const s = await writeLegacySafe(client, ['/ppp/secret/print', `?name=${String(name)}`]); if (!Array.isArray(s) || s.length === 0) return res.status(404).json({ message: 'PPP secret not found' });
                const id = s[0]['.id']; const currentComment = s[0]['comment']; let payloadComment;
                try { const c = JSON.parse(currentComment || '{}'); const preservedPlanType = (c.planType || originalPlanType || '').toLowerCase(); const merged = { ...c, ...commentExtend, planType: preservedPlanType }; payloadComment = JSON.stringify(merged); console.log('[ppp/grace/grant] preserve planType:', preservedPlanType || 'unknown'); }
                catch (_) { payloadComment = JSON.stringify({ ...commentExtend, planType: (originalPlanType || '').toLowerCase() }); }
                await client.write('/ppp/secret/set', { '.id': id, comment: payloadComment });
                const sch = await writeLegacySafe(client, ['/system/scheduler/print', `?name=${schedName}`]); if (Array.isArray(sch) && sch.length > 0) await client.write('/system/scheduler/remove', { '.id': sch[0]['.id'] });
                await client.write('/system/scheduler/add', { name: schedName, 'start-date': rosDate, 'start-time': rosTime, interval: '0s', 'on-event': onEvent });
            } finally { await client.close(); }
        } else {
            const instance = req.routerInstance; const encName = encodeURIComponent(String(name));
            const sRes = await instance.get(`/ppp/secret?name=${encName}`); if (!Array.isArray(sRes.data) || sRes.data.length === 0) return res.status(404).json({ message: 'PPP secret not found' });
            const id = sRes.data[0]['.id']; const currentComment = sRes.data[0]['comment']; let payloadComment;
            try { const c = JSON.parse(currentComment || '{}'); const preservedPlanType = (c.planType || originalPlanType || '').toLowerCase(); const merged = { ...c, ...commentExtend, planType: preservedPlanType }; payloadComment = JSON.stringify(merged); console.log('[ppp/grace/grant] preserve planType:', preservedPlanType || 'unknown'); }
            catch (_) { payloadComment = JSON.stringify({ ...commentExtend, planType: (originalPlanType || '').toLowerCase() }); }
            await instance.patch(`/ppp/secret/${id}`, { comment: payloadComment });
            const sch = await instance.get(`/system/scheduler?name=${encodeURIComponent(schedName)}`); if (Array.isArray(sch.data) && sch.data.length > 0) await instance.delete(`/system/scheduler/${sch.data[0]['.id']}`);
            await instance.put(`/system/scheduler`, { name: schedName, 'start-date': rosDate, 'start-time': rosTime, interval: '0s', 'on-event': onEvent });
        }
        await database.run('INSERT OR REPLACE INTO ppp_grace (router_id, name, activated_at, expires_at, original_profile, original_plan_type, metadata) VALUES (?,?,?,?,?,?,?)', [req.params.routerId, String(name), activatedAt, expiresAt.toISOString(), originalProfile || null, originalPlanType || null, JSON.stringify({ graceDays })]);
        res.json({ message: 'Grace period granted', name, activatedAt, expiresAt: expiresAt.toISOString() });
    } catch (e) { const s = e.response ? e.response.status : 500; const m = e.response?.data?.message || e.response?.data?.detail || e.message; res.status(s).json({ message: m }); }
});

// PPP Grace: Status
app.get('/:routerId/ppp/grace/status', async (req, res) => {
    const { name } = req.query; if (!name) return res.status(400).json({ message: 'name is required' });
    try { const database = await getDb(); const row = await database.get('SELECT * FROM ppp_grace WHERE router_id = ? AND name = ?', [req.params.routerId, String(name)]); res.json(row || {}); }
    catch (e) { const s = e.response ? e.response.status : 500; const m = e.response?.data?.message || e.response?.data?.detail || e.message; res.status(s).json({ message: m }); }
});

// WAN Routes (only routes with check-gateway)
app.get('/:routerId/ip/wan-routes', getRouter, async (req, res) => {
    try {
        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance; await client.connect();
            try {
                let routes = await writeLegacySafe(client, ['/ip/route/print']);
                routes = routes.map(normalizeLegacyObject);
                res.json(routes.filter(r => r['check-gateway']));
            } finally { await client.close(); }
        } else {
            const response = await req.routerInstance.get('/ip/route');
            res.json(response.data.filter(r => r['check-gateway']));
        }
    } catch (e) {
        const s = e.response ? e.response.status : 500;
        const m = e.response?.data?.message || e.response?.data?.detail || e.message;
        res.status(s).json({ message: m });
    }
});

// WAN Failover Status
app.get('/:routerId/ip/wan-failover/status', getRouter, async (req, res) => {
    try {
        let routes;
        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance; await client.connect();
            try { routes = await writeLegacySafe(client, ['/ip/route/print']); } finally { await client.close(); }
            routes = routes.map(normalizeLegacyObject);
        } else {
            const response = await req.routerInstance.get('/ip/route');
            routes = response.data;
        }
        const wanRoutes = routes.filter(r => r['check-gateway']);
        const enabled = wanRoutes.some(r => r.disabled === 'false' || r.disabled === false);
        res.json({ enabled });
    } catch (e) {
        const s = e.response ? e.response.status : 500;
        const m = e.response?.data?.message || e.response?.data?.detail || e.message;
        res.status(s).json({ message: m });
    }
});

// Configure WAN Failover (enable/disable check-gateway routes)
app.post('/:routerId/ip/wan-failover', getRouter, async (req, res) => {
    try {
        const { enabled } = req.body;
        if (typeof enabled !== 'boolean') return res.status(400).json({ message: 'enabled must be boolean' });
        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance; await client.connect();
            try {
                let routes = await writeLegacySafe(client, ['/ip/route/print']);
                routes = routes.map(normalizeLegacyObject);
                const wanRoutes = routes.filter(r => r['check-gateway']);
                await Promise.all(wanRoutes.map(r => client.write('/ip/route/set', { '.id': r.id || r['.id'], disabled: enabled ? 'no' : 'yes' })));
            } finally { await client.close(); }
        } else {
            const response = await req.routerInstance.get('/ip/route');
            const wanRoutes = response.data.filter(r => r['check-gateway']);
            await Promise.all(wanRoutes.map(r => req.routerInstance.patch(`/ip/route/${r.id}`, { disabled: !enabled })));
        }
        res.json({ message: `WAN failover routes have been ${enabled ? 'enabled' : 'disabled'}.` });
    } catch (e) {
        const s = e.response ? e.response.status : 500;
        const m = e.response?.data?.message || e.response?.data?.detail || e.message;
        res.status(s).json({ message: m });
    }
});

// PPP Active Kick
app.post('/:routerId/ppp/active/kick', getRouter, async (req, res) => {
    const { name } = req.body; if (!name) return res.status(400).json({ message: 'name is required' });
    try {
        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance; await client.connect();
            try { await writeLegacySafe(client, ['/ppp/active/remove', `?name=${String(name)}`]); res.json({ message: 'Active sessions removed', name }); }
            finally { await client.close(); }
        } else {
            try { await req.routerInstance.post('/ppp/active/remove', { name: String(name) }); res.json({ message: 'Active sessions removed', name }); }
            catch (e) { const s = e.response ? e.response.status : 500; const m = e.response?.data?.message || e.response?.data?.detail || e.message; res.status(s).json({ message: m }); }
        }
    } catch (e) { const s = e.response ? e.response.status : 500; const m = e.response?.data?.message || e.response?.data?.detail || e.message; res.status(s).json({ message: m }); }
});

// PPP Scheduler Refresh
app.post('/:routerId/ppp/scheduler/refresh', getRouter, async (req, res) => {
    const { name, dueDateTime, nonPaymentProfile } = req.body; if (!name || !dueDateTime) return res.status(400).json({ message: 'name and dueDateTime are required' });
    try {
        const d = new Date(dueDateTime); const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const rosDate = `${months[d.getMonth()]}/${String(d.getDate()).padStart(2,'0')}/${d.getFullYear()}`; const rosTime = d.toTimeString().split(' ')[0];
        const schedName = `ppp-auto-kick-${String(name)}`; const onEventProfile = nonPaymentProfile ? ` ; /ppp/secret/set [find name=\"${String(name)}\"] profile=${String(nonPaymentProfile)}` : ''; const onEvent = `/log info \"PPPoE auto-kick: ${String(name)}\"; :do { /ppp/active/remove [find name=\"${String(name)}\"]; }` + onEventProfile;
        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance; await client.connect();
            try { const s = await writeLegacySafe(client, ['/system/scheduler/print', `?name=${schedName}`]); if (Array.isArray(s) && s.length > 0) await client.write('/system/scheduler/remove', { '.id': s[0]['.id'] }); await client.write('/system/scheduler/add', { name: schedName, 'start-date': rosDate, 'start-time': rosTime, interval: '0s', 'on-event': onEvent }); res.json({ message: 'Scheduler refreshed', name, schedName }); }
            finally { await client.close(); }
        } else {
            const sch = await req.routerInstance.get(`/system/scheduler?name=${encodeURIComponent(schedName)}`); if (Array.isArray(sch.data) && sch.data.length > 0) await req.routerInstance.delete(`/system/scheduler/${sch.data[0]['.id']}`); await req.routerInstance.put(`/system/scheduler`, { name: schedName, 'start-date': rosDate, 'start-time': rosTime, interval: '0s', 'on-event': onEvent }); res.json({ message: 'Scheduler refreshed', name, schedName });
        }
    } catch (e) { const s = e.response ? e.response.status : 500; const m = e.response?.data?.message || e.response?.data?.detail || e.message; res.status(s).json({ message: m }); }
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
        const bodyKeys = body && typeof body === 'object' ? Object.keys(body) : [];
        console.error('[Proxy Error]', safeStringify({ endpoint, method, routerId: req.params.routerId, bodyKeys, message: e.message, status: e.response?.status, data: e.response?.data }));
        const status = e.response ? e.response.status : 500;
        const msg = e.response?.data?.message || e.response?.data?.detail || e.message;
        res.status(status).json({ message: msg });
    }
});

app.listen(PORT, () => {
    console.log(`MikroTik API Backend listening on port ${PORT}`);
});
