
const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const util = require('util');
const sqlite3 = require('@vscode/sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const os = require('os');
const crypto = require('crypto');
const axios = require('axios');
const https = require('https');
const { Xendit } = require('xendit-node');
const si = require('systeminformation');
const { RouterOSAPI } = require('node-routeros-v2');

const PORT = 3001;
const DB_PATH = path.join(__dirname, 'panel.db');
const SUPERADMIN_DB_PATH = path.join(__dirname, 'superadmin.db');
const BACKUP_DIR = path.join(__dirname, 'backups');
const SECRET_KEY = process.env.JWT_SECRET || 'a-very-weak-secret-key-for-dev-only';
const LICENSE_SECRET_KEY = process.env.LICENSE_SECRET || 'a-long-and-very-secret-string-for-licenses-!@#$%^&*()';

// Ensure backup dir exists
if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

let db;
let superadminDb;

// --- Database Initialization ---
async function initSuperadminDb() {
    try {
        superadminDb = await open({
            filename: SUPERADMIN_DB_PATH,
            driver: sqlite3.Database
        });
        await superadminDb.exec('CREATE TABLE IF NOT EXISTS superadmin (username TEXT PRIMARY KEY, password TEXT NOT NULL);');
        const superadminUser = await superadminDb.get("SELECT COUNT(*) as count FROM superadmin");
        if (superadminUser.count === 0) {
            const defaultPassword = 'superadmin';
            const hashedPassword = await bcrypt.hash(defaultPassword, 10);
            await superadminDb.run('INSERT INTO superadmin (username, password) VALUES (?, ?)', 'superadmin', hashedPassword);
            console.log('Superadmin user created (password: superadmin)');
        }
    } catch (err) {
        console.error('Failed to initialize superadmin database:', err);
        throw err;
    }
}

async function initDb() {
    try {
        db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });

        // Enable WAL mode for better concurrency
        await db.exec('PRAGMA journal_mode = WAL;');

        await db.exec(`
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                language TEXT DEFAULT 'en',
                currency TEXT DEFAULT 'USD',
                geminiApiKey TEXT,
                licenseKey TEXT,
                companyName TEXT,
                address TEXT,
                contactNumber TEXT,
                email TEXT,
                logoBase64 TEXT,
                telegramSettings TEXT,
                xenditSettings TEXT,
                databaseEngine TEXT DEFAULT 'sqlite',
                dbHost TEXT,
                dbPort INTEGER,
                dbUser TEXT,
                dbPassword TEXT,
                dbName TEXT,
                notificationSettings TEXT
            );
            INSERT OR IGNORE INTO settings (id) VALUES (1);
        `);
        
        // Ensure columns exist for existing DBs
        const columns = await db.all("PRAGMA table_info(settings)");
        const columnNames = columns.map(c => c.name);
        if (!columnNames.includes('telegramSettings')) await db.exec("ALTER TABLE settings ADD COLUMN telegramSettings TEXT");
        if (!columnNames.includes('xenditSettings')) await db.exec("ALTER TABLE settings ADD COLUMN xenditSettings TEXT");
        if (!columnNames.includes('databaseEngine')) await db.exec("ALTER TABLE settings ADD COLUMN databaseEngine TEXT DEFAULT 'sqlite'");
        if (!columnNames.includes('notificationSettings')) await db.exec("ALTER TABLE settings ADD COLUMN notificationSettings TEXT");

        // Users & Roles
        await db.exec(`
            CREATE TABLE IF NOT EXISTS roles (
                id TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                description TEXT
            );
            CREATE TABLE IF NOT EXISTS permissions (
                id TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                description TEXT
            );
            CREATE TABLE IF NOT EXISTS role_permissions (
                role_id TEXT,
                permission_id TEXT,
                PRIMARY KEY (role_id, permission_id),
                FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
                FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role_id TEXT,
                FOREIGN KEY (role_id) REFERENCES roles(id)
            );
        `);

        // Seed default roles
        const rolesCount = await db.get("SELECT COUNT(*) as count FROM roles");
        if (rolesCount.count === 0) {
            await db.run("INSERT INTO roles (id, name, description) VALUES (?, ?, ?)", 'role_admin', 'Administrator', 'Full access to all features');
            await db.run("INSERT INTO roles (id, name, description) VALUES (?, ?, ?)", 'role_employee', 'Employee', 'Limited access');
            
            await db.run("INSERT INTO permissions (id, name, description) VALUES (?, ?, ?)", 'perm_all', '*:*', 'All Permissions');
            await db.run("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", 'role_admin', 'perm_all');
        }

        // Business Data Tables
        await db.exec(`
            CREATE TABLE IF NOT EXISTS billing_plans (
                id TEXT PRIMARY KEY,
                routerId TEXT,
                name TEXT NOT NULL,
                price REAL NOT NULL,
                cycle TEXT NOT NULL,
                pppoeProfile TEXT,
                description TEXT,
                currency TEXT
            );
            CREATE TABLE IF NOT EXISTS sales_records (
                id TEXT PRIMARY KEY,
                routerId TEXT,
                date TEXT NOT NULL,
                clientName TEXT NOT NULL,
                planName TEXT NOT NULL,
                planPrice REAL NOT NULL,
                discountAmount REAL DEFAULT 0,
                finalAmount REAL NOT NULL,
                routerName TEXT,
                currency TEXT,
                clientAddress TEXT,
                clientContact TEXT,
                clientEmail TEXT
            );
            CREATE TABLE IF NOT EXISTS inventory (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                quantity INTEGER DEFAULT 0,
                price REAL,
                serialNumber TEXT,
                dateAdded TEXT
            );
            CREATE TABLE IF NOT EXISTS expenses (
                id TEXT PRIMARY KEY,
                date TEXT NOT NULL,
                category TEXT,
                description TEXT,
                amount REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS employees (
                id TEXT PRIMARY KEY,
                fullName TEXT NOT NULL,
                role TEXT,
                hireDate TEXT,
                salaryType TEXT,
                rate REAL
            );
            CREATE TABLE IF NOT EXISTS employee_benefits (
                id TEXT PRIMARY KEY,
                employeeId TEXT,
                sss BOOLEAN,
                philhealth BOOLEAN,
                pagibig BOOLEAN,
                FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS time_records (
                id TEXT PRIMARY KEY,
                employeeId TEXT,
                date TEXT,
                timeIn TEXT,
                timeOut TEXT,
                FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE CASCADE
            );
             CREATE TABLE IF NOT EXISTS customers (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE,
                routerId TEXT,
                fullName TEXT,
                address TEXT,
                contactNumber TEXT,
                email TEXT
            );
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                type TEXT,
                message TEXT,
                is_read INTEGER DEFAULT 0,
                timestamp TEXT,
                link_to TEXT,
                context_json TEXT
            );
            CREATE TABLE IF NOT EXISTS dhcp_billing_plans (
                id TEXT PRIMARY KEY,
                routerId TEXT,
                name TEXT NOT NULL,
                price REAL NOT NULL,
                cycle_days INTEGER NOT NULL,
                speedLimit TEXT,
                currency TEXT
            );
            CREATE TABLE IF NOT EXISTS dhcp_clients (
                id TEXT PRIMARY KEY,
                routerId TEXT,
                macAddress TEXT,
                customerInfo TEXT,
                contactNumber TEXT,
                email TEXT,
                speedLimit TEXT,
                lastSeen TEXT,
                UNIQUE(routerId, macAddress)
            );
        `);
        console.log('Database initialized successfully');
    } catch (err) {
        console.error('Failed to initialize database:', err);
        throw err;
    }
}

// --- Helpers ---
const getDeviceId = () => {
    const networkInterfaces = os.networkInterfaces();
    let macs = [];
    
    const ignoredInterfacePattern = /^(zt|docker|veth|br-|tun|tap|lo)/i;

    for (const [name, interfaces] of Object.entries(networkInterfaces)) {
        if (ignoredInterfacePattern.test(name)) {
            continue;
        }

        for (const iface of interfaces) {
            if (iface.mac && iface.mac !== '00:00:00:00:00:00' && !iface.internal) {
                macs.push(iface.mac);
            }
        }
    }
    
    macs.sort();
    const uniqueId = macs.join('') || (os.hostname() + os.arch() + os.platform());
    return crypto.createHash('sha256').update(uniqueId).digest('hex');
};

// --- Middleware ---
const protect = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authentication required.' });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid or expired token.' });
        req.user = user;
        next();
    });
};

const requireSuperadmin = (req, res, next) => {
    if (req.user?.role?.name?.toLowerCase() !== 'superadmin') {
        return res.status(403).json({ message: 'Access denied. Superadmin privileges required.' });
    }
    next();
};

// --- Main Application Logic ---
async function startServer() {
    await Promise.all([initDb(), initSuperadminDb()]);
    const app = express();

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
        root: path.resolve(__dirname, '..'), // Project root
    });

    app.use(express.json({ limit: '10mb' }));
    app.use(express.text({ limit: '10mb' }));

    // --- API ROUTES ---
    
    // Authentication
    const authRouter = express.Router();
    authRouter.post('/login', async (req, res) => {
        const { username, password } = req.body;
        try {
            // Check superadmin first
            const superadmin = await superadminDb.get('SELECT * FROM superadmin WHERE username = ?', [username]);
            if (superadmin) {
                const isValid = await bcrypt.compare(password, superadmin.password);
                if (isValid) {
                    const token = jwt.sign({ id: 'superadmin', username: 'superadmin', role: { name: 'Superadmin' }, permissions: ['*:*'] }, SECRET_KEY, { expiresIn: '24h' });
                    return res.json({ token, user: { id: 'superadmin', username: 'superadmin', role: { name: 'Superadmin' }, permissions: ['*:*'] } });
                }
            }

            const user = await db.get(`
                SELECT u.*, r.name as role_name 
                FROM users u 
                LEFT JOIN roles r ON u.role_id = r.id 
                WHERE u.username = ?`, [username]);

            if (!user || !(await bcrypt.compare(password, user.password))) {
                return res.status(401).json({ message: 'Invalid credentials' });
            }

            const permissions = await db.all(`
                SELECT p.name FROM permissions p
                JOIN role_permissions rp ON p.id = rp.permission_id
                WHERE rp.role_id = ?
            `, [user.role_id]);
            
            const permList = permissions.map(p => p.name);
            const token = jwt.sign({ id: user.id, username: user.username, role: { name: user.role_name }, permissions: permList }, SECRET_KEY, { expiresIn: '12h' });
            
            res.json({ token, user: { id: user.id, username: user.username, role: { id: user.role_id, name: user.role_name }, permissions: permList } });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    });

    authRouter.post('/register', async (req, res) => {
        const { username, password, securityQuestions } = req.body;
        try {
            const existing = await db.get('SELECT id FROM users WHERE username = ?', [username]);
            if (existing) return res.status(400).json({ message: 'Username already exists' });
            
            const userCount = await db.get('SELECT COUNT(*) as count FROM users');
            if (userCount.count > 0) return res.status(403).json({ message: 'Initial admin already exists. Use Panel Roles to add users.' });

            const hashedPassword = await bcrypt.hash(password, 10);
            const userId = `user_${Date.now()}`;
            const adminRole = await db.get("SELECT id FROM roles WHERE name = 'Administrator'");
            
            await db.run('INSERT INTO users (id, username, password, role_id) VALUES (?, ?, ?, ?)', [userId, username, hashedPassword, adminRole.id]);

            const token = jwt.sign({ id: userId, username, role: { name: 'Administrator' }, permissions: ['*:*'] }, SECRET_KEY);
            res.json({ token, user: { id: userId, username, role: { name: 'Administrator' }, permissions: ['*:*'] } });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    });

    authRouter.get('/has-users', async (req, res) => {
        const result = await db.get('SELECT COUNT(*) as count FROM users');
        res.json({ hasUsers: result.count > 0 });
    });

    authRouter.get('/status', protect, (req, res) => {
        res.json(req.user);
    });

    app.use('/api/auth', authRouter);

    // Database General API (Protected)
    const dbRouter = express.Router();
    dbRouter.use(protect);

    // Generic CRUD handler generator
    const createCrud = (route, table) => {
        dbRouter.get(route, async (req, res) => {
            try {
                const { routerId } = req.query;
                let query = `SELECT * FROM ${table}`;
                let params = [];
                if (routerId) {
                    query += ` WHERE routerId = ?`;
                    params.push(routerId);
                }
                const rows = await db.all(query, params);
                res.json(rows);
            } catch (e) {
                res.status(500).json({ message: e.message });
            }
        });
        dbRouter.post(route, async (req, res) => {
            try {
                const keys = Object.keys(req.body);
                const values = Object.values(req.body);
                const placeholders = keys.map(() => '?').join(',');
                await db.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`, values);
                res.json({ message: 'Created' });
            } catch (e) {
                res.status(500).json({ message: e.message });
            }
        });
        dbRouter.patch(`${route}/:id`, async (req, res) => {
            try {
                const { id } = req.params;
                const updates = Object.keys(req.body).map(k => `${k} = ?`).join(',');
                const values = [...Object.values(req.body), id];
                await db.run(`UPDATE ${table} SET ${updates} WHERE id = ?`, values);
                res.json({ message: 'Updated' });
            } catch (e) {
                res.status(500).json({ message: e.message });
            }
        });
        dbRouter.delete(`${route}/:id`, async (req, res) => {
            try {
                await db.run(`DELETE FROM ${table} WHERE id = ?`, req.params.id);
                res.json({ message: 'Deleted' });
            } catch (e) {
                res.status(500).json({ message: e.message });
            }
        });
    };

    createCrud('/billing-plans', 'billing_plans');
    createCrud('/inventory', 'inventory');
    createCrud('/expenses', 'expenses');
    createCrud('/employees', 'employees');
    createCrud('/customers', 'customers');
    createCrud('/routers', 'routers');
    createCrud('/employee-benefits', 'employee_benefits');
    createCrud('/time-records', 'time_records');
    createCrud('/dhcp-billing-plans', 'dhcp_billing_plans');
    createCrud('/dhcp_clients', 'dhcp_clients');
    createCrud('/sales', 'sales_records');

    // Special handling for settings
    dbRouter.get('/panel-settings', async (req, res) => {
        try {
            const s = await db.get('SELECT * FROM settings WHERE id = 1');
            if(s) {
                try { s.telegramSettings = JSON.parse(s.telegramSettings); } catch(e) {}
                try { s.xenditSettings = JSON.parse(s.xenditSettings); } catch(e) {}
                try { s.notificationSettings = JSON.parse(s.notificationSettings); } catch(e) {}
            }
            res.json(s || {});
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    dbRouter.get('/company-settings', async (req, res) => {
        try {
            const s = await db.get('SELECT companyName, address, contactNumber, email, logoBase64 FROM settings WHERE id = 1');
            res.json(s || {});
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    dbRouter.post('/company-settings', async (req, res) => {
        try {
            const keys = Object.keys(req.body);
            const values = Object.values(req.body);
            const setClause = keys.map(k => `${k} = ?`).join(',');
            await db.run(`UPDATE settings SET ${setClause} WHERE id = 1`, values);
            res.json({ message: 'Company settings saved' });
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    dbRouter.post('/panel-settings', async (req, res) => {
        try {
            const data = { ...req.body };
            if (data.telegramSettings) data.telegramSettings = JSON.stringify(data.telegramSettings);
            if (data.xenditSettings) data.xenditSettings = JSON.stringify(data.xenditSettings);
            if (data.notificationSettings) data.notificationSettings = JSON.stringify(data.notificationSettings);
            
            const keys = Object.keys(data);
            const values = Object.values(data);
            const setClause = keys.map(k => `${k} = ?`).join(',');
            await db.run(`UPDATE settings SET ${setClause} WHERE id = 1`, values);
            res.json({ message: 'Settings saved' });
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    // Notifications
    dbRouter.get('/notifications', async (req, res) => {
        const rows = await db.all('SELECT * FROM notifications ORDER BY timestamp DESC LIMIT 100');
        res.json(rows);
    });
    dbRouter.post('/notifications', async (req, res) => {
        const { id, type, message, is_read, timestamp, link_to, context_json } = req.body;
        await db.run('INSERT INTO notifications (id, type, message, is_read, timestamp, link_to, context_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, type, message, is_read, timestamp, link_to, context_json]);
        res.json({ message: 'Added' });
    });
    dbRouter.patch('/notifications/:id', async (req, res) => {
        await db.run('UPDATE notifications SET is_read = ? WHERE id = ?', [req.body.is_read, req.params.id]);
        res.json({ message: 'Updated' });
    });
    dbRouter.post('/notifications/clear-all', async (req, res) => {
        await db.run('DELETE FROM notifications');
        res.json({ message: 'Cleared' });
    });
    
    dbRouter.post('/sales/clear-all', async (req, res) => {
        const { routerId } = req.body;
        if (routerId) {
            await db.run('DELETE FROM sales_records WHERE routerId = ?', [routerId]);
        } else {
             await db.run('DELETE FROM sales_records');
        }
        res.json({ message: 'Sales cleared' });
    });

    app.use('/api/db', dbRouter);

    // --- Xendit API ---
    const xenditRouter = express.Router();
    xenditRouter.use(protect);

    xenditRouter.post('/invoice', async (req, res) => {
        try {
            const settings = await db.get('SELECT xenditSettings FROM settings WHERE id = 1');
            if (!settings || !settings.xenditSettings) {
                return res.status(400).json({ message: 'Xendit settings not configured in database.' });
            }
            
            const xSettings = JSON.parse(settings.xenditSettings);
            if (!xSettings.secretKey) {
                return res.status(400).json({ message: 'Xendit Secret Key is missing.' });
            }

            const x = new Xendit({ secretKey: xSettings.secretKey });
            const { Invoice } = x;

            const resp = await Invoice.createInvoice({
                data: req.body
            });
            res.json(resp);
        } catch (err) {
            console.error('Xendit Error:', err);
            res.status(500).json({ message: err.message });
        }
    });

    xenditRouter.get('/invoice/:id', async (req, res) => {
        try {
            const settings = await db.get('SELECT xenditSettings FROM settings WHERE id = 1');
            const xSettings = JSON.parse(settings?.xenditSettings || '{}');
            if (!xSettings.secretKey) return res.status(400).json({ message: 'Xendit unconfigured' });

            const x = new Xendit({ secretKey: xSettings.secretKey });
            const { Invoice } = x;
            
            const resp = await Invoice.getInvoice({ invoiceID: req.params.id });
            res.json(resp);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    });

    app.use('/api/xendit', xenditRouter);


    // --- License ---
    const licenseRouter = express.Router();
    licenseRouter.use(protect);
    licenseRouter.get('/status', async (req, res) => {
        try {
            const deviceId = getDeviceId();
            const settings = await db.get('SELECT licenseKey FROM settings WHERE id = 1');
            const licenseKey = settings?.licenseKey;

            if (!licenseKey) return res.json({ licensed: false, deviceId });

            jwt.verify(licenseKey, LICENSE_SECRET_KEY, (err, decoded) => {
                if (err || decoded.deviceId !== deviceId) {
                    return res.json({ licensed: false, deviceId, error: err ? 'Invalid key' : 'Device mismatch' });
                }
                res.json({ licensed: true, expires: new Date(decoded.exp * 1000).toISOString(), deviceId, licenseKey });
            });
        } catch (err) { res.status(500).json({ message: err.message }); }
    });
    licenseRouter.post('/activate', async (req, res) => {
        const { licenseKey } = req.body;
        try {
            const deviceId = getDeviceId();
            jwt.verify(licenseKey, LICENSE_SECRET_KEY, (err, decoded) => {
                if (err) throw new Error('Invalid license key format.');
                if (decoded.deviceId !== deviceId) throw new Error('This license key is for a different device.');
                return decoded;
            });
            await db.run('UPDATE settings SET licenseKey = ? WHERE id = 1', [licenseKey]);
            res.json({ success: true });
        } catch (err) { res.status(400).json({ message: err.message }); }
    });
    licenseRouter.post('/revoke', async (req, res) => {
        await db.run('UPDATE settings SET licenseKey = NULL WHERE id = 1');
        res.json({ success: true });
    });
    licenseRouter.post('/generate', requireSuperadmin, (req, res) => {
         const { deviceId, days } = req.body;
         const token = jwt.sign({ deviceId }, LICENSE_SECRET_KEY, { expiresIn: `${days}d` });
         res.json({ licenseKey: token });
    });
    app.use('/api/license', licenseRouter);

    // --- System / Host Status ---
    app.get('/api/host-status', protect, async (req, res) => {
        try {
            const cpu = await si.currentLoad();
            const mem = await si.mem();
            const fsSize = await si.fsSize();
            // Use root volume or first available
            const disk = fsSize.find(d => d.mount === '/') || fsSize[0] || { size: 1, used: 0, use: 0 };
            
            res.json({
                cpuUsage: cpu.currentLoad,
                memory: {
                    total: (mem.total / 1024 / 1024 / 1024).toFixed(2) + ' GB',
                    free: (mem.available / 1024 / 1024 / 1024).toFixed(2) + ' GB',
                    used: (mem.active / 1024 / 1024 / 1024).toFixed(2) + ' GB',
                    percent: (mem.active / mem.total) * 100
                },
                disk: {
                    total: (disk.size / 1024 / 1024 / 1024).toFixed(2) + ' GB',
                    used: (disk.used / 1024 / 1024 / 1024).toFixed(2) + ' GB',
                    free: ((disk.size - disk.used) / 1024 / 1024 / 1024).toFixed(2) + ' GB',
                    percent: disk.use
                }
            });
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    app.get('/api/host/logs', protect, async (req, res) => {
        // Stub: In a real environment, you would read /var/log/syslog or pm2 logs
        const type = req.query.type || 'panel-ui';
        let logCommand = '';
        
        // Attempt to read logs via pm2 if available, otherwise mock
        if (type.includes('nginx')) {
            logCommand = type === 'nginx-access' ? 'sudo tail -n 50 /var/log/nginx/access.log' : 'sudo tail -n 50 /var/log/nginx/error.log';
        } else {
            const appName = type === 'panel-ui' ? 'mikrotik-manager' : 'mikrotik-api-backend';
            logCommand = `sudo pm2 logs ${appName} --lines 50 --nostream --raw`;
        }

        exec(logCommand, (error, stdout, stderr) => {
            if (error) {
               return res.send(`Error reading logs: ${error.message}\n${stderr}`);
            }
            res.send(stdout || 'No logs found.');
        });
    });

    // --- Database Backups ---
    app.get('/api/list-backups', protect, requireSuperadmin, async (req, res) => {
        try {
            const files = await fs.promises.readdir(BACKUP_DIR);
            res.json(files.filter(f => f.endsWith('.db')));
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    app.get('/api/create-backup', protect, requireSuperadmin, async (req, res) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `panel_backup_${timestamp}.db`;
        const backupPath = path.join(BACKUP_DIR, backupName);
        
        try {
            await fs.promises.copyFile(DB_PATH, backupPath);
            res.json({ message: 'Backup created successfully' });
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });
    
    app.post('/api/delete-backup', protect, requireSuperadmin, async (req, res) => {
        try {
            const { backupFile } = req.body;
            if (!backupFile) return res.status(400).json({ message: 'Filename required' });
            const filePath = path.join(BACKUP_DIR, backupFile);
            if (!filePath.startsWith(BACKUP_DIR)) return res.status(403).json({ message: 'Invalid path' });
            
            await fs.promises.unlink(filePath);
            res.json({ message: 'Deleted' });
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    app.get('/api/update-status', protect, (req, res) => {
        res.json({ status: 'uptodate', message: 'System is up to date (mock).' });
    });
    
    // --- REMOTE ACCESS ENDPOINTS (ZeroTier, PiTunnel, Ngrok, Dataplicity) ---
    // Helper function to execute shell commands
    const runCommand = (cmd) => new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) reject({ error, stderr, stdout });
            else resolve(stdout.trim());
        });
    });

    // ZeroTier
    app.get('/api/zt/status', protect, async (req, res) => {
        try {
            try {
                await runCommand('which zerotier-cli');
            } catch (e) {
                throw { code: 'ZEROTIER_NOT_INSTALLED', message: 'ZeroTier is not installed' };
            }

            // Run info and listnetworks with sudo
            const infoRaw = await runCommand('sudo zerotier-cli info -j').catch(e => {
                if (e.stderr.includes('sudo')) throw { code: 'SUDO_PASSWORD_REQUIRED' };
                throw e;
            });
            const networksRaw = await runCommand('sudo zerotier-cli listnetworks -j');

            const info = JSON.parse(infoRaw);
            const networks = JSON.parse(networksRaw);

            res.json({ info, networks });
        } catch (error) {
            if (error.code === 'ZEROTIER_NOT_INSTALLED') {
                res.json({ info: { online: false, version: '0.0.0', address: 'not_installed' }, networks: [], error: 'NOT_INSTALLED' });
            } else if (error.code === 'SUDO_PASSWORD_REQUIRED') {
                 res.status(500).json({ code: 'SUDO_PASSWORD_REQUIRED', message: 'Sudo access required' });
            } else {
                 console.error("ZeroTier Error:", error);
                 res.json({ info: { online: false, version: '0.0.0', address: 'error' }, networks: [], error: error.message || 'Unknown error' });
            }
        }
    });

    app.post('/api/zt/join', protect, async (req, res) => {
        const { networkId } = req.body;
        try {
            const output = await runCommand(`sudo zerotier-cli join ${networkId}`);
            res.json({ message: output });
        } catch (e) {
            res.status(500).json({ message: e.stderr || e.message });
        }
    });

    app.post('/api/zt/leave', protect, async (req, res) => {
        const { networkId } = req.body;
        try {
            const output = await runCommand(`sudo zerotier-cli leave ${networkId}`);
            res.json({ message: output });
        } catch (e) {
            res.status(500).json({ message: e.stderr || e.message });
        }
    });

    // PiTunnel
    app.get('/api/pitunnel/status', protect, async (req, res) => {
        try {
            const isActive = await runCommand('systemctl is-active pitunnel').then(o => o === 'active').catch(() => false);
            const isInstalled = await runCommand('which pitunnel').then(() => true).catch(() => false);
            
            res.json({ installed: isInstalled, active: isActive, url: isInstalled ? 'https://pitunnel.com/dashboard' : undefined });
        } catch (e) {
             res.json({ installed: false, active: false });
        }
    });

    // Ngrok
    app.get('/api/ngrok/status', protect, async (req, res) => {
        try {
             // Check if running
            const isRunning = await runCommand('pgrep ngrok').then(() => true).catch(() => false);
            const isInstalled = await runCommand('which ngrok').then(() => true).catch(() => false);
            
            // Attempt to get tunnel URL from local API if running
            let url = null;
            if (isRunning) {
                try {
                    const tunnels = await axios.get('http://127.0.0.1:4040/api/tunnels');
                    url = tunnels.data.tunnels?.[0]?.public_url;
                } catch (e) { /* ignore */ }
            }
            
            // Load saved config if exists
            const configPath = path.join(__dirname, 'ngrok-config.json');
            let config = {};
            if (fs.existsSync(configPath)) {
                 config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            }

            res.json({ installed: isInstalled, active: isRunning, url, config });
        } catch (e) {
            res.json({ installed: false, active: false });
        }
    });
    
    app.post('/api/ngrok/settings', protect, async (req, res) => {
        try {
            const configPath = path.join(__dirname, 'ngrok-config.json');
            fs.writeFileSync(configPath, JSON.stringify(req.body, null, 2));
            res.json({ message: 'Settings saved' });
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    // Dataplicity
    app.get('/api/dataplicity/status', protect, async (req, res) => {
        try {
             // Check for dataplicity agent process
            const isRunning = await runCommand('pgrep -f dataplicity').then(() => true).catch(() => false);
            const isInstalled = fs.existsSync('/opt/dataplicity');
            res.json({ installed: isInstalled, active: isRunning });
        } catch (e) {
             res.json({ installed: false });
        }
    });
    
    // Telegram Test
    app.post('/api/telegram/test', protect, async (req, res) => {
        const { botToken, chatId } = req.body;
        try {
            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                chat_id: chatId,
                text: "🔔 Test message from Mikrotik Manager Panel."
            });
            res.json({ success: true, message: 'Message sent successfully!' });
        } catch (err) {
            res.status(400).json({ error: err.response?.data?.description || err.message });
        }
    });

    // --- Super Admin & Full Panel Backups ---
    const superRouter = express.Router();
    superRouter.use(protect, requireSuperadmin);
    
    superRouter.get('/list-full-backups', async (req, res) => {
        try {
            const files = await fs.promises.readdir(BACKUP_DIR);
            res.json(files.filter(f => f.endsWith('.mk')));
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });
    
    app.use('/api/superadmin', superRouter);

    // --- SPECIAL STATS ENDPOINT FOR DASHBOARD ---
    app.get('/mt-api/:routerId/interface/stats', getRouterConfig, async (req, res) => {
        await handleApiRequest(req, res, async () => {
            if (req.routerConfig.api_type === 'legacy') {
                const client = req.routerInstance;
                await client.connect();
                try {
                    // For Legacy API, 'detail' is for configuration, 'stats' is for counters.
                    // Often stats-detail combines them or print simply with both arguments works.
                    // We use ['/interface/print', 'stats', 'detail'] to be safe and comprehensive.
                    // 'without-paging' prevents large lists from getting stuck.
                    const result = await writeLegacySafe(client, ['/interface/print', 'stats', 'detail', 'without-paging']);
                    return result.map(normalizeLegacyObject);
                } finally {
                    await client.close();
                }
            } else {
                // For REST API (v7+), sending boolean flags 'stats' and 'detail' ensures we get full data.
                const response = await req.routerInstance.post('/interface/print', { 'stats': true, 'detail': true });
                return response.data;
            }
        });
    });

    // --- VITE MIDDLEWARE (The Critical Fix) ---
    // Ensure this comes AFTER API routes but BEFORE the catch-all handler.
    app.use(vite.middlewares);

    app.listen(PORT, () => {
        console.log(`✅ Mikrotik Manager UI running on http://localhost:${PORT}`);
        console.log(`   Mode: Development (Vite Middleware Active)`);
    });
}

// Helper middleware for router config
const routerConfigCache = new Map();
const getRouterConfig = async (req, res, next) => {
    const routerId = req.params.routerId || req.body.id;
    const authHeader = req.headers.authorization;

    if (routerConfigCache.has(routerId)) {
        req.routerConfig = routerConfigCache.get(routerId);
        req.routerInstance = createRouterInstance(req.routerConfig);
        return next();
    }
    try {
        const rows = await db.all('SELECT * FROM routers');
        const config = rows.find(r => r.id === routerId);
        
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

// Router Instance Factory
const createRouterInstance = (config) => {
    if (!config || !config.host || !config.user) {
        throw new Error('Invalid router configuration: host and user are required.');
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

const handleApiRequest = async (req, res, action) => {
    try {
        const result = await action();
        if (result === '') res.status(204).send();
        else res.json(result);
    } catch (error) {
        if (error.isAxiosError && error.response) {
             res.status(error.response.status).json({ message: error.response.data.message || error.message });
        } else {
             res.status(500).json({ message: error.message });
        }
    }
};

const writeLegacySafe = async (client, query) => {
    try {
        return await client.write(query);
    } catch (error) {
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

startServer();
