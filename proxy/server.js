
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
const si = require('systeminformation');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const archiver = require('archiver');
const tar = require('tar');

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

async function syncCustomerToSupabase(customer) {
    if (!customer || !customer.username) return;
    try {
        const payload = {
            id: customer.id,
            username: customer.username,
            router_id: customer.routerId,
            full_name: customer.fullName,
            address: customer.address,
            contact_number: customer.contactNumber,
            email: customer.email,
            account_number: customer.accountNumber,
            gps: customer.gps,
            application_id: customer.applicationId,
            due_date: customer.dueDate,
            plan_name: customer.planName,
            plan_type: customer.planType,
            password: customer.password
        };
        const { error } = await supabase.from('mikrotik_pppoe_users').upsert(payload, { onConflict: 'username' });
        if (error) console.error('Supabase Sync Error:', error);
    } catch (e) {
        console.error('Supabase Sync Exception:', e);
    }
}

async function deleteCustomerFromSupabase(id) {
    try {
        const { error } = await supabase.from('mikrotik_pppoe_users').delete().eq('id', id);
        if (error) console.error('Supabase Delete Error:', error);
    } catch (e) {
        console.error('Supabase Delete Exception:', e);
    }
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
                paymongoSettings TEXT,
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
        if (!columnNames.includes('paymongoSettings')) await db.exec("ALTER TABLE settings ADD COLUMN paymongoSettings TEXT");
        if (!columnNames.includes('databaseEngine')) await db.exec("ALTER TABLE settings ADD COLUMN databaseEngine TEXT DEFAULT 'sqlite'");
        if (!columnNames.includes('notificationSettings')) await db.exec("ALTER TABLE settings ADD COLUMN notificationSettings TEXT");
        if (!columnNames.includes('landingPageConfig')) await db.exec("ALTER TABLE settings ADD COLUMN landingPageConfig TEXT");
        if (!columnNames.includes('licenseCache')) await db.exec("ALTER TABLE settings ADD COLUMN licenseCache TEXT");
        if (!columnNames.includes('licenseCacheAt')) await db.exec("ALTER TABLE settings ADD COLUMN licenseCacheAt TEXT");
        if (!columnNames.includes('deviceId')) await db.exec("ALTER TABLE settings ADD COLUMN deviceId TEXT");
        
        // Facebook Messenger Bot settings (safe migration with defaults)
        if (!columnNames.includes('facebookSettings')) await db.exec("ALTER TABLE settings ADD COLUMN facebookSettings TEXT");
        
        // Company settings JSON column (for GCash and other config)
        if (!columnNames.includes('companySettings')) await db.exec("ALTER TABLE settings ADD COLUMN companySettings TEXT");

        // Manual payment requests table (for existing databases)
        try {
            await db.exec(`
                CREATE TABLE IF NOT EXISTS manual_payment_requests (
                    id TEXT PRIMARY KEY,
                    customer_account_number TEXT NOT NULL,
                    customer_username TEXT,
                    customer_full_name TEXT,
                    customer_facebook_psid TEXT,
                    customer_router_id TEXT,
                    plan_name TEXT,
                    plan_price REAL NOT NULL,
                    gcash_reference_number TEXT NOT NULL,
                    customer_mobile_number TEXT NOT NULL,
                    customer_name_on_gcash TEXT,
                    payment_screenshot_url TEXT,
                    status TEXT DEFAULT 'pending',
                    admin_notes TEXT,
                    approved_by TEXT,
                    approved_at TEXT,
                    rejected_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT
                )
            `);
            console.log('[Migration] manual_payment_requests table ensured');
        } catch (err) {
            console.warn('[Migration] manual_payment_requests table creation skipped:', err.message);
        }

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
            await db.run("INSERT INTO roles (id, name, description) VALUES (?, ?, ?)", 'role_employee', 'Employee', 'Can view and process payments but cannot delete or edit users');
            
            await db.run("INSERT INTO permissions (id, name, description) VALUES (?, ?, ?)", 'perm_all', '*:*', 'All Permissions');
            await db.run("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", 'role_admin', 'perm_all');
            
            // Employee gets all VIEW permissions but NO delete/edit permissions
            await db.run("INSERT INTO permissions (id, name, description) VALUES (?, ?, ?)", 'perm_action_delete', 'action:delete', 'Can delete records (sales, users, etc.)');
            await db.run("INSERT INTO permissions (id, name, description) VALUES (?, ?, ?)", 'perm_action_edit_users', 'action:edit:users', 'Can edit PPPoE/DHCP users');
            
            // Grant employee all view permissions
            const viewPerms = await db.all("SELECT id FROM permissions WHERE name LIKE 'view:%'");
            for (const perm of viewPerms) {
                await db.run("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", 'role_employee', perm.id);
            }
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
                invoiceId TEXT,
                coveredMonth TEXT,
                processedBy TEXT DEFAULT 'admin',
                payment_method TEXT DEFAULT 'manual'
            );
            CREATE TABLE IF NOT EXISTS manual_payment_requests (
                id TEXT PRIMARY KEY,
                customer_account_number TEXT NOT NULL,
                customer_username TEXT,
                customer_full_name TEXT,
                customer_facebook_psid TEXT,
                customer_router_id TEXT,
                plan_name TEXT,
                plan_price REAL NOT NULL,
                gcash_reference_number TEXT NOT NULL,
                customer_mobile_number TEXT NOT NULL,
                customer_name_on_gcash TEXT,
                payment_screenshot_url TEXT,
                status TEXT DEFAULT 'pending',
                admin_notes TEXT,
                approved_by TEXT,
                approved_at TEXT,
                rejected_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT
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
                amount REAL NOT NULL,
                routerId TEXT
            );
            CREATE TABLE IF NOT EXISTS pisowifi_income (
                id TEXT PRIMARY KEY,
                resellerId TEXT,
                resellerName TEXT,
                vendoLocation TEXT,
                percentage REAL,
                grossSales REAL,
                expenses REAL,
                netTotal REAL,
                createdAt TEXT
            );
            CREATE TABLE IF NOT EXISTS pisowifi_resellers (
                id TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                contactNumber TEXT,
                notes TEXT,
                createdAt TEXT
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
                email TEXT,
                accountNumber TEXT,
                gps TEXT,
                applicationId TEXT
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
            CREATE TABLE IF NOT EXISTS repair_tickets (
                id TEXT PRIMARY KEY,
                client_user_id TEXT,
                username TEXT NOT NULL,
                client_type TEXT DEFAULT 'pppoe',
                category TEXT NOT NULL,
                description TEXT,
                status TEXT DEFAULT 'open',
                priority TEXT DEFAULT 'normal',
                admin_notes TEXT,
                created_by TEXT DEFAULT 'client',
                assigned_to TEXT,
                resolved_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS paymongo_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                invoice_no TEXT NOT NULL UNIQUE,
                pppoe_username TEXT NOT NULL,
                router_id TEXT,
                plan_name TEXT,
                amount REAL,
                status TEXT DEFAULT 'pending',
                processed_at TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
        `);
        // Ensure new columns exist (idempotent migrations)
        try {
            const customerCols = await db.all("PRAGMA table_info(customers)");
            const customerColNames = customerCols.map(c => c.name);
            console.log('[Migration] Customers table columns:', customerColNames);
            
            if (!customerColNames.includes('facebook_psid')) {
                console.log('[Migration] Adding facebook_psid column to customers table...');
                await db.exec("ALTER TABLE customers ADD COLUMN facebook_psid TEXT");
                console.log('[Migration] ✓ facebook_psid column added');
            }
        } catch (err) {
            console.error('[Migration] Customer table migration error:', err.message);
        }
        
        // Add store_enabled column to billing_plans
        try {
            const billingPlanCols = await db.all("PRAGMA table_info(billing_plans)");
            const billingPlanColNames = billingPlanCols.map(c => c.name);
            if (!billingPlanColNames.includes('store_enabled')) {
                console.log('[Migration] Adding store_enabled column to billing_plans...');
                await db.exec("ALTER TABLE billing_plans ADD COLUMN store_enabled INTEGER DEFAULT 1");
                console.log('[Migration] ✓ store_enabled column added to billing_plans');
            }
        } catch (err) {
            console.error('[Migration] billing_plans migration error:', err.message);
        }
        
        // Add store_enabled column to dhcp_billing_plans
        try {
            const dhcpPlanCols = await db.all("PRAGMA table_info(dhcp_billing_plans)");
            const dhcpPlanColNames = dhcpPlanCols.map(c => c.name);
            if (!dhcpPlanColNames.includes('store_enabled')) {
                console.log('[Migration] Adding store_enabled column to dhcp_billing_plans...');
                await db.exec("ALTER TABLE dhcp_billing_plans ADD COLUMN store_enabled INTEGER DEFAULT 1");
                console.log('[Migration] ✓ store_enabled column added to dhcp_billing_plans');
            }
        } catch (err) {
            console.error('[Migration] dhcp_billing_plans migration error:', err.message);
        }
        
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
            if (!salesColNames.includes('planType')) {
                await db.exec("ALTER TABLE sales_records ADD COLUMN planType TEXT DEFAULT 'prepaid'");
            }
            if (!salesColNames.includes('coveredMonth')) {
                await db.exec("ALTER TABLE sales_records ADD COLUMN coveredMonth TEXT");
            }
            if (!salesColNames.includes('payment_method')) {
                await db.exec("ALTER TABLE sales_records ADD COLUMN payment_method TEXT DEFAULT 'manual'");
            }
            if (!salesColNames.includes('processedBy')) {
                await db.exec("ALTER TABLE sales_records ADD COLUMN processedBy TEXT DEFAULT 'admin'");
            }
        } catch (_) {}
        try {
            const pwiCols = await db.all("PRAGMA table_info(pisowifi_income)");
            const pwiColNames = pwiCols.map(c => c.name);
            if (!pwiColNames.includes('resellerId')) {
                await db.exec("ALTER TABLE pisowifi_income ADD COLUMN resellerId TEXT");
            }
        } catch (_) {}
        
        try {
            const resellerNames = await db.all("SELECT DISTINCT TRIM(resellerName) AS name FROM pisowifi_income WHERE resellerName IS NOT NULL AND TRIM(resellerName) <> ''");
            for (const row of resellerNames) {
                const name = row?.name ? String(row.name).trim() : '';
                if (!name) continue;
                const existing = await db.get("SELECT id FROM pisowifi_resellers WHERE LOWER(name) = LOWER(?) LIMIT 1", [name]);
                let resellerId = existing?.id;
                if (!resellerId) {
                    resellerId = `pwr_${crypto.createHash('sha1').update(name.toLowerCase()).digest('hex').slice(0, 12)}`;
                    await db.run(
                        "INSERT OR IGNORE INTO pisowifi_resellers (id, name, createdAt) VALUES (?, ?, ?)",
                        [resellerId, name, new Date().toISOString()]
                    );
                }
                await db.run(
                    "UPDATE pisowifi_income SET resellerId = ? WHERE (resellerId IS NULL OR resellerId = '') AND resellerName = ?",
                    [resellerId, name]
                );
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
        // Once generated, persist the device ID to the DB so it never changes between runs.
        // This prevents license "bound to another device" errors caused by fluctuating CPU speed readings.
        const stored = await db.get('SELECT deviceId FROM settings WHERE id = 1');
        if (stored?.deviceId) {
            return stored.deviceId;
        }

        // Generate a stable hardware ID
        const cpu = await si.cpu();
        const sys = await si.system();
        const uuid = await si.uuid();

        let rawId = null;

        // Use CPU brand + cores only — speed is excluded because it fluctuates with CPU frequency scaling
        if (cpu && cpu.brand && cpu.cores) {
            rawId = `${cpu.brand}-${cpu.cores}-${cpu.physicalCores || cpu.cores}`;
        }

        // Fallback to System Serial (Host Board Serial) if valid
        if (!rawId && sys.serial && sys.serial !== '-' && sys.serial !== 'Default string' && sys.serial !== 'To be filled by O.E.M.') {
            rawId = sys.serial;
        }

        // Fallback to Hardware UUID
        if (!rawId && uuid.hardware && uuid.hardware !== '-') {
            rawId = uuid.hardware;
        }

        // Fallback to OS UUID (Windows MachineGuid / Linux machine-id)
        if (!rawId && uuid.os && uuid.os !== '-') {
            rawId = uuid.os;
        }

        // Final Fallback: MAC Addresses
        if (!rawId) {
            const networkInterfaces = os.networkInterfaces();
            let macs = [];
            const ignoredInterfacePattern = /^(zt|docker|veth|br-|tun|tap|lo)/i;
            for (const [name, interfaces] of Object.entries(networkInterfaces)) {
                if (ignoredInterfacePattern.test(name)) continue;
                for (const iface of interfaces) {
                    if (iface.mac && iface.mac !== '00:00:00:00:00:00' && !iface.internal) {
                        macs.push(iface.mac);
                    }
                }
            }
            macs.sort();
            rawId = macs.join('') || (os.hostname() + os.arch() + os.platform());
        }

        const deviceId = crypto.createHash('sha256').update(rawId).digest('hex');

        // Persist so future calls always return the same value
        try {
            await db.run('UPDATE settings SET deviceId = ? WHERE id = 1', [deviceId]);
        } catch (e) {
            console.warn('[getDeviceId] Could not persist deviceId:', e.message);
        }

        return deviceId;

    } catch (e) {
        console.error('Failed to get device ID:', e);
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

const requireSuperadminOrAdmin = (req, res, next) => {
    const roleName = req.user?.role?.name?.toLowerCase();
    if (roleName !== 'superadmin' && roleName !== 'administrator') {
        return res.status(403).json({ message: 'Access denied. Admin or Superadmin privileges required.' });
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

    app.use(express.json({
        limit: '10mb',
        verify: (req, res, buf) => {
            req.rawBody = buf;
        }
    }));
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

    // Password change endpoint for regular users
    authRouter.post('/change-password', protect, async (req, res) => {
        const { currentPassword, newPassword } = req.body;
        
        try {
            // Validate input
            if (!currentPassword || !newPassword) {
                return res.status(400).json({ message: 'Current password and new password are required' });
            }
            
            if (newPassword.length < 6) {
                return res.status(400).json({ message: 'New password must be at least 6 characters long' });
            }
            
            // Check if user is superadmin
            if (req.user.id === 'superadmin') {
                const superadmin = await superadminDb.get('SELECT * FROM superadmin WHERE username = ?', ['superadmin']);
                if (!superadmin) {
                    return res.status(404).json({ message: 'Superadmin not found' });
                }
                
                const isValid = await bcrypt.compare(currentPassword, superadmin.password);
                if (!isValid) {
                    return res.status(401).json({ message: 'Current password is incorrect' });
                }
                
                const hashedPassword = await bcrypt.hash(newPassword, 10);
                await superadminDb.run('UPDATE superadmin SET password = ? WHERE username = ?', [hashedPassword, 'superadmin']);
                return res.json({ message: 'Password updated successfully' });
            }
            
            // Regular user password change
            const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }
            
            const isValid = await bcrypt.compare(currentPassword, user.password);
            if (!isValid) {
                return res.status(401).json({ message: 'Current password is incorrect' });
            }
            
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            await db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.user.id]);
            
            res.json({ message: 'Password updated successfully' });
        } catch (err) {
            console.error('Password change error:', err);
            res.status(500).json({ message: 'Failed to update password' });
        }
    });

    // Password change endpoint for superadmin (alternative route)
    authRouter.post('/change-superadmin-password', protect, async (req, res) => {
        const { currentPassword, newPassword } = req.body;
        
        try {
            // Validate input
            if (!currentPassword || !newPassword) {
                return res.status(400).json({ message: 'Current password and new password are required' });
            }
            
            if (newPassword.length < 6) {
                return res.status(400).json({ message: 'New password must be at least 6 characters long' });
            }
            
            // Only superadmin can use this endpoint
            if (req.user.id !== 'superadmin') {
                return res.status(403).json({ message: 'Access denied. Superadmin privileges required.' });
            }
            
            const superadmin = await superadminDb.get('SELECT * FROM superadmin WHERE username = ?', ['superadmin']);
            if (!superadmin) {
                return res.status(404).json({ message: 'Superadmin not found' });
            }
            
            const isValid = await bcrypt.compare(currentPassword, superadmin.password);
            if (!isValid) {
                return res.status(401).json({ message: 'Current password is incorrect' });
            }
            
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            await superadminDb.run('UPDATE superadmin SET password = ? WHERE username = ?', [hashedPassword, 'superadmin']);
            
            res.json({ message: 'Password updated successfully' });
        } catch (err) {
            console.error('Superadmin password change error:', err);
            res.status(500).json({ message: 'Failed to update password' });
        }
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
                
                // If this is a sales record, sync to mikrotik sales logs
                if (table === 'sales_records' && supabase) {
                    try {
                        // Get the created record
                        const createdId = req.body.id;
                        const createdSale = await db.get('SELECT * FROM sales_records WHERE id = ?', [createdId]);
                        
                        if (createdSale) {
                            // Get license info
                            const settings = await db.get('SELECT * FROM settings WHERE id = 1');
                            if (settings?.licenseKey) {
                                // Find license in Supabase
                                const { data: licenseData, error: licenseError } = await supabase
                                    .from('mikrotik_licenses')
                                    .select('id')
                                    .eq('license_key', settings.licenseKey)
                                    .single();

                                if (!licenseError && licenseData) {
                                    // Get router info
                                    const router = await db.get('SELECT * FROM routers WHERE id = ?', [createdSale.routerId]);
                                    if (router) {
                                        // Find router in Supabase
                                        const { data: routerData, error: routerError } = await supabase
                                            .from('mikrotik_routers')
                                            .select('id')
                                            .eq('license_id', licenseData.id)
                                            .eq('router_ip', router.host)
                                            .single();

                                        let routerId = routerData?.id;

                                        // Create router if not exists
                                        if (!routerId && !routerError) {
                                            const { data: newRouter, error: createRouterError } = await supabase
                                                .from('mikrotik_routers')
                                                .insert([{
                                                    license_id: licenseData.id,
                                                    router_name: router.name || 'Unknown',
                                                    router_ip: router.host || 'Unknown',
                                                    router_model: router.model || 'Unknown',
                                                    router_serial: router.serial || 'Unknown',
                                                    router_version: router.version || 'Unknown',
                                                    created_at: new Date().toISOString()
                                                }])
                                                .select()
                                                .single();

                                            if (!createRouterError && newRouter) {
                                                routerId = newRouter.id;
                                            }
                                        }

                                        // Create sales log if router exists
                                        if (routerId) {
                                            await supabase
                                                .from('mikrotik_sales_logs')
                                                .insert([{
                                                    license_id: licenseData.id,
                                                    router_id: routerId,
                                                    amount: createdSale.finalAmount || 0,
                                                    currency: createdSale.currency || 'PHP',
                                                    transaction_type: 'sale',
                                                    created_at: createdSale.date || new Date().toISOString()
                                                }]);
                                        }
                                    }
                                }
                            }
                        }
                    } catch (syncError) {
                        console.error('Error syncing to mikrotik sales logs:', syncError);
                        // Don't fail the main operation if sync fails
                    }
                }
                
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
                                `INSERT INTO sales_records (id, routerId, date, clientName, planName, planPrice, discountAmount, finalAmount, routerName, currency, clientAddress, clientContact, clientEmail, invoiceId, coveredMonth)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                                    existing.id,
                                    null
                                ]
                            );
                            
                            // Sync to mikrotik sales logs
                            if (supabase) {
                                try {
                                    // Get license info
                                    const settings = await db.get('SELECT * FROM settings WHERE id = 1');
                                    if (settings?.licenseKey) {
                                        // Find license in Supabase
                                        const { data: licenseData, error: licenseError } = await supabase
                                            .from('mikrotik_licenses')
                                            .select('id')
                                            .eq('license_key', settings.licenseKey)
                                            .single();

                                        if (!licenseError && licenseData) {
                                            // Find router in Supabase
                                            const { data: routerData, error: routerError } = await supabase
                                                .from('mikrotik_routers')
                                                .select('id')
                                                .eq('license_id', licenseData.id)
                                                .eq('router_ip', existing.host)
                                                .single();

                                            let routerId = routerData?.id;

                                            // Create router if not exists
                                            if (!routerId && !routerError) {
                                                const { data: newRouter, error: createRouterError } = await supabase
                                                    .from('mikrotik_routers')
                                                    .insert([{
                                                        license_id: licenseData.id,
                                                        router_name: router?.name || 'Unknown',
                                                        router_ip: existing.host || 'Unknown',
                                                        router_model: 'Unknown',
                                                        router_serial: 'Unknown',
                                                        router_version: 'Unknown',
                                                        created_at: new Date().toISOString()
                                                    }])
                                                    .select()
                                                    .single();

                                                if (!createRouterError && newRouter) {
                                                    routerId = newRouter.id;
                                                }
                                            }

                                            // Create sales log if router exists
                                            if (routerId) {
                                                // Convert currency symbol to currency code
                                                const currencyCode = convertCurrencyToCode(existing.currency);

                                                await supabase
                                                    .from('mikrotik_sales_logs')
                                                    .insert([{
                                                        license_id: licenseData.id,
                                                        router_id: routerId,
                                                        amount: existing.amount || 0,
                                                        currency: currencyCode,
                                                        transaction_type: 'sale',
                                                        created_at: new Date().toISOString()
                                                    }]);
                                            }
                                        }
                                    }
                                } catch (syncError) {
                                    console.error('Error syncing to mikrotik sales logs:', syncError);
                                    // Don't fail the main operation if sync fails
                                }
                            }
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
    createCrud('/pisowifi-income', 'pisowifi_income');
    createCrud('/pisowifi-resellers', 'pisowifi_resellers');
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

    // Helper function to convert currency symbols to currency codes
    const convertCurrencyToCode = (currency) => {
        if (!currency) return 'PHP';
        
        // Check for symbols (order matters - check longer symbols first)
        if (currency === '₱' || currency.includes('₱')) return 'PHP';
        if (currency === 'R$' || currency.includes('R$')) return 'BRL';
        if (currency === '€' || currency.includes('€')) return 'EUR';
        if (currency === '$' || currency.includes('$')) return 'USD';
        
        // If it's already a valid currency code, return it
        if (['PHP', 'USD', 'EUR', 'BRL'].includes(currency.toUpperCase())) {
            return currency.toUpperCase();
        }
        
        // Default to PHP
        return 'PHP';
    };

    // Mikrotik Sales Logs API - Sync with Supabase
    dbRouter.get('/mikrotik-sales-logs', async (req, res) => {
        try {
            const { routerId } = req.query;
            
            if (!supabase) {
                return res.status(500).json({ message: 'Supabase not configured' });
            }

            // Get the current license key from local settings
            const settings = await db.get('SELECT licenseKey FROM settings WHERE id = 1');
            if (!settings?.licenseKey) {
                return res.status(400).json({ message: 'No license configured' });
            }

            // Find the license in Supabase
            const { data: licenseData, error: licenseError } = await supabase
                .from('mikrotik_licenses')
                .select('id')
                .eq('license_key', settings.licenseKey)
                .single();

            if (licenseError || !licenseData) {
                return res.status(404).json({ message: 'License not found in Supabase' });
            }

            let query = supabase
                .from('mikrotik_sales_logs')
                .select('*')
                .eq('license_id', licenseData.id)
                .order('created_at', { ascending: false });

            if (routerId) {
                // Find router in Supabase by IP from local database
                const router = await db.get('SELECT host FROM routers WHERE id = ?', [routerId]);
                if (router?.host) {
                    const { data: routerData } = await supabase
                        .from('mikrotik_routers')
                        .select('id')
                        .eq('license_id', licenseData.id)
                        .eq('router_ip', router.host)
                        .single();
                    
                    if (routerData?.id) {
                        query = query.eq('router_id', routerData.id);
                    }
                }
            }

            const { data, error } = await query;
            
            if (error) {
                console.error('Error fetching mikrotik sales logs:', error);
                return res.status(500).json({ message: error.message });
            }

            res.json(data || []);
        } catch (e) {
            console.error('Failed to fetch mikrotik sales logs:', e);
            res.status(500).json({ message: e.message });
        }
    });

    dbRouter.post('/mikrotik-sales-logs', async (req, res) => {
        try {
            const { router_id, amount, currency, transaction_type } = req.body;
            
            if (!supabase) {
                return res.status(500).json({ message: 'Supabase not configured' });
            }

            if (!router_id || !amount || !transaction_type) {
                return res.status(400).json({ message: 'Missing required fields: router_id, amount, transaction_type' });
            }

            // Get the current license key from local settings
            const settings = await db.get('SELECT licenseKey FROM settings WHERE id = 1');
            if (!settings?.licenseKey) {
                return res.status(400).json({ message: 'No license configured' });
            }

            // Find the license in Supabase
            const { data: licenseData, error: licenseError } = await supabase
                .from('mikrotik_licenses')
                .select('id')
                .eq('license_key', settings.licenseKey)
                .single();

            if (licenseError || !licenseData) {
                return res.status(404).json({ message: 'License not found in Supabase' });
            }

            // Convert currency symbol to currency code
            const currencyCode = convertCurrencyToCode(currency);

            const { data, error } = await supabase
                .from('mikrotik_sales_logs')
                .insert([{
                    license_id: licenseData.id,
                    router_id,
                    amount: parseFloat(amount),
                    currency: currencyCode,
                    transaction_type,
                    created_at: new Date().toISOString()
                }])
                .select()
                .single();

            if (error) {
                console.error('Error creating mikrotik sales log:', error);
                return res.status(500).json({ message: error.message });
            }

            res.json(data);
        } catch (e) {
            console.error('Failed to create mikrotik sales log:', e);
            res.status(500).json({ message: e.message });
        }
    });

    dbRouter.post('/sales/sync-to-mikrotik', async (req, res) => {
        try {
            const { saleId } = req.body;
            
            if (!supabase) {
                return res.status(500).json({ message: 'Supabase not configured' });
            }

            if (!saleId) {
                return res.status(400).json({ message: 'Sale ID is required' });
            }

            // Get the sale record
            const sale = await db.get('SELECT * FROM sales_records WHERE id = ?', [saleId]);
            if (!sale) {
                return res.status(404).json({ message: 'Sale record not found' });
            }

            // Get router info to find license
            const router = await db.get('SELECT * FROM routers WHERE id = ?', [sale.routerId]);
            if (!router) {
                return res.status(404).json({ message: 'Router not found' });
            }

            // Get license info
            const settings = await db.get('SELECT * FROM settings WHERE id = 1');
            if (!settings?.licenseKey) {
                return res.status(400).json({ message: 'No license key found' });
            }

            // Find license in Supabase
            const { data: licenseData, error: licenseError } = await supabase
                .from('mikrotik_licenses')
                .select('id')
                .eq('license_key', settings.licenseKey)
                .single();

            if (licenseError || !licenseData) {
                return res.status(404).json({ message: 'License not found in Supabase' });
            }

            // Find router in Supabase
            const { data: routerData, error: routerError } = await supabase
                .from('mikrotik_routers')
                .select('id')
                .eq('license_id', licenseData.id)
                .eq('router_ip', router.host)
                .single();

            let routerId = routerData?.id;

            // Create router if not exists
            if (!routerId) {
                const { data: newRouter, error: createRouterError } = await supabase
                    .from('mikrotik_routers')
                    .insert([{
                        license_id: licenseData.id,
                        router_name: router.name,
                        router_ip: router.host,
                        router_model: router.model || 'Unknown',
                        router_serial: router.serial || 'Unknown',
                        router_version: router.version || 'Unknown',
                        created_at: new Date().toISOString()
                    }])
                    .select()
                    .single();

                if (createRouterError) {
                    return res.status(500).json({ message: 'Failed to create router in Supabase' });
                }

                routerId = newRouter.id;
            }

            // Create sales log
            const currencyCode = convertCurrencyToCode(sale.currency);

            const { data: salesLog, error: salesLogError } = await supabase
                .from('mikrotik_sales_logs')
                .insert([{
                    license_id: licenseData.id,
                    router_id: routerId,
                    amount: sale.finalAmount,
                    currency: currencyCode,
                    transaction_type: 'sale',
                    created_at: sale.date || new Date().toISOString()
                }])
                .select()
                .single();

            if (salesLogError) {
                console.error('Error creating sales log:', salesLogError);
                return res.status(500).json({ message: 'Failed to create sales log in Supabase' });
            }

            res.json({ 
                success: true, 
                message: 'Sale synced to Mikrotik successfully',
                data: salesLog 
            });

        } catch (e) {
            console.error('Failed to sync sale to mikrotik:', e);
            res.status(500).json({ message: e.message });
        }
    });

    // Bulk sync all sales to mikrotik sales logs
    dbRouter.post('/sales/bulk-sync-to-mikrotik', async (req, res) => {
        try {
            const { routerId } = req.body;
            
            if (!supabase) {
                return res.status(500).json({ message: 'Supabase not configured' });
            }

            // Get the current license key from local settings
            const settings = await db.get('SELECT licenseKey FROM settings WHERE id = 1');
            if (!settings?.licenseKey) {
                return res.status(400).json({ message: 'No license configured' });
            }

            // Find the license in Supabase
            const { data: licenseData, error: licenseError } = await supabase
                .from('mikrotik_licenses')
                .select('id')
                .eq('license_key', settings.licenseKey)
                .single();

            if (licenseError || !licenseData) {
                return res.status(404).json({ message: 'License not found in Supabase' });
            }

            // Get all sales records that haven't been synced yet
            let salesQuery = 'SELECT * FROM sales_records';
            let salesParams = [];
            
            if (routerId) {
                salesQuery += ' WHERE routerId = ?';
                salesParams.push(routerId);
            }
            
            salesQuery += ' ORDER BY date DESC';
            
            const sales = await db.all(salesQuery, salesParams);
            
            let syncedCount = 0;
            let skippedCount = 0;
            let errorCount = 0;
            const errors = [];

            // Process each sale
            for (const sale of sales) {
                try {
                    // Check if this sale is already synced by looking for existing mikrotik sales log
                    // We'll use a combination of router_id, amount, and date to identify duplicates
                    const router = await db.get('SELECT host FROM routers WHERE id = ?', [sale.routerId]);
                    if (!router?.host) {
                        skippedCount++;
                        continue;
                    }

                    // Find router in Supabase
                    const { data: routerData } = await supabase
                        .from('mikrotik_routers')
                        .select('id')
                        .eq('license_id', licenseData.id)
                        .eq('router_ip', router.host)
                        .single();

                    if (!routerData?.id) {
                        skippedCount++;
                        continue;
                    }

                    // Check if this sale already exists in mikrotik sales logs
                    const { data: existingLog } = await supabase
                        .from('mikrotik_sales_logs')
                        .select('id')
                        .eq('license_id', licenseData.id)
                        .eq('router_id', routerData.id)
                        .eq('amount', sale.finalAmount)
                        .eq('created_at', sale.date)
                        .single();

                    if (existingLog) {
                        skippedCount++;
                        continue;
                    }

                    // Convert currency symbol to currency code
                    const currencyCode = convertCurrencyToCode(sale.currency);

                    // Create mikrotik sales log
                    await supabase
                        .from('mikrotik_sales_logs')
                        .insert([{
                            license_id: licenseData.id,
                            router_id: routerData.id,
                            amount: sale.finalAmount,
                            currency: currencyCode,
                            transaction_type: 'sale',
                            created_at: sale.date || new Date().toISOString()
                        }]);

                    syncedCount++;
                } catch (error) {
                    errorCount++;
                    errors.push({ saleId: sale.id, error: error.message });
                    console.error('Error syncing sale', sale.id, ':', error);
                }
            }

            res.json({
                success: true,
                message: `Bulk sync completed. Synced: ${syncedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`,
                data: {
                    synced: syncedCount,
                    skipped: skippedCount,
                    errors: errorCount,
                    errorDetails: errors
                }
            });

        } catch (e) {
            console.error('Failed to bulk sync sales to mikrotik:', e);
            res.status(500).json({ message: e.message });
        }
    });

    // Sync All Customers (Bi-directional)
    dbRouter.post('/customers/sync', async (req, res) => {
        try {
            console.log('Starting full customer sync...');
            
            // 1. Fetch all local customers
            const localCustomers = await db.all('SELECT * FROM customers');
            const localMap = new Map(localCustomers.map(c => [c.username, c]));

            // 2. Fetch all Supabase customers
            const { data: remoteCustomers, error } = await supabase.from('mikrotik_pppoe_users').select('*');
            if (error) throw new Error(`Supabase fetch failed: ${error.message}`);
            const remoteMap = new Map(remoteCustomers.map(c => [c.username, c]));

            let syncedToCloud = 0;
            let syncedToLocal = 0;
            let updatedLocal = 0;

            // --- 2.5 Enrich Local Data from Mikrotik Secrets (Fix missing plan/due date) ---
            // Group local customers by routerId to batch requests
            const customersByRouter = {};
            for (const c of localCustomers) {
                if (c.routerId) {
                    if (!customersByRouter[c.routerId]) customersByRouter[c.routerId] = [];
                    customersByRouter[c.routerId].push(c);
                }
            }

            // Process each router
            for (const routerId of Object.keys(customersByRouter)) {
                try {
                    // Fetch all secrets for this router from Backend API
                    // Note: This relies on the backend running on the same machine/network.
                    // If the backend is on a different port, ensure it's correct (default 3002).
                    // The 'node-routeros-v2' client is used internally by the backend.
                    // We can call the backend API endpoint directly.
                    // Assuming backend is running on port 3002 or we can use internal RouterOS client if available.
                    // However, 'proxy/server.js' IS the backend (port 3001).
                    // The `node-routeros-v2` logic is usually in `api-backend/server.js` (port 3002).
                    // Let's assume we can fetch from localhost:3002.
                    
                    const secretsUrl = `http://localhost:3002/${routerId}/ppp/secret/print`;
                    const response = await axios.get(secretsUrl);
                    const secrets = Array.isArray(response.data) ? response.data : [];
                    
                    // Map secrets by name for quick lookup
                    const secretMap = new Map();
                    for (const s of secrets) {
                        if (s.name) secretMap.set(s.name, s);
                    }

                    // Update customers with data from secrets
                    for (const customer of customersByRouter[routerId]) {
                        const secret = secretMap.get(customer.username);
                        if (secret && secret.comment) {
                            try {
                                const commentData = JSON.parse(secret.comment);
                                let needsUpdate = false;
                                
                                // Check and update fields if they are missing or different
                                if (commentData.dueDate && commentData.dueDate !== customer.dueDate) {
                                    customer.dueDate = commentData.dueDate;
                                    needsUpdate = true;
                                }
                                
                                // Plan Name: Fallback to profile if plan/planName is missing in comment
                                const extractedPlanName = commentData.planName || commentData.plan || secret.profile;
                                if (extractedPlanName && extractedPlanName !== customer.planName) {
                                    customer.planName = extractedPlanName;
                                    needsUpdate = true;
                                }

                                if (commentData.planType && commentData.planType !== customer.planType) {
                                    customer.planType = commentData.planType;
                                    needsUpdate = true;
                                }
                                // Check password from secret
                                if (secret.password && secret.password !== customer.password) {
                                    customer.password = secret.password;
                                    needsUpdate = true;
                                }

                                if (needsUpdate) {
                                    // Update the local database
                                    await db.run(
                                        `UPDATE customers SET dueDate = ?, planName = ?, planType = ?, password = ? WHERE id = ?`,
                                        [customer.dueDate, customer.planName, customer.planType, customer.password, customer.id]
                                    );
                                    updatedLocal++;
                                }
                            } catch (parseErr) {
                                // Ignore non-JSON comments or parsing errors
                            }
                        }
                    }
                } catch (routerErr) {
                    console.error(`Failed to sync secrets for router ${routerId}:`, routerErr.message);
                }
            }
            // -------------------------------------------------------------------------------

            // 3. Local -> Supabase (Sync missing or update)
            for (const local of localCustomers) {
                // Always upsert to cloud to ensure latest local state is preserved
                await syncCustomerToSupabase(local);
                syncedToCloud++;
            }

            // 4. Supabase -> Local (Restore missing)
            for (const remote of remoteCustomers) {
                if (!localMap.has(remote.username)) {
                    // Restore to local
                    await db.run(
                        `INSERT INTO customers (id, username, routerId, fullName, address, contactNumber, email, accountNumber, gps, applicationId, dueDate, planName, planType, password) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            remote.id,
                            remote.username,
                            remote.router_id,
                            remote.full_name,
                            remote.address,
                            remote.contact_number,
                            remote.email,
                            remote.account_number,
                            remote.gps,
                            remote.application_id,
                            remote.due_date,
                            remote.plan_name,
                            remote.plan_type,
                            remote.password
                        ]
                    );
                    syncedToLocal++;
                } else {
                    // Optional: If local exists, we could update it if remote is newer?
                    // For now, let's assume local is master, so we already pushed local -> cloud above.
                    // But if local is missing fields that remote has (e.g. after a partial data loss?), maybe update?
                    // Let's stick to "Restore missing" for safety to avoid overwriting active local changes.
                }
            }

            res.json({
                message: 'Sync complete',
                stats: {
                    toCloud: syncedToCloud,
                    toLocal: syncedToLocal,
                    updatedLocal: updatedLocal
                }
            });
        } catch (e) {
            console.error('Sync failed:', e);
            res.status(500).json({ message: e.message });
        }
    });

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
                
                // Sync to Supabase
                const updatedCustomer = await db.get('SELECT * FROM customers WHERE id = ?', [existing.id]);
                await syncCustomerToSupabase(updatedCustomer);

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
                
                // Sync to Supabase
                const newCustomer = await db.get('SELECT * FROM customers WHERE username = ?', [username]);
                await syncCustomerToSupabase(newCustomer);

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
            
            // Sync to Supabase
            const updatedCustomer = await db.get('SELECT * FROM customers WHERE id = ?', [id]);
            await syncCustomerToSupabase(updatedCustomer);

            res.json({ message: 'Updated' });
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    dbRouter.delete('/customers/:id', async (req, res) => {
        try {
            const id = req.params.id;
            await deleteCustomerFromSupabase(id);
            await db.run(`DELETE FROM customers WHERE id = ?`, id);
            res.json({ message: 'Deleted' });
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // Special handling for settings
    dbRouter.get('/panel-settings', async (req, res) => {
        try {
            const s = await db.get('SELECT * FROM settings WHERE id = 1');
            if(s) {
                try { s.telegramSettings = JSON.parse(s.telegramSettings); } catch(e) {}
                try { s.paymongoSettings = JSON.parse(s.paymongoSettings); } catch(e) {}
                try { s.facebookSettings = JSON.parse(s.facebookSettings); } catch(e) {}
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
            const s = await db.get('SELECT companyName, address, contactNumber, email, logoBase64, companySettings FROM settings WHERE id = 1');
            if (s && s.companySettings) {
                try {
                    const companySettings = JSON.parse(s.companySettings);
                    // Merge companySettings JSON with direct columns
                    res.json({ ...s, ...companySettings });
                } catch (e) {
                    res.json(s);
                }
            } else {
                res.json(s || {});
            }
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    dbRouter.post('/company-settings', async (req, res) => {
        try {
            // Extract GCash fields and store them in companySettings JSON
            const { gcashNumber, gcashAccountName, ...directFields } = req.body;
            
            // Get existing companySettings
            const existing = await db.get('SELECT companySettings FROM settings WHERE id = 1');
            let companySettings = {};
            if (existing && existing.companySettings) {
                try {
                    companySettings = JSON.parse(existing.companySettings);
                } catch (e) {}
            }
            
            // Update with new GCash fields
            if (gcashNumber !== undefined) companySettings.gcashNumber = gcashNumber;
            if (gcashAccountName !== undefined) companySettings.gcashAccountName = gcashAccountName;
            
            // Save direct fields as columns
            const keys = Object.keys(directFields);
            const values = Object.values(directFields);
            const setClause = keys.map(k => `${k} = ?`).join(',');
            
            // Also save companySettings as JSON
            const finalSetClause = setClause ? `${setClause}, companySettings = ?` : 'companySettings = ?';
            const finalValues = setClause ? [...values, JSON.stringify(companySettings)] : [JSON.stringify(companySettings)];
            
            await db.run(`UPDATE settings SET ${finalSetClause} WHERE id = 1`, finalValues);
            res.json({ message: 'Company settings saved' });
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    dbRouter.post('/panel-settings', async (req, res) => {
        try {
            const data = { ...req.body };
            if (data.telegramSettings) data.telegramSettings = JSON.stringify(data.telegramSettings);
            if (data.paymongoSettings) data.paymongoSettings = JSON.stringify(data.paymongoSettings);
            if (data.facebookSettings) data.facebookSettings = JSON.stringify(data.facebookSettings);
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

    // Manual Payment Requests API (Public - Admin Panel Access)
    app.get('/api/public/manual-payments', async (req, res) => {
        try {
            const { status } = req.query;
            let query = 'SELECT * FROM manual_payment_requests WHERE 1=1';
            const params = [];
            
            if (status) {
                query += ' AND status = ?';
                params.push(status);
            }
            
            query += ' ORDER BY created_at DESC';
            
            const payments = await db.all(query, params);
            res.json(payments);
        } catch (e) {
            console.error('[Manual Payments] Error fetching payments:', e.message);
            res.status(500).json({ message: e.message });
        }
    });

    app.post('/api/public/manual-payments/:id/approve', async (req, res) => {
        try {
            const { admin_notes } = req.body;
            const paymentId = req.params.id;
            
            const payment = await db.get('SELECT * FROM manual_payment_requests WHERE id = ?', [paymentId]);
            
            if (!payment) {
                return res.status(404).json({ message: 'Payment request not found' });
            }
            
            if (payment.status !== 'pending') {
                return res.status(400).json({ message: 'Payment already processed' });
            }
            
            const now = new Date().toISOString();
            
            // Update payment status
            await db.run(
                'UPDATE manual_payment_requests SET status = ?, admin_notes = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?',
                ['approved', admin_notes || '', 'admin', now, now, paymentId]
            );
            
            // Record as sale in sales_records
            const saleId = `sale_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await db.run(
                'INSERT INTO sales_records (id, routerId, date, clientName, planName, planPrice, finalAmount, payment_method, processedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [saleId, payment.customer_router_id, now, payment.customer_full_name, payment.plan_name, payment.plan_price, payment.plan_price, 'manual_gcash', 'admin']
            );
            
            // Update customer due date (extend by 30 days from CURRENT due date, not today)
            const customer = await db.get('SELECT * FROM customers WHERE accountNumber = ?', [payment.customer_account_number]);
            const currentDate = new Date();
            let newDueDate;
            
            // If customer has existing due date in the future, extend from that date
            if (customer && customer.dueDate) {
                const existingDueDate = new Date(customer.dueDate);
                if (existingDueDate > currentDate) {
                    // Extend from existing due date
                    newDueDate = new Date(existingDueDate);
                    newDueDate.setDate(newDueDate.getDate() + 30);
                    console.log(`[Manual Payments] Extending from existing due date: ${customer.dueDate} -> ${newDueDate.toISOString().split('T')[0]}`);
                } else {
                    // Due date is in the past, extend from today
                    newDueDate = new Date(currentDate);
                    newDueDate.setDate(newDueDate.getDate() + 30);
                    console.log(`[Manual Payments] Due date expired, extending from today: ${newDueDate.toISOString().split('T')[0]}`);
                }
            } else {
                // No existing due date, start from today
                newDueDate = new Date(currentDate);
                newDueDate.setDate(newDueDate.getDate() + 30);
                console.log(`[Manual Payments] No due date, starting from today: ${newDueDate.toISOString().split('T')[0]}`);
            }
            
            const dueDateStr = newDueDate.toISOString().split('T')[0];
            
            await db.run(
                'UPDATE customers SET dueDate = ?, planType = ? WHERE accountNumber = ?',
                [dueDateStr, 'Active', payment.customer_account_number]
            );
            
            // CRITICAL: Update MikroTik PPPoE secret with new due date (same as PayMongo)
            try {
                const router = await db.get('SELECT * FROM routers WHERE id = ?', [payment.customer_router_id]);
                
                if (router) {
                    const axios = require('axios');
                    const apiBase = `http://${router.host}:${router.port}`;
                    const authHeader = `Basic ${Buffer.from(`${router.user}:${router.password}`).toString('base64')}`;
                    
                    // Get PPP secret
                    const secretRes = await axios.get(`${apiBase}/rest/ppp/secret`, {
                        params: { name: payment.customer_username },
                        headers: { Authorization: authHeader },
                        timeout: 10000
                    });
                    
                    const secrets = Array.isArray(secretRes.data) ? secretRes.data : [secretRes.data];
                    const secret = secrets.find(s => s.name === payment.customer_username) || secrets[0];
                    
                    if (secret) {
                        // Parse existing comment
                        let comment = {};
                        try { comment = JSON.parse(secret.comment || '{}'); } catch (e) { comment = {}; }
                        
                        // Calculate new due date with time (use the same newDueDate from above)
                        const newDueDateTime = new Date(newDueDate);
                        newDueDateTime.setHours(newDueDateTime.getHours(), newDueDateTime.getMinutes(), 0, 0);
                        const newDueDateTimeStr = newDueDateTime.toISOString().replace('T', ' ').substring(0, 16);
                        
                        // Find active profile from billing plan
                        let activeProfile = secret.profile;
                        try {
                            const billingPlan = await db.get(
                                'SELECT pppoeProfile, name FROM billing_plans WHERE pppoeProfile = ? OR name = ? LIMIT 1',
                                [secret.profile, payment.plan_name]
                            );
                            if (billingPlan) {
                                activeProfile = billingPlan.pppoeProfile || activeProfile;
                            }
                        } catch (planErr) {
                            console.error('[Manual Payments] Billing plan lookup error:', planErr.message);
                        }
                        
                        // Update PPP secret comment with new due date
                        const updatedComment = JSON.stringify({
                            ...comment,
                            planName: payment.plan_name || comment.planName,
                            planPrice: payment.plan_price || comment.planPrice,
                            dueDate: dueDateStr,
                            dueDateTime: newDueDateTimeStr,
                            planType: 'Postpaid',
                            accountNumber: payment.customer_account_number,
                            customerName: payment.customer_full_name || comment.customerName,
                            fullName: payment.customer_full_name || comment.fullName
                        });
                        
                        await axios.patch(`${apiBase}/rest/ppp/secret/${secret['.id']}`, {
                            profile: activeProfile,
                            comment: updatedComment
                        }, {
                            headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
                            timeout: 10000
                        });
                        
                        console.log('[Manual Payments] ✓ PPP secret updated with new due date:', newDueDateTimeStr);
                        console.log('[Manual Payments] ✓ Profile set to:', activeProfile);
                        
                        // Kick active session for reconnection
                        try {
                            const activeRes = await axios.get(`${apiBase}/rest/ppp/active`, {
                                params: { name: payment.customer_username },
                                headers: { Authorization: authHeader },
                                timeout: 5000
                            });
                            
                            const sessions = Array.isArray(activeRes.data) ? activeRes.data : [];
                            for (const session of sessions) {
                                if (session['.id'] && session.name === payment.customer_username) {
                                    await axios.post(`${apiBase}/rest/ppp/active/remove`, { '.id': session['.id'] }, {
                                        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
                                        timeout: 5000
                                    });
                                    console.log('[Manual Payments] ✓ Kicked active session');
                                }
                            }
                        } catch (kickErr) {
                            console.error('[Manual Payments] Session kick error:', kickErr.message);
                        }
                        
                        // Create scheduler to auto-expire on due date
                        try {
                            const schedulerName = `ppp-auto-kick-${payment.customer_username}`;
                            
                            // Remove existing scheduler
                            try {
                                const existingRes = await axios.get(`${apiBase}/rest/system/scheduler`, {
                                    headers: { Authorization: authHeader },
                                    timeout: 10000
                                });
                                const schedulers = Array.isArray(existingRes.data) ? existingRes.data : [];
                                for (const sched of schedulers) {
                                    if (sched.name === schedulerName && sched['.id']) {
                                        await axios.post(`${apiBase}/rest/system/scheduler/remove`, { '.id': sched['.id'] }, {
                                            headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
                                            timeout: 10000
                                        });
                                        console.log('[Manual Payments] ✓ Removed old scheduler');
                                    }
                                }
                            } catch (delErr) {
                                console.error('[Manual Payments] Old scheduler cleanup error:', delErr.message);
                            }
                            
                            // Create new scheduler
                            const startDate = `${newDueDateTime.getFullYear()}-${String(newDueDateTime.getMonth() + 1).padStart(2, '0')}-${String(newDueDateTime.getDate()).padStart(2, '0')}`;
                            const startTime = `${String(newDueDateTime.getHours()).padStart(2, '0')}:${String(newDueDateTime.getMinutes()).padStart(2, '0')}:00`;
                            
                            const onEvent = `/log info message="PPPoE auto-kick: ${payment.customer_username}";\n:do { /ppp active remove [find name="${payment.customer_username}"] } on-error={};\n/ppp secret set [find name="${payment.customer_username}"] profile="Non-Payment"`;
                            
                            await axios.post(`${apiBase}/rest/system/scheduler/add`, {
                                name: schedulerName,
                                interval: '0s',
                                'start-date': startDate,
                                'start-time': startTime,
                                'on-event': onEvent,
                                comment: `Auto-expire ${payment.customer_username} to Non-Payment on ${dueDateStr}`
                            }, {
                                headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
                                timeout: 10000
                            });
                            
                            console.log('[Manual Payments] ✓ Scheduler created: Non-Payment on', dueDateStr);
                        } catch (schedErr) {
                            console.error('[Manual Payments] Scheduler creation error:', schedErr.message);
                        }
                    }
                }
            } catch (mikrotikErr) {
                console.error('[Manual Payments] MikroTik update error:', mikrotikErr.message);
                // Don't fail the payment if MikroTik update fails
            }
            
            console.log(`[Manual Payments] Payment ${paymentId} approved for ${payment.customer_account_number}`);
            
            // Send Facebook notification to customer
            try {
                if (payment.customer_facebook_psid) {
                    const fbSettings = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
                    const fbConfig = JSON.parse(fbSettings?.facebookSettings || '{}');
                    
                    if (fbConfig.enabled && fbConfig.pageAccessToken) {
                        const message = `✅ Payment Approved!\n━━━━━━━━━━━━━━━━━━\n\n🎫 Request #: ${paymentId.split('_')[2].toUpperCase()}\n💰 Amount: ₱${payment.plan_price.toFixed(2)}\n\n✅ Your payment has been verified!\n\n📊 Account Status: ACTIVE\n📅 New Due Date: ${dueDateStr}\n\n━━━━━━━━━━━━━━━━━━\n\n💡 Thank you for your payment!\n\n📞 Need help? Contact our support.`;
                        
                        await sendFacebookMessage(payment.customer_facebook_psid, message, fbConfig.pageAccessToken);
                        console.log(`[Manual Payments] Facebook notification sent to ${payment.customer_account_number}`);
                    }
                }
            } catch (fbErr) {
                console.error('[Manual Payments] Failed to send Facebook notification:', fbErr.message);
            }
            
            res.json({ message: 'Payment approved and account activated' });
        } catch (e) {
            console.error('[Manual Payments] Error approving payment:', e.message);
            res.status(500).json({ message: e.message });
        }
    });

    app.post('/api/public/manual-payments/:id/reject', async (req, res) => {
        try {
            const { admin_notes } = req.body;
            const paymentId = req.params.id;
            
            const payment = await db.get('SELECT * FROM manual_payment_requests WHERE id = ?', [paymentId]);
            
            if (!payment) {
                return res.status(404).json({ message: 'Payment request not found' });
            }
            
            if (payment.status !== 'pending') {
                return res.status(400).json({ message: 'Payment already processed' });
            }
            
            const now = new Date().toISOString();
            
            await db.run(
                'UPDATE manual_payment_requests SET status = ?, admin_notes = ?, rejected_at = ?, updated_at = ? WHERE id = ?',
                ['rejected', admin_notes || '', now, now, paymentId]
            );
            
            console.log(`[Manual Payments] Payment ${paymentId} rejected for ${payment.customer_account_number}`);
            
            // Send Facebook notification to customer
            try {
                if (payment.customer_facebook_psid) {
                    const fbSettings = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
                    const fbConfig = JSON.parse(fbSettings?.facebookSettings || '{}');
                    
                    if (fbConfig.enabled && fbConfig.pageAccessToken) {
                        const message = `❌ Payment Request Rejected\n━━━━━━━━━━━━━━━━━━\n\n🎫 Request #: ${paymentId.split('_')[2].toUpperCase()}\n\n❌ Your payment could not be verified.\n\nReason: ${admin_notes || 'Payment not found in our GCash account'}\n\n━━━━━━━━━━━━━━━━━━\n\n📋 What to do:\n• Verify your GCash transaction\n• Ensure correct amount was sent\n• Contact support with your GCash receipt\n\n📞 Need help? Contact our support.`;
                        
                        await sendFacebookMessage(payment.customer_facebook_psid, message, fbConfig.pageAccessToken);
                        console.log(`[Manual Payments] Rejection notification sent to ${payment.customer_account_number}`);
                    }
                }
            } catch (fbErr) {
                console.error('[Manual Payments] Failed to send rejection notification:', fbErr.message);
            }
            
            res.json({ message: 'Payment rejected' });
        } catch (e) {
            console.error('[Manual Payments] Error rejecting payment:', e.message);
            res.status(500).json({ message: e.message });
        }
    });

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

    // Public PayMongo config — exposes only safe fields needed by Client Portal UI
    app.get('/api/public/paymongo-config', async (req, res) => {
        try {
            const s = await db.get('SELECT paymongoSettings FROM settings WHERE id = 1');
            let p = {};
            try { p = JSON.parse(s?.paymongoSettings || '{}'); } catch (_) {}
            res.json({
                enabled: !!p.enabled,
                passFeesToCustomer: !!p.passFeesToCustomer,
            });
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });
    
    // ========================================
    // Customer Store APIs
    // ========================================
    
    // GET: Get all available store plans
    app.get('/api/public/store/plans', async (req, res) => {
        try {
            const { routerId, type = 'all' } = req.query;
            
            let plans = [];
            
            // Get PPPoE plans
            if (type === 'all' || type === 'pppoe') {
                const pppoePlans = routerId
                    ? await db.all('SELECT * FROM billing_plans WHERE routerId = ? AND store_enabled = 1 ORDER BY price ASC', [routerId])
                    : await db.all('SELECT * FROM billing_plans WHERE store_enabled = 1 ORDER BY price ASC');
                plans = plans.concat(pppoePlans.map(p => ({ ...p, planType: 'pppoe' })));
            }
            
            // Get DHCP plans
            if (type === 'all' || type === 'dhcp') {
                const dhcpPlans = routerId
                    ? await db.all('SELECT * FROM dhcp_billing_plans WHERE routerId = ? AND store_enabled = 1 ORDER BY price ASC', [routerId])
                    : await db.all('SELECT * FROM dhcp_billing_plans WHERE store_enabled = 1 ORDER BY price ASC');
                plans = plans.concat(dhcpPlans.map(p => ({ ...p, planType: 'dhcp' })));
            }
            
            console.log(`[Store] Found ${plans.length} plans (type: ${type}, routerId: ${routerId || 'all'})`);
            res.json(plans);
        } catch (e) {
            console.error('[Store] Error fetching plans:', e.message);
            res.status(500).json({ message: e.message });
        }
    });
    
    // POST: Create store purchase (PayMongo checkout or manual payment)
    app.post('/api/public/store/purchase', async (req, res) => {
        try {
            const { planId, planType, paymentMethod, customerUsername, routerId, gcashReference, gcashScreenshot } = req.body;
            
            if (!planId || !planType || !paymentMethod || !customerUsername || !routerId) {
                return res.status(400).json({ message: 'Missing required fields' });
            }
            
            console.log(`[Store] Purchase request: planId=${planId}, planType=${planType}, paymentMethod=${paymentMethod}, customer=${customerUsername}`);
            
            // Get plan details
            let plan;
            if (planType === 'pppoe') {
                plan = await db.get('SELECT * FROM billing_plans WHERE id = ?', [planId]);
            } else if (planType === 'dhcp') {
                plan = await db.get('SELECT * FROM dhcp_billing_plans WHERE id = ?', [planId]);
            }
            
            if (!plan) {
                return res.status(404).json({ message: 'Plan not found' });
            }
            
            // Get customer details
            // First, get client_user to find the linked customer
            const clientUser = await db.get('SELECT * FROM client_users WHERE username = ? AND router_id = ?', [customerUsername, routerId]);
            
            if (!clientUser) {
                console.error(`[Store] Client user not found: username=${customerUsername}, routerId=${routerId}`);
                return res.status(404).json({ message: 'Customer account not found. Please contact support.' });
            }
            
            // Get the actual customer record using the client user's pppoe_username or account_number
            let customer = null;
            if (clientUser.pppoe_username) {
                customer = await db.get('SELECT * FROM customers WHERE username = ? AND routerId = ?', [clientUser.pppoe_username, routerId]);
            }
            
            // Fallback: try account_number
            if (!customer && clientUser.account_number) {
                customer = await db.get('SELECT * FROM customers WHERE accountNumber = ? AND routerId = ?', [clientUser.account_number, routerId]);
            }
            
            // Last resort: use username directly
            if (!customer) {
                customer = await db.get('SELECT * FROM customers WHERE username = ? AND routerId = ?', [customerUsername, routerId]);
            }
            
            if (!customer) {
                console.error(`[Store] Customer not found for client_user: ${customerUsername}`);
                return res.status(404).json({ message: 'Customer profile not found. Please contact support to link your account.' });
            }
            
            // Handle PayMongo payment
            if (paymentMethod === 'paymongo') {
                const pmSettings = await db.get('SELECT paymongoSettings FROM settings WHERE id = 1');
                const pmConfig = JSON.parse(pmSettings?.paymongoSettings || '{}');
                
                if (!pmConfig.enabled || !pmConfig.secretKey) {
                    return res.status(400).json({ message: 'PayMongo not configured' });
                }
                
                const axios = require('axios');
                
                // Calculate amount in centavos
                const amount = Math.round(plan.price * 100);
                
                // Create checkout session
                const checkoutData = {
                    data: {
                        attributes: {
                            line_items: [{
                                currency: 'PHP',
                                amount: amount,
                                description: `${plan.name} - ${customer.fullName || customer.accountNumber}`,
                                quantity: 1
                            }],
                            payment_method_types: ['gcash', 'paymaya', 'card'],
                            send_email_receipt: false,
                            show_description: false,
                            success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/store/success`,
                            cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/store/cancel`,
                            metadata: {
                                customerUsername: customerUsername,
                                planId: planId,
                                planType: planType,
                                routerId: routerId,
                                planName: plan.name,
                                planPrice: plan.price,
                                customerAccountNumber: customer.accountNumber,
                                customerFullName: customer.fullName
                            }
                        }
                    }
                };
                
                const response = await axios.post(
                    'https://api.paymongo.com/v1/checkout_sessions',
                    checkoutData,
                    {
                        auth: { username: pmConfig.secretKey, password: '' },
                        headers: { 'Content-Type': 'application/json' }
                    }
                );
                
                console.log(`[Store] PayMongo checkout created: ${response.data.data.id}`);
                
                res.json({
                    success: true,
                    checkoutUrl: response.data.data.attributes.checkout_url,
                    checkoutId: response.data.data.id
                });
                
            } else if (paymentMethod === 'manual') {
                // Create manual payment record in the same table as Facebook bot
                const paymentId = `manual_pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const now = new Date().toISOString();
                
                await db.run(
                    `INSERT INTO manual_payment_requests (
                        id, customer_account_number, customer_username, customer_full_name,
                        customer_router_id, plan_name, plan_price, gcash_reference_number,
                        status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
                    [
                        paymentId,
                        customer.accountNumber,
                        customer.username,
                        customer.fullName,
                        routerId,
                        plan.name,
                        plan.price,
                        gcashReference || '',
                        now,
                        now
                    ]
                );
                
                console.log(`[Store] Manual payment created: ${paymentId}`);
                
                res.json({
                    success: true,
                    paymentId: paymentId,
                    message: 'Manual payment submitted for approval',
                    instructions: 'Please send payment to our GCash number and wait for admin approval'
                });
                
            } else {
                res.status(400).json({ message: 'Invalid payment method' });
            }
            
        } catch (e) {
            console.error('[Store] Purchase error:', e.message);
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
            
            // Get router config for authentication
            const routerConfig = await db.get('SELECT * FROM routers WHERE id = ?', [routerId]);
            if (!routerConfig) {
                return res.status(404).json({ message: 'Router not found' });
            }
            
            const routerIp = routerConfig.host || routerConfig.ip;
            const routerPort = routerConfig.port || 3002;
            const routerUser = routerConfig.username || 'admin';
            const routerPass = routerConfig.password || '';
            const apiBase = `http://${routerIp}:${routerPort}`;
            const authHeader = 'Basic ' + Buffer.from(`${routerUser}:${routerPass}`).toString('base64');
            
            const encUser = encodeURIComponent(String(username));
            
            // Fetch PPP secret from MikroTik REST API
            const secretResp = await axios.get(`${apiBase}/rest/ppp/secret`, {
                params: { name: username },
                headers: { Authorization: authHeader },
                timeout: 10000
            });
            const secrets = Array.isArray(secretResp.data) ? secretResp.data : [];
            const secret = secrets.find(s => s.name === username) || secrets[0] || null;
            let active = false;
            try {
                const activeResp = await axios.get(`${apiBase}/rest/ppp/active`, {
                    params: { name: username },
                    headers: { Authorization: authHeader },
                    timeout: 5000
                });
                const allActive = Array.isArray(activeResp.data) ? activeResp.data : [];
                active = !!allActive.find(a => a.name === username);
            } catch (_) {}
            let profile = secret?.profile || '';
            let due = '';
            let comment = secret?.comment || '';
            let planName = '';
            try {
                const c = JSON.parse(comment || '{}');
                // Do NOT overwrite profile from comment — keep the live MikroTik profile
                due = c.dueDateTime || c.dueDate || '';
                planName = c.planName || c.plan || '';
            } catch (_) {}
            // Look up billing plan: current MikroTik profile first, then fall back to comment planName
            let planRow = null;
            if (profile) {
                planRow = await db.get('SELECT name, price, currency FROM billing_plans WHERE pppoeProfile = ? AND routerId = ?', [profile, routerId]);
            }
            if (!planRow && planName) {
                planRow = await db.get('SELECT name, price, currency FROM billing_plans WHERE name = ? AND routerId = ?', [planName, routerId]);
            }
            if (!planRow && profile) {
                planRow = await db.get('SELECT name, price, currency FROM billing_plans WHERE name = ? AND routerId = ?', [profile, routerId]);
            }
            res.json({
                profile,
                active,
                comment: due || comment || '',
                planName: planRow?.name || planName || profile,
                planPrice: planRow?.price || null,
                currency: planRow?.currency || 'PHP'
            });
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

    // New endpoint for generating application forms from PPPoE/DHCP user data
    app.post('/api/public/generate-application', express.json(), async (req, res) => {
        try {
            const { userData, customerData, planData, companySettings, source } = req.body || {};
            
            if (!userData || !userData.name || !String(userData.name).trim()) {
                return res.status(400).json({ message: 'User name is required.' });
            }

            const id = `app_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
            const createdAt = new Date().toISOString();
            const pdfFile = `${id}.pdf`;
            const pdfPath = path.join(APPLICATIONS_UPLOADS_DIR, pdfFile);

            const doc = await PDFDocument.create();
            const font = await doc.embedFont(StandardFonts.Helvetica);
            const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
            const page = doc.addPage([595.28, 841.89]);
            const drawText = (text, x, y, size = 12, isBold = false) => {
                page.drawText(String(text || ''), { x, y, size, font: isBold ? boldFont : font, color: rgb(0, 0, 0) });
            };

            // Header with company info
            let y = 800;
            if (companySettings?.companyName) {
                drawText(companySettings.companyName, 50, y, 18, true);
                y -= 25;
            }
            if (companySettings?.address) {
                drawText(companySettings.address, 50, y, 10);
                y -= 15;
            }
            if (companySettings?.contactNumber || companySettings?.email) {
                const contactInfo = `${companySettings.contactNumber || ''} ${companySettings.contactNumber && companySettings.email ? '|' : ''} ${companySettings.email || ''}`.trim();
                drawText(contactInfo, 50, y, 10);
                y -= 25;
            }

            // Application title
            drawText('INTERNET SERVICE APPLICATION FORM', 50, y, 16, true);
            y -= 30;

            // Application details
            drawText(`Application ID: ${id}`, 50, y, 11, true);
            drawText(`Date: ${new Date(createdAt).toLocaleString()}`, 300, y, 11);
            y -= 25;

            // User information
            drawText('APPLICANT INFORMATION', 50, y, 12, true);
            y -= 20;
            drawText(`Full Name: ${customerData?.fullName || userData.name}`, 50, y);
            y -= 18;
            drawText(`Account Number: ${customerData?.accountNumber || 'N/A'}`, 50, y);
            y -= 18;
            drawText(`Contact Number: ${customerData?.contactNumber || userData.phone || 'N/A'}`, 50, y);
            y -= 18;
            drawText(`Email Address: ${customerData?.email || userData.email || 'N/A'}`, 50, y);
            y -= 18;
            drawText(`Address: ${customerData?.address || 'N/A'}`, 50, y);
            y -= 18;
            if (customerData?.gps) {
                drawText(`GPS Location: ${customerData.gps}`, 50, y);
                y -= 18;
            }

            // Service details
            y -= 10;
            drawText('SERVICE DETAILS', 50, y, 12, true);
            y -= 20;
            drawText(`Service Type: ${source === 'pppoe' ? 'PPPoE' : 'DHCP'}`, 50, y);
            y -= 18;
            drawText(`Plan: ${planData?.name || 'N/A'}`, 50, y);
            y -= 18;
            if (planData?.price) {
                drawText(`Monthly Rate: ${planData.currency || 'PHP'} ${planData.price}`, 50, y);
                y -= 18;
            }
            if (planData?.speedLimit) {
                drawText(`Speed Limit: ${planData.speedLimit}`, 50, y);
                y -= 18;
            }
            if (planData?.planType) {
                drawText(`Plan Type: ${planData.planType}`, 50, y);
                y -= 18;
            }

            // Terms and conditions
            y -= 20;
            drawText('TERMS AND CONDITIONS', 50, y, 12, true);
            y -= 20;
            const terms = [
                '1. Payment is due on the specified due date.',
                '2. Service interruption may occur for non-payment.',
                '3. Customer agrees to abide by the acceptable use policy.',
                '4. Installation fees may apply.',
                '5. 24-hour notice required for service cancellation.'
            ];
            for (const term of terms) {
                drawText(term, 50, y, 9);
                y -= 14;
            }

            // Signature section
            y -= 30;
            drawText('_________________________', 50, y);
            drawText('Applicant Signature', 50, y - 15, 10);
            drawText('Date', 50, y - 30, 10);

            drawText('_________________________', 300, y);
            drawText('Company Representative', 300, y - 15, 10);
            drawText('Date', 300, y - 30, 10);

            const pdfBytes = await doc.save();
            await fs.promises.writeFile(pdfPath, pdfBytes);

            await db.run(
                `INSERT INTO applications (id, name, email, phone, message, planName, pdfPath, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, customerData?.fullName || userData.name, customerData?.email || userData.email || '', customerData?.contactNumber || userData.phone || '', `Application for ${planData?.name || 'internet service'}`, planData?.name || '', `/uploads/applications/${pdfFile}`, createdAt]
            );

            res.status(201).json({ message: 'Application form generated successfully.', id, pdfUrl: `/uploads/applications/${pdfFile}` });
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

    // --- Non-Payment PPPoE Redirect: Reusable IP Lookup ---
    async function lookupPppoeByIp(clientIp) {
        console.log(`[Non-Payment Lookup] Looking up PPPoE connection for IP: ${clientIp}`);
        const routers = await db.all('SELECT id, name FROM routers');
        if (!routers || routers.length === 0) {
            console.log('[Non-Payment Lookup] No routers found in database');
            return { success: false, error: 'no_routers' };
        }
        for (const router of routers) {
            try {
                const activeResp = await axios.get(
                    `http://127.0.0.1:3002/${router.id}/ppp/active/print`,
                    { timeout: 10000 }
                );
                const allActive = Array.isArray(activeResp.data) ? activeResp.data : [];
                const match = allActive.find(a => a.address === clientIp);
                if (!match) continue;
                console.log(`[Non-Payment Lookup] Found active connection: ${match.name} on router ${router.name} (${router.id})`);
                const username = match.name;
                // Get the PPPoE secret for plan/due info
                const secretResp = await axios.get(
                    `http://127.0.0.1:3002/${router.id}/ppp/secret?name=${encodeURIComponent(username)}`,
                    { timeout: 10000 }
                );
                const secrets = Array.isArray(secretResp.data) ? secretResp.data : [];
                const secret = secrets[0];
                if (!secret) {
                    console.log(`[Non-Payment Lookup] No secret found for user ${username}`);
                    return { success: false, error: 'secret_not_found' };
                }
                // Parse comment JSON for billing info
                let planName = secret.profile || '';
                let dueDate = '';
                let dueDateTime = '';
                let planType = '';
                try {
                    const c = JSON.parse(secret.comment || '{}');
                    planName = c.planName || c.plan || planName;
                    dueDate = c.dueDate || '';
                    dueDateTime = c.dueDateTime || '';
                    planType = c.planType || '';
                } catch (_) {}
                // Look up customer account number
                let accountNumber = '';
                try {
                    const cust = await db.get('SELECT accountNumber FROM customers WHERE routerId = ? AND username = ?', [router.id, username]);
                    accountNumber = cust?.accountNumber || '';
                } catch (_) {}
                // Look up billing plan price
                let amount = '';
                try {
                    let planRow = null;
                    if (planName) planRow = await db.get('SELECT price FROM billing_plans WHERE name = ? AND routerId = ?', [planName, router.id]);
                    if (!planRow && secret.profile) planRow = await db.get('SELECT price FROM billing_plans WHERE pppoeProfile = ? AND routerId = ?', [secret.profile, router.id]);
                    amount = planRow?.price || '';
                } catch (_) {}
                console.log(`[Non-Payment Lookup] Success: user=${username}, plan=${planName}, due=${dueDate}, amount=${amount}`);
                return {
                    success: true,
                    username,
                    planName,
                    dueDate,
                    dueDateTime,
                    planType,
                    profile: secret.profile || '',
                    routerId: router.id,
                    routerName: router.name,
                    accountNumber,
                    amount
                };
            } catch (err) {
                if (err.code === 'ECONNABORTED') {
                    console.log(`[Non-Payment Lookup] Timeout querying router ${router.name} (${router.id})`);
                } else {
                    console.error(`[Non-Payment Lookup] Error querying router ${router.name} (${router.id}):`, err.message);
                }
                continue; // try next router
            }
        }
        console.log(`[Non-Payment Lookup] No active PPPoE connection found for IP: ${clientIp}`);
        return { success: false, error: 'not_found' };
    }

    // --- Non-Payment PPPoE Redirect: API Endpoint ---
    app.get('/api/public/ppp/lookup-by-ip', async (req, res) => {
        try {
            // Determine client IP: prefer query param for testing, then x-forwarded-for, then req.ip
            let clientIp = req.query.ip || '';
            if (!clientIp) {
                clientIp = String(req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress || '').trim();
                if (clientIp.includes(',')) clientIp = clientIp.split(',')[0].trim();
                clientIp = clientIp.replace('::ffff:', '').replace(/^::1$/, '127.0.0.1');
            }
            if (!clientIp) {
                return res.status(400).json({ success: false, error: 'no_ip' });
            }
            const result = await lookupPppoeByIp(clientIp);
            res.json(result);
        } catch (e) {
            console.error('[Non-Payment Lookup] Unexpected error:', e.message);
            res.status(500).json({ success: false, error: 'server_error' });
        }
    });

    // --- Non-Payment PPPoE Redirect: HTML Page ---
    app.get('/non-payment', async (req, res) => {
        try {
            // Determine client IP
            let clientIp = String(req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress || '').trim();
            if (clientIp.includes(',')) clientIp = clientIp.split(',')[0].trim();
            clientIp = clientIp.replace('::ffff:', '').replace(/^::1$/, '127.0.0.1');

            // Run lookup and fetch company settings in parallel
            const [lookupResult, settingsRow] = await Promise.all([
                lookupPppoeByIp(clientIp),
                db.get('SELECT companyName, contactNumber, email FROM settings WHERE id = 1').catch(() => null)
            ]);

            const companyName = settingsRow?.companyName || '';
            const companyPhone = settingsRow?.contactNumber || '';
            const companyEmail = settingsRow?.email || '';

            // Determine domain for Pay Now link
            const host = req.get('host') || '';
            const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
            const domain = host ? `${proto}://${host}` : 'http://localhost:3001';
            const payNowUrl = `${domain}/client_portal`;

            let html;
            if (lookupResult.success) {
                const { username, planName, dueDate, dueDateTime, amount, accountNumber } = lookupResult;
                // Format due date nicely
                let dueDateDisplay = dueDateTime || dueDate || 'N/A';
                if (dueDateDisplay !== 'N/A') {
                    try {
                        const d = new Date(dueDateDisplay);
                        if (!isNaN(d.getTime())) {
                            dueDateDisplay = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                        }
                    } catch (_) {}
                }
                // Format amount with peso sign
                const amountDisplay = amount ? `\u20B1${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'N/A';

                html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Service Suspended</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; background: #f5f5f5; color: #333; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; }
.container { max-width: 500px; width: 100%; }
.card { background: #fff; border-radius: 12px; box-shadow: 0 2px 16px rgba(0,0,0,0.10); overflow: hidden; }
.card-header { background: linear-gradient(135deg, #ef4444, #f97316); color: #fff; padding: 24px 20px; text-align: center; }
.card-header h1 { font-size: 20px; font-weight: 700; margin-bottom: 6px; }
.card-header p { font-size: 14px; opacity: 0.92; }
.card-body { padding: 24px 20px; }
.info-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #f0f0f0; }
.info-row:last-child { border-bottom: none; }
.info-label { font-size: 13px; color: #888; font-weight: 500; }
.info-value { font-size: 14px; color: #222; font-weight: 600; text-align: right; }
.amount-row .info-value { color: #ef4444; font-size: 18px; }
.pay-btn { display: block; width: 100%; padding: 16px; margin-top: 20px; background: #22c55e; color: #fff; border: none; border-radius: 8px; font-size: 18px; font-weight: 700; text-align: center; text-decoration: none; cursor: pointer; transition: background 0.2s; }
.pay-btn:hover { background: #16a34a; }
.card-footer { padding: 16px 20px; background: #fafafa; text-align: center; border-top: 1px solid #f0f0f0; }
.card-footer p { font-size: 12px; color: #999; line-height: 1.6; }
.card-footer .contact { font-weight: 600; color: #666; }
</style>
</head>
<body>
<div class="container">
  <div class="card">
    <div class="card-header">
      <h1>&#9888; Internet Service Suspended</h1>
      <p>Your internet service has been suspended due to non-payment.</p>
    </div>
    <div class="card-body">
      <div class="info-row">
        <span class="info-label">Account</span>
        <span class="info-value">${accountNumber || username}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Username</span>
        <span class="info-value">${username}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Plan</span>
        <span class="info-value">${planName || 'N/A'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Due Date</span>
        <span class="info-value">${dueDateDisplay}</span>
      </div>
      <div class="info-row amount-row">
        <span class="info-label">Amount Due</span>
        <span class="info-value">${amountDisplay}</span>
      </div>
      <a href="${payNowUrl}" class="pay-btn">Pay Now</a>
    </div>
    <div class="card-footer">
      <p>${companyName ? `Contact <span class="contact">${companyName}</span> for assistance.` : 'Please contact your service provider for assistance.'}</p>
      ${companyPhone ? `<p class="contact">${companyPhone}</p>` : ''}
      ${companyEmail ? `<p class="contact">${companyEmail}</p>` : ''}
    </div>
  </div>
</div>
</body>
</html>`;
            } else {
                // Lookup failed - generic message
                html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Service Suspended</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; background: #f5f5f5; color: #333; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; }
.container { max-width: 500px; width: 100%; }
.card { background: #fff; border-radius: 12px; box-shadow: 0 2px 16px rgba(0,0,0,0.10); overflow: hidden; }
.card-header { background: linear-gradient(135deg, #ef4444, #f97316); color: #fff; padding: 24px 20px; text-align: center; }
.card-header h1 { font-size: 20px; font-weight: 700; margin-bottom: 6px; }
.card-header p { font-size: 14px; opacity: 0.92; }
.card-body { padding: 24px 20px; text-align: center; }
.card-body p { font-size: 14px; color: #555; line-height: 1.7; margin-bottom: 12px; }
.card-footer { padding: 16px 20px; background: #fafafa; text-align: center; border-top: 1px solid #f0f0f0; }
.card-footer p { font-size: 12px; color: #999; line-height: 1.6; }
.card-footer .contact { font-weight: 600; color: #666; }
</style>
</head>
<body>
<div class="container">
  <div class="card">
    <div class="card-header">
      <h1>&#9888; Internet Service Suspended</h1>
      <p>Your internet service has been suspended.</p>
    </div>
    <div class="card-body">
      <p>Your internet access has been restricted. This is typically due to a billing issue or account concern.</p>
      <p>Please contact your service provider to resolve this and restore your service.</p>
    </div>
    <div class="card-footer">
      <p>${companyName ? `Contact <span class="contact">${companyName}</span> for assistance.` : 'Please contact your service provider for assistance.'}</p>
      ${companyPhone ? `<p class="contact">${companyPhone}</p>` : ''}
      ${companyEmail ? `<p class="contact">${companyEmail}</p>` : ''}
    </div>
  </div>
</div>
</body>
</html>`;
            }

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } catch (e) {
            console.error('[Non-Payment Page] Error:', e.message);
            res.status(500).send('<html><body><h2>Service Temporarily Unavailable</h2><p>Please try again later.</p></body></html>');
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

    // --- PayMongo API ---
    const paymongoRouter = express.Router();
    // Note: create-checkout is public so client portal users can initiate payments
    // without admin JWT tokens.

    // A. Checkout Initiation Route
    paymongoRouter.post('/create-checkout', async (req, res) => {
        try {
            const settings = await db.get('SELECT paymongoSettings FROM settings WHERE id = 1');
            if (!settings || !settings.paymongoSettings) {
                return res.status(400).json({ message: 'PayMongo settings not configured in database.' });
            }

            const pSettings = JSON.parse(settings.paymongoSettings);
            if (!pSettings.secretKey) {
                return res.status(400).json({ message: 'PayMongo Secret Key is missing.' });
            }

            const { amount, description, pppoeUsername, planName, successUrl, cancelUrl, paymentMethod } = req.body;

            if (!amount || !description || !pppoeUsername) {
                return res.status(400).json({ message: 'amount, description, and pppoeUsername are required.' });
            }

            // Look up the router_id for this PPPoE user so the webhook can find it
            let checkoutRouterId = null;
            try {
                const cu = await db.get('SELECT router_id FROM client_users WHERE pppoe_username = ?', [pppoeUsername]);
                if (cu) checkoutRouterId = cu.router_id;
                else {
                    const cust = await db.get('SELECT routerId FROM customers WHERE username = ?', [pppoeUsername]);
                    if (cust) checkoutRouterId = cust.routerId;
                }
            } catch (_) {}

            // Convenience fee recalculation
            // PayMongo fees:
            //   - E-Wallets (gcash, paymaya, grab_pay): 2.9%
            //   - QRPh: 2.0%
            //   - Card: 3.5% + 15 PHP
            const baseAmount = Number(amount);
            const passFees = !!pSettings.passFeesToCustomer;
            const method = (paymentMethod || 'gcash').toLowerCase();

            const computeTotal = (base, m) => {
                if (m === 'card') return (base + 15) / (1 - 0.035);
                if (m === 'qrph') return base / (1 - 0.020);
                // default e-wallet (gcash, paymaya, grab_pay)
                return base / (1 - 0.029);
            };

            const totalAmount = passFees ? Math.round(computeTotal(baseAmount, method) * 100) / 100 : baseAmount;
            const convenienceFee = Math.round((totalAmount - baseAmount) * 100) / 100;

            // Restrict checkout to the chosen method when passing fees so the calculated
            // total matches the actual fee charged by PayMongo.
            const methodMap = {
                gcash: ['gcash'],
                paymaya: ['paymaya'],
                grab_pay: ['grab_pay'],
                qrph: ['qrph'],
                card: ['card'],
            };
            const allowedMethods = passFees
                ? (methodMap[method] || ['gcash'])
                : ['gcash', 'card', 'paymaya', 'grab_pay'];

            // Build dynamic success_url back to the client's own portal with invoice details
            const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, '') || 'http://localhost';
            const invoiceNo = `INV-${Date.now()}`;
            const sp = new URLSearchParams({
                payment: 'success',
                user: pppoeUsername,
                amount: String(totalAmount),
                base: String(baseAmount),
                fee: String(convenienceFee),
                method: method,
                invoice: invoiceNo,
            });
            const dynamicSuccessUrl = `${origin}/client_portal?${sp.toString()}`;
            const dynamicCancelUrl = `${origin}/client_portal?payment=cancelled&user=${encodeURIComponent(pppoeUsername)}`;

            const payload = {
                data: {
                    attributes: {
                        line_items: [{
                            name: planName || description || 'Internet Subscription',
                            amount: Math.round(totalAmount * 100), // PayMongo uses centavos
                            quantity: 1,
                            currency: 'PHP'  // REQUIRED inside line_items!
                        }],
                        payment_method_types: allowedMethods,
                        description: `${description}|${pppoeUsername}`,
                        success_url: dynamicSuccessUrl,
                        cancel_url: dynamicCancelUrl,
                        metadata: {
                            pppoe_username: pppoeUsername,
                            plan_name: planName || '',
                            router_id: checkoutRouterId || '',
                            invoice_no: invoiceNo,
                            base_amount: String(baseAmount),
                            convenience_fee: String(convenienceFee),
                            total_amount: String(totalAmount),
                            payment_method: method,
                            pass_fees: passFees ? '1' : '0',
                        }
                    }
                }
            };

            const response = await axios.post('https://api.paymongo.com/v1/checkout_sessions', payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${Buffer.from(pSettings.secretKey + ':').toString('base64')}`
                },
                timeout: 30000
            });

            const checkoutData = response.data?.data;
            if (!checkoutData || !checkoutData.attributes?.checkout_url) {
                return res.status(500).json({ message: 'PayMongo did not return a checkout URL.' });
            }

            // Store session in DB for fallback verification (when webhook is blocked by Cloudflare)
            try {
                await db.run(
                    'INSERT OR IGNORE INTO paymongo_sessions (session_id, invoice_no, pppoe_username, router_id, plan_name, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [checkoutData.id, invoiceNo, pppoeUsername, checkoutRouterId || '', planName || '', totalAmount, 'pending', new Date().toISOString()]
                );
                console.log(`[PayMongo] Stored session ${checkoutData.id} for invoice ${invoiceNo} (user: ${pppoeUsername})`);
            } catch (dbErr) {
                console.warn('[PayMongo] Failed to store session in DB:', dbErr.message);
            }

            res.json({
                checkout_url: checkoutData.attributes.checkout_url,
                session_id: checkoutData.id,
                amount: amount,
                description: description
            });
        } catch (err) {
            console.error('PayMongo Checkout Error:', err.response?.data || err.message);
            res.status(500).json({
                message: err.response?.data?.errors?.[0]?.detail || err.message || 'Failed to create PayMongo checkout session.'
            });
        }
    });

    app.use('/api/payments', paymongoRouter);

    // C. PayMongo Webhook Auto-Registration
    async function ensurePayMongoWebhook() {
        const settings = await db.get('SELECT paymongoSettings FROM settings WHERE id = 1');
        if (!settings || !settings.paymongoSettings) {
            console.log('[PayMongo Webhook] PayMongo settings not configured, skipping webhook registration.');
            return { success: false, message: 'PayMongo settings not configured.' };
        }

        const pSettings = JSON.parse(settings.paymongoSettings);
        if (!pSettings.secretKey) {
            console.log('[PayMongo Webhook] PayMongo secret key not set, skipping webhook registration.');
            return { success: false, message: 'PayMongo secret key not set.' };
        }

        // Use the webhookUrl configured in System Settings
        const webhookUrl = pSettings.webhookUrl;
        if (!webhookUrl) {
            console.log('[PayMongo Webhook] No webhook URL configured. Please set it in System Settings.');
            return { success: false, message: 'No webhook URL configured. Please set it in System Settings.' };
        }
        console.log(`[PayMongo Webhook] Registering webhook URL: ${webhookUrl}`);

        const requiredEvents = ['checkout_session.payment.paid'];
        const authHeader = `Basic ${Buffer.from(pSettings.secretKey + ':').toString('base64')}`;

        try {
            // List existing webhooks
            const listResp = await axios.get('https://api.paymongo.com/v1/webhooks', {
                headers: { 'Authorization': authHeader },
                timeout: 15000
            });

            const webhooks = listResp.data?.data || [];
            console.log(`[PayMongo Webhook] Found ${webhooks.length} existing webhook(s).`);

            let correctWebhookId = null;
            let result = null;

            // Check for a webhook that matches our URL, events, and is enabled
            const matching = webhooks.find(wh => {
                const attrs = wh.attributes || {};
                const url = attrs.url || '';
                const events = attrs.events || [];
                const enabled = attrs.status === 'enabled';
                return url === webhookUrl
                    && requiredEvents.every(e => events.includes(e))
                    && requiredEvents.length === events.length
                    && enabled;
            });

            if (matching) {
                console.log(`[PayMongo Webhook] Correct webhook already registered (id=${matching.id}).`);
                // Ensure webhookSecret is stored
                if (matching.attributes?.secret && !pSettings.webhookSecret) {
                    pSettings.webhookSecret = matching.attributes.secret;
                    await db.run('UPDATE settings SET paymongoSettings = ? WHERE id = 1', [JSON.stringify(pSettings)]);
                    console.log('[PayMongo Webhook] Stored webhook secret from existing webhook.');
                }
                correctWebhookId = matching.id;
                result = { success: true, message: 'Webhook already correctly registered.', webhookId: matching.id, webhookUrl };
            }

            if (!correctWebhookId) {
                // Check for a matching URL but wrong events or disabled
                const urlMatch = webhooks.find(wh => (wh.attributes?.url || '') === webhookUrl);

                if (urlMatch) {
                    const attrs = urlMatch.attributes || {};
                    const eventsMatch = requiredEvents.every(e => (attrs.events || []).includes(e))
                        && requiredEvents.length === (attrs.events || []).length;

                    if (!eventsMatch) {
                        // Wrong events — disable old webhook and create new one
                        console.log(`[PayMongo Webhook] Webhook ${urlMatch.id} has wrong events, disabling and recreating.`);
                        try {
                            await axios.post(`https://api.paymongo.com/v1/webhooks/${urlMatch.id}/disable`, {}, {
                                headers: { 'Authorization': authHeader },
                                timeout: 10000
                            });
                        } catch (disableErr) {
                            console.warn('[PayMongo Webhook] Could not disable old webhook:', disableErr.response?.data || disableErr.message);
                        }
                    } else if (attrs.status === 'disabled') {
                        // Right events, just disabled — enable it
                        console.log(`[PayMongo Webhook] Webhook ${urlMatch.id} is disabled, enabling it.`);
                        const enableResp = await axios.post(`https://api.paymongo.com/v1/webhooks/${urlMatch.id}/enable`, {}, {
                            headers: { 'Authorization': authHeader },
                            timeout: 10000
                        });
                        const enabledWh = enableResp.data?.data;
                        if (enabledWh?.attributes?.secret) {
                            pSettings.webhookSecret = enabledWh.attributes.secret;
                            await db.run('UPDATE settings SET paymongoSettings = ? WHERE id = 1', [JSON.stringify(pSettings)]);
                            console.log('[PayMongo Webhook] Stored webhook secret from enabled webhook.');
                        }
                        console.log(`[PayMongo Webhook] Enabled webhook ${urlMatch.id}.`);
                        correctWebhookId = urlMatch.id;
                        result = { success: true, message: 'Existing webhook enabled.', webhookId: urlMatch.id, webhookUrl };
                    }
                }
            }

            if (!correctWebhookId) {
                // Create a new webhook
                console.log(`[PayMongo Webhook] Creating new webhook at ${webhookUrl}...`);
                const createResp = await axios.post('https://api.paymongo.com/v1/webhooks', {
                    data: {
                        attributes: {
                            url: webhookUrl,
                            events: requiredEvents
                        }
                    }
                }, {
                    headers: {
                        'Authorization': authHeader,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                });

                const newWebhook = createResp.data?.data;
                if (!newWebhook) {
                    console.error('[PayMongo Webhook] PayMongo did not return webhook data after creation.');
                    return { success: false, message: 'PayMongo did not return webhook data.' };
                }

                // Save the webhook secret to the database
                if (newWebhook.attributes?.secret) {
                    pSettings.webhookSecret = newWebhook.attributes.secret;
                    await db.run('UPDATE settings SET paymongoSettings = ? WHERE id = 1', [JSON.stringify(pSettings)]);
                    console.log('[PayMongo Webhook] Saved new webhook secret to database.');
                }

                console.log(`[PayMongo Webhook] Created webhook id=${newWebhook.id} at ${webhookUrl}`);
                correctWebhookId = newWebhook.id;
                result = { success: true, message: 'Webhook created and registered.', webhookId: newWebhook.id, webhookUrl };
            }

            // Disable stale webhooks with mismatched URLs
            if (correctWebhookId) {
                for (const wh of webhooks) {
                    if (wh.id !== correctWebhookId && (wh.attributes?.url || '') !== webhookUrl) {
                        // Skip if already disabled
                        if (wh.attributes?.status === 'disabled') {
                            console.log(`[PayMongo Webhook] Stale webhook already disabled: ${wh.id}`);
                            continue;
                        }
                        try {
                            await axios.post(`https://api.paymongo.com/v1/webhooks/${wh.id}/disable`, {}, {
                                headers: { 'Authorization': authHeader },
                                timeout: 10000
                            });
                            console.log(`[PayMongo Webhook] Disabled stale webhook: ${wh.id} -> ${wh.attributes?.url || ''}`);
                        } catch (disableErr) {
                            const errCode = disableErr.response?.data?.errors?.[0]?.code;
                            if (errCode === 'resource_disabled_state') {
                                console.log(`[PayMongo Webhook] Stale webhook ${wh.id} was already disabled (confirmed by API).`);
                            } else {
                                console.warn(`[PayMongo Webhook] Could not disable stale webhook ${wh.id}:`, disableErr.response?.data || disableErr.message);
                            }
                        }
                    }
                }
            }

            return result || { success: false, message: 'Webhook handling did not complete.' };

        } catch (err) {
            const errMsg = err.response?.data?.errors?.[0]?.detail || err.message;
            console.error('[PayMongo Webhook] Registration failed:', errMsg);
            return { success: false, message: `Webhook registration failed: ${errMsg}` };
        }
    }

    // D. PayMongo Webhook Status Endpoint
    app.get('/api/paymongo-webhook-status', protect, async (req, res) => {
        try {
            const settings = await db.get('SELECT paymongoSettings FROM settings WHERE id = 1');
            let pSettings = {};
            try { pSettings = JSON.parse(settings?.paymongoSettings || '{}'); } catch (_) {}

            if (!pSettings.secretKey) {
                return res.json({ configured: false, webhooks: [], message: 'PayMongo secret key not configured.' });
            }

            const authHeader = `Basic ${Buffer.from(pSettings.secretKey + ':').toString('base64')}`;
            const listResp = await axios.get('https://api.paymongo.com/v1/webhooks', {
                headers: { 'Authorization': authHeader },
                timeout: 15000
            });

            const webhooks = (listResp.data?.data || []).map(wh => ({
                id: wh.id,
                url: wh.attributes?.url || '',
                events: wh.attributes?.events || [],
                status: wh.attributes?.status || 'unknown',
                createdAt: wh.attributes?.created_at ? wh.attributes.created_at * 1000 : null
            }));

            // Use the webhookUrl configured in System Settings
            const expectedUrl = pSettings.webhookUrl || '';

            res.json({
                configured: true,
                webhooks,
                expectedUrl,
                webhookSecretStored: !!pSettings.webhookSecret,
                message: `Found ${webhooks.length} webhook(s).`
            });
        } catch (err) {
            const errMsg = err.response?.data?.errors?.[0]?.detail || err.message;
            console.error('[PayMongo Webhook Status] Error:', errMsg);
            res.status(500).json({ configured: false, webhooks: [], message: errMsg });
        }
    });

    // E. PayMongo Webhook Re-Register Endpoint
    app.post('/api/paymongo-webhook-reregister', protect, async (req, res) => {
        try {
            const result = await ensurePayMongoWebhook();
            res.json(result);
        } catch (err) {
            console.error('[PayMongo Webhook Re-register] Error:', err.message);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // F. PayMongo Webhook Disable Endpoint
    app.post('/api/paymongo-webhook-disable', protect, async (req, res) => {
        try {
            const { webhookId } = req.body;
            if (!webhookId) {
                return res.status(400).json({ success: false, message: 'webhookId is required.' });
            }

            const settings = await db.get('SELECT paymongoSettings FROM settings WHERE id = 1');
            let pSettings = {};
            try { pSettings = JSON.parse(settings?.paymongoSettings || '{}'); } catch (_) {}

            if (!pSettings.secretKey) {
                return res.status(400).json({ success: false, message: 'PayMongo secret key not configured.' });
            }

            const authHeader = `Basic ${Buffer.from(pSettings.secretKey + ':').toString('base64')}`;

            try {
                await axios.post(`https://api.paymongo.com/v1/webhooks/${webhookId}/disable`, {}, {
                    headers: { 'Authorization': authHeader },
                    timeout: 10000
                });
                console.log(`[PayMongo Webhook] Manually disabled webhook: ${webhookId}`);
            } catch (disableErr) {
                const errCode = disableErr.response?.data?.errors?.[0]?.code;
                if (errCode === 'resource_disabled_state') {
                    console.log(`[PayMongo Webhook] Webhook ${webhookId} was already disabled.`);
                } else {
                    throw disableErr;
                }
            }

            res.json({ success: true, message: 'Webhook disabled successfully.' });
        } catch (err) {
            const errMsg = err.response?.data?.errors?.[0]?.detail || err.message;
            console.error('[PayMongo Webhook Disable] Error:', errMsg);
            res.status(500).json({ success: false, message: errMsg });
        }
    });

    // G. PayMongo Webhook Ping Endpoint (public, no auth - for reachability testing)
    app.get('/api/paymongo-webhook-ping', (req, res) => {
        console.log('[PayMongo Webhook] PING received from:', req.ip);
        res.json({ status: 'ok', message: 'Webhook endpoint is reachable', timestamp: new Date().toISOString() });
    });

    // H. PayMongo Verify Payment (DEPRECATED)
    // Previously used as a frontend fallback when webhooks were blocked.
    // Nginx reverse proxy now delivers webhooks directly, so this endpoint
    // only returns a deprecation notice for backward compatibility.
    // DEPRECATED: This endpoint is no longer used for payment processing.
    // PayMongo webhooks now reach the backend directly via Nginx reverse proxy,
    // so all payment activation is handled by /api/paymongo-webhook.
    app.post('/api/paymongo-verify-payment', async (req, res) => {
        console.log('[PayMongo Verify] DEPRECATED endpoint called. Webhook flow is now the sole processing method.');
        return res.json({ deprecated: true, message: 'Use webhook flow' });
    });

    // B. Standalone Webhook Endpoint (NO auth middleware - must be public for PayMongo)
    app.post('/api/paymongo-webhook', async (req, res) => {
        console.log('[PayMongo Webhook] ===== INCOMING POST =====');
        console.log('[PayMongo Webhook] IP:', req.ip);
        console.log('[PayMongo Webhook] Content-Type:', req.headers['content-type']);
        console.log('[PayMongo Webhook] Has rawBody:', !!req.rawBody);

        // ALWAYS return 200 to PayMongo — never let this endpoint crash the process
        try {
            // === STAGE 1: Fetch webhook secret from database ===
            console.log('[PayMongo Webhook] STAGE 1: Fetching settings from database...');
            let paymongoSettings;
            try {
                const row = await db.get('SELECT paymongoSettings FROM settings WHERE id = 1');
                if (!row || !row.paymongoSettings) {
                    console.error('[PayMongo Webhook] STAGE 1 FAILED: No paymongoSettings row found');
                    return res.status(200).json({ received: true, error: 'no_settings' });
                }
                paymongoSettings = JSON.parse(row.paymongoSettings);
                console.log('[PayMongo Webhook] STAGE 1 OK: Settings loaded, webhookSecret present:', !!paymongoSettings.webhookSecret);
            } catch (dbErr) {
                console.error('[PayMongo Webhook] STAGE 1 EXCEPTION:', dbErr.message);
                return res.status(200).json({ received: true, error: 'db_error' });
            }

            const webhookSecret = paymongoSettings.webhookSecret;
            if (!webhookSecret) {
                console.error('[PayMongo Webhook] No webhookSecret in paymongoSettings');
                return res.status(200).json({ received: true, error: 'no_secret' });
            }

            // === STAGE 2: Verify signature ===
            console.log('[PayMongo Webhook] STAGE 2: Verifying signature...');
            try {
              console.log('[PayMongo Webhook] STAGE 2a: Reading signature header...');
              const signatureHeader = req.headers['x-paymongo-signature'];
              console.log('[PayMongo Webhook] STAGE 2b: Signature header value:', signatureHeader ? signatureHeader.substring(0, 50) + '...' : 'MISSING');

              if (!signatureHeader) {
                console.warn('[PayMongo Webhook] STAGE 2 WARNING: No x-paymongo-signature header - processing without verification (Cloudflare strips header)');
                // TODO: Fix Cloudflare Tunnel header forwarding, then re-enable signature verification
              } else {
                console.log('[PayMongo Webhook] STAGE 2c: Parsing signature parts...');
                const parts = {};
                signatureHeader.split(',').forEach(part => {
                  const idx = part.indexOf('=');
                  if (idx !== -1) {
                    parts[part.substring(0, idx)] = part.substring(idx + 1);
                  }
                });

                const timestamp = parts['t'];
                const testSig = parts['te'];
                const liveSig = parts['li'];
                console.log('[PayMongo Webhook] STAGE 2d: Parsed - timestamp:', timestamp, 'testSig:', !!testSig, 'liveSig:', !!liveSig);

                console.log('[PayMongo Webhook] STAGE 2e: Getting rawBody...');
                const rawBodyStr = req.rawBody ? req.rawBody.toString('utf-8') : JSON.stringify(req.body);
                console.log('[PayMongo Webhook] STAGE 2f: rawBody length:', rawBodyStr.length);

                console.log('[PayMongo Webhook] STAGE 2g: Building signed payload...');
                const signedPayload = `${timestamp}.${rawBodyStr}`;
                console.log('[PayMongo Webhook] STAGE 2h: signedPayload length:', signedPayload.length);

                console.log('[PayMongo Webhook] STAGE 2i: Computing HMAC with secret type:', typeof webhookSecret, 'length:', String(webhookSecret).length);
                const computedHmac = crypto.createHmac('sha256', webhookSecret)
                  .update(signedPayload)
                  .digest('hex');
                console.log('[PayMongo Webhook] STAGE 2j: Computed HMAC:', computedHmac.substring(0, 16) + '...');
                console.log('[PayMongo Webhook] STAGE 2k: Test sig (first 16):', testSig ? testSig.substring(0, 16) : 'n/a');
                console.log('[PayMongo Webhook] STAGE 2l: Live sig (first 16):', liveSig ? liveSig.substring(0, 16) : 'n/a');

                const isValid = (testSig && computedHmac === testSig) || (liveSig && computedHmac === liveSig);
                console.log('[PayMongo Webhook] STAGE 2m: isValid:', isValid);

                if (!isValid) {
                  console.error('[PayMongo Webhook] STAGE 2 FAILED: Signature mismatch');
                  return res.status(200).json({ received: true, error: 'invalid_signature' });
                }
                console.log('[PayMongo Webhook] STAGE 2 OK: Signature VERIFIED');
              }
            } catch (sigErr) {
              console.error('[PayMongo Webhook] STAGE 2 EXCEPTION:', sigErr.message);
              console.error('[PayMongo Webhook] STAGE 2 STACK:', sigErr.stack);
              return res.status(200).json({ received: true, error: 'signature_exception' });
            }

            // === STAGE 3: Extract payment data with full optional chaining ===
            console.log('[PayMongo Webhook] STAGE 3: Extracting payment data...');
            const eventType = req.body?.data?.attributes?.type;
            console.log('[PayMongo Webhook] Event type:', eventType);

            if (eventType !== 'checkout_session.payment.paid') {
                console.log('[PayMongo Webhook] Not a payment event, ignoring');
                return res.status(200).json({ received: true, ignored: true });
            }

            // PayMongo v1 deep nesting: data.attributes.data.attributes.metadata
            const sessionAttributes = req.body?.data?.attributes?.data?.attributes;
            const metadata = sessionAttributes?.metadata || {};
            const description = sessionAttributes?.description || '';

            console.log('[PayMongo Webhook] Session attributes keys:', sessionAttributes ? Object.keys(sessionAttributes).join(', ') : 'NONE');
            console.log('[PayMongo Webhook] Metadata:', JSON.stringify(metadata));
            console.log('[PayMongo Webhook] Description:', description);

            // Extract username from metadata or description fallback (format: "PlanName|username")
            const username = metadata.pppoe_username || metadata.username || metadata.customerUsername || (description.includes('|') ? description.split('|').pop().trim() : '');
            const durationDays = parseInt(metadata.duration_days || metadata.cycle_days || '30', 10);
            const routerId = metadata.router_id || metadata.routerId || '';
            const planName = metadata.plan_name || metadata.planName || '';
            const invoiceNo = metadata.invoice_no || '';
            const planType = metadata.planType || 'pppoe'; // Default to pppoe for backward compatibility
            const planId = metadata.planId || '';

            console.log('[PayMongo Webhook] Username:', username);
            console.log('[PayMongo Webhook] Duration days:', durationDays);
            console.log('[PayMongo Webhook] Router ID:', routerId);
            console.log('[PayMongo Webhook] Plan name:', planName);
            console.log('[PayMongo Webhook] Plan type:', planType);
            console.log('[PayMongo Webhook] Plan ID:', planId);

            if (!username) {
                console.error('[PayMongo Webhook] STAGE 3 WARNING: No username found in metadata or description');
                return res.status(200).json({ received: true, error: 'no_username' });
            }
            console.log('[PayMongo Webhook] STAGE 3 OK: Data extracted');

            // === STAGE 4: Get router config and extend subscription ===
            console.log('[PayMongo Webhook] STAGE 4: Processing subscription extension...');
            let routerConfig = null;
            try {
                if (routerId) {
                    routerConfig = await db.get('SELECT * FROM routers WHERE id = ?', [routerId]);
                }
                if (!routerConfig) {
                    // Try first router as fallback
                    routerConfig = await db.get('SELECT * FROM routers LIMIT 1');
                }
                console.log('[PayMongo Webhook] Router config found:', !!routerConfig, routerConfig ? routerConfig.host || routerConfig.ip : 'none');
            } catch (routerErr) {
                console.error('[PayMongo Webhook] Router lookup error:', routerErr.message);
            }

            if (routerConfig) {
                const routerIp = routerConfig.host || routerConfig.ip;
                const routerPort = routerConfig.port || 3002;
                const routerUser = routerConfig.username || 'admin';
                const routerPass = routerConfig.password || '';
                const apiBase = `http://${routerIp}:${routerPort}`;
                const authHeader = 'Basic ' + Buffer.from(`${routerUser}:${routerPass}`).toString('base64');

                // Check if this is a store purchase (has planType in metadata)
                const isStorePurchase = planType && planType !== 'pppoe';
                
                // Handle DHCP store purchases
                if (isStorePurchase === 'dhcp') {
                    console.log('[PayMongo Webhook] Processing DHCP store purchase for:', username);
                    
                    // Get customer details
                    const customer = await db.get('SELECT * FROM customers WHERE username = ? AND routerId = ?', [username, routerId]);
                    
                    if (customer) {
                        // Calculate new due date
                        const now = new Date();
                        const currentDue = customer.dueDate ? new Date(customer.dueDate) : now;
                        const baseDate = currentDue > now ? currentDue : now;
                        const newDue = new Date(baseDate.getTime() + durationDays * 24 * 60 * 60 * 1000);
                        const newDueStr = newDue.toISOString().split('T')[0];
                        
                        // Get DHCP plan details
                        let dhcpPlan = null;
                        if (planId) {
                            dhcpPlan = await db.get('SELECT * FROM dhcp_billing_plans WHERE id = ?', [planId]);
                        } else if (planName) {
                            dhcpPlan = await db.get('SELECT * FROM dhcp_billing_plans WHERE name = ? AND routerId = ?', [planName, routerId]);
                        }
                        
                        // Update customer due date
                        try {
                            await db.run(
                                'UPDATE customers SET dueDate = ?, planName = ? WHERE username = ? AND routerId = ?',
                                [newDueStr, planName || customer.planName, username, routerId]
                            );
                            console.log('[PayMongo Webhook] ✓ Customer due date updated to:', newDueStr);
                        } catch (updateErr) {
                            console.error('[PayMongo Webhook] Customer update error:', updateErr.message);
                        }
                        
                        // Optionally update DHCP client record in MikroTik
                        if (dhcpPlan && customer.dhcpClientName) {
                            try {
                                // Update DHCP client comment or custom attribute in MikroTik
                                console.log('[PayMongo Webhook] DHCP client record updated for:', customer.dhcpClientName);
                            } catch (mikrotikErr) {
                                console.error('[PayMongo Webhook] MikroTik DHCP update error:', mikrotikErr.message);
                            }
                        }
                    }
                } else {
                    // Handle PPPoE (existing logic)
                    // 4a. Get PPP secret
                    let secret = null;
                    try {
                        console.log('[PayMongo Webhook] Fetching PPP secret for:', username);
                        const secretRes = await axios.get(`${apiBase}/rest/ppp/secret`, {
                            params: { name: username },
                            headers: { Authorization: authHeader },
                            timeout: 10000
                        });
                        const secrets = Array.isArray(secretRes.data) ? secretRes.data : [secretRes.data];
                        secret = secrets.find(s => s.name === username) || secrets[0];
                        console.log('[PayMongo Webhook] PPP secret found:', !!secret);
                    } catch (secretErr) {
                        console.error('[PayMongo Webhook] PPP secret fetch error:', secretErr.message);
                    }

                    if (secret) {
                        // Parse existing comment
                        let comment = {};
                        try { comment = JSON.parse(secret.comment || '{}'); } catch (e) { comment = {}; }

                        // Calculate new due date
                        const now = new Date();
                        const currentDue = comment.dueDateTime ? new Date(comment.dueDateTime) : now;
                        const baseDate = currentDue > now ? currentDue : now;
                        const newDue = new Date(baseDate.getTime() + durationDays * 24 * 60 * 60 * 1000);
                        const newDueStr = newDue.toISOString().replace('T', ' ').substring(0, 16);

                        // Find active profile from billing plan
                        let activeProfile = secret.profile;
                        try {
                            const billingPlan = await db.get('SELECT pppoeProfile, name FROM billing_plans WHERE pppoeProfile = ? OR name = ? LIMIT 1', [secret.profile, planName]);
                            if (billingPlan) {
                                activeProfile = billingPlan.pppoeProfile || activeProfile;
                            }
                        } catch (planErr) {
                            console.error('[PayMongo Webhook] Billing plan lookup error:', planErr.message);
                        }

                        // 4b. Update PPP secret profile and comment
                        const updatedComment = JSON.stringify({
                            ...comment,
                            planName: planName || comment.planName,
                            dueDate: newDueStr.split(' ')[0],
                            dueDateTime: newDueStr,
                            planType: comment.planType || 'Postpaid'
                        });

                        try {
                            await axios.patch(`${apiBase}/rest/ppp/secret/${secret['.id']}`, {
                                profile: activeProfile,
                                comment: updatedComment
                            }, {
                                headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
                                timeout: 10000
                            });
                            console.log('[PayMongo Webhook] ✓ Profile set to:', activeProfile);
                            console.log('[PayMongo Webhook] ✓ Due date extended to:', newDueStr);
                        } catch (updateErr) {
                            console.error('[PayMongo Webhook] PPP secret update error:', updateErr.message);
                        }

                        // 4c. Kick active session for reconnection
                        try {
                            const activeRes = await axios.get(`${apiBase}/rest/ppp/active`, {
                                params: { name: username },
                                headers: { Authorization: authHeader },
                                timeout: 5000
                            });
                            const sessions = Array.isArray(activeRes.data) ? activeRes.data : [];
                            for (const session of sessions) {
                                if (session['.id'] && session.name === username) {
                                    await axios.post(`${apiBase}/rest/ppp/active/remove`, { '.id': session['.id'] }, {
                                        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
                                        timeout: 5000
                                    });
                                    console.log('[PayMongo Webhook] ✓ Kicked session:', session['.id']);
                                }
                            }
                        } catch (kickErr) {
                            console.error('[PayMongo Webhook] Session kick error:', kickErr.message);
                        }

                        // 4d. Create scheduler to auto-expire on due date (set to Non-Payment)
                        try {
                          console.log('[PayMongo Webhook] Creating expiration scheduler...');
                          const schedulerName = `ppp-auto-kick-${username}`;
                          
                          // Remove existing scheduler for this user if any
                          try {
                            const existingRes = await axios.get(`${apiBase}/rest/system/scheduler`, {
                              headers: { Authorization: authHeader },
                              timeout: 10000
                            });
                            const schedulers = Array.isArray(existingRes.data) ? existingRes.data : [];
                            for (const sched of schedulers) {
                              if (sched.name === schedulerName && sched['.id']) {
                                await axios.post(`${apiBase}/rest/system/scheduler/remove`, { '.id': sched['.id'] }, {
                                  headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
                                  timeout: 10000
                                });
                                console.log('[PayMongo Webhook] Removed old scheduler:', sched['.id']);
                              }
                            }
                          } catch (delErr) {
                            console.error('[PayMongo Webhook] Old scheduler cleanup error:', delErr.message);
                          }

                          // Format start-date as YYYY-MM-DD and start-time as HH:MM:SS (matching admin Pay format)
                          const startDate = `${newDue.getFullYear()}-${String(newDue.getMonth() + 1).padStart(2, '0')}-${String(newDue.getDate()).padStart(2, '0')}`;
                          const startTime = `${String(newDue.getHours()).padStart(2, '0')}:${String(newDue.getMinutes()).padStart(2, '0')}:00`;

                          // Match exact on-event format from admin Pay button
                          const onEvent = `/log info message="PPPoE auto-kick: ${username}";\n:do { /ppp active remove [find name="${username}"] } on-error={};\n/ppp secret set [find name="${username}"] profile="Non-Payment"`;
                          
                          await axios.post(`${apiBase}/rest/system/scheduler/add`, {
                            name: schedulerName,
                            interval: '0s',
                            'start-date': startDate,
                            'start-time': startTime,
                            'on-event': onEvent,
                            comment: `Auto-expire ${username} to Non-Payment on ${newDueStr}`
                          }, {
                            headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
                            timeout: 10000
                          });
                          console.log('[PayMongo Webhook] ✓ Scheduler created: Non-Payment on', newDueStr);
                        } catch (schedErr) {
                          console.error('[PayMongo Webhook] Scheduler creation error:', schedErr.message);
                        }
                    }
                }
            }

            // === STAGE 5: Record sale and update invoice ===
            console.log('[PayMongo Webhook] STAGE 5: Recording sale...');
            try {
                const saleDate = new Date().toISOString();
                const amountPaid = sessionAttributes?.line_items?.[0]?.amount
                    ? sessionAttributes.line_items[0].amount / 100
                    : (sessionAttributes?.amount ? sessionAttributes.amount / 100 : 0);
                const saleId = `sale_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
                await db.run(
                    `INSERT INTO sales_records (id, routerId, date, clientName, planName, planPrice, discountAmount, finalAmount, invoiceId) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
                    [saleId, routerId, saleDate, username, planName || 'Unknown', amountPaid, amountPaid, invoiceNo || null]
                );
                console.log('[PayMongo Webhook] ✓ Sale recorded, amount:', amountPaid);
            } catch (saleErr) {
                console.error('[PayMongo Webhook] Sale record error:', saleErr.message);
            }

            // Mark invoice as PAID
            if (invoiceNo) {
                try {
                    await db.run("UPDATE client_invoices SET status = 'PAID' WHERE id = ?", [invoiceNo]);
                    console.log('[PayMongo Webhook] ✓ Invoice marked PAID:', invoiceNo);
                } catch (invErr) {
                    console.error('[PayMongo Webhook] Invoice update error:', invErr.message);
                }
            }

            console.log('[PayMongo Webhook] ===== PROCESSING COMPLETE =====');
            return res.status(200).json({ received: true, processed: true, username });

        } catch (fatalErr) {
            // This outer catch ensures the process NEVER crashes
            console.error('[PayMongo Webhook] FATAL UNCAUGHT ERROR:', fatalErr.message);
            console.error('[PayMongo Webhook] Stack:', fatalErr.stack);
            return res.status(200).json({ received: true, error: 'internal_error' });
        }
    });

    // ========================================
    // Facebook Bot Client Management
    // ========================================
    
    // GET: Get all Facebook-linked customers
    app.get('/api/facebook/clients', async (req, res) => {
        try {
            console.log('[Facebook Clients] Fetching clients...');
            const { routerId } = req.query;
            
            // Get all customers with Facebook PSID (only select columns that exist)
            const fbClients = routerId
                ? await db.all(
                    'SELECT id, accountNumber, username, fullName, facebook_psid, planName, dueDate, planType, routerId, contactNumber, email, address FROM customers WHERE facebook_psid IS NOT NULL AND facebook_psid != "" AND routerId = ? ORDER BY dueDate ASC',
                    [routerId]
                  )
                : await db.all(
                    'SELECT id, accountNumber, username, fullName, facebook_psid, planName, dueDate, planType, routerId, contactNumber, email, address FROM customers WHERE facebook_psid IS NOT NULL AND facebook_psid != "" ORDER BY dueDate ASC'
                  );
            
            console.log(`[Facebook Clients] Found ${fbClients.length} clients`);
            res.json(fbClients);
        } catch (e) {
            console.error('[Facebook Clients] Error fetching clients:', e.message);
            console.error('[Facebook Clients] Stack:', e.stack);
            res.status(500).json({ message: e.message, error: e.stack });
        }
    });
    
    // POST: Send manual payment reminder to Facebook client
    app.post('/api/facebook/clients/:id/remind', async (req, res) => {
        try {
            const customerId = req.params.id;
            
            // Get customer
            const customer = await db.get('SELECT * FROM customers WHERE id = ?', [customerId]);
            
            if (!customer || !customer.facebook_psid) {
                return res.status(404).json({ message: 'Customer not found or not linked to Facebook' });
            }
            
            // Get Facebook settings
            const fbSettings = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
            const fbConfig = JSON.parse(fbSettings?.facebookSettings || '{}');
            
            if (!fbConfig.enabled || !fbConfig.pageAccessToken) {
                return res.status(400).json({ message: 'Facebook Messenger not configured' });
            }
            
            // Calculate days until due
            const now = new Date();
            const dueDate = new Date(customer.dueDate);
            const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
            
            let message;
            if (daysUntilDue < 0) {
                message = `⚠️ OVERDUE PAYMENT NOTICE\n━━━━━━━━━━━━━━━━━━\n\n📋 Account: ${customer.accountNumber}\n👤 Name: ${customer.fullName || 'Valued Customer'}\n💰 Amount Due: ₱${(customer.planPrice || 0).toFixed(2)}\n📅 Due Date: ${customer.dueDate} (${Math.abs(daysUntilDue)} days overdue)\n\n⚠️ Your internet service may be suspended.\n\n💳 Pay now via:\n• PAY ONLINE - Online payment\n• PAY MANUAL - GCash payment\n\n📞 Contact us if you need assistance.`;
            } else if (daysUntilDue === 0) {
                message = `🔴 PAYMENT DUE TODAY\n━━━━━━━━━━━━━━━━━━\n\n📋 Account: ${customer.accountNumber}\n👤 Name: ${customer.fullName || 'Valued Customer'}\n💰 Amount Due: ₱${(customer.planPrice || 0).toFixed(2)}\n📅 Due Date: TODAY\n\n⏰ Please make your payment today to avoid service interruption.\n\n💳 Pay now via:\n• PAY ONLINE - Online payment\n• PAY MANUAL - GCash payment\n\n📞 Contact us if you need assistance.`;
            } else if (daysUntilDue <= 3) {
                message = `⏰ PAYMENT REMINDER\n━━━━━━━━━━━━━━━━━━\n\n📋 Account: ${customer.accountNumber}\n👤 Name: ${customer.fullName || 'Valued Customer'}\n💰 Amount Due: ₱${(customer.planPrice || 0).toFixed(2)}\n📅 Due Date: ${customer.dueDate} (${daysUntilDue} day${daysUntilDue > 1 ? 's' : ''})\n\n💡 This is a friendly reminder to make your payment on time.\n\n💳 Pay now via:\n• PAY ONLINE - Online payment\n• PAY MANUAL - GCash payment\n\n📞 Contact us if you need assistance.`;
            } else {
                message = `📅 PAYMENT NOTIFICATION\n━━━━━━━━━━━━━━━━━━\n\n📋 Account: ${customer.accountNumber}\n👤 Name: ${customer.fullName || 'Valued Customer'}\n💰 Amount Due: ₱${(customer.planPrice || 0).toFixed(2)}\n📅 Due Date: ${customer.dueDate} (${daysUntilDue} days)\n\n💳 Pay via:\n• PAY ONLINE - Online payment\n• PAY MANUAL - GCash payment\n\n📞 Contact us if you need assistance.`;
            }
            
            // Send Facebook message
            const axios = require('axios');
            const fbResponse = await axios.post(
                `https://graph.facebook.com/v18.0/me/messages?access_token=${fbConfig.pageAccessToken}`,
                {
                    messaging_type: 'UPDATE',
                    recipient: { id: customer.facebook_psid },
                    message: { text: message }
                },
                { timeout: 10000 }
            );
            
            console.log(`[Facebook Clients] Reminder sent to ${customer.accountNumber} (${customer.facebook_psid})`);
            
            res.json({ 
                message: 'Reminder sent successfully',
                facebook_message_id: fbResponse.data.message_id,
                days_until_due: daysUntilDue
            });
        } catch (e) {
            console.error('[Facebook Clients] Error sending reminder:', e.message);
            res.status(500).json({ message: e.message });
        }
    });
    
    // POST: Send bulk reminders to all due/overdue clients
    app.post('/api/facebook/clients/remind-bulk', async (req, res) => {
        try {
            const { daysBefore, routerId } = req.body;
            const daysThreshold = daysBefore || 3; // Default: 3 days before
            
            // Get clients due within threshold
            const now = new Date();
            const thresholdDate = new Date(now);
            thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);
            
            const clients = routerId
                ? await db.all(
                    'SELECT * FROM customers WHERE facebook_psid IS NOT NULL AND facebook_psid != "" AND routerId = ? AND dueDate <= ? AND (planType = "Postpaid" OR planType = "Active")',
                    [routerId, thresholdDate.toISOString().split('T')[0]]
                  )
                : await db.all(
                    'SELECT * FROM customers WHERE facebook_psid IS NOT NULL AND facebook_psid != "" AND dueDate <= ? AND (planType = "Postpaid" OR planType = "Active")',
                    [thresholdDate.toISOString().split('T')[0]]
                  );
            
            // Get Facebook settings
            const fbSettings = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
            const fbConfig = JSON.parse(fbSettings?.facebookSettings || '{}');
            
            if (!fbConfig.enabled || !fbConfig.pageAccessToken) {
                return res.status(400).json({ message: 'Facebook Messenger not configured' });
            }
            
            const results = [];
            const axios = require('axios');
            
            for (const customer of clients) {
                try {
                    const daysUntilDue = Math.ceil((new Date(customer.dueDate) - now) / (1000 * 60 * 60 * 24));
                    
                    let message;
                    if (daysUntilDue < 0) {
                        message = `⚠️ OVERDUE: ₱${(customer.planPrice || 0).toFixed(2)}\nAccount: ${customer.accountNumber}\nDue: ${customer.dueDate} (${Math.abs(daysUntilDue)} days overdue)\n\nPay now to avoid suspension!\nSend PAY to this bot to pay.`;
                    } else if (daysUntilDue === 0) {
                        message = `🔴 DUE TODAY: ₱${(customer.planPrice || 0).toFixed(2)}\nAccount: ${customer.accountNumber}\n\nPlease pay today to avoid service interruption.\nSend PAY to this bot.`;
                    } else {
                        message = `⏰ Reminder: ₱${(customer.planPrice || 0).toFixed(2)} due in ${daysUntilDue} day${daysUntilDue > 1 ? 's' : ''}\nAccount: ${customer.accountNumber}\nDue: ${customer.dueDate}\n\nSend PAY to this bot to pay.`;
                    }
                    
                    await axios.post(
                        `https://graph.facebook.com/v18.0/me/messages?access_token=${fbConfig.pageAccessToken}`,
                        {
                            messaging_type: 'UPDATE',
                            recipient: { id: customer.facebook_psid },
                            message: { text: message }
                        },
                        { timeout: 10000 }
                    );
                    
                    results.push({
                        account: customer.accountNumber,
                        facebook_psid: customer.facebook_psid,
                        status: 'sent',
                        days_until_due: daysUntilDue
                    });
                } catch (err) {
                    results.push({
                        account: customer.accountNumber,
                        facebook_psid: customer.facebook_psid,
                        status: 'failed',
                        error: err.message
                    });
                }
            }
            
            console.log(`[Facebook Clients] Bulk reminders sent: ${results.filter(r => r.status === 'sent').length}/${clients.length}`);
            
            res.json({ 
                message: `Reminders sent to ${results.filter(r => r.status === 'sent').length} clients`,
                total: clients.length,
                sent: results.filter(r => r.status === 'sent').length,
                failed: results.filter(r => r.status === 'failed').length,
                results
            });
        } catch (e) {
            console.error('[Facebook Clients] Error sending bulk reminders:', e.message);
            res.status(500).json({ message: e.message });
        }
    });
    
    // POST: Send announcement/broadcast to ALL Facebook-linked clients
    app.post('/api/facebook/clients/broadcast', async (req, res) => {
        try {
            const { message, routerId } = req.body;
            
            if (!message || message.trim() === '') {
                return res.status(400).json({ message: 'Message is required' });
            }
            
            console.log('[Facebook Broadcast] Sending announcement to all clients...');
            
            // Get all Facebook-linked clients
            const fbClients = routerId
                ? await db.all(
                    'SELECT id, accountNumber, fullName, facebook_psid FROM customers WHERE facebook_psid IS NOT NULL AND facebook_psid != "" AND routerId = ?',
                    [routerId]
                  )
                : await db.all(
                    'SELECT id, accountNumber, fullName, facebook_psid FROM customers WHERE facebook_psid IS NOT NULL AND facebook_psid != ""'
                  );
            
            if (fbClients.length === 0) {
                return res.status(404).json({ message: 'No Facebook-linked clients found' });
            }
            
            console.log(`[Facebook Broadcast] Found ${fbClients.length} clients to notify`);
            
            // Get Facebook settings
            const fbSettings = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
            const fbConfig = JSON.parse(fbSettings?.facebookSettings || '{}');
            
            if (!fbConfig.enabled || !fbConfig.pageAccessToken) {
                return res.status(400).json({ message: 'Facebook Messenger not configured' });
            }
            
            const axios = require('axios');
            let sentCount = 0;
            let failedCount = 0;
            const results = [];
            
            for (const client of fbClients) {
                try {
                    // Personalize message with customer name
                    const personalizedMessage = message
                        .replace('{name}', client.fullName || 'Valued Customer')
                        .replace('{account}', client.accountNumber);
                    
                    await axios.post(
                        `https://graph.facebook.com/v18.0/me/messages?access_token=${fbConfig.pageAccessToken}`,
                        {
                            messaging_type: 'UPDATE',
                            recipient: { id: client.facebook_psid },
                            message: { text: personalizedMessage }
                        },
                        { timeout: 10000 }
                    );
                    
                    sentCount++;
                    console.log(`[Facebook Broadcast] ✓ Sent to ${client.accountNumber} (${client.fullName})`);
                    results.push({
                        accountNumber: client.accountNumber,
                        facebook_psid: client.facebook_psid,
                        status: 'sent'
                    });
                } catch (err) {
                    failedCount++;
                    console.error(`[Facebook Broadcast] ✗ Failed for ${client.accountNumber}:`, err.message);
                    results.push({
                        accountNumber: client.accountNumber,
                        facebook_psid: client.facebook_psid,
                        status: 'failed',
                        error: err.message
                    });
                }
            }
            
            console.log(`[Facebook Broadcast] Complete: ${sentCount} sent, ${failedCount} failed out of ${fbClients.length} total`);
            
            res.json({
                message: 'Broadcast sent',
                total: fbClients.length,
                sent: sentCount,
                failed: failedCount,
                results
            });
        } catch (e) {
            console.error('[Facebook Broadcast] Error:', e.message);
            res.status(500).json({ message: e.message });
        }
    });

    // ========================================
    // Plan Management - Cleanup Unused Plans
    // ========================================
    
    // GET: Find unused/orphaned plans
    app.get('/api/db/plans/unused', async (req, res) => {
        try {
            const { routerId } = req.query;
            
            // Get all plans for this router
            const allPlans = routerId
                ? await db.all('SELECT * FROM billing_plans WHERE routerId = ?', [routerId])
                : await db.all('SELECT * FROM billing_plans');
            
            // Get all unique plan names used by customers
            const usedPlans = routerId
                ? await db.all('SELECT DISTINCT planName FROM customers WHERE routerId = ? AND planName IS NOT NULL', [routerId])
                : await db.all('SELECT DISTINCT planName FROM customers WHERE planName IS NOT NULL');
            
            const usedPlanNames = new Set(usedPlans.map(p => p.planName));
            
            // Find plans that are NOT used by any customer
            const unusedPlans = allPlans.filter(plan => !usedPlanNames.has(plan.name));
            
            res.json({
                total: allPlans.length,
                used: usedPlans.length,
                unused: unusedPlans.length,
                unusedPlans: unusedPlans
            });
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });
    
    // POST: Delete unused plans
    app.post('/api/db/plans/cleanup', async (req, res) => {
        try {
            const { routerId, deleteAll } = req.body;
            
            if (deleteAll) {
                // Delete ALL unused plans
                const allPlans = routerId
                    ? await db.all('SELECT * FROM billing_plans WHERE routerId = ?', [routerId])
                    : await db.all('SELECT * FROM billing_plans');
                
                const usedPlans = routerId
                    ? await db.all('SELECT DISTINCT planName FROM customers WHERE routerId = ? AND planName IS NOT NULL', [routerId])
                    : await db.all('SELECT DISTINCT planName FROM customers WHERE planName IS NOT NULL');
                
                const usedPlanNames = new Set(usedPlans.map(p => p.planName));
                const unusedPlans = allPlans.filter(plan => !usedPlanNames.has(plan.name));
                
                let deletedCount = 0;
                for (const plan of unusedPlans) {
                    await db.run('DELETE FROM billing_plans WHERE id = ?', [plan.id]);
                    deletedCount++;
                }
                
                res.json({ message: `Deleted ${deletedCount} unused plans`, deletedCount });
            } else {
                // Delete specific plan
                const { planId } = req.body;
                if (!planId) {
                    return res.status(400).json({ message: 'planId is required' });
                }
                
                // Check if plan is used by any customer
                const usage = await db.get('SELECT COUNT(*) as count FROM customers WHERE planName = (SELECT name FROM billing_plans WHERE id = ?)', [planId]);
                
                if (usage.count > 0) {
                    return res.status(400).json({ 
                        message: `Cannot delete plan: ${usage.count} customer(s) are using this plan`,
                        usage: usage.count 
                    });
                }
                
                await db.run('DELETE FROM billing_plans WHERE id = ?', [planId]);
                res.json({ message: 'Plan deleted successfully' });
            }
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    // ========================================
    // Facebook Messenger Webhook Routes
    // ========================================

    // GET: Facebook Webhook Verification Endpoint
    app.get('/api/facebook-webhook', async (req, res) => {
        try {
            console.log('[Facebook Webhook] Verification request received');
            
            // Read Facebook settings from database
            const settings = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
            let fbSettings = { enabled: false, verifyToken: '' };
            try {
                fbSettings = JSON.parse(settings?.facebookSettings || '{}');
            } catch (_) {}

            // Check if Facebook Messenger is enabled
            if (!fbSettings.enabled) {
                console.log('[Facebook Webhook] Rejected: Facebook Messenger is disabled');
                return res.status(403).json({ error: 'Facebook Messenger is not enabled' });
            }

            // Verify the token
            const verifyToken = req.query['hub.verify_token'];
            const challenge = req.query['hub.challenge'];

            if (verifyToken && verifyToken === fbSettings.verifyToken) {
                console.log('[Facebook Webhook] Verification successful');
                return res.status(200).send(String(challenge));
            } else {
                console.log('[Facebook Webhook] Verification failed: token mismatch');
                return res.status(403).json({ error: 'Verification token mismatch' });
            }
        } catch (err) {
            console.error('[Facebook Webhook] Verification error:', err.message);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    // POST: Facebook Webhook Message Receiver - Full Billing Bot
    app.post('/api/facebook-webhook', async (req, res) => {
        try {
            console.log('[Facebook Webhook] Message event received');
            
            // Read Facebook settings from database
            const settings = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
            let fbSettings = { enabled: false, pageAccessToken: '' };
            try {
                fbSettings = JSON.parse(settings?.facebookSettings || '{}');
            } catch (_) {}

            // Check if Facebook Messenger is enabled
            if (!fbSettings.enabled) {
                console.log('[Facebook Webhook] Rejected: Facebook Messenger is disabled');
                return res.status(200).json({ error: 'Facebook Messenger is not enabled' });
            }

            const body = req.body;

            // Iterate over each entry in case there are multiple
            if (body.object && body.entry && Array.isArray(body.entry)) {
                for (const entry of body.entry) {
                    // Handle messaging events
                    if (entry.messaging && Array.isArray(entry.messaging)) {
                        for (const event of entry.messaging) {
                            const senderId = event.sender?.id;
                            const message = event.message;

                            if (senderId && message && message.text) {
                                const userMessage = message.text.trim();
                                console.log(`[Facebook Bot] Message from ${senderId}: "${userMessage}"`);
                                
                                try {
                                    // First, check if user is in manual payment flow
                                    const manualPaymentResponse = await processManualPaymentSteps(senderId, userMessage);
                                    
                                    // If in manual payment flow, use that response
                                    if (manualPaymentResponse) {
                                        await sendFacebookMessage(senderId, manualPaymentResponse, fbSettings.pageAccessToken);
                                    } else {
                                        // Otherwise, process normal bot commands
                                        const response = await processFacebookBotMessage(senderId, userMessage, fbSettings.pageAccessToken);
                                        
                                        // Send response if there is one
                                        if (response) {
                                            await sendFacebookMessage(senderId, response, fbSettings.pageAccessToken);
                                        }
                                    }
                                } catch (sendErr) {
                                    console.error('[Facebook Bot] Failed to send response:', sendErr.message);
                                    // Don't crash - continue processing other messages
                                }
                            }
                        }
                    }
                }
            }

            // Always return 200 OK to Facebook
            res.status(200).json({ received: true });
        } catch (err) {
            console.error('[Facebook Webhook] Message handling error:', err.message);
            // Always return 200 to prevent Facebook from retrying
            res.status(200).json({ received: true, error: 'handled' });
        }
    });

    // ========================================
    // Facebook Bot Message Processor
    // ========================================
    
    // In-memory conversation state storage (for multi-step flows)
    const conversationStates = new Map();
    
    async function processFacebookBotMessage(senderId, userMessage, pageAccessToken) {
        const upperMessage = userMessage.toUpperCase();
        
        // Get routerId from Facebook settings
        const fbSettings = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
        const fbConfig = JSON.parse(fbSettings?.facebookSettings || '{}');
        const routerId = fbConfig.routerId;
        
        if (!routerId) {
            console.warn('[Facebook Bot] WARNING: No routerId configured in Facebook settings! Bot will search across ALL routers.');
        }

        // Command: REGISTER <account_no>
        if (upperMessage.startsWith('REGISTER') || upperMessage.startsWith('REG')) {
            return await handleRegisterCommand(senderId, userMessage, routerId);
        }

        // Command: UNREGISTER, UNLINK, DISCONNECT
        if (['UNREGISTER', 'UNLINK', 'DISCONNECT', 'UNREG', 'REMOVE'].some(cmd => upperMessage === cmd || upperMessage.startsWith(cmd + ' '))) {
            return await handleUnregisterCommand(senderId, routerId);
        }

        // Command: END, STOP, EXIT, MAIN, MENU
        if (['END', 'STOP', 'EXIT', 'MAIN', 'MENU', 'HOME', 'BACK'].some(cmd => upperMessage === cmd || upperMessage.startsWith(cmd + ' '))) {
            return await handleEndCommand(senderId);
        }

        // Command: BILL, BALANCE, STATUS, ACCOUNT
        if (['BILL', 'BALANCE', 'STATUS', 'ACCOUNT', 'BILLING', 'INFO'].some(cmd => upperMessage === cmd || upperMessage.startsWith(cmd + ' '))) {
            return await handleBillingCommand(senderId, routerId);
        }

        // Command: PAY, PAYMENT, BAYAD
        if (['PAY', 'PAYMENT', 'BAYAD'].some(cmd => upperMessage === cmd || upperMessage.startsWith(cmd + ' '))) {
            return await handlePaymentCommand(senderId, routerId);
        }

        // Command: PAY ONLINE, 1, ONLINE
        if (upperMessage === 'PAY ONLINE' || upperMessage === '1' || upperMessage === 'ONLINE') {
            return await handlePayOnlineCommand(senderId, routerId);
        }

        // Command: PAY MANUAL, 2, MANUAL, GCASH
        if (upperMessage === 'PAY MANUAL' || upperMessage === '2' || upperMessage === 'MANUAL' || upperMessage === 'GCASH') {
            return await handlePayManualCommand(senderId, routerId);
        }

        // Command: REPAIR, TICKET, HELP ME, ISSUE, PROBLEM
        if (['REPAIR', 'TICKET', 'HELP ME', 'ISSUE', 'PROBLEM', 'NO INTERNET'].some(cmd => upperMessage.startsWith(cmd))) {
            // Check if it's TICKET STATUS
            if (upperMessage === 'TICKET STATUS' || upperMessage === 'TICKETS' || upperMessage === 'MY TICKETS') {
                return await handleTicketStatusCommand(senderId);
            }
            return await handleRepairTicketCommand(senderId, userMessage);
        }

        // Command: HELP
        if (upperMessage === 'HELP' || upperMessage === 'MENU' || upperMessage === 'COMMANDS') {
            return getHelpMessage();
        }

        // Default: Show help menu
        return getHelpMessage();
    }

    // ========================================
    // Handler: REGISTER Command
    // ========================================
    async function handleRegisterCommand(senderId, userMessage, routerId) {
        try {
            // Extract account number (remove "REGISTER" or "REG" keyword)
            const parts = userMessage.split(/\s+/);
            const accountNumber = parts.slice(1).join(' ').trim();

            if (!accountNumber) {
                return "⚠️ Please provide your account number.\n\nUsage: `REGISTER <account_number>`\nExample: `REGISTER 20240001`";
            }

            console.log(`[Facebook Bot] Registration attempt for account: ${accountNumber} (router: ${routerId || 'ALL'})`);

            // Try multiple lookup strategies to find the customer - FILTERED BY ROUTER
            let customer = null;
            
            // Strategy 1: EXACT match by accountNumber - ROUTER SCOPED (HIGHEST PRIORITY)
            if (routerId) {
                customer = await db.get(
                    'SELECT * FROM customers WHERE accountNumber = ? AND routerId = ?',
                    [accountNumber, routerId]
                );
                
                if (customer) {
                    console.log(`[Facebook Bot] ✅ Found by EXACT accountNumber: ${customer.accountNumber}`);
                }
            }
            
            // Strategy 2: EXACT match by username - ROUTER SCOPED
            if (!customer && routerId) {
                customer = await db.get(
                    'SELECT * FROM customers WHERE username = ? AND routerId = ?',
                    [accountNumber, routerId]
                );
                
                if (customer) {
                    console.log(`[Facebook Bot] ✅ Found by EXACT username: ${customer.username}`);
                }
            }
            
            // Strategy 3: Partial match (remove ACC- prefix) - ROUTER SCOPED
            if (!customer && routerId) {
                const cleanNumber = accountNumber.replace(/^ACC[-]?/i, '');
                customer = await db.get(
                    'SELECT * FROM customers WHERE (accountNumber LIKE ? OR username LIKE ?) AND routerId = ?',
                    [`%${cleanNumber}%`, `%${cleanNumber}%`, routerId]
                );
                
                if (customer) {
                    console.log(`[Facebook Bot] ✅ Found by partial match: ${customer.accountNumber}`);
                }
            }
            
            // Strategy 4: Search by fullName - ROUTER SCOPED
            if (!customer && routerId) {
                customer = await db.get(
                    'SELECT * FROM customers WHERE fullName = ? AND routerId = ?',
                    [accountNumber, routerId]
                );
                
                if (customer) {
                    console.log(`[Facebook Bot] ✅ Found by fullName: ${customer.fullName}`);
                }
            }
            
            // Fallback: If NO routerId configured, search without router scope
            if (!customer && !routerId) {
                console.warn('[Facebook Bot] ⚠️ No routerId! Searching ALL routers (may find wrong accounts)');
                customer = await db.get(
                    'SELECT * FROM customers WHERE accountNumber = ? LIMIT 1',
                    [accountNumber]
                );
            }

            if (!customer) {
                console.log(`[Facebook Bot] ❌ Account lookup failed for: ${accountNumber}`);
                return `❌ Account "${accountNumber}" not found in our system.\n\nPlease check your account number and try again.\n\nIf you don't have an account yet, please visit our office or contact support.`;
            }
            
            // CRITICAL: Check if this Facebook account is already linked to ANY customer (across all routers)
            const existingLink = await db.get(
                'SELECT * FROM customers WHERE facebook_psid = ?',
                [senderId]
            );
                        
            if (existingLink) {
                // Already linked - check if it's the SAME account
                if (existingLink.accountNumber === customer.accountNumber || existingLink.username === customer.username) {
                    return `ℹ️ Your Facebook account is already linked to ${existingLink.accountNumber}.\n\n📋 Current Account:\n• Account #: ${existingLink.accountNumber}\n• Name: ${existingLink.fullName || 'N/A'}\n• Plan: ${existingLink.planName || 'N/A'}\n\nTo register a different account, first send:\nUNREGISTER\n\nThen register your new account.`;
                } else {
                    // Linked to DIFFERENT account - clear the old linkage automatically
                    console.log(`[Facebook Bot] ⚠️ Facebook account was linked to ${existingLink.accountNumber}, clearing old linkage...`);
                    await db.run(
                        'UPDATE customers SET facebook_psid = NULL WHERE id = ?',
                        [existingLink.id]
                    );
                    console.log(`[Facebook Bot] ✅ Cleared old linkage from ${existingLink.accountNumber}`);
                    // Continue with new registration below
                }
            }

            // Check if this account number is already linked to ANOTHER Facebook account
            if (customer.facebook_psid && customer.facebook_psid !== senderId) {
                return `⚠️ This account (${accountNumber}) is already linked to another Facebook account.\n\nPlease contact our support if you need to transfer the account to your Facebook.`;
            }

            // Link Facebook PSID to customer account
            await db.run(
                'UPDATE customers SET facebook_psid = ? WHERE id = ?',
                [senderId, customer.id]
            );

            console.log(`[Facebook Bot] Successfully linked Facebook user ${senderId} to account ${customer.accountNumber}`);

            // Get customer's billing info for confirmation message
            const planName = customer.planName || 'Not specified';
            const dueDate = customer.dueDate || 'Not set';

            return `✅ Success! Your Facebook account is now linked!\n\n📋 Account Details:\n• Account #: ${customer.accountNumber}\n• Name: ${customer.fullName || 'N/A'}\n• Plan: ${planName}\n• Due Date: ${dueDate}\n\n💡 You can now check your billing status by sending:\n• BILL - View your current bill\n• STATUS - Check your account status\n• PAY - Make a payment\n• HELP - Show all commands\n\nTo unlink this account, send: UNREGISTER`;
        } catch (err) {
            console.error('[Facebook Bot] Registration error:', err.message);
            return "❌ Sorry, an error occurred while processing your registration. Please try again later or contact support.";
        }
    }

    // ========================================
    // Handler: END Command - Return to Main Menu
    // ========================================
    async function handleEndCommand(senderId) {
        try {
            console.log(`[Facebook Bot] End conversation request from: ${senderId}`);
            
            // Clear any in-progress conversation state (if using session storage)
            // This will reset any multi-step flows like payment collection
            conversationStates.delete(senderId);
            
            console.log(`[Facebook Bot] Cleared conversation state for ${senderId}`);
            
            return `👋 Conversation Ended\n\nYou have returned to the main menu.\n\n📋 Available Commands:\n\n🔍 Account:\n• REGISTER <acct#> - Link your account\n• UNREGISTER - Unlink account\n• BILL - View billing\n• STATUS - Check status\n\n💳 Payments:\n• PAY - Payment options\n• PAY ONLINE - Online payment\n• PAY MANUAL - Manual/GCash\n\n🔧 Support:\n• REPAIR - Create ticket\n• TICKET STATUS - Check tickets\n• HELP - Show all commands\n\n💡 Type END anytime to return here.`;
        } catch (err) {
            console.error('[Facebook Bot] End command error:', err.message);
            return "❌ Error occurred. Please try again or contact support.";
        }
    }

    // ========================================
    // Handler: UNREGISTER Command
    // ========================================
    async function handleUnregisterCommand(senderId, routerId) {
        try {
            console.log(`[Facebook Bot] Unregister request from Facebook user: ${senderId}`);

            // Find customer linked to this Facebook account
            const customer = routerId
                ? await db.get('SELECT * FROM customers WHERE facebook_psid = ? AND routerId = ?', [senderId, routerId])
                : await db.get('SELECT * FROM customers WHERE facebook_psid = ?', [senderId]);

            if (!customer) {
                return `ℹ️ Your Facebook account is not currently linked to any account.\n\nTo register, send:\n📝 REGISTER <your_account_number>\nExample: REGISTER 20240001`;
            }

            // Remove Facebook PSID from customer
            await db.run(
                'UPDATE customers SET facebook_psid = NULL WHERE id = ?',
                [customer.id]
            );

            console.log(`[Facebook Bot] Unlinked Facebook user ${senderId} from account ${customer.accountNumber}`);

            return `✅ Account Unlinked Successfully\n\n📋 Unlinked Account:\n• Account #: ${customer.accountNumber}\n• Name: ${customer.fullName || 'N/A'}\n\nYour Facebook account is no longer linked to this account.\n\nTo register a new account, send:\n📝 REGISTER <your_account_number>`;
        } catch (err) {
            console.error('[Facebook Bot] Unregister error:', err.message);
            return "❌ Sorry, an error occurred while processing your request. Please try again later or contact support.";
        }
    }

    // ========================================
    // Handler: BILL/BALANCE/STATUS Command
    // ========================================
    async function handleBillingCommand(senderId, routerId) {
        try {
            console.log(`[Facebook Bot] Billing inquiry from Facebook user: ${senderId} (router: ${routerId || 'ALL'})`);

            // Find customer by Facebook PSID - ROUTER SCOPED
            let customer;
            if (routerId) {
                customer = await db.get(
                    'SELECT * FROM customers WHERE facebook_psid = ? AND routerId = ?',
                    [senderId, routerId]
                );
            } else {
                customer = await db.get(
                    'SELECT * FROM customers WHERE facebook_psid = ?',
                    [senderId]
                );
            }

            if (!customer) {
                return `👋 Welcome! It looks like you haven't linked your account yet.\n\nTo check your billing information, please register first:\n\n📝 Send: REGISTER <your_account_number>\nExample: REGISTER 20240001\n\nYou can find your account number on your billing statement or contact our support for assistance.`;
            }

            // Customer found - prepare billing details
            const planName = customer.planName || 'Not specified';
            const dueDate = customer.dueDate || 'Not set';
            const status = customer.planType || 'Active';
            const fullName = customer.fullName || 'Valued Customer';
            const address = customer.address || 'Not provided';

            // Calculate days until due (if dueDate exists)
            let daysRemaining = '';
            if (dueDate && dueDate !== 'Not set') {
                const due = new Date(dueDate);
                const now = new Date();
                const diffTime = due - now;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                if (diffDays < 0) {
                    daysRemaining = `\n⚠️ OVERDUE by ${Math.abs(diffDays)} days`;
                } else if (diffDays === 0) {
                    daysRemaining = `\n⚠️ DUE TODAY!`;
                } else {
                    daysRemaining = `\n⏰ ${diffDays} days remaining`;
                }
            }

            const receipt = `📊 Billing Statement\n━━━━━━━━━━━━━━━━━━\n\n👤 Account Information:\n• Name: ${fullName}\n• Account #: ${customer.accountNumber}\n• Address: ${address}\n\n💰 Plan Details:\n• Plan: ${planName}\n• Status: ${status}\n• Due Date: ${dueDate}${daysRemaining}\n\n━━━━━━━━━━━━━━━━━━\n\n💳 To pay your bill, send: PAY\n\nNeed help? Send HELP for all commands.\nTo update your info, visit our office or contact support.`;

            return receipt;
        } catch (err) {
            console.error('[Facebook Bot] Billing inquiry error:', err.message);
            return "❌ Sorry, an error occurred while retrieving your billing information. Please try again later or contact support.";
        }
    }

    // ========================================
    // Handler: PAY Command - Show Payment Options
    // ========================================
    async function handlePaymentCommand(senderId, routerId) {
        try {
            console.log(`[Facebook Bot] Payment request from Facebook user: ${senderId} (router: ${routerId || 'ALL'})`);

            // Find customer by Facebook PSID - ROUTER SCOPED
            let customer;
            if (routerId) {
                customer = await db.get(
                    'SELECT * FROM customers WHERE facebook_psid = ? AND routerId = ?',
                    [senderId, routerId]
                );
            } else {
                customer = await db.get(
                    'SELECT * FROM customers WHERE facebook_psid = ?',
                    [senderId]
                );
            }

            if (!customer) {
                return `👋 Welcome! It looks like you haven't linked your account yet.\n\nTo make a payment, please register first:\n\n📝 Send: REGISTER <your_account_number>\nExample: REGISTER 20240001\n\nOnce registered, you can pay your subscription via Facebook Messenger.`;
            }

            // Get customer's plan details
            let planName = customer.planName || 'Subscription';
            let planPrice = customer.planPrice || 0;
            
            console.log(`[Facebook Bot] Customer record: planName="${customer.planName}", planPrice=${customer.planPrice}`);
            
            // CRITICAL: Try to get ACTUAL plan from MikroTik PPPoE secret comment (more up-to-date than customers table)
            if (routerId && customer.username) {
                try {
                    console.log(`[Facebook Bot] Attempting to get plan from MikroTik PPPoE secret: ${customer.username}`);
                    
                    // Get router config
                    const router = await db.get('SELECT * FROM routers WHERE id = ?', [routerId]);
                    
                    if (router) {
                        const axios = require('axios');
                        const baseUrl = `http://${router.host}:${router.port}`;
                        const auth = { username: router.user, password: router.password };
                        
                        // Get PPPoE secret - correct REST API path
                        const secretResponse = await axios.get(`${baseUrl}/rest/ppp/secret`, {
                            auth,
                            params: { '.id': '*all', name: customer.username },
                            timeout: 10000
                        });
                        
                        if (secretResponse.data && secretResponse.data.length > 0) {
                            const secret = secretResponse.data[0];
                            console.log(`[Facebook Bot] Found PPPoE secret for ${customer.username}`);
                            
                            // Parse comment to get plan info
                            if (secret.comment) {
                                try {
                                    const commentData = JSON.parse(secret.comment);
                                    
                                    // Use plan from comment if available
                                    if (commentData.planName) {
                                        planName = commentData.planName;
                                        console.log(`[Facebook Bot] ✅ Got planName from MikroTik secret: "${planName}"`);
                                    }
                                    
                                    if (commentData.planPrice) {
                                        planPrice = commentData.planPrice;
                                        console.log(`[Facebook Bot] ✅ Got planPrice from MikroTik secret: ₱${planPrice}`);
                                    }
                                    
                                    // If we have plan name but no price, lookup in billing_plans
                                    if (planName && (!planPrice || planPrice <= 0)) {
                                        const plan = await db.get(
                                            'SELECT price FROM billing_plans WHERE LOWER(name) = LOWER(?) AND routerId = ? LIMIT 1',
                                            [planName, routerId]
                                        );
                                        if (plan && plan.price) {
                                            planPrice = plan.price;
                                            console.log(`[Facebook Bot] ✅ Got price from billing_plans: ₱${planPrice}`);
                                        }
                                    }
                                } catch (e) {
                                    console.warn(`[Facebook Bot] Failed to parse PPPoE secret comment:`, e.message);
                                }
                            }
                        } else {
                            console.warn(`[Facebook Bot] PPPoE secret not found for: ${customer.username}`);
                        }
                    }
                } catch (err) {
                    console.warn(`[Facebook Bot] Failed to get plan from MikroTik:`, err.response?.status || err.message);
                    // Continue with customer record data as fallback
                }
            }
            
            // Fallback: If still no price, try billing_plans lookup with current planName
            if (!planPrice || planPrice <= 0) {
                console.log(`[Facebook Bot] No price yet, trying billing_plans lookup for: "${planName}"`);
                try {
                    const plan = routerId
                        ? await db.get(
                            'SELECT price FROM billing_plans WHERE LOWER(name) = LOWER(?) AND routerId = ? LIMIT 1',
                            [planName, routerId]
                          )
                        : await db.get(
                            'SELECT price FROM billing_plans WHERE LOWER(name) = LOWER(?) LIMIT 1',
                            [planName]
                          );
                    
                    if (plan && plan.price) {
                        planPrice = plan.price;
                        console.log(`[Facebook Bot] ✅ Got price from billing_plans: ₱${planPrice}`);
                    }
                } catch (err) {
                    console.warn('[Facebook Bot] Failed billing_plans lookup:', err.message);
                }
            }

            // If still no price after all attempts, error
            if (!planPrice || planPrice <= 0) {
                console.error(`[Facebook Bot] CRITICAL: Cannot determine price for customer ${customer.accountNumber}`);
                
                // Show available plans to help debugging
                const allPlans = routerId
                    ? await db.all('SELECT name, price FROM billing_plans WHERE routerId = ?', [routerId])
                    : await db.all('SELECT name, price FROM billing_plans LIMIT 10');
                
                return `⚠️ Unable to determine your plan price.\n\nYour account shows: "${planName}"\nBut this plan doesn't exist in our system.\n\n📋 Available plans:\n${allPlans.map(p => `• ${p.name} (₱${p.price})`).join('\n')}\n\n📞 Please contact support to update your plan.`;
            }

            // Check PayMongo availability
            const settings = await db.get('SELECT paymongoSettings FROM settings WHERE id = 1');
            let paymongoSettings = {};
            try {
                paymongoSettings = JSON.parse(settings?.paymongoSettings || '{}');
            } catch (_) {}

            const paymongoAvailable = paymongoSettings.enabled && paymongoSettings.secretKey;

            // Get company GCash settings
            const companySettings = await db.get('SELECT companySettings FROM settings WHERE id = 1');
            let companyInfo = {};
            try {
                companyInfo = JSON.parse(companySettings?.companySettings || '{}');
            } catch (_) {}

            let message = `💳 Payment Options\n━━━━━━━━━━━━━━━━━━\n\n👤 Account: ${customer.accountNumber}\n📛 Name: ${customer.fullName || 'N/A'}\n💰 Amount: ₱${planPrice.toFixed(2)}\n\nChoose your payment method:\n\n`;

            if (paymongoAvailable) {
                message += `1️⃣ ONLINE PAYMENT (PayMongo)\n   • GCash, PayMaya, Cards\n   • Automatic activation\n   • Send: PAY ONLINE\n\n`;
            }

            if (companyInfo.gcashNumber) {
                message += `2️⃣ MANUAL GCASH PAYMENT\n   • Send directly to our GCash\n   • Admin verification required\n   • Send: PAY MANUAL\n\n`;
            }

            if (!paymongoAvailable && !companyInfo.gcashNumber) {
                message += `⚠️ No payment methods available.\n\nPlease visit our office or contact support.\n\n📞 Support: [Your number]`;
                return message;
            }

            message += `💡 Reply with option number (1 or 2)`;

            return message;
        } catch (err) {
            console.error('[Facebook Bot] Payment options error:', err.message);
            return "❌ Sorry, an error occurred. Please try again later or contact support.";
        }
    }

    // ========================================
    // Handler: PAY ONLINE Command (PayMongo Integration)
    // ========================================
    async function handlePayOnlineCommand(senderId, routerId) {
        try {
            console.log(`[Facebook Bot] Online payment request from Facebook user: ${senderId} (router: ${routerId || 'ALL'})`);

            // Find customer by Facebook PSID - ROUTER SCOPED
            let customer;
            if (routerId) {
                customer = await db.get(
                    'SELECT * FROM customers WHERE facebook_psid = ? AND routerId = ?',
                    [senderId, routerId]
                );
            } else {
                customer = await db.get(
                    'SELECT * FROM customers WHERE facebook_psid = ?',
                    [senderId]
                );
            }

            if (!customer) {
                return `👋 Welcome! It looks like you haven't linked your account yet.\n\nTo make a payment, please register first:\n\n📝 Send: REGISTER <your_account_number>\nExample: REGISTER 20240001`;
            }

            // Check if PayMongo is configured
            const settings = await db.get('SELECT paymongoSettings FROM settings WHERE id = 1');
            let paymongoSettings = {};
            try {
                paymongoSettings = JSON.parse(settings?.paymongoSettings || '{}');
            } catch (_) {}

            if (!paymongoSettings.enabled || !paymongoSettings.secretKey) {
                return `⚠️ Online payment is currently unavailable.\n\nPlease try Manual GCash Payment instead or visit our office.`;
            }

            // Get customer's plan details
            const planName = customer.planName || 'Subscription';
            let planPrice = customer.planPrice || 0;

            // If planPrice is not in customer record, try to get it from billing_plans
            if (!planPrice || planPrice <= 0) {
                try {
                    // Try to find plan by name
                    if (customer.planName) {
                        const plan = await db.get(
                            'SELECT price FROM billing_plans WHERE name = ? LIMIT 1',
                            [customer.planName]
                        );
                        if (plan && plan.price) {
                            planPrice = plan.price;
                            console.log(`[Facebook Bot] Retrieved plan price from billing_plans: ₱${planPrice}`);
                        }
                    }
                    
                    // Fallback: try to get from planId if available
                    if (!planPrice && customer.planId) {
                        const plan = await db.get(
                            'SELECT price FROM billing_plans WHERE id = ? LIMIT 1',
                            [customer.planId]
                        );
                        if (plan && plan.price) {
                            planPrice = plan.price;
                            console.log(`[Facebook Bot] Retrieved plan price by ID: ₱${planPrice}`);
                        }
                    }
                } catch (err) {
                    console.warn('[Facebook Bot] Failed to lookup plan price:', err.message);
                }
            }

            if (!planPrice || planPrice <= 0) {
                return `⚠️ Unable to determine your plan price.\n\nYour account may not have a plan assigned yet.\n\n📞 Please contact our support for assistance.`;
            }

            // Calculate amount with convenience fee if enabled
            let totalAmount = planPrice;
            let feeDescription = '';
            
            if (paymongoSettings.passFeesToCustomer) {
                const fee = Math.ceil(planPrice * 0.025) + 15;
                totalAmount = planPrice + fee;
                feeDescription = `\n• Convenience Fee: ₱${fee.toFixed(2)}`;
            }

            // Generate invoice number
            const invoiceNo = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

            // Create PayMongo checkout session
            const checkoutData = {
                amount: totalAmount * 100,
                description: `${planName}|${customer.username || customer.accountNumber}`,
                pppoeUsername: customer.username || customer.accountNumber,
                planName: planName,
                successUrl: `${process.env.PANEL_URL || 'https://billing.ajcvendosystem.com'}/payment/success`,
                cancelUrl: `${process.env.PANEL_URL || 'https://billing.ajcvendosystem.com'}/payment/failed`,
                metadata: {
                    pppoe_username: customer.username || customer.accountNumber,
                    plan_name: planName,
                    invoice_no: invoiceNo,
                    router_id: customer.routerId || '',
                    duration_days: '30'
                }
            };

            console.log(`[Facebook Bot] Creating PayMongo checkout for ${customer.accountNumber}, amount: ₱${totalAmount}`);
            console.log(`[Facebook Bot] PayMongo settings paymentMethods:`, paymongoSettings.paymentMethods);
            console.log(`[Facebook Bot] PayMongo request payload:`, JSON.stringify({
                amount: Math.round(totalAmount * 100),
                description: checkoutData.description,
                payment_method_types: paymongoSettings.paymentMethods || ['qrph'],
                line_items: [{ name: planName, amount: Math.round(totalAmount * 100), quantity: 1 }]
            }, null, 2));

            console.log(`[Facebook Bot] === PAYMONGO DEBUG ===`);
            console.log(`[Facebook Bot] paymongoSettings.paymentMethods:`, paymongoSettings.paymentMethods);
            console.log(`[Facebook Bot] totalAmount:`, totalAmount);
            console.log(`[Facebook Bot] checkoutData.amount:`, checkoutData.amount);
            
            const payload = {
                data: {
                    attributes: {
                        description: checkoutData.description,
                        payment_method_types: paymongoSettings.paymentMethods || ['qrph'],
                        success_url: checkoutData.successUrl,
                        cancel_url: checkoutData.cancelUrl,
                        metadata: checkoutData.metadata,
                        line_items: [
                            {
                                name: planName,
                                amount: Math.round(totalAmount * 100),
                                quantity: 1,
                                currency: 'PHP'  // REQUIRED inside line_items!
                            }
                        ]
                    }
                }
            };
            
            console.log(`[Facebook Bot] ACTUAL PAYMONGO PAYLOAD:`, JSON.stringify(payload, null, 2));
            console.log(`[Facebook Bot] line_items[0] keys:`, Object.keys(payload.data.attributes.line_items[0]));
            console.log(`[Facebook Bot] === END DEBUG ===`);

            const response = await require('axios').post(
                'https://api.paymongo.com/v1/checkout_sessions',
                payload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Basic ${Buffer.from(paymongoSettings.secretKey + ':').toString('base64')}`
                    },
                    timeout: 30000
                }
            );

            const checkoutSession = response.data?.data;
            if (!checkoutSession || !checkoutSession.attributes?.checkout_url) {
                throw new Error('PayMongo did not return a checkout URL');
            }

            const checkoutUrl = checkoutSession.attributes.checkout_url;
            const sessionId = checkoutSession.id;

            // Store session in DB for tracking
            try {
                await db.run(
                    'INSERT OR IGNORE INTO paymongo_sessions (session_id, invoice_no, pppoe_username, router_id, plan_name, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [sessionId, invoiceNo, customer.username || customer.accountNumber, customer.routerId || '', planName, totalAmount, 'pending', new Date().toISOString()]
                );
            } catch (dbErr) {
                console.warn('[Facebook Bot] Failed to store payment session:', dbErr.message);
            }

            console.log(`[Facebook Bot] Payment link created for ${customer.accountNumber}: ${checkoutUrl}`);

            // Format payment message
            const paymentMessage = `💳 Payment Request\n━━━━━━━━━━━━━━━━━━\n\n👤 Account Details:\n• Name: ${customer.fullName || 'Valued Customer'}\n• Account #: ${customer.accountNumber}\n• Plan: ${planName}\n\n💰 Payment Details:\n• Plan Price: ₱${planPrice.toFixed(2)}${feeDescription}\n• Total Amount: ₱${totalAmount.toFixed(2)}\n• Invoice #: ${invoiceNo}\n\n━━━━━━━━━━━━━━━━━━\n\n🔗 Click the link below to pay:\n${checkoutUrl}\n\n━━━━━━━━━━━━━━━━━━\n\n✅ Payment Methods:\n• GCash\n• PayMaya\n• GrabPay\n• Credit/Debit Card\n\n⏱️ Link expires in 24 hours.\n\n💡 After payment, your account will be activated automatically within 5 minutes.\n\n📞 Need help? Contact our support team.`;

            return paymentMessage;
        } catch (err) {
            console.error('[Facebook Bot] Payment creation error:', err.message);
            if (err.response) {
                console.error('[Facebook Bot] PayMongo error response status:', err.response.status);
                console.error('[Facebook Bot] PayMongo error response data:', JSON.stringify(err.response.data, null, 2));
            }
            return "❌ Sorry, an error occurred while creating your payment link. Please try again later or contact our support team.";
        }
    }

    // ========================================
    // Manual Payment Session Store (In-Memory)
    // ========================================
    const pendingManualPayments = new Map();

    // ========================================
    // Handler: PAY MANUAL Command - Multi-Step Collection
    // ========================================
    async function handlePayManualCommand(senderId, routerId) {
        try {
            console.log(`[Facebook Bot] Manual payment request from Facebook user: ${senderId} (router: ${routerId || 'ALL'})`);

            // Find customer by Facebook PSID - ROUTER SCOPED
            let customer;
            if (routerId) {
                customer = await db.get(
                    'SELECT * FROM customers WHERE facebook_psid = ? AND routerId = ?',
                    [senderId, routerId]
                );
            } else {
                customer = await db.get(
                    'SELECT * FROM customers WHERE facebook_psid = ?',
                    [senderId]
                );
            }

            if (!customer) {
                return `👋 Welcome! It looks like you haven't linked your account yet.\n\nTo make a payment, please register first:\n\n📝 Send: REGISTER <your_account_number>\nExample: REGISTER 20240001`;
            }

            // Get plan details
            const planName = customer.planName || 'Subscription';
            let planPrice = customer.planPrice || 0;
            
            // If planPrice is not in customer record, try to get it from billing_plans
            if (!planPrice || planPrice <= 0) {
                try {
                    // Try to find plan by name
                    if (customer.planName) {
                        const plan = await db.get(
                            'SELECT price FROM billing_plans WHERE name = ? LIMIT 1',
                            [customer.planName]
                        );
                        if (plan && plan.price) {
                            planPrice = plan.price;
                            console.log(`[Facebook Bot] Retrieved plan price from billing_plans: ₱${planPrice}`);
                        }
                    }
                    
                    // Fallback: try to get from planId if available
                    if (!planPrice && customer.planId) {
                        const plan = await db.get(
                            'SELECT price FROM billing_plans WHERE id = ? LIMIT 1',
                            [customer.planId]
                        );
                        if (plan && plan.price) {
                            planPrice = plan.price;
                            console.log(`[Facebook Bot] Retrieved plan price by ID: ₱${planPrice}`);
                        }
                    }
                } catch (err) {
                    console.warn('[Facebook Bot] Failed to lookup plan price:', err.message);
                }
            }

            if (!planPrice || planPrice <= 0) {
                return `⚠️ Unable to determine your plan price.\n\nYour account may not have a plan assigned yet.\n\n📞 Please contact our support for assistance.`;
            }

            // Get company GCash settings
            const companySettings = await db.get('SELECT companySettings FROM settings WHERE id = 1');
            let companyInfo = {};
            try {
                companyInfo = JSON.parse(companySettings?.companySettings || '{}');
            } catch (_) {}

            if (!companyInfo.gcashNumber) {
                return `⚠️ Manual GCash payment is currently unavailable.\n\nPlease try Online Payment or visit our office.`;
            }

            // Initialize payment session
            pendingManualPayments.set(senderId, {
                step: 'awaiting_reference',
                customerAccountNumber: customer.accountNumber,
                customerUsername: customer.username,
                customerFullName: customer.fullName,
                customerFacebookPsid: senderId,
                customerRouterId: customer.routerId,
                planName: planName,
                planPrice: planPrice,
                createdAt: Date.now()
            });

            const message = `📱 Manual GCash Payment\n━━━━━━━━━━━━━━━━━━\n\n💰 Amount to Pay: ₱${planPrice.toFixed(2)}\n\n📲 Send payment to our GCash:\nGCash Number: ${companyInfo.gcashNumber}\nName: ${companyInfo.gcashAccountName || companyInfo.companyName || 'N/A'}\n\nAfter sending payment, please provide:\n\n1️⃣ GCash Reference Number\n2️⃣ Your mobile number\n3️⃣ Name on your GCash account\n\n📝 Reply with your GCash Reference Number:\n(Example: 1234567890)`;

            return message;
        } catch (err) {
            console.error('[Facebook Bot] Manual payment initiation error:', err.message);
            return "❌ Sorry, an error occurred. Please try again later or contact support.";
        }
    }

    // ========================================
    // Handler: Process Manual Payment Steps
    // ========================================
    async function processManualPaymentSteps(senderId, userMessage) {
        try {
            const session = pendingManualPayments.get(senderId);
            
            if (!session) return null; // Not in manual payment flow

            // Check if session expired (5 minutes)
            if (Date.now() - session.createdAt > 5 * 60 * 1000) {
                pendingManualPayments.delete(senderId);
                return "⏱️ Payment session expired. Please send PAY to start again.";
            }

            if (session.step === 'awaiting_reference') {
                session.gcashReference = userMessage.trim();
                session.step = 'awaiting_mobile';
                pendingManualPayments.set(senderId, session);
                
                return `✅ Reference number received.\n\n📱 Now, please send your mobile number:\n(Example: 09171234567)`;
            }

            if (session.step === 'awaiting_mobile') {
                session.mobileNumber = userMessage.trim();
                session.step = 'awaiting_name';
                pendingManualPayments.set(senderId, session);
                
                return `✅ Mobile number received.\n\n👤 Finally, please send the name on your GCash account:\n(Example: Juan Dela Cruz)`;
            }

            if (session.step === 'awaiting_name') {
                session.gcashName = userMessage.trim();
                
                // Create manual payment request in database
                const paymentId = `manual_pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const now = new Date().toISOString();
                
                await db.run(
                    'INSERT INTO manual_payment_requests (id, customer_account_number, customer_username, customer_full_name, customer_facebook_psid, customer_router_id, plan_name, plan_price, gcash_reference_number, customer_mobile_number, customer_name_on_gcash, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                    [paymentId, session.customerAccountNumber, session.customerUsername, session.customerFullName, session.customerFacebookPsid, session.customerRouterId, session.planName, session.planPrice, session.gcashReference, session.mobileNumber, session.gcashName, 'pending', now, now]
                );

                console.log(`[Facebook Bot] Manual payment request created: ${paymentId} for account ${session.customerAccountNumber}`);
                
                // Clear session
                pendingManualPayments.delete(senderId);
                
                // Extract short payment number
                const paymentNumber = paymentId.split('_')[2].toUpperCase();
                
                // Send confirmation
                return `✅ Manual Payment Request Submitted!\n━━━━━━━━━━━━━━━━━━\n\n🎫 Request #: ${paymentNumber}\n💰 Amount: ₱${session.planPrice.toFixed(2)}\n📱 GCash Ref: ${session.gcashReference}\n📱 Mobile: ${session.mobileNumber}\n👤 GCash Name: ${session.gcashName}\n\n⏱️ Status: Pending Verification\n\n📋 What's Next?\n• Our admin will verify your payment\n• You'll receive confirmation via Messenger\n• Verification time: 5-30 minutes\n\n💡 Keep your GCash receipt for reference.\n\n📞 Questions? Contact our support.`;
            }

            return null;
        } catch (err) {
            console.error('[Facebook Bot] Manual payment step processing error:', err.message);
            pendingManualPayments.delete(senderId);
            return "❌ Sorry, an error occurred. Please send PAY to start again or contact support.";
        }
    }

    // ========================================
    // Handler: REPAIR TICKET Command
    // ========================================
    async function handleRepairTicketCommand(senderId, userMessage) {
        try {
            console.log(`[Facebook Bot] Repair ticket request from Facebook user: ${senderId}`);

            // Find customer by Facebook PSID
            const customer = await db.get(
                'SELECT * FROM customers WHERE facebook_psid = ?',
                [senderId]
            );

            if (!customer) {
                return `👋 Welcome! It looks like you haven't linked your account yet.\n\nTo create a repair ticket, please register first:\n\n📝 Send: REGISTER <your_account_number>\nExample: REGISTER 20240001\n\nOnce registered, you can report internet issues via Facebook Messenger.`;
            }

            // Customer found - parse the issue description
            const upperMessage = userMessage.toUpperCase();
            let category = 'other';
            let description = '';

            // Extract category and description from message
            if (upperMessage.includes('NO INTERNET') || upperMessage.includes('NOT CONNECTED') || upperMessage.includes('OFFLINE')) {
                category = 'no_internet';
                description = userMessage;
            } else if (upperMessage.includes('SLOW') || upperMessage.includes('LAG') || upperMessage.includes('BUFFERING')) {
                category = 'slow_connection';
                description = userMessage;
            } else if (upperMessage.includes('INTERMITTENT') || upperMessage.includes('CUTS') || upperMessage.includes('KEEPS DISCONNECTING')) {
                category = 'intermittent';
                description = userMessage;
            } else if (upperMessage.includes('LINE') || upperMessage.includes('CABLE') || upperMessage.includes('WIRE')) {
                category = 'line_issue';
                description = userMessage;
            } else {
                // Check if user provided a description after the command keyword
                const parts = userMessage.split(/\s+/);
                // Remove command words (REPAIR, TICKET, etc.)
                const commandWords = ['REPAIR', 'TICKET', 'HELP', 'ME', 'ISSUE', 'PROBLEM', 'NO', 'INTERNET'];
                const descriptionParts = parts.filter(word => !commandWords.includes(word.toUpperCase()));
                
                if (descriptionParts.length > 0) {
                    description = descriptionParts.join(' ');
                    category = 'other';
                } else {
                    // No description provided - ask for it
                    return `🔧 Repair Ticket - Describe Your Issue\n━━━━━━━━━━━━━━━━━━\n\n👤 Account: ${customer.accountNumber}\n📛 Name: ${customer.fullName || 'N/A'}\n\n📝 Please describe your internet problem in detail.\n\nExamples:\n• "My internet is not working since this morning"\n• "Connection is very slow, can't browse"\n• "Internet keeps disconnecting every few minutes"\n• "I think there's a problem with the line/cable"\n\n💡 Common Issues:\n• No Internet - Complete loss of connection\n• Slow Connection - Internet is working but very slow\n• Intermittent - Connection keeps dropping\n• Line Issue - Physical cable/line problem\n\n📞 For urgent issues, please call our support hotline.`;
                }
            }

            // Create repair ticket
            const ticketId = `ticket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const now = new Date().toISOString();
            
            await db.run(
                'INSERT INTO repair_tickets (id, client_user_id, username, client_type, category, description, priority, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
                [ticketId, null, customer.username || customer.accountNumber, 'pppoe', category, description, 'normal', 'client', now, now]
            );

            console.log(`[Facebook Bot] Repair ticket created: ${ticketId} for account ${customer.accountNumber}`);

            // Category display names
            const categoryNames = {
                'no_internet': '🔴 No Internet',
                'slow_connection': '🟡 Slow Connection',
                'intermittent': '🟠 Intermittent Connection',
                'line_issue': '🔵 Line/Cable Issue',
                'other': '⚪ Other Issue'
            };

            const categoryName = categoryNames[category] || '⚪ Other Issue';

            // Extract ticket number (short version)
            const ticketNumber = ticketId.split('_')[1];

            return `✅ Repair Ticket Created Successfully!\n━━━━━━━━━━━━━━━━━━\n\n🎫 Ticket Details:\n• Ticket #: ${ticketNumber}\n• Account: ${customer.accountNumber}\n• Name: ${customer.fullName || 'N/A'}\n• Category: ${categoryName}\n• Status: 🟢 Open\n• Priority: Normal\n\n📝 Issue Description:\n${description}\n\n━━━━━━━━━━━━━━━━━━\n\n⏱️ What's Next?\n• Our technical team will review your ticket\n• You'll receive updates via this messenger\n• Typical response time: 1-4 hours\n\n📞 For urgent emergencies, please call our support hotline.\n\n💡 You can check your ticket status anytime by sending: STATUS`;
        } catch (err) {
            console.error('[Facebook Bot] Repair ticket creation error:', err.message);
            return "❌ Sorry, an error occurred while creating your repair ticket. Please try again later or contact our support team directly.";
        }
    }

    // ========================================
    // Handler: TICKET STATUS Command
    // ========================================
    async function handleTicketStatusCommand(senderId) {
        try {
            console.log(`[Facebook Bot] Ticket status request from Facebook user: ${senderId}`);

            // Find customer by Facebook PSID
            const customer = await db.get(
                'SELECT * FROM customers WHERE facebook_psid = ?',
                [senderId]
            );

            if (!customer) {
                return `👋 Welcome! It looks like you haven't linked your account yet.\n\nTo check your ticket status, please register first:\n\n📝 Send: REGISTER <your_account_number>\nExample: REGISTER 20240001\n\nOnce registered, you can track your repair tickets via Facebook Messenger.`;
            }

            // Get all tickets for this customer (by PPPoE username)
            const tickets = await db.all(
                'SELECT * FROM repair_tickets WHERE username = ? ORDER BY created_at DESC LIMIT 5',
                [customer.username || customer.accountNumber]
            );

            if (!tickets || tickets.length === 0) {
                return `📋 Ticket Status\n━━━━━━━━━━━━━━━━━━\n\nYou don't have any repair tickets yet.\n\n🔧 To report an issue, send:\nREPAIR <your issue description>\n\nExample: REPAIR My internet is not working\n\n━━━━━━━━━━━━━━━━━━\n\n📞 Need help? Contact our support team.`;
            }

            // Format ticket list
            let message = `📋 Your Recent Tickets\n━━━━━━━━━━━━━━━━━━\n\n👤 Account: ${customer.accountNumber}\n📛 Name: ${customer.fullName || 'N/A'}\n\n`;

            tickets.forEach((ticket, index) => {
                const ticketNumber = ticket.id.split('_')[1];
                
                // Status icons
                const statusIcons = {
                    'open': '🟢',
                    'in_progress': '🔵',
                    'resolved': '✅',
                    'closed': '⚫'
                };
                
                // Priority icons
                const priorityIcons = {
                    'low': '🟢',
                    'normal': '🟡',
                    'high': '🟠',
                    'urgent': '🔴'
                };

                // Category display
                const categoryNames = {
                    'no_internet': 'No Internet',
                    'slow_connection': 'Slow Connection',
                    'intermittent': 'Intermittent',
                    'line_issue': 'Line Issue',
                    'other': 'Other'
                };

                const statusIcon = statusIcons[ticket.status] || '⚪';
                const priorityIcon = priorityIcons[ticket.priority] || '🟡';
                const categoryName = categoryNames[ticket.category] || ticket.category;

                // Format dates
                const createdDate = new Date(ticket.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });

                message += `${index + 1}️⃣ Ticket #${ticketNumber}\n`;
                message += `${statusIcon} Status: ${ticket.status.replace('_', ' ').toUpperCase()}\n`;
                message += `${priorityIcon} Priority: ${ticket.priority.toUpperCase()}\n`;
                message += `📂 Category: ${categoryName}\n`;
                message += `📝 Issue: ${ticket.description.substring(0, 50)}${ticket.description.length > 50 ? '...' : ''}\n`;
                message += `📅 Created: ${createdDate}\n`;
                
                if (ticket.admin_notes) {
                    message += `💬 Admin Note: ${ticket.admin_notes.substring(0, 50)}${ticket.admin_notes.length > 50 ? '...' : ''}\n`;
                }
                
                if (ticket.assigned_to) {
                    message += `👨‍🔧 Assigned to: ${ticket.assigned_to}\n`;
                }
                
                message += `\n`;
            });

            message += `━━━━━━━━━━━━━━━━━━\n\n💡 Need updates?\n• Our team will notify you via Messenger\n• Or send TICKET STATUS anytime\n\n📞 For urgent issues, call our support hotline.`;

            return message;
        } catch (err) {
            console.error('[Facebook Bot] Ticket status error:', err.message);
            return "❌ Sorry, an error occurred while retrieving your ticket status. Please try again later or contact support.";
        }
    }

    // ========================================
    // Helper: Help Message
    // ========================================
    function getHelpMessage() {
        return `🤖 CityConnect Billing Bot - Help Menu\n━━━━━━━━━━━━━━━━━━\n\n📝 Available Commands:\n\n1️⃣ REGISTER <account_no>\n   Link your Facebook to your account\n   Example: REGISTER 20240001\n\n2️⃣ BILL / BALANCE / STATUS\n   View your billing details & status\n\n3️⃣ PAY / PAYMENT / BAYAD\n   Choose payment method (Online or Manual)\n   • PAY ONLINE - PayMongo (Auto-activate)\n   • PAY MANUAL - GCash (Admin verify)\n\n4️⃣ REPAIR / TICKET\n   Report internet issues & create support ticket\n   Example: REPAIR My internet is not working\n\n5️⃣ TICKET STATUS / TICKETS\n   Check your repair ticket status\n   Shows recent tickets & updates\n\n6️⃣ HELP / MENU\n   Show this help message\n\n━━━━━━━━━━━━━━━━━━\n\n💡 Quick Start:\nSend: REGISTER <your_account_number>\n\n💳 Payment Commands:\n• PAY - Choose payment method\n• PAY ONLINE - Pay via PayMongo (GCash, Cards)\n• PAY MANUAL - Pay via GCash manual transfer\n• BAYAD - Filipino term for payment\n\n🔧 Ticket Commands:\n• TICKET STATUS - View your tickets\n• TICKETS - Same as TICKET STATUS\n• REPAIR - Report an issue\n• NO INTERNET - Complete loss of connection\n• SLOW - Internet is very slow\n• INTERMITTENT - Connection keeps dropping\n\n📞 Need assistance? Contact our support team or visit our office.\n\n🌐 Powered by CityConnect Billing Manager`;
    }

    // Helper function to send messages via Facebook Graph API
    async function sendFacebookMessage(recipientId, messageText, pageAccessToken) {
        try {
            console.log('[Facebook Webhook] Sending message to:', recipientId);
            console.log('[Facebook Webhook] Token starts with:', pageAccessToken?.substring(0, 10) + '...');
            
            const response = await axios.post(
                'https://graph.facebook.com/v18.0/me/messages',
                {
                    recipient: { id: recipientId },
                    message: { text: messageText },
                    messaging_type: 'RESPONSE'
                },
                {
                    params: { access_token: pageAccessToken },
                    timeout: 10000
                }
            );
            console.log('[Facebook Webhook] Message sent successfully:', response.data);
            return response.data;
        } catch (err) {
            console.error('[Facebook Webhook] Send message error:', err.message);
            if (err.response) {
                console.error('[Facebook Webhook] Response status:', err.response.status);
                console.error('[Facebook Webhook] Response data:', JSON.stringify(err.response.data, null, 2));
            }
            throw err;
        }
    }

    // Endpoint to test Facebook connection
    app.post('/api/facebook-test', protect, async (req, res) => {
        try {
            const { pageAccessToken, recipientId } = req.body;
            
            if (!pageAccessToken) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Page Access Token is required. Please enter it in the Messenger settings.' 
                });
            }
            
            // Validate token format
            const tokenFormatValid = pageAccessToken.startsWith('EAAG') || pageAccessToken.startsWith('EAA');
            const tokenLengthValid = pageAccessToken.length >= 50;
            
            console.log('[Facebook Test] Validating token...');
            console.log('[Facebook Test] Token starts with:', pageAccessToken.substring(0, 10) + '...');
            console.log('[Facebook Test] Token length:', pageAccessToken.length);
            console.log('[Facebook Test] Token format valid:', tokenFormatValid);
            console.log('[Facebook Test] Token length valid:', tokenLengthValid);

            if (!tokenFormatValid) {
                return res.status(400).json({
                    success: false,
                    message: '❌ Invalid token format. Access tokens should start with "EAAG" or "EAA". Please generate a new token from Facebook Developers Console.'
                });
            }

            if (!tokenLengthValid) {
                return res.status(400).json({
                    success: false,
                    message: '❌ Token seems too short. Valid tokens are usually 150+ characters. Please check your token.'
                });
            }

            // Token format looks good
            res.json({ 
                success: true, 
                message: `✅ Token format is valid!\n\nToken starts with: ${pageAccessToken.substring(0, 15)}...\nToken length: ${pageAccessToken.length} characters\n\nYour Facebook Messenger bot is configured. When users message your Page, the webhook at /api/facebook-webhook will receive their messages.\n\nNote: Facebook requires users to message your Page first before you can reply (24-hour messaging window).`
            });
        } catch (err) {
            console.error('[Facebook Test] Error:', err.message);
            
            let errorMessage = err.message;
            if (err.response?.data?.error) {
                // Extract Facebook's detailed error message
                const fbError = err.response.data.error;
                errorMessage = `Facebook API Error: ${fbError.message || 'Unknown error'} (Code: ${fbError.code || 'N/A'})`;
                
                if (fbError.fbtrace_id) {
                    errorMessage += `\nTrace ID: ${fbError.fbtrace_id}`;
                }
                
                // Provide helpful hints based on error code
                if (fbError.code === 190) {
                    errorMessage += '\n\n💡 Hint: Your access token is invalid or expired. Generate a new one from Facebook Developers Console.';
                } else if (fbError.code === 200) {
                    errorMessage += '\n\n💡 Hint: Permission denied. Make sure your app has these permissions:\n  • pages_messaging\n  • pages_manage_metadata\n  • pages_read_engagement';
                }
            }
            
            res.status(500).json({ 
                success: false, 
                message: errorMessage 
            });
        }
    });

    // Endpoint to validate Facebook configuration
    app.get('/api/facebook-validate', protect, async (req, res) => {
        try {
            const settings = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
            let fbSettings = {};
            try {
                fbSettings = JSON.parse(settings?.facebookSettings || '{}');
            } catch (_) {}

            const issues = [];
            const warnings = [];

            // Check enabled status
            if (!fbSettings.enabled) {
                issues.push('Facebook Messenger is not enabled');
            }

            // Check Page ID
            if (!fbSettings.pageId) {
                issues.push('Page ID is missing');
            } else if (isNaN(fbSettings.pageId)) {
                warnings.push('Page ID should be a numeric value');
            }

            // Check Access Token
            if (!fbSettings.pageAccessToken) {
                issues.push('Page Access Token is missing');
            } else if (fbSettings.pageAccessToken.length < 50) {
                warnings.push('Access Token seems too short (may be invalid)');
            } else if (!fbSettings.pageAccessToken.startsWith('EAAG') && !fbSettings.pageAccessToken.startsWith('EAA')) {
                warnings.push('Access Token format looks unusual (should start with EAAG or EAA)');
            }

            // Check Verify Token
            if (!fbSettings.verifyToken) {
                warnings.push('Verify Token is not set (needed for webhook verification)');
            } else if (fbSettings.verifyToken.length < 10) {
                warnings.push('Verify Token is too short (use at least 16 characters)');
            }

            const isValid = issues.length === 0;
            res.json({
                valid: isValid,
                issues,
                warnings,
                config: {
                    enabled: fbSettings.enabled || false,
                    hasPageId: !!fbSettings.pageId,
                    hasToken: !!fbSettings.pageAccessToken,
                    hasVerifyToken: !!fbSettings.verifyToken,
                    tokenLength: fbSettings.pageAccessToken?.length || 0
                }
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });


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
                    
                    // Sync to Supabase
                    const updatedCustomer = await db.get('SELECT * FROM customers WHERE routerId = ? AND username = ?', [user.router_id, user.pppoe_username || user.username]);
                    await syncCustomerToSupabase(updatedCustomer);
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


    // --- Repair Tickets (Admin - Protected) ---
    app.get('/api/repair-tickets', protect, async (req, res) => {
        try {
            const { status, priority, client_type } = req.query;
            let query = 'SELECT * FROM repair_tickets WHERE 1=1';
            const params = [];
            if (status) { query += ' AND status = ?'; params.push(status); }
            if (priority) { query += ' AND priority = ?'; params.push(priority); }
            if (client_type) { query += ' AND client_type = ?'; params.push(client_type); }
            query += ' ORDER BY created_at DESC';
            const tickets = await db.all(query, params);
            res.json(tickets);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    app.post('/api/repair-tickets', protect, async (req, res) => {
        const { username, client_user_id, client_type, category, description, priority } = req.body;
        if (!username || !category) return res.status(400).json({ message: 'Username and category are required' });
        try {
            const id = `ticket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const now = new Date().toISOString();
            await db.run(
                'INSERT INTO repair_tickets (id, client_user_id, username, client_type, category, description, priority, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
                [id, client_user_id || null, username, client_type || 'pppoe', category, description || '', priority || 'normal', 'admin', now, now]
            );
            res.json({ message: 'Ticket created', id });
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    app.put('/api/repair-tickets/:id', protect, async (req, res) => {
        const { status, priority, admin_notes, assigned_to } = req.body;
        try {
            const ticket = await db.get('SELECT * FROM repair_tickets WHERE id = ?', [req.params.id]);
            if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
            const now = new Date().toISOString();
            const resolved_at = status === 'resolved' ? now : ticket.resolved_at;
            
            // Check if status is changing
            const statusChanged = status && status !== ticket.status;
            const oldStatus = ticket.status;
            
            await db.run(
                'UPDATE repair_tickets SET status = ?, priority = ?, admin_notes = ?, assigned_to = ?, resolved_at = ?, updated_at = ? WHERE id = ?',
                [status || ticket.status, priority || ticket.priority, admin_notes ?? ticket.admin_notes, assigned_to ?? ticket.assigned_to, resolved_at, now, req.params.id]
            );
            
            // Send Facebook notification to customer if ticket was created by Facebook user
            if (statusChanged) {
                try {
                    // Find customer by PPPoE username
                    const customer = await db.get(
                        'SELECT facebook_psid FROM customers WHERE username = ? OR accountNumber = ?',
                        [ticket.username, ticket.username]
                    );
                    
                    if (customer && customer.facebook_psid) {
                        // Get Facebook settings
                        const fbSettings = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
                        let fbConfig = {};
                        try {
                            fbConfig = JSON.parse(fbSettings?.facebookSettings || '{}');
                        } catch (_) {}
                        
                        if (fbConfig.enabled && fbConfig.pageAccessToken) {
                            // Build notification message
                            const statusIcons = {
                                'open': '🟢',
                                'in_progress': '🔵',
                                'resolved': '✅',
                                'closed': '⚫'
                            };
                            
                            const statusIcon = statusIcons[status] || '⚪';
                            const ticketNumber = ticket.id.split('_')[1];
                            
                            let notificationMessage = `${statusIcon} Ticket Update\n━━━━━━━━━━━━━━━━━━\n\n🎫 Ticket #${ticketNumber}\n\n`;
                            notificationMessage += `📊 Status Changed:\n`;
                            notificationMessage += `From: ${oldStatus.replace('_', ' ').toUpperCase()}\n`;
                            notificationMessage += `To: ${status.replace('_', ' ').toUpperCase()}\n\n`;
                            
                            if (admin_notes) {
                                notificationMessage += `💬 Admin Note:\n${admin_notes}\n\n`;
                            }
                            
                            if (assigned_to) {
                                notificationMessage += `👨‍🔧 Assigned to: ${assigned_to}\n\n`;
                            }
                            
                            notificationMessage += `━━━━━━━━━━━━━━━━━━\n\n`;
                            
                            if (status === 'resolved') {
                                notificationMessage += `✅ Your issue has been resolved!\n`;
                                notificationMessage += `If you're still experiencing problems, please contact us.\n\n`;
                            } else if (status === 'in_progress') {
                                notificationMessage += `🔧 Our team is working on your issue.\n`;
                                notificationMessage += `We'll update you once it's resolved.\n\n`;
                            }
                            
                            notificationMessage += `📞 Need help? Contact our support team.`;
                            
                            // Send notification via Facebook
                            await sendFacebookMessage(customer.facebook_psid, notificationMessage, fbConfig.pageAccessToken);
                            console.log(`[Repair Ticket] Facebook notification sent to ${ticket.username} for ticket #${ticketNumber}`);
                        }
                    }
                } catch (fbErr) {
                    console.error('[Repair Ticket] Failed to send Facebook notification:', fbErr.message);
                    // Don't fail the update if notification fails
                }
            }
            
            res.json({ message: 'Ticket updated' });
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    app.delete('/api/repair-tickets/:id', protect, async (req, res) => {
        try {
            await db.run('DELETE FROM repair_tickets WHERE id = ?', [req.params.id]);
            res.json({ message: 'Ticket deleted' });
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // --- Repair Tickets (Public - Client Portal) ---
    app.post('/api/public/client-portal/tickets', async (req, res) => {
        const { username, client_user_id, client_type, category, description } = req.body;
        if (!username || !category) return res.status(400).json({ message: 'Username and category are required' });
        try {
            const id = `ticket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const now = new Date().toISOString();
            await db.run(
                'INSERT INTO repair_tickets (id, client_user_id, username, client_type, category, description, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
                [id, client_user_id || null, username, client_type || 'pppoe', category, description || '', 'client', now, now]
            );
            res.json({ message: 'Ticket submitted successfully', id });
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    app.get('/api/public/client-portal/tickets', async (req, res) => {
        const { username } = req.query;
        if (!username) return res.status(400).json({ message: 'Username is required' });
        try {
            const tickets = await db.all('SELECT * FROM repair_tickets WHERE username = ? ORDER BY created_at DESC', [username]);
            res.json(tickets);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // --- Fetch All PPPoE Secrets from All Routers (for Repair Ticket creation) ---
    app.get('/api/pppoe-clients', protect, async (req, res) => {
        try {
            const routers = await db.all('SELECT id, name FROM routers');
            const allClients = [];
            
            for (const router of routers) {
                try {
                    const secretsResp = await axios.get(`http://localhost:3002/${router.id}/ppp/secret/print`, { timeout: 15000 });
                    const secrets = Array.isArray(secretsResp.data) ? secretsResp.data : [];
                    
                    for (const secret of secrets) {
                        if (secret.name) {
                            let planName = '';
                            let dueDate = '';
                            try {
                                const commentData = JSON.parse(String(secret.comment || '{}'));
                                planName = commentData.planName || commentData.plan || secret.profile || '';
                                dueDate = commentData.due || '';
                            } catch (_) {
                                planName = secret.profile || '';
                            }
                            
                            allClients.push({
                                id: `pppoe_${router.id}_${secret.name}`,
                                username: secret.name,
                                pppoe_username: secret.name,
                                router_id: router.id,
                                router_name: router.name,
                                profile: secret.profile || '',
                                plan_name: planName,
                                due_date: dueDate,
                                client_type: 'pppoe'
                            });
                        }
                    }
                } catch (err) {
                    console.error(`[PPPoE Clients] Failed to fetch from router ${router.name}:`, err.message);
                }
            }
            
            res.json(allClients);
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    // --- License ---
    const licenseRouter = express.Router();
    licenseRouter.use(protect);
    
    licenseRouter.get('/status', async (req, res) => {
        const LICENSE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

        try {
            const deviceId = await getDeviceId();
            const settings = await db.get('SELECT licenseKey, licenseCache, licenseCacheAt FROM settings WHERE id = 1');
            const localLicenseKey = settings?.licenseKey;

            // --- Serve from cache if fresh ---
            if (settings?.licenseCache && settings?.licenseCacheAt) {
                const cacheAge = Date.now() - new Date(settings.licenseCacheAt).getTime();
                if (cacheAge < LICENSE_CACHE_TTL_MS) {
                    try {
                        const cached = JSON.parse(settings.licenseCache);
                        return res.json(cached);
                    } catch (_) { /* corrupt cache, fall through to re-validate */ }
                }
            }

            // --- No local license key: check Supabase by hardware ID ---
            if (!localLicenseKey) {
                const { data: existingLicense, error: existingError } = await supabase
                    .from('mikrotik_licenses')
                    .select('*')
                    .eq('hardware_id', deviceId)
                    .eq('is_active', true)
                    .maybeSingle();

                if (!existingError && existingLicense) {
                    await db.run('UPDATE settings SET licenseKey = ? WHERE id = 1', [existingLicense.license_key]);
                    await supabase
                        .from('mikrotik_licenses')
                        .update({ last_check_in: new Date().toISOString() })
                        .eq('id', existingLicense.id);

                    const result = { 
                        licensed: true, 
                        expires: existingLicense.expires_at, 
                        deviceId, 
                        licenseKey: existingLicense.license_key,
                        plan: existingLicense.plan_type,
                        maxRouters: existingLicense.max_routers,
                        message: 'License restored from server after system reset.'
                    };
                    await db.run('UPDATE settings SET licenseCache = ?, licenseCacheAt = ? WHERE id = 1',
                        [JSON.stringify(result), new Date().toISOString()]);
                    return res.json(result);
                }

                const result = { licensed: false, deviceId, message: 'No license key found locally.' };
                // Cache negative result for a shorter time (30 seconds) to avoid hammering Supabase
                await db.run('UPDATE settings SET licenseCache = ?, licenseCacheAt = ? WHERE id = 1',
                    [JSON.stringify(result), new Date(Date.now() - LICENSE_CACHE_TTL_MS + 30000).toISOString()]);
                return res.json(result);
            }

            // --- Verify license key with Supabase ---
            const { data: license, error } = await supabase
                .from('mikrotik_licenses')
                .select('*')
                .eq('license_key', localLicenseKey)
                .maybeSingle();

            if (error || !license) {
                const result = { licensed: false, deviceId, message: 'License key not found in server.' };
                await db.run('UPDATE settings SET licenseCache = ?, licenseCacheAt = ? WHERE id = 1',
                    [JSON.stringify(result), new Date(Date.now() - LICENSE_CACHE_TTL_MS + 30000).toISOString()]);
                return res.json(result);
            }

            if (license.hardware_id && license.hardware_id !== deviceId) {
                // --- Self-healing migration ---
                // The old getDeviceId() included cpu.speed which fluctuates.
                // If the stored Supabase hardware_id matches the OLD formula for this machine,
                // automatically migrate it to the new stable ID so the user isn't locked out.
                let migrated = false;
                try {
                    const cpu = await si.cpu();
                    if (cpu && cpu.brand && cpu.speed && cpu.cores) {
                        const oldRawId = `${cpu.brand}-${cpu.speed}-${cpu.cores}-${cpu.physicalCores || cpu.cores}`;
                        const oldDeviceId = crypto.createHash('sha256').update(oldRawId).digest('hex');
                        if (license.hardware_id === oldDeviceId) {
                            // This IS the same machine — migrate the hardware_id to the new stable value
                            await supabase
                                .from('mikrotik_licenses')
                                .update({ hardware_id: deviceId })
                                .eq('id', license.id);
                            // Also clear the license cache so next check re-validates cleanly
                            await db.run('UPDATE settings SET licenseCache = NULL, licenseCacheAt = NULL WHERE id = 1');
                            console.log('[License] Migrated hardware_id from speed-based to stable ID');
                            migrated = true;
                        }
                    }
                } catch (migErr) {
                    console.warn('[License] Migration check failed:', migErr.message);
                }

                if (!migrated) {
                    const result = { licensed: false, deviceId, message: 'License is bound to another device.' };
                    await db.run('UPDATE settings SET licenseCache = ?, licenseCacheAt = ? WHERE id = 1',
                        [JSON.stringify(result), new Date(Date.now() - LICENSE_CACHE_TTL_MS + 30000).toISOString()]);
                    return res.json(result);
                }
            }

            if (!license.is_active) {
                const result = { licensed: false, deviceId, message: 'License has been deactivated.' };
                await db.run('UPDATE settings SET licenseCache = ?, licenseCacheAt = ? WHERE id = 1',
                    [JSON.stringify(result), new Date(Date.now() - LICENSE_CACHE_TTL_MS + 30000).toISOString()]);
                return res.json(result);
            }

            if (license.expires_at && new Date(license.expires_at) < new Date()) {
                const result = { licensed: false, deviceId, message: 'License has expired.' };
                await db.run('UPDATE settings SET licenseCache = ?, licenseCacheAt = ? WHERE id = 1',
                    [JSON.stringify(result), new Date(Date.now() - LICENSE_CACHE_TTL_MS + 30000).toISOString()]);
                return res.json(result);
            }

            // Bind hardware_id on first use
            if (!license.hardware_id) {
                await supabase
                    .from('mikrotik_licenses')
                    .update({ hardware_id: deviceId, activated_at: new Date().toISOString() })
                    .eq('id', license.id);
            }

            // Update last check-in (fire and forget — don't block the response)
            supabase
                .from('mikrotik_licenses')
                .update({ last_check_in: new Date().toISOString() })
                .eq('id', license.id)
                .then(() => {}).catch(() => {});

            const result = { 
                licensed: true, 
                expires: license.expires_at, 
                deviceId, 
                licenseKey: localLicenseKey,
                plan: license.plan_type,
                maxRouters: license.max_routers
            };

            // Cache the valid result for 5 minutes
            await db.run('UPDATE settings SET licenseCache = ?, licenseCacheAt = ? WHERE id = 1',
                [JSON.stringify(result), new Date().toISOString()]);

            res.json(result);

        } catch (err) { 
            console.error('[License] Status check error:', err);
            // On unexpected error, try to serve stale cache rather than returning unlicensed
            try {
                const settings = await db.get('SELECT licenseCache FROM settings WHERE id = 1');
                if (settings?.licenseCache) {
                    const cached = JSON.parse(settings.licenseCache);
                    console.warn('[License] Serving stale cache due to error');
                    return res.json(cached);
                }
            } catch (_) {}
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
            await db.run('UPDATE settings SET licenseKey = ?, licenseCache = NULL, licenseCacheAt = NULL WHERE id = 1', [licenseKey]);
            
            res.json({ success: true, message: 'License activated successfully!' });
        } catch (err) { 
            console.error(err);
            res.status(500).json({ message: err.message }); 
        }
    });

    licenseRouter.post('/revoke', async (req, res) => {
        // Just remove local key and clear cache
        await db.run('UPDATE settings SET licenseKey = NULL, licenseCache = NULL, licenseCacheAt = NULL WHERE id = 1');
        res.json({ success: true, message: 'License removed from this device.' });
    });


    app.use('/api/license', licenseRouter);

    // --- System / Host Status ---
    // Cache WAN IP in memory — it rarely changes, no need to hit ipify on every 5s poll
    let wanIpCache = { ip: null, fetchedAt: 0 };
    const WAN_IP_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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

            // Fetch WAN/Public IP with a short timeout so it never blocks the response
            let wanIp = null;
            try {
                const now = Date.now();
                if (wanIpCache.ip && (now - wanIpCache.fetchedAt) < WAN_IP_CACHE_TTL_MS) {
                    wanIp = wanIpCache.ip;
                } else {
                    const ipRes = await axios.get('https://api.ipify.org?format=json', { timeout: 3000 });
                    wanIp = ipRes.data?.ip || null;
                    wanIpCache = { ip: wanIp, fetchedAt: now };
                }
            } catch (err) {
                console.warn("Failed to get WAN IP", err.message);
                wanIp = wanIpCache.ip || null; // serve stale if available
            }

            // Get local IPv4 addresses from all non-virtual network interfaces
            const localIps = [];
            try {
                const ignoredPattern = /^(zt|docker|veth|br-|tun|tap|lo|vmnet|vbox)/i;
                const nets = os.networkInterfaces();
                for (const [name, addrs] of Object.entries(nets)) {
                    if (ignoredPattern.test(name)) continue;
                    for (const addr of addrs) {
                        if (addr.family === 'IPv4' && !addr.internal) {
                            localIps.push({ iface: name, ip: addr.address });
                        }
                    }
                }
            } catch (err) {
                console.warn("Failed to get local IPs", err.message);
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
                uptime: os.uptime() + 's',
                wanIp,
                localIps,
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
    app.get('/api/list-backups', protect, requireSuperadminOrAdmin, async (req, res) => {
        try {
            const files = await fs.promises.readdir(BACKUP_DIR);
            res.json(files.filter(f => f.endsWith('.db')));
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    app.get('/api/create-backup', protect, requireSuperadminOrAdmin, async (req, res) => {
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
    
    app.post('/api/delete-backup', protect, requireSuperadminOrAdmin, async (req, res) => {
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
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

        const REPO_ROOT_LOCAL = path.dirname(__dirname);
        const localExec = (cmd) => new Promise((resolve, reject) => {
            exec(cmd, { cwd: REPO_ROOT_LOCAL, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
                if (err) reject(new Error(stderr || err.message));
                else resolve((stdout || '').trim());
            });
        });

        (async () => {
            try {
                send({ log: 'Reading local repository...' });
                const remoteUrl = await localExec('git config --get remote.origin.url');
                const m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
                if (!m) throw new Error('Local origin is not a GitHub repository');
                const [, owner, repo] = m;

                send({ log: `Detected GitHub repo: ${owner}/${repo}` });
                const localHash = await localExec('git rev-parse HEAD');
                const branch = await localExec('git rev-parse --abbrev-ref HEAD').catch(() => 'main');

                send({ log: `Querying latest commit on origin/${branch}...` });
                const headers = {
                    'Accept': 'application/vnd.github+json',
                    'User-Agent': 'Mikrotik-Billing-Manager-Updater',
                };
                if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
                const remote = await axios.get(`https://api.github.com/repos/${owner}/${repo}/commits/${branch}`, { headers, timeout: 15000 });
                const remoteHash = remote.data?.sha || '';

                if (!remoteHash) throw new Error('Could not read remote commit SHA');

                if (localHash === remoteHash) {
                    send({ status: 'uptodate', message: 'You are running the latest version.', localHash, remoteHash });
                } else {
                    send({
                        status: 'available',
                        message: `New version available on ${branch}.`,
                        localHash: localHash.substring(0, 7),
                        remoteHash: remoteHash.substring(0, 7),
                        latestCommitMessage: remote.data?.commit?.message || '',
                        latestCommitAuthor: remote.data?.commit?.author?.name || '',
                        latestCommitDate: remote.data?.commit?.author?.date || '',
                    });
                }
                res.end();
            } catch (err) {
                send({ status: 'error', message: err.message });
                res.end();
            }
        })();

        req.on('close', () => { try { res.end(); } catch {} });
    });

    // --- GitHub Integration Endpoints ---

    // Repository root (one level up from /proxy)
    const REPO_ROOT = path.dirname(__dirname);

    // Local helper to run shell commands (also defined globally below for other modules)
    const ghExec = (cmd, opts = {}) => new Promise((resolve, reject) => {
        exec(cmd, { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024, ...opts }, (error, stdout, stderr) => {
            if (error) return reject(new Error(stderr || error.message));
            resolve((stdout || '').trim());
        });
    });

    // GitHub API helper (supports optional GITHUB_TOKEN for higher rate limits / private repos)
    const githubApi = async (endpoint) => {
        const headers = {
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'Mikrotik-Billing-Manager-Updater',
            'X-GitHub-Api-Version': '2022-11-28',
        };
        if (process.env.GITHUB_TOKEN) {
            headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
        }
        const response = await axios.get(`https://api.github.com${endpoint}`, {
            headers,
            timeout: 15000,
        });
        return response.data;
    };

    // Helper function to validate GitHub owner/repo
    const parseGitHubRepo = (owner, repo) => {
        if (!owner || !repo) {
            throw new Error('Owner and repository name are required');
        }
        if (!/^[a-zA-Z0-9-_.]+$/.test(owner) || !/^[a-zA-Z0-9-_.]+$/.test(repo)) {
            throw new Error('Invalid GitHub repository format');
        }
        return { owner, repo: repo.replace(/\.git$/, '') };
    };

    // Current local version (git HEAD info)
    app.get('/api/current-version', protect, async (req, res) => {
        try {
            const [logOutput, remoteUrl, branchName] = await Promise.all([
                ghExec('git log -1 --pretty=format:%h%x00%s%x00%b%x00%an%x00%ad --date=iso'),
                ghExec('git config --get remote.origin.url').catch(() => ''),
                ghExec('git rev-parse --abbrev-ref HEAD').catch(() => ''),
            ]);
            const parts = (logOutput || '').split('\0');
            res.json({
                hash: parts[0] || 'N/A',
                title: parts[1] || 'No commits found',
                description: (parts[2] || '').trim(),
                author: parts[3] || '',
                date: parts[4] || '',
                remoteUrl: remoteUrl || '',
                branch: branchName || '',
            });
        } catch (error) {
            res.status(500).json({ message: `Failed to read local git info: ${error.message}` });
        }
    });

    // Get repository information (REAL GitHub API call)
    app.get('/api/github/repo-info', protect, requireSuperadminOrAdmin, async (req, res) => {
        try {
            const { owner, repo } = parseGitHubRepo(req.query.owner, req.query.repo);
            const data = await githubApi(`/repos/${owner}/${repo}`);
            res.json({
                owner: data.owner?.login || owner,
                repo: data.name || repo,
                fullName: data.full_name,
                description: data.description || '',
                stars: data.stargazers_count || 0,
                forks: data.forks_count || 0,
                isPrivate: !!data.private,
                defaultBranch: data.default_branch || 'main',
                lastUpdated: data.pushed_at || data.updated_at,
                htmlUrl: data.html_url,
                cloneUrl: data.clone_url,
            });
        } catch (error) {
            const status = error.response?.status || 400;
            const msg = error.response?.data?.message || error.message;
            res.status(status === 404 ? 404 : 400).json({
                message: status === 404 ? 'Repository not found or not accessible.' : `GitHub API error: ${msg}`
            });
        }
    });

    // Get repository branches (REAL GitHub API call, with pagination)
    app.get('/api/github/branches', protect, requireSuperadminOrAdmin, async (req, res) => {
        try {
            const { owner, repo } = parseGitHubRepo(req.query.owner, req.query.repo);
            const all = [];
            // Paginate up to 5 pages (500 branches max) to be safe
            for (let page = 1; page <= 5; page++) {
                const data = await githubApi(`/repos/${owner}/${repo}/branches?per_page=100&page=${page}`);
                if (!Array.isArray(data) || data.length === 0) break;
                all.push(...data.map(b => ({
                    name: b.name,
                    protected: !!b.protected,
                    sha: b.commit?.sha || '',
                })));
                if (data.length < 100) break;
            }
            res.json(all);
        } catch (error) {
            const status = error.response?.status || 400;
            const msg = error.response?.data?.message || error.message;
            res.status(status === 404 ? 404 : 400).json({
                message: status === 404 ? 'Repository not found or not accessible.' : `GitHub API error: ${msg}`
            });
        }
    });

    // Pull from repository (non-streaming, executes real git pull)
    app.post('/api/github/pull', protect, requireSuperadminOrAdmin, async (req, res) => {
        let snapshotRoot = null;
        let capturedPaths = [];
        const noopSend = (obj) => { try { console.log('[github/pull]', obj); } catch {} };
        try {
            const { branch } = req.body;
            if (!branch) {
                return res.status(400).json({ message: 'Branch is required' });
            }
            if (!/^[a-zA-Z0-9-_./]+$/.test(branch)) {
                return res.status(400).json({ message: 'Invalid branch name' });
            }

            // SNAPSHOT user data (DBs, .env, uploads, device id, etc.)
            // BEFORE pulling — prevents git from overwriting any of
            // those files if they happen to be tracked in the repo.
            try {
                if (typeof snapshotUserData === 'function') {
                    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
                    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
                    snapshotRoot = path.join(BACKUP_DIR, `pre_pull_snapshot_${stamp}`);
                    if (!fs.existsSync(snapshotRoot)) fs.mkdirSync(snapshotRoot, { recursive: true });
                    capturedPaths = snapshotUserData(noopSend, snapshotRoot);
                }
            } catch (se) {
                console.warn('[github/pull] snapshot stage failed:', se.message);
            }

            // Stash any local changes so the pull never aborts.
            await ghExec('git stash --include-untracked').catch(() => {});

            await ghExec('git fetch origin');
            const pullOut = await ghExec(`git pull origin ${branch}`);
            const stat = await ghExec('git diff --shortstat HEAD@{1} HEAD').catch(() => '');

            // RESTORE user data over whatever git pulled.
            if (snapshotRoot && capturedPaths.length > 0 && typeof restoreUserData === 'function') {
                try { restoreUserData(noopSend, snapshotRoot, capturedPaths); } catch (re) {
                    console.warn('[github/pull] restore stage failed:', re.message);
                }
            }

            res.json({
                success: true,
                message: `Successfully pulled from ${branch}`,
                output: pullOut,
                stat,
                preserved: capturedPaths,
            });
        } catch (error) {
            // Best-effort restore on failure too, so a broken pull cannot
            // leave the checkout in a half-overwritten state.
            if (snapshotRoot && capturedPaths.length > 0 && typeof restoreUserData === 'function') {
                try { restoreUserData(noopSend, snapshotRoot, capturedPaths); } catch {}
            }
            res.status(500).json({
                success: false,
                message: 'Pull operation failed',
                error: error.message,
            });
        }
    });

    // Pull from repository (streaming via SSE, executes real git pull)
    app.get('/api/github/pull-stream', protect, requireSuperadminOrAdmin, (req, res) => {
        const { branch } = req.query;
        if (!branch || !/^[a-zA-Z0-9-_./]+$/.test(branch)) {
            return res.status(400).json({ message: 'Valid branch is required' });
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

        const { spawn } = require('child_process');

        const runStreaming = (cmd, args, label) => new Promise((resolve, reject) => {
            send({ log: `\n$ ${label || (cmd + ' ' + args.join(' '))}` });
            const child = spawn(cmd, args, { cwd: REPO_ROOT, shell: false });
            child.stdout.on('data', d => d.toString().split(/\r?\n/).forEach(line => line && send({ log: line })));
            child.stderr.on('data', d => d.toString().split(/\r?\n/).forEach(line => line && send({ log: line })));
            child.on('error', reject);
            child.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`)));
        });

        let snapshotRoot = null;
        let capturedPaths = [];

        (async () => {
            try {
                // SNAPSHOT: capture per-install user data (DBs, .env,
                // uploads, device-id, etc.) before pulling. Without this
                // a `git pull` will overwrite any of those files that are
                // tracked in the repository — producing the "factory
                // reset" symptom (routers/customers/settings disappear).
                try {
                    if (typeof snapshotUserData === 'function') {
                        if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
                        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
                        snapshotRoot = path.join(BACKUP_DIR, `pre_pull_snapshot_${stamp}`);
                        if (!fs.existsSync(snapshotRoot)) fs.mkdirSync(snapshotRoot, { recursive: true });
                        send({ log: 'Snapshotting per-install user data before pull...' });
                        capturedPaths = snapshotUserData(send, snapshotRoot);
                        send({ log: `Snapshot captured ${capturedPaths.length} item(s): ${capturedPaths.join(', ') || '(none)'}` });
                    }
                } catch (se) {
                    send({ log: `WARNING: snapshot stage failed: ${se.message}` });
                }

                // Stash any uncommitted changes so the pull cannot be blocked.
                send({ log: 'Stashing any local changes (safety)...' });
                await runStreaming('git', ['stash', '--include-untracked']).catch(() => {});

                send({ log: `Fetching latest from origin (${branch})...` });
                await runStreaming('git', ['fetch', 'origin', branch]);
                send({ log: `Pulling changes...` });
                await runStreaming('git', ['pull', 'origin', branch]);

                // RESTORE: forcibly overlay user data back on top of
                // whatever git pulled. Routers, customers, .env, uploads,
                // device id are now exactly as they were pre-pull.
                if (snapshotRoot && capturedPaths.length > 0 && typeof restoreUserData === 'function') {
                    send({ log: 'Restoring per-install user data after pull...' });
                    restoreUserData(send, snapshotRoot, capturedPaths);
                }

                send({
                    status: 'completed',
                    message: `Successfully pulled latest from ${branch}.`,
                });
                res.end();
            } catch (err) {
                // On failure also try to restore so we don't leave the
                // checkout half-overwritten by git.
                if (snapshotRoot && capturedPaths.length > 0 && typeof restoreUserData === 'function') {
                    try {
                        send({ log: 'Pull failed — restoring user data from snapshot...' });
                        restoreUserData(send, snapshotRoot, capturedPaths);
                    } catch {}
                }
                send({ status: 'error', message: err.message });
                res.end();
            }
        })();

        req.on('close', () => { try { res.end(); } catch {} });
    });

    // ----- Update / Rollback (real implementations) -----
    // Helper: SSE-stream a child process line by line and resolve when it exits.
    const streamProcess = (sendFn, cmd, args, opts = {}) => new Promise((resolve, reject) => {
        const { spawn } = require('child_process');
        sendFn({ log: `\n$ ${cmd} ${args.join(' ')}` });
        const child = spawn(cmd, args, { cwd: REPO_ROOT, shell: false, ...opts });
        const onLine = (buf, isErr) => buf.toString().split(/\r?\n/).forEach(line => {
            if (line) sendFn({ log: line, isError: !!isErr });
        });
        child.stdout.on('data', d => onLine(d, false));
        child.stderr.on('data', d => onLine(d, false)); // npm/git emit progress on stderr; not real errors
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`)));
    });

    // Detached PM2 restart so the restart command survives this process exiting.
    const triggerPm2Restart = () => {
        try {
            const { spawn } = require('child_process');
            const isWin = process.platform === 'win32';
            // Restart all PM2 processes after a short delay to let the SSE response flush.
            const cmd = isWin
                ? ['cmd', ['/c', 'timeout /t 3 >NUL & pm2 restart all']]
                : ['sh', ['-c', 'sleep 3 && pm2 restart all']];
            const child = spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' });
            child.unref();
        } catch (e) {
            console.warn('Failed to trigger PM2 restart:', e.message);
        }
    };

    // ------------------------------------------------------------------
    // PRESERVE LIST — files/dirs that hold per-install user data and must
    // survive `git pull`. Even if .gitignore is incomplete on a particular
    // checkout, the updater snapshots these aside before pulling and
    // restores them afterward so an update can NEVER act like a factory
    // reset.
    // ------------------------------------------------------------------
    const PRESERVE_PATHS = [
        'proxy/panel.db',
        'proxy/panel.db-shm',
        'proxy/panel.db-wal',
        'proxy/superadmin.db',
        'proxy/superadmin.db-shm',
        'proxy/superadmin.db-wal',
        'proxy/.env',
        'proxy/.device-id',
        'proxy/ngrok-config.json',
        'proxy/uploads',
        'database.sqlite',
        'database.sqlite-shm',
        'database.sqlite-wal',
        'env.js',
    ];

    // Recursively copy a file or directory (used for snapshot + restore).
    const copyRecursive = (src, dest) => {
        const stat = fs.statSync(src);
        if (stat.isDirectory()) {
            if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
            for (const entry of fs.readdirSync(src)) {
                copyRecursive(path.join(src, entry), path.join(dest, entry));
            }
        } else {
            const parent = path.dirname(dest);
            if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
            fs.copyFileSync(src, dest);
        }
    };

    // Snapshot every existing PRESERVE_PATHS entry into snapshotRoot,
    // returning the list of relative paths actually captured.
    const snapshotUserData = (sendFn, snapshotRoot) => {
        const captured = [];
        for (const rel of PRESERVE_PATHS) {
            const src = path.join(REPO_ROOT, rel);
            if (!fs.existsSync(src)) continue;
            try {
                const dest = path.join(snapshotRoot, rel);
                copyRecursive(src, dest);
                captured.push(rel);
            } catch (e) {
                sendFn({ log: `WARNING: failed to snapshot ${rel}: ${e.message}`, isError: true });
            }
        }
        return captured;
    };

    // Restore captured paths from snapshotRoot back into REPO_ROOT,
    // overwriting whatever git pull may have pulled in.
    const restoreUserData = (sendFn, snapshotRoot, captured) => {
        for (const rel of captured) {
            const src = path.join(snapshotRoot, rel);
            const dest = path.join(REPO_ROOT, rel);
            if (!fs.existsSync(src)) continue;
            try {
                // Remove whatever git wrote so we cleanly overlay user data.
                if (fs.existsSync(dest)) {
                    const st = fs.statSync(dest);
                    if (st.isDirectory()) fs.rmSync(dest, { recursive: true, force: true });
                    else fs.unlinkSync(dest);
                }
                copyRecursive(src, dest);
                sendFn({ log: `Preserved: ${rel}` });
            } catch (e) {
                sendFn({ log: `ERROR: failed to restore ${rel}: ${e.message}`, isError: true });
            }
        }
    };

    // POST /api/update-app  (SSE) — backup DB, git pull, npm install, build, restart
    app.get('/api/update-app', protect, requireSuperadminOrAdmin, (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

        let snapshotRoot = null;
        let capturedPaths = [];
        let updateSnapshotId = null;
        let updateManifestPath = null;
        let dbBackupRelName = null;
        let prevCommit = null;

        (async () => {
            try {
                // 1) Detect current branch + pre-update commit (used by rollback)
                send({ log: 'Detecting current branch...' });
                const branch = (await ghExec('git rev-parse --abbrev-ref HEAD').catch(() => 'main')).trim() || 'main';
                send({ log: `Branch: ${branch}` });
                prevCommit = (await ghExec('git rev-parse HEAD').catch(() => '')).trim() || null;
                if (prevCommit) send({ log: `Current commit: ${prevCommit}` });

                // Shared id used for DB backup name + snapshot dir + manifest.
                updateSnapshotId = new Date().toISOString().replace(/[:.]/g, '-');

                // 2) Backup the database before touching anything
                try {
                    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
                    const backupName = `panel_backup_${updateSnapshotId}.db`;
                    const backupPath = path.join(BACKUP_DIR, backupName);
                    if (fs.existsSync(DB_PATH)) {
                        await fs.promises.copyFile(DB_PATH, backupPath);
                        dbBackupRelName = backupName;
                        send({ log: `Database backed up to ${backupName}` });
                    } else {
                        send({ log: 'No existing panel.db found; skipping DB backup.' });
                    }
                } catch (be) {
                    send({ log: `WARNING: DB backup failed: ${be.message}`, isError: true });
                }

                // 2b) SNAPSHOT all per-install user data (DBs, .env, uploads,
                //     device-id, etc.) so git pull cannot wipe them. This is
                //     the critical guard against the "updater performed a
                //     factory reset" failure mode where these files were
                //     accidentally tracked in git.
                try {
                    snapshotRoot = path.join(BACKUP_DIR, `pre_update_snapshot_${updateSnapshotId}`);
                    if (!fs.existsSync(snapshotRoot)) fs.mkdirSync(snapshotRoot, { recursive: true });
                    send({ log: 'Snapshotting per-install user data before pull...' });
                    capturedPaths = snapshotUserData(send, snapshotRoot);
                    send({ log: `Snapshot captured ${capturedPaths.length} item(s): ${capturedPaths.join(', ') || '(none)'}` });
                } catch (se) {
                    send({ log: `WARNING: snapshot stage failed: ${se.message}`, isError: true });
                }

                // 2c) Write the rollback manifest so /api/rollback-update can
                //     fully restore code + DB + user data from this snapshot.
                try {
                    if (snapshotRoot) {
                        const manifest = {
                            id: updateSnapshotId,
                            timestamp: new Date().toISOString(),
                            branch,
                            prevCommit,
                            dbBackupFile: dbBackupRelName,
                            snapshotDir: path.basename(snapshotRoot),
                            capturedPaths,
                        };
                        updateManifestPath = path.join(snapshotRoot, 'manifest.json');
                        fs.writeFileSync(updateManifestPath, JSON.stringify(manifest, null, 2));
                        send({ log: `Rollback manifest written: ${path.basename(snapshotRoot)}/manifest.json` });
                    }
                } catch (me) {
                    send({ log: `WARNING: manifest write failed: ${me.message}`, isError: true });
                }

                // 3) Stash any local changes so git pull never blocks on conflicts
                send({ log: 'Stashing any local changes (safety)...' });
                await streamProcess(send, 'git', ['stash', '--include-untracked']).catch(() => {});

                // 4) Real git fetch + pull
                send({ log: `Fetching latest from origin/${branch}...` });
                await streamProcess(send, 'git', ['fetch', 'origin', branch]);
                send({ log: `Pulling latest...` });
                await streamProcess(send, 'git', ['pull', '--ff-only', 'origin', branch]);

                // 4b) RESTORE per-install user data on top of whatever git
                //     pulled in. Anything in PRESERVE_PATHS now reflects the
                //     pre-update state — DBs intact, routers intact,
                //     .env intact, uploads intact, device id intact.
                if (snapshotRoot && capturedPaths.length > 0) {
                    send({ log: 'Restoring per-install user data after pull...' });
                    restoreUserData(send, snapshotRoot, capturedPaths);
                }

                // 5) Install dependencies (root)
                send({ log: 'Installing root dependencies (npm install)...' });
                const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
                await streamProcess(send, npmCmd, ['install', '--no-audit', '--no-fund']);

                // 6) Install dependencies (proxy)
                if (fs.existsSync(path.join(__dirname, 'package.json'))) {
                    send({ log: 'Installing proxy dependencies...' });
                    await streamProcess(send, npmCmd, ['install', '--no-audit', '--no-fund'], { cwd: __dirname }).catch(e => {
                        send({ log: `proxy npm install warning: ${e.message}`, isError: true });
                    });
                }

                // 7) Install dependencies (api-backend) if present
                const apiBackendDir = path.join(REPO_ROOT, 'api-backend');
                if (fs.existsSync(path.join(apiBackendDir, 'package.json'))) {
                    send({ log: 'Installing api-backend dependencies...' });
                    await streamProcess(send, npmCmd, ['install', '--no-audit', '--no-fund'], { cwd: apiBackendDir }).catch(e => {
                        send({ log: `api-backend npm install warning: ${e.message}`, isError: true });
                    });
                }

                // 8) Build frontend (best-effort; some deployments serve dev mode)
                try {
                    send({ log: 'Building frontend (npm run build)...' });
                    await streamProcess(send, npmCmd, ['run', 'build']);
                } catch (e) {
                    send({ log: `Frontend build skipped/failed (continuing): ${e.message}`, isError: true });
                }

                send({ log: 'Update complete. Triggering PM2 restart...' });
                send({ status: 'restarting', message: 'Update complete. Restarting services.' });

                // Flush + close, then trigger restart
                setTimeout(() => {
                    try { res.end(); } catch {}
                    triggerPm2Restart();
                }, 500);
            } catch (err) {
                send({ log: `Update failed: ${err.message}`, isError: true });
                send({ status: 'error', message: err.message });
                try { res.end(); } catch {}
            }
        })();

        req.on('close', () => { try { res.end(); } catch {} });
    });

    // GET /api/rollback-app?backupFile=xxx.db  (SSE) — restore DB then restart
    app.get('/api/rollback-app', protect, requireSuperadminOrAdmin, (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

        (async () => {
            try {
                const { backupFile } = req.query;
                if (!backupFile || typeof backupFile !== 'string') {
                    throw new Error('backupFile query parameter is required');
                }
                // Path safety
                if (backupFile.includes('..') || backupFile.includes('/') || backupFile.includes('\\')) {
                    throw new Error('Invalid backup filename');
                }
                if (!backupFile.endsWith('.db')) {
                    throw new Error('Backup file must end in .db');
                }
                const backupPath = path.join(BACKUP_DIR, backupFile);
                if (!backupPath.startsWith(BACKUP_DIR)) throw new Error('Invalid backup path');
                if (!fs.existsSync(backupPath)) throw new Error(`Backup file not found: ${backupFile}`);

                // Save a safety copy of the CURRENT DB before overwriting
                try {
                    const ts = new Date().toISOString().replace(/[:.]/g, '-');
                    const preRollbackName = `panel_pre_rollback_${ts}.db`;
                    const preRollbackPath = path.join(BACKUP_DIR, preRollbackName);
                    if (fs.existsSync(DB_PATH)) {
                        await fs.promises.copyFile(DB_PATH, preRollbackPath);
                        send({ log: `Pre-rollback snapshot saved as ${preRollbackName}` });
                    }
                } catch (e) {
                    send({ log: `WARNING: pre-rollback snapshot failed: ${e.message}`, isError: true });
                }

                send({ log: `Restoring database from ${backupFile}...` });
                await fs.promises.copyFile(backupPath, DB_PATH);
                send({ log: 'Database restored.' });

                send({ status: 'restarting', message: 'Rollback complete. Restarting services.' });
                setTimeout(() => {
                    try { res.end(); } catch {}
                    triggerPm2Restart();
                }, 500);
            } catch (err) {
                send({ log: `Rollback failed: ${err.message}`, isError: true });
                send({ status: 'error', message: err.message });
                try { res.end(); } catch {}
            }
        })();

        req.on('close', () => { try { res.end(); } catch {} });
    });

    // GET /api/rollback-update?id=xxx (SSE) — FULL rollback (code + DB + user data)
    app.get('/api/rollback-update', protect, requireSuperadminOrAdmin, (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

        (async () => {
            try {
                const { id } = req.query;
                if (!id || typeof id !== 'string' || /[\\/]/.test(id) || id.includes('..')) {
                    throw new Error('Valid snapshot id is required');
                }
                const snapshotDir = path.join(BACKUP_DIR, `pre_update_snapshot_${id}`);
                if (!snapshotDir.startsWith(BACKUP_DIR)) throw new Error('Invalid snapshot path');
                if (!fs.existsSync(snapshotDir)) throw new Error(`Snapshot not found: ${id}`);
                const manifestPath = path.join(snapshotDir, 'manifest.json');
                if (!fs.existsSync(manifestPath)) throw new Error('Snapshot manifest is missing');
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                send({ log: `Rolling back to snapshot ${manifest.id || id}` });
                send({ log: `  branch:    ${manifest.branch || '(unknown)'}` });
                send({ log: `  commit:    ${manifest.prevCommit || '(unknown)'}` });
                send({ log: `  db backup: ${manifest.dbBackupFile || '(none)'}` });
                send({ log: `  preserved: ${(manifest.capturedPaths || []).length} item(s)` });

                // 0) Pre-rollback safety snapshot of CURRENT state
                try {
                    const safetyId = `safety_${new Date().toISOString().replace(/[:.]/g, '-')}`;
                    const safetyDir = path.join(BACKUP_DIR, `pre_update_snapshot_${safetyId}`);
                    fs.mkdirSync(safetyDir, { recursive: true });
                    const safetyDbName = `panel_backup_${safetyId}.db`;
                    if (fs.existsSync(DB_PATH)) {
                        await fs.promises.copyFile(DB_PATH, path.join(BACKUP_DIR, safetyDbName));
                    }
                    const safetyCaptured = snapshotUserData(send, safetyDir);
                    const safetyHead = (await ghExec('git rev-parse HEAD').catch(() => '')).trim() || null;
                    const safetyBranch = (await ghExec('git rev-parse --abbrev-ref HEAD').catch(() => 'main')).trim() || 'main';
                    fs.writeFileSync(path.join(safetyDir, 'manifest.json'), JSON.stringify({
                        id: safetyId, timestamp: new Date().toISOString(),
                        branch: safetyBranch, prevCommit: safetyHead,
                        dbBackupFile: fs.existsSync(DB_PATH) ? safetyDbName : null,
                        snapshotDir: path.basename(safetyDir),
                        capturedPaths: safetyCaptured, kind: 'pre-rollback-safety',
                    }, null, 2));
                    send({ log: `Pre-rollback safety snapshot saved as ${safetyId}` });
                } catch (se) {
                    send({ log: `WARNING: pre-rollback safety snapshot failed: ${se.message}`, isError: true });
                }

                // 1) Rewind code to the previous commit
                if (manifest.prevCommit && /^[a-f0-9]{7,40}$/i.test(manifest.prevCommit)) {
                    send({ log: 'Stashing any local changes (safety)...' });
                    await streamProcess(send, 'git', ['stash', '--include-untracked']).catch(() => {});
                    if (manifest.branch) {
                        send({ log: `Fetching origin/${manifest.branch}...` });
                        await streamProcess(send, 'git', ['fetch', 'origin', manifest.branch]).catch(e => {
                            send({ log: `git fetch warning: ${e.message}`, isError: true });
                        });
                    }
                    send({ log: `Resetting working tree to ${manifest.prevCommit}...` });
                    await streamProcess(send, 'git', ['reset', '--hard', manifest.prevCommit]);
                } else {
                    send({ log: 'No valid prevCommit in manifest; skipping git rewind.', isError: true });
                }

                // 2) Restore DB from paired backup
                if (manifest.dbBackupFile) {
                    const dbBackupPath = path.join(BACKUP_DIR, manifest.dbBackupFile);
                    if (dbBackupPath.startsWith(BACKUP_DIR) && fs.existsSync(dbBackupPath)) {
                        send({ log: `Restoring database from ${manifest.dbBackupFile}...` });
                        await fs.promises.copyFile(dbBackupPath, DB_PATH);
                        send({ log: 'Database restored.' });
                    } else {
                        send({ log: `WARNING: db backup not found: ${manifest.dbBackupFile}`, isError: true });
                    }
                }

                // 3) Restore user data files
                const captured = Array.isArray(manifest.capturedPaths) ? manifest.capturedPaths : [];
                if (captured.length > 0) {
                    send({ log: 'Restoring per-install user data from snapshot...' });
                    restoreUserData(send, snapshotDir, captured);
                }

                // 4) Reinstall dependencies
                const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
                send({ log: 'Installing root dependencies (npm install)...' });
                await streamProcess(send, npmCmd, ['install', '--no-audit', '--no-fund']).catch(e => {
                    send({ log: `root npm install warning: ${e.message}`, isError: true });
                });
                if (fs.existsSync(path.join(__dirname, 'package.json'))) {
                    send({ log: 'Installing proxy dependencies...' });
                    await streamProcess(send, npmCmd, ['install', '--no-audit', '--no-fund'], { cwd: __dirname }).catch(e => {
                        send({ log: `proxy npm install warning: ${e.message}`, isError: true });
                    });
                }
                const apiBackendDir = path.join(REPO_ROOT, 'api-backend');
                if (fs.existsSync(path.join(apiBackendDir, 'package.json'))) {
                    send({ log: 'Installing api-backend dependencies...' });
                    await streamProcess(send, npmCmd, ['install', '--no-audit', '--no-fund'], { cwd: apiBackendDir }).catch(e => {
                        send({ log: `api-backend npm install warning: ${e.message}`, isError: true });
                    });
                }

                // 5) Rebuild frontend (best-effort)
                try {
                    send({ log: 'Building frontend (npm run build)...' });
                    await streamProcess(send, npmCmd, ['run', 'build']);
                } catch (e) {
                    send({ log: `Frontend build skipped/failed (continuing): ${e.message}`, isError: true });
                }

                send({ log: 'Rollback complete. Triggering PM2 restart...' });
                send({ status: 'restarting', message: 'Rollback complete. Restarting services.' });
                setTimeout(() => {
                    try { res.end(); } catch {}
                    triggerPm2Restart();
                }, 500);
            } catch (err) {
                send({ log: `Rollback failed: ${err.message}`, isError: true });
                send({ status: 'error', message: err.message });
                try { res.end(); } catch {}
            }
        })();

        req.on('close', () => { try { res.end(); } catch {} });
    });

    // GET /api/list-update-snapshots — enumerate rollback manifests
    app.get('/api/list-update-snapshots', protect, requireSuperadminOrAdmin, async (req, res) => {
        try {
            if (!fs.existsSync(BACKUP_DIR)) return res.json([]);
            const entries = fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
                .filter(d => d.isDirectory() && d.name.startsWith('pre_update_snapshot_'));
            const results = [];
            for (const dirent of entries) {
                const manifestPath = path.join(BACKUP_DIR, dirent.name, 'manifest.json');
                if (!fs.existsSync(manifestPath)) continue;
                try {
                    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                    const dbBackupExists = !!(m.dbBackupFile && fs.existsSync(path.join(BACKUP_DIR, m.dbBackupFile)));
                    results.push({
                        id: m.id || dirent.name.replace('pre_update_snapshot_', ''),
                        timestamp: m.timestamp || null,
                        branch: m.branch || null,
                        prevCommit: m.prevCommit || null,
                        dbBackupFile: m.dbBackupFile || null,
                        dbBackupExists,
                        capturedPaths: Array.isArray(m.capturedPaths) ? m.capturedPaths : [],
                        snapshotDir: dirent.name,
                        kind: m.kind || 'pre-update',
                    });
                } catch {}
            }
            results.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
            res.json(results);
        } catch (e) {
            res.status(500).json({ message: `Failed to list update snapshots: ${e.message}` });
        }
    });

    // POST /api/delete-update-snapshot { id } — remove snapshot dir + paired DB backup
    app.post('/api/delete-update-snapshot', protect, requireSuperadminOrAdmin, async (req, res) => {
        try {
            const { id } = req.body || {};
            if (!id || typeof id !== 'string' || /[\\/]/.test(id) || id.includes('..')) {
                return res.status(400).json({ message: 'Invalid id' });
            }
            const snapshotDir = path.join(BACKUP_DIR, `pre_update_snapshot_${id}`);
            if (!snapshotDir.startsWith(BACKUP_DIR)) return res.status(400).json({ message: 'Invalid id' });
            if (!fs.existsSync(snapshotDir)) return res.status(404).json({ message: 'Snapshot not found' });
            let dbBackupFile = null;
            try {
                const m = JSON.parse(fs.readFileSync(path.join(snapshotDir, 'manifest.json'), 'utf8'));
                dbBackupFile = m.dbBackupFile || null;
            } catch {}
            fs.rmSync(snapshotDir, { recursive: true, force: true });
            if (dbBackupFile && /^[A-Za-z0-9._-]+\.db$/.test(dbBackupFile)) {
                const dbPath = path.join(BACKUP_DIR, dbBackupFile);
                if (dbPath.startsWith(BACKUP_DIR) && fs.existsSync(dbPath)) {
                    try { fs.unlinkSync(dbPath); } catch {}
                }
            }
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ message: `Delete failed: ${e.message}` });
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

    app.get('/api/zt/install', protect, (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
        const HANG_TIMEOUT_MS = 60000; // 60 seconds without output = possible hang
        let lastActivity = Date.now();
        let hangCheckInterval = null;

        send({ log: '> Starting ZeroTier installation: curl -s https://install.zerotier.com | sudo bash' });
        send({ log: '> Monitoring for activity...' });

        const child = exec('curl -s https://install.zerotier.com | sudo bash', {
            env: { ...process.env, PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' }
        });

        // Hang detection interval
        hangCheckInterval = setInterval(() => {
            const elapsed = Date.now() - lastActivity;
            if (elapsed >= HANG_TIMEOUT_MS) {
                const seconds = Math.floor(elapsed / 1000);
                send({ log: `⚠️  WARNING: No output received for ${seconds}s. Installation may be hanging...`, isWarning: true });
            }
        }, 15000); // Check every 15 seconds

        child.stdout.on('data', (data) => {
            lastActivity = Date.now();
            send({ log: data.toString() });
        });

        child.stderr.on('data', (data) => {
            lastActivity = Date.now();
            send({ log: data.toString(), isError: true });
        });

        child.on('close', (code) => {
            clearInterval(hangCheckInterval);
            if (code === 0) {
                send({ status: 'success', log: '✅ ZeroTier installed successfully!' });
            } else {
                send({ status: 'error', message: `Installation failed with exit code ${code}.` });
            }
            send({ status: 'finished' });
            res.end();
        });

        child.on('error', (err) => {
            clearInterval(hangCheckInterval);
            send({ status: 'error', message: `Failed to start installation: ${err.message}` });
            send({ status: 'finished' });
            res.end();
        });

        // If client disconnects, kill the process
        req.on('close', () => {
            clearInterval(hangCheckInterval);
            if (!child.killed) child.kill();
        });
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

    // Cloudflare Tunnel
    app.get('/api/cloudflare-tunnel/status', protect, async (req, res) => {
        try {
            const isActive = await runCommand('systemctl is-active cloudflared').then(o => o === 'active').catch(() => false);
            const isInstalled = await runCommand('which cloudflared').then(() => true).catch(() => false);
            
            res.json({ installed: isInstalled, active: isActive, url: isInstalled ? 'https://one.dash.cloudflare.com' : undefined });
        } catch (e) {
             res.json({ installed: false, active: false });
        }
    });

    app.post('/api/cloudflare-tunnel/install', protect, async (req, res) => {
        const { token } = req.body;
        
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });

        const sendLog = (message, isError = false) => {
            res.write(`data: ${JSON.stringify({ log: message, isError })}\n\n`);
        };

        const sendError = (message) => {
            res.write(`data: ${JSON.stringify({ status: 'error', message })}\n\n`);
            res.end();
        };

        try {
            sendLog('Starting Cloudflare Tunnel installation...');
            
            // Download and install cloudflared
            sendLog('Downloading Cloudflare Tunnel...');
            await runCommand('curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /tmp/cloudflared');
            
            sendLog('Installing Cloudflare Tunnel...');
            await runCommand('sudo mv /tmp/cloudflared /usr/local/bin/cloudflared');
            await runCommand('sudo chmod +x /usr/local/bin/cloudflared');
            
            // Create systemd service using connector token (modern approach).
            // The token embeds routing config set in the Cloudflare dashboard.
            // ACTION REQUIRED after install: In the Cloudflare dashboard, set the
            // public hostname for this tunnel to route to http://localhost:3001
            // so that /api/paymongo-webhook and all API paths reach this proxy.
            // Create systemd service
            sendLog('Creating systemd service...');
            const serviceContent = `[Unit]
Description=Cloudflare Tunnel
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/cloudflared tunnel --no-autoupdate run --token ${token}
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target`;
            
            await fsPromises.writeFile('/tmp/cloudflared.service', serviceContent);
            await runCommand('sudo mv /tmp/cloudflared.service /etc/systemd/system/cloudflared.service');
            
            sendLog('Reloading systemd...');
            await runCommand('sudo systemctl daemon-reload');
            
            sendLog('Enabling Cloudflare Tunnel service...');
            await runCommand('sudo systemctl enable cloudflared');
            
            sendLog('Starting Cloudflare Tunnel service...');
            await runCommand('sudo systemctl start cloudflared');
            
            sendLog('Cloudflare Tunnel installation completed successfully!', false);
            sendLog('ACTION REQUIRED: In the Cloudflare dashboard, configure this tunnel public hostname to route to http://localhost:3001 so webhook and API traffic reaches this proxy server.', false);
            res.write(`data: ${JSON.stringify({ status: 'completed' })}\n\n`);
            res.end();
            
        } catch (e) {
            console.error(e);
            sendError(e.message || 'Installation failed');
        }
    });

    app.get('/api/cloudflare-tunnel/uninstall', protect, async (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });

        const sendLog = (message, isError = false) => {
            res.write(`data: ${JSON.stringify({ log: message, isError })}\n\n`);
        };

        const sendError = (message) => {
            res.write(`data: ${JSON.stringify({ status: 'error', message })}\n\n`);
            res.end();
        };

        try {
            sendLog('Stopping Cloudflare Tunnel service...');
            await runCommand('sudo systemctl stop cloudflared').catch(() => {});
            
            sendLog('Disabling Cloudflare Tunnel service...');
            await runCommand('sudo systemctl disable cloudflared').catch(() => {});
            
            sendLog('Removing systemd service...');
            await runCommand('sudo rm -f /etc/systemd/system/cloudflared.service').catch(() => {});
            
            sendLog('Removing Cloudflare Tunnel binary...');
            await runCommand('sudo rm -f /usr/local/bin/cloudflared').catch(() => {});
            
            sendLog('Reloading systemd...');
            await runCommand('sudo systemctl daemon-reload').catch(() => {});
            
            sendLog('Cloudflare Tunnel uninstalled successfully!', false);
            res.write(`data: ${JSON.stringify({ status: 'completed' })}\n\n`);
            res.end();
            
        } catch (e) {
            console.error(e);
            sendError(e.message || 'Uninstallation failed');
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

    superRouter.get('/create-full-backup', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

        const createBackup = async () => {
            try {
                const backupFile = `full-panel-backup-${new Date().toISOString().replace(/:/g, '-')}.mk`;
                send({ log: `Creating full panel backup: ${backupFile}...` });

                const projectRoot = path.join(__dirname, '..');
                const archivePath = path.join(BACKUP_DIR, backupFile);
                
                await new Promise((resolve, reject) => {
                    const output = fs.createWriteStream(archivePath);
                    const archive = archiver('tar', { gzip: true });

                    output.on('close', () => {
                        send({ log: `Backup complete. Size: ${(archive.pointer() / 1024 / 1024).toFixed(2)} MB` });
                        resolve();
                    });
                    archive.on('warning', (err) => send({ log: `Archive warning: ${err.message}`, isError: true }));
                    archive.on('error', (err) => reject(new Error(`Failed to create backup archive: ${err.message}`)));

                    archive.pipe(output);
                    archive.glob('**/*', {
                        cwd: projectRoot,
                        ignore: ['proxy/backups/**', '.git/**', '**/node_modules/**'],
                        dot: true
                    });
                    archive.finalize();
                });

                send({ status: 'success', message: 'Backup created successfully.' });
            } catch (e) {
                send({ status: 'error', message: e.message });
            } finally {
                send({ status: 'finished' });
                res.end();
            }
        };
        createBackup();
    });

    // Middleware for handling raw file uploads
    const rawBodySaver = express.raw({ type: 'application/octet-stream', limit: '100mb' });

    superRouter.post('/upload-backup', rawBodySaver, async (req, res) => {
        try {
            if (!req.body || req.body.length === 0) {
                return res.status(400).json({ message: 'No file uploaded.' });
            }
            
            const backupFile = `uploaded-restore-${Date.now()}.mk`;
            const backupPath = path.join(BACKUP_DIR, backupFile);
            
            await fs.promises.writeFile(backupPath, req.body);
            
            res.json({ message: 'Backup uploaded successfully.', filename: backupFile });
        } catch (e) {
            res.status(500).json({ message: `File upload failed: ${e.message}` });
        }
    });

    superRouter.get('/restore-from-backup', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
        const { file } = req.query;

        if (!file || file.includes('..') || !file.endsWith('.mk')) {
            send({ status: 'error', message: 'Invalid backup file specified for restore.' });
            return res.end();
        }
        
        const restore = async () => {
            try {
                send({ log: `Starting full panel restore from ${file}...`});
                const backupPath = path.join(BACKUP_DIR, file);
                if (!fs.existsSync(backupPath)) throw new Error('Backup file not found on server.');

                send({ log: 'Stopping all panel services via pm2...'});
                await runCommand('pm2 stop all').catch(e => send({ log: `Could not stop pm2 (this is okay if it's not running): ${e.message}`, isError: true }));
                
                send({ log: 'Extracting backup over current application files...'});
                const projectRoot = path.join(__dirname, '..');
                await tar.x({
                    file: backupPath,
                    cwd: projectRoot,
                    onentry: (entry) => send({ log: `Restoring: ${entry.path}` })
                });
                send({ log: 'Extraction complete.' });

                send({ log: 'Re-installing dependencies for UI server...'});
                await runCommand('npm install --prefix proxy');

                send({ log: 'Re-installing dependencies for API backend...'});
                await runCommand('npm install --prefix api-backend');

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
        restore();
    });

    app.get('/download-backup/:filename', protect, (req, res) => {
        const { filename } = req.params;
        if (filename.includes('..') || !filename.endsWith('.mk')) {
            return res.status(400).json({ message: 'Invalid filename' });
        }
        const filePath = path.join(BACKUP_DIR, filename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ message: 'Backup file not found' });
        }
        res.download(filePath);
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

        // Auto-register PayMongo webhook on startup
        ensurePayMongoWebhook().then(result => {
            if (result.success) {
                console.log(`[PayMongo Webhook] Startup check: ${result.message}`);
            } else {
                console.warn(`[PayMongo Webhook] Startup check: ${result.message}`);
            }
        }).catch(err => {
            console.warn('[PayMongo Webhook] Startup registration failed (non-fatal):', err.message);
        });
    });
    
    // Start Facebook payment reminder scheduler
    startFacebookReminderScheduler();

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

// ========================================
// Automated Facebook Payment Reminder Scheduler
// ========================================
function startFacebookReminderScheduler() {
    console.log('[Facebook Reminders] Auto-reminder scheduler initialized (runs daily at 9:00 AM)');
    
    // Calculate time until next 9:00 AM
    function getTimeUntilNextRun() {
        const now = new Date();
        const nextRun = new Date(now);
        nextRun.setHours(9, 0, 0, 0);
        
        // If it's already past 9 AM today, schedule for tomorrow
        if (now >= nextRun) {
            nextRun.setDate(nextRun.getDate() + 1);
        }
        
        return nextRun.getTime() - now.getTime();
    }
    
    // Send reminders to clients due within 3 days
    async function sendPaymentReminders() {
        try {
            console.log('[Facebook Reminders] Running scheduled payment reminder job...');
            
            const now = new Date();
            const thresholdDate = new Date(now);
            thresholdDate.setDate(thresholdDate.getDate() + 3); // 3 days before
            
            // Get all clients with Facebook due within 3 days
            const clients = await db.all(
                'SELECT * FROM customers WHERE facebook_psid IS NOT NULL AND facebook_psid != "" AND dueDate <= ? AND (planType = "Postpaid" OR planType = "Active")',
                [thresholdDate.toISOString().split('T')[0]]
            );
            
            if (clients.length === 0) {
                console.log('[Facebook Reminders] No clients due within 3 days');
                return;
            }
            
            console.log(`[Facebook Reminders] Found ${clients.length} clients due within 3 days`);
            
            // Get Facebook settings
            const fbSettings = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
            const fbConfig = JSON.parse(fbSettings?.facebookSettings || '{}');
            
            if (!fbConfig.enabled || !fbConfig.pageAccessToken) {
                console.warn('[Facebook Reminders] Facebook Messenger not configured, skipping reminders');
                return;
            }
            
            const axios = require('axios');
            let sentCount = 0;
            let failedCount = 0;
            
            for (const customer of clients) {
                try {
                    const daysUntilDue = Math.ceil((new Date(customer.dueDate) - now) / (1000 * 60 * 60 * 24));
                    
                    let message;
                    if (daysUntilDue < 0) {
                        message = `⚠️ OVERDUE PAYMENT\n━━━━━━━━━━━━━━━━━━\n\n📋 Account: ${customer.accountNumber}\n👤 Name: ${customer.fullName || 'Valued Customer'}\n💰 Amount: ₱${(customer.planPrice || 0).toFixed(2)}\n📅 Due: ${customer.dueDate} (${Math.abs(daysUntilDue)} days overdue)\n\n⚠️ Service may be suspended!\n\n💳 Send PAY to pay now.`;
                    } else if (daysUntilDue === 0) {
                        message = `🔴 DUE TODAY\n━━━━━━━━━━━━━━━━━━\n\n📋 Account: ${customer.accountNumber}\n💰 Amount: ₱${(customer.planPrice || 0).toFixed(2)}\n\n⏰ Please pay today!\n\n💳 Send PAY to pay now.`;
                    } else if (daysUntilDue === 1) {
                        message = `⏰ PAYMENT DUE TOMORROW\n━━━━━━━━━━━━━━━━━━\n\n📋 Account: ${customer.accountNumber}\n💰 Amount: ₱${(customer.planPrice || 0).toFixed(2)}\n📅 Due: ${customer.dueDate}\n\n💳 Send PAY to pay now.`;
                    } else {
                        message = `⏰ Payment Reminder\n━━━━━━━━━━━━━━━━━━\n\n📋 Account: ${customer.accountNumber}\n💰 Amount: ₱${(customer.planPrice || 0).toFixed(2)}\n📅 Due: ${customer.dueDate} (${daysUntilDue} days)\n\n💳 Send PAY to pay now.`;
                    }
                    
                    await axios.post(
                        `https://graph.facebook.com/v18.0/me/messages?access_token=${fbConfig.pageAccessToken}`,
                        {
                            messaging_type: 'UPDATE',
                            recipient: { id: customer.facebook_psid },
                            message: { text: message }
                        },
                        { timeout: 10000 }
                    );
                    
                    sentCount++;
                    console.log(`[Facebook Reminders] ✓ Sent to ${customer.accountNumber} (${daysUntilDue} days)`);
                } catch (err) {
                    failedCount++;
                    console.error(`[Facebook Reminders] ✗ Failed for ${customer.accountNumber}:`, err.message);
                }
            }
            
            console.log(`[Facebook Reminders] Job complete: ${sentCount} sent, ${failedCount} failed`);
        } catch (err) {
            console.error('[Facebook Reminders] Scheduler error:', err.message);
        }
    }
    
    // Schedule first run
    const timeUntilFirstRun = getTimeUntilNextRun();
    console.log(`[Facebook Reminders] First run in ${Math.round(timeUntilFirstRun / 1000 / 60 / 60)} hours`);
    
    setTimeout(() => {
        sendPaymentReminders();
        
        // Then run every 24 hours
        setInterval(sendPaymentReminders, 24 * 60 * 60 * 1000);
    }, timeUntilFirstRun);
}

startServer();
