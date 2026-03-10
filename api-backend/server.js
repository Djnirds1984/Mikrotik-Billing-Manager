

const express = require('express');
const cors = require('cors');
const { RouterOSAPI } = require('node-routeros-v2');
const axios = require('axios');
const https = require('https');
const path = require('path');
const crypto = require('crypto');
let sqlite3;
let open;
const { WebSocketServer } = require('ws');
const { Client: SSHClient } = require('ssh2');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = 3002;

app.use(cors());
app.use(express.json());

// Database setup - pointing to the proxy's DB
const DB_PATH = path.resolve(__dirname, '../proxy/panel.db');

let db;
async function getDb() {
    if (!db) {
        if (!sqlite3 || !open) {
            try {
                sqlite3 = require('sqlite3');
                ({ open } = require('sqlite'));
            } catch (e) {
                console.warn('[Backend] SQLite modules unavailable:', e.message);
                throw new Error('Database module unavailable');
            }
        }
        console.log(`[Backend] Connecting to DB at: ${DB_PATH}`);
        db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });
        
        // Enable WAL mode for concurrency
        await db.exec('PRAGMA journal_mode = WAL;');
        
        // Resilience: Ensure routers table exists and migrate schema
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
                non_payment_profile TEXT,
                metadata TEXT,
                PRIMARY KEY (router_id, name)
            );
            CREATE TABLE IF NOT EXISTS client_users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                router_id TEXT,
                pppoe_username TEXT,
                created_at TEXT
            );
        `);
        try {
            const cols = await db.all("PRAGMA table_info(ppp_grace)");
            const names = cols.map(c => c.name);
            if (!names.includes('non_payment_profile')) {
                await db.exec("ALTER TABLE ppp_grace ADD COLUMN non_payment_profile TEXT");
            }
            if (!names.includes('original_plan_type')) {
                await db.exec("ALTER TABLE ppp_grace ADD COLUMN original_plan_type TEXT");
            }
            if (!names.includes('metadata')) {
                await db.exec("ALTER TABLE ppp_grace ADD COLUMN metadata TEXT");
            }
        } catch (mErr) {
            console.warn('[DB Migration] ppp_grace migration warning:', mErr.message);
        }
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
        timeout: 15000,
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        validateStatus: (status) => status >= 200 && status < 300
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
        const baseURL = (() => {
            try {
                const inst = createRouterInstance(req.body);
                return inst?.defaults?.baseURL || null;
            } catch (_) { return null; }
        })();
        res.status(status).json({ success: false, message: `Connection failed: ${msg}`, baseURL, status });
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
        let temperature = null;

        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                const result = await writeLegacySafe(client, ['/system/resource/print']);
                const normalized = Array.isArray(result) ? result.map(normalizeLegacyObject) : [normalizeLegacyObject(result)];
                resource = normalized[0] || {};
                
                // Try fetching health for temperature
                try {
                    const health = await writeLegacySafe(client, ['/system/health/print']);
                    if (Array.isArray(health) && health.length > 0) {
                        const h = normalizeLegacyObject(health[0]);
                        // Usually 'temperature' or 'cpu-temperature'
                        if (h.temperature) temperature = parseFloat(h.temperature);
                        else if (h['cpu-temperature']) temperature = parseFloat(h['cpu-temperature']);
                    }
                } catch (hErr) {
                    // Ignore health fetch errors (some routers don't support it)
                }

            } finally { await client.close(); }
        } else {
            const response = await req.routerInstance.get('/system/resource');
            resource = Array.isArray(response.data) ? response.data[0] : response.data;

            // Try fetching health for temperature
            try {
                const hRes = await req.routerInstance.get('/system/health');
                const h = Array.isArray(hRes.data) ? hRes.data[0] : hRes.data;
                if (h) {
                     if (h.temperature) temperature = parseFloat(h.temperature);
                     else if (h['cpu-temperature']) temperature = parseFloat(h['cpu-temperature']);
                }
            } catch (hErr) {
                // Ignore
            }
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
        
        const responseData = {
            boardName: resource['board-name'] || resource['boardName'] || '',
            version: resource.version || '',
            cpuLoad: Number(resource['cpu-load'] || resource['cpuLoad'] || 0),
            uptime: resource.uptime || '',
            memoryUsage,
            totalMemory: formatBytes(totalMemoryBytes)
        };
        
        if (temperature !== null && !isNaN(temperature)) {
            responseData.temperature = temperature;
        }

        res.json(responseData);
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
                // Get active connections
                const active = await writeLegacySafe(client, ['/ppp/active/print']);
                const activeNormalized = active.map(normalizeLegacyObject);

                // Get interface stats for each active connection
                // This is N+1 but necessary for accurate real-time speeds per user
                // To optimize, we could just fetch all interfaces and match by name, 
                // since PPP active interface names usually match or are predictable.
                // Let's fetch ALL interfaces first to avoid N round trips if possible.
                const interfaces = await writeLegacySafe(client, ['/interface/print', '?type=pppoe-in']);
                const interfacesNormalized = interfaces.map(normalizeLegacyObject);

                const enriched = activeNormalized.map(u => {
                    // Find matching interface (usually <pppoe-username>)
                    const iface = interfacesNormalized.find(i => i.name === `<pppoe-${u.name}>`) || 
                                  interfacesNormalized.find(i => i.name === u.name) ||
                                  interfacesNormalized.find(i => i.name.includes(u.name));
                    
                    // Legacy output for rx-byte/tx-byte is total, not rate. 
                    // To get RATE (bps), we need /interface/monitor-traffic
                    // But monitor-traffic is continuous. 
                    // Best approach for "snapshot" speed:
                    // We can't easily get instantaneous rate for ALL users in one command in legacy without scripting.
                    // However, 'interface print' often has 'rx-byte' 'tx-byte' totals.
                    // Real-time Mbps requires monitoring.
                    // Fallback: Just return what we have, frontend might need to poll or we implement a specific monitor endpoint.
                    // Actually, the user asked for "actual traffic speed". 
                    // For legacy, we might skip heavy monitoring for list views.
                    // BUT, RouterOS 'interface print detail' sometimes shows rate if monitored? No.
                    // Let's try to attach interface name at least.
                    return { ...u, interfaceId: iface ? iface['.id'] : null }; 
                });
                
                // For the purpose of this request, we need to return the list. 
                // The frontend will likely need to fetch traffic stats separately or we include it here?
                // Including real-time traffic for ALL users is heavy.
                // Let's start by just returning the list. The FRONTEND component will likely need to fetch specific stats.
                // WAIT: The user wants a COLUMN. 
                // If we want a column in the table, we need the data NOW.
                // Executing monitor-traffic for all active interfaces is too slow.
                // Alternative: Use /interface/print stats-detail? No.
                
                // Let's try to get ALL interface stats in one go if possible.
                res.json(activeNormalized);
            } finally {
                await client.close();
            }
        } else {
            const response = await req.routerInstance.get('/ppp/active');
            
            // For REST, we can also fetch interface stats
            // Same issue: real-time speed (bits/sec) vs total bytes.
            // /interface/print usually returns rx-byte/tx-byte (counters).
            // To get speed, we calculate delta or use monitor-traffic.
            // Let's just return the active users for now, and handle the "speed" fetching in the frontend 
            // by querying a new endpoint `ppp/active/stats` or similar to avoid blocking this call.
            res.json(response.data);
        }
    } catch (e) {
        console.error("PPP Active Error:", e.message);
        const status = e.response ? e.response.status : 500;
        const msg = e.response?.data?.message || e.response?.data?.detail || e.message;
        res.status(status).json({ message: msg });
    }
});

// 3c. System Logs (New Endpoint)
app.get('/:routerId/log/print', getRouter, async (req, res) => {
    try {
        const client = req.routerInstance;
        if (req.router.api_type === 'legacy') {
            await client.connect();
            const logs = await writeLegacySafe(client, ['/log/print']);
            // Keep connection? No, usually close for stateless unless caching.
            // But writeLegacySafe doesn't close.
            await client.close();
            // Normalize to ensure 'id' field exists and keys are consistent
            res.json(logs.map(normalizeLegacyObject));
        } else {
            // REST API: Use /log for the collection, not /log/print
            const response = await client.get('/log');
            res.json(response.data);
        }
    } catch (e) {
        console.error("Log Fetch Error:", e.message);
        if (req.router && req.router.api_type === 'legacy' && req.routerInstance) {
             try { await req.routerInstance.close(); } catch(_) {}
        }
        res.status(500).json({ message: e.message });
    }
});

// 3b. PPP Active Traffic Monitor (New Endpoint)
app.post('/:routerId/ppp/active/traffic', getRouter, async (req, res) => {
    const { names } = req.body; // Array of ppp active names (usernames)
    if (!names || !Array.isArray(names) || names.length === 0) return res.json({});

    try {
        const client = req.routerInstance;
        
        // 1. Resolve Interface Names
        // We need to map PPP User Name -> Actual Interface Name
        // Standard is <pppoe-username>, but it varies.
        // We fetch ALL pppoe-in interfaces to find matches.
        let interfaces = [];
        try {
            if (req.router.api_type === 'legacy') {
                await client.connect();
                // Try fetching pppoe-in first
                interfaces = await writeLegacySafe(client, ['/interface/print', '?type=pppoe-in']);
                // If empty, fetch all dynamic interfaces as fallback
                if (!interfaces || interfaces.length === 0) {
                     interfaces = await writeLegacySafe(client, ['/interface/print', '?dynamic=true']);
                }
            } else {
                const r = await client.get('/interface?type=pppoe-in');
                interfaces = r.data;
                if (!interfaces || interfaces.length === 0) {
                     const r2 = await client.get('/interface?dynamic=true');
                     interfaces = r2.data;
                }
            }
        } catch (err) {
            console.warn("Failed to fetch interfaces for mapping:", err.message);
        }

        const interfaceMap = {}; // username -> interfaceName
        const validInterfaceNames = [];

        if (Array.isArray(interfaces)) {
            names.forEach(uName => {
                // Try to find the interface
                // Matches: name === uName OR name === <pppoe-uName> OR name === pppoe-uName
                // Also check if name contains the username (loose match) for edge cases
                const match = interfaces.find(i => 
                    i.name === uName || 
                    i.name === `<pppoe-${uName}>` || 
                    i.name === `pppoe-${uName}` ||
                    (i.name.includes(uName) && i.name.includes('pppoe'))
                );

                if (match) {
                    interfaceMap[uName] = match.name;
                    validInterfaceNames.push(match.name);
                }
            });
        }

        // Deduplicate
        const uniqueInterfaces = [...new Set(validInterfaceNames)];
        if (uniqueInterfaces.length === 0) {
             if (req.router.api_type === 'legacy') await client.close();
             return res.json({});
        }

        // 2. Monitor Traffic
        const result = {};

        if (req.router.api_type === 'legacy') {
            // Legacy monitor-traffic
            try {
                // client is already connected
                const cmd = ['/interface/monitor-traffic', `=interface=${uniqueInterfaces.join(',')}`, '=once'];
                const stats = await writeLegacySafe(client, cmd);
                
                if (Array.isArray(stats)) {
                    stats.forEach(s => {
                        // We have stats for interface s.name.
                        // Find which user(s) map to this interface.
                        // This is reverse lookup.
                        Object.entries(interfaceMap).forEach(([u, iName]) => {
                            if (iName === s.name) {
                                result[u] = {
                                    rx: parseInt(s['rx-bits-per-second'] || 0),
                                    tx: parseInt(s['tx-bits-per-second'] || 0)
                                };
                            }
                        });
                    });
                }
            } finally {
                await client.close();
            }
        } else {
            // REST
            try {
                const r = await client.post('/interface/monitor-traffic', { interface: uniqueInterfaces.join(','), once: 'true' });
                const data = Array.isArray(r.data) ? r.data : [r.data]; // Handle single result
                data.forEach(s => {
                    Object.entries(interfaceMap).forEach(([u, iName]) => {
                        if (iName === s.name) {
                            result[u] = {
                                rx: parseInt(s['rx-bits-per-second'] || 0),
                                tx: parseInt(s['tx-bits-per-second'] || 0)
                            };
                        }
                    });
                });
            } catch (e) {
                 console.warn("REST Traffic monitor failed", e.message);
            }
        }
        
        res.json(result);

    } catch (e) {
        console.error("Traffic Endpoint Error:", e);
        // Ensure close if legacy and error happened before inner try/finally
        if (req.router && req.router.api_type === 'legacy' && req.routerInstance) {
             try { await req.routerInstance.close(); } catch(_) {}
        }
        res.status(500).json({});
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

            // 1. Ensure Authorized entry exists; attach expiry metadata
            const addressLists = await writeLegacySafe(client, ['/ip/firewall/address-list/print', '?address=' + address, '?list=authorized-dhcp-users']);
            if (Array.isArray(addressLists) && addressLists.length > 0) {
                await client.write('/ip/firewall/address-list/set', { '.id': addressLists[0]['.id'], comment: JSON.stringify(commentData) });
            } else {
                await client.write('/ip/firewall/address-list/add', { address, list: 'authorized-dhcp-users', timeout: '0s', comment: JSON.stringify(commentData) });
            }
            const pendingLists = await writeLegacySafe(client, ['/ip/firewall/address-list/print', '?address=' + address, '?list=pending-dhcp-users']);
            if (Array.isArray(pendingLists) && pendingLists.length > 0) {
                await client.write('/ip/firewall/address-list/remove', { '.id': pendingLists[0]['.id'] });
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

            // 1. Ensure Authorized entry exists; attach expiry metadata
            try {
                const alRes = await instance.get(`/ip/firewall/address-list?address=${address}&list=authorized-dhcp-users`);
                if (alRes.data && alRes.data.length > 0) {
                    await instance.patch(`/ip/firewall/address-list/${alRes.data[0]['.id']}`, { comment: JSON.stringify(commentData) });
                } else {
                    await instance.put(`/ip/firewall/address-list`, { address, list: 'authorized-dhcp-users', timeout: '0s', comment: JSON.stringify(commentData) });
                }
            } catch (e) { console.warn("Address list update warning", e.message); }
            try {
                const pendRes = await instance.get(`/ip/firewall/address-list?address=${address}&list=pending-dhcp-users`);
                if (pendRes.data && pendRes.data.length > 0) {
                    await instance.delete(`/ip/firewall/address-list/${pendRes.data[0]['.id']}`);
                }
            } catch (e) { console.warn("Pending list cleanup warning", e.message); }

            // 2. Update Queue
            if (speedLimit) {
                 const limitString = `${speedLimit}M/${speedLimit}M`;
                 const queueName = `DHCP-${macAddress}`;
                 try {
                    const qRes = await instance.get(`/queue/simple?name=${queueName}`);
                    if (qRes.data && qRes.data.length > 0) {
                        await instance.patch(`/queue/simple/${qRes.data[0]['.id']}`, { 'max-limit': limitString, comment: customerInfo });
                    } else {
                        await instance.put(`/queue/simple`, {
                           name: queueName,
                           target: address,
                           'max-limit': limitString,
                           comment: customerInfo
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
        const isGrace = subscriptionData && Number(subscriptionData.graceDays) > 0;
        const due = subscriptionData?.dueDateTime || subscriptionData?.dueDate;
        let d = due ? new Date(due) : null;
        if (d && isNaN(d.getTime())) {
            d = null;
        }
        if (!d && isGrace) {
            const now = new Date();
            d = new Date(now.getTime() + Number(subscriptionData.graceDays) * 86400000);
            if (subscriptionData.graceTime) {
                const parts = String(subscriptionData.graceTime).split(':');
                const hours = Number(parts[0] || 0);
                const minutes = Number(parts[1] || 0);
                d.setHours(hours, minutes, 0, 0);
            }
        }
        const schedName = isGrace ? `ppp-grace-expire-${String(secretData.name)}` : `ppp-auto-kick-${String(secretData.name)}`;
        const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const rosDate = d ? `${months[d.getMonth()]}/${String(d.getDate()).padStart(2,'0')}/${d.getFullYear()}` : null;
        const rosTime = d ? d.toTimeString().split(' ')[0] : null;
        const onEventProfile = subscriptionData?.nonPaymentProfile ? ` ; /ppp/secret/set [find name=\"${String(secretData.name)}\"] profile=${String(subscriptionData.nonPaymentProfile)}` : '';
const onEvent = `/log info \"PPPoE auto-kick: ${String(secretData.name)}\"; :do { /ppp/active/remove [find name=\"${String(secretData.name)}\"]; }` + onEventProfile;
        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance; await client.connect();
            try {
                let targetId = initialSecret?.id || null;
                try {
                    if (!targetId) {
                        const existing = await writeLegacySafe(client, ['/ppp/secret/print', '?name=' + String(secretData.name)]);
                        if (Array.isArray(existing) && existing.length > 0) targetId = existing[0]['.id'];
                    }
                } catch (_) {}
                const payload = {};
                if (targetId) payload['.id'] = targetId;
                if (secretData.name != null) payload['name'] = String(secretData.name);
                if (secretData.password != null) payload['password'] = String(secretData.password);
                const isGrace = subscriptionData && Number(subscriptionData.graceDays) > 0;
                let originalProfileVal = initialSecret?.profile;
                try {
                    const cur = await writeLegacySafe(client, ['/ppp/secret/print', '?name=' + String(secretData.name)]);
                    if (Array.isArray(cur) && cur.length > 0) originalProfileVal = cur[0]['profile'] || originalProfileVal;
                } catch (_) {}
                if (isGrace) payload['profile'] = String(secretData.profile || originalProfileVal || '');
                else if (secretData.profile != null) payload['profile'] = String(secretData.profile);
                if (secretData.service != null) payload['service'] = String(secretData.service); else if (!targetId) payload['service'] = 'pppoe';
                if (typeof secretData.disabled === 'boolean') payload['disabled'] = secretData.disabled ? 'yes' : 'no';
                else if (typeof secretData.disabled === 'string') payload['disabled'] = secretData.disabled === 'true' ? 'yes' : 'no';
                if (subscriptionData != null) {
                    const meta = await writeLegacySafe(client, ['/ppp/secret/print', '?name=' + String(secretData.name)]);
                    let preservedPlanType = '';
                    try { const c = JSON.parse(meta[0]?.comment || '{}'); preservedPlanType = (c.planType || '').toLowerCase(); } catch (_) {}
                    const db = await getDb(); const row = await db.get('SELECT original_plan_type FROM ppp_grace WHERE router_id = ? AND name = ?', [req.params.routerId, String(secretData.name)]);
                    if (row?.original_plan_type) preservedPlanType = (row.original_plan_type || '').toLowerCase();
                    let base = {}; try { base = JSON.parse(meta[0]?.comment || '{}'); } catch (_) {}
                    const merged = { ...base, ...subscriptionData, planType: (subscriptionData.planType || '').toLowerCase() || preservedPlanType };
                    if (subscriptionData?.dueDate) { const s = String(subscriptionData.dueDate); const datePart = s.split('T')[0]; merged.dueDate = datePart; merged.dueDateTime = s; }
                    if (d && !subscriptionData?.dueDate) { const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0'); const hh = String(d.getHours()).padStart(2,'0'); const mm = String(d.getMinutes()).padStart(2,'0'); const datePart = `${y}-${m}-${dd}`; merged.dueDate = datePart; merged.dueDateTime = `${datePart}T${hh}:${mm}`; }
                    payload['comment'] = JSON.stringify(merged);
                    console.log('[ppp/user/save] preserve planType:', preservedPlanType || subscriptionData.planType || 'unknown');
                }
                if (targetId) {
                    try {
                        const args = ['/ppp/secret/set', `=.id=${targetId}`];
                        if (payload['password'] != null) args.push(`=password=${String(payload['password'])}`);
                        if (payload['profile'] != null) args.push(`=profile=${String(payload['profile'])}`);
                        if (payload['service'] != null) args.push(`=service=${String(payload['service'])}`);
                        if (payload['disabled'] != null) args.push(`=disabled=${String(payload['disabled'])}`);
                        if (payload['comment'] != null) args.push(`=comment=${String(payload['comment'])}`);
                        await client.write('/ppp/secret/set', args.slice(1));
                    } catch (err) {
                        console.warn('[ppp/user/save][legacy] set failed, falling back to add:', err.message);
                        const addArgs = ['/ppp/secret/add', `=name=${String(secretData.name)}`, `=service=${String(payload['service'] || 'pppoe')}`];
                        if (payload['password'] != null) addArgs.push(`=password=${String(payload['password'])}`);
                        if (payload['profile'] != null) addArgs.push(`=profile=${String(payload['profile'])}`);
                        if (payload['disabled'] != null) addArgs.push(`=disabled=${String(payload['disabled'])}`);
                        if (payload['comment'] != null) addArgs.push(`=comment=${String(payload['comment'])}`);
                        await client.write('/ppp/secret/add', addArgs.slice(1));
                    }
                } else {
                    const addArgs = ['/ppp/secret/add', `=name=${String(secretData.name)}`, `=service=${String(payload['service'] || 'pppoe')}`];
                    if (payload['password'] != null) addArgs.push(`=password=${String(payload['password'])}`);
                    if (payload['profile'] != null) addArgs.push(`=profile=${String(payload['profile'])}`);
                    if (payload['disabled'] != null) addArgs.push(`=disabled=${String(payload['disabled'])}`);
                    if (payload['comment'] != null) addArgs.push(`=comment=${String(payload['comment'])}`);
                    await client.write('/ppp/secret/add', addArgs.slice(1));
                }
                if (targetId && initialSecret?.name && String(initialSecret.name) !== String(secretData.name)) {
                    try { await client.write('/ppp/secret/set', [`=.id=${targetId}`, `=name=${String(secretData.name)}`]); }
                    catch (e) { try { await client.write('/ppp/secret/set', [`=numbers=${targetId}`, `=name=${String(secretData.name)}`]); } catch (_) {} }
                }
                const prevProfile = String(originalProfileVal || '');
                const desiredProfile = String(payload['profile'] || '');
                const shouldKick = isGrace && desiredProfile && (desiredProfile !== prevProfile || prevProfile === String(subscriptionData?.nonPaymentProfile || 'Non-Payment'));
                if (shouldKick) {
                    try {
                        const active = await writeLegacySafe(client, ['/ppp/active/print', `?name=${String(secretData.name)}`]);
                        if (active.length > 0 && active[0]['.id']) {
                            await client.write('/ppp/active/remove', { '.id': active[0]['.id'] });
                        }
                        console.log('[ppp/grace/transition] legacy kick applied for', secretData.name);
                    } catch (e) { console.warn('[ppp/grace/transition] legacy kick failed:', e.message); }
                } else {
                    console.log('[ppp/grace/transition] legacy no kick (profile unchanged or not grace)');
                }
                if (d) {
                    try {
                        const s = await writeLegacySafe(client, ['/system/scheduler/print', `?name=${schedName}`]);
                        if (Array.isArray(s) && s.length > 0 && s[0]['.id']) await client.write('/system/scheduler/remove', { '.id': s[0]['.id'] });
                        await client.write('/system/scheduler/add', { name: schedName, 'start-date': rosDate, 'start-time': rosTime, interval: '0s', 'on-event': onEvent });
                    } catch (e) { console.warn('[ppp/user/save] scheduler update failed:', e.message); }
                    const database = await getDb();
                    const nowIso = new Date().toISOString();
                    const originalProfileToStore = String(payload['profile'] || originalProfileVal || '');
                    await database.run('INSERT OR REPLACE INTO ppp_grace (router_id, name, activated_at, expires_at, original_profile, original_plan_type, non_payment_profile, metadata) VALUES (?,?,?,?,?,?,?,?)', [req.params.routerId, String(secretData.name), nowIso, d.toISOString(), originalProfileToStore, (subscriptionData?.planType || '').toLowerCase(), String(subscriptionData?.nonPaymentProfile || ''), JSON.stringify({ graceDays: Number(subscriptionData?.graceDays || 0), graceTime: subscriptionData?.graceTime || null })]);
                }
                
                // Force remove active connection to apply changes immediately
                try {
                    const active = await writeLegacySafe(client, ['/ppp/active/print', `?name=${String(secretData.name)}`]);
                    if (active.length > 0 && active[0]['.id']) {
                        await client.write('/ppp/active/remove', { '.id': active[0]['.id'] });
                    }
                } catch (e) { console.warn('[ppp/user/save] legacy active remove failed:', e.message); }

                const saved = await writeLegacySafe(client, ['/ppp/secret/print', '?name=' + String(secretData.name)]);
                res.json(saved.map(normalizeLegacyObject));
            } finally { await client.close(); }
        } else {
            const instance = req.routerInstance; const name = encodeURIComponent(String(secretData.name));
            const qRes = await instance.get(`/ppp/secret?name=${name}`); const existing = Array.isArray(qRes.data) && qRes.data.length > 0 ? qRes.data[0] : null;
            const payload = {};
            if (secretData.name != null) payload['name'] = String(secretData.name);
            if (secretData.password != null) payload['password'] = String(secretData.password);
            const isGrace = subscriptionData && Number(subscriptionData.graceDays) > 0;
            let originalProfileVal = initialSecret?.profile || (existing && existing['profile']);
            if (!originalProfileVal) {
                try { const s2 = await instance.get(`/ppp/secret?name=${name}`); if (Array.isArray(s2.data) && s2.data.length > 0) originalProfileVal = s2.data[0]['profile']; } catch (_) {}
            }
            if (isGrace) payload['profile'] = String(secretData.profile || originalProfileVal || '');
            else if (secretData.profile != null) payload['profile'] = String(secretData.profile);
            if (secretData.service != null) payload['service'] = String(secretData.service); else if (!existing) payload['service'] = 'pppoe';
            if (typeof secretData.disabled === 'boolean') payload['disabled'] = secretData.disabled ? 'yes' : 'no';
            else if (typeof secretData.disabled === 'string') payload['disabled'] = secretData.disabled === 'true' ? 'yes' : 'no';
            if (subscriptionData != null) {
                const encName = encodeURIComponent(String(secretData.name));
                const s = await instance.get(`/ppp/secret?name=${encName}`);
                let preservedPlanType = '';
                try { const c = JSON.parse((Array.isArray(s.data) && s.data[0]?.comment) || '{}'); preservedPlanType = (c.planType || '').toLowerCase(); } catch (_) {}
                const db = await getDb(); const row = await db.get('SELECT original_plan_type FROM ppp_grace WHERE router_id = ? AND name = ?', [req.params.routerId, String(secretData.name)]);
                if (row?.original_plan_type) preservedPlanType = (row.original_plan_type || '').toLowerCase();
                let base = {}; try { base = JSON.parse((Array.isArray(s.data) && s.data[0]?.comment) || '{}'); } catch (_) {}
                const merged = { ...base, ...subscriptionData, planType: (subscriptionData.planType || '').toLowerCase() || preservedPlanType };
                if (subscriptionData?.dueDate) { const sVal = String(subscriptionData.dueDate); const datePart = sVal.split('T')[0]; merged.dueDate = datePart; merged.dueDateTime = sVal; }
                if (d && !subscriptionData?.dueDate) { const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0'); const hh = String(d.getHours()).padStart(2,'0'); const mm = String(d.getMinutes()).padStart(2,'0'); const datePart = `${y}-${m}-${dd}`; merged.dueDate = datePart; merged.dueDateTime = `${datePart}T${hh}:${mm}`; }
                payload['comment'] = JSON.stringify(merged);
                console.log('[ppp/user/save] preserve planType:', preservedPlanType || subscriptionData.planType || 'unknown');
            }
            if (existing) await instance.patch(`/ppp/secret/${existing['.id']}`, payload); else await instance.put(`/ppp/secret`, payload);
            const prevProfile = String(originalProfileVal || '');
const desiredProfile = String(payload['profile'] || '');
const shouldKick = isGrace && desiredProfile && (desiredProfile !== prevProfile || prevProfile === String(subscriptionData?.nonPaymentProfile || 'Non-Payment'));
if (shouldKick) {
    try { await req.routerInstance.post('/ppp/active/remove', { name: String(secretData.name) }); console.log('[ppp/grace/transition] rest kick applied for', secretData.name); }
    catch (e) { console.warn('[ppp/grace/transition] rest kick failed:', e.message); }
} else {
    console.log('[ppp/grace/transition] rest no kick (profile unchanged or not grace)');
}
            if (d) {
                const sch = await instance.get(`/system/scheduler?name=${encodeURIComponent(schedName)}`);
                if (Array.isArray(sch.data) && sch.data.length > 0) await instance.delete(`/system/scheduler/${sch.data[0]['.id']}`);
                await instance.put(`/system/scheduler`, { name: schedName, 'start-date': rosDate, 'start-time': rosTime, interval: '0s', 'on-event': onEvent });
                const database = await getDb();
                const nowIso = new Date().toISOString();
                const originalProfileToStore = String(payload['profile'] || originalProfileVal || '');
                await database.run('INSERT OR REPLACE INTO ppp_grace (router_id, name, activated_at, expires_at, original_profile, original_plan_type, non_payment_profile, metadata) VALUES (?,?,?,?,?,?,?,?)', [req.params.routerId, String(secretData.name), nowIso, d.toISOString(), originalProfileToStore, (subscriptionData?.planType || '').toLowerCase(), String(subscriptionData?.nonPaymentProfile || ''), JSON.stringify({ graceDays: Number(subscriptionData?.graceDays || 0), graceTime: subscriptionData?.graceTime || null })]);
            }
            
            // Force remove active connection to apply changes immediately
            try {
                const activeRes = await instance.get(`/ppp/active?name=${name}`);
                if (Array.isArray(activeRes.data) && activeRes.data.length > 0) {
                     await instance.delete(`/ppp/active/${activeRes.data[0]['.id']}`);
                }
            } catch (e) { console.warn('[ppp/user/save] REST active remove failed:', e.message); }

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
        const start = paymentDate ? new Date(paymentDate) : new Date();
        
        let expires;
        let fixedDay = null;

        // Smart Due Date Logic
        try {
            if (secret && secret.comment) {
                const c = JSON.parse(secret.comment);
                if (c.fixedDay) fixedDay = parseInt(c.fixedDay);
                else if (c.dueDate) {
                    const d = new Date(c.dueDate);
                    if (!isNaN(d.getTime())) fixedDay = d.getDate();
                }
            }
        } catch (e) {}
        if (!fixedDay) fixedDay = start.getDate();

        if (cycleDays >= 28 && cycleDays <= 31) {
            let targetYear = start.getFullYear();
            let targetMonth = start.getMonth() + 1; // Default to next month
            
            // Smart Check: If fixedDay is far enough in the current month (e.g. recovery from Feb shift), stay in current month
            // Example: Start=Mar 1, Fixed=30. Gap is 29 days. We want Mar 30, not Apr 30.
            // Threshold: 20 days ensures we don't accidentally shorten a cycle too much (e.g. Jan 29 -> Jan 30).
            if (fixedDay >= start.getDate() + 20) {
                targetMonth = start.getMonth();
            }

            if (targetMonth > 11) { targetMonth = 0; targetYear++; }
            
            const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
            let targetDay = fixedDay;
            
            // Handle February 30th -> March 1st edge case
            if (targetMonth === 1 && fixedDay > daysInTargetMonth) {
                targetMonth = 2; // March
                targetDay = 1;
            } else if (targetDay > daysInTargetMonth) {
                targetDay = daysInTargetMonth;
            }
            
            expires = new Date(targetYear, targetMonth, targetDay, start.getHours(), start.getMinutes(), start.getSeconds());
            
            // Apply discount (reduce days)
            if (discount > 0) expires.setDate(expires.getDate() - discount);
        } else {
            const effectiveDays = Math.max(0, cycleDays - discount);
            expires = new Date(start.getTime() + effectiveDays * 24 * 60 * 60 * 1000);
        }

        const commentData = { planName: plan?.name || '', dueDate: expires.toISOString().split('T')[0], dueDateTime: expires.toISOString(), paymentDate: start.toISOString(), discountDays: discount, kickFlag: true, fixedDay };
        const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const rosDate = `${months[expires.getMonth()]}/${String(expires.getDate()).padStart(2,'0')}/${expires.getFullYear()}`;
        const rosTime = expires.toTimeString().split(' ')[0];
        const schedName = `ppp-auto-kick-${String(secret.name)}`;
        const onEventProfile = nonPaymentProfile ? ` ; /ppp/secret/set [find name=\"${String(secret.name)}\"] profile=${String(nonPaymentProfile)}` : '';
const onEvent = `/log info \"PPPoE auto-kick: ${String(secret.name)}\"; :do { /ppp/active/remove [find name=\"${String(secret.name)}\"]; }` + onEventProfile;
        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance; await client.connect();
            try {
                let id = secret?.id || null;
                let currentComment = null; let preservedPlanType = '';
                try {
                    if (!id) {
                        const existing = await writeLegacySafe(client, ['/ppp/secret/print', '?name=' + String(secret.name)]);
                        if (!Array.isArray(existing) || existing.length === 0) return res.status(404).json({ message: 'PPP secret not found.' });
                        id = existing[0]['.id']; currentComment = existing[0]['comment'];
                    } else {
                        const existing = await writeLegacySafe(client, ['/ppp/secret/print', '?.id=' + String(id)]);
                        currentComment = Array.isArray(existing) && existing[0] ? existing[0]['comment'] : null;
                    }
                } catch (_) {}
                try { const c = JSON.parse(currentComment || '{}'); preservedPlanType = (c.planType || '').toLowerCase(); } catch (_) {}
                const db = await getDb(); const row = await db.get('SELECT original_plan_type FROM ppp_grace WHERE router_id = ? AND name = ?', [req.params.routerId, String(secret.name)]);
                if (row?.original_plan_type) preservedPlanType = (row.original_plan_type || '').toLowerCase();
                const finalComment = JSON.stringify({ ...commentData, planType: preservedPlanType || (plan.planType || '').toLowerCase() });
                console.log('[ppp/payment/process] preserve planType:', preservedPlanType || plan.planType || 'unknown');
                await client.write('/ppp/secret/set', [`=.id=${id}`, `=profile=${String(plan.pppoeProfile)}`, `=comment=${finalComment}`]);
                try {
                    const s = await writeLegacySafe(client, ['/system/scheduler/print', `?name=${schedName}`]);
                    if (Array.isArray(s) && s.length > 0 && s[0]['.id']) await client.write('/system/scheduler/remove', { '.id': s[0]['.id'] });
                    await client.write('/system/scheduler/add', { name: schedName, 'start-date': rosDate, 'start-time': rosTime, interval: '0s', 'on-event': onEvent });
                } catch (e) { console.warn('[ppp/payment/process] scheduler update failed:', e.message); }
                
                try {
                    const active = await writeLegacySafe(client, ['/ppp/active/print', `?name=${String(secret.name)}`]);
                    if (active.length > 0 && active[0]['.id']) {
                        await client.write('/ppp/active/remove', { '.id': active[0]['.id'] });
                    }
                } catch (e) { console.warn('[ppp/payment/process] active remove failed:', e.message); }
                
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
            try { 
                const activeRes = await instance.get(`/ppp/active?name=${name}`);
                if (Array.isArray(activeRes.data) && activeRes.data.length > 0) {
                    await instance.delete(`/ppp/active/${activeRes.data[0]['.id']}`);
                }
            } catch (e) { console.warn('[ppp/payment/process] REST active remove failed:', e.message); }
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
    const { name, graceDays, originalPlanType, originalProfile, nonPaymentProfile } = req.body; if (!name || !graceDays) return res.status(400).json({ message: 'name and graceDays are required' });
    try {
        const database = await getDb();
        const existing = await database.get('SELECT * FROM ppp_grace WHERE router_id = ? AND name = ?', [req.params.routerId, String(name)]);
        if (existing) return res.status(409).json({ message: 'Grace period already active for this user' });
        const now = new Date(); const activatedAt = now.toISOString(); const expiresAt = new Date(now.getTime() + Number(graceDays) * 86400000);
        const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const rosDate = `${months[expiresAt.getMonth()]}/${String(expiresAt.getDate()).padStart(2,'0')}/${expiresAt.getFullYear()}`; const rosTime = expiresAt.toTimeString().split(' ')[0];
        const schedName = `ppp-grace-expire-${String(name)}`;
        const onEvent = `/log info \"PPPoE grace expired: ${String(name)}\"; :do { /ppp/active/remove [find name=\"${String(name)}\"]; }`;
        const commentExtend = { graceDays: Number(graceDays), graceActivatedAt: activatedAt, kickFlag: true, originalPlanType: originalPlanType || '' };
        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance; await client.connect();
            try {
                const s = await writeLegacySafe(client, ['/ppp/secret/print', `?name=${String(name)}`]); if (!Array.isArray(s) || s.length === 0) return res.status(404).json({ message: 'PPP secret not found' });
                const id = s[0]['.id']; const currentComment = s[0]['comment']; let payloadComment;
                try { const c = JSON.parse(currentComment || '{}'); const preservedPlanType = (c.planType || originalPlanType || '').toLowerCase(); const merged = { ...c, ...commentExtend, planType: preservedPlanType }; payloadComment = JSON.stringify(merged); console.log('[ppp/grace/grant] preserve planType:', preservedPlanType || 'unknown'); }
                catch (_) { payloadComment = JSON.stringify({ ...commentExtend, planType: (originalPlanType || '').toLowerCase() }); }
                await client.write('/ppp/secret/set', [`=.id=${id}`, `=comment=${payloadComment}`]);
                if (originalProfile) await client.write('/ppp/secret/set', [`=.id=${id}`, `=profile=${String(originalProfile)}`]);
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
            if (originalProfile) await instance.patch(`/ppp/secret/${id}`, { profile: String(originalProfile) });
            const sch = await instance.get(`/system/scheduler?name=${encodeURIComponent(schedName)}`); if (Array.isArray(sch.data) && sch.data.length > 0) await instance.delete(`/system/scheduler/${sch.data[0]['.id']}`);
            await instance.put(`/system/scheduler`, { name: schedName, 'start-date': rosDate, 'start-time': rosTime, interval: '0s', 'on-event': onEvent });
        }
        await database.run('INSERT OR REPLACE INTO ppp_grace (router_id, name, activated_at, expires_at, original_profile, original_plan_type, non_payment_profile, metadata) VALUES (?,?,?,?,?,?,?,?)', [req.params.routerId, String(name), activatedAt, expiresAt.toISOString(), originalProfile || null, originalPlanType || null, nonPaymentProfile || null, JSON.stringify({ graceDays })]);
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
        let d = new Date(dueDateTime); if (isNaN(d.getTime())) return res.status(400).json({ message: 'Invalid dueDateTime' });
        const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
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

// Minimal Panel Roles API fallback (unblocks UI when proxy is unavailable)
app.get('/api/roles', async (req, res) => {
    try { const dbx = await getDb(); const rows = await dbx.all('SELECT id, name, description FROM roles'); res.json(rows); }
    catch (e) { res.status(500).json({ message: e.message }); }
});
app.get('/api/permissions', async (req, res) => {
    try { const dbx = await getDb(); const rows = await dbx.all('SELECT id, name, description FROM permissions'); res.json(rows); }
    catch (e) { res.status(500).json({ message: e.message }); }
});
app.get('/api/panel-users', async (req, res) => {
    try {
        const dbx = await getDb();
        const rows = await dbx.all(`SELECT u.id, u.username, r.id AS role_id, r.name AS role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id`);
        const mapped = rows.map(r => ({ id: r.id, username: r.username, role: { id: r.role_id, name: r.role_name || '' } }));
        res.json(mapped);
    } catch (e) { res.status(500).json({ message: e.message }); }
});

// Create a new panel user
app.post('/api/panel-users', async (req, res) => {
    const { username, password, role_id } = req.body || {};
    if (!username || !password || !role_id) {
        return res.status(400).json({ message: 'Username, password, and role_id are required.' });
    }
    try {
        const dbx = await getDb();
        const role = await dbx.get('SELECT id FROM roles WHERE id = ?', [role_id]);
        if (!role) {
            return res.status(400).json({ message: 'Invalid role_id specified.' });
        }
        const hash = await bcrypt.hash(password, 10);
        const id = `user_${Date.now()}`;
        await dbx.run('INSERT INTO users (id, username, password, role_id) VALUES (?, ?, ?, ?)', [id, username, hash, role_id]);
        const row = await dbx.get(`SELECT u.id, u.username, r.id AS role_id, r.name AS role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = ?`, [id]);
        res.status(201).json({ id: row.id, username: row.username, role: { id: row.role_id, name: row.role_name || '' } });
    } catch (e) {
        if (String(e.message).includes('UNIQUE')) {
            return res.status(409).json({ message: 'Username already exists.' });
        }
        res.status(500).json({ message: e.message });
    }
});

// Delete a panel user by id
app.delete('/api/panel-users/:id', async (req, res) => {
    try {
        const dbx = await getDb();
        const id = req.params.id;
        const result = await dbx.run('DELETE FROM users WHERE id = ?', [id]);
        if (result.changes === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        res.status(204).send();
    } catch (e) { res.status(500).json({ message: e.message }); }
});

// Role permissions (fallback)
app.get('/api/roles/:roleId/permissions', async (req, res) => {
    try {
        const dbx = await getDb();
        const rows = await dbx.all(`SELECT permission_id FROM role_permissions WHERE role_id = ?`, [req.params.roleId]);
        res.json(rows.map(r => r.permission_id));
    } catch (e) { res.status(500).json({ message: e.message }); }
});
app.put('/api/roles/:roleId/permissions', async (req, res) => {
    try {
        const dbx = await getDb();
        const ids = Array.isArray(req.body?.permissionIds) ? req.body.permissionIds : [];
        await dbx.exec('BEGIN');
        await dbx.run('DELETE FROM role_permissions WHERE role_id = ?', [req.params.roleId]);
        for (const pid of ids) { await dbx.run('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [req.params.roleId, pid]); }
        await dbx.exec('COMMIT');
        res.json({ success: true });
    } catch (e) { try { const dbx = await getDb(); await dbx.exec('ROLLBACK'); } catch {} res.status(500).json({ message: e.message }); }
});

app.get('/captive/info', async (req, res) => {
    try {
        const dbx = await getDb();
        const routers = await dbx.all('SELECT * FROM routers');
        let ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '').trim();
        if (ip.includes(',')) ip = ip.split(',')[0].trim();
        ip = ip.replace('::ffff:', '').replace(/^::1$/, '127.0.0.1');
        const nowIso = new Date().toISOString();
        let result = null;
        for (const router of routers) {
            try {
                const instance = createRouterInstance(router);
                if (router.api_type === 'legacy') {
                    await instance.connect();
                    try {
                        const pend = await writeLegacySafe(instance, ['/ip/firewall/address-list/print', `?address=${ip}`, '?list=pending-dhcp-users']);
                        if (Array.isArray(pend) && pend.length > 0) {
                            const lease = await writeLegacySafe(instance, ['/ip/dhcp-server/lease/print', `?address=${ip}`]);
                            const mac = Array.isArray(lease) && lease.length > 0 ? lease[0]['mac-address'] || null : null;
                            const host = Array.isArray(lease) && lease.length > 0 ? lease[0]['host-name'] || null : null;
                            result = { status: 'expired', ip, macAddress: mac, hostName: host, routerId: router.id };
                        } else {
                            const auth = await writeLegacySafe(instance, ['/ip/firewall/address-list/print', `?address=${ip}`, '?list=authorized-dhcp-users']);
                            if (Array.isArray(auth) && auth.length > 0) {
                                let due = null, plan = null;
                                try {
                                    const meta = JSON.parse(String(auth[0].comment || '{}'));
                                    due = meta.dueDateTime || meta.dueDate || null;
                                    plan = meta.planName || null;
                                } catch (_) {}
                                if (due && new Date(due).toISOString() <= nowIso) {
                                    result = { status: 'expired', ip, dueDateTime: due, planName: plan, routerId: router.id };
                                } else {
                                    result = { status: 'authorized', ip, dueDateTime: due, planName: plan, routerId: router.id };
                                }
                            }
                        }
                    } finally { await instance.close(); }
                } else {
                    const pendRes = await instance.get(`/ip/firewall/address-list?address=${encodeURIComponent(ip)}&list=pending-dhcp-users`);
                    if (Array.isArray(pendRes.data) && pendRes.data.length > 0) {
                        const leaseRes = await instance.get(`/ip/dhcp-server/lease?address=${encodeURIComponent(ip)}`);
                        const l = Array.isArray(leaseRes.data) && leaseRes.data.length > 0 ? leaseRes.data[0] : null;
                        const mac = l ? l['mac-address'] || null : null;
                        const host = l ? l['host-name'] || null : null;
                        result = { status: 'expired', ip, macAddress: mac, hostName: host, routerId: router.id };
                    } else {
                        const authRes = await instance.get(`/ip/firewall/address-list?address=${encodeURIComponent(ip)}&list=authorized-dhcp-users`);
                        if (Array.isArray(authRes.data) && authRes.data.length > 0) {
                            let due = null, plan = null;
                            try {
                                const meta = JSON.parse(String(authRes.data[0].comment || '{}'));
                                due = meta.dueDateTime || meta.dueDate || null;
                                plan = meta.planName || null;
                            } catch (_) {}
                            if (due && new Date(due).toISOString() <= nowIso) {
                                result = { status: 'expired', ip, dueDateTime: due, planName: plan, routerId: router.id };
                            } else {
                                result = { status: 'authorized', ip, dueDateTime: due, planName: plan, routerId: router.id };
                            }
                        }
                    }
                }
                if (result) break;
            } catch (_) {}
        }
        if (!result) {
            res.json({ status: 'unknown', ip });
        } else {
            res.json(result);
        }
    } catch (e) {
        const s = e.response ? e.response.status : 500;
        const m = e.response?.data?.message || e.response?.data?.detail || e.message;
        res.status(s).json({ message: m });
    }
});

// DHCP Portal Setup
app.post('/:routerId/script/run-dhcp-portal-setup', getRouter, async (req, res) => {
    const { panelIp, lanInterface } = req.body;
    if (!panelIp || !lanInterface) return res.status(400).json({ message: 'Missing panelIp or lanInterface' });

    try {
        const SCRIPT_NAME = 'dhcp-lease-add-to-pending';
        const LIST_NAME = 'authorized-dhcp-users';
        const COMMENT_TAG = 'DHCP-PORTAL';

        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                // 1. Create Script
                const scripts = await writeLegacySafe(client, ['/system/script/print', '?name=' + SCRIPT_NAME]);
                if (scripts.length === 0) {
                    await client.write('/system/script/add', {
                        name: SCRIPT_NAME,
                        source: ':log info "DHCP Lease assigned (Portal Managed)"',
                        comment: COMMENT_TAG
                    });
                }

                // 2. Configure DHCP Server
                const servers = await writeLegacySafe(client, ['/ip/dhcp-server/print', '?interface=' + lanInterface]);
                if (servers.length > 0) {
                    await client.write('/ip/dhcp-server/set', {
                        '.id': servers[0]['.id'],
                        'lease-script': SCRIPT_NAME
                    });
                } else {
                    throw new Error(`No DHCP Server found on interface ${lanInterface}`);
                }

                // 3. Firewall NAT (Redirect)
                const natRules = await writeLegacySafe(client, ['/ip/firewall/nat/print', '?comment=' + COMMENT_TAG + '-REDIRECT']);
                if (natRules.length === 0) {
                    await client.write('/ip/firewall/nat/add', {
                        chain: 'dstnat',
                        protocol: 'tcp',
                        'dst-port': '80',
                        'in-interface': lanInterface,
                        'src-address-list': '!' + LIST_NAME,
                        action: 'dst-nat',
                        'to-addresses': panelIp,
                        'to-ports': '80',
                        comment: COMMENT_TAG + '-REDIRECT',
                        'place-before': 0
                    });
                }

                // 4. Firewall Filter Rules
                const dnsRules = await writeLegacySafe(client, ['/ip/firewall/filter/print', '?comment=' + COMMENT_TAG + '-DNS']);
                if (dnsRules.length === 0) {
                    await client.write('/ip/firewall/filter/add', {
                        chain: 'forward',
                        protocol: 'udp',
                        'dst-port': '53',
                        'in-interface': lanInterface,
                        action: 'accept',
                        comment: COMMENT_TAG + '-DNS',
                        'place-before': 0
                    });
                }
                
                const authRules = await writeLegacySafe(client, ['/ip/firewall/filter/print', '?comment=' + COMMENT_TAG + '-AUTH']);
                if (authRules.length === 0) {
                    await client.write('/ip/firewall/filter/add', {
                        chain: 'forward',
                        'in-interface': lanInterface,
                        'src-address-list': LIST_NAME,
                        action: 'accept',
                        comment: COMMENT_TAG + '-AUTH'
                    });
                }

                const panelRules = await writeLegacySafe(client, ['/ip/firewall/filter/print', '?comment=' + COMMENT_TAG + '-PANEL']);
                if (panelRules.length === 0) {
                     await client.write('/ip/firewall/filter/add', {
                        chain: 'forward',
                        'dst-address': panelIp,
                        action: 'accept',
                        comment: COMMENT_TAG + '-PANEL'
                     });
                }

                const dropRules = await writeLegacySafe(client, ['/ip/firewall/filter/print', '?comment=' + COMMENT_TAG + '-DROP']);
                if (dropRules.length === 0) {
                    await client.write('/ip/firewall/filter/add', {
                        chain: 'forward',
                        'in-interface': lanInterface,
                        'src-address-list': '!' + LIST_NAME,
                        action: 'drop',
                        comment: COMMENT_TAG + '-DROP'
                    });
                }

            } finally {
                await client.close();
            }
        } else {
            // REST API
            const instance = req.routerInstance;
            
            const sRes = await instance.get(`/system/script?name=${SCRIPT_NAME}`);
            if (!sRes.data || sRes.data.length === 0) {
                await instance.put('/system/script', {
                    name: SCRIPT_NAME,
                    source: ':log info "DHCP Lease assigned (Portal Managed)"',
                    comment: COMMENT_TAG
                });
            }

            const dRes = await instance.get(`/ip/dhcp-server?interface=${lanInterface}`);
            if (dRes.data && dRes.data.length > 0) {
                await instance.patch(`/ip/dhcp-server/${dRes.data[0]['.id']}`, { 'lease-script': SCRIPT_NAME });
            } else {
                throw new Error(`No DHCP Server found on interface ${lanInterface}`);
            }

            const natRes = await instance.get(`/ip/firewall/nat?comment=${COMMENT_TAG}-REDIRECT`);
            if (!natRes.data || natRes.data.length === 0) {
                await instance.put('/ip/firewall/nat', {
                    chain: 'dstnat',
                    protocol: 'tcp',
                    'dst-port': '80',
                    'in-interface': lanInterface,
                    'src-address-list': '!' + LIST_NAME,
                    action: 'dst-nat',
                    'to-addresses': panelIp,
                    'to-ports': '80',
                    comment: COMMENT_TAG + '-REDIRECT',
                    'place-before': '*0'
                });
            }

            const dnsRes = await instance.get(`/ip/firewall/filter?comment=${COMMENT_TAG}-DNS`);
            if (!dnsRes.data || dnsRes.data.length === 0) {
                 await instance.put('/ip/firewall/filter', {
                    chain: 'forward',
                    protocol: 'udp',
                    'dst-port': '53',
                    'in-interface': lanInterface,
                    action: 'accept',
                    comment: COMMENT_TAG + '-DNS',
                    'place-before': '*0'
                });
            }

            const authRes = await instance.get(`/ip/firewall/filter?comment=${COMMENT_TAG}-AUTH`);
            if (!authRes.data || authRes.data.length === 0) {
                 await instance.put('/ip/firewall/filter', {
                    chain: 'forward',
                    'in-interface': lanInterface,
                    'src-address-list': LIST_NAME,
                    action: 'accept',
                    comment: COMMENT_TAG + '-AUTH'
                });
            }

            const panelRes = await instance.get(`/ip/firewall/filter?comment=${COMMENT_TAG}-PANEL`);
            if (!panelRes.data || panelRes.data.length === 0) {
                 await instance.put('/ip/firewall/filter', {
                    chain: 'forward',
                    'dst-address': panelIp,
                    action: 'accept',
                    comment: COMMENT_TAG + '-PANEL'
                });
            }

            const dropRes = await instance.get(`/ip/firewall/filter?comment=${COMMENT_TAG}-DROP`);
            if (!dropRes.data || dropRes.data.length === 0) {
                 await instance.put('/ip/firewall/filter', {
                    chain: 'forward',
                    'in-interface': lanInterface,
                    'src-address-list': '!' + LIST_NAME,
                    action: 'drop',
                    comment: COMMENT_TAG + '-DROP'
                });
            }
        }

        res.json({ message: 'Portal components installed successfully' });
    } catch (e) {
        console.error("Portal Setup Error:", e.message);
        res.status(500).json({ message: e.message });
    }
});

// DHCP Portal Uninstall
app.post('/:routerId/script/run-dhcp-portal-uninstall', getRouter, async (req, res) => {
     try {
        const COMMENT_TAG = 'DHCP-PORTAL';
        const SCRIPT_NAME = 'dhcp-lease-add-to-pending';

        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                const tags = ['-REDIRECT', '-DNS', '-AUTH', '-PANEL', '-DROP'];
                for (const tag of tags) {
                    const type = tag === '-REDIRECT' ? 'nat' : 'filter';
                    const list = await writeLegacySafe(client, [`/ip/firewall/${type}/print`, `?comment=${COMMENT_TAG}${tag}`]);
                    for (const item of list) {
                        await client.write(`/ip/firewall/${type}/remove`, { '.id': item['.id'] });
                    }
                }

                const servers = await writeLegacySafe(client, ['/ip/dhcp-server/print', `?lease-script=${SCRIPT_NAME}`]);
                for (const s of servers) {
                    await client.write('/ip/dhcp-server/set', { '.id': s['.id'], 'lease-script': '' });
                }

                const scripts = await writeLegacySafe(client, ['/system/script/print', `?name=${SCRIPT_NAME}`]);
                for (const s of scripts) {
                    await client.write('/system/script/remove', { '.id': s['.id'] });
                }

            } finally {
                await client.close();
            }
        } else {
            const instance = req.routerInstance;
            const tags = ['-REDIRECT', '-DNS', '-AUTH', '-PANEL', '-DROP'];
            for (const tag of tags) {
                const type = tag === '-REDIRECT' ? 'nat' : 'filter';
                const list = await instance.get(`/ip/firewall/${type}?comment=${COMMENT_TAG}${tag}`);
                if (list.data) {
                    for (const item of list.data) {
                        await instance.delete(`/ip/firewall/${type}/${item['.id']}`);
                    }
                }
            }

             const servers = await instance.get(`/ip/dhcp-server?lease-script=${SCRIPT_NAME}`);
             if (servers.data) {
                for (const s of servers.data) {
                    await instance.patch(`/ip/dhcp-server/${s['.id']}`, { 'lease-script': '' });
                }
             }

             const scripts = await instance.get(`/system/script?name=${SCRIPT_NAME}`);
             if (scripts.data) {
                for (const s of scripts.data) {
                    await instance.delete(`/system/script/${s['.id']}`);
                }
             }
        }
        res.json({ message: 'Portal components uninstalled successfully' });
     } catch (e) {
        console.error("Portal Uninstall Error:", e.message);
        res.status(500).json({ message: e.message });
     }
});

// Forward /api/* calls to Panel UI server to avoid redirect loops
app.all('/api/*', async (req, res) => {
    try {
        const target = `http://127.0.0.1:3001${req.originalUrl}`;
        const axiosResp = await axios({ method: req.method, url: target, data: req.body, headers: { authorization: req.headers.authorization, 'content-type': req.headers['content-type'] || 'application/json' }, timeout: 15000 });
        res.status(axiosResp.status).send(axiosResp.data);
    } catch (e) {
        const status = e.response ? e.response.status : 502;
        const msg = e.response?.data?.message || e.message;
        res.status(status).json({ message: msg });
    }
});

app.post('/:routerId/file/get-content', getRouter, async (req, res) => {
    const id = req.body?.['.id'] || req.body?.id;
    if (!id) return res.status(400).json({ message: '.id is required' });
    try {
        if (req.router.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                const result = await writeLegacySafe(client, ['/file/get', `=.id=${id}`, '=value-name=contents']);
                let contents = '';
                if (Array.isArray(result) && result.length > 0) {
                    const r = result.find(x => typeof x === 'object');
                    contents = (r && (r.ret || r.value || r.contents || r.data)) || '';
                } else if (result && typeof result === 'object') {
                    contents = result.ret || result.value || result.contents || result.data || '';
                }
                res.json({ contents });
            } finally {
                await client.close();
            }
        } else {
            const instance = req.routerInstance;
            const response = await instance.post('/file/get', { '.id': id, '.proplist': 'contents' });
            let contents = '';
            const data = response.data;
            if (Array.isArray(data) && data.length > 0) {
                contents = data[0]?.contents || data[0]?.ret || '';
            } else if (data && typeof data === 'object') {
                contents = data.contents || data.ret || '';
            }
            res.json({ contents });
        }
    } catch (e) {
        const s = e.response ? e.response.status : 500;
        const m = e.response?.data?.message || e.response?.data?.detail || e.message;
        res.status(s).json({ message: m });
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
                    restMethod = 'PUT';
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

            try {
                const response = await instance.request({
                    method: restMethod,
                    url: restUrl,
                    data: restData
                });
                res.json(response.data);
            } catch (err) {
                if (restMethod === 'PUT') {
                    const fallback = await instance.request({
                        method: 'POST',
                        url: restUrl,
                        data: restData
                    });
                    res.json(fallback.data);
                } else {
                    throw err;
                }
            }
        }
    } catch (e) {
        const bodyKeys = body && typeof body === 'object' ? Object.keys(body) : [];
        console.error('[Proxy Error]', safeStringify({ endpoint, method, routerId: req.params.routerId, bodyKeys, message: e.message, status: e.response?.status, data: e.response?.data }));
        const status = e.response ? e.response.status : 500;
        const msg = e.response?.data?.message || e.response?.data?.detail || e.message;
        res.status(status).json({ message: msg });
    }
});

let graceWorkerRunning = false;
const processExpiredGrace = async () => {
    if (graceWorkerRunning) return; graceWorkerRunning = true;
    try {
        const database = await getDb();
        const nowIso = new Date().toISOString();
        const rows = await database.all('SELECT * FROM ppp_grace WHERE expires_at <= ?', [nowIso]);
        for (const row of rows) {
            try {
                const router = await database.get('SELECT * FROM routers WHERE id = ?', [row.router_id]);
                if (!router) continue;
                const instance = createRouterInstance(router);
                const nameEnc = encodeURIComponent(String(row.name));
                if (router.api_type === 'legacy') {
                    await instance.connect();
                    try {
                        const s = await writeLegacySafe(instance, ['/ppp/secret/print', `?name=${String(row.name)}`]);
                        if (Array.isArray(s) && s.length > 0 && row.non_payment_profile) {
                            await instance.write('/ppp/secret/set', { '.id': s[0]['.id'], profile: String(row.non_payment_profile) });
                        }
                        const active = await writeLegacySafe(instance, ['/ppp/active/print', `?name=${String(row.name)}`]);
                        if (Array.isArray(active) && active.length > 0) {
                            await instance.write('/ppp/active/remove', { '.id': active[0]['.id'] });
                        }
                        const sched = await writeLegacySafe(instance, ['/system/scheduler/print', `?name=ppp-grace-expire-${String(row.name)}`]);
                        if (Array.isArray(sched) && sched.length > 0) await instance.write('/system/scheduler/remove', { '.id': sched[0]['.id'] });
                    } finally { await instance.close(); }
                } else {
                    const sRes = await instance.get(`/ppp/secret?name=${nameEnc}`);
                    if (Array.isArray(sRes.data) && sRes.data.length > 0 && row.non_payment_profile) {
                        await instance.patch(`/ppp/secret/${sRes.data[0]['.id']}`, { profile: String(row.non_payment_profile) });
                    }
                    try {
                        const activeRes = await instance.get(`/ppp/active?name=${nameEnc}`);
                        if (Array.isArray(activeRes.data) && activeRes.data.length > 0) {
                             await instance.delete(`/ppp/active/${activeRes.data[0]['.id']}`);
                        }
                    } catch (e) { console.warn('[ppp/grace/expire] REST active remove failed:', e.message); }
                    const sch = await instance.get(`/system/scheduler?name=${encodeURIComponent(`ppp-grace-expire-${String(row.name)}`)}`);
                    if (Array.isArray(sch.data) && sch.data.length > 0) await instance.delete(`/system/scheduler/${sch.data[0]['.id']}`);
                }
                await database.run('DELETE FROM ppp_grace WHERE router_id = ? AND name = ?', [row.router_id, String(row.name)]);
                console.log('[ppp/grace/expire] applied non-payment profile and cleaned record', row.router_id, row.name);
            } catch (err) { console.error('[ppp/grace/expire] error', err.message); }
        }
    } catch (e) { console.error('[ppp/grace/worker] error', e.message); }
    finally { graceWorkerRunning = false; }
};
setInterval(processExpiredGrace, 60000);


// Global error handler to catch JSON/body parse errors (e.g. request aborted)
app.use((err, req, res, next) => {
    if (err && err.type === 'request.aborted') {
        console.warn('[Request Aborted]', req.method, req.url);
        return;
    }
    if (err && err.type === 'entity.too.large') {
        return res.status(413).json({ message: 'Request body too large' });
    }
    console.error('[Express Error]', err);
    res.status(500).json({ message: 'Internal Server Error' });
});

const server = app.listen(PORT, () => {
    console.log(`MikroTik API Backend listening on port ${PORT}`);
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    try {
        const url = new URL(request.url, `http://${request.headers.host}`);
        if (url.pathname === '/ws/ssh') {
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        } else {
            socket.destroy();
        }
    } catch (_) {
        socket.destroy();
    }
});

wss.on('connection', (ws) => {
    let ssh;
    let shellStream;
    let cols = 80;
    let rows = 24;

    const cleanUp = () => {
        try { if (shellStream) shellStream.close(); } catch (_) {}
        try { if (ssh) ssh.end(); } catch (_) {}
        shellStream = null;
        ssh = null;
    };

    ws.on('message', (message) => {
        let payload;
        try {
            payload = JSON.parse(message.toString());
        } catch (_) {
            return;
        }

        if (!payload || typeof payload !== 'object') return;

        if (payload.type === 'auth') {
            const data = payload.data || {};
            const host = String(data.host || '');
            const username = String(data.user || '');
            const password = String(data.password || '');
            cols = Number(data.term_cols || cols) || cols;
            rows = Number(data.term_rows || rows) || rows;

            if (!host || !username) {
                ws.send('\r\nInvalid SSH credentials\r\n');
                ws.close();
                return;
            }

            ssh = new SSHClient();
            ssh.on('ready', () => {
                ssh.shell({ term: 'xterm-color', cols, rows }, (err, stream) => {
                    if (err) {
                        ws.send(`\r\nSSH shell error: ${err.message}\r\n`);
                        ws.close();
                        return;
                    }
                    shellStream = stream;
                    stream.on('data', (data) => {
                        try { ws.send(data.toString('utf8')); } catch (_) {}
                    });
                    stream.on('close', () => {
                        cleanUp();
                        try { ws.close(); } catch (_) {}
                    });
                    stream.stderr?.on('data', (data) => {
                        try { ws.send(data.toString('utf8')); } catch (_) {}
                    });
                });
            });
            ssh.on('error', (err) => {
                try { ws.send(`\r\nSSH connection error: ${err.message}\r\n`); } catch (_) {}
                cleanUp();
            });
            ssh.on('end', () => {
                cleanUp();
                try { ws.close(); } catch (_) {}
            });

            ssh.connect({
                host,
                port: 22,
                username,
                password,
                readyTimeout: 15000
            });
        } else if (payload.type === 'data') {
            const data = String(payload.data || '');
            if (shellStream && data) {
                try { shellStream.write(data); } catch (_) {}
            }
        } else if (payload.type === 'resize') {
            cols = Number(payload.cols || cols) || cols;
            rows = Number(payload.rows || rows) || rows;
            if (shellStream && shellStream.setWindow) {
                try { shellStream.setWindow(rows, cols, 0, 0); } catch (_) {}
            }
        }
    });

    ws.on('close', () => {
        cleanUp();
    });
    ws.on('error', () => {
        cleanUp();
    });
});
