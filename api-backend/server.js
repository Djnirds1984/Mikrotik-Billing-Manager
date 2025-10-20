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
        req.routerInstance = createRouterInstance(config);
        next();
    } catch (error) {
        res.status(500).json({ message: `Failed to fetch router config: ${error.message}` });
    }
};

// --- Special Endpoints ---
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
                let command = apiPath;
                let query = [];

                if (method === 'get') {
                    query.push(command + '/print');
                    Object.entries(req.query).forEach(([key, value]) => query.push(`?${key}=${value}`));
                } else if (method === 'post' || method === 'put') {
                    query.push(command + '/add');
                    Object.entries(req.body).forEach(([key, value]) => query.push(`=${key}=${value}`));
                } else if (method === 'patch') {
                    command = apiPath.substring(0, apiPath.lastIndexOf('/'));
                    const id = apiPath.substring(apiPath.lastIndexOf('/') + 1);
                    query.push(command + '/set', `=.id=${id}`);
                    Object.entries(req.body).forEach(([key, value]) => query.push(`=${key}=${value}`));
                } else if (method === 'delete') {
                    command = apiPath.substring(0, apiPath.lastIndexOf('/'));
                    const id = apiPath.substring(apiPath.lastIndexOf('/') + 1);
                    query.push(command + '/remove', `=.id=${id}`);
                }

                if (query.length > 0) {
                    result = await client.write(query);
                } else {
                    throw new Error(`Unsupported legacy method: ${method.toUpperCase()}`);
                }
            } finally {
                await client.close();
            }

            // Normalize and perform any custom logic
            let finalResult = Array.isArray(result) ? result.map(normalizeLegacyObject) : normalizeLegacyObject(result);

            // Special handling for interface traffic calculation
            if (apiPath === '/interface') {
                const now = Date.now();
                const previousStats = trafficStatsCache.get(req.params.routerId);
                if (previousStats) {
                    const timeDiffSeconds = (now - previousStats.timestamp) / 1000;
                    finalResult.forEach(iface => {
                        const prevIface = previousStats.interfaces[iface.name];
                        if (prevIface && timeDiffSeconds > 0.1) {
                            let rxByteDiff = iface['rx-byte'] - prevIface.rxByte;
                            let txByteDiff = iface['tx-byte'] - prevIface.txByte;
                            if (rxByteDiff < 0) rxByteDiff = iface['rx-byte'];
                            if (txByteDiff < 0) txByteDiff = iface['tx-byte'];
                            iface.rxRate = Math.round((rxByteDiff * 8) / timeDiffSeconds);
                            iface.txRate = Math.round((txByteDiff * 8) / timeDiffSeconds);
                        } else {
                            iface.rxRate = 0;
                            iface.txRate = 0;
                        }
                    });
                }
                const newInterfaceMap = {};
                finalResult.forEach(iface => {
                    newInterfaceMap[iface.name] = { rxByte: iface['rx-byte'], txByte: iface['tx-byte'] };
                });
                trafficStatsCache.set(req.params.routerId, { timestamp: now, interfaces: newInterfaceMap });
            }
            
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
