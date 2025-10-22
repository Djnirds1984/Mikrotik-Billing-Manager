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
const RouterOSClient = require('node-routeros');

const app = express();
const PORT = 3002;
const DB_SERVER_URL = 'http://localhost:3001';
const LICENSE_SECRET_KEY = process.env.LICENSE_SECRET || 'a-long-and-very-secret-string-for-licenses-!@#$%^&*()';

app.use(cors());
app.use(express.json());

const routerConfigCache = new Map();
const trafficStatsCache = new Map();

// --- Data Normalization for Legacy API ---
const toKebabCase = (str) => str.replace(/_/g, '-');

const normalizeLegacyObject = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    const newObj = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            newObj[toKebabCase(key)] = obj[key];
        }
    }
    if (newObj['.id']) {
        newObj.id = newObj['.id'];
    }
    return newObj;
};

// --- Client Factory ---
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
            timeout: 5,
        });
    }

    const protocol = config.port === 443 ? 'https' : 'http';
    const baseURL = `${protocol}://${config.host}:${config.port}/rest`;
    const auth = { username: config.user, password: config.password || '' };

    const instance = axios.create({ 
        baseURL, 
        auth,
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        timeout: 5000
    });

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

// --- Error Handling ---
const handleApiRequest = async (req, res, action) => {
    try {
        const result = await action();
        if (result === '') {
            res.status(204).send();
        } else {
            res.json(result);
        }
    } catch (error) {
        if (error.isAxiosError) {
            console.error("Axios Error:", `[${error.config?.method?.toUpperCase()}] ${error.config?.url} - ${error.message}`);
            if (error.response) {
                const status = error.response.status || 500;
                let message = `MikroTik REST API Error: ${error.response.data.message || 'Bad Request'}`;
                if (error.response.data.detail) message += ` - ${error.response.data.detail}`;
                res.status(status).json({ message });
            } else {
                res.status(500).json({ message: error.message });
            }
        } else {
            console.error("API Request Error:", error);
            let message = error.message || 'An internal server error occurred.';
            if (message.includes('ECONNREFUSED')) message = 'Connection refused. Check the IP address, port, and ensure the API service is enabled on the router.';
            if (message.includes('authentication failed')) message = 'Authentication failed. Please check your username and password.';
            if (message.includes('timeout')) message = 'Connection timed out. The router is not responding.';
            res.status(500).json({ message });
        }
    }
};

// --- Middleware ---
const getRouterConfig = async (req, res, next) => {
    const routerId = req.params.routerId || req.body.id;
    const authHeader = req.headers.authorization;
    const internalRequestHeaders = authHeader ? { 'Authorization': authHeader } : {};

    if (routerConfigCache.has(routerId)) {
        req.routerConfig = routerConfigCache.get(routerId);
        req.routerInstance = createRouterInstance(req.routerConfig);
        return next();
    }
    try {
        const response = await axios.get(`${DB_SERVER_URL}/api/db/routers`, { headers: internalRequestHeaders });
        const config = response.data.find(r => r.id === routerId);
        
        if (!config) {
            routerConfigCache.delete(routerId);
            return res.status(404).json({ message: `Router config for ID ${routerId} not found.` });
        }

        routerConfigCache.set(routerId, config);
        req.routerConfig = config;
        req.routerInstance = createRouterInstance(req.routerConfig);
        next();
    } catch (error) {
        res.status(500).json({ message: `Failed to fetch router config: ${error.message}` });
    }
};

// --- Special Endpoints ---

const parseMemory = (memStr) => {
    if (!memStr || typeof memStr !== 'string') return 0;
    const value = parseFloat(memStr);
    if (memStr.toLowerCase().includes('kib')) return value * 1024;
    if (memStr.toLowerCase().includes('mib')) return value * 1024 * 1024;
    if (memStr.toLowerCase().includes('gib')) return value * 1024 * 1024 * 1024;
    return value;
};

const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
};

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

app.get('/mt-api/:routerId/system/resource', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        let resource;
        if (req.routerConfig.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                const result = await client.write('/system/resource/print');
                resource = result.length > 0 ? normalizeLegacyObject(result[0]) : null;
            } finally {
                await client.close();
            }
        } else {
            const response = await req.routerInstance.get('/system/resource');
            // The REST API for /system/resource returns a single object, not an array.
            resource = response.data;
        }

        if (!resource || Object.keys(resource).length === 0) {
            throw new Error('Could not fetch system resource from router.');
        }

        const totalMemoryBytes = parseMemory(resource['total-memory']);
        const freeMemoryBytes = parseMemory(resource['free-memory']);
        const usedMemoryBytes = totalMemoryBytes - freeMemoryBytes;
        const memoryUsage = totalMemoryBytes > 0 ? (usedMemoryBytes / totalMemoryBytes) * 100 : 0;
        
        return {
            boardName: resource['board-name'],
            version: resource.version,
            cpuLoad: parseFloat(resource['cpu-load']),
            uptime: resource.uptime,
            memoryUsage: parseFloat(memoryUsage.toFixed(1)),
            totalMemory: formatBytes(totalMemoryBytes),
        };
    });
});

app.get('/mt-api/:routerId/ip/wan-routes', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        let routes;
        if (req.routerConfig.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                routes = await client.write('/ip/route/print');
                routes = routes.map(normalizeLegacyObject);
            } finally {
                await client.close();
            }
        } else {
            const response = await req.routerInstance.get('/ip/route');
            routes = response.data;
        }
        return routes.filter(r => r['check-gateway']);
    });
});

app.get('/mt-api/:routerId/ip/wan-failover-status', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        let routes;
        if (req.routerConfig.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                routes = await client.write('/ip/route/print');
                routes = routes.map(normalizeLegacyObject);
            } finally {
                await client.close();
            }
        } else {
            const response = await req.routerInstance.get('/ip/route');
            routes = response.data;
        }
        const wanRoutes = routes.filter(r => r['check-gateway']);
        const enabled = wanRoutes.some(r => r.disabled === 'false' || r.disabled === false);
        return { enabled };
    });
});

app.post('/mt-api/:routerId/ip/wan-failover', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        const { enabled } = req.body; // true to enable, false to disable
        if (req.routerConfig.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                let routes = await client.write('/ip/route/print');
                routes = routes.map(normalizeLegacyObject);
                const wanRoutes = routes.filter(r => r['check-gateway']);

                const promises = wanRoutes.map(r => 
                    client.write(['/ip/route/set', `=.id=${r.id}`, `=disabled=${enabled ? 'no' : 'yes'}`])
                );
                await Promise.all(promises);
            } finally {
                await client.close();
            }
        } else {
            const response = await req.routerInstance.get('/ip/route');
            const wanRoutes = response.data.filter(r => r['check-gateway']);

            const promises = wanRoutes.map(r => 
                req.routerInstance.patch(`/ip/route/${r.id}`, { disabled: !enabled })
            );
            await Promise.all(promises);
        }
        return { message: `WAN failover routes have been ${enabled ? 'enabled' : 'disabled'}.` };
    });
});

app.post('/mt-api/:routerId/ip/dhcp-server/lease/:leaseId/make-static', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        const { leaseId } = req.params;
        if (req.routerConfig.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                const result = await client.write('/ip/dhcp-server/lease/make-static', [`=.id=${leaseId}`]);
                if (result && result.length > 0 && result[0].message) {
                    throw new Error(result[0].message);
                }
            } finally {
                await client.close();
            }
            return { message: 'Lease made static.' };
        } else {
            // REST API supports this directly
            await req.routerInstance.post(`/ip/dhcp-server/lease/${encodeURIComponent(leaseId)}/make-static`);
            return { message: 'Lease made static.' };
        }
    });
});

app.post('/mt-api/:routerId/ip/dhcp-server/setup', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        const { dhcpInterface, dhcpAddressSpace, gateway, addressPool, dnsServers, leaseTime } = req.body;
        const poolName = `dhcp_pool_${dhcpInterface}`;
        
        if (req.routerConfig.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                // 1. Create IP Pool
                await client.write('/ip/pool/add', [`=name=${poolName}`, `=ranges=${addressPool}`]);
                
                // 2. Create DHCP Network
                await client.write('/ip/dhcp-server/network/add', [
                    `=address=${dhcpAddressSpace}`,
                    `=gateway=${gateway}`,
                    `=dns-server=${dnsServers}`
                ]);

                // 3. Create DHCP Server
                await client.write('/ip/dhcp-server/add', [
                    `=name=dhcp_${dhcpInterface}`,
                    `=interface=${dhcpInterface}`,
                    `=address-pool=${poolName}`,
                    `=lease-time=${leaseTime}`,
                    '=disabled=no'
                ]);

            } finally {
                await client.close();
            }
        } else { // REST API
             // 1. Create IP Pool
            await req.routerInstance.put('/ip/pool', {
                name: poolName,
                ranges: addressPool,
            });

            // 2. Create DHCP Network
            await req.routerInstance.put('/ip/dhcp-server/network', {
                address: dhcpAddressSpace,
                gateway: gateway,
                'dns-server': dnsServers,
            });
            
            // 3. Create DHCP Server
            await req.routerInstance.put('/ip/dhcp-server', {
                name: `dhcp_${dhcpInterface}`,
                interface: dhcpInterface,
                'address-pool': poolName,
                'lease-time': leaseTime,
                disabled: false,
            });
        }
        
        return { message: 'DHCP Server setup completed successfully.' };
    });
});


// Generic proxy handler for all other requests
app.all('/mt-api/:routerId/*', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        const apiPath = req.path.replace(`/mt-api/${req.params.routerId}`, '');
        
        // --- Legacy API Logic ---
        if (req.routerConfig.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            let result;
            try {
                const method = req.method.toLowerCase();
                const pathParts = apiPath.split('/').filter(Boolean);
                const hasId = pathParts.length > 1;
                const command = `/${pathParts.join('/')}`; // Adjusted to handle nested paths
                const id = hasId ? pathParts[pathParts.length - 1] : null;
                const commandWithoutId = hasId ? command.substring(0, command.lastIndexOf('/')) : command;


                let query = [];

                if (method === 'get') {
                    query.push(command + '/print');
                    Object.entries(req.query).forEach(([key, value]) => query.push(`?${key}=${value}`));
                } else if (method === 'post' && hasId) { // POST to a resource ID implies an update ('set')
                    query.push(commandWithoutId + '/set', `=.id=${id}`);
                    Object.entries(req.body).forEach(([key, value]) => query.push(`=${key}=${value}`));
                } else if (method === 'post' || method === 'put') { // POST/PUT to collection implies 'add'
                    query.push(command + '/add');
                    Object.entries(req.body).forEach(([key, value]) => query.push(`=${key}=${value}`));
                } else if (method === 'patch') {
                    query.push(commandWithoutId + '/set', `=.id=${id}`);
                    Object.entries(req.body).forEach(([key, value]) => query.push(`=${key}=${value}`));
                } else if (method === 'delete') {
                    query.push(commandWithoutId + '/remove', `=.id=${id}`);
                }

                if (query.length > 0) {
                    result = await client.write(query);
                } else {
                    throw new Error(`Unsupported legacy method/path combination: ${method.toUpperCase()} ${apiPath}`);
                }
            } finally {
                await client.close();
            }

            // Normalize and perform any custom logic
            let finalResult = Array.isArray(result) ? result.map(normalizeLegacyObject) : normalizeLegacyObject(result);
            return finalResult;
        } 
        
        // --- REST API Logic ---
        else {
            const options = {
                method: req.method,
                url: apiPath,
                data: (req.method !== 'GET' && req.body) ? req.body : undefined,
                params: req.query
            };
            const response = await req.routerInstance(options);
            return response.data;
        }
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
                ssh.on('ready', () => {
                    ws.send('SSH connection established.\r\n');
                    ssh.shell({ term: 'xterm-color', cols: term_cols, rows: term_rows }, (err, stream) => {
                        if (err) return ws.send(`\r\nSSH shell error: ${err.message}\r\n`);
                        stream.on('data', (data) => ws.send(data.toString('utf-8')));
                        stream.on('close', () => ssh.end());
                        ws.on('message', (nestedMessage) => {
                            try {
                                const nestedMsg = JSON.parse(nestedMessage);
                                if (nestedMsg.type === 'data' && stream.writable) stream.write(nestedMsg.data);
                                else if (nestedMsg.type === 'resize' && stream.writable) stream.setWindow(nestedMsg.rows, nestedMsg.cols);
                            } catch (e) {}
                        });
                    });
                }).on('error', (err) => {
                    ws.send(`\r\nSSH connection error: ${err.message}\r\n`);
                }).connect({ host, port: 22, username: user, password });
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