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
const DB_PATH = path.join(__dirname, '../proxy/panel.db');

let db;
async function getDb() {
    if (!db) {
        db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });
    }
    return db;
}

// Middleware to attach router config based on ID
const getRouter = async (req, res, next) => {
    try {
        const routerId = req.params.routerId;
        if (!routerId) return res.status(400).json({ message: 'Router ID missing' });
        
        const database = await getDb();
        const router = await database.get('SELECT * FROM routers WHERE id = ?', [routerId]);
        if (!router) return res.status(404).json({ message: 'Router not found' });
        
        req.router = router;
        next();
    } catch (e) {
        console.error("DB Error:", e);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

// 1. DHCP Client Update Endpoint
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
            const client = new RouterOSAPI({
                host: req.router.host,
                user: req.router.user,
                password: req.router.password,
                port: req.router.port || 8728,
                timeout: 20
            });
            await client.connect();

            // 1. Update Address List Comment
            const addressLists = await client.write('/ip/firewall/address-list/print', ['?address=' + address, '?list=authorized-dhcp-users']);
            if (addressLists.length > 0) {
                await client.write('/ip/firewall/address-list/set', {
                    '.id': addressLists[0]['.id'],
                    comment: JSON.stringify(commentData)
                });
            }

            // 2. Update/Create Simple Queue (Speed Limit)
            if (speedLimit) {
                const limitString = `${speedLimit}M/${speedLimit}M`;
                const queues = await client.write('/queue/simple/print', ['?name=' + customerInfo]);
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
            const scheds = await client.write('/system/scheduler/print', ['?name=' + schedName]);
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
            const protocol = req.router.port === 443 ? 'https' : 'http';
            const baseUrl = `${protocol}://${req.router.host}:${req.router.port}/rest`;
            const auth = { username: req.router.user, password: req.router.password };
            const httpsAgent = new https.Agent({ rejectUnauthorized: false });

            // 1. Update Address List
            const alRes = await axios.get(`${baseUrl}/ip/firewall/address-list?address=${address}&list=authorized-dhcp-users`, { auth, httpsAgent });
            if (alRes.data && alRes.data.length > 0) {
                await axios.patch(`${baseUrl}/ip/firewall/address-list/${alRes.data[0]['.id']}`, {
                    comment: JSON.stringify(commentData)
                }, { auth, httpsAgent });
            }

            // 2. Update Queue
            if (speedLimit) {
                 const limitString = `${speedLimit}M/${speedLimit}M`;
                 try {
                    const qRes = await axios.get(`${baseUrl}/queue/simple?name=${customerInfo}`, { auth, httpsAgent });
                    if (qRes.data.length > 0) {
                        await axios.patch(`${baseUrl}/queue/simple/${qRes.data[0]['.id']}`, { 'max-limit': limitString }, { auth, httpsAgent });
                    } else {
                        await axios.put(`${baseUrl}/queue/simple`, {
                           name: customerInfo,
                           target: address,
                           'max-limit': limitString
                        }, { auth, httpsAgent });
                    }
                 } catch (e) { console.error("Queue update error", e); }
            }

            // 3. Update Scheduler
            try {
                const sRes = await axios.get(`${baseUrl}/system/scheduler?name=${schedName}`, { auth, httpsAgent });
                if (sRes.data.length > 0) {
                    await axios.delete(`${baseUrl}/system/scheduler/${sRes.data[0]['.id']}`, { auth, httpsAgent });
                }
                
                await axios.put(`${baseUrl}/system/scheduler`, {
                    name: schedName,
                    'start-date': rosDate,
                    'start-time': rosTime,
                    interval: '0s',
                    'on-event': onEvent
                }, { auth, httpsAgent });
            } catch (e) { console.error("Scheduler update error", e); }
        }
        
        res.json({ message: 'Updated successfully' });
    } catch (e) {
        console.error("Update Error:", e.message);
        res.status(500).json({ message: e.message });
    }
});

// 2. Generic Proxy Handler for all other MikroTik calls
app.all('/:routerId/:endpoint(*)', getRouter, async (req, res) => {
    const { endpoint } = req.params;
    const method = req.method;
    const body = req.body;

    try {
        if (req.router.api_type === 'legacy') {
             const client = new RouterOSAPI({
                host: req.router.host,
                user: req.router.user,
                password: req.router.password,
                port: req.router.port || 8728,
                timeout: 15
            });
            await client.connect();
            
            const cmd = '/' + endpoint; 
            
            if (method === 'POST' && body) {
                 await client.write(cmd, body);
                 res.json({ message: 'Command executed' });
            } else {
                 const data = await client.write(cmd);
                 res.json(data);
            }
            await client.close();
        } else {
            // REST API Proxy
            const protocol = req.router.port === 443 ? 'https' : 'http';
            const url = `${protocol}://${req.router.host}:${req.router.port}/rest/${endpoint}`;
            const agent = new https.Agent({ rejectUnauthorized: false });
            
            const response = await axios({
                method: method,
                url: url,
                auth: { username: req.router.user, password: req.router.password },
                data: body,
                httpsAgent: agent
            });
            res.json(response.data);
        }
    } catch (e) {
        console.error("Proxy Error:", e.message);
        const status = e.response ? e.response.status : 500;
        const msg = e.response && e.response.data ? (e.response.data.message || e.response.data.detail) : e.message;
        res.status(status).json({ message: msg });
    }
});

app.listen(PORT, () => {
    console.log(`MikroTik API Backend listening on port ${PORT}`);
});
