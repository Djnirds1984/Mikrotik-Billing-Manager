
const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const os = require('os');
const crypto = require('crypto');
const axios = require('axios');
const https = require('https');
const { Xendit } = require('xendit-node');
const si = require('systeminformation');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// const { RouterOSAPI } = require('node-routeros-v2'); // Not needed here anymore

const PORT = 3001;
const DB_PATH = path.join(__dirname, 'panel.db');
const SUPERADMIN_DB_PATH = path.join(__dirname, 'superadmin.db');
const BACKUP_DIR = path.join(__dirname, 'backups');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const APPLICATIONS_UPLOADS_DIR = path.join(UPLOADS_DIR, 'applications');
const SECRET_KEY = process.env.JWT_SECRET || 'a-very-weak-secret-key-for-dev-only';
const LICENSE_SECRET_KEY = process.env.LICENSE_SECRET || 'a-long-and-very-secret-string-for-licenses-!@#$%^&*()';

// Ensure backup dir exists
if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(APPLICATIONS_UPLOADS_DIR)) {
    fs.mkdirSync(APPLICATIONS_UPLOADS_DIR, { recursive: true });
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
            const defaultPassword = 'Akoangnagwagi84%';
            const hashedPassword = await bcrypt.hash(defaultPassword, 10);
            await superadminDb.run('INSERT INTO superadmin (username, password) VALUES (?, ?)', 'superadmin', hashedPassword);
            console.log('Superadmin user created with default secured password.');
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
                notificationSettings TEXT,
                landingPageConfig TEXT
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
        if (!columnNames.includes('landingPageConfig')) await db.exec("ALTER TABLE settings ADD COLUMN landingPageConfig TEXT");

        // Hotfix: ensure chat notifications route to Captive Chat in Admin
        try {
            await db.exec("UPDATE notifications SET link_to='captive_chat' WHERE type IN ('client-chat','admin-reply') AND (link_to IS NULL OR link_to <> 'captive_chat')");
        } catch (_) {}

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

        // Ensure sidebar/view permissions exist (idempotent)
        const sidebarPerms = [
            { id: 'perm_sidebar_dashboard', name: 'view:sidebar:dashboard', description: 'View Dashboard' },
            { id: 'perm_sidebar_notifications', name: 'view:sidebar:notifications', description: 'View Notifications' },
            { id: 'perm_sidebar_captive_chat', name: 'view:sidebar:captive_chat', description: 'View Captive Chat' },
            { id: 'perm_sidebar_application_form', name: 'view:sidebar:application_form', description: 'View Application Form' },
            { id: 'perm_sidebar_scripting', name: 'view:sidebar:scripting', description: 'View AI Scripting' },
            { id: 'perm_sidebar_terminal', name: 'view:sidebar:terminal', description: 'View Terminal' },
            { id: 'perm_sidebar_routers', name: 'view:sidebar:routers', description: 'View Routers' },
            { id: 'perm_sidebar_network', name: 'view:sidebar:network', description: 'View Network' },
            { id: 'perm_sidebar_dhcp_portal', name: 'view:sidebar:dhcp-portal', description: 'View DHCP Portal' },
            { id: 'perm_sidebar_pppoe', name: 'view:sidebar:pppoe', description: 'View PPPoE Management' },
            { id: 'perm_sidebar_billing', name: 'view:sidebar:billing', description: 'View Billing Plans' },
            { id: 'perm_sidebar_sales', name: 'view:sidebar:sales', description: 'View Sales Report' },
            { id: 'perm_sidebar_inventory', name: 'view:sidebar:inventory', description: 'View Inventory' },
            { id: 'perm_sidebar_payroll', name: 'view:sidebar:payroll', description: 'View Payroll' },
            { id: 'perm_sidebar_hotspot', name: 'view:sidebar:hotspot', description: 'View Hotspot' },
            { id: 'perm_sidebar_remote', name: 'view:sidebar:remote', description: 'View Remote Access' },
            { id: 'perm_sidebar_mikrotik_files', name: 'view:sidebar:mikrotik_files', description: 'View Mikrotik Files' },
            { id: 'perm_sidebar_company', name: 'view:sidebar:company', description: 'View Company Settings' },
            { id: 'perm_sidebar_system', name: 'view:sidebar:system', description: 'View System Settings' },
            { id: 'perm_sidebar_panel_roles', name: 'view:sidebar:panel_roles', description: 'View Panel Roles' },
            { id: 'perm_sidebar_client_portal_users', name: 'view:sidebar:client_portal_users', description: 'View Client Users' },
            { id: 'perm_sidebar_updater', name: 'view:sidebar:updater', description: 'View Updater' },
            { id: 'perm_sidebar_logs', name: 'view:sidebar:logs', description: 'View System Logs' },
            { id: 'perm_sidebar_license', name: 'view:sidebar:license', description: 'View License Page' },
            { id: 'perm_sidebar_super_admin', name: 'view:sidebar:super_admin', description: 'View Super Admin' }
        ];
        for (const p of sidebarPerms) {
            await db.run("INSERT OR IGNORE INTO permissions (id, name, description) VALUES (?, ?, ?)", p.id, p.name, p.description);
        }

        // Business Data Tables
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
                clientEmail TEXT,
                invoiceId TEXT
            );
            CREATE TABLE IF NOT EXISTS client_invoices (
                id TEXT PRIMARY KEY,
                routerId TEXT,
                username TEXT,
                accountNumber TEXT,
                source TEXT, -- 'pppoe' | 'dhcp'
                planName TEXT,
                planId TEXT,
                amount REAL,
                currency TEXT,
                dueDateTime TEXT,
                issueDate TEXT,
                status TEXT DEFAULT 'PENDING' -- PENDING | PAID | EXPIRED | CANCELED
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
            CREATE TABLE IF NOT EXISTS client_users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                router_id TEXT,
                pppoe_username TEXT,
                created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS applications (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT,
                phone TEXT,
                message TEXT,
                planName TEXT,
                pdfPath TEXT,
                createdAt TEXT NOT NULL
            );
        `);
        // Ensure new columns exist (idempotent migrations)
        try {
            const customerCols = await db.all("PRAGMA table_info(customers)");
            const customerColNames = customerCols.map(c => c.name);
            if (!customerColNames.includes('accountNumber')) {
                await db.exec("ALTER TABLE customers ADD COLUMN accountNumber TEXT");
            }
        } catch (_) {}
        try {
            const clientUserCols = await db.all("PRAGMA table_info(client_users)");
            const clientUserColNames = clientUserCols.map(c => c.name);
            if (!clientUserColNames.includes('account_number')) {
                await db.exec("ALTER TABLE client_users ADD COLUMN account_number TEXT");
            }
        } catch (_) {}
        try {
            const dhcpClientCols = await db.all("PRAGMA table_info(dhcp_clients)");
            const dhcpClientColNames = dhcpClientCols.map(c => c.name);
            if (!dhcpClientColNames.includes('accountNumber')) {
                await db.exec("ALTER TABLE dhcp_clients ADD COLUMN accountNumber TEXT");
            }
        } catch (_) {}
        try {
            const salesCols = await db.all("PRAGMA table_info(sales_records)");
            const salesColNames = salesCols.map(c => c.name);
            if (!salesColNames.includes('invoiceId')) {
                await db.exec("ALTER TABLE sales_records ADD COLUMN invoiceId TEXT");
            }
        } catch (_) {}
        console.log('Database initialized successfully');
    } catch (err) {
        console.error('Failed to initialize database:', err);
        throw err;
    }
}

// --- Helpers ---
const getDeviceId = async () => {
    try {
        const sys = await si.system();
        const uuid = await si.uuid();
        
        // Prioritize System Serial (Host Board Serial) if valid
        if (sys.serial && sys.serial !== '-' && sys.serial !== 'Default string' && sys.serial !== 'To be filled by O.E.M.') {
             return crypto.createHash('sha256').update(sys.serial).digest('hex');
        }

        // Fallback to Hardware UUID
        if (uuid.hardware && uuid.hardware !== '-') {
            return crypto.createHash('sha256').update(uuid.hardware).digest('hex');
        }

        // Fallback to OS UUID (Windows MachineGuid / Linux machine-id)
        if (uuid.os && uuid.os !== '-') {
            return crypto.createHash('sha256').update(uuid.os).digest('hex');
        }

        // Final Fallback: MAC Addresses
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

    } catch (e) {
        console.error('Failed to get device ID:', e);
        // Fallback to hostname if everything fails
        return crypto.createHash('sha256').update(os.hostname()).digest('hex');
    }
};

const generateAccountNumber = async () => {
    try {
        const rows = await db.all(`
            SELECT accountNumber AS n FROM customers WHERE accountNumber IS NOT NULL AND accountNumber <> ''
            UNION ALL
            SELECT account_number AS n FROM client_users WHERE account_number IS NOT NULL AND account_number <> ''
            UNION ALL
            SELECT accountNumber AS n FROM dhcp_clients WHERE accountNumber IS NOT NULL AND accountNumber <> ''
        `);
        const extractNum = (s) => {
            const m = String(s || '').match(/(\d+)\s*$/);
            return m ? parseInt(m[1], 10) : 0;
        };
        const maxNum = rows.reduce((max, r) => Math.max(max, extractNum(r.n)), 0);
        const next = maxNum + 1;
        const padded = String(next).padStart(6, '0');
        return `ACC-${padded}`;
    } catch (e) {
        const fallback = String(Date.now()).slice(-6);
        return `ACC-${fallback}`;
    }
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

    // --- DEV PROXY MIDDLEWARE FOR API BACKEND ---
    // This allows npm start (without Nginx) to still reach the backend API
    // If Nginx is used, Nginx handles this routing.
    const { createProxyMiddleware } = await import('http-proxy-middleware');
    app.use('/mt-api', createProxyMiddleware({
        target: 'http://localhost:3002',
        changeOrigin: true,
        pathRewrite: {
            // Nginx config strips /mt-api/ so we do the same here for consistency
            '^/mt-api': ''
        }
    }));
    app.use('/ws', createProxyMiddleware({
        target: 'http://localhost:3002',
        changeOrigin: true,
        ws: true
    }));

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
                if (table === 'dhcp_clients') {
                    if (!req.body.accountNumber || String(req.body.accountNumber).trim() === '') {
                        req.body.accountNumber = await generateAccountNumber();
                    }
                }
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
                if (table === 'dhcp_clients') {
                    if (!req.body.accountNumber || String(req.body.accountNumber).trim() === '') {
                        const current = await db.get('SELECT accountNumber FROM dhcp_clients WHERE id = ?', [id]);
                        if (!current?.accountNumber) {
                            req.body.accountNumber = await generateAccountNumber();
                        }
                    }
                }
                if (table === 'client_invoices') {
                    const existing = await db.get('SELECT * FROM client_invoices WHERE id = ?', [id]);
                    const newStatus = req.body.status ? String(req.body.status) : existing?.status;
                    if (existing && existing.status !== 'PAID' && newStatus === 'PAID') {
                        const already = await db.get('SELECT id FROM sales_records WHERE invoiceId = ?', [id]);
                        if (!already) {
                            const router = await db.get('SELECT name FROM routers WHERE id = ?', [existing.routerId]);
                            const saleId = `sale_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
                            await db.run(
                                `INSERT INTO sales_records (id, routerId, date, clientName, planName, planPrice, discountAmount, finalAmount, routerName, currency, clientAddress, clientContact, clientEmail, invoiceId)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                [
                                    saleId,
                                    existing.routerId,
                                    new Date().toISOString(),
                                    existing.username,
                                    existing.planName || '',
                                    existing.amount || 0,
                                    0,
                                    existing.amount || 0,
                                    router?.name || '',
                                    existing.currency || 'PHP',
                                    null, null, null,
                                    existing.id
                                ]
                            );
                        }
                    }
                }
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
    // Customers handled manually for upsert
    // createCrud('/customers', 'customers');
    createCrud('/routers', 'routers');
    createCrud('/employee-benefits', 'employee_benefits');
    createCrud('/time-records', 'time_records');
    createCrud('/dhcp-billing-plans', 'dhcp_billing_plans');
    createCrud('/dhcp_clients', 'dhcp_clients');
    createCrud('/client-invoices', 'client_invoices');
    createCrud('/sales', 'sales_records');
    createCrud('/applications', 'applications');

    // Customers API (Manual Upsert)
    dbRouter.get('/customers', async (req, res) => {
        try {
            const { routerId } = req.query;
            let query = `SELECT * FROM customers`;
            let params = [];
            if (routerId) {
                query += ` WHERE routerId = ?`;
                params.push(routerId);
            }
            const rows = await db.all(query, params);
            res.json(rows);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    dbRouter.post('/customers', async (req, res) => {
        try {
            const { username } = req.body;
            if (!username) return res.status(400).json({ message: 'Username required' });

            // Check existence
            const existing = await db.get('SELECT * FROM customers WHERE username = ?', [username]);
            
            if (existing) {
                // Update existing
                const keys = Object.keys(req.body).filter(k => k !== 'id' && k !== 'username'); // don't update id or username
                const values = keys.map(k => req.body[k]);
                if (keys.length > 0) {
                    const setClause = keys.map(k => `${k} = ?`).join(',');
                    await db.run(`UPDATE customers SET ${setClause} WHERE id = ?`, [...values, existing.id]);
                }
                res.json({ message: 'Updated existing customer', id: existing.id });
            } else {
                // Insert new
                if (!req.body.accountNumber || String(req.body.accountNumber).trim() === '') {
                    req.body.accountNumber = await generateAccountNumber();
                }
                const keys = Object.keys(req.body);
                const values = Object.values(req.body);
                const placeholders = keys.map(() => '?').join(',');
                await db.run(`INSERT INTO customers (${keys.join(',')}) VALUES (${placeholders})`, values);
                res.json({ message: 'Created new customer' });
            }
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    dbRouter.patch('/customers/:id', async (req, res) => {
        try {
            const { id } = req.params;
            if (!req.body.accountNumber || String(req.body.accountNumber).trim() === '') {
                const current = await db.get('SELECT accountNumber FROM customers WHERE id = ?', [id]);
                if (!current?.accountNumber) {
                    req.body.accountNumber = await generateAccountNumber();
                }
            }
            const updates = Object.keys(req.body).map(k => `${k} = ?`).join(',');
            const values = [...Object.values(req.body), id];
            await db.run(`UPDATE customers SET ${updates} WHERE id = ?`, values);
            res.json({ message: 'Updated' });
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    dbRouter.delete('/customers/:id', async (req, res) => {
        try {
            await db.run(`DELETE FROM customers WHERE id = ?`, req.params.id);
            res.json({ message: 'Deleted' });
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // Special handling for settings
    dbRouter.get('/panel-settings', async (req, res) => {
        try {
            const s = await db.get('SELECT * FROM settings WHERE id = 1');
            if(s) {
                try { s.telegramSettings = JSON.parse(s.telegramSettings); } catch(e) {}
                try { s.xenditSettings = JSON.parse(s.xenditSettings); } catch(e) {}
                try { s.notificationSettings = JSON.parse(s.notificationSettings); } catch(e) {}
                try { s.landingPageConfig = JSON.parse(s.landingPageConfig); } catch(e) {}
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
            if (data.landingPageConfig) data.landingPageConfig = JSON.stringify(data.landingPageConfig);
            
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

    app.get('/api/public/landing-page', async (req, res) => {
        try {
            const s = await db.get('SELECT companyName, logoBase64, landingPageConfig FROM settings WHERE id = 1');
            let cfg = {};
            try { cfg = JSON.parse(s?.landingPageConfig || '{}'); } catch (_) {}
            res.json({
                company: { companyName: s?.companyName || '', logoBase64: s?.logoBase64 || '' },
                config: cfg
            });
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });
    
    app.use('/uploads', express.static(UPLOADS_DIR));
    
    app.get('/api/public/routers', async (req, res) => {
        try {
            const rows = await db.all('SELECT id, name FROM routers ORDER BY name ASC');
            res.json(rows);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });
    
    app.get('/api/public/ppp/status', async (req, res) => {
        try {
            const { routerId, username } = req.query;
            if (!routerId || !username) return res.status(400).json({ message: 'routerId and username are required' });
            const encUser = encodeURIComponent(String(username));
            const secretResp = await axios.get(`http://localhost:3002/${routerId}/ppp/secret?name=${encUser}`);
            const secrets = Array.isArray(secretResp.data) ? secretResp.data : [];
            const secret = secrets[0] || null;
            let active = false;
            try {
                const activeResp = await axios.get(`http://localhost:3002/${routerId}/ppp/active/print`);
                const allActive = Array.isArray(activeResp.data) ? activeResp.data : [];
                active = !!allActive.find(a => a.name === username);
            } catch (_) {}
            let profile = secret?.profile || '';
            let due = '';
            let comment = secret?.comment || '';
            try {
                const c = JSON.parse(comment || '{}');
                profile = c.plan || profile || '';
                due = c.dueDateTime || c.dueDate || '';
            } catch (_) {}
            res.json({ profile, active, comment: due || comment || '' });
        } catch (e) {
            const status = e.response ? e.response.status : 500;
            const msg = e.response?.data?.message || e.message;
            res.status(status).json({ message: msg });
        }
    });
    
    app.get('/api/public/client/payments', async (req, res) => {
        try {
            const { routerId, username } = req.query;
            if (!routerId || !username) return res.status(400).json({ message: 'routerId and username are required' });
            const sales = await db.all('SELECT date, clientName, planName, planPrice, discountAmount, finalAmount, currency FROM sales_records WHERE routerId = ? ORDER BY date DESC LIMIT 50', [routerId]);
            const cust = await db.get('SELECT fullName FROM customers WHERE routerId = ? AND username = ?', [routerId, username]);
            const fullName = cust?.fullName || '';
            const filtered = sales.filter(s => (String(s.clientName || '').toLowerCase() === String(username).toLowerCase()) || (fullName && String(s.clientName || '').toLowerCase() === String(fullName).toLowerCase()));
            res.json(filtered);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });
    
    app.get('/api/public/client/invoices', async (req, res) => {
        try {
            const { routerId, username } = req.query;
            if (!routerId || !username) return res.status(400).json({ message: 'routerId and username are required' });
            const rows = await db.all('SELECT id, planName, amount, currency, dueDateTime, issueDate, status FROM client_invoices WHERE routerId = ? AND username = ? ORDER BY issueDate DESC', [routerId, username]);
            res.json(rows);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });
    
    app.post('/api/public/inquiry', express.json(), async (req, res) => {
        try {
            const { name, email, phone, message, planName } = req.body || {};
            if (!name || !String(name).trim()) return res.status(400).json({ message: 'Name is required.' });
            const id = `app_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
            const createdAt = new Date().toISOString();
            const pdfFile = `${id}.pdf`;
            const pdfPath = path.join(APPLICATIONS_UPLOADS_DIR, pdfFile);
            
            const doc = await PDFDocument.create();
            const font = await doc.embedFont(StandardFonts.Helvetica);
            const page = doc.addPage([595.28, 841.89]);
            const drawText = (text, x, y, size = 12) => {
                page.drawText(String(text || ''), { x, y, size, font, color: rgb(0, 0, 0) });
            };
            drawText('Inquiry Application', 50, 800, 20);
            drawText(`Date: ${new Date(createdAt).toLocaleString()}`, 50, 780, 12);
            drawText(`Name: ${name}`, 50, 750);
            drawText(`Email: ${email || ''}`, 50, 730);
            drawText(`Phone: ${phone || ''}`, 50, 710);
            drawText(`Plan: ${planName || ''}`, 50, 690);
            drawText('Message:', 50, 670);
            const msg = String(message || '');
            const maxWidth = 480;
            let y = 650;
            const words = msg.split(/\s+/);
            let line = '';
            for (const w of words) {
                const test = line ? `${line} ${w}` : w;
                const width = font.widthOfTextAtSize(test, 12);
                if (width > maxWidth) {
                    drawText(line, 50, y);
                    y -= 18;
                    line = w;
                } else {
                    line = test;
                }
            }
            if (line) drawText(line, 50, y);
            const pdfBytes = await doc.save();
            await fs.promises.writeFile(pdfPath, pdfBytes);
            
            await db.run(
                `INSERT INTO applications (id, name, email, phone, message, planName, pdfPath, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, String(name).trim(), email || '', phone || '', msg, planName || '', `/uploads/applications/${pdfFile}`, createdAt]
            );
            res.status(201).json({ message: 'Inquiry received.', id, pdfUrl: `/uploads/applications/${pdfFile}` });
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    const parseDue = (comment) => {
        try {
            const c = JSON.parse(String(comment || '{}'));
            if (c.dueDateTime) return new Date(c.dueDateTime);
            if (c.dueDate) return new Date(`${c.dueDate}T23:59:59`);
        } catch (_) {}
        return null;
    };
    const getPlanPricing = async (routerId, planName, planId) => {
        let row = null;
        if (planId) row = await db.get('SELECT price, currency, name FROM billing_plans WHERE id = ? AND routerId = ?', [planId, routerId]);
        if (!row && planName) row = await db.get('SELECT price, currency, name FROM billing_plans WHERE name = ? AND routerId = ?', [planName, routerId]);
        return row ? { amount: row.price, currency: row.currency || 'PHP', planName: row.name } : { amount: 0, currency: 'PHP', planName: planName || '' };
    };
    const ensureInvoice = async ({ routerId, username, accountNumber, source, planName, planId, dueDate }) => {
        if (!dueDate) return;
        const genTime = new Date(dueDate.getTime() - 3 * 24 * 60 * 60 * 1000);
        if (Date.now() < genTime.getTime()) return;
        const existing = await db.get('SELECT id FROM client_invoices WHERE routerId = ? AND username = ? AND dueDateTime = ?', [routerId, username, dueDate.toISOString()]);
        if (existing) return;
        const { amount, currency, planName: resolvedName } = await getPlanPricing(routerId, planName, planId);
        const id = `inv_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        await db.run(
            'INSERT INTO client_invoices (id, routerId, username, accountNumber, source, planName, planId, amount, currency, dueDateTime, issueDate, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            [id, routerId, username, accountNumber || null, source, resolvedName || planName || '', planId || null, amount, currency, dueDate.toISOString(), new Date().toISOString(), 'PENDING']
        );
    };
    const runAutoInvoiceJob = async () => {
        try {
            const routers = await db.all('SELECT id, name FROM routers');
            for (const r of routers) {
                // PPPoE users via client_users
                const users = await db.all('SELECT username, pppoe_username, router_id, account_number FROM client_users WHERE router_id = ?', [r.id]);
                for (const u of users) {
                    const pppuser = u.pppoe_username || u.username;
                    try {
                        const encName = encodeURIComponent(pppuser);
                        const sec = await axios.get(`http://localhost:3002/${r.id}/ppp/secret?name=${encName}`);
                        const s = Array.isArray(sec.data) && sec.data.length > 0 ? sec.data[0] : null;
                        if (s) {
                            let planName = '';
                            let planId = '';
                            let due = parseDue(s.comment);
                            try {
                                const c = JSON.parse(String(s.comment || '{}'));
                                planName = c.planName || c.plan || '';
                                planId = c.planId || '';
                            } catch (_) {}
                            await ensureInvoice({ routerId: r.id, username: pppuser, accountNumber: u.account_number, source: 'pppoe', planName, planId, dueDate: due });
                        }
                    } catch (_) {}
                }
                // DHCP clients (best-effort)
                try {
                    const leases = await axios.get(`http://localhost:3002/${r.id}/ip/dhcp-server/lease/print`);
                    const list = Array.isArray(leases.data) ? leases.data : [];
                    for (const l of list) {
                        const due = parseDue(l.comment) || (l.timeout ? new Date(Date.now() + 0) : null); // timeout not exact date
                        const cname = l.hostName || l.customerInfo || l.macAddress;
                        await ensureInvoice({ routerId: r.id, username: String(cname || '').toLowerCase(), accountNumber: null, source: 'dhcp', planName: '', planId: '', dueDate: due });
                    }
                } catch (_) {}
            }
        } catch (e) {
            console.warn('Auto-invoice job failed:', e.message);
        }
    };
    setInterval(runAutoInvoiceJob, 60 * 60 * 1000); // hourly
    // --- Captive Chat Endpoints ---
    app.post('/api/captive-message', async (req, res) => {
        try {
            const { message, name, address, account, channel } = req.body || {};
            let clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '').trim();
            if (clientIp.includes(',')) clientIp = clientIp.split(',')[0].trim();
            clientIp = clientIp.replace('::ffff:', '').replace(/^::1$/, '127.0.0.1');
            if (!message || !message.trim()) {
                return res.status(400).json({ message: 'Message content is required.' });
            }
            const notif = {
                id: `notif_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
                type: 'client-chat',
                message: message.trim(),
                is_read: 0,
                timestamp: new Date().toISOString(),
                link_to: 'captive_chat',
                context_json: JSON.stringify({
                    ip: clientIp,
                    name: name || undefined,
                    address: address || undefined,
                    account: account || undefined,
                    channel: channel === 'complaint' ? 'complaint' : 'inquiry'
                })
            };
            await db.run(
                'INSERT INTO notifications (id, type, message, is_read, timestamp, link_to, context_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
                notif.id, notif.type, notif.message, notif.is_read, notif.timestamp, notif.link_to, notif.context_json
            );
            res.status(201).json({ message: 'Message sent successfully.' });
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    app.post('/api/public/chat-start', async (req, res) => {
        try {
            const { name, address, account, channel } = req.body || {};
            let clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '').trim();
            if (clientIp.includes(',')) clientIp = clientIp.split(',')[0].trim();
            clientIp = clientIp.replace('::ffff:', '').replace(/^::1$/, '127.0.0.1');
            const label = channel === 'complaint' ? 'complaint' : 'inquiry';
            const notif = {
                id: `notif_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
                type: 'client-chat',
                message: `Chat started (${label})`,
                is_read: 0,
                timestamp: new Date().toISOString(),
                link_to: 'captive_chat',
                context_json: JSON.stringify({
                    ip: clientIp,
                    name: String(name || '').trim() || undefined,
                    address: String(address || '').trim() || undefined,
                    account: String(account || '').trim() || undefined,
                    channel: label
                })
            };
            await db.run(
                'INSERT INTO notifications (id, type, message, is_read, timestamp, link_to, context_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
                notif.id, notif.type, notif.message, notif.is_read, notif.timestamp, notif.link_to, notif.context_json
            );
            res.status(201).json({ message: 'Chat session initialized.' });
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    app.get('/api/captive-thread', async (req, res) => {
        try {
            const ipParam = String(req.query.ip || '').trim();
            let clientIp = ipParam || String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '').trim();
            if (clientIp.includes(',')) clientIp = clientIp.split(',')[0].trim();
            clientIp = clientIp.replace('::ffff:', '').replace(/^::1$/, '127.0.0.1');
            const rows = await db.all('SELECT * FROM notifications WHERE type IN ("client-chat","admin-reply") ORDER BY timestamp ASC');
            const thread = rows.filter(r => {
                try {
                    const ctx = JSON.parse(r.context_json || '{}');
                    return ctx.ip === clientIp;
                } catch (_) { return false; }
            });
            res.json(thread);
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    app.post('/api/captive-reply', protect, async (req, res) => {
        try {
            const { ip, message } = req.body;
            const targetIp = String(ip || '').trim();
            if (!targetIp) return res.status(400).json({ message: 'ip is required' });
            if (!message || !message.trim()) return res.status(400).json({ message: 'message is required' });
            const notif = {
                id: `notif_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
                type: 'admin-reply',
                message: message.trim(),
                is_read: 0,
                timestamp: new Date().toISOString(),
                link_to: 'captive_chat',
                context_json: JSON.stringify({ ip: targetIp, by: req.user?.username || 'admin' })
            };
            await db.run(
                'INSERT INTO notifications (id, type, message, is_read, timestamp, link_to, context_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
                notif.id, notif.type, notif.message, notif.is_read, notif.timestamp, notif.link_to, notif.context_json
            );
            res.status(201).json({ message: 'Reply sent.' });
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

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

    // Landing Page Advertising Image Downloader
    app.post('/api/landing/ad-image-download', protect, async (req, res) => {
        try {
            const { url } = req.body || {};
            if (!url || typeof url !== 'string') return res.status(400).json({ message: 'Image URL is required.' });
            const resp = await axios.get(url, { responseType: 'arraybuffer' }).catch(e => {
                throw new Error(`Failed to download image: ${e.message}`);
            });
            const ct = resp.headers['content-type'] || '';
            if (!ct.startsWith('image/')) return res.status(400).json({ message: 'URL must return an image.' });
            const base64 = Buffer.from(resp.data, 'binary').toString('base64');
            const dataUrl = `data:${ct};base64,${base64}`;
            const s = await db.get('SELECT landingPageConfig FROM settings WHERE id = 1');
            let cfg = {};
            try { cfg = JSON.parse(s?.landingPageConfig || '{}'); } catch (_) {}
            cfg.adImageBase64 = dataUrl;
            await db.run('UPDATE settings SET landingPageConfig = ? WHERE id = 1', JSON.stringify(cfg));
            res.json({ message: 'Image saved', adImageBase64: dataUrl });
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });


    // --- Client Portal Endpoints ---
    const clientPortalRouter = express.Router();
    
    // Admin: Create Client User (Protected)
    clientPortalRouter.post('/users', protect, async (req, res) => {
        const { username, password, routerId, pppoeUsername, accountNumber } = req.body;
        if (!username || !password) return res.status(400).json({ message: 'Username and password required' });
        try {
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
            const id = `u_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const acc = accountNumber && String(accountNumber).trim() !== '' ? accountNumber : await generateAccountNumber();
            await db.run('INSERT INTO client_users (id, username, password_hash, salt, router_id, pppoe_username, account_number, created_at) VALUES (?,?,?,?,?,?,?,?)',
                [id, username, hash, salt, routerId, pppoeUsername, acc, new Date().toISOString()]);
            res.json({ message: 'User created', id });
        } catch (e) {
            if (e.message.includes('UNIQUE constraint failed')) return res.status(409).json({ message: 'Username already exists' });
            res.status(500).json({ message: e.message });
        }
    });

    // Admin: List Client Users (Protected)
    clientPortalRouter.get('/users', protect, async (req, res) => {
        try {
            const users = await db.all('SELECT id, username, router_id, pppoe_username, account_number, created_at FROM client_users ORDER BY created_at DESC');
            res.json(users);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // Admin: Delete Client User (Protected)
    clientPortalRouter.delete('/users/:id', protect, async (req, res) => {
        try {
            await db.run('DELETE FROM client_users WHERE id = ?', [req.params.id]);
            res.json({ message: 'Deleted' });
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    app.use('/api/client-portal', clientPortalRouter);

    // Public Client Login
    app.post('/api/public/client-portal/login', async (req, res) => {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ message: 'Credentials required' });
        try {
            const user = await db.get('SELECT * FROM client_users WHERE username = ?', [username]);
            if (!user) return res.status(401).json({ message: 'Invalid credentials' });
            
            const hash = crypto.pbkdf2Sync(password, user.salt, 1000, 64, 'sha512').toString('hex');
            if (hash !== user.password_hash) return res.status(401).json({ message: 'Invalid credentials' });
            
            let acc = user.account_number;
            if (!acc || String(acc).trim() === '') {
                const cust = await db.get('SELECT accountNumber FROM customers WHERE routerId = ? AND username = ?', [user.router_id, user.pppoe_username || user.username]);
                acc = cust?.accountNumber || '';
                if (!acc) {
                    acc = await generateAccountNumber();
                }
                await db.run('UPDATE client_users SET account_number = ? WHERE id = ?', [acc, user.id]);
                if (cust && (!cust.accountNumber || String(cust.accountNumber).trim() === '')) {
                    await db.run('UPDATE customers SET accountNumber = ? WHERE routerId = ? AND username = ?', [acc, user.router_id, user.pppoe_username || user.username]);
                }
            }
            res.json({
                id: user.id,
                username: user.username,
                routerId: user.router_id,
                pppoeUsername: user.pppoe_username,
                accountNumber: acc
            });
        } catch (e) { res.status(500).json({ message: e.message }); }
    });


    // --- License ---
    const licenseRouter = express.Router();
    licenseRouter.use(protect);
    
    licenseRouter.get('/status', async (req, res) => {
        try {
            const deviceId = await getDeviceId();
            
            // Check local cache first (optional, but good for offline resilience if implemented)
            // For now, we check Supabase directly as requested
            
            const settings = await db.get('SELECT licenseKey FROM settings WHERE id = 1');
            const localLicenseKey = settings?.licenseKey;

            if (!localLicenseKey) {
                return res.json({ licensed: false, deviceId, message: 'No license key found locally.' });
            }

            // Verify with Supabase
            const { data: license, error } = await supabase
                .from('mikrotik_licenses')
                .select('*')
                .eq('license_key', localLicenseKey)
                .maybeSingle();

            if (error || !license) {
                 return res.json({ licensed: false, deviceId, message: 'License key not found in server.' });
            }

            if (license.hardware_id && license.hardware_id !== deviceId) {
                return res.json({ licensed: false, deviceId, message: 'License is bound to another device.' });
            }

            if (!license.is_active) {
                return res.json({ licensed: false, deviceId, message: 'License has been deactivated.' });
            }

            if (license.expires_at && new Date(license.expires_at) < new Date()) {
                return res.json({ licensed: false, deviceId, message: 'License has expired.' });
            }

            // If hardware_id is null, bind it now (first use)
            if (!license.hardware_id) {
                await supabase
                    .from('mikrotik_licenses')
                    .update({ hardware_id: deviceId, activated_at: new Date().toISOString() })
                    .eq('id', license.id);
            }

            // Update last check-in
            await supabase
                .from('mikrotik_licenses')
                .update({ last_check_in: new Date().toISOString() })
                .eq('id', license.id);

            res.json({ 
                licensed: true, 
                expires: license.expires_at, 
                deviceId, 
                licenseKey: localLicenseKey,
                plan: license.plan_type,
                maxRouters: license.max_routers
            });

        } catch (err) { 
            console.error(err);
            res.status(500).json({ message: err.message }); 
        }
    });

    licenseRouter.post('/activate', async (req, res) => {
        const { licenseKey } = req.body;
        if (!licenseKey) return res.status(400).json({ message: 'License key is required' });

        try {
            const deviceId = await getDeviceId();

            // Check Supabase
            const { data: license, error } = await supabase
                .from('mikrotik_licenses')
                .select('*')
                .eq('license_key', licenseKey)
                .maybeSingle();

            if (error || !license) {
                return res.status(404).json({ message: 'Invalid license key.' });
            }

            if (license.hardware_id && license.hardware_id !== deviceId) {
                return res.status(403).json({ message: 'This license is already used on another device.' });
            }

            if (!license.is_active) {
                 return res.status(403).json({ message: 'This license is inactive.' });
            }

             if (license.expires_at && new Date(license.expires_at) < new Date()) {
                return res.status(403).json({ message: 'This license has expired.' });
            }

            // Bind device if not bound
            if (!license.hardware_id) {
                 const { error: updateError } = await supabase
                    .from('mikrotik_licenses')
                    .update({ hardware_id: deviceId, activated_at: new Date().toISOString() })
                    .eq('id', license.id);
                
                if (updateError) throw updateError;
            }

            // Save locally
            await db.run('UPDATE settings SET licenseKey = ? WHERE id = 1', [licenseKey]);
            
            res.json({ success: true, message: 'License activated successfully!' });
        } catch (err) { 
            console.error(err);
            res.status(500).json({ message: err.message }); 
        }
    });

    licenseRouter.post('/revoke', async (req, res) => {
        // Just remove local key, we don't necessarily want to deactivate it on server unless specified
        await db.run('UPDATE settings SET licenseKey = NULL WHERE id = 1');
        res.json({ success: true, message: 'License removed from this device.' });
    });

    licenseRouter.post('/generate', requireSuperadmin, async (req, res) => {
         const { deviceId, days, notes, planType, maxRouters } = req.body; // deviceId is optional (pre-bind), days is validity
         
         try {
             const key = `MKBM-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
             const expiresAt = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() : null;

             const { data, error } = await supabase
                .from('mikrotik_licenses')
                .insert({
                    license_key: key,
                    hardware_id: deviceId || null, // Optional pre-bind
                    expires_at: expiresAt,
                    is_active: true,
                    status: 'active',
                    notes: notes || 'Generated by SuperAdmin',
                    plan_type: planType || 'standard',
                    max_routers: maxRouters || 1,
                    // created_by: req.user.id // Removed to avoid FK violation with local user IDs
                })
                .select()
                .single();

             if (error) throw error;

             res.json({ licenseKey: key, license: data });
         } catch (e) {
             console.error(e);
             res.status(500).json({ message: e.message });
         }
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
            
            let temperature = null;
            try {
                const temp = await si.cpuTemperature();
                if (temp && temp.main !== null && temp.main !== undefined) {
                    temperature = temp.main;
                }
            } catch (err) {
                console.warn("Failed to get CPU temperature", err);
            }
            
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
                },
                temperature,
                uptime: os.uptime() + 's' // Adding uptime as per interface, though not in original response
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

    // --- GitHub Integration Endpoints ---
    
    // Helper function to parse GitHub repository info
    const parseGitHubRepo = (owner, repo) => {
        if (!owner || !repo) {
            throw new Error('Owner and repository name are required');
        }
        // Basic validation for GitHub username/repo format
        if (!/^[a-zA-Z0-9-_.]+$/.test(owner) || !/^[a-zA-Z0-9-_.]+$/.test(repo)) {
            throw new Error('Invalid GitHub repository format');
        }
        return { owner, repo };
    };

    // Get repository information
    app.get('/api/github/repo-info', protect, requireSuperadmin, async (req, res) => {
        try {
            const { owner, repo } = req.query;
            const repoInfo = parseGitHubRepo(owner, repo);
            
            // For now, return mock data - in production, this would call GitHub API
            res.json({
                owner: repoInfo.owner,
                repo: repoInfo.repo,
                description: 'Mikrotik Billing Manager Panel',
                stars: 42,
                forks: 15,
                isPrivate: false,
                defaultBranch: 'main',
                lastUpdated: new Date().toISOString()
            });
        } catch (error) {
            res.status(400).json({ message: error.message });
        }
    });

    // Get repository branches
    app.get('/api/github/branches', protect, requireSuperadmin, async (req, res) => {
        try {
            const { owner, repo } = req.query;
            const repoInfo = parseGitHubRepo(owner, repo);
            
            // Mock branches data - in production, this would call GitHub API
            const branches = [
                { name: 'main', protected: true, sha: 'abc123' },
                { name: 'develop', protected: false, sha: 'def456' },
                { name: 'feature/new-ui', protected: false, sha: 'ghi789' }
            ];
            
            res.json(branches);
        } catch (error) {
            res.status(400).json({ message: error.message });
        }
    });

    // Pull from repository (non-streaming)
    app.post('/api/github/pull', protect, requireSuperadmin, async (req, res) => {
        try {
            const { repoUrl, branch } = req.body;
            if (!repoUrl || !branch) {
                return res.status(400).json({ message: 'Repository URL and branch are required' });
            }
            
            // Mock pull operation - in production, this would execute git commands
            res.json({
                success: true,
                message: `Successfully pulled from ${branch} branch`,
                changes: {
                    filesChanged: 5,
                    insertions: 127,
                    deletions: 43
                }
            });
        } catch (error) {
            res.status(500).json({ 
                success: false, 
                message: 'Pull operation failed',
                error: error.message 
            });
        }
    });

    // Pull from repository (streaming)
    app.get('/api/github/pull-stream', protect, requireSuperadmin, (req, res) => {
        try {
            const { repoUrl, branch } = req.query;
            if (!repoUrl || !branch) {
                return res.status(400).json({ message: 'Repository URL and branch are required' });
            }
            
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            });
            
            // Mock streaming pull operation
            const steps = [
                { log: 'Fetching repository information...', delay: 500 },
                { log: `Connecting to branch: ${branch}...`, delay: 800 },
                { log: 'Checking for updates...', delay: 600 },
                { log: 'Downloading changes...', delay: 1200 },
                { log: 'Applying updates...', delay: 900 },
                { log: 'Update completed successfully!', delay: 400 }
            ];
            
            let currentStep = 0;
            
            const sendStep = () => {
                if (currentStep < steps.length) {
                    const step = steps[currentStep];
                    res.write(`data: ${JSON.stringify({ log: step.log })}\n\n`);
                    currentStep++;
                    setTimeout(sendStep, step.delay);
                } else {
                    res.write(`data: ${JSON.stringify({ 
                        status: 'completed',
                        message: 'Pull operation completed successfully',
                        changes: { filesChanged: 5, insertions: 127, deletions: 43 }
                    })}\n\n`);
                    res.end();
                }
            };
            
            sendStep();
            
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
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
    
    const API_BACKEND_URL = 'http://127.0.0.1:3002';
    const forward = async (method, url, req, res, data) => {
        try {
            const r = await axios({
                method,
                url: API_BACKEND_URL + url,
                data,
                headers: {
                    authorization: req.headers.authorization || '',
                    'content-type': req.headers['content-type'] || 'application/json'
                },
                timeout: 15000
            });
            res.status(r.status).send(r.data);
        } catch (e) {
            const s = e.response ? e.response.status : 500;
            const m = e.response?.data || { message: e.message };
            res.status(s).send(m);
        }
    };
    
    app.get('/api/roles', protect, async (req, res) => {
        await forward('GET', '/api/roles', req, res);
    });
    app.get('/api/permissions', protect, async (req, res) => {
        await forward('GET', '/api/permissions', req, res);
    });
    app.get('/api/panel-users', protect, async (req, res) => {
        await forward('GET', '/api/panel-users', req, res);
    });
    app.post('/api/panel-users', protect, async (req, res) => {
        await forward('POST', '/api/panel-users', req, res, req.body);
    });
    app.delete('/api/panel-users/:id', protect, async (req, res) => {
        await forward('DELETE', `/api/panel-users/${req.params.id}`, req, res);
    });
    app.get('/api/roles/:roleId/permissions', protect, async (req, res) => {
        await forward('GET', `/api/roles/${req.params.roleId}/permissions`, req, res);
    });
    app.put('/api/roles/:roleId/permissions', protect, async (req, res) => {
        await forward('PUT', `/api/roles/${req.params.roleId}/permissions`, req, res, req.body);
    });

    // --- LOCALE FILES ROUTE (must come before static files) ---
    app.get('/locales/:file', (req, res) => {
        const file = req.params.file;
        // Validate filename to prevent directory traversal
        if (!/^[a-zA-Z]{2,3}\.json$/.test(file)) {
            return res.status(400).json({ error: 'Invalid locale file' });
        }
        const localePath = path.join(__dirname, '..', 'locales', file);
        res.sendFile(localePath, (err) => {
            if (err) {
                console.error(`Error serving locale file ${file}:`, err);
                res.status(404).json({ error: 'Locale file not found' });
            }
        });
    });

    // --- PRODUCTION STATIC FILES ---
    // Serve static files with proper caching
    app.use(express.static(path.join(__dirname, '..', 'dist'), {
        maxAge: '1d', // Cache static assets for 1 day
        etag: true,
        lastModified: true
    }));
    
    // Fallback to index.html for SPA routing in production
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
    });

    app.listen(PORT, () => {
        console.log(`✅ Mikrotik Manager UI running on http://localhost:${PORT}`);
        console.log(`   Mode: Production (Static Files Served)`);
    });

    // --- CAPTIVE PORTAL SERVER ---
    const CAPTIVE_PORT = parseInt(process.env.CAPTIVE_PORT || '8080', 10);
    const captiveApp = express();
    
    // Add redirect middleware for unauthorized clients
    captiveApp.use((req, res, next) => {
        const host = (req.headers.host || '').split(':')[0];
        const isIpHost = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host === 'localhost';
        const isStaticAsset = /\.(js|css|tsx|ts|svg|png|jpg|ico|json|map)$/.test(req.path);
        const isApi = req.path.startsWith('/api/') || req.path.startsWith('/mt-api/') || req.path.startsWith('/ws/');
        
        // Allow direct access to login page for admin IPs (including WAN IP)
        if (isIpHost && req.path === '/login') {
            return next(); // Allow direct access to login on IP addresses
        }
        
        // Redirect unauthorized clients to captive portal (only for non-login paths)
        if (isIpHost && !isApi && !isStaticAsset && req.path !== '/login' && req.path !== '/') {
            return res.redirect(`http://${host}:${CAPTIVE_PORT}/captive`);
        }
        next();
    });

    // API route for captive portal landing page settings - MUST be first
    captiveApp.get('/api/public/landing-page', async (req, res) => {
        try {
            const s = await db.get('SELECT companyName, logoBase64, landingPageConfig FROM settings WHERE id = 1');
            let cfg = {};
            try { cfg = JSON.parse(s?.landingPageConfig || '{}'); } catch (_) {}
            res.json({
                company: { companyName: s?.companyName || '', logoBase64: s?.logoBase64 || '' },
                config: cfg
            });
        } catch (e) {
            console.error('Error in captive /api/public/landing-page:', e);
            res.status(500).json({ message: e.message });
        }
    });

    // Serve captive portal static files
    captiveApp.use(express.static(path.join(__dirname, '..', 'dist')));
    
    // Fallback to index.html for SPA routing
    captiveApp.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
    });

    captiveApp.listen(CAPTIVE_PORT, () => {
        console.log(`✅ Captive Portal UI running on http://localhost:${CAPTIVE_PORT}/captive`);
    });
}

startServer();
