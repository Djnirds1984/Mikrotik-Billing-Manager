const express = require('express');
const axios = require('axios');
const cors = require('cors');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const { Client } = require('ssh2');
const os = require('os');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const { RouterOSClient } = require('node-routeros');

const app = express();
const PORT = 3002;
const DB_SERVER_URL = 'http://localhost:3001'; // The main panel server runs on port 3001
const LICENSE_SECRET_KEY = process.env.LICENSE_SECRET || 'a-long-and-very-secret-string-for-licenses-!@#$%^&*()';

app.use(cors()); // Allow all origins as it's proxied by Nginx
app.use(express.json());

// In-memory cache for router configs to avoid hitting the DB on every single request
const routerConfigCache = new Map();
// In-memory cache for calculating traffic stats
const trafficStatsCache = new Map();

const getDeviceId = () => {
    try {
        // 1. Prioritize /etc/machine-id as it's very stable on systemd-based systems
        if (fs.existsSync('/etc/machine-id')) {
            const machineId = fs.readFileSync('/etc/machine-id').toString().trim();
            if (machineId) {
                // Return a consistent hash of it
                return crypto.createHash('sha1').update(machineId).digest('hex').substring(0, 12);
            }
        }

        // 2. Fallback to a sorted list of MAC addresses if machine-id is not available
        const interfaces = os.networkInterfaces();
        const macs = [];

        for (const name of Object.keys(interfaces)) {
            // Skip virtual, loopback, and docker interfaces for stability
            if (name.startsWith('veth') || name.startsWith('br-') || name.startsWith('docker') || name === 'lo') {
                continue;
            }
            for (const iface of interfaces[name]) {
                if (iface.mac && iface.mac !== '00:00:00:00:00:00' && !iface.internal) {
                    macs.push(iface.mac.replace(/:/g, '').toLowerCase());
                }
            }
        }
        
        if (macs.length === 0) {
             // 3. Last resort fallback to hostname
             const hostname = os.hostname();
             if (hostname) {
                 return crypto.createHash('sha1').update(hostname).digest('hex').substring(0, 12);
             }
             throw new Error('Could not determine a stable Device ID for this host.');
        }

        // Sort to ensure a deterministic order and pick the first one
        macs.sort();
        // FIX: Hash the MAC address to ensure a consistent ID format
        return crypto.createHash('sha1').update(macs[0]).digest('hex').substring(0, 12);

    } catch (e) {
        console.error("Error getting Device ID:", e);
        // Throwing the error so the route handler can catch it and send a 500
        throw new Error('Could not determine a stable Device ID for this host.');
    }
};


const handleApiRequest = async (req, res, action) => {
    try {
        const result = await action();
        // MikroTik API sometimes returns an empty string on success, which is not valid JSON
        if (result === '') {
            res.status(204).send();
        } else {
            res.json(result);
        }
    } catch (error) {
        const isAxiosError = !!error.isAxiosError;
        console.error("API Request Error:", isAxiosError ? `[${error.config.method.toUpperCase()}] ${error.config.url} - ${error.message}` : error);
        if (isAxiosError && error.response) {
            console.error("Axios Response Data:", error.response.data);
            const status = error.response.status || 500;
            let message = `MikroTik REST API Error: ${error.response.data.message || 'Bad Request'}`;
            if (error.response.data.detail) message += ` - ${error.response.data.detail}`;
            res.status(status).json({ message });
        } else {
            res.status(500).json({ message: error.message || 'An internal server error occurred.' });
        }
    }
};

const createRouterInstance = (config) => {
    if (!config || !config.host || !config.user) {
        throw new Error('Invalid router configuration: host and user are required.');
    }
    
    if (config.api_type === 'legacy') {
        return new RouterOSClient({
            host: config.host,
            user: config.user,
            password: config.password || '',
            port: config.port || 8728,
        });
    }

    // Default to REST API
    const protocol = config.port === 443 ? 'https' : 'http';
    const baseURL = `${protocol}://${config.host}:${config.port}/rest`;
    const auth = { username: config.user, password: config.password || '' };

    const instance = axios.create({ 
        baseURL, 
        auth,
        // MikroTik with self-signed certs will fail without this
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
    });

    // Interceptor to map MikroTik's .id to a top-level id property for frontend convenience
    instance.interceptors.response.use(response => {
        if (response.data && Array.isArray(response.data)) {
            response.data = response.data.map(item => {
                if (item && typeof item === 'object' && '.id' in item) {
                    return { ...item, id: item['.id'] };
                }
                return item;
            });
        }
        return response;
    }, error => Promise.reject(error));

    return instance;
};

// Middleware to fetch and cache router config from the main panel server
const getRouterConfig = async (req, res, next) => {
    const routerId = req.params.routerId || req.body.id;
    
    // Grab the Authorization header from the incoming request from the frontend
    const authHeader = req.headers.authorization;
    
    // Create headers for the internal request to the main server
    const internalRequestHeaders = {};
    if (authHeader) {
        internalRequestHeaders['Authorization'] = authHeader;
    }

    if (routerConfigCache.has(routerId)) {
        req.routerConfig = routerConfigCache.get(routerId);
        req.routerInstance = createRouterInstance(req.routerConfig);
        return next();
    }
    try {
        // Fetch ALL router configs from the panel DB server, now with auth headers
        const response = await axios.get(`${DB_SERVER_URL}/api/db/routers`, {
            headers: internalRequestHeaders // Pass the headers here
        });
        const routers = response.data;
        const config = routers.find(r => r.id === routerId);
        
        if (!config) {
            // Clear cache for this ID if it was somehow invalid
            routerConfigCache.delete(routerId);
            return res.status(404).json({ message: `Router config for ID ${routerId} not found in database.` });
        }

        // Cache the found config
        routerConfigCache.set(routerId, config);
        req.routerConfig = config;
        req.routerInstance = createRouterInstance(config);
        next();
    } catch (error) {
        let errorMessage;
        if (axios.isAxiosError(error)) {
            if (error.response) {
                // The request was made and the server responded with a status code
                // that falls out of the range of 2xx
                if (error.response.status === 401) {
                    errorMessage = 'Authentication failed when fetching router config from the main server. The session may have expired.';
                } else {
                    errorMessage = `The main panel server responded with an error (Status: ${error.response.status}).`;
                }
                console.error(`API Backend Error: Received ${error.response.status} from Panel DB Server. Data:`, error.response.data);
            } else if (error.request) {
                // The request was made but no response was received
                errorMessage = 'Could not get a response from the main panel server. Please ensure the "mikrotik-manager" process is running correctly.';
                console.error('API Backend Error: No response received from Panel DB Server. Error code:', error.code);
            } else {
                // Something happened in setting up the request that triggered an Error
                errorMessage = `An unexpected error occurred while setting up the request to the main panel server: ${error.message}`;
            }
        } else {
            errorMessage = `An internal error occurred in the API backend: ${error.message}`;
        }
        
        console.error(`Failed to fetch router config for ${routerId}:`, errorMessage);
        res.status(500).json({ message: errorMessage });
    }
};

app.get('/api/license/status', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let deviceId;
    try {
        deviceId = getDeviceId();
    } catch (idError) {
        console.error("CRITICAL: Could not determine Device ID on API backend.", idError.message);
        return res.status(500).json({ message: 'Could not determine a stable Device ID for this host.' });
    }

    try {
        const result = await axios.get(`${DB_SERVER_URL}/api/db/license/license_key`, {
             headers: { 'Authorization': req.headers.authorization }
        }).then(res => res.data).catch(() => null);

        if (!result || !result.value) {
            return res.json({ licensed: false, deviceId });
        }
        
        const licenseKey = result.value;
        const decoded = jwt.verify(licenseKey, LICENSE_SECRET_KEY);

        if (decoded.deviceId !== deviceId || new Date(decoded.expiresAt) < new Date()) {
            return res.json({ licensed: false, deviceId });
        }

        res.json({ licensed: true, expires: decoded.expiresAt, deviceId: decoded.deviceId });

    } catch (e) {
        if (e instanceof jwt.JsonWebTokenError || e instanceof jwt.TokenExpiredError) {
            console.error("License verification error:", e.message);
            return res.json({ licensed: false, deviceId });
        }
        console.error("Error during license status check:", e.message);
        res.json({ licensed: false, deviceId, error: e.message });
    }
});


// Special endpoint for testing connection without a saved ID
app.post('/mt-api/test-connection', async (req, res) => {
    await handleApiRequest(req, res, async () => {
        const instance = createRouterInstance(req.body);
        if (req.body.api_type === 'legacy') {
            await instance.connect();
            await instance.close();
        } else {
            await instance.get('/system/resource');
        }
        return { success: true, message: 'Connection successful!' };
    });
});

// --- Custom Handlers for WAN Failover Feature ---

// Custom handler for WAN routes
app.get('/mt-api/:routerId/ip/wan-routes', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        const response = await req.routerInstance.get('/ip/route');
        const allRoutes = Array.isArray(response.data) ? response.data : [];
        // A WAN route for failover is identified by having 'check-gateway' enabled.
        const wanRoutes = allRoutes.filter(route => route['check-gateway']);
        return wanRoutes;
    });
});

// Custom handler for failover status
app.get('/mt-api/:routerId/ip/wan-failover-status', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        const response = await req.routerInstance.get('/ip/route');
        const allRoutes = Array.isArray(response.data) ? response.data : [];
        const failoverRoutesCount = allRoutes.filter(route => route['check-gateway'] && route.disabled === 'false').length;
        // Consider failover "enabled" if there's at least one active WAN route being checked.
        return { enabled: failoverRoutesCount > 0 };
    });
});

// Custom handler for master-enabling/disabling failover
app.post('/mt-api/:routerId/ip/wan-failover', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        const { enabled } = req.body;
        
        const { data: allRoutes } = await req.routerInstance.get('/ip/route');
        const wanRoutes = Array.isArray(allRoutes) ? allRoutes.filter(route => route['check-gateway']) : [];
        
        if (wanRoutes.length === 0) {
            return { message: 'No WAN/Failover routes with check-gateway found to configure.' };
        }
        
        // Use Promise.all to update all routes concurrently
        const updatePromises = wanRoutes.map(route => {
            return req.routerInstance.patch(`/ip/route/${route['.id']}`, {
                disabled: enabled ? 'false' : 'true'
            });
        });
        
        await Promise.all(updatePromises);
        
        return { message: `All WAN Failover routes have been ${enabled ? 'enabled' : 'disabled'}.` };
    });
});

// --- Custom Handlers for Dashboard ---

// Custom handler for system resource to format data for the dashboard
app.get('/mt-api/:routerId/system/resource', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        const { data } = await req.routerInstance.get('/system/resource');
        
        const totalMemoryBytes = data['total-memory'];
        const freeMemoryBytes = data['free-memory'];
        const usedMemoryBytes = totalMemoryBytes - freeMemoryBytes;
        
        const formatBytes = (bytes) => {
            if (!bytes || bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(0)) + sizes[i];
        };

        return {
            boardName: data['board-name'],
            version: data.version,
            cpuLoad: data['cpu-load'],
            uptime: data.uptime,
            memoryUsage: totalMemoryBytes > 0 ? parseFloat(((usedMemoryBytes / totalMemoryBytes) * 100).toFixed(1)) : 0,
            totalMemory: formatBytes(totalMemoryBytes)
        };
    });
});

// Custom handler for interfaces to calculate traffic rates manually
app.get('/mt-api/:routerId/interface', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        const { routerId } = req.params;
        const { data: currentInterfaces } = await req.routerInstance.get('/interface');

        if (!Array.isArray(currentInterfaces)) {
            return currentInterfaces; // Not an array, return as-is
        }

        const now = Date.now();
        const previousStats = trafficStatsCache.get(routerId);
        let processedInterfaces = [];

        if (previousStats && previousStats.interfaces) {
            const timeDiffSeconds = (now - previousStats.timestamp) / 1000;
            const prevInterfaceMap = previousStats.interfaces;

            processedInterfaces = currentInterfaces.map(iface => {
                const prevIface = prevInterfaceMap.get(iface.name);
                let rxRate = 0;
                let txRate = 0;

                if (prevIface && timeDiffSeconds > 0.1) { // Avoid division by zero or tiny intervals
                    let rxByteDiff = iface['rx-byte'] - prevIface.rxByte;
                    let txByteDiff = iface['tx-byte'] - prevIface.txByte;
                    
                    // Handle counter wrap-around (for 32-bit or 64-bit counters)
                    if (rxByteDiff < 0) { rxByteDiff = iface['rx-byte']; }
                    if (txByteDiff < 0) { txByteDiff = iface['tx-byte']; }

                    rxRate = (rxByteDiff * 8) / timeDiffSeconds;
                    txRate = (txByteDiff * 8) / timeDiffSeconds;
                }

                return {
                    ...iface,
                    id: iface['.id'],
                    rxRate: Math.round(rxRate),
                    txRate: Math.round(txRate),
                };
            });
        } else {
            // First run, just return 0 rates
            processedInterfaces = currentInterfaces.map(iface => ({
                ...iface,
                id: iface['.id'],
                rxRate: 0,
                txRate: 0,
            }));
        }

        // Update cache for the next call with only the necessary data
        const newInterfaceMap = new Map();
        currentInterfaces.forEach(iface => {
            newInterfaceMap.set(iface.name, {
                rxByte: iface['rx-byte'],
                txByte: iface['tx-byte']
            });
        });

        trafficStatsCache.set(routerId, {
            timestamp: now,
            interfaces: newInterfaceMap
        });

        return processedInterfaces;
    });
});

// --- Custom Handlers for System Settings ---

// Custom handler for syncing panel time to the router
app.post('/mt-api/:routerId/system/clock/sync', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        const now = new Date();
        
        const time = now.toTimeString().split(' ')[0]; // HH:MM:SS
        
        const month = now.toLocaleString('en-US', { month: 'short' }).toLowerCase();
        const day = ('0' + now.getDate()).slice(-2);
        const year = now.getFullYear();
        const date = `${month}/${day}/${year}`; // Mmm/dd/yyyy

        // FIX: Use `POST` to the `/system/clock/set` endpoint, which is the correct way to set the clock.
        await req.routerInstance.post('/system/clock/set', { time, date });

        return { message: `Router time successfully synced to ${date} ${time}.` };
    });
});


// Custom handler for processing PPPoE payments
app.post('/mt-api/:routerId/ppp/process-payment', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        const { secret, plan, nonPaymentProfile, paymentDate } = req.body;

        if (!secret || !secret.id || !secret.name || !plan || !nonPaymentProfile || !paymentDate) {
            throw new Error('Missing required payment data: secret, plan, nonPaymentProfile, and paymentDate are required.');
        }

        const payment = new Date(paymentDate);
        let newDueDate = new Date(payment);
        
        switch(plan.cycle) {
            case 'Monthly':
                newDueDate.setMonth(newDueDate.getMonth() + 1);
                break;
            case 'Quarterly':
                newDueDate.setMonth(newDueDate.getMonth() + 3);
                break;
            case 'Yearly':
                newDueDate.setFullYear(newDueDate.getFullYear() + 1);
                break;
            default:
                // Default to 30 days if cycle is unrecognized
                newDueDate.setDate(newDueDate.getDate() + 30);
                break;
        }

        const formatDateForMikroTik = (date) => {
            const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
            const month = months[date.getMonth()];
            const day = ('0' + date.getDate()).slice(-2);
            const year = date.getFullYear();
            return `${month}/${day}/${year}`;
        };
        
        const mikrotikDate = formatDateForMikroTik(newDueDate);
        // The comment will be used by the frontend to display subscription info
        const comment = JSON.stringify({ plan: plan.name, dueDate: newDueDate.toISOString().split('T')[0] });
        
        // 1. Update secret with new due date in comment
        await req.routerInstance.patch(`/ppp/secret/${secret.id}`, { comment });

        // 2. Create/update the expiration script idempotently
        const scriptName = `expire-${secret.name}`;
        const scriptSource = `/ppp secret set [find name="${secret.name}"] profile="${nonPaymentProfile}"`;
        
        const { data: existingScripts } = await req.routerInstance.get(`/system/script?name=${scriptName}`);
        if (existingScripts && existingScripts.length > 0) {
            const scriptId = existingScripts[0]['.id'];
            await req.routerInstance.patch(`/system/script/${scriptId}`, { source: scriptSource });
        } else {
            await req.routerInstance.put('/system/script', { name: scriptName, source: scriptSource, policy: "read,write,test" });
        }

        // 3. Create/update the scheduler idempotently
        const schedulerName = `expire-sched-${secret.name}`;
        const schedulerPayload = { 'on-event': scriptName, 'start-date': mikrotikDate, 'start-time': '00:00:01' };

        const { data: existingSchedulers } = await req.routerInstance.get(`/system/scheduler?name=${schedulerName}`);
        if (existingSchedulers && existingSchedulers.length > 0) {
            const schedulerId = existingSchedulers[0]['.id'];
            await req.routerInstance.patch(`/system/scheduler/${schedulerId}`, schedulerPayload);
        } else {
            await req.routerInstance.put('/system/scheduler', { name: schedulerName, ...schedulerPayload });
        }
        
        return { message: `Payment processed successfully. User ${secret.name} will expire on ${mikrotikDate}.` };
    });
});

// Custom endpoint for router logs
app.get('/mt-api/:routerId/log', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        const { data } = await req.routerInstance.get('/log');
        return data;
    });
});

// Custom endpoint for Panel Hotspot Smart Installer
app.post('/mt-api/:routerId/hotspot/panel-setup', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        const { routerId } = req.params;
        const { panelHostname } = req.body;

        if (!panelHostname) {
            throw new Error("panelHostname is required.");
        }

        // 1. Configure Walled Garden
        const { data: walledGardenEntries } = await req.routerInstance.get('/ip/hotspot/walled-garden/ip');
        const existingEntry = Array.isArray(walledGardenEntries) && walledGardenEntries.find(e => e['dst-host'] === panelHostname);
        
        if (!existingEntry) {
            await req.routerInstance.put('/ip/hotspot/walled-garden/ip', {
                action: 'accept',
                'dst-host': panelHostname,
                comment: 'Panel Hotspot Login'
            });
        }

        // Helper to create or update a file
        const upsertFile = async (fullPath, content) => {
            const { data: files } = await req.routerInstance.get(`/file?name=${encodeURIComponent(fullPath)}`);
            const existingFile = Array.isArray(files) && files.find(f => f.name === fullPath);
            if (existingFile) {
                await req.routerInstance.patch(`/file/${existingFile['.id']}`, { contents: content });
            } else {
                await req.routerInstance.post('/file', { name: fullPath, contents: content });
            }
        };

        // 2. Create/Update login.html
        const loginHtmlContent = `<html><head><title>Redirecting...</title><meta http-equiv="refresh" content="0;url=http://${panelHostname}:3001/hotspot-login?mac=$(mac-esc)&ip=$(ip-esc)&link-login-only=$(link-login-only-esc)&router_id=${routerId}"></head><body><p>Please wait...</p></body></html>`;
        await upsertFile('hotspot/login.html', loginHtmlContent);
        
        // 3. Create/Update alogin.html
        const aloginHtmlContent = `<html><head><title>Logging in...</title></head><body><form name="login" action="$(link-login-only)" method="post"><input type="hidden" name="username" value="$(username)"><input type="hidden" name="password" value="$(password)"></form><script>document.login.submit();</script></body></html>`;
        await upsertFile('hotspot/alogin.html', aloginHtmlContent);

        return { message: "Panel Hotspot configured successfully on the router!" };
    });
});

// Custom handler for getting file content
app.post('/mt-api/:routerId/file/print', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        const { data } = await req.routerInstance.post('/file/print', req.body);
        return data;
    });
});


// All other router-specific requests are handled by this generic proxy
app.all('/mt-api/:routerId/*', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        // The API path is the part of the URL *after* the routerId
        const apiPath = req.path.replace(`/mt-api/${req.params.routerId}`, ''); // Use req.path to exclude query string
        const options = {
            method: req.method,
            url: apiPath,
            data: (req.method !== 'GET' && req.body) ? req.body : undefined,
            params: req.query // Pass query params separately for axios to handle
        };
        const response = await req.routerInstance(options);
        return response.data;
    });
});

// --- WebSocket Server for SSH ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws/ssh' });

wss.on('connection', (ws) => {
    console.log('SSH WS Client connected');
    const ssh = new Client();

    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);

            if (msg.type === 'auth') {
                const { host, user, password, term_cols, term_rows } = msg.data;
                const sshPort = 22; // SSH port is almost always 22, regardless of API port

                ssh.on('ready', () => {
                    ws.send('SSH connection established.\r\n');
                    ssh.shell({ term: 'xterm-color', cols: term_cols, rows: term_rows }, (err, stream) => {
                        if (err) {
                            ws.send(`\r\nSSH shell error: ${err.message}\r\n`);
                            return;
                        }

                        stream.on('data', (data) => ws.send(data.toString('utf-8')));
                        stream.on('close', () => ssh.end());
                        
                        // Re-register message handler for this specific stream
                        ws.on('message', (nestedMessage) => {
                            try {
                                const nestedMsg = JSON.parse(nestedMessage);
                                if (nestedMsg.type === 'data' && stream.writable) {
                                    stream.write(nestedMsg.data);
                                } else if (nestedMsg.type === 'resize' && stream.writable) {
                                    stream.setWindow(nestedMsg.rows, nestedMsg.cols);
                                }
                            } catch (e) { /* Ignore non-json data */ }
                        });
                    });
                }).on('error', (err) => {
                    ws.send(`\r\nSSH connection error: ${err.message}\r\n`);
                }).connect({ host, port: sshPort, username: user, password });
            }
        } catch(e) {
            console.error("Error processing WS message:", e);
        }
    });

    ws.on('close', () => {
        console.log('SSH WS Client disconnected');
        ssh.end();
    });
});

server.listen(PORT, () => {
    console.log(`MikroTik API backend server running on http://localhost:${PORT}`);
});