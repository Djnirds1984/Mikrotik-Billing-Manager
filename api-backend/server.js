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
        const mapId = (item) => {
            if (item && typeof item === 'object' && '.id' in item) {
                return { ...item, id: item['.id'] };
            }
            return item;
        };

        if (response.data && typeof response.data === 'object') {
            if (Array.isArray(response.data)) {
                // It's an array of objects
                response.data = response.data.map(mapId);
            } else {
                // It's a single object
                response.data = mapId(response.data);
            }
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

app.post('/mt-api/:routerId/ppp/process-payment', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        const { secret, plan, nonPaymentProfile, discountDays, paymentDate } = req.body;

        if (!secret || !plan || !nonPaymentProfile || !paymentDate) {
            throw new Error('Missing required payment data.');
        }

        // 1. Calculate new due date
        const startDate = new Date(paymentDate);
        let cycleDays = 30;
        if (plan.cycle === 'Yearly') cycleDays = 365;
        else if (plan.cycle === 'Quarterly') cycleDays = 90;
        
        const totalDays = cycleDays - (discountDays || 0);
        const dueDate = new Date(startDate);
        dueDate.setDate(dueDate.getDate() + totalDays);

        // Format for MikroTik scheduler (mmm/dd/yyyy)
        const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
        const schedulerDate = `${monthNames[dueDate.getMonth()]}/${String(dueDate.getDate()).padStart(2, '0')}/${dueDate.getFullYear()}`;
        const schedulerTime = "23:59:59"; // Run at the end of the day

        // 2. Create new comment
        const newComment = JSON.stringify({
            plan: plan.name,
            price: plan.price,
            currency: plan.currency,
            dueDate: dueDate.toISOString().split('T')[0],
            paidDate: paymentDate
        });

        // 3. Define script to run on scheduler
        const scriptSource = `:log info "Subscription expired for ${secret.name}, changing profile."; /ppp secret set [find name="${secret.name}"] profile=${nonPaymentProfile};`;
        const schedulerName = `disable-${secret.name.replace(/[^a-zA-Z0-9]/g, '_')}`; // Sanitize name for scheduler

        // 4. Update secret and create/update scheduler
        if (req.routerConfig.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                // Update secret
                await client.write('/ppp/secret/set', [
                    `=.id=${secret.id}`,
                    `=profile=${plan.pppoeProfile}`,
                    `=comment=${newComment}`,
                    '=disabled=no'
                ]);

                // Find existing scheduler
                const existingScheduler = await client.write('/system/scheduler/print', [`?name=${schedulerName}`]);

                if (existingScheduler.length > 0) {
                    // Update existing scheduler
                    await client.write('/system/scheduler/set', [
                        `=.id=${existingScheduler[0]['.id']}`,
                        `=start-date=${schedulerDate}`,
                        `=start-time=${schedulerTime}`,
                        `=on-event=${scriptSource}`
                    ]);
                } else {
                    // Add new scheduler
                    await client.write('/system/scheduler/add', [
                        `=name=${schedulerName}`,
                        `=start-date=${schedulerDate}`,
                        `=start-time=${schedulerTime}`,
                        `=interval=0`,
                        `=on-event=${scriptSource}`
                    ]);
                }
            } finally {
                await client.close();
            }
        } else { // REST API
            // Update secret
            await req.routerInstance.patch(`/ppp/secret/${encodeURIComponent(secret.id)}`, {
                profile: plan.pppoeProfile,
                comment: newComment,
                disabled: false
            });

            // Find existing scheduler
            const schedulersResponse = await req.routerInstance.get(`/system/scheduler?name=${schedulerName}`);
            const existingScheduler = schedulersResponse.data;
            
            if (existingScheduler.length > 0) {
                // Update existing
                await req.routerInstance.patch(`/system/scheduler/${encodeURIComponent(existingScheduler[0].id)}`, {
                    'start-date': schedulerDate,
                    'start-time': schedulerTime,
                    'on-event': scriptSource
                });
            } else {
                // Add new
                await req.routerInstance.put('/system/scheduler', {
                    name: schedulerName,
                    'start-date': schedulerDate,
                    'start-time': schedulerTime,
                    interval: '0',
                    'on-event': scriptSource
                });
            }
        }
        
        return { message: 'Payment processed and subscription updated successfully.' };
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
            // FIX: Correctly call the 'make-static' command via REST API.
            // The command is on the collection, and the target ID is in the body.
            await req.routerInstance.post(`/ip/dhcp-server/lease/make-static`, { ".id": leaseId });
            return { message: 'Lease made static.' };
        }
    });
});

app.post('/mt-api/:routerId/ip/dhcp-server/setup', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        const { dhcpInterface, dhcpAddressSpace, gateway, addressPool, dnsServers, leaseTime } = req.body;
        const poolName = `dhcp_pool_${dhcpInterface}`;

        // --- ADDED STEP: Assign IP to interface ---
        const cidr = dhcpAddressSpace.split('/')[1];
        if (!cidr) {
            throw new Error('Invalid DHCP Address Space format. It must be in CIDR notation (e.g., 192.168.88.0/24).');
        }
        const interfaceAddress = `${gateway}/${cidr}`;
        
        if (req.routerConfig.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                 // 1. Assign IP address to interface
                await client.write('/ip/address/add', [`=address=${interfaceAddress}`, `=interface=${dhcpInterface}`]);

                // 2. Create IP Pool
                await client.write('/ip/pool/add', [`=name=${poolName}`, `=ranges=${addressPool}`]);
                
                // 3. Create DHCP Network
                await client.write('/ip/dhcp-server/network/add', [
                    `=address=${dhcpAddressSpace}`,
                    `=gateway=${gateway}`,
                    `=dns-server=${dnsServers}`
                ]);

                // 4. Create DHCP Server
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
             // 1. Assign IP address to interface
            await req.routerInstance.put('/ip/address', {
                address: interfaceAddress,
                interface: dhcpInterface,
            });

             // 2. Create IP Pool
            await req.routerInstance.put('/ip/pool', {
                name: poolName,
                ranges: addressPool,
            });

            // 3. Create DHCP Network
            await req.routerInstance.put('/ip/dhcp-server/network', {
                address: dhcpAddressSpace,
                gateway: gateway,
                'dns-server': dnsServers,
            });
            
            // 4. Create DHCP Server
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

app.post('/mt-api/:routerId/dhcp-captive-portal/setup', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        const { panelIp, lanInterface } = req.body;
        if (!panelIp || !lanInterface) {
            throw new Error('Panel IP and LAN Interface are required.');
        }

        const scriptName = "dhcp-lease-add-to-pending";
        const authorizedListName = "authorized-dhcp-users";
        const pendingListName = "pending-dhcp-users";
        const portalRedirectComment = "Redirect pending HTTP to portal";
        const masqueradeComment = "Masquerade authorized DHCP clients";

        const scriptSource = `
:local mac $"lease-mac-address";
:local ip $"lease-address";
:log info "DHCP lease script: New lease for $ip ($mac)";
:if ([/ip firewall address-list find list="${authorizedListName}" address=$ip] = "") do={
  :log info "DHCP lease script: Adding $ip to pending list";
  /ip firewall address-list add address=$ip list="${pendingListName}" timeout=1d comment=$mac;
} else={
  :log info "DHCP lease script: $ip is already authorized";
}`;
        const compactScriptSource = scriptSource.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        
        if (req.routerConfig.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                // --- Base Setup (Address Lists, Script) ---
                await client.write('/ip/firewall/address-list/add', [`=list=${authorizedListName}`, `=comment=Users authorized by panel`]);
                await client.write('/ip/firewall/address-list/add', [`=list=${pendingListName}`, `=comment=Users pending authorization`]);
                await client.write('/system/script/add', [`=name=${scriptName}`, `=source=${compactScriptSource}`]);

                // --- DHCP Server Script Integration ---
                const dhcpServers = await client.write('/ip/dhcp-server/print', [`?interface=${lanInterface}`]);
                if (dhcpServers.length === 0) throw new Error(`No DHCP server found on interface "${lanInterface}".`);
                const serverId = dhcpServers[0]['.id'];
                await client.write('/ip/dhcp-server/set', [`=.id=${serverId}`, `=lease-script=${scriptName}`]);
                
                // --- Firewall Filter Rules ---
                await client.write('/ip/firewall/filter/add', ['=action=accept', '=chain=forward', `=dst-address=${panelIp}`, `=src-address-list=${pendingListName}`, '=place-before=0', '=comment=Allow pending to access portal']);
                await client.write('/ip/firewall/filter/add', ['=action=drop', '=chain=forward', `=src-address-list=${pendingListName}`, '=place-before=1', '=comment=Drop all other pending traffic']);
                await client.write('/ip/firewall/filter/add', ['=action=accept', '=chain=forward', `=src-address-list=${authorizedListName}`, '=place-before=0', '=comment=Allow authorized traffic']);
                
                // --- NAT Rule to redirect HTTP traffic to the panel ---
                const oldNatRule = await client.write('/ip/firewall/nat/print', [`?comment=${portalRedirectComment}`]);
                if (oldNatRule.length > 0) await client.write('/ip/firewall/nat/remove', [`=.id=${oldNatRule[0]['.id']}`]);
                await client.write('/ip/firewall/nat/add', [
                    '=chain=dstnat',
                    `=src-address-list=${pendingListName}`,
                    '=protocol=tcp',
                    '=dst-port=80',
                    '=action=dst-nat',
                    `=to-addresses=${panelIp}`,
                    '=to-ports=3001',
                    `=comment=${portalRedirectComment}`
                ]);

                // --- NAT Rule to masquerade authorized users ---
                const oldMasqueradeRule = await client.write('/ip/firewall/nat/print', [`?comment=${masqueradeComment}`]);
                if (oldMasqueradeRule.length > 0) await client.write('/ip/firewall/nat/remove', [`=.id=${oldMasqueradeRule[0]['.id']}`]);
                await client.write('/ip/firewall/nat/add', [
                    '=chain=srcnat',
                    `=src-address-list=${authorizedListName}`,
                    '=action=masquerade',
                    `=comment=${masqueradeComment}`,
                    '=place-before=0'
                ]);


            } finally {
                await client.close();
            }
        } else { // REST API
            // --- Base Setup ---
            await req.routerInstance.put('/ip/firewall/address-list', { list: authorizedListName, comment: "Users authorized by panel" });
            await req.routerInstance.put('/ip/firewall/address-list', { list: pendingListName, comment: "Users pending authorization" });
            await req.routerInstance.put('/system/script', { name: scriptName, source: compactScriptSource });
            
            // --- DHCP Server Script ---
            const dhcpServers = await req.routerInstance.get(`/ip/dhcp-server?interface=${lanInterface}`);
            if (dhcpServers.data.length === 0) throw new Error(`No DHCP server found on interface "${lanInterface}". Please set one up first.`);
            const serverId = dhcpServers.data[0].id;
            await req.routerInstance.patch(`/ip/dhcp-server/${serverId}`, { 'lease-script': scriptName });

            // --- Firewall Filter Rules ---
            await req.routerInstance.put('/ip/firewall/filter', { action: 'accept', chain: 'forward', 'dst-address': panelIp, 'src-address-list': pendingListName, 'place-before': '0', comment: "Allow pending to access portal" });
            await req.routerInstance.put('/ip/firewall/filter', { action: 'drop', chain: 'forward', 'src-address-list': pendingListName, 'place-before': '1', comment: "Drop all other pending traffic" });
            await req.routerInstance.put('/ip/firewall/filter', { action: 'accept', chain: 'forward', 'src-address-list': authorizedListName, 'place-before': '0', comment: "Allow authorized traffic" });
            
            // --- NAT Rule to redirect HTTP traffic to the panel ---
            const oldNatRules = await req.routerInstance.get(`/ip/firewall/nat?comment=${portalRedirectComment}`);
            for (const rule of oldNatRules.data) {
                await req.routerInstance.delete(`/ip/firewall/nat/${rule.id}`);
            }
            await req.routerInstance.put('/ip/firewall/nat', {
                chain: 'dstnat',
                'src-address-list': pendingListName,
                protocol: 'tcp',
                'dst-port': '80',
                action: 'dst-nat',
                'to-addresses': panelIp,
                'to-ports': '3001',
                comment: portalRedirectComment
            });
            
            // --- NAT Rule to masquerade authorized users ---
            const oldMasqueradeRules = await req.routerInstance.get(`/ip/firewall/nat?comment=${masqueradeComment}`);
            for (const rule of oldMasqueradeRules.data) {
                await req.routerInstance.delete(`/ip/firewall/nat/${rule.id}`);
            }
            await req.routerInstance.put('/ip/firewall/nat', {
                chain: 'srcnat',
                'src-address-list': authorizedListName,
                action: 'masquerade',
                comment: masqueradeComment,
                'place-before': '0'
            });
        }
        
        return { message: 'DHCP Captive Portal components installed successfully!' };
    });
});

app.post('/mt-api/:routerId/dhcp-captive-portal/uninstall', getRouterConfig, async (req, res) => {
    await handleApiRequest(req, res, async () => {
        const scriptName = "dhcp-lease-add-to-pending";
        const authorizedListName = "authorized-dhcp-users";
        const pendingListName = "pending-dhcp-users";
        const portalRedirectComment = "Redirect pending HTTP to portal";
        const masqueradeComment = "Masquerade authorized DHCP clients";

        if (req.routerConfig.api_type === 'legacy') {
            const client = req.routerInstance;
            await client.connect();
            try {
                const findAndRemove = async (path, query) => {
                    const items = await client.write(path + '/print', query);
                    for (const item of items) {
                        await client.write(path + '/remove', [`=.id=${item['.id']}`]);
                    }
                };

                await findAndRemove('/ip/firewall/nat', [`?comment=${portalRedirectComment}`]);
                await findAndRemove('/ip/firewall/nat', [`?comment=${masqueradeComment}`]);

                const filterComments = ["Allow pending to access portal", "Drop all other pending traffic", "Allow authorized traffic"];
                for (const comment of filterComments) {
                    await findAndRemove('/ip/firewall/filter', [`?comment=${comment}`]);
                }

                const dhcpServers = await client.write('/ip/dhcp-server/print', [`?lease-script=${scriptName}`]);
                for (const server of dhcpServers) {
                    await client.write('/ip/dhcp-server/set', [`=.id=${server['.id']}`, '=lease-script=none']);
                }
                
                await findAndRemove('/system/script', [`?name=${scriptName}`]);
                
                await findAndRemove('/ip/firewall/address-list', [`?list=${authorizedListName}`]);
                await findAndRemove('/ip/firewall/address-list', [`?list=${pendingListName}`]);

            } finally {
                await client.close();
            }
        } else { // REST API
            const findAndRemove = async (path, query) => {
                try {
                    const response = await req.routerInstance.get(`${path}?${query}`);
                    for (const item of response.data) {
                        await req.routerInstance.delete(`${path}/${item.id}`);
                    }
                } catch (e) { console.warn(`Could not remove items at ${path}:`, e.message); }
            };

            await findAndRemove('/ip/firewall/nat', `comment=${portalRedirectComment}`);
            await findAndRemove('/ip/firewall/nat', `comment=${masqueradeComment}`);

            const filterComments = ["Allow pending to access portal", "Drop all other pending traffic", "Allow authorized traffic"];
            for (const comment of filterComments) {
                await findAndRemove('/ip/firewall/filter', `comment=${comment}`);
            }

            try {
                const dhcpServers = await req.routerInstance.get(`/ip/dhcp-server?lease-script=${scriptName}`);
                for (const server of dhcpServers.data) {
                    await req.routerInstance.patch(`/ip/dhcp-server/${server.id}`, { 'lease-script': 'none' });
                }
            } catch(e) { console.warn('Could not unset DHCP script:', e.message); }
            
            await findAndRemove('/system/script', `name=${scriptName}`);
            await findAndRemove('/ip/firewall/address-list', `list=${authorizedListName}`);
            await findAndRemove('/ip/firewall/address-list', `list=${pendingListName}`);
        }

        return { message: 'DHCP Captive Portal components have been uninstalled.' };
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