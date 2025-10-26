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
        if (!command) {
            send({ status: 'error', message: 'Invalid command provided.' });
            return res.end();
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
        return res.end();
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
```
    <file>services/piTunnelService.ts</file>
    <description>Create a new service file `piTunnelService.ts` to handle API requests for the Pi Tunnel manager, including getting status, installing, and uninstalling.</description>
    <content><![CDATA[import type { PiTunnelStatus } from '../types.ts';
import { getAuthHeader } from './databaseService.ts';

// A generic fetcher for simple JSON API calls
const fetchData = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
    const response = await fetch(path, {
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeader(),
            ...options.headers,
        },
        ...options,
    });
    
    if (response.status === 401) {
        localStorage.removeItem('authToken');
        window.location.reload();
        throw new Error('Session expired. Please log in again.');
    }
  
    const contentType = response.headers.get("content-type");
    if (!response.ok) {
        let errorMsg = `Request failed with status ${response.status}`;
        if (contentType && contentType.includes("application/json")) {
            const errorData = await response.json();
            errorMsg = errorData.message || errorMsg;
            const error = new Error(errorMsg);
            (error as any).data = errorData; // Attach full error data
            throw error;
        } else {
            errorMsg = await response.text();
        }
        throw new Error(errorMsg);
    }

    if (contentType && contentType.includes("application/json")) {
        return response.json() as Promise<T>;
    }
    return response.text() as unknown as Promise<T>;
};

// --- Streaming Logic using Fetch API ---
interface StreamCallbacks {
    onMessage: (data: any) => void;
    onError: (error: Error) => void;
    onClose?: () => void;
}

const streamEvents = async (url: string, options: RequestInit, callbacks: StreamCallbacks) => {
    try {
        const response = await fetch(url, options);

        if (response.status === 401) {
            localStorage.removeItem('authToken');
            window.location.reload();
            throw new Error('Session expired. Please log in again.');
        }

        if (!response.ok || !response.body) {
            throw new Error(`Failed to connect to stream: ${response.statusText}`);
        }

        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                if (callbacks.onClose) callbacks.onClose();
                break;
            }

            buffer += value;
            const parts = buffer.split('\n\n');
            buffer = parts.pop() || ''; // Keep the last, possibly incomplete, part

            for (const part of parts) {
                if (part.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(part.substring(6));
                        callbacks.onMessage(data);
                    } catch (e) {
                        console.error("Failed to parse SSE message:", e);
                    }
                }
            }
        }
    } catch (err) {
        callbacks.onError(err as Error);
    }
};

export const getPiTunnelStatus = () => fetchData<PiTunnelStatus>('/api/pitunnel/status');

export const streamInstallPiTunnel = (command: string, callbacks: StreamCallbacks) => {
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ command }),
    };
    streamEvents('/api/pitunnel/install', options, callbacks);
};

export const streamUninstallPiTunnel = (callbacks: StreamCallbacks) => {
    const options = {
        method: 'GET',
        headers: getAuthHeader(),
    };
    streamEvents('/api/pitunnel/uninstall', options, callbacks);
};
]]></content>
  </change>
  <change>
    <file>components/PiTunnel.tsx</file>
    <description>Create the new PiTunnel component, providing a UI to manage the Pi Tunnel service for remote access, including installation and status checks.</description>
    <content><![CDATA[import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getPiTunnelStatus, streamUninstallPiTunnel, streamInstallPiTunnel } from '../services/piTunnelService.ts';
import type { PiTunnelStatus } from '../types.ts';
import { Loader } from './Loader.tsx';
import { CheckCircleIcon, TrashIcon } from '../constants.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { CodeBlock } from './CodeBlock.tsx';

const LogViewer: React.FC<{ logs: {text: string, isError?: boolean}[] }> = ({ logs }) => {
    const logContainerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div ref={logContainerRef} className="bg-slate-100 dark:bg-slate-900 text-xs font-mono text-slate-700 dark:text-slate-300 p-4 rounded-md h-64 overflow-y-auto border border-slate-200 dark:border-slate-600">
            {logs.map((log, index) => (
                <pre key={index} className={`whitespace-pre-wrap break-words ${log.isError ? 'text-red-500' : ''}`}>{log.text}</pre>
            ))}
        </div>
    );
};

const SudoInstructionBox: React.FC = () => {
    const visudoCommand = `sudo visudo`;
    const lineToAdd = `<your_username> ALL=(ALL) NOPASSWD: /usr/bin/python3, /usr/local/bin/pitunnel, /bin/systemctl`;

    return (
        <div className="mt-4 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700/50 text-amber-900 dark:text-amber-200">
            <h4 className="font-bold">Sudo Permission Needed</h4>
            <div className="text-xs space-y-1 mt-2">
                <p>For this feature to work, the panel user needs passwordless sudo access for the installer script. SSH into your host machine and run <code className="font-bold">{visudoCommand}</code>. Add this line at the bottom, replacing <code className="font-bold">{'<your_username>'}</code>:</p>
                <CodeBlock script={lineToAdd} />
                 <p className="text-xs pt-2">Note: The path to `python3` might differ. You can find it by running `which python3` on your server.</p>
            </div>
        </div>
    );
};


export const PiTunnel: React.FC = () => {
    const { t } = useLocalization();
    const [status, setStatus] = useState<'loading' | 'not_installed' | 'installed' | 'uninstalling' | 'installing' | 'error'>('loading');
    const [data, setData] = useState<PiTunnelStatus | null>(null);
    const [logs, setLogs] = useState<{text: string, isError?: boolean}[]>([]);
    const [command, setCommand] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    const fetchData = useCallback(async () => {
        setStatus('loading');
        setLogs([]);
        setErrorMessage('');
        try {
            const result = await getPiTunnelStatus();
            setData(result);
            setStatus(result.installed ? 'installed' : 'not_installed');
        } catch (err) {
            setStatus('error');
            setErrorMessage((err as Error).message);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleStreamAction = (action: 'install' | 'uninstall') => {
        if (action === 'install' && !command.trim()) {
            setErrorMessage("Please paste the installation command from PiTunnel.com.");
            return;
        }
        
        setStatus(action === 'install' ? 'installing' : 'uninstalling');
        setLogs([]);
        setErrorMessage('');
        
        const streamFn = action === 'install' 
            ? (callbacks) => streamInstallPiTunnel(command, callbacks) 
            : streamUninstallPiTunnel;
        
        streamFn({
            onMessage: (data: any) => {
                if (data.log) setLogs(prev => [...prev, { text: data.log.trim(), isError: !!data.isError }]);
                if (data.status === 'error') {
                    setStatus('error');
                    setErrorMessage(data.message || 'An unknown error occurred.');
                }
            },
            onClose: () => {
                if (status !== 'error') {
                    setTimeout(fetchData, 1000); 
                }
            },
            onError: (err: Error) => {
                setStatus('error');
                setErrorMessage(`Connection to server failed: ${err.message}`);
            }
        });
    };

    const isWorking = ['loading', 'uninstalling', 'installing'].includes(status);

    return (
        <div className="space-y-6">
            <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-200">{t('pitunnel.title')}</h3>
            {isWorking && (
                 <div className="flex flex-col items-center justify-center p-8">
                     <Loader />
                     <p className="mt-4 capitalize">{status}...</p>
                 </div>
            )}
            
            {errorMessage && <div className="p-4 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg">{errorMessage}</div>}
            {(status === 'uninstalling' || status === 'installing') && logs.length > 0 && <LogViewer logs={logs} />}

            {status === 'installed' && data && (
                <div className="space-y-4">
                    <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/50 border border-green-200 dark:border-green-700 text-center">
                        <CheckCircleIcon className="w-12 h-12 text-green-500 dark:text-green-400 mx-auto mb-2" />
                        <h3 className="text-xl font-bold text-green-800 dark:text-green-300">PI TUNNEL IS INSTALLED</h3>
                         <p className="text-sm mt-2">Status: {data.active ? t('pitunnel.status_active') : t('pitunnel.status_inactive')}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-sky-50 dark:bg-sky-900/50 border border-sky-200 dark:border-sky-700 text-sky-800 dark:text-sky-300">
                        <p className="font-semibold">Next Step:</p>
                        <p className="text-sm">Manage your tunnel and get your public URL from your <a href={data.url || 'https://pitunnel.com/dashboard'} target="_blank" rel="noopener noreferrer" className="underline hover:text-sky-600 dark:hover:text-sky-200">Pi Tunnel dashboard</a>.</p>
                    </div>
                    <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                        <button onClick={() => handleStreamAction('uninstall')} disabled={isWorking} className="w-full sm:w-auto px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg flex items-center justify-center gap-2">
                            <TrashIcon className="w-5 h-5"/>
                            {t('pitunnel.uninstall')}
                        </button>
                    </div>
                </div>
            )}
            
            {status === 'not_installed' && !isWorking && (
                 <div className="space-y-6">
                    <div>
                        <h4 className="font-semibold text-lg text-slate-800 dark:text-slate-200">{t('pitunnel.step1_title')}</h4>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('pitunnel.step1_desc')}</p>
                    </div>
                    <div className="space-y-2">
                        <label htmlFor="install-command" className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t('pitunnel.install_command')}</label>
                        <textarea id="install-command" value={command} onChange={e => setCommand(e.target.value)} disabled={isWorking} placeholder={t('pitunnel.install_placeholder')} className="w-full h-24 p-2 font-mono text-sm bg-slate-100 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-600 rounded-md resize-y focus:ring-2 focus:ring-[--color-primary-500] focus:outline-none" />
                    </div>
                    <div className="flex justify-end">
                        <button onClick={() => handleStreamAction('install')} disabled={isWorking || !command.trim()} className="px-6 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-bold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
                            {t('pitunnel.install')}
                        </button>
                    </div>
                    <SudoInstructionBox />
                     <div className="flex justify-end">
                        <button onClick={fetchData} className="text-sm text-[--color-primary-600] hover:underline">Refresh Status</button>
                     </div>
                </div>
            )}
        </div>
    );
};
]]></content>
  </change>
  <change>
    <file>components/Remote.tsx</file>
    <description>Create the new Remote Access management page, which consolidates ZeroTier, Pi Tunnel, Ngrok, and Dataplicity into a single, tabbed interface.</description>
    <content><![CDATA[import React, { useState } from 'react';
import { ZeroTier } from './ZeroTier.tsx';
import { PiTunnel } from './PiTunnel.tsx';
import { NgrokManager } from './NgrokManager.tsx';
import { Dataplicity } from './Dataplicity.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { ZeroTierIcon, CloudIcon, DataplicityIcon } from '../constants.tsx';

type ActiveTab = 'zerotier' | 'pitunnel' | 'ngrok' | 'dataplicity';

const TabButton: React.FC<{ label: string, icon: React.ReactNode, isActive: boolean, onClick: () => void }> = ({ label, icon, isActive, onClick }) => (
    <button
        onClick={onClick}
        className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors duration-200 focus:outline-none ${
            isActive
                ? 'border-[--color-primary-500] text-[--color-primary-500] dark:text-[--color-primary-400]'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
        }`}
    >
        {icon}
        <span className="hidden sm:inline">{label}</span>
    </button>
);

export const Remote: React.FC = () => {
    const { t } = useLocalization();
    const [activeTab, setActiveTab] = useState<ActiveTab>('zerotier');

    const renderContent = () => {
        switch (activeTab) {
            case 'zerotier':
                return <ZeroTier />;
            case 'pitunnel':
                return <PiTunnel />;
            case 'ngrok':
                return <NgrokManager />;
            case 'dataplicity':
                return <Dataplicity />;
            default:
                return null;
        }
    };

    return (
        <div className="space-y-6 max-w-4xl mx-auto">
             <div className="border-b border-slate-200 dark:border-slate-700">
                <nav className="flex space-x-2 -mb-px overflow-x-auto" aria-label="Tabs">
                    <TabButton label={t('remote.zerotier')} icon={<ZeroTierIcon className="w-5 h-5"/>} isActive={activeTab === 'zerotier'} onClick={() => setActiveTab('zerotier')} />
                    <TabButton label={t('remote.pitunnel')} icon={<CloudIcon className="w-5 h-5"/>} isActive={activeTab === 'pitunnel'} onClick={() => setActiveTab('pitunnel')} />
                    <TabButton label={t('remote.ngrok')} icon={<CloudIcon className="w-5 h-5"/>} isActive={activeTab === 'ngrok'} onClick={() => setActiveTab('ngrok')} />
                    <TabButton label={t('remote.dataplicity')} icon={<DataplicityIcon className="w-5 h-5"/>} isActive={activeTab === 'dataplicity'} onClick={() => setActiveTab('dataplicity')} />
                </nav>
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md p-6">
                {renderContent()}
            </div>
        </div>
    );
};
]]></content>
  </change>
  <change>
    <file>components/SystemSettings.tsx</file>
    <description>Remove the Ngrok manager from the System Settings page, as it is being moved to the new consolidated "Remote Access" page.</description>
    <content><![CDATA[import React, { useState, useEffect, useCallback } from 'react';
import type { RouterConfigWithId, PanelSettings, PanelNtpStatus, LicenseStatus } from '../types.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { initializeAiClient } from '../services/geminiService.ts';
import { rebootRouter, syncTimeToRouter } from '../services/mikrotikService.ts';
import { getPanelSettings, savePanelSettings, getAuthHeader } from '../services/databaseService.ts';
import { createDatabaseBackup, listDatabaseBackups, deleteDatabaseBackup, getPanelNtpStatus, togglePanelNtp } from '../services/panelService.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { Loader } from './Loader.tsx';
// FIX: Import ClockIcon from constants
import { KeyIcon, CogIcon, PowerIcon, RouterIcon, CircleStackIcon, ArrowPathIcon, TrashIcon, UsersIcon, DataplicityIcon, ClockIcon } from '../constants.tsx';
import { SudoInstructionBox } from './SudoInstructionBox.tsx';

// --- Icon Components ---
const SunIcon: React.FC<{ className?: string }> = ({ className }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" /></svg>;
const MoonIcon: React.FC<{ className?: string }> = ({ className }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" /></svg>;
const ComputerDesktopIcon: React.FC<{ className?: string }> = ({ className }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z" /></svg>;
// FIX: Removed local ClockIcon definition as it will be imported from constants.tsx.


// A generic settings card component
const SettingsCard: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode; }> = ({ title, icon, children }) => (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
            {icon}
            <h3 className="text-lg font-semibold text-[--color-primary-500] dark:text-[--color-primary-400]">{title}</h3>
        </div>
        <div className="p-6">
            {children}
        </div>
    </div>
);

// --- Sub-components for System Settings ---
const ThemeSwitcher = () => {
    const { theme, setTheme } = useTheme();

    const themes = [
        { name: 'light', label: 'Light', icon: <SunIcon className="w-5 h-5" /> },
        { name: 'dark', label: 'Dark', icon: <MoonIcon className="w-5 h-5" /> },
        { name: 'system', label: 'System', icon: <ComputerDesktopIcon className="w-5 h-5" /> },
    ];

    return (
        <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Theme</label>
            <div className="flex items-center gap-2 rounded-lg bg-slate-100 dark:bg-slate-700 p-1">
                {themes.map(t => (
                    <button
                        key={t.name}
                        onClick={() => setTheme(t.name as 'light' | 'dark' | 'system')}
                        className={`w-full flex items-center justify-center gap-2 rounded-md py-2 px-3 text-sm font-medium transition-colors ${
                            theme === t.name
                                ? 'bg-white dark:bg-slate-900 text-[--color-primary-600] dark:text-[--color-primary-400] shadow-sm'
                                : 'text-slate-600 dark:text-slate-300 hover:bg-white/50 dark:hover:bg-slate-900/20'
                        }`}
                    >
                        {t.icon}
                        {t.label}
                    </button>
                ))}
            </div>
        </div>
    );
};

const TimeSyncManager: React.FC<{ selectedRouter: RouterConfigWithId | null }> = ({ selectedRouter }) => {
    // State for Panel NTP
    const [panelNtpStatus, setPanelNtpStatus] = useState<PanelNtpStatus | null>(null);
    const [isNtpLoading, setIsNtpLoading] = useState(true);
    const [isNtpSaving, setIsNtpSaving] = useState(false);
    const [ntpError, setNtpError] = useState<string | null>(null);
    
    // State for Router Sync
    const [isSyncing, setIsSyncing] = useState(false);
    
    // Fetch Panel NTP logic
    const fetchNtpData = useCallback(() => {
        setIsNtpLoading(true);
        setNtpError(null);
        getPanelNtpStatus()
            .then(setPanelNtpStatus)
            .catch(err => setNtpError(`Could not fetch panel NTP status: ${(err as Error).message}`))
            .finally(() => setIsNtpLoading(false));
    }, []);
    
    useEffect(() => { fetchNtpData() }, [fetchNtpData]);

    // handle toggle Panel NTP
    const handleTogglePanelNtp = async () => {
        if (panelNtpStatus === null) return;
        setIsNtpSaving(true);
        try {
            const result = await togglePanelNtp(!panelNtpStatus.enabled);
            alert(result.message);
            await fetchNtpData();
        } catch (err) {
            alert(`Failed to toggle panel NTP: ${(err as Error).message}`);
        } finally {
            setIsNtpSaving(false);
        }
    };

    // handle sync to router
    const handleSyncTimeToRouter = async () => {
        if (!selectedRouter) return;
        if (window.confirm(`Are you sure you want to set the time on "${selectedRouter.name}" to the panel's current time? This will set the router's system clock.`)) {
            setIsSyncing(true);
            try {
                const res = await syncTimeToRouter(selectedRouter);
                alert(res.message);
            } catch (err) {
                alert(`Failed to sync time: ${(err as Error).message}`);
            } finally {
                setIsSyncing(false);
            }
        }
    };

    return (
        <div className="space-y-6">
            {/* Panel Section */}
            <div>
                <h4 className="font-semibold text-lg text-slate-800 dark:text-slate-200 mb-2">Panel Host NTP</h4>
                {isNtpLoading ? <div className="flex justify-center"><Loader /></div> : ntpError ? <p className="text-red-500 text-sm mb-2">{ntpError}</p> :
                    <>
                        <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700">
                            <div>
                                <p className="font-medium text-slate-700 dark:text-slate-300">Automatic Time Sync (timedatectl)</p>
                                <p className="text-xs text-slate-500">Keep the panel server's time accurate.</p>
                            </div>
                            <button onClick={handleTogglePanelNtp} disabled={isNtpSaving || panelNtpStatus === null} className={`px-4 py-2 text-sm font-semibold rounded-lg w-28 text-white ${panelNtpStatus?.enabled ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'} disabled:opacity-50`}>
                                {isNtpSaving ? <Loader /> : panelNtpStatus?.enabled ? 'Disable' : 'Enable'}
                            </button>
                        </div>
                         <div className="mt-4">
                            <SudoInstructionBox />
                        </div>
                    </>
                }
            </div>
            
            {/* Router Section */}
            {selectedRouter && (
                <div className="pt-6 border-t border-slate-200 dark:border-slate-700">
                    <h4 className="font-semibold text-lg text-slate-800 dark:text-slate-200 mb-2">Router Time Sync</h4>
                    <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700">
                        <div>
                            <p className="font-medium text-slate-700 dark:text-slate-300">Sync Time to {selectedRouter.name}</p>
                            <p className="text-sm text-slate-500">Set the router's clock to match this panel's server time.</p>
                        </div>
                        <button onClick={handleSyncTimeToRouter} disabled={isSyncing} className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-lg flex items-center gap-2 disabled:opacity-50">
                            {isSyncing ? <Loader /> : <ClockIcon className="w-5 h-5" />}
                            {isSyncing ? 'Syncing...' : 'Sync Now'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};


const DatabaseManager: React.FC = () => {
    const [backups, setBackups] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isActioning, setIsActioning] = useState<string | null>(null); // 'create', 'delete-filename', 'restore-filename'
    const [restoreLogs, setRestoreLogs] = useState<string[]>([]);

    const fetchBackups = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await listDatabaseBackups();
            setBackups(data.filter(f => f.endsWith('.sqlite')));
        } catch (error) {
            console.error("Failed to list backups:", error);
            alert(`Error: ${(error as Error).message}`);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchBackups();
    }, [fetchBackups]);

    const handleCreateBackup = async () => {
        setIsActioning('create');
        try {
            const result = await createDatabaseBackup();
            alert(result.message);
            await fetchBackups();
        } catch (error) {
            alert(`Failed to create backup: ${(error as Error).message}`);
        } finally {
            setIsActioning(null);
        }
    };

    const handleDeleteBackup = async (filename: string) => {
        if (!window.confirm(`Are you sure you want to permanently delete backup "${filename}"?`)) return;
        setIsActioning(`delete-${filename}`);
        try {
            await deleteDatabaseBackup(filename);
            await fetchBackups();
        } catch (error) {
            alert(`Failed to delete backup: ${(error as Error).message}`);
        } finally {
            setIsActioning(null);
        }
    };

    const handleRestore = (filename: string) => {
        if (!window.confirm(`Are you sure you want to restore from "${filename}"? This will overwrite all current panel data.`)) return;
        
        setIsActioning(`restore-${filename}`);
        setRestoreLogs([]);

        const eventSource = new EventSource(`/api/restore-backup?backupFile=${encodeURIComponent(filename)}`);

        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.log) setRestoreLogs(prev => [...prev, data.log]);
            if (data.status === 'restarting') {
                alert('Restore successful! The panel is restarting. The page will reload in a few seconds.');
                setTimeout(() => window.location.reload(), 8000);
                eventSource.close();
            }
            if (data.status === 'error') {
                alert(`Restore failed: ${data.message}`);
                setIsActioning(null);
                eventSource.close();
            }
        };

        eventSource.onerror = () => {
            alert('Connection lost during restore process.');
            setIsActioning(null);
            eventSource.close();
        };
    };

    const handleDownload = (filename: string) => {
        const a = document.createElement('a');
        a.href = `/download-backup/${filename}`;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    return (
        <div className="space-y-4">
            <button onClick={handleCreateBackup} disabled={!!isActioning} className="w-full px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2">
                {isActioning === 'create' ? <Loader /> : <CircleStackIcon className="w-5 h-5" />}
                {isActioning === 'create' ? 'Backing up...' : 'Create New Backup'}
            </button>
            <div className="pt-4">
                <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Available Backups</h4>
                {isLoading ? <div className="flex justify-center"><Loader/></div> :
                 backups.length > 0 ? (
                    <ul className="space-y-2 max-h-60 overflow-y-auto pr-2">
                        {backups.map(backup => (
                            <li key={backup} className="bg-slate-100 dark:bg-slate-700/50 p-3 rounded-md flex justify-between items-center">
                                <span className="font-mono text-sm text-slate-800 dark:text-slate-300 truncate mr-4">{backup}</span>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <button onClick={() => handleRestore(backup)} disabled={!!isActioning} className="p-2 text-slate-500 hover:text-sky-500 disabled:opacity-50" title="Restore"><ArrowPathIcon className="h-5 w-5"/></button>
                                    <button onClick={() => handleDownload(backup)} className="p-2 text-slate-500 hover:text-green-500" title="Download"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg></button>
                                    <button onClick={() => handleDeleteBackup(backup)} disabled={!!isActioning} className="p-2 text-slate-500 hover:text-red-500 disabled:opacity-50" title="Delete">
                                        {isActioning === `delete-${backup}` ? <Loader/> : <TrashIcon className="h-5 w-5"/>}
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                 ) : (
                    <p className="text-slate-500 dark:text-slate-400 text-center py-4">No database backups found.</p>
                 )
                }
            </div>
            {isActioning?.startsWith('restore-') && (
                <div className="mt-4">
                    <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Restoring...</h4>
                    <div className="bg-slate-900 text-slate-300 font-mono text-xs p-4 rounded-md h-48 overflow-y-auto">
                        {restoreLogs.map((log, i) => <pre key={i} className="whitespace-pre-wrap">{log}</pre>)}
                    </div>
                </div>
            )}
        </div>
    );
};


interface SystemSettingsProps {
    selectedRouter: RouterConfigWithId | null;
    licenseStatus: LicenseStatus | null;
}

// --- Main Component ---
export const SystemSettings: React.FC<SystemSettingsProps> = ({ selectedRouter, licenseStatus }) => {
    const { language, currency, setLanguage, setCurrency } = useLocalization();
    const { logout } = useAuth();
    const [localSettings, setLocalSettings] = useState({ language, currency });
    const [isPanelSettingsSaving, setIsPanelSettingsSaving] = useState(false);
    
    const [apiKey, setApiKey] = useState('');
    const [isKeySaving, setIsKeySaving] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    
    useEffect(() => {
        setLocalSettings({ language, currency });
    }, [language, currency]);

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const settings = await getPanelSettings() as any;
                if (settings?.geminiApiKey) {
                    setApiKey(settings.geminiApiKey);
                }
            } catch (error) {
                console.error("Could not load API key:", error);
            }
        };
        loadSettings();
    }, []);

    const handleSavePanelSettings = async () => {
        setIsPanelSettingsSaving(true);
        try {
            // Fetch current settings to avoid overwriting other values (like API key)
            const currentSettings = await getPanelSettings();
            // FIX: Explicitly check that currentSettings is an object before spreading to prevent type errors.
            const newSettings = { ...(currentSettings && typeof currentSettings === 'object' ? currentSettings : {}), ...localSettings };

            // 1. Save the merged settings object in a single API call
            await savePanelSettings(newSettings);

            // 2. On success, update the context state
            if (localSettings.language !== language) {
                await setLanguage(localSettings.language);
            }
            if (localSettings.currency !== currency) {
                setCurrency(localSettings.currency);
            }
            
            alert('Panel settings saved!');
        } catch (err) {
            console.error("Failed to save panel settings:", err);
            alert(`Failed to save panel settings: ${(err as Error).message}`);
        } finally {
            setIsPanelSettingsSaving(false);
        }
    };

    const handleSaveApiKey = async () => {
        setIsKeySaving(true);
        try {
            const currentSettings = await getPanelSettings();
            // FIX: Explicitly check that currentSettings is an object before spreading to prevent type errors.
            const newSettings = { ...(currentSettings && typeof currentSettings === 'object' ? currentSettings : {}), geminiApiKey: apiKey };
            await savePanelSettings(newSettings);
            initializeAiClient(apiKey);
            alert('Gemini API Key saved successfully!');
        } catch (error) {
            alert(`Failed to save API Key: ${(error as Error).message}`);
        } finally {
            setIsKeySaving(false);
        }
    };

    const handleReboot = async () => {
        if (!selectedRouter) return;
        if (window.confirm(`Are you sure you want to reboot the router "${selectedRouter.name}"?`)) {
            try {
                const res = await rebootRouter(selectedRouter);
                alert(res.message);
            } catch (err) {
                alert(`Failed to send reboot command: ${(err as Error).message}`);
            }
        }
    };

    const handleResetCredentials = async () => {
        const confirmation = "Are you sure you want to reset all admin credentials? This will delete all user accounts and force a new administrator registration on the next page load. This action cannot be undone.";
        if (window.confirm(confirmation)) {
            setIsResetting(true);
            try {
                const response = await fetch('/api/auth/reset-all', {
                    method: 'POST',
                    headers: getAuthHeader(),
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.message || 'Failed to reset credentials.');
                }
                alert('All user credentials have been reset. You will now be logged out.');
                logout(); // This will clear local storage and reload the page
            } catch (err) {
                alert(`Error: ${(err as Error).message}`);
            } finally {
                setIsResetting(false);
            }
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8">
             {!licenseStatus?.licensed && (
                <div className="p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700/50 text-yellow-900 dark:text-yellow-200 flex items-center gap-3">
                    <KeyIcon className="w-6 h-6 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
                    <div>
                        <h4 className="font-bold">Panel Unlicensed</h4>
                        <p className="text-sm">Please activate your panel on the License page to ensure all features work correctly.</p>
                    </div>
                </div>
            )}
            <SettingsCard title="Panel Settings" icon={<CogIcon className="w-6 h-6" />}>
                <div className="space-y-6">
                    <ThemeSwitcher />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="language" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Language</label>
                            <select id="language" value={localSettings.language} onChange={e => setLocalSettings(s => ({...s, language: e.target.value as PanelSettings['language']}))} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white">
                                <option value="en">English</option>
                                <option value="fil">Filipino</option>
                                <option value="es">Español (Spanish)</option>
                                <option value="pt">Português (Portuguese)</option>
                            </select>
                        </div>
                        <div>
                            <label htmlFor="currency" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Currency</label>
                            <select id="currency" value={localSettings.currency} onChange={e => setLocalSettings(s => ({...s, currency: e.target.value as PanelSettings['currency']}))} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white">
                                <option value="USD">USD ($)</option>
                                <option value="PHP">PHP (₱)</option>
                                <option value="EUR">EUR (€)</option>
                                <option value="BRL">BRL (R$)</option>
                            </select>
                        </div>
                    </div>
                     <div className="flex justify-end pt-4 border-t border-slate-200 dark:border-slate-700">
                        <button onClick={handleSavePanelSettings} disabled={isPanelSettingsSaving} className="px-4 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-semibold rounded-lg disabled:opacity-50">
                            {isPanelSettingsSaving ? 'Saving...' : 'Save Panel Settings'}
                        </button>
                    </div>
                </div>
            </SettingsCard>
            
            <SettingsCard title="Database Management" icon={<CircleStackIcon className="w-6 h-6" />}>
                <DatabaseManager />
            </SettingsCard>
            
            <SettingsCard title="AI Settings" icon={<KeyIcon className="w-6 h-6" />}>
                <div className="space-y-2">
                    <label htmlFor="apiKey" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Google Gemini API Key</label>
                    <input type="password" name="apiKey" id="apiKey" value={apiKey} onChange={e => setApiKey(e.target.value)} className="block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                    <p className="text-xs text-slate-500">Your key is stored locally in the panel's database.</p>
                </div>
                <div className="flex justify-end mt-4">
                    <button onClick={handleSaveApiKey} disabled={isKeySaving} className="px-4 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-semibold rounded-lg disabled:opacity-50">
                        {isKeySaving ? 'Saving...' : 'Save API Key'}
                    </button>
                </div>
            </SettingsCard>

            <SettingsCard title="Time Synchronization" icon={<ClockIcon className="w-6 h-6" />}>
                <TimeSyncManager selectedRouter={selectedRouter} />
            </SettingsCard>

            <SettingsCard title="Account Reset" icon={<UsersIcon className="w-6 h-6" />}>
                <div className="space-y-4">
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                        This will delete all user accounts and security questions from the panel's database.
                        The panel will return to its initial setup state, prompting for a new administrator account to be created.
                        This is useful if you are selling or transferring ownership of this panel.
                    </p>
                    <div className="flex items-center justify-between p-4 bg-red-50 dark:bg-red-900/30 rounded-lg border border-red-200 dark:border-red-700">
                        <div>
                            <p className="font-semibold text-red-800 dark:text-red-300">Reset All Credentials</p>
                            <p className="text-sm text-red-600 dark:text-red-400">This action cannot be undone.</p>
                        </div>
                        <button onClick={handleResetCredentials} disabled={isResetting} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg flex items-center gap-2 disabled:opacity-50">
                            {isResetting && <Loader />}
                            {isResetting ? 'Resetting...' : 'Reset Now'}
                        </button>
                    </div>
                </div>
            </SettingsCard>

            {selectedRouter && (
                 <SettingsCard title={`Router Management (${selectedRouter.name})`} icon={<RouterIcon className="w-6 h-6" />}>
                    <div className="space-y-6">
                         <div className="pt-6 border-t border-slate-200 dark:border-slate-700">
                             <h4 className="font-semibold text-lg text-slate-800 dark:text-slate-200 mb-2">Power Actions</h4>
                            <div className="flex items-center justify-between p-4 bg-red-50 dark:bg-red-900/30 rounded-lg border border-red-200 dark:border-red-700">
                                <div>
                                    <p className="font-semibold text-red-800 dark:text-red-300">Reboot Router</p>
                                    <p className="text-sm text-red-600 dark:text-red-400">This will immediately restart the selected router.</p>
                                </div>
                                <button onClick={handleReboot} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg flex items-center gap-2">
                                    <PowerIcon className="w-5 h-5" />
                                    Reboot
                                </button>
                            </div>
                        </div>
                    </div>
                 </SettingsCard>
            )}
        </div>
    );
};
]]></content>
  </change>
  <change>
    <file>components/Sidebar.tsx</file>
    <description>Update the sidebar to remove the standalone "ZeroTier" link and add a new consolidated "Remote Access" item, which will house all remote management tools.</description>
    <content><![CDATA[import React, { useMemo } from 'react';
import { MikroTikLogoIcon, BellIcon, EthernetIcon, EditIcon, RouterIcon, VlanIcon, UpdateIcon, SignalIcon, UsersIcon, WifiIcon, CogIcon, CurrencyDollarIcon, ShareIcon, ArchiveBoxIcon, BuildingOffice2Icon, ShieldCheckIcon, CodeBracketIcon, KeyIcon, LockClosedIcon, ServerIcon, CalculatorIcon, CloudIcon } from '../constants.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import type { View, CompanySettings, LicenseStatus } from '../types.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useNotifications } from '../contexts/NotificationContext.tsx';

interface SidebarProps {
  currentView: View;
  setCurrentView: (view: View) => void;
  companySettings: CompanySettings;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  licenseStatus: LicenseStatus | null;
}

const NavItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
  badge?: number;
}> = ({ icon, label, isActive, onClick, disabled, badge }) => {
  return (
    <li>
      <button
        onClick={disabled ? undefined : onClick}
        className={`flex items-center w-full p-3 text-base rounded-lg transition duration-150 group ${
          isActive
            ? 'bg-[--color-primary-500]/10 text-[--color-primary-600] dark:text-[--color-primary-300] font-semibold'
            : disabled
            ? 'text-slate-400 dark:text-slate-600 cursor-not-allowed bg-slate-100 dark:bg-slate-800'
            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700/50'
        }`}
        disabled={disabled}
      >
        {icon}
        <span className="flex-1 ml-3 text-left whitespace-nowrap">{label}</span>
        {badge > 0 && (
            <span className="inline-flex items-center justify-center px-2 py-0.5 ml-3 text-xs font-medium text-white bg-red-500 rounded-full">
                {badge > 9 ? '9+' : badge}
            </span>
        )}
      </button>
    </li>
  );
};

const CloseIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
);

const TerminalIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);


export const Sidebar: React.FC<SidebarProps> = ({ currentView, setCurrentView, companySettings, isOpen, setIsOpen, licenseStatus }) => {
  const { user } = useAuth();
  const { t } = useLocalization();
  const { unreadCount } = useNotifications();
  
  const navItems = useMemo(() => [
    { id: 'dashboard', label: t('sidebar.dashboard'), icon: <EthernetIcon className="w-6 h-6" /> },
    { id: 'notifications', label: t('sidebar.notifications'), icon: <BellIcon className="w-6 h-6" />, badge: unreadCount },
    { id: 'scripting', label: t('sidebar.ai_scripting'), icon: <EditIcon className="w-6 h-6" /> },
    { id: 'terminal', label: t('sidebar.terminal'), icon: <TerminalIcon className="w-6 h-6" /> },
    { id: 'routers', label: t('sidebar.routers'), icon: <RouterIcon className="w-6 h-6" /> },
    { id: 'network', label: t('sidebar.network'), icon: <ShareIcon className="w-6 h-6" /> },
    { id: 'dhcp-portal', label: t('sidebar.dhcp-portal'), icon: <ServerIcon className="w-6 h-6" /> },
    { id: 'pppoe', label: t('sidebar.pppoe'), icon: <UsersIcon className="w-6 h-6" /> },
    { id: 'billing', label: t('sidebar.billing_plans'), icon: <SignalIcon className="w-6 h-6" /> },
    { id: 'sales', label: t('sidebar.sales_report'), icon: <CurrencyDollarIcon className="w-6 h-6" /> },
    { id: 'inventory', label: t('sidebar.inventory'), icon: <ArchiveBoxIcon className="w-6 h-6" /> },
    { id: 'payroll', label: t('sidebar.payroll'), icon: <CalculatorIcon className="w-6 h-6" /> },
    { id: 'hotspot', label: t('sidebar.hotspot'), icon: <WifiIcon className="w-6 h-6" /> },
    { id: 'remote', label: t('sidebar.remote'), icon: <CloudIcon className="w-6 h-6" /> },
    { id: 'mikrotik_files', label: t('sidebar.mikrotik_files'), icon: <ArchiveBoxIcon className="w-6 h-6" /> },
    { id: 'company', label: t('sidebar.company'), icon: <BuildingOffice2Icon className="w-6 h-6" /> },
    { id: 'system', label: t('sidebar.system_settings'), icon: <CogIcon className="w-6 h-6" /> },
    { id: 'panel_roles', label: t('sidebar.panel_roles'), icon: <KeyIcon className="w-6 h-6" /> },
    { id: 'updater', label: t('sidebar.updater'), icon: <UpdateIcon className="w-6 h-6" /> },
    { id: 'logs', label: t('sidebar.logs'), icon: <CodeBracketIcon className="w-6 h-6" /> },
    { id: 'license', label: t('sidebar.license'), icon: <KeyIcon className="w-6 h-6" /> },
    { id: 'super_admin', label: t('sidebar.super_admin'), icon: <LockClosedIcon className="w-6 h-6" /> },
  ], [t, unreadCount]);

  const filteredNavItems = useMemo(() => {
    if (!user) return [];
    const isAdmin = user.role.name.toLowerCase() === 'administrator';
    const isSuperadmin = user.role.name.toLowerCase() === 'superadmin';

    return navItems.filter(item => {
      if (item.id === 'super_admin' && !isSuperadmin) {
        return false;
      }
      if (item.id === 'panel_roles' && !isAdmin && !isSuperadmin) {
        return false;
      }
      return true;
    });
  }, [navItems, user]);

  const licensedViews: View[] = [
      'dashboard', 'scripting', 'terminal', 'network', 'pppoe', 'billing', 'sales',
      'inventory', 'payroll', 'hotspot', 'mikrotik_files', 'remote', 'logs', 'dhcp-portal'
  ];

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 w-64 h-screen bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-transform duration-300 ease-in-out lg:sticky lg:translate-x-0 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
      aria-label="Sidebar"
    >
      <div className="flex items-center justify-between h-16 border-b border-slate-200 dark:border-slate-800 px-4">
          <div className="flex items-center min-w-0">
              {companySettings.logoBase64 ? (
                <img src={companySettings.logoBase64} alt="Company Logo" className="h-10 w-auto object-contain flex-shrink-0" />
              ) : (
                 <MikroTikLogoIcon className="w-8 h-8 text-[--color-primary-500] flex-shrink-0" />
              )}
              <span className="self-center ml-3 text-xl font-semibold whitespace-nowrap text-slate-900 dark:text-white truncate">
                {companySettings.companyName || 'MikroTik UI'}
              </span>
          </div>
          <button onClick={() => setIsOpen(false)} className="lg:hidden text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white p-1" aria-label="Close sidebar">
              <CloseIcon className="w-6 h-6" />
          </button>
      </div>
      <div className="h-[calc(100vh-4rem)] px-3 py-4 overflow-y-auto flex flex-col justify-between">
        <ul className="space-y-2">
          {filteredNavItems.map((item) => (
            <NavItem
              key={item.id}
              label={item.label}
              icon={item.icon}
              isActive={currentView === item.id}
              onClick={() => setCurrentView(item.id as View)}
              disabled={!licenseStatus?.licensed && licensedViews.includes(item.id as View)}
              badge={item.badge || 0}
            />
          ))}
        </ul>
        <div className="text-center text-xs text-slate-400 dark:text-slate-600 mt-4">
            v1.6.0
        </div>
      </div>
    </aside>
  );
};
]]></content>
  </change>
  <change>
    <file>App.tsx</file>
    <description>Update the main App component to render the new `Remote` component when the "Remote Access" view is selected, replacing the old "ZeroTier" view logic.</description>
    <content><![CDATA[import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar.tsx';
import { TopBar } from './components/TopBar.tsx';
import { Dashboard } from './components/Dashboard.tsx';
import { Scripting } from './components/Scripting.tsx';
import { Routers } from './components/Routers.tsx';
import { Updater } from './components/Updater.tsx';
import { Pppoe } from './components/Pppoe.tsx';
import { Billing } from './components/Billing.tsx';
import { Remote } from './components/Remote.tsx';
import { Hotspot } from './components/Hotspot.tsx';
import { Help } from './components/Help.tsx';
import { SystemSettings } from './components/SystemSettings.tsx';
import { SalesReport } from './components/SalesReport.tsx';
import { Network } from './components/Network.tsx';
import { Inventory } from './components/Inventory.tsx';
import { Company } from './components/Company.tsx';
import { Terminal } from './components/Terminal.tsx';
import { Loader } from './components/Loader.tsx';
import { Login } from './components/Login.tsx';
import { Register } from './components/Register.tsx';
import { ForgotPassword } from './components/ForgotPassword.tsx';
import { AuthLayout } from './components/AuthLayout.tsx';
import { Logs } from './components/Logs.tsx';
import { PanelRoles } from './components/PanelRoles.tsx';
import { MikrotikFiles } from './components/MikrotikFiles.tsx';
import { License } from './components/License.tsx';
import { SuperAdmin } from './components/SuperAdmin.tsx';
import { UnlicensedComponent } from './components/UnlicensedComponent.tsx';
import { DhcpPortal } from './components/DhcpPortal.tsx';
import { CaptivePortalPage } from './components/CaptivePortalPage.tsx';
import { NotificationsPage } from './components/NotificationsPage.tsx';
import { Payroll } from './components/Payroll.tsx';
import { useRouters } from './hooks/useRouters.ts';
import { useSalesData } from './hooks/useSalesData.ts';
import { useInventoryData } from './hooks/useInventoryData.ts';
import { useExpensesData } from './hooks/useExpensesData.ts';
import { useCompanySettings } from './hooks/useCompanySettings.ts';
import { usePayrollData } from './hooks/usePayrollData.ts';
import { LocalizationProvider, useLocalization } from './contexts/LocalizationContext.tsx';
import { ThemeProvider } from './contexts/ThemeContext.tsx';
import { NotificationProvider } from './contexts/NotificationContext.tsx';
import { useAuth } from './contexts/AuthContext.tsx';
import type { View, LicenseStatus } from './types.ts';
import { getAuthHeader } from './services/databaseService.ts';


const useMediaQuery = (query: string): boolean => {
  const getMatches = (query: string): boolean => {
    if (typeof window !== 'undefined') {
      return window.matchMedia(query).matches;
    }
    return false;
  };

  const [matches, setMatches] = useState<boolean>(getMatches(query));

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const handleChange = () => setMatches(mediaQuery.matches);
    
    try {
        mediaQuery.addEventListener('change', handleChange);
    } catch (e) {
        mediaQuery.addListener(handleChange);
    }

    return () => {
       try {
            mediaQuery.removeEventListener('change', handleChange);
        } catch (e) {
            mediaQuery.removeListener(handleChange);
        }
    };
  }, [query]);

  return matches;
};

interface AppContentProps {
    licenseStatus: LicenseStatus | null;
    onLicenseChange: () => void;
}

const AppContent: React.FC<AppContentProps> = ({ licenseStatus, onLicenseChange }) => {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const isLargeScreen = useMediaQuery('(min-width: 1024px)');
  const [isSidebarOpen, setIsSidebarOpen] = useState(isLargeScreen);
  const [selectedRouterId, setSelectedRouterId] = useState<string | null>(null);
  
  const { routers, addRouter, updateRouter, deleteRouter, isLoading: isLoadingRouters } = useRouters();
  const { sales, addSale, deleteSale, clearSales, isLoading: isLoadingSales } = useSalesData(selectedRouterId);
  const { items, addItem, updateItem, deleteItem, isLoading: isLoadingInventory } = useInventoryData();
  const { expenses, addExpense, updateExpense, deleteExpense, isLoading: isLoadingExpenses } = useExpensesData();
  const payrollData = usePayrollData();
  const { settings: companySettings, updateSettings: updateCompanySettings, isLoading: isLoadingCompany } = useCompanySettings();
  const { t, isLoading: isLoadingLocalization } = useLocalization();


  const appIsLoading = isLoadingRouters || isLoadingSales || isLoadingInventory || isLoadingCompany || isLoadingLocalization || isLoadingExpenses || payrollData.isLoading;

  useEffect(() => {
    setIsSidebarOpen(isLargeScreen);
  }, [isLargeScreen]);

  useEffect(() => {
    if (!isLargeScreen) {
        setIsSidebarOpen(false);
    }
  }, [currentView, isLargeScreen]);

  useEffect(() => {
    if (!appIsLoading && routers.length > 0 && !selectedRouterId) {
        setSelectedRouterId(routers[0].id);
    }
  }, [appIsLoading, routers, selectedRouterId]);

  useEffect(() => {
    if (!selectedRouterId && routers.length > 0) {
      setSelectedRouterId(routers[0].id);
    }
    if (selectedRouterId && !routers.find(r => r.id === selectedRouterId)) {
        setSelectedRouterId(routers.length > 0 ? routers[0].id : null);
    }
  }, [routers, selectedRouterId]);

  const selectedRouter = useMemo(
    () => routers.find(r => r.id === selectedRouterId) || null,
    [routers, selectedRouterId]
  );

  const renderView = () => {
    if (appIsLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-full">
                <Loader />
                <p className="mt-4 text-[--color-primary-400]">{t('app.loading_data')}</p>
            </div>
        );
    }

    const licensedViews: View[] = [
        'dashboard', 'scripting', 'terminal', 'network', 'pppoe', 'billing', 'sales',
        'inventory', 'payroll', 'hotspot', 'mikrotik_files', 'remote', 'logs', 'dhcp-portal'
    ];

    if (!licenseStatus?.licensed && licensedViews.includes(currentView)) {
        return <UnlicensedComponent setCurrentView={setCurrentView} />;
    }

    switch (currentView) {
      case 'dashboard':
        return <Dashboard selectedRouter={selectedRouter} />;
      case 'notifications':
        return <NotificationsPage setCurrentView={setCurrentView} />;
      case 'scripting':
        return <Scripting />;
      case 'routers':
        return <Routers routers={routers} onAddRouter={addRouter} onUpdateRouter={updateRouter} onDeleteRouter={deleteRouter} />;
      case 'network':
          return <Network selectedRouter={selectedRouter} />;
      case 'terminal':
          return <Terminal selectedRouter={selectedRouter} />;
      case 'dhcp-portal':
          return <DhcpPortal selectedRouter={selectedRouter} addSale={addSale} />;
      case 'pppoe':
          return <Pppoe selectedRouter={selectedRouter} addSale={addSale} />;
      case 'billing':
          return <Billing selectedRouter={selectedRouter} />;
      case 'sales':
          return <SalesReport salesData={sales} deleteSale={deleteSale} clearSales={clearSales} companySettings={companySettings} />;
      case 'inventory':
          return <Inventory 
                    items={items} 
                    addItem={addItem} 
                    updateItem={updateItem} 
                    deleteItem={deleteItem}
                    expenses={expenses}
                    addExpense={addExpense}
                    updateExpense={updateExpense}
                    deleteExpense={deleteExpense}
                 />;
      case 'payroll':
          return <Payroll {...payrollData} />;
      case 'hotspot':
          return <Hotspot selectedRouter={selectedRouter} />;
      case 'remote':
          return <Remote />;
      case 'mikrotik_files':
          return <MikrotikFiles selectedRouter={selectedRouter} />;
      case 'company':
          return <Company settings={companySettings} onSave={updateCompanySettings} />;
      case 'system':
          return <SystemSettings selectedRouter={selectedRouter} licenseStatus={licenseStatus} />;
      case 'updater':
        return <Updater />;
      case 'logs':
        return <Logs selectedRouter={selectedRouter} />;
      case 'panel_roles':
        return <PanelRoles />;
      case 'license':
          return <License onLicenseChange={onLicenseChange} licenseStatus={licenseStatus} />;
      case 'super_admin':
          return <SuperAdmin />;
      default:
        return <Dashboard selectedRouter={selectedRouter} />;
    }
  };

  return (
    <div className="flex bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 min-h-screen">
      <Sidebar 
        currentView={currentView} 
        setCurrentView={setCurrentView} 
        companySettings={companySettings}
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
        licenseStatus={licenseStatus}
      />
      {isSidebarOpen && !isLargeScreen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        ></div>
      )}
      <main className="flex-1 flex flex-col min-w-0">
        <TopBar
          title={t(`titles.${currentView}`)}
          routers={routers}
          selectedRouter={selectedRouter}
          onSelectRouter={setSelectedRouterId}
          setCurrentView={setCurrentView}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        />
        <div className="p-4 sm:p-8 overflow-auto h-full flex flex-col">
          <div className="flex-grow">
             {renderView()}
          </div>
        </div>
      </main>
      <Help currentView={currentView} selectedRouter={selectedRouter} />
    </div>
  );
};

const AppRouter: React.FC = () => {
    const { user, isLoading, hasUsers } = useAuth();
    const [authView, setAuthView] = useState<'login' | 'register' | 'forgot'>('login');
    const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
    const [isLicenseLoading, setIsLicenseLoading] = useState(true);
    let licenseCheckInterval = React.useRef<number | null>(null);

    // This renders a dedicated, unauthenticated page for captive portal clients
    if (window.location.pathname.startsWith('/captive')) {
        return (
            <ThemeProvider>
                <LocalizationProvider>
                    <CaptivePortalPage />
                </LocalizationProvider>
            </ThemeProvider>
        );
    }

    const checkLicense = useCallback(async () => {
        try {
            const res = await fetch('/api/license/status', { headers: getAuthHeader() });
             if (!res.ok) {
                console.error('Failed to fetch license status:', res.statusText);
                setLicenseStatus(null);
                return;
            }
            const data: LicenseStatus = await res.json();
            setLicenseStatus(data);
        } catch (error) {
            console.error(error);
            setLicenseStatus(null); // Treat errors as unlicensed
        } finally {
            setIsLicenseLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!isLoading) {
            if (!hasUsers) {
                setAuthView('register');
            } else {
                setAuthView('login');
            }
        }
    }, [isLoading, hasUsers]);
    
    // Initial license check and polling
    useEffect(() => {
        if (user) {
            setIsLicenseLoading(true);
            checkLicense();
            
            if (licenseCheckInterval.current) {
                clearInterval(licenseCheckInterval.current);
            }
            licenseCheckInterval.current = window.setInterval(checkLicense, 5000); // Poll every 5 seconds
        } else if (!isLoading) {
            setIsLicenseLoading(false);
            setLicenseStatus(null);
             if (licenseCheckInterval.current) {
                clearInterval(licenseCheckInterval.current);
            }
        }

        return () => {
            if (licenseCheckInterval.current) {
                clearInterval(licenseCheckInterval.current);
            }
        };
    }, [user, isLoading, checkLicense]);

    const handleLicenseChange = () => {
        setIsLicenseLoading(true);
        checkLicense();
    };

    if (isLoading) {
        return <div className="flex h-screen w-screen items-center justify-center"><Loader /></div>;
    }

    if (!user) {
        if (isLoading) {
             return <div className="flex h-screen w-screen items-center justify-center"><Loader /></div>;
        }
        if (!hasUsers) {
             return <AuthLayout><Register /></AuthLayout>;
        }
        if (authView === 'login') {
            return <AuthLayout><Login onSwitchToForgotPassword={() => setAuthView('forgot')} /></AuthLayout>;
        }
        if (authView === 'forgot') {
            return <AuthLayout><ForgotPassword onSwitchToLogin={() => setAuthView('login')} /></AuthLayout>;
        }
    }

    if (user) {
        if (isLicenseLoading) {
            return <div className="flex h-screen w-screen items-center justify-center"><Loader /></div>;
        }
        return <AppContent licenseStatus={licenseStatus} onLicenseChange={handleLicenseChange} />;
    }

    return <AuthLayout><Login onSwitchToForgotPassword={() => setAuthView('forgot')} /></AuthLayout>;
};

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <LocalizationProvider>
          <NotificationProvider>
            <AppRouter />
          </NotificationProvider>
      </LocalizationProvider>
    </ThemeProvider>
  );
};

export default App;
]]></content>
  </change>
  <change>
    <file>locales/en.json</file>
    <description>Update English translations: add "Remote Access" to sidebar/titles, remove "ZeroTier", and add new keys for the Pi Tunnel manager and the new Remote page tabs.</description>
    <content><![CDATA[{
    "app": {
        "loading_data": "Loading application data..."
    },
    "sidebar": {
        "dashboard": "Dashboard",
        "ai_scripting": "AI Scripting",
        "terminal": "Terminal",
        "routers": "Routers",
        "network": "Network",
        "dhcp-portal": "DHCP Portal",
        "pppoe": "PPPoE Management",
        "billing_plans": "Billing Plans",
        "sales_report": "Sales Report",
        "inventory": "Stock & Inventory",
        "payroll": "Payroll Management",
        "hotspot": "Hotspot",
        "remote": "Remote Access",
        "company": "Company",
        "system_settings": "System Settings",
        "updater": "Updater",
        "logs": "System Logs",
        "panel_roles": "Panel Roles",
        "mikrotik_files": "Mikrotik Files",
        "license": "License",
        "super_admin": "Super Admin",
        "notifications": "Notifications"
    },
    "titles": {
        "dashboard": "Dashboard",
        "scripting": "AI Script Generator",
        "terminal": "Router Terminal",
        "routers": "Router Management",
        "network": "Network Management",
        "dhcp-portal": "DHCP Captive Portal",
        "pppoe": "PPPoE Management",
        "billing": "Billing Plans",
        "sales": "Sales Report",
        "inventory": "Stock & Inventory",
        "payroll": "Payroll Management",
        "hotspot": "Hotspot Management",
        "remote": "Remote Access Management",
        "company": "Company Settings",
        "system": "System Settings",
        "updater": "Panel Updater",
        "logs": "Log Viewer",
        "panel_roles": "Panel Role Management",
        "mikrotik_files": "Mikrotik File Editor",
        "license": "Application Licensing",
        "super_admin": "Super Admin: License Generator",
        "notifications": "System Notifications"
    },
    "topbar": {
        "add_router_title": "Go to Routers page to add a new router",
        "add_a_router": "Add a Router",
        "router": "Router",
        "select": "Select..."
    },
    "common": {
        "cancel": "Cancel",
        "save": "Save",
        "save_plan": "Save Plan"
    },
    "dhcp-portal": {
        "client_management": "Client Management",
        "portal_server": "Portal Server",
        "portal_installer": "Portal Installer",
        "portal_page": "Portal Page"
    },
    "billing": {
        "add_new_plan": "Add New Plan",
        "select_router_alert": "Please select a router before managing plans.",
        "select_router_manage": "Please select a router from the top bar to manage billing plans.",
        "loading_plans": "Loading billing plans...",
        "profile": "Profile",
        "monthly": "Monthly",
        "quarterly": "Quarterly",
        "yearly": "Yearly",
        "delete_confirm": "Are you sure you want to delete this billing plan?",
        "edit_plan_title": "Edit '{{name}}'",
        "add_plan_title": "Add New Billing Plan",
        "plan_name": "Plan Name",
        "plan_name_placeholder": "e.g., Premium 100Mbps",
        "pppoe_profile": "PPPoE Profile",
        "loading_profiles": "Loading profiles...",
        "no_profiles_found": "No profiles found",
        "price": "Price",
        "cycle": "Cycle",
        "description": "Description",
        "description_placeholder": "A brief description of the plan."
    },
    "pppoe": {
        "users": "Users",
        "profiles": "Profiles",
        "servers": "Servers",
        "add_new_server": "Add New Server",
        "edit_server": "Edit Server",
        "service_name": "Service Name",
        "interface": "Interface",
        "default_profile": "Default Profile",
        "authentication": "Authentication"
    },
    "remote": {
        "zerotier": "ZeroTier",
        "pitunnel": "Pi Tunnel",
        "ngrok": "Ngrok",
        "dataplicity": "Dataplicity"
    },
    "pitunnel": {
        "title": "Pi Tunnel Remote Access",
        "step1_title": "Step 1: Get Install Command",
        "step1_desc": "Go to your PiTunnel.com Dashboard, add a new tunnel, and copy the full installation command provided.",
        "install_command": "Pi Tunnel Install Command",
        "install_placeholder": "curl -s https://pitunnel.com/inst/... | sudo python3",
        "step2_title": "Step 2: Manage Service & Check Status",
        "step2_desc": "Use the buttons below to control the Pi Tunnel service. 'Install' will download and run the installer script provided above.",
        "current_status": "Current Status",
        "public_url": "Public URL",
        "status_active": "ACTIVE",
        "status_inactive": "INACTIVE",
        "status_not_installed": "NOT INSTALLED",
        "install": "Install",
        "uninstall": "Uninstall"
    },
    "ngrok": {
        "title": "Ngrok Remote Access",
        "step1_title": "Step 1: Configure Ngrok",
        "step1_desc": "Go to your Ngrok Dashboard to get your Authtoken. Then, specify what local port you want to expose.",
        "authtoken": "Ngrok Authtoken",
        "protocol": "Protocol",
        "http": "HTTP (for Web Servers)",
        "tcp": "TCP (for other services)",
        "local_port": "Local Port",
        "save_settings": "Save Settings",
        "step2_title": "Step 2: Manage Service & Check Status",
        "step2_desc": "Use the buttons below to control the Ngrok service. 'Install' will download Ngrok, create a persistent service based on your settings above, and start it.",
        "current_status": "Current Status",
        "public_url": "Public URL",
        "status_active": "ACTIVE",
        "status_inactive": "INACTIVE",
        "status_not_installed": "NOT INSTALLED",
        "reinstall": "Re-Install / Re-Configure",
        "stop": "Stop",
        "restart": "Restart",
        "uninstall": "Uninstall"
    }
}
]]></content>
  </change>
  <change>
    <file>locales/es.json</file>
    <description>Update Spanish translations: add "Acceso Remoto" to sidebar/titles and remove "ZeroTier".</description>
    <content><![CDATA[{
    "app": {
        "loading_data": "Cargando datos de la aplicación..."
    },
    "sidebar": {
        "dashboard": "Dashboard",
        "ai_scripting": "AI Scripting",
        "terminal": "Terminal",
        "routers": "Routers",
        "network": "Red",
        "dhcp-portal": "Portal DHCP",
        "pppoe": "Gestión PPPoE",
        "billing_plans": "Planes de Facturación",
        "sales_report": "Informe de Ventas",
        "inventory": "Inventario",
        "payroll": "Gestión de Nóminas",
        "hotspot": "Hotspot",
        "remote": "Acceso Remoto",
        "company": "Empresa",
        "system_settings": "Configuración del Sistema",
        "updater": "Actualizador",
        "logs": "Registros del Sistema",
        "panel_roles": "Roles del Panel",
        "mikrotik_files": "Archivos Mikrotik",
        "license": "Licencia",
        "super_admin": "Super Admin",
        "notifications": "Notificaciones"
    },
    "titles": {
        "dashboard": "Dashboard",
        "scripting": "Generador de Scripts de IA",
        "terminal": "Terminal del Router",
        "routers": "Gestión de Routers",
        "network": "Gestión de Red",
        "dhcp-portal": "Portal Cautivo DHCP",
        "pppoe": "Gestión PPPoE",
        "billing": "Planes de Facturación",
        "sales": "Informe de Ventas",
        "inventory": "Stock e Inventario",
        "payroll": "Gestión de Nóminas",
        "hotspot": "Gestión de Hotspot",
        "remote": "Gestión de Acceso Remoto",
        "company": "Configuración de la Empresa",
        "system": "Configuración del Sistema",
        "updater": "Actualizador del Panel",
        "logs": "Visor de Logs",
        "panel_roles": "Gestión de Roles del Panel",
        "mikrotik_files": "Editor de Archivos Mikrotik",
        "license": "Licenciamiento de Aplicación",
        "super_admin": "Super Admin: Generador de Licencias",
        "notifications": "Notificaciones del Sistema"
    },
    "topbar": {
        "add_router_title": "Vaya a la página de Routers para agregar un nuevo router",
        "add_a_router": "Agregar un Router",
        "router": "Router",
        "select": "Seleccionar..."
    },
    "common": {
        "cancel": "Cancelar",
        "save": "Guardar",
        "save_plan": "Guardar Plan"
    },
    "dhcp-portal": {
        "client_management": "Gestión de Clientes",
        "portal_server": "Servidor del Portal",
        "portal_installer": "Instalador del Portal",
        "portal_page": "Página del Portal"
    },
    "billing": {
        "add_new_plan": "Agregar Nuevo Plan",
        "select_router_alert": "Por favor, seleccione un router antes de administrar los planes.",
        "select_router_manage": "Por favor, seleccione un router de la barra superior para administrar los planes de facturación.",
        "loading_plans": "Cargando planes de facturación...",
        "profile": "Perfil",
        "monthly": "Mensual",
        "quarterly": "Trimestral",
        "yearly": "Anual",
        "delete_confirm": "¿Está seguro de que desea eliminar este plan de facturación?",
        "edit_plan_title": "Editar '{{name}}'",
        "add_plan_title": "Agregar Nuevo Plan de Facturación",
        "plan_name": "Nombre del Plan",
        "plan_name_placeholder": "ej., Premium 100Mbps",
        "pppoe_profile": "Perfil PPPoE",
        "loading_profiles": "Cargando perfiles...",
        "no_profiles_found": "No se encontraron perfiles",
        "price": "Precio",
        "cycle": "Ciclo",
        "description": "Descripción",
        "description_placeholder": "Una breve descripción del plan."
    },
     "pppoe": {
        "users": "Usuarios",
        "profiles": "Perfiles",
        "servers": "Servidores",
        "add_new_server": "Agregar Nuevo Servidor",
        "edit_server": "Editar Servidor",
        "service_name": "Nombre del Servicio",
        "interface": "Interfaz",
        "default_profile": "Perfil Predeterminado",
        "authentication": "Autenticación"
    },
    "ngrok": {
        "title": "Acceso Remoto Ngrok",
        "step1_title": "Paso 1: Configurar Ngrok",
        "step1_desc": "Vaya a su Panel de Ngrok para obtener su Authtoken. Luego, especifique qué puerto local desea exponer.",
        "authtoken": "Authtoken de Ngrok",
        "protocol": "Protocolo",
        "http": "HTTP (para Servidores Web)",
        "tcp": "TCP (para otros servicios)",
        "local_port": "Puerto Local",
        "save_settings": "Guardar Configuraciones",
        "step2_title": "Paso 2: Administrar Servicio y Verificar Estado",
        "step2_desc": "Use los botones a continuación para controlar el servicio de Ngrok. 'Instalar' descargará Ngrok, creará un servicio persistente basado en sus configuraciones anteriores y lo iniciará.",
        "current_status": "Estado Actual",
        "public_url": "URL Pública",
        "status_active": "ACTIVO",
        "status_inactive": "INACTIVO",
        "status_not_installed": "NO INSTALADO",
        "reinstall": "Reinstalar / Reconfigurar",
        "stop": "Detener",
        "restart": "Reiniciar",
        "uninstall": "Desinstalar"
    }
}
]]></content>
  </change>
  <change>
    <file>locales/fil.json</file>
    <description>Update Filipino translations: add "Remote Access" to sidebar/titles and remove "ZeroTier".</description>
    <content><![CDATA[{
    "app": {
        "loading_data": "Nilo-load ang data ng application..."
    },
    "sidebar": {
        "dashboard": "Dashboard",
        "ai_scripting": "AI Scripting",
        "terminal": "Terminal",
        "routers": "Mga Router",
        "network": "Network",
        "dhcp-portal": "DHCP Portal",
        "pppoe": "Pamamahala ng PPPoE",
        "billing_plans": "Mga Plano sa Pagsingil",
        "sales_report": "Ulat ng Benta",
        "inventory": "Imbentaryo",
        "payroll": "Pamamahala ng Payroll",
        "hotspot": "Hotspot",
        "remote": "Remote Access",
        "company": "Kumpanya",
        "system_settings": "Mga Setting ng System",
        "updater": "Updater",
        "logs": "Mga Log ng System",
        "panel_roles": "Mga Tungkulin ng Panel",
        "mikrotik_files": "Mga File ng Mikrotik",
        "license": "Lisensya",
        "super_admin": "Super Admin"
    },
    "titles": {
        "dashboard": "Dashboard",
        "scripting": "AI Script Generator",
        "terminal": "Terminal ng Router",
        "routers": "Pamamahala ng Router",
        "network": "Pamamahala ng Network",
        "dhcp-portal": "DHCP Captive Portal",
        "pppoe": "Pamamahala ng PPPoE",
        "billing": "Mga Plano sa Pagsingil",
        "sales": "Ulat ng Benta",
        "inventory": "Stock at Imbentaryo",
        "payroll": "Pamamahala ng Payroll",
        "hotspot": "Pamamahala ng Hotspot",
        "remote": "Pamamahala ng Remote Access",
        "company": "Mga Setting ng Kumpanya",
        "system": "Mga Setting ng System",
        "updater": "Panel Updater",
        "logs": "Tingnan ang Log",
        "panel_roles": "Pamamahala ng Tungkulin ng Panel",
        "mikrotik_files": "Editor ng File ng Mikrotik",
        "license": "Paglilisensya ng Application",
        "super_admin": "Super Admin: Tagabuo ng Lisensya"
    },
    "topbar": {
        "add_router_title": "Pumunta sa pahina ng Mga Router para magdagdag ng bagong router",
        "add_a_router": "Magdagdag ng Router",
        "router": "Router",
        "select": "Pumili..."
    },
    "common": {
        "cancel": "Kanselahin",
        "save": "I-save",
        "save_plan": "I-save ang Plano"
    },
    "dhcp-portal": {
        "client_management": "Pamamahala ng Kliyente",
        "portal_server": "Portal Server",
        "portal_installer": "Instalador ng Portal",
        "portal_page": "Pahina ng Portal"
    },
    "billing": {
        "add_new_plan": "Magdagdag ng Bagong Plano",
        "select_router_alert": "Mangyaring pumili ng router bago pamahalaan ang mga plano.",
        "select_router_manage": "Mangyaring pumili ng router mula sa itaas para pamahalaan ang mga plano sa pagsingil.",
        "loading_plans": "Nilo-load ang mga plano sa pagsingil...",
        "profile": "Profile",
        "monthly": "Buwanan",
        "quarterly": "Kada-tatlong buwan",
        "yearly": "Taunan",
        "delete_confirm": "Sigurado ka bang gusto mong burahin ang plano sa pagsingil na ito?",
        "edit_plan_title": "I-edit ang '{{name}}'",
        "add_plan_title": "Magdagdag ng Bagong Plano sa Pagsingil",
        "plan_name": "Pangalan ng Plano",
        "plan_name_placeholder": "hal., Premium 100Mbps",
        "pppoe_profile": "PPPoE Profile",
        "loading_profiles": "Nilo-load ang mga profile...",
        "no_profiles_found": "Walang nahanap na profile",
        "price": "Presyo",
        "cycle": "Siklo",
        "description": "Deskripsyon",
        "description_placeholder": "Isang maikling paglalarawan ng plano."
    },
    "pppoe": {
        "users": "Mga User",
        "profiles": "Mga Profile",
        "servers": "Mga Server",
        "add_new_server": "Magdagdag ng Bagong Server",
        "edit_server": "I-edit ang Server",
        "service_name": "Pangalan ng Serbisyo",
        "interface": "Interface",
        "default_profile": "Default na Profile",
        "authentication": "Pagpapatunay"
    },
    "ngrok": {
        "title": "Ngrok Remote Access",
        "step1_title": "Hakbang 1: I-configure ang Ngrok",
        "step1_desc": "Pumunta sa iyong Ngrok Dashboard para makuha ang iyong Authtoken. Pagkatapos, tukuyin kung anong local port ang gusto mong i-expose.",
        "authtoken": "Ngrok Authtoken",
        "protocol": "Protocol",
        "http": "HTTP (para sa mga Web Server)",
        "tcp": "TCP (para sa iba pang serbisyo)",
        "local_port": "Local Port",
        "save_settings": "I-save ang mga Setting",
        "step2_title": "Hakbang 2: Pamahalaan ang Serbisyo at Suriin ang Katayuan",
        "step2_desc": "Gamitin ang mga buton sa ibaba para kontrolin ang serbisyo ng Ngrok. Ang 'Install' ay magda-download ng Ngrok, gagawa ng persistent na serbisyo batay sa iyong mga setting sa itaas, at sisimulan ito.",
        "current_status": "Kasalukuyang Katayuan",
        "public_url": "Pampublikong URL",
        "status_active": "AKTIBO",
        "status_inactive": "HINDI AKTIBO",
        "status_not_installed": "HINDI NA-INSTALL",
        "reinstall": "I-install Muli / I-configure Muli",
        "stop": "Itigil",
        "restart": "I-restart",
        "uninstall": "I-uninstall"
    }
}
]]></content>
  </change>
  <change>
    <file>locales/pt.json</file>
    <description>Update Portuguese translations: add "Acesso Remoto" to sidebar/titles and remove "ZeroTier".</description>
    <content><![CDATA[{
    "app": {
        "loading_data": "Carregando dados do aplicativo..."
    },
    "sidebar": {
        "dashboard": "Painel",
        "ai_scripting": "AI Scripting",
        "terminal": "Terminal",
        "routers": "Roteadores",
        "network": "Rede",
        "dhcp-portal": "Portal DHCP",
        "pppoe": "Gerenciamento PPPoE",
        "billing_plans": "Planos de Cobrança",
        "sales_report": "Relatório de Vendas",
        "inventory": "Estoque",
        "payroll": "Gestão de Folha de Pagamento",
        "hotspot": "Hotspot",
        "remote": "Acesso Remoto",
        "company": "Empresa",
        "system_settings": "Configurações do Sistema",
        "updater": "Atualizador",
        "logs": "Logs do Sistema",
        "panel_roles": "Funções do Painel",
        "mikrotik_files": "Arquivos Mikrotik",
        "license": "Licença",
        "super_admin": "Super Admin"
    },
    "titles": {
        "dashboard": "Painel",
        "scripting": "Gerador de Scripts de IA",
        "terminal": "Terminal do Roteador",
        "routers": "Gerenciamento de Roteadores",
        "network": "Gerenciamento de Rede",
        "dhcp-portal": "Portal Cativo DHCP",
        "pppoe": "Gerenciamento PPPoE",
        "billing": "Planos de Cobrança",
        "sales": "Relatório de Vendas",
        "inventory": "Estoque e Inventário",
        "payroll": "Gestão de Folha de Pagamento",
        "hotspot": "Gerenciamento de Hotspot",
        "remote": "Gerenciamento de Acesso Remoto",
        "company": "Configurações da Empresa",
        "system": "Configurações do Sistema",
        "updater": "Atualizador do Painel",
        "logs": "Visualizador de Logs",
        "panel_roles": "Gerenciamento de Funções do Painel",
        "mikrotik_files": "Editor de Arquivos Mikrotik",
        "license": "Licenciamento de Aplicativo",
        "super_admin": "Super Admin: Gerador de Licença"
    },
    "topbar": {
        "add_router_title": "Vá para a página de Roteadores para adicionar um novo roteador",
        "add_a_router": "Adicionar um Roteador",
        "router": "Roteador",
        "select": "Selecionar..."
    },
    "common": {
        "cancel": "Cancelar",
        "save": "Salvar",
        "save_plan": "Salvar Plano"
    },
    "dhcp-portal": {
        "client_management": "Gerenciamento de Clientes",
        "portal_server": "Servidor do Portal",
        "portal_installer": "Instalador do Portal",
        "portal_page": "Página do Portal"
    },
    "billing": {
        "add_new_plan": "Adicionar Novo Plano",
        "select_router_alert": "Por favor, selecione um roteador antes de gerenciar os planos.",
        "select_router_manage": "Por favor, selecione um roteador na barra superior para gerenciar os planos de cobrança.",
        "loading_plans": "Carregando planos de cobrança...",
        "profile": "Perfil",
        "monthly": "Mensal",
        "quarterly": "Trimestral",
        "yearly": "Anual",
        "delete_confirm": "Tem certeza de que deseja excluir este plano de cobrança?",
        "edit_plan_title": "Editar '{{name}}'",
        "add_plan_title": "Adicionar Novo Plano de Cobrança",
        "plan_name": "Nome do Plano",
        "plan_name_placeholder": "ex., Premium 100Mbps",
        "pppoe_profile": "Perfil PPPoE",
        "loading_profiles": "Carregando perfis...",
        "no_profiles_found": "Nenhum perfil encontrado",
        "price": "Preço",
        "cycle": "Ciclo",
        "description": "Descrição",
        "description_placeholder": "Uma breve descrição do plano."
    },
     "pppoe": {
        "users": "Usuários",
        "profiles": "Perfis",
        "servers": "Servidores",
        "add_new_server": "Adicionar Novo Servidor",
        "edit_server": "Editar Servidor",
        "service_name": "Nome do Serviço",
        "interface": "Interface",
        "default_profile": "Perfil Padrão",
        "authentication": "Autenticação"
    },
    "ngrok": {
        "title": "Acesso Remoto com Ngrok",
        "step1_title": "Passo 1: Configurar o Ngrok",
        "step1_desc": "Vá para o seu Painel do Ngrok para obter seu Authtoken. Em seguida, especifique qual porta local você deseja expor.",
        "authtoken": "Authtoken do Ngrok",
        "protocol": "Protocolo",
        "http": "HTTP (para Servidores Web)",
        "tcp": "TCP (para outros serviços)",
        "local_port": "Porta Local",
        "save_settings": "Salvar Configurações",
        "step2_title": "Passo 2: Gerenciar Serviço e Verificar Status",
        "step2_desc": "Use os botões abaixo para controlar o serviço Ngrok. 'Instalar' fará o download do Ngrok, criará um serviço persistente com base em suas configurações e o iniciará.",
        "current_status": "Status Atual",
        "public_url": "URL Pública",
        "status_active": "ATIVO",
        "status_inactive": "INATIVO",
        "status_not_installed": "NÃO INSTALADO",
        "reinstall": "Reinstalar / Reconfigurar",
        "stop": "Parar",
        "restart": "Reiniciar",
        "uninstall": "Desinstalar"
    }
}
]]></content>
  </change>
</changes>
```