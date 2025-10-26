const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const sqlite3 = require('@vscode/sqlite3');
const { open } = require('sqlite');
const esbuild = require('esbuild');
const archiver = require('archiver');
const fsExtra = require('fs-extra');
const tar = require('tar');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const os = require('os');
const fsPromises = require('fs').promises;
const crypto = require('crypto');

const app = express();
const PORT = 3001;
const DB_PATH = path.join(__dirname, 'panel.db');
const SUPERADMIN_DB_PATH = path.join(__dirname, 'superadmin.db');
const BACKUP_DIR = path.join(__dirname, 'backups');
const API_BACKEND_FILE = path.join(__dirname, '..', 'api-backend', 'server.js');
const NGROK_CONFIG_PATH = path.join(__dirname, 'ngrok-config.json');
const NGROK_BINARY_PATH = '/usr/local/bin/ngrok';
const SECRET_KEY = process.env.JWT_SECRET || 'a-very-weak-secret-key-for-dev-only';
const LICENSE_SECRET_KEY = process.env.LICENSE_SECRET || 'a-long-and-very-secret-string-for-licenses-!@#$%^&*()';


app.use(express.json({ limit: '10mb' }));
app.use(express.text({ limit: '10mb' })); // For AI fixer

// --- Captive Portal Redirect Middleware ---
app.use((req, res, next) => {
    // This is a heuristic to distinguish between a user directly accessing the panel
    // vs. a captive client being redirected. Direct access usually uses localhost or an IP.
    const isDirectAccess = req.hostname === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(req.hostname);

    // List of paths that should be ignored by this redirect logic.
    const ignoredPaths = [
        '/api/',
        '/mt-api/',
        '/ws/',
        '/captive', // The destination page itself
        '/env.js', // Critical environment script
    ];

    // Check if the request is for a static asset (e.g., .js, .css, .tsx)
    const isStaticAsset = req.path.match(/\.(js|css|tsx|ts|svg|png|jpg|ico|json|map)$/);

    if (!isDirectAccess && !isStaticAsset && !ignoredPaths.some(p => req.path.startsWith(p))) {
        console.log(`[Captive Portal] Redirecting request for Host "${req.hostname}" to /captive.`);
        return res.redirect('/captive');
    }

    next();
});


// Ensure backup directory exists
fs.mkdirSync(BACKUP_DIR, { recursive: true });

let db;
let superadminDb;

// --- Database Initialization and Migrations ---
async function initSuperadminDb() {
    try {
        superadminDb = await open({
            filename: SUPERADMIN_DB_PATH,
            driver: sqlite3.Database
        });
        console.log('Connected to the superadmin database.');

        await superadminDb.exec('CREATE TABLE IF NOT EXISTS superadmin (username TEXT PRIMARY KEY, password TEXT NOT NULL);');

        const superadminUser = await superadminDb.get("SELECT COUNT(*) as count FROM superadmin");
        if (superadminUser.count === 0) {
            console.log('No superadmin found. Creating default superadmin...');
            const defaultPassword = 'superadmin';
            const hashedPassword = await bcrypt.hash(defaultPassword, 10);
            await superadminDb.run('INSERT INTO superadmin (username, password) VALUES (?, ?)', 'superadmin', hashedPassword);
            console.log('Default superadmin created with username "superadmin" and password "superadmin".');
        }
    } catch (err) {
        if (err.code === 'SQLITE_CORRUPT') {
            console.error('Superadmin database is corrupt. Deleting and recreating it.');
            try {
                if (superadminDb) {
                    await superadminDb.close();
                }
                await fsPromises.unlink(SUPERADMIN_DB_PATH);
                console.log('Corrupt superadmin database deleted. Retrying initialization...');
                // Retry initialization
                return initSuperadminDb();
            } catch (deleteErr) {
                console.error('CRITICAL: Failed to delete corrupt superadmin database. Please check file permissions.', deleteErr);
                process.exit(1);
            }
        } else {
            console.error('Failed to initialize superadmin database:', err);
            process.exit(1);
        }
    }
}

async function initDb() {
    try {
        db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });
        console.log('Connected to the panel database.');

        // Enable foreign keys
        await db.exec('PRAGMA foreign_keys = ON;');

        // Migrations
        await db.exec('PRAGMA user_version;');
        let { user_version } = await db.get('PRAGMA user_version;');
        console.log(`Current DB version: ${user_version}`);

        if (user_version < 1) {
            console.log('Applying migration v1...');
            await db.exec(`
                CREATE TABLE IF NOT EXISTS routers (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    host TEXT NOT NULL,
                    user TEXT NOT NULL,
                    password TEXT,
                    port INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS panel_settings (key TEXT PRIMARY KEY, value TEXT);
                CREATE TABLE IF NOT EXISTS company_settings (key TEXT PRIMARY KEY, value TEXT);
                CREATE TABLE IF NOT EXISTS billing_plans (id TEXT PRIMARY KEY, name TEXT, price REAL, cycle TEXT, pppoeProfile TEXT, description TEXT);
                CREATE TABLE IF NOT EXISTS sales_records (id TEXT PRIMARY KEY, date TEXT, clientName TEXT, planName TEXT, planPrice REAL, discountAmount REAL, finalAmount REAL, routerName TEXT);
                CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, username TEXT NOT NULL, routerId TEXT NOT NULL, fullName TEXT, address TEXT, contactNumber TEXT, email TEXT);
                CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, name TEXT, quantity INTEGER, price REAL, serialNumber TEXT, dateAdded TEXT);
            `);
            await db.exec('PRAGMA user_version = 1;');
            user_version = 1;
        }

        if (user_version < 2) {
            console.log('Applying migration v2...');
            // Make migration idempotent: check if column exists before adding
            const billingCols = await db.all("PRAGMA table_info(billing_plans);");
            if (!billingCols.some(c => c.name === 'currency')) {
                await db.exec('ALTER TABLE billing_plans ADD COLUMN currency TEXT;');
            }
            const salesCols = await db.all("PRAGMA table_info(sales_records);");
            if (!salesCols.some(c => c.name === 'currency')) {
                await db.exec('ALTER TABLE sales_records ADD COLUMN currency TEXT;');
            }
            await db.exec('PRAGMA user_version = 2;');
            user_version = 2;
        }
        
        if (user_version < 3) {
             console.log('Applying migration v3...');
            const salesCols = await db.all("PRAGMA table_info(sales_records);");
            if (!salesCols.some(c => c.name === 'clientAddress')) await db.exec('ALTER TABLE sales_records ADD COLUMN clientAddress TEXT;');
            if (!salesCols.some(c => c.name === 'clientContact')) await db.exec('ALTER TABLE sales_records ADD COLUMN clientContact TEXT;');
            if (!salesCols.some(c => c.name === 'clientEmail')) await db.exec('ALTER TABLE sales_records ADD COLUMN clientEmail TEXT;');
            await db.exec('PRAGMA user_version = 3;');
            user_version = 3;
        }
        
        if (user_version < 4) {
            console.log('Applying migration v4 (Settings Table Schema Fix)...');
            // This robustly fixes the settings tables if they have the wrong schema
            const fixSettingsTable = async (tableName) => {
                 const cols = await db.all(`PRAGMA table_info(${tableName});`);
                 // If there's no 'key' column, the schema is wrong.
                 if (!cols.some(c => c.name === 'key')) {
                     console.log(`Rebuilding malformed table: ${tableName}`);
                     await db.exec(`ALTER TABLE ${tableName} RENAME TO ${tableName}_old;`);
                     await db.exec(`CREATE TABLE ${tableName} (key TEXT PRIMARY KEY, value TEXT);`);
                     // Attempt to copy old data if possible (best effort)
                     try {
                         // This assumes old tables had single-row data that can be converted
                         const oldData = await db.get(`SELECT * FROM ${tableName}_old LIMIT 1;`);
                         if (oldData) {
                            for (const [key, value] of Object.entries(oldData)) {
                                if (value !== null && value !== undefined) {
                                     await db.run(`INSERT OR REPLACE INTO ${tableName} (key, value) VALUES (?, ?);`, key, JSON.stringify(value));
                                }
                            }
                         }
                     } catch(e) {
                         console.error(`Could not migrate data from ${tableName}_old:`, e.message);
                     }
                     await db.exec(`DROP TABLE ${tableName}_old;`);
                 }
            };
            await fixSettingsTable('company_settings');
            await fixSettingsTable('panel_settings');
            await db.exec('PRAGMA user_version = 4;');
            user_version = 4;
        }
        
        if (user_version < 5) {
            console.log('Applying migration v5 (Force-fix settings table schemas)...');
            const forceFixSettingsTable = async (tableName) => {
                try {
                    const cols = await db.all(`PRAGMA table_info(${tableName});`);
                    // If the schema is wrong (doesn't have a 'key' column), we rebuild it.
                    if (!cols.some(c => c.name === 'key')) {
                        console.log(`Force-rebuilding malformed table: ${tableName}`);
                        await db.exec(`DROP TABLE IF EXISTS ${tableName};`);
                        await db.exec(`CREATE TABLE ${tableName} (key TEXT PRIMARY KEY, value TEXT);`);
                        console.log(`Table ${tableName} has been rebuilt successfully.`);
                    }
                } catch (e) {
                    // This might fail if the table doesn't exist at all, so we create it.
                    if (e.message.includes('no such table')) {
                        console.log(`Table ${tableName} does not exist, creating fresh.`);
                        await db.exec(`CREATE TABLE IF NOT EXISTS ${tableName} (key TEXT PRIMARY KEY, value TEXT);`);
                    } else {
                        // Re-throw other errors
                        console.error(`Error during migration for table ${tableName}:`, e);
                        throw e;
                    }
                }
            };
            await forceFixSettingsTable('company_settings');
            await forceFixSettingsTable('panel_settings');
            await db.exec('PRAGMA user_version = 5;');
            user_version = 5;
        }

        if (user_version < 6) {
            console.log('Applying migration v6 (Add expenses table)...');
            await db.exec(`
                CREATE TABLE IF NOT EXISTS expenses (
                    id TEXT PRIMARY KEY,
                    date TEXT NOT NULL,
                    category TEXT NOT NULL,
                    description TEXT,
                    amount REAL NOT NULL
                );
            `);
            await db.exec('PRAGMA user_version = 6;');
            user_version = 6;
        }
        
        if (user_version < 7) {
            console.log('Applying migration v7 (Add routerId to sales and billing)...');
            
            const salesCols = await db.all("PRAGMA table_info(sales_records);");
            if (!salesCols.some(c => c.name === 'routerId')) {
                await db.exec('ALTER TABLE sales_records ADD COLUMN routerId TEXT;');
            }

            const billingCols = await db.all("PRAGMA table_info(billing_plans);");
            if (!billingCols.some(c => c.name === 'routerId')) {
                await db.exec('ALTER TABLE billing_plans ADD COLUMN routerId TEXT;');
            }
            
            await db.exec('PRAGMA user_version = 7;');
            user_version = 7;
        }
        
        if (user_version < 8) {
            console.log('Applying migration v8 (Verifying routerId columns)...');
            
            const salesCols = await db.all("PRAGMA table_info(sales_records);");
            if (!salesCols.some(c => c.name === 'routerId')) {
                console.log('Adding missing routerId column to sales_records.');
                await db.exec('ALTER TABLE sales_records ADD COLUMN routerId TEXT;');
            }

            const billingCols = await db.all("PRAGMA table_info(billing_plans);");
            if (!billingCols.some(c => c.name === 'routerId')) {
                console.log('Adding missing routerId column to billing_plans.');
                await db.exec('ALTER TABLE billing_plans ADD COLUMN routerId TEXT;');
            }
            
            await db.exec('PRAGMA user_version = 8;');
            user_version = 8;
        }

        if (user_version < 9) {
            console.log('Applying migration v9 (Add users table for auth)...');
            await db.exec(`
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL
                );
            `);
            await db.exec('PRAGMA user_version = 9;');
            user_version = 9;
        }
        
        if (user_version < 10) {
            console.log('Applying migration v10 (Add user security questions)...');
            await db.exec(`
                CREATE TABLE IF NOT EXISTS user_security_questions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    question TEXT NOT NULL,
                    answer TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );
            `);
            await db.exec('PRAGMA user_version = 10;');
            user_version = 10;
        }

        if (user_version < 11) {
            console.log('Applying migration v11 (Add voucher plans table)...');
            await db.exec(`
                CREATE TABLE IF NOT EXISTS voucher_plans (
                    id TEXT PRIMARY KEY,
                    routerId TEXT NOT NULL,
                    name TEXT NOT NULL,
                    duration_minutes INTEGER NOT NULL,
                    price REAL NOT NULL,
                    currency TEXT NOT NULL,
                    mikrotik_profile_name TEXT NOT NULL
                );
            `);
            await db.exec('PRAGMA user_version = 11;');
            user_version = 11;
        }

        if (user_version < 12) {
            console.log('Applying migration v12 (Add roles to users)...');
            try {
                await db.exec('ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT "employee";');
            } catch (e) {
                if (!e.message.includes('duplicate column name')) {
                    throw e;
                }
                console.log('Column "role" already exists.');
            }
            // Set the first user (if any) to be an admin
            try {
                const firstUser = await db.get('SELECT id FROM users ORDER BY rowid ASC LIMIT 1');
                if (firstUser) {
                    await db.run('UPDATE users SET role = "admin" WHERE id = ?', firstUser.id);
                }
            } catch (e) {
                console.error("Could not set first user to admin:", e.message);
            }
            await db.exec('PRAGMA user_version = 12;');
            user_version = 12;
        }

        if (user_version < 13) {
            console.log('Applying migration v13 (Full Role-Based Access Control)...');
            await db.exec('BEGIN TRANSACTION;');
            try {
                // 1. Create new tables
                await db.exec(`
                    CREATE TABLE IF NOT EXISTS roles (
                        id TEXT PRIMARY KEY,
                        name TEXT UNIQUE NOT NULL,
                        description TEXT
                    );
                `);
                await db.exec(`
                    CREATE TABLE IF NOT EXISTS permissions (
                        id TEXT PRIMARY KEY,
                        name TEXT UNIQUE NOT NULL,
                        description TEXT
                    );
                `);
                await db.exec(`
                    CREATE TABLE IF NOT EXISTS role_permissions (
                        role_id TEXT NOT NULL,
                        permission_id TEXT NOT NULL,
                        PRIMARY KEY (role_id, permission_id),
                        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
                        FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
                    );
                `);

                // 2. Seed roles and permissions
                const adminRoleId = 'role_admin';
                const employeeRoleId = 'role_employee';
                await db.run('INSERT OR IGNORE INTO roles (id, name, description) VALUES (?, ?, ?)', adminRoleId, 'Administrator', 'Full access to all panel features.');
                await db.run('INSERT OR IGNORE INTO roles (id, name, description) VALUES (?, ?, ?)', employeeRoleId, 'Employee', 'Limited access for day-to-day operations.');

                const permissions = [
                    { id: 'perm_sales_delete', name: 'sales_report:delete', description: 'Can delete sales reports' },
                    { id: 'perm_pppoe_delete', name: 'pppoe_users:delete', description: 'Can delete PPPoE users' },
                ];
                for (const p of permissions) {
                    await db.run('INSERT OR IGNORE INTO permissions (id, name, description) VALUES (?, ?, ?)', p.id, p.name, p.description);
                }
                
                // 3. Seed role_permissions (Admin gets all, Employee gets none of the deletable ones)
                await db.run('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)', adminRoleId, 'perm_sales_delete');
                await db.run('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)', adminRoleId, 'perm_pppoe_delete');

                // 4. Migrate users table if it still has the old 'role' column
                const userCols = await db.all("PRAGMA table_info(users);");
                if (userCols.some(c => c.name === 'role')) {
                    const userCount = await db.get("SELECT COUNT(*) as count FROM users");
                    
                    if (userCount.count === 0) {
                        // Table is empty, just rebuild it. Safest for fresh installs.
                        console.log('Rebuilding empty users table for role_id...');
                        await db.exec('DROP TABLE users;');
                        await db.exec(`
                            CREATE TABLE users (
                                id TEXT PRIMARY KEY,
                                username TEXT UNIQUE NOT NULL,
                                password TEXT NOT NULL,
                                role_id TEXT NOT NULL,
                                FOREIGN KEY (role_id) REFERENCES roles(id)
                            );
                        `);
                    } else {
                        // Table has data, migrate it carefully.
                        console.log('Migrating users table with data to use role_id...');
                        await db.exec('ALTER TABLE users RENAME TO users_old;');
                        await db.exec(`
                            CREATE TABLE users (
                                id TEXT PRIMARY KEY,
                                username TEXT UNIQUE NOT NULL,
                                password TEXT NOT NULL,
                                role_id TEXT NOT NULL,
                                FOREIGN KEY (role_id) REFERENCES roles(id)
                            );
                        `);
                        await db.exec(`
                            INSERT INTO users (id, username, password, role_id)
                            SELECT 
                                id, 
                                username, 
                                password, 
                                CASE 
                                    WHEN lower(role) = 'admin' THEN '${adminRoleId}'
                                    WHEN lower(role) = 'administrator' THEN '${adminRoleId}'
                                    ELSE '${employeeRoleId}'
                                END
                            FROM users_old;
                        `);
                        await db.exec('DROP TABLE users_old;');
                    }
                    console.log('Users table migrated successfully.');
                }
                
                await db.exec('COMMIT;');
            } catch (e) {
                await db.exec('ROLLBACK;');
                console.error("Migration v13 failed:", e);
                throw e; // Stop initialization if migration fails
            }
            await db.exec('PRAGMA user_version = 13;');
            user_version = 13;
        }
        
        if (user_version < 14) {
            console.log('Applying migration v14 (Add license table)...');
            await db.exec(`
                CREATE TABLE IF NOT EXISTS license (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );
            `);
            await db.exec('PRAGMA user_version = 14;');
            user_version = 14;
        }

        if (user_version < 15) {
            console.log('Applying migration v15 (Add api_type to routers)...');
            try {
                await db.exec('ALTER TABLE routers ADD COLUMN api_type TEXT NOT NULL DEFAULT "rest";');
            } catch (e) {
                if (!e.message.includes('duplicate column name')) {
                    throw e;
                }
                console.log('Column "api_type" already exists.');
            }
            await db.exec('PRAGMA user_version = 15;');
            user_version = 15;
        }

        if (user_version < 16) {
            console.log('Applying migration v16 (Add notifications table)...');
            await db.exec(`
                CREATE TABLE IF NOT EXISTS notifications (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    message TEXT NOT NULL,
                    is_read INTEGER NOT NULL DEFAULT 0,
                    timestamp TEXT NOT NULL,
                    link_to TEXT,
                    context_json TEXT
                );
            `);
            await db.exec('PRAGMA user_version = 16;');
            user_version = 16;
        }

        if (user_version < 17) {
            console.log('Applying migration v17 (Add dhcp_clients table)...');
            await db.exec(`
                CREATE TABLE IF NOT EXISTS dhcp_clients (
                    id TEXT PRIMARY KEY,
                    routerId TEXT NOT NULL,
                    macAddress TEXT NOT NULL,
                    customerInfo TEXT,
                    contactNumber TEXT,
                    email TEXT,
                    speedLimit TEXT,
                    lastSeen TEXT,
                    UNIQUE(routerId, macAddress)
                );
            `);
            await db.exec('PRAGMA user_version = 17;');
            user_version = 17;
        }

        if (user_version < 18) {
            console.log('Applying migration v18 (Add dhcp_billing_plans table)...');
            await db.exec(`
                CREATE TABLE IF NOT EXISTS dhcp_billing_plans (
                    id TEXT PRIMARY KEY,
                    routerId TEXT NOT NULL,
                    name TEXT NOT NULL,
                    price REAL NOT NULL,
                    cycle_days INTEGER NOT NULL,
                    speedLimit TEXT,
                    currency TEXT NOT NULL
                );
            `);
            await db.exec('PRAGMA user_version = 18;');
            user_version = 18;
        }

        if (user_version < 19) {
            console.log('Applying migration v19 (Add payroll tables)...');
            await db.exec(`
                CREATE TABLE IF NOT EXISTS employees (
                    id TEXT PRIMARY KEY,
                    fullName TEXT NOT NULL,
                    role TEXT,
                    hireDate TEXT,
                    salaryType TEXT NOT NULL,
                    rate REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS employee_benefits (
                    id TEXT PRIMARY KEY,
                    employeeId TEXT NOT NULL,
                    sss INTEGER NOT NULL DEFAULT 0,
                    philhealth INTEGER NOT NULL DEFAULT 0,
                    pagibig INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS time_records (
                    id TEXT PRIMARY KEY,
                    employeeId TEXT NOT NULL,
                    date TEXT NOT NULL,
                    timeIn TEXT,
                    timeOut TEXT,
                    UNIQUE(employeeId, date),
                    FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE CASCADE
                );
            `);
            await db.exec('PRAGMA user_version = 19;');
            user_version = 19;
        }


    } catch (err) {
        console.error('Failed to initialize database:', err);
        process.exit(1);
    }
}

// --- Auth Helper ---
const getAuthHeader = () => {
    const token = localStorage.getItem('authToken');
    if (token) {
        return { 'Authorization': `Bearer ${token}` };
    }
    return {};
};

// --- Authentication ---
const authRouter = express.Router();

const buildUserPayload = async (user) => {
    let permissions = [];
    // Admins get all permissions implicitly by name check for now
    if (user.roleName.toLowerCase() === 'administrator') {
        const allPerms = await db.all('SELECT name FROM permissions');
        permissions = allPerms.map(p => p.name);
        permissions.push('*:*'); // Wildcard for admin
    } else {
        const perms = await db.all(`
            SELECT p.name 
            FROM permissions p
            JOIN role_permissions rp ON p.id = rp.permission_id
            WHERE rp.role_id = ?
        `, user.roleId);
        permissions = perms.map(p => p.name);
    }

    return {
        id: user.id,
        username: user.username,
        role: {
            id: user.roleId,
            name: user.roleName
        },
        permissions: permissions
    };
};


authRouter.get('/has-users', async (req, res) => {
    try {
        const row = await db.get("SELECT COUNT(*) as count FROM users");
        res.json({ hasUsers: row.count > 0 });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

authRouter.post('/register', async (req, res) => {
    const { username, password, securityQuestions } = req.body;
    if (!username || !password || !securityQuestions || securityQuestions.length < 3) {
        return res.status(400).json({ message: 'Username, password, and three security questions are required.' });
    }
    
    let transactionStarted = false;
    try {
        const row = await db.get("SELECT COUNT(*) as count FROM users");
        if (row.count > 0) {
            return res.status(403).json({ message: 'Registration is only allowed for the first administrator account.' });
        }

        await db.exec('BEGIN TRANSACTION;');
        transactionStarted = true;

        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = `user_${Date.now()}`;
        const adminRoleId = 'role_admin';

        await db.run('INSERT INTO users (id, username, password, role_id) VALUES (?, ?, ?, ?)', userId, username, hashedPassword, adminRoleId);

        for (const qa of securityQuestions) {
            if (qa.question && qa.answer) {
                const normalizedAnswer = qa.answer.trim().toLowerCase();
                const hashedAnswer = await bcrypt.hash(normalizedAnswer, 10);
                await db.run(
                    'INSERT INTO user_security_questions (id, user_id, question, answer) VALUES (?, ?, ?, ?)',
                    `sq_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                    userId,
                    qa.question,
                    hashedAnswer
                );
            }
        }
        
        await db.exec('COMMIT;');
        transactionStarted = false;
        
        const userRecord = await db.get('SELECT users.*, roles.id as roleId, roles.name as roleName FROM users JOIN roles ON users.role_id = roles.id WHERE users.id = ?', userId);
        const userPayload = await buildUserPayload(userRecord);
        const token = jwt.sign(userPayload, SECRET_KEY, { expiresIn: '7d' });
        res.status(201).json({ token, user: userPayload });

    } catch (e) {
        if (transactionStarted) {
            try { await db.exec('ROLLBACK;'); } catch (rbErr) { console.error('Rollback failed:', rbErr); }
        }
        if (e.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ message: 'Username already exists.' });
        }
        res.status(500).json({ message: e.message });
    }
});

authRouter.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required.' });
    }
    try {
        // --- Superadmin Check ---
        const superadmin = await superadminDb.get('SELECT * FROM superadmin WHERE username = ?', username);
        if (superadmin) {
            const isMatch = await bcrypt.compare(password, superadmin.password);
            if (isMatch) {
                const superadminPayload = {
                    id: 'superadmin',
                    username: superadmin.username,
                    role: { id: 'role_superadmin', name: 'Superadmin' },
                    permissions: ['*:*'] // Superadmin gets all permissions
                };
                const token = jwt.sign(superadminPayload, SECRET_KEY, { expiresIn: '7d' });
                return res.json({ token, user: superadminPayload });
            }
        }

        // --- Regular User Check ---
        const user = await db.get('SELECT users.*, roles.id as roleId, roles.name as roleName FROM users JOIN roles ON users.role_id = roles.id WHERE username = ?', username);
        if (!user) {
            return res.status(401).json({ message: 'Invalid username or password.' });
        }
        const isMatchRegular = await bcrypt.compare(password, user.password);
        if (!isMatchRegular) {
            return res.status(401).json({ message: 'Invalid username or password.' });
        }
        
        const userPayload = await buildUserPayload(user);
        const token = jwt.sign(userPayload, SECRET_KEY, { expiresIn: '7d' });
        res.json({ token, user: userPayload });

    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

authRouter.get('/security-questions/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const user = await db.get('SELECT id FROM users WHERE username = ?', username);
        if (!user) {
            return res.json({ questions: [] });
        }
        const questions = await db.all('SELECT question FROM user_security_questions WHERE user_id = ? ORDER BY id', user.id);
        res.json({ questions: questions.map(q => q.question) });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

authRouter.post('/reset-password', async (req, res) => {
    const { username, answers, newPassword } = req.body;
    if (!username || !answers || !newPassword || !Array.isArray(answers) || answers.length === 0) {
        return res.status(400).json({ message: 'Username, answers, and new password are required.' });
    }
    try {
        const user = await db.get('SELECT id FROM users WHERE username = ?', username);
        if (!user) {
            return res.status(401).json({ message: 'Invalid username or answers.' });
        }

        const storedAnswers = await db.all('SELECT answer FROM user_security_questions WHERE user_id = ? ORDER BY id', user.id);

        if (answers.length !== storedAnswers.length) {
            return res.status(401).json({ message: 'Invalid username or answers.' });
        }

        let allAnswersMatch = true;
        for (let i = 0; i < answers.length; i++) {
            const normalizedAnswer = (answers[i] || '').trim().toLowerCase();
            const isMatch = await bcrypt.compare(normalizedAnswer, storedAnswers[i].answer);
            if (!isMatch) {
                allAnswersMatch = false;
                break;
            }
        }

        if (!allAnswersMatch) {
            return res.status(401).json({ message: 'Invalid username or answers.' });
        }

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        await db.run('UPDATE users SET password = ? WHERE id = ?', hashedNewPassword, user.id);
        
        res.json({ message: 'Password has been reset successfully.' });

    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

const protect = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, SECRET_KEY, (err, user) => {
            if (err) {
                return res.status(401).json({ message: 'Invalid or expired token.' });
            }
            req.user = user;
            next();
        });
    } else {
        res.status(401).json({ message: 'Not authenticated, no token provided.' });
    }
};

const requireSuperadmin = (req, res, next) => {
    const roleName = req.user?.role?.name?.toLowerCase();
    if (req.user && roleName === 'superadmin') {
        return next();
    }
    res.status(403).json({ message: 'Forbidden: Superadmin access required.' });
};

authRouter.post('/reset-all', protect, async (req, res) => {
    try {
        await db.exec('DELETE FROM users');
        res.json({ message: 'All user credentials have been reset.' });
    } catch (e) {
        res.status(500).json({ message: `Failed to reset credentials: ${e.message}` });
    }
});

authRouter.get('/status', protect, (req, res) => {
    res.json(req.user);
});

authRouter.post('/logout', (req, res) => {
    res.status(200).json({ message: 'Logged out successfully.' });
});

authRouter.post('/change-superadmin-password', protect, requireSuperadmin, async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
    }
    try {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        // 'superadmin' is the fixed username for the superadmin account
        await superadminDb.run('UPDATE superadmin SET password = ? WHERE username = ?', hashedPassword, 'superadmin');
        res.json({ message: 'Superadmin password updated successfully.' });
    } catch (e) {
        console.error(`[SUPERADMIN] Password change error: ${e.message}`);
        res.status(500).json({ message: `Failed to update password: ${e.message}` });
    }
});

app.use('/api/auth', authRouter);

// New endpoint for captive portal messages
app.post('/api/captive-message', async (req, res) => {
    const { message } = req.body;
    // Get client IP, considering proxies
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (!message) {
        return res.status(400).json({ message: 'Message content is required.' });
    }

    try {
        const notification = {
            id: `notif_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            type: 'client-chat',
            message: `New message from ${clientIp}: "${message}"`,
            is_read: 0,
            timestamp: new Date().toISOString(),
            link_to: 'dhcp-portal',
            context_json: JSON.stringify({ ip: clientIp })
        };
        await db.run(
            'INSERT INTO notifications (id, type, message, is_read, timestamp, link_to, context_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
            notification.id, notification.type, notification.message, notification.is_read, notification.timestamp, notification.link_to, notification.context_json
        );
        res.status(201).json({ message: 'Message sent successfully.' });
    } catch (e) {
        console.error('Error saving captive message:', e);
        res.status(500).json({ message: 'Failed to send message.' });
    }
});

// --- License Management ---
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

const licenseRouter = express.Router();
licenseRouter.use(protect);

licenseRouter.get('/device-id', (req, res) => {
    try {
        const deviceId = getDeviceId();
        res.json({ deviceId });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

licenseRouter.get('/status', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let deviceId;
    try {
        deviceId = getDeviceId();
    } catch (idError) {
        console.error("CRITICAL: Could not determine Device ID.", idError.message);
        return res.status(500).json({ message: 'Could not determine a stable Device ID for this host.' });
    }

    try {
        const result = await db.get("SELECT value FROM license WHERE key = 'license_key'");
        if (!result || !result.value) {
            return res.json({ licensed: false, deviceId });
        }
        
        const licenseKey = result.value;
        const decoded = jwt.verify(licenseKey, LICENSE_SECRET_KEY);

        if (decoded.deviceId !== deviceId || new Date(decoded.expiresAt) < new Date()) {
            return res.json({ licensed: false, deviceId });
        }

        res.json({ licensed: true, expires: decoded.expiresAt, deviceId: decoded.deviceId, licenseKey });

    } catch (e) {
        if (e instanceof jwt.JsonWebTokenError || e instanceof jwt.TokenExpiredError) {
            console.error("License verification error:", e.message);
            return res.json({ licensed: false, deviceId });
        }
        console.error("Error during license status check:", e.message);
        res.json({ licensed: false, deviceId, error: e.message });
    }
});

licenseRouter.post('/activate', async (req, res) => {
    const { licenseKey } = req.body;
    if (!licenseKey) {
        return res.status(400).json({ message: 'License key is required.' });
    }
    
    let deviceId;
    try {
        deviceId = getDeviceId();
    } catch (idError) {
        return res.status(500).json({ message: 'Could not determine Device ID to validate license against.' });
    }

    try {
        const decoded = jwt.verify(licenseKey, LICENSE_SECRET_KEY);

        if (decoded.deviceId !== deviceId) {
            return res.status(400).json({ message: 'License key is for a different device.' });
        }
        if (new Date(decoded.expiresAt) < new Date()) {
            return res.status(400).json({ message: 'License key has expired.' });
        }

        await db.run("INSERT OR REPLACE INTO license (key, value) VALUES ('license_key', ?)", licenseKey);

        res.json({ success: true, message: 'Application activated successfully.' });
    } catch (e) {
        if (e instanceof jwt.JsonWebTokenError || e instanceof jwt.TokenExpiredError) {
            return res.status(400).json({ message: 'Invalid or expired license key.' });
        }
        console.error(`[LICENSE] Activation error: ${e.message}`);
        res.status(500).json({ message: `Activation error: ${e.message}` });
    }
});

licenseRouter.post('/revoke', async (req, res) => {
    try {
        await db.run("DELETE FROM license WHERE key = 'license_key'");
        res.json({ success: true, message: "License revoked." });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});


const requireAdmin = (req, res, next) => {
    const roleName = req.user?.role?.name?.toLowerCase();
    if (req.user && (roleName === 'administrator' || roleName === 'superadmin' || req.user.permissions.includes('*:*'))) {
        return next();
    }
    res.status(403).json({ message: 'Forbidden: Administrator access required.' });
};

licenseRouter.post('/generate', requireAdmin, (req, res) => {
    const { deviceId, days } = req.body;
    if (!deviceId || !days) {
        return res.status(400).json({ message: 'Device ID and validity days are required.' });
    }
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + parseInt(days, 10));

    const payload = { deviceId, expiresAt: expiresAt.toISOString() };
    const licenseKey = jwt.sign(payload, LICENSE_SECRET_KEY);

    res.json({ licenseKey });
});

app.use('/api/license', licenseRouter);


// --- Panel User & Role Management ---
const panelAdminRouter = express.Router();
panelAdminRouter.use(protect);

// Middleware to check for admin role
panelAdminRouter.get('/roles', requireAdmin, async (req, res) => {
    try {
        const roles = await db.all('SELECT id, name, description FROM roles');
        res.json(roles);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

panelAdminRouter.get('/panel-users', requireAdmin, async (req, res) => {
    try {
        const users = await db.all('SELECT users.id, users.username, roles.name as roleName FROM users JOIN roles ON users.role_id = roles.id');
        res.json(users.map(u => ({ id: u.id, username: u.username, role: { name: u.roleName } })));
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

panelAdminRouter.post('/panel-users', requireAdmin, async (req, res) => {
    const { username, password, role_id } = req.body;
    if (!username || !password || !role_id) {
        return res.status(400).json({ message: 'Username, password, and role_id are required.' });
    }
    try {
        const roleExists = await db.get('SELECT id FROM roles WHERE id = ?', role_id);
        if (!roleExists) {
            return res.status(400).json({ message: 'Invalid role_id specified.' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = `user_${Date.now()}`;
        await db.run('INSERT INTO users (id, username, password, role_id) VALUES (?, ?, ?, ?)', userId, username, hashedPassword, role_id);
        const newUser = await db.get('SELECT users.id, users.username, roles.name as roleName FROM users JOIN roles ON users.role_id = roles.id WHERE users.id = ?', userId);
        res.status(201).json({ id: newUser.id, username: newUser.username, role: { name: newUser.roleName } });
    } catch (e) {
        if (e.message.includes('UNIQUE constraint failed')) {
             return res.status(409).json({ message: 'Username already exists.' });
        }
        res.status(500).json({ message: e.message });
    }
});

panelAdminRouter.delete('/panel-users/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    if (req.user.id === id) {
        return res.status(403).json({ message: 'You cannot delete your own account.' });
    }
    try {
        const result = await db.run('DELETE FROM users WHERE id = ?', id);
        if (result.changes === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        res.status(204).send();
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});


panelAdminRouter.get('/permissions', requireAdmin, async (req, res) => {
    try {
        const permissions = await db.all('SELECT id, name, description FROM permissions');
        res.json(permissions);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

panelAdminRouter.get('/roles/:roleId/permissions', requireAdmin, async (req, res) => {
    try {
        const { roleId } = req.params;
        const permissions = await db.all('SELECT permission_id FROM role_permissions WHERE role_id = ?', roleId);
        res.json(permissions.map(p => p.permission_id));
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

panelAdminRouter.put('/roles/:roleId/permissions', requireAdmin, async (req, res) => {
    let transactionStarted = false;
    try {
        const { roleId } = req.params;
        const { permissionIds } = req.body;

        if (!Array.isArray(permissionIds)) {
            return res.status(400).json({ message: 'permissionIds must be an array.' });
        }
        
        const role = await db.get('SELECT name FROM roles WHERE id = ?', roleId);
        if (role && role.name.toLowerCase() === 'administrator') {
            return res.status(403).json({ message: 'Administrator permissions cannot be modified.' });
        }

        await db.exec('BEGIN TRANSACTION;');
        transactionStarted = true;
        await db.run('DELETE FROM role_permissions WHERE role_id = ?', roleId);
        for (const permId of permissionIds) {
            await db.run('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', roleId, permId);
        }
        await db.exec('COMMIT;');
        transactionStarted = false;
        
        res.json({ message: 'Permissions updated successfully.' });

    } catch (e) {
        if (transactionStarted) {
            try { await db.exec('ROLLBACK;'); } catch (rbErr) { console.error('Rollback failed:', rbErr); }
        }
        res.status(500).json({ message: e.message });
    }
});


app.use('/api', panelAdminRouter);


// --- ESBuild Middleware for TS/TSX ---
app.use(async (req, res, next) => {
    if (req.path.endsWith('.tsx') || req.path.endsWith('.ts')) {
        try {
            const filePath = path.join(__dirname, '..', req.path);
            const source = await fs.promises.readFile(filePath, 'utf8');
            const result = await esbuild.transform(source, {
                loader: req.path.endsWith('.tsx') ? 'tsx' : 'ts',
                format: 'esm'
            });
            res.type('application/javascript').send(result.code);
        } catch (error) {
            console.error(`esbuild error: ${error}`);
            res.status(500).send('Error compiling TypeScript file.');
        }
    } else {
        next();
    }
});

// --- API Endpoints ---

// Host Status
app.get('/api/host-status', protect, (req, res) => {
    const getCpuUsage = () => new Promise(resolve => {
        exec("top -bn1 | grep 'Cpu(s)' | sed 's/.*, *\\([0-9.]*\\)%* id.*/\\1/' | awk '{print 100 - $1}'", (err, stdout) => {
            resolve(parseFloat(stdout.trim()) || 0);
        });
    });

    const getMemoryUsage = () => new Promise(resolve => {
        exec("free -m | awk 'NR==2{printf \"{\\\"total\\\":\\\"%sMB\\\", \\\"used\\\":\\\"%sMB\\\", \\\"free\\\":\\\"%sMB\\\", \\\"percent\\\":%.2f}\", $2, $3, $4, $3*100/$2 }'", (err, stdout) => {
             resolve(JSON.parse(stdout));
        });
    });

    const getDiskUsage = () => new Promise(resolve => {
         exec("df -h / | awk 'NR==2{printf \"{\\\"total\\\":\\\"%s\\\", \\\"used\\\":\\\"%s\\\", \\\"free\\\":\\\"%s\\\", \\\"percent\\\":%d}\", $2, $3, $4, $5}'", (err, stdout) => {
            resolve(JSON.parse(stdout));
        });
    });
    
    Promise.all([getCpuUsage(), getMemoryUsage(), getDiskUsage()]).then(([cpu, mem, disk]) => {
        res.json({ cpuUsage: cpu, memory: mem, disk });
    }).catch(err => res.status(500).json({ message: err.message }));
});

// Panel NTP Status
app.get('/api/system/host-ntp-status', protect, (req, res) => {
    exec("timedatectl status | grep 'NTP service:'", (err, stdout, stderr) => {
        if (err) {
            console.error("Failed to get NTP status:", stderr);
            return res.status(500).json({ message: "Could not retrieve NTP status from host. 'timedatectl' may not be available." });
        }
        const enabled = stdout.includes('active');
        res.json({ enabled });
    });
});

app.post('/api/system/host-ntp/toggle', protect, (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
        return res.status(400).json({ message: 'A boolean "enabled" property is required.' });
    }
    exec(`sudo timedatectl set-ntp ${enabled}`, (err, stdout, stderr) => {
        if (err) {
            console.error("Failed to toggle NTP:", stderr);
            return res.status(500).json({ message: `Failed to set NTP status. Make sure the panel's user has passwordless sudo rights for 'timedatectl'. Error: ${stderr}` });
        }
        res.json({ message: `NTP service has been ${enabled ? 'enabled' : 'disabled'}.` });
    });
});


// Generic Database API
const tableMap = {
    'sales': 'sales_records',
    'billing-plans': 'billing_plans',
    'company-settings': 'company_settings',
    'panel-settings': 'panel_settings',
    'voucher-plans': 'voucher_plans',
    'notifications': 'notifications',
    'dhcp_clients': 'dhcp_clients',
    'dhcp-billing-plans': 'dhcp_billing_plans',
    'employees': 'employees',
    'employee-benefits': 'employee_benefits',
    'time-records': 'time_records',
};

const dbRouter = express.Router();

dbRouter.use('/:table', (req, res, next) => {
    const originalTable = req.params.table;
    req.tableName = tableMap[originalTable] || originalTable;
    next();
});

dbRouter.get('/:table', async (req, res) => {
    try {
        const { routerId } = req.query;
        let query = `SELECT * FROM ${req.tableName}`;
        const params = [];

        const cols = await db.all(`PRAGMA table_info(${req.tableName});`);
        const hasRouterId = cols.some(c => c.name === 'routerId');

        if (hasRouterId) {
            if (routerId) {
                query += ' WHERE routerId = ?';
                params.push(routerId);
            } else {
                // If the table is router-specific but no routerId is provided, return an empty array.
                return res.json([]);
            }
        }
        
        const items = await db.all(query, params);
        res.json(items);
    } catch (e) { res.status(500).json({ message: e.message }); }
});
// ... more generic routes
dbRouter.post('/:table', async (req, res) => {
    try {
        const columns = Object.keys(req.body).join(', ');
        const placeholders = Object.keys(req.body).map(() => '?').join(', ');
        const values = Object.values(req.body);
        await db.run(`INSERT INTO ${req.tableName} (${columns}) VALUES (${placeholders})`, values);
        res.status(201).json({ message: 'Created' });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

dbRouter.patch('/:table/:id', async (req, res) => {
     try {
        const updates = Object.keys(req.body).map(key => `${key} = ?`).join(', ');
        const values = [...Object.values(req.body), req.params.id];
        await db.run(`UPDATE ${req.tableName} SET ${updates} WHERE id = ?`, values);
        res.json({ message: 'Updated' });
    } catch (e) { res.status(500).json({ message: e.message }); }
});
dbRouter.delete('/:table/:id', async (req, res) => {
    try {
        await db.run(`DELETE FROM ${req.tableName} WHERE id = ?`, req.params.id);
        res.status(204).send();
    } catch (e) { res.status(500).json({ message: e.message }); }
});
dbRouter.post('/:table/clear-all', async (req, res) => {
    try {
        const { routerId } = req.body;
        let query = `DELETE FROM ${req.tableName}`;
        const params = [];

        const cols = await db.all(`PRAGMA table_info(${req.tableName});`);
        const hasRouterId = cols.some(c => c.name === 'routerId');

        if (hasRouterId) {
            if (routerId) {
                 query += ' WHERE routerId = ?';
                 params.push(routerId);
            } else {
                // If routerId is required but not provided, do nothing and return error
                return res.status(400).json({ message: 'routerId is required to clear this table.' });
            }
        }
        
        await db.run(query, params);
        res.status(204).send();
    } catch(e) { res.status(500).json({ message: e.message }); }
});

// --- Database Routes ---

// Special handlers for key-value settings tables
const createSettingsHandler = (tableName) => async (req, res) => {
    try {
        const rows = await db.all(`SELECT * FROM ${tableName}`);
        const settings = rows.reduce((acc, row) => {
            try { acc[row.key] = JSON.parse(row.value); }
            catch { acc[row.key] = row.value; }
            return acc;
        }, {});
        res.json(settings);
    } catch (e) { res.status(500).json({ message: e.message }); }
};
const createSettingsSaver = (tableName) => async (req, res) => {
    let transactionStarted = false;
    try {
        await db.exec('BEGIN TRANSACTION;');
        transactionStarted = true;
        for (const [key, value] of Object.entries(req.body)) {
            await db.run(`INSERT OR REPLACE INTO ${tableName} (key, value) VALUES (?, ?);`, key, JSON.stringify(value));
        }
        await db.exec('COMMIT;');
        transactionStarted = false;
        res.json({ message: 'Settings saved.' });
    } catch (e) {
        if (transactionStarted) {
            try { await db.exec('ROLLBACK;'); } catch (rbErr) { console.error('Rollback failed:', rbErr); }
        }
        res.status(500).json({ message: e.message });
    }
};

app.get('/api/db/panel-settings', protect, createSettingsHandler('panel_settings'));
app.post('/api/db/panel-settings', protect, createSettingsSaver('panel_settings'));
app.get('/api/db/company-settings', protect, createSettingsHandler('company_settings'));
app.post('/api/db/company-settings', protect, createSettingsSaver('company_settings'));

app.use('/api/db', protect, dbRouter);


// --- ZeroTier CLI ---
const ztCli = (command) => new Promise((resolve, reject) => {
    exec(`sudo zerotier-cli -j ${command}`, (error, stdout, stderr) => {
        if (error) {
            const errMsg = stderr || error.message;
            if (errMsg.includes("sudo: a terminal is required") || errMsg.includes("sudo: a password is required")) {
                return reject({ status: 403, code: 'SUDO_PASSWORD_REQUIRED', message: 'Passwordless sudo is not configured correctly for the panel user.' });
            }
            if (stderr.includes("zerotier-cli: missing authentication token")) {
                return reject({ status: 500, code: 'ZEROTIER_SERVICE_DOWN', message: 'ZeroTier service is not running or token is missing.' });
            }
            if (error.message.includes('No such file or directory')) {
                return reject({ status: 404, code: 'ZEROTIER_NOT_INSTALLED', message: 'zerotier-cli not found.' });
            }
            return reject({ status: 500, message: errMsg });
        }
        try {
            resolve(JSON.parse(stdout));
        } catch (parseError) {
            reject({ status: 500, message: `Failed to parse zerotier-cli output: ${stdout}` });
        }
    });
});

app.get('/api/zt/status', protect, async (req, res) => {
    try {
        const [info, networks] = await Promise.all([ztCli('info'), ztCli('listnetworks')]);
        res.json({ info, networks });
    } catch (err) {
        res.status(err.status || 500).json({ message: err.message, code: err.code });
    }
});
// ... other ZT routes
app.post('/api/zt/join', protect, async (req, res) => {
    try {
        const { networkId } = req.body;
        await ztCli(`join ${networkId}`);
        res.json({ message: 'Join command sent.' });
    } catch(err) { res.status(err.status || 500).json({ message: err.message }); }
});
app.post('/api/zt/leave', protect, async (req, res) => {
    try {
        const { networkId } = req.body;
        await ztCli(`leave ${networkId}`);
        res.json({ message: 'Leave command sent.' });
    } catch(err) { res.status(err.status || 500).json({ message: err.message }); }
});
app.post('/api/zt/set', protect, async (req, res) => {
    try {
        const { networkId, setting, value } = req.body;
        await ztCli(`set ${networkId} ${setting}=${value}`);
        res.json({ message: 'Setting updated.' });
    } catch(err) { res.status(err.status || 500).json({ message: err.message }); }
});

// ZT Installer
app.get('/api/zt/install', protect, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const child = exec('curl -s https://install.zerotier.com | sudo bash');
    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    child.stdout.on('data', log => send({ log }));
    child.stderr.on('data', log => send({ log }));
    child.on('close', code => {
        if (code === 0) {
            send({ status: 'success' });
        } else {
            send({ status: 'error', message: 'Installation script failed.' });
        }
        send({ status: 'finished' });
        res.end();
    });
});

// --- Host Router Endpoints ---
const runSudo = (command) => new Promise((resolve, reject) => {
    exec(`sudo ${command}`, (err, stdout, stderr) => {
        if (err) {
            console.error(`Sudo error for command "${command}": ${stderr}`);
            if (stderr.includes("sudo: a terminal is required") || stderr.includes("sudo: a password is required")) {
                return reject(new Error('Passwordless sudo is not configured correctly for the panel user.'));
            }
            return reject(new Error(stderr || err.message));
        }
        resolve(stdout);
    });
});

app.get('/api/host/network-config', protect, async (req, res) => {
    try {
        // 1. Get interfaces
        const rawIfaces = os.networkInterfaces();
        const interfaces = Object.entries(rawIfaces).map(([name, details]) => {
            const ipv4 = details.find(d => d.family === 'IPv4' && !d.internal);
            // Find the mac from any of the interface's addresses, as it can be on IPv6 etc.
            const mac = details.find(d => d.mac)?.mac || 'N/A';
            return {
                name,
                ip4: ipv4 ? `${ipv4.address}/${ipv4.netmask}` : 'N/A',
                mac: mac
            };
        }).filter(iface => iface.name !== 'lo');

        // 2. Check IP forwarding
        const ipForwarding = await fsPromises.readFile('/proc/sys/net/ipv4/ip_forward', 'utf-8');

        // 3. Check for our specific NAT rule
        const iptablesRules = await runSudo('iptables-save').catch(() => '');
        const natActive = iptablesRules.includes('-A POSTROUTING -m comment --comment "super-router-nat" -j MASQUERADE');
        
        // 4. Check dnsmasq status
        const dnsmasqStatus = await runSudo('systemctl is-active dnsmasq').catch(() => 'inactive');

        // 5. Try to read our saved config
        const configPath = path.join(__dirname, 'super-router.json');
        let savedConfig = {};
        try {
            const file = await fsPromises.readFile(configPath, 'utf-8');
            savedConfig = JSON.parse(file);
        } catch (e) { /* file doesn't exist, that's fine */ }

        res.json({
            ipForwarding: ipForwarding.trim() === '1',
            interfaces,
            natActive,
            dnsmasqActive: dnsmasqStatus.trim() === 'active',
            ...savedConfig
        });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

app.post('/api/host/apply-network-config', protect, async (req, res) => {
    const { wan, lan, lanIp } = req.body;
    if (!wan || !lan || !lanIp) {
        return res.status(400).json({ message: 'WAN interface, LAN interface, and LAN IP are required.' });
    }

    try {
        const lanIpParts = lanIp.split('/'); // e.g., '192.168.100.1/24'
        const lanAddress = lanIpParts[0];

        // 1. Configure interfaces
        await runSudo(`ip addr flush dev ${lan}`);
        await runSudo(`ip addr add ${lanIp} dev ${lan}`);
        await runSudo(`ip link set dev ${lan} up`);
        // We assume WAN is DHCP
        await runSudo(`dhclient -r ${wan}`).catch(e => console.warn(`Could not release DHCP on ${wan}: ${e.message}`));
        await runSudo(`dhclient ${wan}`).catch(e => console.warn(`Could not get DHCP on ${wan}: ${e.message}`));

        // 2. Enable IP Forwarding
        await runSudo('sysctl -w net.ipv4.ip_forward=1');

        // 3. Set up NAT
        await runSudo('iptables -t nat -F POSTROUTING'); // Flush old rules to prevent duplicates
        await runSudo(`iptables -t nat -A POSTROUTING -o ${wan} -j MASQUERADE -m comment --comment "super-router-nat"`);

        // 4. Configure and start dnsmasq for DHCP on LAN
        const lanSubnetStart = lanAddress.substring(0, lanAddress.lastIndexOf('.')) + '.100';
        const lanSubnetEnd = lanAddress.substring(0, lanAddress.lastIndexOf('.')) + '.200';
        const dnsmasqConf = `
interface=${lan}
dhcp-range=${lanSubnetStart},${lanSubnetEnd},12h
dhcp-option=option:router,${lanAddress}
dhcp-option=option:dns-server,8.8.8.8,1.1.1.1
log-dhcp
`;
        await fsPromises.writeFile('/tmp/dnsmasq.conf.super-router', dnsmasqConf);
        await runSudo(`mv /tmp/dnsmasq.conf.super-router /etc/dnsmasq.d/super-router.conf`);
        await runSudo('systemctl restart dnsmasq');
        
        // 5. Save config for status check
        const configPath = path.join(__dirname, 'super-router.json');
        const configToSave = { wanInterface: wan, lanInterface: lan, lanIp };
        await fsPromises.writeFile(configPath, JSON.stringify(configToSave, null, 2));

        res.json({ message: 'Router configuration applied successfully! Please test your network.' });
    } catch (e) {
        res.status(500).json({ message: `Failed to apply configuration: ${e.message}` });
    }
});

app.post('/api/host/revert-network-config', protect, async (req, res) => {
    try {
        const configPath = path.join(__dirname, 'super-router.json');
        let savedConfig = {};
        try {
            const file = await fsPromises.readFile(configPath, 'utf-8');
            savedConfig = JSON.parse(file);
        } catch (e) { 
            return res.status(404).json({ message: 'No saved configuration found to revert.' });
        }
        
        const { wanInterface, lanInterface } = savedConfig;
        
        await runSudo('systemctl stop dnsmasq').catch(e => console.warn(e.message));
        await runSudo('rm /etc/dnsmasq.d/super-router.conf').catch(e => console.warn(e.message));
        
        if (wanInterface) {
            await runSudo(`iptables -t nat -D POSTROUTING -o ${wanInterface} -j MASQUERADE -m comment --comment "super-router-nat"`).catch(e => console.warn(e.message));
        }

        await runSudo('sysctl -w net.ipv4.ip_forward=0');

        if (lanInterface) {
            await runSudo(`ip addr flush dev ${lanInterface}`).catch(e => console.warn(e.message));
            await runSudo(`dhclient ${lanInterface}`).catch(e => console.warn(`Could not get DHCP on ${lanInterface}: ${e.message}`));
        }

        await fsPromises.unlink(configPath);
        
        res.json({ message: 'Attempted to revert router configuration. You may need to reboot for settings to fully restore.' });

    } catch (e) {
        res.status(500).json({ message: `Failed to revert configuration: ${e.message}` });
    }
});

// --- Host Logs ---
app.get('/api/host/logs', protect, async (req, res) => {
    const { type } = req.query;
    const lines = '150';
    let command;
    let logPath;

    switch (type) {
        case 'panel-ui':
            command = `sudo pm2 logs mikrotik-manager --lines ${lines} --nostream`;
            break;
        case 'panel-api':
            command = `sudo pm2 logs mikrotik-api-backend --lines ${lines} --nostream`;
            break;
        case 'nginx-access':
            logPath = '/var/log/nginx/access.log';
            command = `sudo tail -n ${lines} ${logPath}`;
            break;
        case 'nginx-error':
            logPath = '/var/log/nginx/error.log';
            command = `sudo tail -n ${lines} ${logPath}`;
            break;
        default:
            return res.status(400).json({ message: 'Invalid log type specified.' });
    }

    exec(command, (err, stdout, stderr) => {
        if (err) {
            let errMsg = stderr || err.message;
            if (errMsg.includes("sudo: a terminal is required") || errMsg.includes("sudo: a password is required")) {
                errMsg = 'Passwordless sudo is not configured correctly for the panel user to run `pm2` and `tail` commands.';
            } else if (logPath && (errMsg.includes('No such file or directory') || errMsg.includes('cannot open'))) {
                 errMsg = `Log file not found at ${logPath}. Is Nginx installed and logging to the default location?`;
            } else if (errMsg.includes('command not found')) {
                errMsg = `The command required to fetch logs was not found. Ensure 'pm2' and 'tail' are installed and in the system's PATH.`;
            }
            console.error(`Log fetch error for "${type}": ${stderr}`);
            return res.status(500).type('text/plain').send(errMsg);
        }
        res.type('text/plain').send(stdout || `Log is empty.`);
    });
});


// --- AI Fixer ---
app.get('/api/fixer/file-content', protect, async (req, res) => {
    try {
        const content = await fs.promises.readFile(API_BACKEND_FILE, 'utf-8');
        res.type('text/plain').send(content);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.post('/api/fixer/apply-fix', protect, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    
    const newCode = req.body;
    
    const apply = async () => {
        try {
            send({ log: 'Writing new code to api-backend/server.js...' });
            await fs.promises.writeFile(API_BACKEND_FILE, newCode, 'utf-8');
            send({ log: 'Restarting the API backend service with pm2...' });
            
            exec('pm2 restart mikrotik-api-backend', (err, stdout, stderr) => {
                if (err) {
                    send({ log: `PM2 restart failed: ${stderr}` });
                    send({ status: 'error', message: 'Failed to restart backend service.' });
                } else {
                    send({ log: 'Backend service restarted successfully.' });
                    send({ status: 'restarting' });
                }
                res.end();
            });

        } catch (e) {
            send({ status: 'error', message: e.message });
            res.end();
        }
    };
    apply();
});

// Report Generator
app.post('/api/generate-report', protect, async (req, res) => {
    try {
        const { view, routerName, geminiAnalysis } = req.body;
        const backendCode = await fs.promises.readFile(API_BACKEND_FILE, 'utf-8').catch(() => 'Could not read backend file.');
        
        let report = `--- MIKROTIK PANEL SYSTEM REPORT ---\n`;
        report += `Date: ${new Date().toISOString()}\n\n`;
        report += `--- AI DIAGNOSIS SUMMARY ---\n${geminiAnalysis}\n\n`;
        report += `--- CONTEXT ---\n`;
        report += `Current View: ${view}\n`;
        report += `Selected Router: ${routerName || 'None'}\n\n`;
        report += `--- BACKEND CODE (api-backend/server.js) ---\n\n${backendCode}\n`;
        
        res.setHeader('Content-disposition', 'attachment; filename=mikrotik-panel-report.txt');
        res.setHeader('Content-type', 'text/plain');
        res.charset = 'UTF-8';
        res.write(report);
        res.end();

    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});


// --- Updater and Backups ---
const runCommandStream = (command, res, options = {}) => {
    return new Promise((resolve, reject) => {
        const child = exec(command, { cwd: path.join(__dirname, '..'), ...options });
        
        const stdoutChunks = [];
        const stderrChunks = [];

        child.stdout.on('data', data => {
            const log = data.toString();
            if (res) res.write(`data: ${JSON.stringify({ log })}\n\n`);
            stdoutChunks.push(log);
        });

        child.stderr.on('data', data => {
            const log = data.toString();
            const isError = !log.startsWith('Receiving objects:') && !log.startsWith('Resolving deltas:');
            if (res) res.write(`data: ${JSON.stringify({ log, isError })}\n\n`);
            stderrChunks.push(log);
        });

        child.on('close', code => {
            const stdout = stdoutChunks.join('').trim();
            const stderr = stderrChunks.join('').trim();
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(stderr || `Command failed with exit code ${code}`));
            }
        });

        child.on('error', err => {
            reject(err);
        });
    });
};

const runCommand = (command) => runCommandStream(command, null);

// --- Ngrok Endpoints ---
const ngrokApi = express.Router();
ngrokApi.use(protect);

ngrokApi.get('/status', async (req, res) => {
    try {
        const installed = fs.existsSync(NGROK_BINARY_PATH);
        let active = false;
        let url = null;
        let config = null;

        if (installed) {
            const statusOutput = await runSudo('systemctl is-active ngrok.service').catch(() => 'inactive');
            active = statusOutput.trim() === 'active';
            
            if (active) {
                try {
                    const agentResponse = await new Promise((resolve, reject) => {
                        const http = require('http');
                        http.get('http://127.0.0.1:4040/api/tunnels', (resp) => {
                            let data = '';
                            resp.on('data', (chunk) => data += chunk);
                            resp.on('end', () => resolve(JSON.parse(data)));
                        }).on("error", (err) => reject(err));
                    });
                    const tunnels = agentResponse.tunnels;
                    if (tunnels && tunnels.length > 0) {
                        url = tunnels[0].public_url;
                    }
                } catch (e) {
                    console.warn("Could not connect to Ngrok agent API:", e.message);
                }
            }
        }
        
        try {
            const savedConfig = await fsPromises.readFile(NGROK_CONFIG_PATH, 'utf-8');
            config = JSON.parse(savedConfig);
        } catch (e) { /* config file might not exist, which is fine */ }

        res.json({ installed, active, url, config });
    } catch (e) {
        res.status(500).json({ message: e.message, code: 'SUDO_ERROR' });
    }
});

ngrokApi.post('/settings', async (req, res) => {
    try {
        await fsPromises.writeFile(NGROK_CONFIG_PATH, JSON.stringify(req.body, null, 2));
        res.json({ message: 'Settings saved.' });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

ngrokApi.post('/control/:action', async (req, res) => {
    const { action } = req.params;
    if (!['stop', 'start', 'restart'].includes(action)) {
        return res.status(400).json({ message: 'Invalid action.' });
    }
    try {
        await runSudo(`systemctl ${action} ngrok.service`);
        res.json({ message: `Ngrok service ${action}ed.` });
    } catch (e) {
        res.status(500).json({ message: e.message, code: 'SUDO_ERROR' });
    }
});

const createStreamHandler = (commandGenerator) => (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    const run = async () => {
        try {
            const commands = await commandGenerator(req);
            for (const { cmd, msg } of commands) {
                send({ log: msg });
                await runCommandStream(cmd, res);
            }
            send({ status: 'success', log: 'Operation completed successfully.' });
        } catch (e) {
            send({ status: 'error', log: e.message, isError: true });
        } finally {
            send({ status: 'finished' });
            res.end();
        }
    };
    run();
};

ngrokApi.get('/install', createStreamHandler(async (req) => {
    const config = JSON.parse(await fsPromises.readFile(NGROK_CONFIG_PATH, 'utf-8'));
    if (!config.authtoken) throw new Error('Authtoken is not set.');
    
    const arch = os.arch() === 'arm64' ? 'arm64' : 'arm';
    const url = `https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-${arch}.tgz`;
    const user = os.userInfo().username;
    
    const serviceFileContent = `[Unit]
Description=Ngrok Tunnel Service
After=network-online.target

[Service]
ExecStart=/usr/local/bin/ngrok ${config.proto || 'http'} ${config.port || 80}
Restart=always
RestartSec=10
User=${user}

[Install]
WantedBy=multi-user.target
`;
    await fsPromises.writeFile('/tmp/ngrok.service', serviceFileContent);

    return [
        { cmd: 'sudo systemctl stop ngrok.service', msg: 'Stopping existing service (if any)...' },
        { cmd: `curl -L ${url} -o /tmp/ngrok.tgz`, msg: `Downloading Ngrok for ${arch}...` },
        { cmd: 'tar -xzf /tmp/ngrok.tgz -C /tmp', msg: 'Extracting archive...'},
        { cmd: 'sudo mv /tmp/ngrok /usr/local/bin/ngrok', msg: 'Moving binary to /usr/local/bin...'},
        { cmd: 'sudo chmod +x /usr/local/bin/ngrok', msg: 'Setting executable permissions...'},
        { cmd: `/usr/local/bin/ngrok config add-authtoken ${config.authtoken}`, msg: 'Configuring authtoken...'},
        { cmd: 'sudo mv /tmp/ngrok.service /etc/systemd/system/ngrok.service', msg: 'Creating systemd service...'},
        { cmd: 'sudo systemctl daemon-reload', msg: 'Reloading systemd...'},
        { cmd: 'sudo systemctl enable ngrok.service', msg: 'Enabling service to start on boot...'},
        { cmd: 'sudo systemctl start ngrok.service', msg: 'Starting Ngrok service...'}
    ];
}));

ngrokApi.get('/uninstall', createStreamHandler(async (req) => {
    return [
        { cmd: 'sudo systemctl stop ngrok.service', msg: 'Stopping service...' },
        { cmd: 'sudo systemctl disable ngrok.service', msg: 'Disabling service...' },
        { cmd: 'sudo rm /etc/systemd/system/ngrok.service', msg: 'Removing service file...' },
        { cmd: 'sudo systemctl daemon-reload', msg: 'Reloading systemd...' },
        { cmd: `sudo rm ${NGROK_BINARY_PATH}`, msg: 'Deleting ngrok binary...' },
        { cmd: `rm ${NGROK_CONFIG_PATH}`, msg: 'Deleting config file...' }
    ];
}));

app.use('/api/ngrok', ngrokApi);

// --- Dataplicity Endpoints ---
const dataplicityApi = express.Router();
dataplicityApi.use(protect);

const DATAPLICITY_SERVICE_PATH = '/etc/systemd/system/dataplicity.service';

dataplicityApi.get('/status', async (req, res) => {
    try {
        const installed = fs.existsSync(DATAPLICITY_SERVICE_PATH);
        const active = installed ? (await runSudo('systemctl is-active dataplicity.service').catch(() => 'inactive')).trim() === 'active' : false;
        res.json({ installed, active, url: 'https://app.dataplicity.com/' });
    } catch (e) {
        res.status(500).json({ message: e.message, code: 'SUDO_ERROR' });
    }
});

const createCommandStreamer = (commandGetter) => (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
        const command = commandGetter(req);
        if (!command || !command.trim()) {
            send({ status: 'error', message: 'Invalid command provided.' });
            res.end();
            return;
        }
        
        send({ log: `Executing command...` });
        const child = exec(command);

        child.stdout.on('data', data => send({ log: data.toString() }));
        child.stderr.on('data', data => send({ log: data.toString(), isError: true }));
        child.on('close', code => {
            if (code === 0) {
                send({ status: 'success' });
            } else {
                send({ status: 'error', message: 'Script failed with a non-zero exit code.' });
            }
            send({ status: 'finished' });
            res.end();
        });
        child.on('error', err => {
            send({ status: 'error', message: err.message });
            send({ status: 'finished' });
            res.end();
        });
    } catch (e) {
        send({ status: 'error', message: e.message });
        send({ status: 'finished' });
        res.end();
    }
};

dataplicityApi.post('/install', createCommandStreamer(req => req.body.command));
dataplicityApi.get('/uninstall', createCommandStreamer(() => 'curl -s https://www.dataplicity.com/uninstall.py | sudo python3'));

app.use('/api/dataplicity', dataplicityApi);

// --- PiTunnel Endpoints ---
const piTunnelApi = express.Router();
piTunnelApi.use(protect);

const PITUNNEL_BINARY_PATH = '/usr/local/bin/pitunnel';

piTunnelApi.get('/status', async (req, res) => {
    try {
        const installed = fs.existsSync(PITUNNEL_BINARY_PATH);
        let active = false;
        let url = null;

        if (installed) {
            const statusOutput = await runSudo('systemctl is-active pitunnel.service').catch(() => 'inactive');
            active = statusOutput.trim() === 'active';
            
            if (active) {
                try {
                    const logs = await runSudo('journalctl -u pitunnel.service -n 20 --no-pager');
                    const urlMatch = logs.match(/Tunnel is online at:\s*(https:\/\/[a-zA-Z0-9-]+\.pitunnel\.com)/);
                    if (urlMatch && urlMatch[1]) {
                        url = urlMatch[1];
                    }
                } catch (e) {
                    console.warn("Could not get PiTunnel URL from logs:", e.message);
                }
            }
        }
        res.json({ installed, active, url });
    } catch (e) {
        res.status(500).json({ message: e.message, code: 'SUDO_ERROR' });
    }
});

piTunnelApi.post('/install', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    const { command } = req.body;

    if (!command || !command.trim().startsWith('curl')) {
        send({ status: 'error', message: 'Invalid installation command provided.' });
        res.end();
        return;
    }
    
    send({ log: `Executing installation script...` });
    const child = exec(command);

    child.stdout.on('data', data => send({ log: data.toString() }));
    child.stderr.on('data', data => send({ log: data.toString(), isError: true }));
    child.on('close', code => {
        if (code === 0) {
            send({ log: 'Installation script finished. Enabling and starting service...' });
            exec('sudo systemctl enable pitunnel.service && sudo systemctl start pitunnel.service', (err, stdout, stderr) => {
                if (err) {
                    send({ log: `Failed to start service: ${stderr}`, isError: true });
                    send({ status: 'error', message: 'Installation succeeded, but failed to start the service.' });
                } else {
                    send({ log: 'Service started successfully.' });
                    send({ status: 'success' });
                }
                send({ status: 'finished' });
                res.end();
            });
        } else {
            send({ status: 'error', message: 'Installation script failed.' });
            send({ status: 'finished' });
            res.end();
        }
    });
    child.on('error', err => {
        send({ status: 'error', message: err.message });
        send({ status: 'finished' });
        res.end();
    });
});

piTunnelApi.get('/uninstall', createCommandStreamer(() => 'sudo /usr/local/bin/pitunnel --remove'));

app.use('/api/pitunnel', piTunnelApi);


app.get('/api/current-version', protect, async (req, res) => {
    try {
        await runCommand("git rev-parse --is-inside-work-tree");

        // Fetch version info and remote URL in parallel
        const [logOutput, remoteUrl] = await Promise.all([
            runCommand("git log -1 --pretty=format:'%h%x00%s%x00%b'"),
            runCommand("git config --get remote.origin.url").catch(() => 'N/A') // Default to 'N/A' if it fails
        ]);

        if (!logOutput.trim()) {
            return res.json({ 
                hash: 'N/A', 
                title: 'No Commits Found', 
                description: 'This repository does not have any commits yet.',
                remoteUrl: remoteUrl.trim()
            });
        }
        
        const parts = logOutput.split('\0');
        const versionInfo = {
            hash: parts[0] || '',
            title: parts[1] || '',
            description: (parts[2] || '').trim(),
            remoteUrl: remoteUrl.trim()
        };

        res.json(versionInfo);

    } catch (e) {
        let message = e.message;
        if (message.includes('not a git repository')) {
            message = 'This is not a git repository. The updater requires the application to be cloned from git.';
        } else {
             message = 'Failed to parse version information from git. The repository might be in a strange state.';
        }
        res.status(500).json({ message });
    }
});

app.get('/api/update-status', protect, async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
        send({ log: "Verifying git repository..." });
        await runCommand('git rev-parse --is-inside-work-tree');
        
        send({ log: "Connecting to remote repository..." });
        await runCommandStream('git fetch', res);
        send({ log: "Remote repository checked." });

        const [local, remote, mergeBase] = await Promise.all([
            runCommand('git rev-parse HEAD'),
            runCommand('git rev-parse @{u}'),
            runCommand('git merge-base HEAD @{u}')
        ]);
        
        if (local === remote) {
            send({ status: 'uptodate', message: 'Panel is up to date.' });
        } else if (local === mergeBase) {
            send({ status: 'available', message: 'New version available.' });
            const changelog = await runCommand("git log ..origin/main --pretty=format:'%h - %s (%cr)'");
            send({ newVersionInfo: {
                title: "New update found",
                description: "A new version of the panel is available.",
                changelog: changelog.trim()
            }});
        } else if (remote === mergeBase) {
            send({ status: 'ahead', message: 'Your version is ahead of the official repository.' });
        } else {
            send({ status: 'diverged', message: 'Your version has diverged. Manual update required.' });
        }

    } catch (e) {
        let message = e.message;
        if (message.includes('fatal: not a git repository')) {
            message = 'This is not a git repository. The updater requires the application to be cloned from git.';
        } else if (message.includes('Could not resolve host: github.com') || message.includes('fatal: unable to access')) {
            message = 'Failed to connect to GitHub. Please check your server\'s internet connection and DNS settings.';
        } else if (message.includes('fatal: no upstream configured')) {
            message = 'Git repository has no upstream branch configured. Unable to check for updates.';
        }
        send({ status: 'error', message });
    } finally {
        send({ status: 'finished' });
        res.end();
    }
});

app.get('/api/update-app', protect, async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
        const backupFile = `backup-update-${new Date().toISOString().replace(/:/g, '-')}.tar.gz`;
        send({ log: `Creating application backup: ${backupFile}...` });
        
        const projectRoot = path.join(__dirname, '..');
        const archivePath = path.join(BACKUP_DIR, backupFile);
        
        await new Promise((resolve, reject) => {
            const output = fs.createWriteStream(archivePath);
            const archive = archiver('tar', { gzip: true });

            output.on('close', () => {
                send({ log: `Backup complete. Size: ${(archive.pointer() / 1024).toFixed(2)} KB` });
                resolve();
            });

            archive.on('warning', (err) => {
                send({ log: `Archive warning: ${err.message}`, isError: true });
            });

            archive.on('error', (err) => {
                reject(new Error(`Failed to create backup archive: ${err.message}`));
            });

            archive.pipe(output);
            archive.glob('**/*', {
                cwd: projectRoot,
                ignore: ['proxy/backups/**', '.git/**', '**/node_modules/**'],
                dot: true
            });
            archive.finalize();
        });
        
        send({ log: 'Pulling latest changes from git...' });
        await runCommandStream('git pull', res);
        
        send({ log: 'Installing dependencies for UI server...' });
        await runCommandStream('npm install --prefix proxy', res);

        send({ log: 'Installing dependencies for API backend...' });
        await runCommandStream('npm install --prefix api-backend', res);
        
        send({ log: 'Restarting panel services...' });
        exec('pm2 restart all', (err, stdout) => {
            if (err) {
                 send({ log: `PM2 restart failed: ${err.message}`, isError: true });
                 send({ status: 'error', message: err.message });
            } else {
                send({ log: stdout });
                send({ status: 'restarting' });
            }
            res.end();
        });

    } catch(e) {
        send({ log: e.message, isError: true });
        send({ status: 'error', message: e.message });
        res.end();
    }
});

app.get('/api/rollback-app', protect, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    const { backupFile } = req.query;
    if (!backupFile || backupFile.includes('..') || !backupFile.endsWith('.tar.gz')) {
        send({ status: 'error', message: 'Invalid application backup file specified.' });
        return res.end();
    }

    const rollback = async () => {
        try {
            send({ log: `Starting application rollback from ${backupFile}...`});
            const backupPath = path.join(BACKUP_DIR, backupFile);
            if (!fs.existsSync(backupPath)) {
                throw new Error('Backup file not found.');
            }
            
            send({ log: 'Extracting backup over current application files...'});
            const projectRoot = path.join(__dirname, '..');

            await tar.x({ // 'x' is for extract
                file: backupPath,
                cwd: projectRoot,
                onentry: (entry) => send({ log: `Restoring: ${entry.path}` })
            });
            send({ log: 'Extraction complete.' });

            send({ log: 'Re-installing dependencies for UI server...'});
            await runCommandStream('npm install --prefix proxy', res);

            send({ log: 'Re-installing dependencies for API backend...'});
            await runCommandStream('npm install --prefix api-backend', res);

            send({ log: 'Restarting panel services...'});
            exec('pm2 restart all', (err, stdout) => {
                 if (err) {
                     send({ log: `PM2 restart failed: ${err.message}`, isError: true });
                     send({ status: 'error', message: err.message });
                } else {
                    send({ log: stdout });
                    send({ status: 'restarting' });
                }
                res.end();
            });

        } catch (e) {
            send({ log: e.message, isError: true });
            send({ status: 'error', message: e.message });
            res.end();
        }
    };
    rollback();
});


// Database Backup/Restore
app.get('/api/create-backup', protect, async (req, res) => {
    const backupFile = `panel-db-backup-${new Date().toISOString().replace(/:/g, '-')}.sqlite`;
    try {
        await fs.promises.copyFile(DB_PATH, path.join(BACKUP_DIR, backupFile));
        res.json({ message: `Backup created successfully: ${backupFile}` });
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/list-backups', protect, async (req, res) => {
    try {
        const dirents = await fs.promises.readdir(BACKUP_DIR, { withFileTypes: true });
        // Filter out directories and hidden files, then sort
        const files = dirents
            .filter(dirent => dirent.isFile() && !dirent.name.startsWith('.'))
            .map(dirent => dirent.name)
            .sort()
            .reverse();
        res.json(files);
    } catch (e) { res.status(500).json({ message: e.message }); }
});


app.post('/api/delete-backup', protect, async (req, res) => {
    try {
        const { backupFile } = req.body;
        // Basic path sanitization
        if (backupFile.includes('..')) return res.status(400).json({ message: 'Invalid filename' });
        await fs.promises.unlink(path.join(BACKUP_DIR, backupFile));
        res.json({ message: 'Backup deleted.' });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/download-backup/:filename', protect, (req, res) => {
    const { filename } = req.params;
    if (filename.includes('..')) return res.status(400).send('Invalid filename');
    res.download(path.join(BACKUP_DIR, filename));
});

app.get('/api/restore-backup', protect, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    const { backupFile } = req.query;
    if (!backupFile || backupFile.includes('..')) {
        send({ status: 'error', message: 'Invalid backup file specified.' });
        return res.end();
    }

    const restore = async () => {
        try {
            send({ log: 'Closing current database connection...'});
            if(db) await db.close();

            send({ log: `Restoring from ${backupFile}...`});
            await fs.promises.copyFile(path.join(BACKUP_DIR, backupFile), DB_PATH);

            send({ log: 'Restarting panel service...'});
            exec('pm2 restart mikrotik-manager', (err) => {
                if (err) send({ status: 'error', message: err.message });
                else send({ status: 'restarting' });
                res.end();
            });

        } catch (e) {
            send({ status: 'error', message: e.message });
            res.end();
        }
    };
    restore();
});


// --- Static file serving ---
app.use(express.static(path.join(__dirname, '..')));

// SPA Fallback:
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// --- Start Server ---
Promise.all([initDb(), initSuperadminDb()]).then(() => {
    app.listen(PORT, () => {
        console.log(`Mikrotik Billling Management UI server running. Listening on http://localhost:${PORT}`);
    });
});