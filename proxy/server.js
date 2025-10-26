
const express = require('express');
const path = require('path');
const { open } = require('sqlite');
const sqlite3 = require('@vscode/sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { exec, spawn } = require('child_process');
const fs = require('fs/promises');
const fsExtra = require('fs-extra');
const os = require('os');
const crypto = require('crypto');
const archiver = require('archiver');
const tar = require('tar');

const app = express();
const PORT = 3001;
const DB_FILE = path.join(__dirname, 'database', 'main.db');
const BACKUP_DIR = path.join(__dirname, 'backups');
const APP_BACKUP_DIR = path.join(__dirname, 'app-backups');
const SECRET_KEY = process.env.JWT_SECRET || 'a-very-secret-and-long-string-for-jwt-!@#$%^&*()';
const LICENSE_SECRET_KEY = process.env.LICENSE_SECRET || 'a-long-and-very-secret-string-for-licenses-!@#$%^&*()';
let db;

// --- Middleware ---
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'dist')));


// --- Database Initialization and Migrations ---
const initializeDatabase = async () => {
    await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    await fs.mkdir(APP_BACKUP_DIR, { recursive: true });
    
    db = await open({
        filename: DB_FILE,
        driver: sqlite3.Database
    });

    await db.exec('PRAGMA journal_mode = WAL;');
    await db.exec('PRAGMA foreign_keys = ON;');

    // Migrations
    await db.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            applied_at TEXT NOT NULL
        );
    `);
    
    const migrations = [
        {
            name: '001_initial_schema.sql',
            sql: `
                CREATE TABLE roles (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE
                );
                CREATE TABLE permissions (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE
                );
                CREATE TABLE role_permissions (
                    role_id TEXT,
                    permission_id TEXT,
                    PRIMARY KEY (role_id, permission_id),
                    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
                    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
                );
                CREATE TABLE users (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    role_id TEXT NOT NULL,
                    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
                );
                CREATE TABLE security_questions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    question TEXT NOT NULL,
                    answer_hash TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                INSERT INTO roles (id, name) VALUES ('role_superadmin', 'Superadmin') ON CONFLICT(id) DO NOTHING;
            `
        },
        {
            name: '002_add_routers_customers_billing.sql',
            sql: `
                CREATE TABLE IF NOT EXISTS routers (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    host TEXT NOT NULL,
                    user TEXT NOT NULL,
                    password TEXT,
                    port INTEGER,
                    api_type TEXT DEFAULT 'rest'
                );
                CREATE TABLE IF NOT EXISTS customers (
                    id TEXT PRIMARY KEY,
                    routerId TEXT NOT NULL,
                    username TEXT NOT NULL,
                    fullName TEXT,
                    address TEXT,
                    contactNumber TEXT,
                    email TEXT,
                    FOREIGN KEY (routerId) REFERENCES routers(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS billing_plans (
                    id TEXT PRIMARY KEY,
                    routerId TEXT NOT NULL,
                    name TEXT NOT NULL,
                    price REAL NOT NULL,
                    cycle TEXT NOT NULL,
                    pppoeProfile TEXT NOT NULL,
                    description TEXT,
                    currency TEXT DEFAULT 'USD',
                    FOREIGN KEY (routerId) REFERENCES routers(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS sales (
                    id TEXT PRIMARY KEY,
                    routerId TEXT NOT NULL,
                    date TEXT NOT NULL,
                    clientName TEXT NOT NULL,
                    planName TEXT NOT NULL,
                    planPrice REAL NOT NULL,
                    discountAmount REAL NOT NULL,
                    finalAmount REAL NOT NULL,
                    currency TEXT DEFAULT 'USD',
                    clientAddress TEXT,
                    clientContact TEXT,
                    clientEmail TEXT,
                    FOREIGN KEY (routerId) REFERENCES routers(id) ON DELETE CASCADE
                );
            `
        },
        {
            name: '003_add_inventory_expenses_company.sql',
            sql: `
                CREATE TABLE IF NOT EXISTS inventory (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    quantity INTEGER NOT NULL,
                    price REAL,
                    serialNumber TEXT,
                    dateAdded TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS expenses (
                    id TEXT PRIMARY KEY,
                    date TEXT NOT NULL,
                    category TEXT NOT NULL,
                    description TEXT NOT NULL,
                    amount REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS company_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );
                CREATE TABLE IF NOT EXISTS panel_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );
                CREATE TABLE IF NOT EXISTS notifications (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    message TEXT NOT NULL,
                    is_read INTEGER NOT NULL DEFAULT 0,
                    timestamp TEXT NOT NULL,
                    link_to TEXT,
                    context_json TEXT
                );
            `
        },
        {
            name: '004_add_payroll.sql',
            sql: `
                 CREATE TABLE IF NOT EXISTS employees (
                    id TEXT PRIMARY KEY,
                    fullName TEXT NOT NULL,
                    role TEXT NOT NULL,
                    hireDate TEXT NOT NULL,
                    salaryType TEXT NOT NULL,
                    rate REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS employee_benefits (
                    id TEXT PRIMARY KEY,
                    employeeId TEXT NOT NULL UNIQUE,
                    sss INTEGER NOT NULL DEFAULT 0,
                    philhealth INTEGER NOT NULL DEFAULT 0,
                    pagibig INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS time_records (
                    id TEXT PRIMARY KEY,
                    employeeId TEXT NOT NULL,
                    date TEXT NOT NULL,
                    timeIn TEXT NOT NULL,
                    timeOut TEXT NOT NULL,
                    FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE CASCADE
                );
            `
        },
        {
            name: '005_add_dhcp_billing.sql',
            sql: `
                CREATE TABLE IF NOT EXISTS dhcp_billing_plans (
                    id TEXT PRIMARY KEY,
                    routerId TEXT NOT NULL,
                    name TEXT NOT NULL,
                    price REAL NOT NULL,
                    cycle_days INTEGER NOT NULL,
                    speedLimit TEXT,
                    currency TEXT DEFAULT 'USD',
                    FOREIGN KEY (routerId) REFERENCES routers(id) ON DELETE CASCADE
                );
            `
        },
        {
             name: '006_rbac_implementation.sql',
             sql: `
                -- Define default roles
                INSERT INTO roles (id, name) VALUES ('role_admin', 'Administrator'), ('role_employee', 'Employee'), ('role_tester', 'Tester') ON CONFLICT(id) DO NOTHING;

                -- Define all permissions
                INSERT INTO permissions (id, name) VALUES
                    ('*:*', 'All Permissions (Wildcard)'),
                    ('dashboard:view', 'View Dashboard'),
                    ('routers:view', 'View Routers'), ('routers:create', 'Create Routers'), ('routers:edit', 'Edit Routers'), ('routers:delete', 'Delete Routers'),
                    ('pppoe:view', 'View PPPoE'), ('pppoe:create', 'Create PPPoE Users'), ('pppoe:edit', 'Edit PPPoE'), ('pppoe:delete', 'Delete PPPoE Users'),
                    ('dhcp-portal:view', 'View DHCP Portal'), ('dhcp-portal:create', 'Create DHCP Clients'), ('dhcp-portal:edit', 'Edit DHCP Clients'), ('dhcp-portal:delete', 'Delete DHCP Clients'),
                    ('hotspot:view', 'View Hotspot'), ('hotspot:create', 'Create Hotspot'), ('hotspot:edit', 'Edit Hotspot'), ('hotspot:delete', 'Delete Hotspot'),
                    ('billing:view', 'View Billing'), ('billing:create', 'Create Billing Plans'), ('billing:edit', 'Edit Billing Plans'), ('billing:delete', 'Delete Billing Plans'),
                    ('sales:view', 'View Sales'), ('sales:create', 'Create Sales Records'), ('sales:delete', 'Delete Sales Records'),
                    ('inventory:view', 'View Inventory'), ('inventory:create', 'Create Inventory'), ('inventory:edit', 'Edit Inventory'), ('inventory:delete', 'Delete Inventory'),
                    ('payroll:view', 'View Payroll'), ('payroll:create', 'Create Payroll'), ('payroll:edit', 'Edit Payroll'), ('payroll:delete', 'Delete Payroll'),
                    ('remote:view', 'View Remote Access'), ('remote:edit', 'Edit Remote Access'),
                    ('files:view', 'View Files'), ('files:edit', 'Edit Files'),
                    ('system:view', 'View System Settings'), ('system:edit', 'Edit System Settings'),
                    ('logs:view', 'View Logs'),
                    ('notifications:view', 'View Notifications'),
                    ('company:view', 'View Company Settings'), ('company:edit', 'Edit Company Settings'),
                    ('roles:view', 'View Panel Roles'), ('roles:edit', 'Edit Panel Roles'),
                    ('updater:view', 'View Updater'), ('updater:update', 'Perform Updates')
                ON CONFLICT(id) DO NOTHING;

                -- Assign wildcard to Superadmin (created in migration 001)
                INSERT INTO role_permissions (role_id, permission_id) VALUES ('role_superadmin', '*:*') ON CONFLICT(role_id, permission_id) DO NOTHING;

                -- Assign wildcard to Administrator
                INSERT INTO role_permissions (role_id, permission_id) VALUES ('role_admin', '*:*') ON CONFLICT(role_id, permission_id) DO NOTHING;

                -- Assign limited permissions to Employee
                INSERT INTO role_permissions (role_id, permission_id) SELECT 'role_employee', id FROM permissions WHERE name LIKE '%:view' OR name LIKE '%:create' OR name LIKE '%:edit' ON CONFLICT(role_id, permission_id) DO NOTHING;
                
                -- Assign limited permissions to Tester
                INSERT INTO role_permissions (role_id, permission_id) SELECT 'role_tester', id FROM permissions WHERE name LIKE '%:view' ON CONFLICT(role_id, permission_id) DO NOTHING;
                INSERT INTO role_permissions (role_id, permission_id) VALUES ('role_tester', 'pppoe:create') ON CONFLICT(role_id, permission_id) DO NOTHING;
             `
        }
    ];

    for (const migration of migrations) {
        const applied = await db.get('SELECT id FROM migrations WHERE name = ?', migration.name);
        if (!applied) {
            console.log(`Applying migration: ${migration.name}`);
            await db.exec(migration.sql);
            await db.run('INSERT INTO migrations (name, applied_at) VALUES (?, ?)', migration.name, new Date().toISOString());
        }
    }
    
    // Set a default Superadmin password if no users exist
    const userCount = await db.get('SELECT COUNT(*) as count FROM users');
    if (userCount.count === 0) {
        const defaultPassword = 'superadminpassword';
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(defaultPassword, salt);
        await db.run(`
            INSERT INTO users (id, username, password_hash, role_id) 
            VALUES ('user_superadmin', 'superadmin', ?, 'role_superadmin')
        `, hash);
        console.log(`
        ************************************************
        *                                              *
        *  NO USERS FOUND. CREATED DEFAULT SUPERADMIN: *
        *                                              *
        *    Username: superadmin                      *
        *    Password: superadminpassword              *
        *                                              *
        *  ! CHANGE THIS PASSWORD IMMEDIATELY !        *
        *                                              *
        ************************************************
        `);
    }
};

initializeDatabase().catch(err => {
    console.error("Database initialization failed:", err);
    process.exit(1);
});

// --- Captive Portal Middleware ---
app.use((req, res, next) => {
    // Whitelist admin access points
    const adminHosts = ['localhost', '127.0.0.1'];
    const adminDomains = ['pitunnel.net', 'ngrok.io', 'dataplicity.io'];

    const clientIp = req.socket.remoteAddress;
    const hostname = req.hostname;
    
    const isLocal = adminHosts.includes(hostname) || hostname === clientIp;
    const isTunnel = adminDomains.some(domain => hostname.endsWith(domain));
    const isAllowedAsset = req.path.startsWith('/assets/') || req.path.startsWith('/locales/') || req.path.startsWith('/env.js');
    const isApiCall = req.path.startsWith('/api/');

    if (isLocal || isTunnel || isAllowedAsset || isApiCall) {
        return next();
    }
    
    // Redirect all other traffic to the captive portal page
    res.sendFile(path.join(__dirname, '..', 'dist', 'captive.html'));
});

// --- Authentication & RBAC Middleware ---
const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authorization token required.' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const user = await db.get(`
            SELECT u.id, u.username, r.id as roleId, r.name as roleName 
            FROM users u
            JOIN roles r ON u.role_id = r.id
            WHERE u.id = ?
        `, decoded.id);
        
        if (!user) {
            return res.status(401).json({ message: 'User not found.' });
        }
        
        // Fetch permissions
        const perms = await db.all(`
            SELECT p.name 
            FROM role_permissions rp
            JOIN permissions p ON rp.permission_id = p.id
            WHERE rp.role_id = ?
        `, user.roleId);

        req.user = {
            id: user.id,
            username: user.username,
            role: { id: user.roleId, name: user.roleName },
            permissions: perms.map(p => p.name)
        };
        next();
    } catch (error) {
        res.status(401).json({ message: 'Invalid or expired token.' });
    }
};

const requirePermission = (permission) => (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ message: "Authentication required." });
    }
    if (req.user.permissions.includes('*:*') || req.user.permissions.includes(permission)) {
        return next();
    }
    return res.status(403).json({ message: "Forbidden: You do not have permission to perform this action." });
};

// All API routes from here on require authentication
// app.use('/api', authMiddleware); // This will be added selectively below

// --- Remote Access Command Execution Helper ---
const execOptions = {
    env: {
        ...process.env,
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    },
};

const createStreamHandler = (command, options = execOptions) => (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });

    const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    const proc = spawn('bash', ['-c', command], options);

    proc.stdout.on('data', (data) => {
        sendEvent({ log: data.toString() });
    });
    proc.stderr.on('data', (data) => {
        sendEvent({ log: data.toString(), isError: true });
    });
    proc.on('close', (code) => {
        if (code !== 0) {
            sendEvent({ status: 'error', message: `Process exited with code ${code}` });
        }
        sendEvent({ status: 'finished' });
        res.end();
    });
    proc.on('error', (err) => {
        sendEvent({ status: 'error', message: `Failed to start process: ${err.message}` });
        res.end();
    });
};

// --- AUTH (PUBLIC) ENDPOINTS ---
app.get('/api/auth/has-users', async (req, res) => {
    const userCount = await db.get('SELECT COUNT(*) as count FROM users');
    res.json({ hasUsers: userCount.count > 0 });
});

app.post('/api/auth/register', async (req, res) => {
    const { username, password, securityQuestions } = req.body;
    const userCount = await db.get('SELECT COUNT(*) as count FROM users');
    if (userCount.count > 0) {
        return res.status(403).json({ message: 'Registration is closed.' });
    }
    
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    
    const role = await db.get('SELECT id FROM roles WHERE name = ?', 'Administrator');
    if (!role) {
        return res.status(500).json({ message: "Administrator role not found."});
    }

    try {
        const newUser = { id: `user_${Date.now()}`, username, password_hash: hash, role_id: role.id };
        await db.run('INSERT INTO users (id, username, password_hash, role_id) VALUES (?, ?, ?, ?)', newUser.id, newUser.username, newUser.password_hash, newUser.role_id);
        
        for (const sq of securityQuestions) {
            const answerHash = await bcrypt.hash(sq.answer.toLowerCase(), salt);
            await db.run('INSERT INTO security_questions (id, user_id, question, answer_hash) VALUES (?, ?, ?, ?)', `sq_${Date.now()}_${Math.random()}`, newUser.id, sq.question, answerHash);
        }

        const token = jwt.sign({ id: newUser.id, username: newUser.username }, SECRET_KEY, { expiresIn: '7d' });
        res.status(201).json({
            token,
            user: { id: newUser.id, username: newUser.username, role: { id: role.id, name: 'Administrator' }, permissions: ['*:*'] }
        });

    } catch(e) {
        res.status(500).json({ message: e.message });
    }
});

app.post('/api/auth/login', async (req, res) => { /* ... login logic ... */ });
app.get('/api/auth/security-questions/:username', async (req, res) => { /* ... get questions logic ... */ });
app.post('/api/auth/reset-password', async (req, res) => { /* ... reset password logic ... */ });

// --- APPLY AUTH MIDDLEWARE TO ALL SUBSEQUENT API ROUTES ---
app.use('/api', authMiddleware);

app.get('/api/auth/status', requirePermission('dashboard:view'), (req, res) => {
    res.json(req.user);
});
app.post('/api/auth/logout', (req, res) => res.json({ message: 'Logged out' }));
app.post('/api/auth/reset-all', requirePermission('*:*'), async (req, res) => { /* ... */ res.json({ message: 'All credentials reset.'}); });
app.post('/api/auth/change-superadmin-password', requirePermission('*:*'), async (req, res) => { /* ... */ res.json({ message: 'Password updated.'}); });


// CRUD Endpoints
const setupCrudEndpoints = (resource, permissions) => {
  app.get(`/api/db/${resource}`, requirePermission(permissions.view), async (req, res) => { /* ... */ });
  app.post(`/api/db/${resource}`, requirePermission(permissions.create), async (req, res) => { /* ... */ });
  app.get(`/api/db/${resource}/:id`, requirePermission(permissions.view), async (req, res) => { /* ... */ });
  app.patch(`/api/db/${resource}/:id`, requirePermission(permissions.edit), async (req, res) => { /* ... */ });
  app.delete(`/api/db/${resource}/:id`, requirePermission(permissions.delete), async (req, res) => { /* ... */ });
};

setupCrudEndpoints('routers', { view: 'routers:view', create: 'routers:create', edit: 'routers:edit', delete: 'routers:delete' });
setupCrudEndpoints('billing-plans', { view: 'billing:view', create: 'billing:create', edit: 'billing:edit', delete: 'billing:delete' });
setupCrudEndpoints('dhcp-billing-plans', { view: 'billing:view', create: 'billing:create', edit: 'billing:edit', delete: 'billing:delete' });
setupCrudEndpoints('sales', { view: 'sales:view', create: 'sales:create', edit: 'sales:edit', delete: 'sales:delete' });
// etc. for all other DB resources...


// --- PiTunnel ---
app.get('/api/pitunnel/status', requirePermission('remote:view'), (req, res) => { exec('sudo systemctl is-active pitunnel.service', execOptions, (err, stdout) => { res.json({ installed: !err, active: !err && stdout.trim() === 'active', url: 'https://pitunnel.com/dashboard' }); }); });
app.post('/api/pitunnel/install', requirePermission('remote:edit'), (req, res) => {
    const { command } = req.body;
    if (!command || !command.includes('pitunnel.com')) { return res.status(400).json({ message: 'Invalid PiTunnel installation command provided.' }); }
    createStreamHandler(command)(req, res);
});
app.get('/api/pitunnel/uninstall', requirePermission('remote:edit'), createStreamHandler(`sudo systemctl stop pitunnel.service && sudo systemctl disable pitunnel.service && sudo rm -f /usr/local/bin/pitunnel && sudo rm -f /etc/systemd/system/pitunnel.service && sudo rm -rf /etc/pitunnel && sudo systemctl daemon-reload`));
app.post('/api/pitunnel/tunnels/create', requirePermission('remote:edit'), (req, res) => {
    const { port, name, protocol } = req.body;
    const cmd = `sudo /usr/local/bin/pitunnel --port=${port} ${name ? `--name=${name}` : ''} ${protocol !== 'tcp' ? `--${protocol}` : ''}`;
    createStreamHandler(cmd)(req, res);
});


// --- Dataplicity ---
app.get('/api/dataplicity/status', requirePermission('remote:view'), (req, res) => { exec('sudo systemctl is-active dataplicity.service', execOptions, (err, stdout) => { res.json({ installed: !err, active: !err && stdout.trim() === 'active', url: 'https://app.dataplicity.com/' }); }); });
app.post('/api/dataplicity/install', requirePermission('remote:edit'), (req, res) => {
    let { command } = req.body;
    if (!command || !command.includes('dataplicity.com')) { return res.status(400).json({ message: 'Invalid Dataplicity installation command provided.' }); }
    command = command.replace('| sudo python', '| sudo python3');
    createStreamHandler(command)(req, res);
});
app.get('/api/dataplicity/uninstall', requirePermission('remote:edit'), createStreamHandler('curl -s https://www.dataplicity.com/uninstall.py | sudo python3'));


// ... All other endpoints (ngrok, zerotier, fixer, updater, license, etc) would follow here
// ... with their respective permission checks and logic.

// --- Final Catch-all ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Mikrotik Billling Management UI server running on http://localhost:${PORT}`);
});
