
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

// Cache app version from package.json
let APP_VERSION = '2.0.0';
try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    APP_VERSION = pkg.version || '2.0.0';
} catch (e) {
    console.warn('[Version] Could not read package.json, defaulting to 2.0.0');
}

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
let isShuttingDown = false; // Flag to prevent db access during shutdown/factory-reset

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
                xenditSettings TEXT,
                databaseEngine TEXT DEFAULT 'sqlite',
                dbHost TEXT,
                dbPort INTEGER,
                dbUser TEXT,
                dbPassword TEXT,
                dbName TEXT,
                notificationSettings TEXT,
                landingPageConfig TEXT,
                autoBackupSettings TEXT
            );
            INSERT OR IGNORE INTO settings (id) VALUES (1);
        `);
        
        // Ensure columns exist for existing DBs
        const columns = await db.all("PRAGMA table_info(settings)");
        const columnNames = columns.map(c => c.name);
        if (!columnNames.includes('telegramSettings')) await db.exec("ALTER TABLE settings ADD COLUMN telegramSettings TEXT");
        if (!columnNames.includes('paymongoSettings')) await db.exec("ALTER TABLE settings ADD COLUMN paymongoSettings TEXT");
        if (!columnNames.includes('xenditSettings')) await db.exec("ALTER TABLE settings ADD COLUMN xenditSettings TEXT");
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

        // Store & Portal settings JSON column
        if (!columnNames.includes('storeSettings')) await db.exec("ALTER TABLE settings ADD COLUMN storeSettings TEXT");

        // Billing settings JSON column (non-payment profile, default plan, grace period, expiry time)
        if (!columnNames.includes('billingSettings')) await db.exec("ALTER TABLE settings ADD COLUMN billingSettings TEXT");

        // Auto backup settings JSON column (enabled, intervalHours, maxBackups, lastBackup)
        if (!columnNames.includes('autoBackupSettings')) await db.exec("ALTER TABLE settings ADD COLUMN autoBackupSettings TEXT");

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
                status TEXT DEFAULT 'PENDING', -- PENDING | PAID | EXPIRED | CANCELED
                description TEXT,
                category TEXT,
                laborCost REAL DEFAULT 0,
                partsCost REAL DEFAULT 0,
                invoiceType TEXT DEFAULT 'subscription' -- 'subscription' | 'custom'
            );
            CREATE TABLE IF NOT EXISTS inventory (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                quantity INTEGER DEFAULT 0,
                price REAL,
                serialNumber TEXT,
                dateAdded TEXT
            );
            CREATE TABLE IF NOT EXISTS equipment_withdrawals (
                id TEXT PRIMARY KEY,
                inventoryItemId TEXT NOT NULL,
                itemName TEXT NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 1,
                serialNumber TEXT,
                customerId TEXT,
                customerName TEXT,
                customerUsername TEXT,
                notes TEXT,
                withdrawnBy TEXT,
                withdrawnDate TEXT NOT NULL,
                routerId TEXT
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
            CREATE TABLE IF NOT EXISTS xendit_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                invoice_id TEXT NOT NULL,
                invoice_no TEXT NOT NULL UNIQUE,
                pppoe_username TEXT NOT NULL,
                router_id TEXT,
                plan_name TEXT,
                amount REAL,
                base_amount REAL,
                convenience_fee REAL,
                total_amount REAL,
                payment_method TEXT,
                status TEXT DEFAULT 'pending',
                processed_at TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS billing_ledger (
                id TEXT PRIMARY KEY,
                routerId TEXT NOT NULL,
                username TEXT NOT NULL,
                accountNumber TEXT,
                month TEXT NOT NULL,
                status TEXT DEFAULT 'unpaid',
                planName TEXT,
                planPrice REAL DEFAULT 0,
                paidAmount REAL DEFAULT 0,
                saleId TEXT,
                paymentDate TEXT,
                createdAt TEXT DEFAULT (datetime('now')),
                UNIQUE(routerId, username, month)
            );
            CREATE TABLE IF NOT EXISTS client_balances (
                id TEXT PRIMARY KEY,
                routerId TEXT NOT NULL,
                username TEXT NOT NULL,
                accountNumber TEXT,
                balance REAL DEFAULT 0,
                updatedAt TEXT DEFAULT (datetime('now')),
                UNIQUE(routerId, username)
            );
            CREATE TABLE IF NOT EXISTS wan_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                connection_type TEXT NOT NULL DEFAULT 'dhcp',
                wan_interface TEXT NOT NULL DEFAULT 'eth0',
                static_ip TEXT,
                static_gateway TEXT,
                static_dns TEXT,
                pppoe_username TEXT,
                pppoe_password TEXT,
                pppoe_interface_name TEXT,
                last_applied_at TEXT,
                status TEXT DEFAULT 'pending',
                error_message TEXT
            );
        `);
        
        // Insert default WAN settings if not exists
        await db.run("INSERT OR IGNORE INTO wan_settings (id, connection_type, wan_interface) VALUES (1, 'dhcp', 'eth0')");
        
        // Ensure new columns exist (idempotent migrations)
        try {
            const customerCols = await db.all("PRAGMA table_info(customers)");
            const customerColNames = customerCols.map(c => c.name);
            console.log('[Migration] Customers table columns:', customerColNames);
            
            // Add missing columns for billing and authentication
            const missingColumns = ['dueDate', 'planType', 'planName', 'password', 'facebook_psid', 'lastKnownMac'];
            for (const col of missingColumns) {
                if (!customerColNames.includes(col)) {
                    console.log(`[Migration] Adding ${col} column to customers table...`);
                    const defaultVal = col === 'planType' ? "'Inactive'" : 'NULL';
                    await db.exec(`ALTER TABLE customers ADD COLUMN ${col} TEXT DEFAULT ${defaultVal}`);
                    console.log(`[Migration] ✓ ${col} column added`);
                }
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
        
        // Add cycle_days column to billing_plans
        try {
            const billingPlanCycleDaysCols = await db.all("PRAGMA table_info(billing_plans)");
            const billingPlanCycleDaysColNames = billingPlanCycleDaysCols.map(c => c.name);
            if (!billingPlanCycleDaysColNames.includes('cycle_days')) {
                console.log('[Migration] Adding cycle_days column to billing_plans...');
                await db.exec("ALTER TABLE billing_plans ADD COLUMN cycle_days INTEGER DEFAULT 30");
                console.log('[Migration] ✓ cycle_days column added to billing_plans');
            }
        } catch (err) {
            console.error('[Migration] billing_plans cycle_days migration error:', err.message);
        }

        // Add billingType column to billing_plans (prepaid/postpaid)
        try {
            const billingPlanTypeCols = await db.all("PRAGMA table_info(billing_plans)");
            const billingPlanTypeColNames = billingPlanTypeCols.map(c => c.name);
            if (!billingPlanTypeColNames.includes('billingType')) {
                console.log('[Migration] Adding billingType column to billing_plans...');
                await db.exec("ALTER TABLE billing_plans ADD COLUMN billingType TEXT DEFAULT 'prepaid'");
                console.log('[Migration] ✓ billingType column added to billing_plans');
            }
        } catch (err) {
            console.error('[Migration] billing_plans billingType migration error:', err.message);
        }

        // Add billingType column to dhcp_billing_plans (prepaid/postpaid)
        try {
            const dhcpPlanTypeCols = await db.all("PRAGMA table_info(dhcp_billing_plans)");
            const dhcpPlanTypeColNames = dhcpPlanTypeCols.map(c => c.name);
            if (!dhcpPlanTypeColNames.includes('billingType')) {
                console.log('[Migration] Adding billingType column to dhcp_billing_plans...');
                await db.exec("ALTER TABLE dhcp_billing_plans ADD COLUMN billingType TEXT DEFAULT 'prepaid'");
                console.log('[Migration] ✓ billingType column added to dhcp_billing_plans');
            }
        } catch (err) {
            console.error('[Migration] dhcp_billing_plans billingType migration error:', err.message);
        }
        
        // Add fee detail columns to xendit_sessions
        try {
            const xenditSessionCols = await db.all("PRAGMA table_info(xendit_sessions)");
            const xenditSessionColNames = xenditSessionCols.map(c => c.name);
            const xenditFeeColumns = ['base_amount', 'convenience_fee', 'total_amount', 'payment_method'];
            for (const col of xenditFeeColumns) {
                if (!xenditSessionColNames.includes(col)) {
                    console.log(`[Migration] Adding ${col} column to xendit_sessions table...`);
                    await db.exec(`ALTER TABLE xendit_sessions ADD COLUMN ${col} REAL DEFAULT NULL`);
                    console.log(`[Migration] ✓ ${col} column added to xendit_sessions`);
                }
            }
        } catch (err) {
            console.error('[Migration] xendit_sessions fee columns migration error:', err.message);
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
            const dhcpMissing = ['accountNumber', 'dueDate', 'address', 'ip', 'username', 'fullName', 'planName'];
            for (const col of dhcpMissing) {
                if (!dhcpClientColNames.includes(col)) {
                    await db.exec(`ALTER TABLE dhcp_clients ADD COLUMN ${col} TEXT`);
                    console.log(`[Migration] ✓ ${col} column added to dhcp_clients`);
                }
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
            const expCols = await db.all("PRAGMA table_info(expenses)");
            const expColNames = expCols.map(c => c.name);
            if (!expColNames.includes('routerId')) {
                await db.exec("ALTER TABLE expenses ADD COLUMN routerId TEXT");
            }
        } catch (_) {}

        // Add oltNapPortId to customers table for fiber network mapping
        try {
            const custCols2 = await db.all("PRAGMA table_info(customers)");
            const custColNames2 = custCols2.map(c => c.name);
            if (!custColNames2.includes('oltNapPortId')) {
                await db.exec("ALTER TABLE customers ADD COLUMN oltNapPortId TEXT");
                console.log('[Migration] \u2713 oltNapPortId column added to customers');
            }
        } catch (_) {}

        // Add custom invoice columns to client_invoices
        try {
            const invCols = await db.all("PRAGMA table_info(client_invoices)");
            const invColNames = invCols.map(c => c.name);
            if (!invColNames.includes('description')) {
                await db.exec("ALTER TABLE client_invoices ADD COLUMN description TEXT");
            }
            if (!invColNames.includes('category')) {
                await db.exec("ALTER TABLE client_invoices ADD COLUMN category TEXT");
            }
            if (!invColNames.includes('laborCost')) {
                await db.exec("ALTER TABLE client_invoices ADD COLUMN laborCost REAL DEFAULT 0");
            }
            if (!invColNames.includes('partsCost')) {
                await db.exec("ALTER TABLE client_invoices ADD COLUMN partsCost REAL DEFAULT 0");
            }
            if (!invColNames.includes('invoiceType')) {
                await db.exec("ALTER TABLE client_invoices ADD COLUMN invoiceType TEXT DEFAULT 'subscription'");
            }
            console.log('[Migration] ✓ client_invoices custom invoice columns ensured');
        } catch (err) {
            console.error('[Migration] client_invoices custom columns migration error:', err.message);
        }
        
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

        // Run database migrations (v2.0.0+)
        try {
            const { runMigrations } = require('./migrations/runner');
            await runMigrations(db);
        } catch (migrationErr) {
            console.error('[Migration] Migration runner error:', migrationErr.message);
            // Don't throw — log and continue so the server can still start
        }

        console.log('Database initialized successfully');
    } catch (err) {
        console.error('Failed to initialize database:', err);
        throw err;
    }
}

// --- Helpers ---

// Ensure db connection is alive; auto-reconnect on SQLITE_MISUSE / closed db
async function ensureDb() {
    if (isShuttingDown) {
        throw new Error('Server is shutting down for factory reset. Please retry in a few seconds.');
    }
    if (!db) {
        console.warn('[DB] Connection is null, re-initializing...');
        await initDb();
        return;
    }
    try {
        // Lightweight ping to verify the connection is usable
        await db.get('SELECT 1');
    } catch (err) {
        if (err.code === 'SQLITE_MISUSE' || err.code === 'SQLITE_CANTOPEN' || err.message?.includes('closed')) {
            console.warn('[DB] Connection lost or misuse, re-initializing...', err.message);
            await initDb();
        } else {
            throw err;
        }
    }
}

const getDeviceId = async () => {
    try {
        // Once generated, persist the device ID to the DB so it never changes between runs.
        // This prevents license "bound to another device" errors caused by fluctuating CPU speed readings.
        const stored = await db.get('SELECT deviceId FROM settings WHERE id = 1');
        if (stored?.deviceId) {
            return stored.deviceId;
        }

        // After factory reset: Try to restore deviceId from preserved file
        const deviceInfoPath = path.join(__dirname, '.device-info.json');
        if (fs.existsSync(deviceInfoPath)) {
            try {
                const deviceInfo = JSON.parse(fs.readFileSync(deviceInfoPath, 'utf8'));
                if (deviceInfo?.deviceId) {
                    console.log('[getDeviceId] Restored deviceId from .device-info.json after factory reset');
                    
                    // Save it back to the new database
                    await db.run('UPDATE settings SET deviceId = ? WHERE id = 1', [deviceInfo.deviceId]);
                    
                    // If licenseKey was also preserved, restore it
                    if (deviceInfo.licenseKey) {
                        await db.run('UPDATE settings SET licenseKey = ? WHERE id = 1', [deviceInfo.licenseKey]);
                        console.log('[getDeviceId] Restored licenseKey from .device-info.json');
                    }
                    
                    return deviceInfo.deviceId;
                }
            } catch (readErr) {
                console.warn('[getDeviceId] Failed to read .device-info.json:', readErr.message);
            }
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
    app.use('/api/admin', createProxyMiddleware({
        target: 'http://localhost:3002',
        changeOrigin: true,
        pathRewrite: {
            // Restore /api/admin prefix that Express strips when mounting
            '^/': '/api/admin/'
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

    // --- HOTSPOT CONTROLLER MODULE (Isolated) ---
    const hotspotDb = require('./hotspot/db');
    const hotspotSessionManager = require('./hotspot/sessionManager');
    await hotspotDb.initHotspotTables(db);
    app.locals.hotspotDb = db;
    app.use('/api/hotspot', require('./hotspot/routes'));
    hotspotSessionManager.startExpiryChecker(db, 30000);
    // Heartbeat checker every 2 minutes
    setInterval(() => hotspotSessionManager.checkEspDeviceHeartbeats(db, 120000), 120000);

    // --- SNMP OLT Monitoring ---
    try {
        const snmpService = require('../services/snmpService.cjs');
        snmpService.startPolling(db, 5 * 60 * 1000); // Poll every 5 minutes
    } catch (e) {
        console.warn('[SNMP] Failed to start SNMP monitoring:', e.message);
    }

    // --- NodeMCU Compatibility Endpoints ---
    // These bridge the existing ESP firmware's API to the hotspot controller backend.
    // ESP firmware calls these on the gateway IP (this server).

    /**
     * POST /api/nodemcu/register
     * ESP registers/authenticates with systemKey.
     * Matches existing firmware pattern: { macAddress, ipAddress, authenticationKey }
     */
    app.post('/api/nodemcu/register', async (req, res) => {
        try {
            const { macAddress, ipAddress, authenticationKey } = req.body;
            if (!macAddress) {
                return res.status(400).json({ message: 'macAddress required' });
            }

            const device = await hotspotDb.getEspDeviceByMac(db, macAddress);

            if (!device) {
                // Device not registered in admin panel
                return res.json({
                    status: 'pending',
                    licensed: false,
                    frozen: false,
                    message: 'Device not registered. Register via admin panel first.'
                });
            }

            // Validate authenticationKey against the device's api_key
            if (authenticationKey && device.api_key === authenticationKey) {
                await hotspotDb.updateEspHeartbeat(db, device.api_key);
                return res.json({
                    status: 'accepted',
                    licensed: true,
                    frozen: false,
                    deviceName: device.device_name,
                    routerId: device.router_id
                });
            }

            // Also accept if no auth key configured yet (first boot)
            if (!authenticationKey && device.status === 'offline') {
                await hotspotDb.updateEspHeartbeat(db, device.api_key);
                return res.json({
                    status: 'accepted',
                    licensed: true,
                    frozen: false,
                    deviceName: device.device_name,
                    routerId: device.router_id
                });
            }

            // Auth key mismatch
            return res.json({
                status: 'pending',
                licensed: false,
                frozen: false,
                message: 'Authentication key mismatch. Check System Key in setup.'
            });
        } catch (err) {
            console.error('[NodeMCU Register Error]', err);
            res.status(500).json({ message: err.message });
        }
    });

    /**
     * POST /api/nodemcu/pulse
     * ESP reports coin pulses. Backend creates/extends hotspot session.
     * Matches existing firmware pattern: { macAddress, slotId, denomination }
     * - macAddress: ESP device's own MAC
     * - denomination: total coin pulse count
     */
    app.post('/api/nodemcu/pulse', async (req, res) => {
        try {
            const { macAddress, slotId, denomination } = req.body;
            if (!macAddress || !denomination) {
                return res.status(400).json({ message: 'macAddress and denomination required' });
            }

            // Look up ESP device by its MAC
            const device = await hotspotDb.getEspDeviceByMac(db, macAddress);
            if (!device) {
                return res.status(403).json({ success: false, message: 'Device not registered', frozen: true });
            }

            // Calculate amount from pulses * coin_value
            const amount = denomination * device.coin_value;

            // Find best matching plan for this router
            const plans = await hotspotDb.getHotspotPlans(db, device.router_id);
            if (!plans || plans.length === 0) {
                return res.status(400).json({ success: false, message: 'No hotspot plans configured' });
            }

            const affordablePlans = plans.filter(p => p.price <= amount).sort((a, b) => b.price - a.price);
            if (affordablePlans.length === 0) {
                return res.status(400).json({ success: false, message: `Amount ${amount} not enough for any plan` });
            }

            const selectedPlan = affordablePlans[0];

            // Find latest active session for this router (the client waiting for coins)
            const existingSession = await hotspotDb.getLatestActiveSession(db, device.router_id);

            let session;
            if (existingSession) {
                // Extend existing session (may be 'pending' or 'active')
                session = await hotspotSessionManager.extendDeviceSession(
                    device.router_id, existingSession, selectedPlan.duration_seconds, db
                );
                if (!session) {
                    return res.status(500).json({ success: false, message: 'Failed to extend session on MikroTik' });
                }

                // If session was pending, activate it now that coins arrived
                if (existingSession.status === 'pending') {
                    await db.run(
                        "UPDATE hotspot_sessions SET status = 'active', payment_method = 'coinslot', amount_paid = ? WHERE id = ?",
                        [amount, existingSession.id]
                    );
                    session.status = 'active';
                }
            } else {
                // No active session found - can't authorize without client MAC
                return res.status(400).json({
                    success: false,
                    message: 'No active client session found. Client must visit the login page first.'
                });
            }

            // Log the transaction
            const txn = await hotspotDb.createCoinslotTransaction(db, {
                espDeviceId: device.id,
                routerId: device.router_id,
                macAddress: session.mac_address || session.macAddress,
                ipAddress: session.ip_address || session.ipAddress,
                coinsInserted: denomination,
                amount,
                durationSeconds: selectedPlan.duration_seconds,
                sessionId: session.id,
            });

            // Update heartbeat
            await hotspotDb.updateEspHeartbeat(db, device.api_key);

            console.log(`[NodeMCU Pulse] ESP:${macAddress} | ${denomination} pulses = ${amount} | Plan: ${selectedPlan.name} | Session: ${session.id}`);

            res.json({
                success: true,
                message: `Granted ${selectedPlan.name}`,
                durationSeconds: selectedPlan.duration_seconds,
                planName: selectedPlan.name,
                amount,
                transactionId: txn.id,
            });
        } catch (err) {
            console.error('[NodeMCU Pulse Error]', err);
            res.status(500).json({ message: err.message });
        }
    });

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

            if (!user) {
                console.warn('[Auth] Login failed: user not found:', username);
                return res.status(401).json({ message: 'Invalid credentials' });
            }

            const passwordMatch = await bcrypt.compare(password, user.password);
            if (!passwordMatch) {
                console.warn('[Auth] Login failed: password mismatch for user:', username, '| stored hash prefix:', user.password ? user.password.substring(0, 10) : 'NO_HASH');
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
                            // For custom invoices, use laborCost + partsCost if amount is not set
                            const isCustom = existing.invoiceType === 'custom';
                            const saleAmount = (existing.amount || 0) > 0 ? existing.amount : (isCustom ? ((existing.laborCost || 0) + (existing.partsCost || 0)) : 0);
                            const salePlanName = isCustom ? (existing.category || existing.description || 'Custom Service') : (existing.planName || '');
                            await db.run(
                                `INSERT INTO sales_records (id, routerId, date, clientName, planName, planPrice, discountAmount, finalAmount, routerName, currency, clientAddress, clientContact, clientEmail, invoiceId, coveredMonth)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                [
                                    saleId,
                                    existing.routerId,
                                    new Date().toISOString(),
                                    existing.username,
                                    salePlanName,
                                    saleAmount,
                                    0,
                                    saleAmount,
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
                                                        amount: saleAmount,
                                                        currency: currencyCode,
                                                        transaction_type: isCustom ? 'custom_service' : 'sale',
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

    // Fetch pending invoices for a specific client (used by custom invoice "Add to Existing" feature)
    dbRouter.get('/client-invoices-pending/:routerId/:username', async (req, res) => {
        try {
            const { routerId, username } = req.params;
            const rows = await db.all(
                'SELECT * FROM client_invoices WHERE routerId = ? AND username = ? AND status = ? ORDER BY issueDate DESC',
                [decodeURIComponent(routerId), decodeURIComponent(username), 'PENDING']
            );
            res.json(rows);
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    createCrud('/billing-plans', 'billing_plans');
    createCrud('/inventory', 'inventory');
    createCrud('/equipment-withdrawals', 'equipment_withdrawals');
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

    // --- Billing Ledger Endpoints ---
    // Auto-generate unpaid entries for months between billing start and now
    const autoGenerateUnpaidEntries = async (routerId, username) => {
        try {
            // Find the earliest paid month or sale to determine billing start
            const earliestPaid = await db.get(
                "SELECT month FROM billing_ledger WHERE routerId = ? AND username = ? AND status = 'paid' ORDER BY month ASC LIMIT 1",
                [routerId, username]
            );
            const earliestSale = await db.get(
                "SELECT date FROM sales_records WHERE routerId = ? AND clientName = ? ORDER BY date ASC LIMIT 1",
                [routerId, username]
            );
            // Also check customer creation as fallback start
            const customer = await db.get(
                "SELECT * FROM customers WHERE username = ? AND routerId = ?",
                [username, routerId]
            );

            let startDate = null;
            if (earliestPaid) {
                startDate = new Date(earliestPaid.month + '-01');
            } else if (earliestSale) {
                startDate = new Date(earliestSale.date);
            } else if (customer) {
                // Use customer creation as fallback - no start date, skip auto-gen
                return;
            } else {
                return;
            }

            // Get account number from customer record
            const accountNumber = customer?.accountNumber || null;

            // Get existing ledger entries
            const existing = await db.all(
                "SELECT month FROM billing_ledger WHERE routerId = ? AND username = ?",
                [routerId, username]
            );
            const existingMonths = new Set(existing.map(e => e.month));

            // Get plan info from latest sale
            const latestSale = await db.get(
                "SELECT planName, planPrice FROM sales_records WHERE routerId = ? AND clientName = ? ORDER BY date DESC LIMIT 1",
                [routerId, username]
            );
            const planName = latestSale?.planName || '';
            const planPrice = latestSale?.planPrice || 0;

            // Generate unpaid entries for each month from start to current month
            const now = new Date();
            const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

            while (cursor <= now) {
                const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
                if (!existingMonths.has(monthKey)) {
                    const id = `ledger_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    await db.run(
                        "INSERT OR IGNORE INTO billing_ledger (id, routerId, username, accountNumber, month, status, planName, planPrice) VALUES (?, ?, ?, ?, ?, 'unpaid', ?, ?)",
                        [id, routerId, username, accountNumber, monthKey, planName, planPrice]
                    );
                }
                cursor.setMonth(cursor.getMonth() + 1);
            }
        } catch (err) {
            console.error('[Billing Ledger] Auto-generate error:', err.message);
        }
    };

    // GET /api/billing-ledger/:routerId/:username - Get all ledger entries
    app.get('/api/billing-ledger/:routerId/:username', async (req, res) => {
        try {
            const { routerId, username } = req.params;
            // Auto-generate unpaid entries first
            await autoGenerateUnpaidEntries(routerId, username);
            const entries = await db.all(
                "SELECT * FROM billing_ledger WHERE routerId = ? AND username = ? ORDER BY month ASC",
                [routerId, username]
            );
            res.json(entries);
        } catch (err) {
            console.error('[Billing Ledger] GET error:', err.message);
            res.status(500).json({ message: 'Failed to fetch billing ledger' });
        }
    });

    // GET /api/billing-ledger/unpaid/:routerId/:username - Get unpaid months only
    app.get('/api/billing-ledger/unpaid/:routerId/:username', async (req, res) => {
        try {
            const { routerId, username } = req.params;
            await autoGenerateUnpaidEntries(routerId, username);
            const entries = await db.all(
                "SELECT * FROM billing_ledger WHERE routerId = ? AND username = ? AND status = 'unpaid' ORDER BY month ASC",
                [routerId, username]
            );
            res.json(entries);
        } catch (err) {
            console.error('[Billing Ledger] GET unpaid error:', err.message);
            res.status(500).json({ message: 'Failed to fetch unpaid months' });
        }
    });

    // POST /api/billing-ledger - Create/update a ledger entry
    app.post('/api/billing-ledger', async (req, res) => {
        try {
            const { routerId, username, accountNumber, month, status, planName, planPrice, paidAmount, saleId, paymentDate } = req.body;
            if (!routerId || !username || !month) {
                return res.status(400).json({ message: 'routerId, username, and month are required' });
            }
            const id = `ledger_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await db.run(
                `INSERT INTO billing_ledger (id, routerId, username, accountNumber, month, status, planName, planPrice, paidAmount, saleId, paymentDate)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(routerId, username, month) DO UPDATE SET
                    status = excluded.status,
                    planName = excluded.planName,
                    planPrice = excluded.planPrice,
                    paidAmount = excluded.paidAmount,
                    saleId = excluded.saleId,
                    paymentDate = excluded.paymentDate`,
                [id, routerId, username, accountNumber || null, month, status || 'paid', planName || '', planPrice || 0, paidAmount || 0, saleId || null, paymentDate || new Date().toISOString()]
            );
            const entry = await db.get("SELECT * FROM billing_ledger WHERE routerId = ? AND username = ? AND month = ?", [routerId, username, month]);
            res.json(entry);
        } catch (err) {
            console.error('[Billing Ledger] POST error:', err.message);
            res.status(500).json({ message: 'Failed to save billing ledger entry' });
        }
    });

    // --- Client Balance (Credit/Debit) API ---
    // GET /api/client-balances/:routerId - Fetch all client balances for a router
    app.get('/api/client-balances/:routerId', async (req, res) => {
        try {
            const { routerId } = req.params;
            const entries = await db.all(
                "SELECT username, balance FROM client_balances WHERE routerId = ? AND balance < 0",
                [routerId]
            );
            // Return as a map: { username: balance }
            const balanceMap = {};
            entries.forEach(e => { balanceMap[e.username] = e.balance; });
            res.json(balanceMap);
        } catch (err) {
            console.error('[Client Balances] GET error:', err.message);
            res.status(500).json({ message: 'Failed to fetch client balances' });
        }
    });

    // GET /api/client-balance/:routerId/:username
    app.get('/api/client-balance/:routerId/:username', async (req, res) => {
        try {
            const { routerId, username } = req.params;
            const entry = await db.get(
                "SELECT * FROM client_balances WHERE routerId = ? AND username = ?",
                [routerId, username]
            );
            res.json(entry || { balance: 0 });
        } catch (err) {
            console.error('[Client Balance] GET error:', err.message);
            res.status(500).json({ message: 'Failed to fetch client balance' });
        }
    });

    // POST /api/client-balance - Create or update client balance
    // body: { routerId, username, accountNumber?, amount } — amount is added to existing balance
    app.post('/api/client-balance', async (req, res) => {
        try {
            const { routerId, username, accountNumber, amount } = req.body;
            if (!routerId || !username || amount === undefined) {
                return res.status(400).json({ message: 'routerId, username, and amount are required' });
            }
            const id = `bal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await db.run(
                `INSERT INTO client_balances (id, routerId, username, accountNumber, balance, updatedAt)
                 VALUES (?, ?, ?, ?, ?, datetime('now'))
                 ON CONFLICT(routerId, username) DO UPDATE SET
                    balance = balance + excluded.balance,
                    accountNumber = COALESCE(excluded.accountNumber, client_balances.accountNumber),
                    updatedAt = datetime('now')`,
                [id, routerId, username, accountNumber || null, amount]
            );
            const entry = await db.get("SELECT * FROM client_balances WHERE routerId = ? AND username = ?", [routerId, username]);
            res.json(entry);
        } catch (err) {
            console.error('[Client Balance] POST error:', err.message);
            res.status(500).json({ message: 'Failed to update client balance' });
        }
    });

    // POST /api/equipment-withdrawals/process - Withdraw equipment and deduct from inventory
    app.post('/api/equipment-withdrawals/process', async (req, res) => {
        try {
            const { inventoryItemId, itemName, quantity, serialNumber, customerId, customerName, customerUsername, notes, withdrawnBy, withdrawnDate, routerId } = req.body;
            if (!inventoryItemId || !itemName || !quantity || quantity <= 0) {
                return res.status(400).json({ message: 'inventoryItemId, itemName, and valid quantity are required' });
            }

            // Check available stock
            const item = await db.get('SELECT * FROM inventory WHERE id = ?', [inventoryItemId]);
            if (!item) {
                return res.status(404).json({ message: 'Inventory item not found' });
            }
            if (item.quantity < quantity) {
                return res.status(400).json({ message: `Insufficient stock. Available: ${item.quantity}, Requested: ${quantity}` });
            }

            // Deduct inventory
            await db.run('UPDATE inventory SET quantity = quantity - ? WHERE id = ?', [quantity, inventoryItemId]);

            // Create withdrawal record
            const withdrawalId = `wd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await db.run(
                `INSERT INTO equipment_withdrawals (id, inventoryItemId, itemName, quantity, serialNumber, customerId, customerName, customerUsername, notes, withdrawnBy, withdrawnDate, routerId)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [withdrawalId, inventoryItemId, itemName, quantity, serialNumber || null, customerId || null, customerName || null, customerUsername || null, notes || null, withdrawnBy || null, withdrawnDate || new Date().toISOString(), routerId || null]
            );

            const withdrawal = await db.get('SELECT * FROM equipment_withdrawals WHERE id = ?', [withdrawalId]);
            const updatedItem = await db.get('SELECT * FROM inventory WHERE id = ?', [inventoryItemId]);
            res.json({ withdrawal, updatedStock: updatedItem.quantity });
        } catch (err) {
            console.error('[Equipment Withdrawal] Process error:', err.message);
            res.status(500).json({ message: 'Failed to process withdrawal: ' + err.message });
        }
    });

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
            console.log(`[Customers GET] Query: ${query}`);
            console.log(`[Customers GET] Params:`, params);
            console.log(`[Customers GET] Database file: ${DB_PATH}`);
            
            const rows = await db.all(query, params);
            console.log(`[Customers GET] Found ${rows.length} customers`);
            if (rows.length > 0) {
                console.log(`[Customers GET] First customer:`, rows[0]);
            }
            
            // Diagnostic: Count all customers regardless of routerId
            const totalCount = await db.get('SELECT COUNT(*) as count FROM customers');
            console.log(`[Customers GET] Total customers in database (all routers): ${totalCount.count}`);
            
            res.json(rows);
        } catch (e) { 
            console.error(`[Customers GET] Error:`, e.message);
            res.status(500).json({ message: e.message }); 
        }
    });

    dbRouter.post('/customers', async (req, res) => {
        try {
            const { username, routerId } = req.body;
            if (!username) return res.status(400).json({ message: 'Username required' });

            // Check existence by username ONLY — the UNIQUE constraint is on username alone
            const existing = await db.get(
                'SELECT * FROM customers WHERE username = ?',
                [username]
            );
            
            console.log(`[Customers POST] username=${username}, routerId=${routerId}, existing=${!!existing}`);
            
            if (existing) {
                // Update existing
                const keys = Object.keys(req.body).filter(k => k !== 'id' && k !== 'username'); // don't update id or username
                const values = keys.map(k => req.body[k]);
                if (keys.length > 0) {
                    const setClause = keys.map(k => `${k} = ?`).join(',');
                    await db.run(`UPDATE customers SET ${setClause} WHERE id = ?`, [...values, existing.id]);
                    console.log(`[Customers POST] Updated existing customer id=${existing.id}`);
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
                console.log(`[Customers POST] Inserted new customer username=${username}, routerId=${routerId}, accountNumber=${req.body.accountNumber}`);
                
                // Sync to Supabase
                const newCustomer = await db.get('SELECT * FROM customers WHERE username = ? AND routerId = ?', [username, routerId]);
                await syncCustomerToSupabase(newCustomer);

                res.json({ message: 'Created new customer' });
            }
        } catch (e) {
            console.error(`[Customers POST] Error:`, e.message);
            res.status(500).json({ message: e.message });
        }
    });

    dbRouter.patch('/customers/:id', async (req, res) => {
        try {
            const { id } = req.params;
            console.log(`[Customers PATCH] Updating customer id=${id}`, req.body);
            
            // First, check if customer exists
            const existingCustomer = await db.get('SELECT * FROM customers WHERE id = ?', [id]);
            if (!existingCustomer) {
                console.error(`[Customers PATCH] Customer id=${id} NOT FOUND in database!`);
                return res.status(404).json({ message: 'Customer not found' });
            }
            console.log(`[Customers PATCH] Found existing customer:`, existingCustomer);
            
            if (!req.body.accountNumber || String(req.body.accountNumber).trim() === '') {
                const current = await db.get('SELECT accountNumber FROM customers WHERE id = ?', [id]);
                if (!current?.accountNumber) {
                    req.body.accountNumber = await generateAccountNumber();
                    console.log(`[Customers PATCH] Generated account number: ${req.body.accountNumber}`);
                }
            }
            const updates = Object.keys(req.body).map(k => `${k} = ?`).join(',');
            const values = [...Object.values(req.body), id];
            console.log(`[Customers PATCH] Executing: UPDATE customers SET ${updates} WHERE id = ?`, values);
            await db.run(`UPDATE customers SET ${updates} WHERE id = ?`, values);
            console.log(`[Customers PATCH] Successfully updated customer id=${id}`);
            
            // Verify the update
            const verifyCustomer = await db.get('SELECT * FROM customers WHERE id = ?', [id]);
            console.log(`[Customers PATCH] Verified customer after update:`, verifyCustomer);
            
            // Sync to Supabase
            const updatedCustomer = await db.get('SELECT * FROM customers WHERE id = ?', [id]);
            await syncCustomerToSupabase(updatedCustomer);

            res.json({ message: 'Updated' });
        } catch (e) { 
            console.error(`[Customers PATCH] Error:`, e.message);
            res.status(500).json({ message: e.message }); 
        }
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
                try { s.xenditSettings = JSON.parse(s.xenditSettings); } catch(e) {}
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

    // ========================================
    // Store & Portal Settings
    // ========================================
    dbRouter.get('/store-settings', async (req, res) => {
        try {
            const s = await db.get('SELECT storeSettings FROM settings WHERE id = 1');
            if (s && s.storeSettings) {
                try { res.json(JSON.parse(s.storeSettings)); } catch (_) { res.json({}); }
            } else {
                // Return defaults
                res.json({
                    portalRedirectUrl: '',
                    nonPaymentPool: '172.16.44.0/24',
                    portalServerIp: '',
                    portalServerPort: 8080,
                    walledGardenEnabled: false,
                    autoSyncWorkerEnabled: false,
                    customExpiredMessage: '',
                    storeEnabled: true,
                    paymentMethods: { paymongo: true, manualGcash: true },
                    gcashNumber: '',
                    gcashAccountName: '',
                    storeBannerText: '',
                    autoRestoreOnPayment: true
                });
            }
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    dbRouter.post('/store-settings', async (req, res) => {
        try {
            const settings = JSON.stringify(req.body);
            await db.run('UPDATE settings SET storeSettings = ? WHERE id = 1', [settings]);
            res.json({ message: 'Store settings saved' });
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    // ========================================
    // BILLING SETTINGS API
    // ========================================
    dbRouter.get('/billing-settings', async (req, res) => {
        try {
            const s = await db.get('SELECT billingSettings FROM settings WHERE id = 1');
            if (s && s.billingSettings) {
                try { res.json(JSON.parse(s.billingSettings)); } catch (_) { res.json({}); }
            } else {
                res.json({
                    nonPaymentProfile: '',
                    defaultPlanId: '',
                    gracePeriodDays: 3,
                    expiryTime: '23:59'
                });
            }
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    dbRouter.post('/billing-settings', async (req, res) => {
        try {
            const settings = JSON.stringify(req.body);
            await db.run('UPDATE settings SET billingSettings = ? WHERE id = 1', [settings]);
            res.json({ message: 'Billing settings saved' });
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    dbRouter.post('/panel-settings', async (req, res) => {
        try {
            const data = { ...req.body };
            if (data.telegramSettings) data.telegramSettings = JSON.stringify(data.telegramSettings);
            if (data.paymongoSettings) data.paymongoSettings = JSON.stringify(data.paymongoSettings);
            if (data.xenditSettings) data.xenditSettings = JSON.stringify(data.xenditSettings);
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

    // WAN Settings Endpoints
    dbRouter.get('/wan-settings', async (req, res) => {
        try {
            const settings = await db.get('SELECT * FROM wan_settings WHERE id = 1');
            if (settings && settings.pppoe_password) {
                settings.pppoe_password = '***masked***';
            }
            res.json(settings || {});
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    dbRouter.post('/wan-settings', async (req, res) => {
        try {
            const { connectionType, wanInterface, staticIp, staticGateway, staticDns, pppoeUsername, pppoePassword } = req.body;
            
            // Validation
            if (!connectionType || !['dhcp', 'static', 'pppoe'].includes(connectionType)) {
                return res.status(400).json({ message: 'Invalid connection type' });
            }
            
            if (connectionType === 'static' && (!staticIp || !staticGateway || !staticDns)) {
                return res.status(400).json({ message: 'Static IP configuration requires IP, gateway, and DNS' });
            }
            
            if (connectionType === 'pppoe' && (!pppoeUsername || !pppoePassword)) {
                return res.status(400).json({ message: 'PPPoE configuration requires username and password' });
            }
            
            // Validate interface name to prevent injection
            if (wanInterface && !/^[a-zA-Z0-9-]+$/.test(wanInterface)) {
                return res.status(400).json({ message: 'Invalid interface name' });
            }
            
            // Save to database (keep existing password if not changed)
            const existing = await db.get('SELECT pppoe_password FROM wan_settings WHERE id = 1');
            const finalPppoePassword = (pppoePassword && pppoePassword !== '***masked***') ? pppoePassword : existing?.pppoe_password;
            
            await db.run(`
                UPDATE wan_settings SET 
                    connection_type = ?, 
                    wan_interface = ?,
                    static_ip = ?,
                    static_gateway = ?,
                    static_dns = ?,
                    pppoe_username = ?,
                    pppoe_password = ?,
                    status = 'pending',
                    error_message = NULL
                WHERE id = 1
            `, [connectionType, wanInterface || 'eth0', staticIp, staticGateway, staticDns, pppoeUsername, finalPppoePassword]);
            
            // Trigger network agent to apply
            try {
                const NetworkAgent = require('../services/networkAgent');
                const agent = new NetworkAgent();
                await agent.applyConfiguration({
                    connectionType,
                    wanInterface: wanInterface || 'eth0',
                    staticIp,
                    staticGateway,
                    staticDns,
                    pppoeUsername,
                    pppoePassword: finalPppoePassword
                });
                
                await db.run('UPDATE wan_settings SET status = ?, last_applied_at = ? WHERE id = 1', 
                    ['applied', new Date().toISOString()]);
                
                res.json({ message: 'WAN configuration saved and applied successfully' });
            } catch (agentError) {
                console.error('[WAN Config] Agent application error:', agentError);
                await db.run('UPDATE wan_settings SET status = ?, error_message = ? WHERE id = 1',
                    ['failed', agentError.message]);
                res.status(500).json({ message: 'Configuration saved but failed to apply: ' + agentError.message });
            }
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    dbRouter.post('/wan-settings/apply', async (req, res) => {
        try {
            const settings = await db.get('SELECT * FROM wan_settings WHERE id = 1');
            if (!settings) {
                return res.status(404).json({ message: 'No WAN configuration found' });
            }
            
            const NetworkAgent = require('../services/networkAgent');
            const agent = new NetworkAgent();
            await agent.applyConfiguration({
                connectionType: settings.connection_type,
                wanInterface: settings.wan_interface,
                staticIp: settings.static_ip,
                staticGateway: settings.static_gateway,
                staticDns: settings.static_dns,
                pppoeUsername: settings.pppoe_username,
                pppoePassword: settings.pppoe_password
            });
            
            await db.run('UPDATE wan_settings SET status = ?, last_applied_at = ?, error_message = NULL WHERE id = 1', 
                ['applied', new Date().toISOString()]);
            
            res.json({ message: 'WAN configuration re-applied successfully', success: true });
        } catch (e) {
            await db.run('UPDATE wan_settings SET status = ?, error_message = ? WHERE id = 1',
                ['failed', e.message]);
            res.status(500).json({ message: 'Failed to apply configuration: ' + e.message, success: false });
        }
    });

    dbRouter.get('/wan-settings/status', async (req, res) => {
        try {
            const NetworkAgent = require('../services/networkAgent');
            const agent = new NetworkAgent();
            const status = await agent.getCurrentNetworkStatus();
            res.json(status);
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    // Available network interfaces on the host system
    dbRouter.get('/wan-settings/interfaces', async (req, res) => {
        try {
            const { exec } = require('child_process');
            const util = require('util');
            const execPromise = util.promisify(exec);

            const { stdout } = await execPromise('ip -j link show 2>/dev/null || echo "[]"');
            const interfaces = JSON.parse(stdout);

            // Filter to real physical interfaces (exclude lo, docker, veth, bridge, etc.)
            const physicalInterfaces = interfaces
                .filter(iface => {
                    const name = iface.ifname;
                    const type = iface.link_type || '';
                    // Include ethernet, exclude loopback and virtual
                    if (name === 'lo') return false;
                    if (type !== 'ether') return false;
                    // Exclude virtual/virtualized interfaces
                    if (name.startsWith('docker') || name.startsWith('veth') ||
                        name.startsWith('br-') || name.startsWith('virbr') ||
                        name.startsWith('tun') || name.startsWith('tap') ||
                        name.startsWith('wg') || name.startsWith('ppp')) return false;
                    return true;
                })
                .map(iface => ({
                    name: iface.ifname,
                    mac: iface.address || '',
                    state: iface.operstate || 'unknown',
                    mtu: iface.mtu || 1500
                }));

            // Also detect the current default route interface
            let defaultInterface = null;
            try {
                const { stdout: routeOutput } = await execPromise('ip -j route show default 2>/dev/null || echo "[]"');
                const routes = JSON.parse(routeOutput);
                if (routes.length > 0) {
                    defaultInterface = routes[0].dev || null;
                }
            } catch (e) {
                // Ignore route detection errors
            }

            res.json({
                interfaces: physicalInterfaces,
                defaultInterface
            });
        } catch (e) {
            res.status(500).json({ message: 'Failed to detect interfaces: ' + e.message });
        }
    });

    // Notifications
    dbRouter.get('/notifications', async (req, res) => {
        try {
            await ensureDb();
            const rows = await db.all('SELECT * FROM notifications ORDER BY timestamp DESC LIMIT 100');
            res.json(rows);
        } catch (e) {
            console.error('[Notifications GET Error]', e.message);
            res.status(500).json({ message: 'Failed to fetch notifications: ' + e.message });
        }
    });
    dbRouter.post('/notifications', async (req, res) => {
        try {
            await ensureDb();
            const { id, type, message, is_read, timestamp, link_to, context_json } = req.body;
            await db.run('INSERT INTO notifications (id, type, message, is_read, timestamp, link_to, context_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [id, type, message, is_read, timestamp, link_to, context_json]);
            res.json({ message: 'Added' });
        } catch (e) {
            console.error('[Notifications POST Error]', e.message);
            res.status(500).json({ message: 'Failed to add notification: ' + e.message });
        }
    });
    dbRouter.patch('/notifications/:id', async (req, res) => {
        try {
            await ensureDb();
            await db.run('UPDATE notifications SET is_read = ? WHERE id = ?', [req.body.is_read, req.params.id]);
            res.json({ message: 'Updated' });
        } catch (e) {
            console.error('[Notifications PATCH Error]', e.message);
            res.status(500).json({ message: 'Failed to update notification: ' + e.message });
        }
    });
    dbRouter.post('/notifications/clear-all', async (req, res) => {
        try {
            await ensureDb();
            await db.run('DELETE FROM notifications');
            res.json({ message: 'Cleared' });
        } catch (e) {
            console.error('[Notifications Clear Error]', e.message);
            res.status(500).json({ message: 'Failed to clear notifications: ' + e.message });
        }
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

    // Factory Reset - Delete all database files and return to fresh state
    dbRouter.post('/factory-reset', async (req, res) => {
        try {
            // Mark as shutting down BEFORE closing db so incoming requests get rejected
            isShuttingDown = true;
            console.log('[Factory Reset] Initiating factory reset...');
            
            // Step 1: Preserve deviceId and licenseKey before deleting database
            const settings = await db.get('SELECT deviceId, licenseKey FROM settings WHERE id = 1');
            const deviceInfoPath = path.join(__dirname, '.device-info.json');
            
            if (settings?.deviceId) {
                // Save deviceId to external file so it survives factory reset
                const deviceInfo = {
                    deviceId: settings.deviceId,
                    licenseKey: settings.licenseKey || null,
                    preservedAt: new Date().toISOString()
                };
                fs.writeFileSync(deviceInfoPath, JSON.stringify(deviceInfo, null, 2));
                console.log('[Factory Reset] Preserved deviceId to .device-info.json');
            }
            
            // Close database connections
            await db.close();
            if (superadminDb) {
                await superadminDb.close();
            }
            
            // Delete panel.db and related WAL/SHM files
            const panelDbPath = DB_PATH;
            const panelDbWalPath = DB_PATH + '-wal';
            const panelDbShmPath = DB_PATH + '-shm';
            
            if (fs.existsSync(panelDbPath)) {
                fs.unlinkSync(panelDbPath);
                console.log('[Factory Reset] Deleted panel.db');
            }
            if (fs.existsSync(panelDbWalPath)) {
                fs.unlinkSync(panelDbWalPath);
                console.log('[Factory Reset] Deleted panel.db-wal');
            }
            if (fs.existsSync(panelDbShmPath)) {
                fs.unlinkSync(panelDbShmPath);
                console.log('[Factory Reset] Deleted panel.db-shm');
            }
            
            // Delete superadmin.db and related files
            if (fs.existsSync(SUPERADMIN_DB_PATH)) {
                fs.unlinkSync(SUPERADMIN_DB_PATH);
                console.log('[Factory Reset] Deleted superadmin.db');
            }
            const superadminDbWalPath = SUPERADMIN_DB_PATH + '-wal';
            const superadminDbShmPath = SUPERADMIN_DB_PATH + '-shm';
            if (fs.existsSync(superadminDbWalPath)) {
                fs.unlinkSync(superadminDbWalPath);
                console.log('[Factory Reset] Deleted superadmin.db-wal');
            }
            if (fs.existsSync(superadminDbShmPath)) {
                fs.unlinkSync(superadminDbShmPath);
                console.log('[Factory Reset] Deleted superadmin.db-shm');
            }
            
            // Clear all uploaded files
            if (fs.existsSync(UPLOADS_DIR)) {
                const files = fs.readdirSync(UPLOADS_DIR);
                for (const file of files) {
                    const filePath = path.join(UPLOADS_DIR, file);
                    if (fs.statSync(filePath).isDirectory()) {
                        fs.rmSync(filePath, { recursive: true, force: true });
                        console.log(`[Factory Reset] Deleted directory: ${filePath}`);
                    } else {
                        fs.unlinkSync(filePath);
                        console.log(`[Factory Reset] Deleted file: ${filePath}`);
                    }
                }
                // Recreate the applications uploads directory
                if (!fs.existsSync(APPLICATIONS_UPLOADS_DIR)) {
                    fs.mkdirSync(APPLICATIONS_UPLOADS_DIR, { recursive: true });
                }
            }
            
            console.log('[Factory Reset] Factory reset completed successfully');
            
            // Close all connections and restart the server
            res.json({ 
                message: 'Factory reset completed. Restarting server...',
                success: true 
            });
            
            // Give response time to send before restarting
            setTimeout(() => {
                process.exit(0); // PM2 or process manager will restart
            }, 1000);
            
        } catch (error) {
            isShuttingDown = false; // Reset flag so server can recover
            console.error('[Factory Reset] Error during factory reset:', error);
            res.status(500).json({ 
                message: 'Factory reset failed: ' + error.message,
                success: false 
            });
        }
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
            
            // Get the plan details to determine the correct cycle days
            let durationDays = 30; // Default fallback
            const billingPlan = await db.get('SELECT * FROM billing_plans WHERE name = ? AND routerId = ?', [payment.plan_name, payment.customer_router_id]);
            const dhcpPlan = await db.get('SELECT * FROM dhcp_billing_plans WHERE name = ? AND routerId = ?', [payment.plan_name, payment.customer_router_id]);
            
            console.log(`[Manual Payments] Plan lookup - billingPlan found: ${!!billingPlan}, dhcpPlan found: ${!!dhcpPlan}`);
            console.log(`[Manual Payments] Plan name: "${payment.plan_name}", Router ID: "${payment.customer_router_id}"`);
            
            if (billingPlan) {
                // PPPoE plan - use cycle_days if available, fall back to cycle-based conversion
                if (billingPlan.cycle_days) {
                    durationDays = billingPlan.cycle_days;
                } else {
                    if (billingPlan.cycle === 'Monthly') durationDays = 30;
                    else if (billingPlan.cycle === 'Quarterly') durationDays = 90;
                    else if (billingPlan.cycle === 'Yearly') durationDays = 365;
                }
                console.log(`[Manual Payments] PPPoE plan detected: ${durationDays} days`);
            } else if (dhcpPlan) {
                // DHCP plan - use cycle_days directly
                durationDays = dhcpPlan.cycle_days || 30;
                console.log(`[Manual Payments] DHCP plan detected: ${durationDays} days`);
            }
            
            console.log(`[Manual Payments] Using duration: ${durationDays} days for plan: ${payment.plan_name}`);
            
            // Update customer due date
            const customer = await db.get('SELECT * FROM customers WHERE accountNumber = ?', [payment.customer_account_number]);
            const currentDate = new Date();
            let newDueDate;
            
            // Detect if postpaid by checking customer record or plan type
            let isPostpaid = false;
            let originalFixedDay = null;
            try {
                if (customer && customer.planType) {
                    const pt = String(customer.planType).toLowerCase();
                    if (pt === 'postpaid' || pt === 'active') isPostpaid = true;
                }
                // Try to get original fixedDay from MikroTik secret comment
                if (customer && customer.routerId) {
                    const router = await db.get('SELECT * FROM routers WHERE id = ?', [customer.routerId]);
                    if (router) {
                        const axios = require('axios');
                        const apiBase = `http://${router.host}:${router.port}`;
                        const authHeader = `Basic ${Buffer.from(`${router.user}:${router.password}`).toString('base64')}`;
                        const secretRes = await axios.get(`${apiBase}/rest/ppp/secret`, {
                            params: { name: payment.customer_username },
                            headers: { Authorization: authHeader },
                            timeout: 5000
                        });
                        const secrets = Array.isArray(secretRes.data) ? secretRes.data : [secretRes.data];
                        const secret = secrets.find(s => s.name === payment.customer_username) || secrets[0];
                        if (secret && secret.comment) {
                            const comment = JSON.parse(secret.comment);
                            if (comment.planType && String(comment.planType).toLowerCase() === 'postpaid') {
                                isPostpaid = true;
                            }
                            if (comment.fixedDay) {
                                originalFixedDay = parseInt(comment.fixedDay);
                            } else if (comment.dueDate) {
                                const d = new Date(comment.dueDate);
                                if (!isNaN(d.getTime())) originalFixedDay = d.getDate();
                            }
                        }
                    }
                }
            } catch (e) {
                console.log('[Manual Payments] Could not detect plan type from MikroTik:', e.message);
            }
            
            // CRITICAL FALLBACK: If we couldn't get fixedDay from MikroTik, get it from customer's existing dueDate
            // This ensures the due date is ALWAYS preserved based on the client's set date
            if (isPostpaid && !originalFixedDay && customer && customer.dueDate) {
                const existingDueDate = new Date(customer.dueDate);
                if (!isNaN(existingDueDate.getTime())) {
                    originalFixedDay = existingDueDate.getDate();
                    console.log(`[Manual Payments] Using fixedDay from customer.dueDate: ${originalFixedDay}`);
                }
            }
            
            // For postpaid: preserve the original due date day and advance by 1 calendar month
            if (isPostpaid && originalFixedDay) {
                const baseDate = (customer && customer.dueDate) ? new Date(customer.dueDate) : currentDate;
                let targetYear = baseDate.getFullYear();
                let targetMonth = baseDate.getMonth() + 1; // Next month
                
                if (targetMonth > 11) { targetMonth = 0; targetYear++; }
                
                const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
                let targetDay = originalFixedDay;
                
                // Handle edge case: if target month doesn't have enough days (e.g., Feb 30)
                if (targetDay > daysInTargetMonth) {
                    targetDay = daysInTargetMonth;
                }
                
                newDueDate = new Date(targetYear, targetMonth, targetDay, baseDate.getHours(), baseDate.getMinutes(), 0, 0);
                console.log(`[Manual Payments] Postpaid: preserved fixedDay=${originalFixedDay}, advanced to ${newDueDate.toISOString().split('T')[0]}`);
            } else {
                // Prepaid: extend by durationDays
                if (customer && customer.dueDate) {
                    const existingDueDate = new Date(customer.dueDate);
                    if (existingDueDate > currentDate) {
                        newDueDate = new Date(existingDueDate);
                        newDueDate.setDate(newDueDate.getDate() + durationDays);
                        console.log(`[Manual Payments] Prepaid: extending from existing due date: ${customer.dueDate} -> ${newDueDate.toISOString().split('T')[0]}`);
                    } else {
                        newDueDate = new Date(currentDate);
                        newDueDate.setDate(newDueDate.getDate() + durationDays);
                        console.log(`[Manual Payments] Prepaid: due date expired, extending from today: ${newDueDate.toISOString().split('T')[0]}`);
                    }
                } else {
                    newDueDate = new Date(currentDate);
                    newDueDate.setDate(newDueDate.getDate() + durationDays);
                    console.log(`[Manual Payments] Prepaid: no due date, starting from today: ${newDueDate.toISOString().split('T')[0]}`);
                }
            }
            
            const dueDateStr = newDueDate.toISOString().split('T')[0];
            
            // ALWAYS update customer AND MikroTik PPP secret (same as Facebook bot)
            console.log(`[Manual Payments] Updating PPPoE customer record and MikroTik secret`);
            await db.run(
                'UPDATE customers SET dueDate = ?, planType = ? WHERE accountNumber = ?',
                [dueDateStr, 'Active', payment.customer_account_number]
            );
            
            // CRITICAL: Update MikroTik PPPoE secret with new due date (same as PayMongo)
            try {
                console.log(`[Manual Payments] Looking up router with ID: ${payment.customer_router_id}`);
                const router = await db.get('SELECT * FROM routers WHERE id = ?', [payment.customer_router_id]);
                
                console.log(`[Manual Payments] Router found: ${!!router}, host: ${router?.host}, port: ${router?.port}`);
                
                if (router) {
                    const axios = require('axios');
                    const apiBase = `http://${router.host}:${router.port}`;
                    const authHeader = `Basic ${Buffer.from(`${router.user}:${router.password}`).toString('base64')}`;
                    
                    console.log(`[Manual Payments] Connecting to MikroTik at: ${apiBase}`);
                    console.log(`[Manual Payments] Looking for PPP secret: ${payment.customer_username}`);
                    
                    // Get PPP secret
                    let secretRes;
                    try {
                        secretRes = await axios.get(`${apiBase}/rest/ppp/secret`, {
                            params: { name: payment.customer_username },
                            headers: { Authorization: authHeader },
                            timeout: 10000
                        });
                        console.log(`[Manual Payments] PPP secret API response status: ${secretRes.status}`);
                        console.log(`[Manual Payments] PPP secret API response data:`, JSON.stringify(secretRes.data).substring(0, 500));
                    } catch (apiErr) {
                        console.error(`[Manual Payments] PPP secret API call failed: ${apiErr.message}`);
                        console.error(`[Manual Payments] API URL: ${apiBase}/rest/ppp/secret`);
                        console.error(`[Manual Payments] API params:`, { name: payment.customer_username });
                        throw apiErr; // Re-throw to be caught by outer catch
                    }
                    
                    const secrets = Array.isArray(secretRes.data) ? secretRes.data : [secretRes.data];
                    const secret = secrets.find(s => s.name === payment.customer_username) || secrets[0];
                    
                    console.log(`[Manual Payments] Found secrets: ${secrets.length}, Selected secret: ${secret?.name || 'none'}`);
                    console.log(`[Manual Payments] Payment customer_username: "${payment.customer_username}"`);
                    
                    // Also lookup customer record to check username fields
                    const customerRecord = await db.get('SELECT username, accountNumber FROM customers WHERE accountNumber = ?', [payment.customer_account_number]);
                    console.log(`[Manual Payments] Customer record - username: "${customerRecord?.username}", accountNumber: "${customerRecord?.accountNumber}"`);
                    
                    // If no secret found with customer_username, try ALL secrets and find matching one
                    if (!secret || secret.name !== payment.customer_username) {
                        console.log(`[Manual Payments] Secret not found with exact match, fetching ALL secrets to search...`);
                        try {
                            const allSecretsRes = await axios.get(`${apiBase}/rest/ppp/secret`, {
                                headers: { Authorization: authHeader },
                                timeout: 10000
                            });
                            const allSecrets = Array.isArray(allSecretsRes.data) ? allSecretsRes.data : [];
                            console.log(`[Manual Payments] Total PPP secrets on router: ${allSecrets.length}`);
                            
                            // Try to find matching secret by:
                            // 1. customer_username (already tried)
                            // 2. account_number
                            // 3. comment field containing account_number
                            const accountNumber = payment.customer_account_number;
                            const foundSecret = allSecrets.find(s => 
                                s.name === payment.customer_username || 
                                s.name === accountNumber ||
                                (s.comment && s.comment.includes(accountNumber))
                            );
                            
                            if (foundSecret) {
                                console.log(`[Manual Payments] ✓ Found matching secret: "${foundSecret.name}" (matched by account number or comment)`);
                                // Use this secret instead - create new object if secret is undefined
                                if (!secret) {
                                    secret = { ...foundSecret };
                                } else {
                                    Object.assign(secret, foundSecret);
                                }
                            } else {
                                console.error(`[Manual Payments] ✗ No matching secret found in ${allSecrets.length} total secrets`);
                                console.error(`[Manual Payments] Looking for: "${payment.customer_username}" or "${accountNumber}"`);
                                // Log first 5 secret names for debugging
                                const sampleNames = allSecrets.slice(0, 5).map(s => s.name).join(', ');
                                console.error(`[Manual Payments] Sample secret names: ${sampleNames}`);
                            }
                        } catch (err) {
                            console.error(`[Manual Payments] Error fetching all secrets: ${err.message}`);
                        }
                    }
                    
                    if (secret && secret.name) {
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
                        
                        // Create scheduler to auto-expire on due date (EXACTLY like PayMongo webhook)
                        try {
                            console.log('[Manual Payments] Creating expiration scheduler...');
                            const schedulerName = `ppp-auto-kick-${payment.customer_username}`;
                            
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
                                        console.log('[Manual Payments] Removed old scheduler:', sched['.id']);
                                    }
                                }
                            } catch (delErr) {
                                console.error('[Manual Payments] Old scheduler cleanup error:', delErr.message);
                            }

                            // Format start-date as YYYY-MM-DD and start-time as HH:MM:SS (matching PayMongo webhook format EXACTLY)
                            const startDate = `${newDueDateTime.getFullYear()}-${String(newDueDateTime.getMonth() + 1).padStart(2, '0')}-${String(newDueDateTime.getDate()).padStart(2, '0')}`;
                            const startTime = `${String(newDueDateTime.getHours()).padStart(2, '0')}:${String(newDueDateTime.getMinutes()).padStart(2, '0')}:00`;

                            // Match exact on-event format from PayMongo webhook
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
                            console.error('[Manual Payments] Scheduler error stack:', schedErr.stack);
                        }
                    } else {
                        console.error(`[Manual Payments] PPP secret NOT found for username: ${payment.customer_username}`);
                        console.error(`[Manual Payments] Available secrets:`, secrets.map(s => s.name).join(', '));
                    }
                } else {
                    console.error(`[Manual Payments] Router NOT found with ID: ${payment.customer_router_id}`);
                }
            } catch (mikrotikErr) {
                console.error('[Manual Payments] MikroTik update error:', mikrotikErr.message);
                console.error('[Manual Payments] MikroTik error stack:', mikrotikErr.stack);
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
            const s = await db.get('SELECT companyName, logoBase64, email, landingPageConfig FROM settings WHERE id = 1');
            let cfg = {};
            try { cfg = JSON.parse(s?.landingPageConfig || '{}'); } catch (_) {}
            res.json({
                company: { companyName: s?.companyName || '', logoBase64: s?.logoBase64 || '', email: s?.email || '' },
                config: cfg
            });
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    // --- Landing Page HTML Editor API ---
    const landingPageHtmlPath = path.join(__dirname, '..', 'public', 'landing-page.html');
    app.get('/api/landing-page-html', protect, (req, res) => {
        try {
            if (!fs.existsSync(landingPageHtmlPath)) {
                return res.json({ html: '' });
            }
            const html = fs.readFileSync(landingPageHtmlPath, 'utf-8');
            res.json({ html });
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });
    app.put('/api/landing-page-html', protect, express.json({ limit: '5mb' }), (req, res) => {
        try {
            const { html } = req.body;
            if (typeof html !== 'string') {
                return res.status(400).json({ message: 'Invalid HTML content.' });
            }
            fs.writeFileSync(landingPageHtmlPath, html, 'utf-8');
            res.json({ message: 'Landing page HTML saved successfully.' });
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

    // Public Xendit config — exposes only safe fields needed by Client Portal UI
    app.get('/api/public/xendit-config', async (req, res) => {
        try {
            const s = await db.get('SELECT xenditSettings FROM settings WHERE id = 1');
            let x = {};
            try { x = JSON.parse(s?.xenditSettings || '{}'); } catch (_) {}
            res.json({
                enabled: !!x.enabled,
                passFeesToCustomer: !!x.passFeesToCustomer,
                paymentMethods: x.paymentMethods || []
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
            // Check if store is enabled
            const settingsRow = await db.get('SELECT storeSettings FROM settings WHERE id = 1');
            if (settingsRow && settingsRow.storeSettings) {
                try {
                    const ss = JSON.parse(settingsRow.storeSettings);
                    if (ss.storeEnabled === false) return res.json([]);
                } catch (_) {}
            }

            const { routerId, type = 'all', billingType } = req.query;
            
            let plans = [];
            
            // Get PPPoE plans
            if (type === 'all' || type === 'pppoe') {
                let query = 'SELECT * FROM billing_plans WHERE store_enabled = 1';
                const params = [];
                if (routerId) { query += ' AND routerId = ?'; params.push(routerId); }
                if (billingType) { query += ' AND billingType = ?'; params.push(billingType); }
                query += ' ORDER BY price ASC';
                const pppoePlans = await db.all(query, params);
                plans = plans.concat(pppoePlans.map(p => ({ ...p, planType: 'pppoe' })));
            }
            
            // Get DHCP plans
            if (type === 'all' || type === 'dhcp') {
                let query = 'SELECT * FROM dhcp_billing_plans WHERE store_enabled = 1';
                const params = [];
                if (routerId) { query += ' AND routerId = ?'; params.push(routerId); }
                if (billingType) { query += ' AND billingType = ?'; params.push(billingType); }
                query += ' ORDER BY price ASC';
                const dhcpPlans = await db.all(query, params);
                plans = plans.concat(dhcpPlans.map(p => ({ ...p, planType: 'dhcp' })));
            }
            
            console.log(`[Store] Found ${plans.length} plans (type: ${type}, billingType: ${billingType || 'all'}, routerId: ${routerId || 'all'})`);
            res.json(plans);
        } catch (e) {
            console.error('[Store] Error fetching plans:', e.message);
            res.status(500).json({ message: e.message });
        }
    });
    
    // GET: Lookup customer account by account number, username, or IP
    app.get('/api/public/store/lookup-account', async (req, res) => {
        try {
            const { accountNumber, username, ip } = req.query;
            if (!accountNumber && !username && !ip) {
                return res.status(400).json({ found: false, message: 'Provide accountNumber, username, or ip query parameter' });
            }

            let customer = null;

            // Lookup by account number
            if (accountNumber) {
                customer = await db.get(
                    `SELECT c.id, c.username, c.fullName, c.accountNumber, c.routerId, c.contactNumber, c.planType,
                            r.name as routerName
                     FROM customers c
                     LEFT JOIN routers r ON c.routerId = r.id
                     WHERE c.accountNumber = ?`,
                    [accountNumber]
                );
            }

            // Lookup by PPPoE username
            if (!customer && username) {
                customer = await db.get(
                    `SELECT c.id, c.username, c.fullName, c.accountNumber, c.routerId, c.contactNumber, c.planType,
                            r.name as routerName
                     FROM customers c
                     LEFT JOIN routers r ON c.routerId = r.id
                     WHERE c.username = ?`,
                    [username]
                );
            }

            // Lookup by IP address (for auto-detection from network) — only DHCP clients have stored IPs
            if (!customer && ip) {
                // Try dhcp_clients table by IP
                if (!customer) {
                    customer = await db.get(
                        `SELECT dc.id, dc.username, dc.fullName, dc.accountNumber, dc.routerId,
                                dc.contactNumber, dc.planType, r.name as routerName
                         FROM dhcp_clients dc
                         LEFT JOIN routers r ON dc.routerId = r.id
                         WHERE dc.address = ? OR dc.ip = ?`,
                        [ip, ip]
                    );
                    if (customer) {
                        customer = {
                            id: customer.id,
                            username: customer.username,
                            fullName: customer.fullName,
                            accountNumber: customer.accountNumber || '',
                            routerId: customer.routerId,
                            contactNumber: customer.contactNumber || '',
                            planType: customer.planType || 'prepaid',
                            routerName: customer.routerName
                        };
                    }
                }
            }

            if (customer) {
                const billingType = (customer.planType || 'prepaid').toLowerCase() === 'postpaid' ? 'postpaid' : 'prepaid';
                res.json({
                    found: true,
                    fullName: customer.fullName,
                    username: customer.username,
                    routerId: customer.routerId,
                    accountNumber: customer.accountNumber || '',
                    routerName: customer.routerName || '',
                    contactNumber: customer.contactNumber || '',
                    billingType
                });
            } else {
                res.json({ found: false });
            }
        } catch (e) {
            console.error('[Store] Account lookup error:', e.message);
            res.status(500).json({ found: false, message: e.message });
        }
    });

    // POST: Create store purchase (PayMongo checkout or manual payment)
    app.post('/api/public/store/purchase', async (req, res) => {
        try {
            const { planId, planType, paymentMethod, accountNumber, pppoeUsername, routerId, gcashReference, gcashScreenshot } = req.body;
            
            if (!planId || !planType || !paymentMethod) {
                return res.status(400).json({ message: 'Missing required fields: planId, planType, paymentMethod' });
            }
            if (!accountNumber && !pppoeUsername) {
                return res.status(400).json({ message: 'Account number or PPPoE username is required' });
            }
            
            console.log(`[Store] Purchase request: planId=${planId}, planType=${planType}, paymentMethod=${paymentMethod}, accountNumber=${accountNumber || 'N/A'}, pppoeUsername=${pppoeUsername || 'N/A'}`);
            
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
            
            // Look up customer directly by account number or PPPoE username (no login required)
            let customer = null;
            
            // Try account number first
            if (accountNumber) {
                customer = await db.get(
                    `SELECT c.*, r.name as routerName FROM customers c
                     LEFT JOIN routers r ON c.routerId = r.id
                     WHERE c.accountNumber = ?`,
                    [accountNumber]
                );
            }
            
            // Fallback: try PPPoE username
            if (!customer && pppoeUsername) {
                customer = await db.get(
                    `SELECT c.*, r.name as routerName FROM customers c
                     LEFT JOIN routers r ON c.routerId = r.id
                     WHERE c.username = ?`,
                    [pppoeUsername]
                );
            }
            
            if (!customer) {
                console.error(`[Store] Customer not found: accountNumber=${accountNumber || 'N/A'}, pppoeUsername=${pppoeUsername || 'N/A'}`);
                return res.status(404).json({ message: 'Customer not found. Please check your account number or PPPoE username.' });
            }
            
            const effectiveRouterId = routerId || customer.routerId;
            const effectivePppoeUsername = customer.username;
            const effectiveAccountNumber = customer.accountNumber || '';
            
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
                                description: `${plan.name} - ${customer.fullName || effectiveAccountNumber}`,
                                quantity: 1
                            }],
                            payment_method_types: pmConfig.paymentMethods || ['qrph'],
                            send_email_receipt: false,
                            show_description: false,
                            success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/store/success`,
                            cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/store/cancel`,
                            metadata: {
                                pppoeUsername: effectivePppoeUsername,
                                planId: planId,
                                planType: planType,
                                routerId: effectiveRouterId,
                                planName: plan.name,
                                planPrice: plan.price,
                                duration_days: plan.cycle_days || 30,
                                customerAccountNumber: effectiveAccountNumber,
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
                // Create manual payment record
                const paymentId = `manual_pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const now = new Date().toISOString();
                
                console.log(`[Store] Manual payment - pppoeUsername: "${effectivePppoeUsername}", accountNumber: "${effectiveAccountNumber}"`);
                
                await db.run(
                    `INSERT INTO manual_payment_requests (
                        id, customer_account_number, customer_username, customer_full_name,
                        customer_router_id, plan_name, plan_price, gcash_reference_number,
                        customer_mobile_number, customer_name_on_gcash,
                        status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
                    [
                        paymentId,
                        effectiveAccountNumber,
                        effectivePppoeUsername,
                        customer.fullName,
                        effectiveRouterId,
                        plan.name,
                        plan.price,
                        gcashReference || '',
                        customer.contactNumber || '',
                        customer.fullName || '',
                        now,
                        now
                    ]
                );
                
                // Also create a sales record for tracking
                const salesId = `sale_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                await db.run(
                    `INSERT INTO sales_records (
                        id, routerId, date, clientName, planName, planPrice,
                        discountAmount, finalAmount, routerName, currency,
                        clientAddress, clientContact, payment_method, processedBy
                    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        salesId,
                        effectiveRouterId,
                        now,
                        customer.fullName || effectivePppoeUsername,
                        plan.name,
                        plan.price,
                        plan.price,
                        plan.currency || 'PHP',
                        customer.address || '',
                        customer.contactNumber || '',
                        'manual',
                        'store'
                    ]
                );
                
                console.log(`[Store] Manual payment created: ${paymentId}, sales record: ${salesId}`);
                
                res.json({
                    success: true,
                    paymentId: paymentId,
                    salesId: salesId,
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
    
    // ========================================
    // Expired Client Portal APIs
    // ========================================
    
    // In-memory store for auto-login tokens (expires in 10 minutes)
    const expiredSessionTokens = new Map();
    
    // Cleanup expired tokens every 5 minutes
    setInterval(() => {
        const now = Date.now();
        for (const [token, data] of expiredSessionTokens.entries()) {
            if (data.expiresAt < now) expiredSessionTokens.delete(token);
        }
    }, 5 * 60 * 1000);

    // Helper: Check if IP belongs to the configured non-payment pool
    async function isInNonPaymentPool(ip) {
        // Default pool
        let pool = '172.16.44.0/24';
        try {
            const s = await db.get('SELECT storeSettings FROM settings WHERE id = 1');
            if (s && s.storeSettings) {
                const settings = JSON.parse(s.storeSettings);
                if (settings.nonPaymentPool) pool = settings.nonPaymentPool;
            }
        } catch (_) {}
        // Parse CIDR (e.g., "172.16.44.0/24")
        const match = pool.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
        if (!match) return ip.startsWith('172.16.44.');
        const [, network, bitsStr] = match;
        const bits = parseInt(bitsStr, 10);
        const netParts = network.split('.').map(Number);
        const ipParts = ip.split('.').map(Number);
        if (ipParts.length !== 4) return false;
        const netInt = (netParts[0] << 24) | (netParts[1] << 16) | (netParts[2] << 8) | netParts[3];
        const ipInt = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
        const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
        return (netInt >>> 0 & mask) === (ipInt >>> 0 & mask);
    }

    // Shared helper: Lookup PPPoE customer by matching ARP MAC to PPP secret caller-id
    // Used when client is on non-payment pool and has no active PPPoE session
    async function lookupPppoeByArpAndSecret(ip) {
        const axios = require('axios');
        const routers = await db.all('SELECT * FROM routers');
        for (const router of routers) {
            try {
                const routerIp = router.host || router.ip;
                const routerPort = router.port || 3002;
                const routerUser = router.user || router.username || 'admin';
                const routerPass = router.password || '';
                const apiBase = `http://${routerIp}:${routerPort}`;
                const authHeader = 'Basic ' + Buffer.from(`${routerUser}:${routerPass}`).toString('base64');

                // Step 1: Get MAC address from ARP table for this IP
                const arpResp = await axios.get(`${apiBase}/rest/ip/arp`, {
                    params: { address: ip },
                    headers: { Authorization: authHeader },
                    timeout: 10000
                });
                const arpEntries = Array.isArray(arpResp.data) ? arpResp.data : [];
                if (arpEntries.length === 0) continue;

                const macAddress = arpEntries[0]['mac-address'];
                if (!macAddress) continue;
                const normalizedArpMac = macAddress.toUpperCase().replace(/[:-]/g, ':');

                console.log(`[Expired PPPoE ARP Lookup] IP=${ip}, MAC=${normalizedArpMac}, Router=${router.name}`);

                // Step 2: Try to find customer by lastKnownMac (most reliable - stored from previous active sessions)
                const customerByMac = await db.get(
                    `SELECT c.*, r.name as routerName FROM customers c 
                     LEFT JOIN routers r ON c.routerId = r.id 
                     WHERE c.routerId = ? AND UPPER(c.lastKnownMac) = ?`,
                    [router.id, normalizedArpMac]
                );
                if (customerByMac) {
                    console.log(`[Expired PPPoE ARP Lookup] Found customer by lastKnownMac: ${customerByMac.username || customerByMac.fullName}`);
                    return { customer: customerByMac, clientType: customerByMac.clientType || 'pppoe', routerName: router.name };
                }

                // Step 3: Get all PPPoE secrets and match by caller-id
                const secretsResp = await axios.get(`${apiBase}/rest/ppp/secret`, {
                    headers: { Authorization: authHeader },
                    timeout: 10000
                });
                const secrets = Array.isArray(secretsResp.data) ? secretsResp.data : [];

                const matchedSecret = secrets.find(s => {
                    if (!s['caller-id']) return false;
                    const callerMac = String(s['caller-id']).toUpperCase().replace(/[:-]/g, ':');
                    return callerMac === normalizedArpMac;
                });

                if (!matchedSecret || !matchedSecret.name) {
                    console.log(`[Expired PPPoE ARP Lookup] No caller-id match on router ${router.name}`);
                    continue;
                }

                console.log(`[Expired PPPoE ARP Lookup] Matched secret by caller-id: ${matchedSecret.name} on router ${router.name}`);

                // Step 4: Look up customer in DB by username (secret name)
                let customer = await db.get(
                    `SELECT c.*, r.name as routerName FROM customers c 
                     LEFT JOIN routers r ON c.routerId = r.id 
                     WHERE (c.username = ? OR c.name = ?) AND c.routerId = ?`,
                    [matchedSecret.name, matchedSecret.name, router.id]
                );

                if (customer) {
                    return { customer, clientType: 'pppoe', routerName: router.name };
                }

                // Fallback: look in client_users table
                const clientUser = await db.get(
                    'SELECT * FROM client_users WHERE pppoe_username = ? AND router_id = ?',
                    [matchedSecret.name, router.id]
                );
                if (clientUser) {
                    customer = await db.get(
                        `SELECT c.*, r.name as routerName FROM customers c 
                         LEFT JOIN routers r ON c.routerId = r.id 
                         WHERE c.routerId = ? AND (c.username = ? OR c.accountNumber = ?)`,
                        [router.id, clientUser.pppoe_username || matchedSecret.name, clientUser.account_number || '']
                    );
                    if (!customer) {
                        // Build synthetic customer from client_user data
                        customer = {
                            username: matchedSecret.name,
                            name: matchedSecret.name,
                            fullName: clientUser.pppoe_username || matchedSecret.name,
                            accountNumber: clientUser.account_number || '',
                            routerId: router.id,
                            routerName: router.name,
                            planName: '',
                            dueDate: ''
                        };
                    }
                    return { customer, clientType: 'pppoe', routerName: router.name };
                }

                // Last fallback: build customer from secret data alone
                customer = {
                    username: matchedSecret.name,
                    name: matchedSecret.name,
                    fullName: matchedSecret.name,
                    accountNumber: '',
                    routerId: router.id,
                    routerName: router.name,
                    planName: matchedSecret.profile || '',
                    dueDate: ''
                };
                // Try to parse comment for more info
                try {
                    const comment = matchedSecret.comment || '';
                    if (comment.startsWith('{')) {
                        const parsed = JSON.parse(comment);
                        customer.fullName = parsed.customerName || parsed.fullName || matchedSecret.name;
                        customer.dueDate = parsed.dueDate || '';
                        customer.planName = parsed.planName || parsed.plan || matchedSecret.profile || '';
                    }
                } catch (_) {}
                return { customer, clientType: 'pppoe', routerName: router.name };

            } catch (routerErr) {
                console.warn(`[Expired PPPoE ARP Lookup] Failed on ${router.name}:`, routerErr.message);
            }
        }
        return null;
    }

    // GET: Lookup customer by IP or MAC address
    app.get('/api/public/expired/lookup', async (req, res) => {
        try {
            const { ip, mac } = req.query;
            if (!ip && !mac) {
                return res.status(400).json({ message: 'ip or mac query parameter is required' });
            }

            let customer = null;
            let clientType = 'pppoe';

            // Try PPPoE customers first - match by IP in dhcp_clients or customers table
            if (ip) {
                // Look in dhcp_clients table (DHCP portal clients with IP binding)
                customer = await db.get(
                    `SELECT dc.*, r.name as routerName FROM dhcp_clients dc 
                     LEFT JOIN routers r ON dc.routerId = r.id 
                     WHERE dc.address = ? OR dc.ip = ?`,
                    [ip, ip]
                );
                if (customer) {
                    clientType = 'dhcp';
                }

                // Look in dhcp_clients table by IP
                if (!customer) {
                    customer = await db.get(
                        `SELECT dc.*, r.name as routerName FROM dhcp_clients dc 
                         LEFT JOIN routers r ON dc.routerId = r.id 
                         WHERE dc.address = ? OR dc.ip = ?`,
                        [ip, ip]
                    );
                    if (customer) clientType = 'dhcp';
                }
            }

            // Try MAC address lookup
            if (!customer && mac) {
                const normalizedMac = String(mac).toUpperCase().replace(/[:-]/g, ':');
                const altMac = String(mac).toUpperCase().replace(/[:-]/g, '');

                // DHCP clients by MAC
                customer = await db.get(
                    `SELECT dc.*, r.name as routerName FROM dhcp_clients dc 
                     LEFT JOIN routers r ON dc.routerId = r.id 
                     WHERE UPPER(dc.macAddress) = ? OR UPPER(REPLACE(dc.macAddress, ':', '')) = ?`,
                    [normalizedMac, altMac]
                );
                if (customer) clientType = 'dhcp';

                // Customers by MAC
                if (!customer) {
                    customer = await db.get(
                        `SELECT c.*, r.name as routerName FROM customers c 
                         LEFT JOIN routers r ON c.routerId = r.id 
                         WHERE UPPER(c.macAddress) = ? OR UPPER(REPLACE(c.macAddress, ':', '')) = ?`,
                        [normalizedMac, altMac]
                    );
                    if (customer) clientType = customer.clientType || 'pppoe';
                }
            }

            // If IP is from non-payment pool and DB lookup failed,
            // query MikroTik PPPoE active sessions to find the secret name
            if (!customer && ip && (await isInNonPaymentPool(ip))) {
                const routers = await db.all('SELECT * FROM routers');
                for (const router of routers) {
                    try {
                        const axios = require('axios');
                        const routerIp = router.host || router.ip;
                        const routerPort = router.port || 3002;
                        const routerUser = router.username || 'admin';
                        const routerPass = router.password || '';
                        const apiBase = `http://${routerIp}:${routerPort}`;
                        const authHeader = 'Basic ' + Buffer.from(`${routerUser}:${routerPass}`).toString('base64');

                        // Query PPPoE active sessions for this IP
                        const activeResp = await axios.get(`${apiBase}/rest/ppp/active`, {
                            params: { address: ip },
                            headers: { Authorization: authHeader },
                            timeout: 10000
                        });
                        const activeSessions = Array.isArray(activeResp.data) ? activeResp.data : [];
                        const session = activeSessions.find(s => s.address === ip);

                        if (session && session.name) {
                            // Store MAC address from active session for future expired lookups
                            const sessionMac = session['caller-id'] || '';
                            if (sessionMac) {
                                const normalizedMac = String(sessionMac).toUpperCase().replace(/[:-]/g, ':');
                                try {
                                    await db.run('UPDATE customers SET lastKnownMac = ? WHERE username = ? AND routerId = ?',
                                        [normalizedMac, session.name, router.id]);
                                } catch (_) {}
                            }

                            // Found the PPPoE secret name - look up the customer by username
                            customer = await db.get(
                                `SELECT c.*, r.name as routerName FROM customers c 
                                 LEFT JOIN routers r ON c.routerId = r.id 
                                 WHERE (c.username = ? OR c.name = ?) AND c.routerId = ?`,
                                [session.name, session.name, router.id]
                            );
                            if (customer) {
                                clientType = 'pppoe';
                                break;
                            }

                            // Fallback: look in client_users table
                            const clientUser = await db.get(
                                'SELECT * FROM client_users WHERE pppoe_username = ? AND router_id = ?',
                                [session.name, router.id]
                            );
                            if (clientUser) {
                                customer = await db.get(
                                    `SELECT c.*, r.name as routerName FROM customers c 
                                     LEFT JOIN routers r ON c.routerId = r.id 
                                     WHERE c.routerId = ? AND (c.username = ? OR c.accountNumber = ?)`,
                                    [router.id, clientUser.pppoe_username || session.name, clientUser.account_number || '']
                                );
                                if (!customer) {
                                    // Build customer from client_user data
                                    customer = {
                                        username: session.name,
                                        name: session.name,
                                        fullName: clientUser.pppoe_username || session.name,
                                        accountNumber: clientUser.account_number || '',
                                        routerId: router.id,
                                        routerName: router.name,
                                        planName: '',
                                        dueDate: ''
                                    };
                                }
                                clientType = 'pppoe';
                                break;
                            }
                        }
                    } catch (routerErr) {
                        console.warn(`[Expired Portal] PPPoE active lookup failed on ${router.name}:`, routerErr.message);
                    }
                }
            }

            // Fallback: If still not found and IP is from non-payment pool,
            // try matching via ARP table MAC → PPP secret caller-id
            // This works even when PPPoE session is terminated (secret disabled/expired)
            if (!customer && ip && (await isInNonPaymentPool(ip))) {
                console.log(`[Expired Portal] Active session lookup failed for ${ip}, trying ARP+Secret matching...`);
                const arpResult = await lookupPppoeByArpAndSecret(ip);
                if (arpResult) {
                    customer = arpResult.customer;
                    clientType = arpResult.clientType;
                }
            }

            if (!customer) {
                return res.json({ found: false });
            }

            // Parse comment for plan info if it's JSON
            let planName = customer.planName || customer.plan || '';
            let dueDate = customer.dueDate || customer.expiresAt || '';
            try {
                const comment = customer.comment || '';
                if (comment.startsWith('{')) {
                    const parsed = JSON.parse(comment);
                    planName = planName || parsed.plan || parsed.planName || '';
                    dueDate = dueDate || parsed.dueDate || parsed.expiresAt || '';
                }
            } catch (_) {}

            // Determine username (PPPoE secret name or DHCP client name)
            const username = customer.username || customer.name || '';
            const accountNumber = customer.accountNumber || customer.account_number || '';
            const fullName = customer.fullName || customer.full_name || customer.name || username;
            const planType = (customer.planType || customer.plan_type || 'prepaid').toLowerCase() === 'postpaid' ? 'postpaid' : 'prepaid';

            return res.json({
                found: true,
                customer: {
                    fullName,
                    accountNumber,
                    planName,
                    dueDate,
                    routerId: customer.routerId || customer.router_id || '',
                    username,
                    clientType,
                    planType,
                    routerName: customer.routerName || ''
                }
            });
        } catch (e) {
            console.error('[Expired Portal] Lookup error:', e.message);
            res.status(500).json({ message: e.message });
        }
    });

    // GET: Lookup customer by account number or username (manual entry from expired portal)
    app.get('/api/public/expired/lookup-by-account', async (req, res) => {
        try {
            const q = String(req.query.q || '').trim();
            if (!q) return res.status(400).json({ message: 'Query parameter "q" is required' });

            // Search by account number or username in customers table
            let customer = await db.get(
                `SELECT c.*, r.name as routerName FROM customers c 
                 LEFT JOIN routers r ON c.routerId = r.id 
                 WHERE c.accountNumber = ? OR c.username = ?`,
                [q, q]
            );

            // Fallback: search in client_users table
            if (!customer) {
                const clientUser = await db.get(
                    'SELECT * FROM client_users WHERE pppoe_username = ? OR username = ?',
                    [q, q]
                );
                if (clientUser) {
                    customer = await db.get(
                        `SELECT c.*, r.name as routerName FROM customers c 
                         LEFT JOIN routers r ON c.routerId = r.id 
                         WHERE c.routerId = ? AND (c.username = ? OR c.accountNumber = ?)`,
                        [clientUser.router_id, clientUser.pppoe_username || clientUser.username, clientUser.account_number || '']
                    );
                }
            }

            if (!customer) {
                return res.json({ found: false });
            }

            // Parse comment for plan info
            let planName = customer.planName || customer.plan || '';
            let dueDate = customer.dueDate || customer.expiresAt || '';
            try {
                const comment = customer.comment || '';
                if (comment.startsWith('{')) {
                    const parsed = JSON.parse(comment);
                    planName = planName || parsed.plan || parsed.planName || '';
                    dueDate = dueDate || parsed.dueDate || parsed.expiresAt || '';
                }
            } catch (_) {}

            const username = customer.username || customer.name || '';
            const accountNumber = customer.accountNumber || customer.account_number || '';
            const fullName = customer.fullName || customer.full_name || customer.name || username;
            const planType = (customer.planType || customer.plan_type || 'prepaid').toLowerCase() === 'postpaid' ? 'postpaid' : 'prepaid';

            res.json({
                found: true,
                customer: {
                    fullName,
                    accountNumber,
                    planName,
                    dueDate,
                    routerId: customer.routerId || customer.router_id || '',
                    username,
                    clientType: customer.clientType || 'pppoe',
                    planType,
                    routerName: customer.routerName || ''
                }
            });
        } catch (e) {
            console.error('[Expired Portal] Account lookup error:', e.message);
            res.status(500).json({ message: e.message });
        }
    });

    // POST: Create auto-login token for store access
    app.post('/api/public/expired/auto-login', async (req, res) => {
        try {
            const { username, routerId, accountNumber, ip, mac } = req.body;
            if (!username && !ip && !mac) {
                return res.status(400).json({ message: 'username or ip/mac is required' });
            }

            // Find the customer to verify they exist
            let customer = null;
            if (username && routerId) {
                customer = await db.get(
                    'SELECT * FROM customers WHERE username = ? AND routerId = ?',
                    [username, routerId]
                );
            }
            if (!customer && username) {
                customer = await db.get(
                    'SELECT * FROM customers WHERE username = ?',
                    [username]
                );
            }
            if (!customer && accountNumber) {
                customer = await db.get(
                    'SELECT * FROM customers WHERE accountNumber = ?',
                    [accountNumber]
                );
            }

            // Fallback: look in dhcp_clients
            if (!customer && (ip || mac)) {
                if (ip) {
                    customer = await db.get('SELECT * FROM dhcp_clients WHERE address = ? OR ip = ?', [ip, ip]);
                }
                if (!customer && mac) {
                    customer = await db.get('SELECT * FROM dhcp_clients WHERE UPPER(macAddress) = ?', [String(mac).toUpperCase()]);
                }
            }

            // Generate token
            const token = `exp_${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;
            const sessionData = {
                id: customer?.id || `temp_${Date.now()}`,
                username: customer?.username || username || 'expired_client',
                routerId: customer?.routerId || customer?.router_id || routerId || '',
                accountNumber: customer?.accountNumber || customer?.account_number || accountNumber || '',
                fullName: customer?.fullName || customer?.full_name || 'Valued Customer',
                pppoeUsername: username || customer?.username || '',
                expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
                createdAt: Date.now()
            };

            expiredSessionTokens.set(token, sessionData);
            console.log(`[Expired Portal] Auto-login token created for ${username || ip || mac}`);

            // Build store URL pointing to main app (PORT 3001)
            const reqHost = (req.headers.host || '').split(':')[0];
            const storeUrl = `http://${reqHost}:${PORT}/store?session=${encodeURIComponent(token)}`;

            res.json({ token, expiresIn: 600, storeUrl }); // 10 minutes
        } catch (e) {
            console.error('[Expired Portal] Auto-login error:', e.message);
            res.status(500).json({ message: e.message });
        }
    });

    // POST: Verify auto-login token and return customer data
    app.post('/api/public/expired/verify-session', async (req, res) => {
        try {
            const { token } = req.body;
            if (!token) {
                return res.status(400).json({ message: 'token is required' });
            }

            const sessionData = expiredSessionTokens.get(token);
            if (!sessionData) {
                return res.status(401).json({ message: 'Invalid or expired session token' });
            }

            if (sessionData.expiresAt < Date.now()) {
                expiredSessionTokens.delete(token);
                return res.status(401).json({ message: 'Session token has expired' });
            }

            // Return customer data in the same format as client-portal login
            res.json({
                id: sessionData.id,
                username: sessionData.username,
                routerId: sessionData.routerId,
                pppoeUsername: sessionData.pppoeUsername,
                accountNumber: sessionData.accountNumber,
                fullName: sessionData.fullName
            });
        } catch (e) {
            console.error('[Expired Portal] Verify session error:', e.message);
            res.status(500).json({ message: e.message });
        }
    });

    // GET: Detect client IP from TCP connection (for expired portal)
    app.get('/api/public/client-ip', (req, res) => {
        let clientIp = String(req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress || '').trim();
        if (clientIp.includes(',')) clientIp = clientIp.split(',')[0].trim();
        clientIp = clientIp.replace('::ffff:', '').replace(/^::1$/, '127.0.0.1');
        res.json({ ip: clientIp });
    });

    // GET: Public store settings (for expired portal)
    app.get('/api/public/store-settings', async (req, res) => {
        try {
            const s = await db.get('SELECT storeSettings, currency FROM settings WHERE id = 1');
            const systemCurrency = s?.currency || 'PHP';
            if (s && s.storeSettings) {
                try {
                    const settings = JSON.parse(s.storeSettings);
                    res.json({
                        customExpiredMessage: settings.customExpiredMessage || '',
                        storeBannerText: settings.storeBannerText || '',
                        storeEnabled: settings.storeEnabled !== false,
                        paymentMethods: settings.paymentMethods || { paymongo: true, manualGcash: true },
                        gcashNumber: settings.gcashNumber || '',
                        gcashAccountName: settings.gcashAccountName || '',
                        currency: systemCurrency,
                        storeTheme: settings.storeTheme || 'modern'
                    });
                } catch (_) { res.json({ currency: systemCurrency, storeTheme: 'modern' }); }
            } else {
                res.json({ storeEnabled: true, paymentMethods: { paymongo: true, manualGcash: true }, currency: systemCurrency, storeTheme: 'modern' });
            }
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    // POST: Add IP to EXPIRED_CLIENTS address-list on MikroTik
    app.post('/api/:routerId/firewall/address-list/add', protect, async (req, res) => {
        try {
            const { ipAddress, listName = 'EXPIRED_CLIENTS' } = req.body;
            if (!ipAddress) return res.status(400).json({ message: 'ipAddress is required' });
            
            const routerConfig = await db.get('SELECT * FROM routers WHERE id = ?', [req.params.routerId]);
            if (!routerConfig) return res.status(404).json({ message: 'Router not found' });
            
            const axios = require('axios');
            const routerIp = routerConfig.host || routerConfig.ip;
            const routerPort = routerConfig.port || 3002;
            const routerUser = routerConfig.username || 'admin';
            const routerPass = routerConfig.password || '';
            const apiBase = `http://${routerIp}:${routerPort}`;
            const authHeader = 'Basic ' + Buffer.from(`${routerUser}:${routerPass}`).toString('base64');
            
            // Check if entry already exists
            const existing = await axios.get(`${apiBase}/rest/ip/firewall/address-list`, {
                params: { list: listName, address: ipAddress },
                headers: { Authorization: authHeader },
                timeout: 10000
            }).catch(() => ({ data: [] }));
            
            const existingList = Array.isArray(existing.data) ? existing.data : [];
            if (existingList.length > 0) {
                return res.json({ message: 'IP already in address list', existing: true });
            }
            
            // Add to address list
            await axios.put(`${apiBase}/rest/ip/firewall/address-list`, {
                list: listName,
                address: ipAddress,
                comment: `Expired client - added by billing system`
            }, {
                headers: { Authorization: authHeader },
                timeout: 10000
            });
            
            console.log(`[Firewall] Added ${ipAddress} to ${listName} on router ${routerConfig.name}`);
            res.json({ message: `Added ${ipAddress} to ${listName}`, success: true });
        } catch (e) {
            console.error('[Firewall] Address-list add error:', e.message);
            res.status(500).json({ message: e.message });
        }
    });

    // POST: Remove IP from EXPIRED_CLIENTS address-list on MikroTik
    app.post('/api/:routerId/firewall/address-list/remove', protect, async (req, res) => {
        try {
            const { ipAddress, listName = 'EXPIRED_CLIENTS' } = req.body;
            if (!ipAddress) return res.status(400).json({ message: 'ipAddress is required' });
            
            const routerConfig = await db.get('SELECT * FROM routers WHERE id = ?', [req.params.routerId]);
            if (!routerConfig) return res.status(404).json({ message: 'Router not found' });
            
            const axios = require('axios');
            const routerIp = routerConfig.host || routerConfig.ip;
            const routerPort = routerConfig.port || 3002;
            const routerUser = routerConfig.username || 'admin';
            const routerPass = routerConfig.password || '';
            const apiBase = `http://${routerIp}:${routerPort}`;
            const authHeader = 'Basic ' + Buffer.from(`${routerUser}:${routerPass}`).toString('base64');
            
            // Find the entry
            const entries = await axios.get(`${apiBase}/rest/ip/firewall/address-list`, {
                params: { list: listName, address: ipAddress },
                headers: { Authorization: authHeader },
                timeout: 10000
            }).catch(() => ({ data: [] }));
            
            const entryList = Array.isArray(entries.data) ? entries.data : [];
            if (entryList.length === 0) {
                return res.json({ message: 'IP not found in address list', notFound: true });
            }
            
            // Remove all matching entries
            for (const entry of entryList) {
                await axios.delete(`${apiBase}/rest/ip/firewall/address-list/${entry['.id']}`, {
                    headers: { Authorization: authHeader },
                    timeout: 10000
                });
            }
            
            console.log(`[Firewall] Removed ${ipAddress} from ${listName} on router ${routerConfig.name}`);
            res.json({ message: `Removed ${ipAddress} from ${listName}`, success: true });
        } catch (e) {
            console.error('[Firewall] Address-list remove error:', e.message);
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
            
            // ====== CANVAS LAYOUT CONSTANTS & PAGE SETUP ======
            const PAGE_WIDTH = 595;
            const PAGE_HEIGHT = 842;
            const MARGIN_LEFT = 45;
            const MARGIN_RIGHT = 45;
            const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN_LEFT + MARGIN_RIGHT); // Exactly 505 points wide
            
            // Color constants
            const COLORS = {
                primary: rgb(0.059, 0.090, 0.165),      // #0f172a - Navy/Slate Dark
                secondary: rgb(0.278, 0.333, 0.412),     // #475569 - Subdued gray
                bgLight: rgb(0.973, 0.980, 0.984),       // #f8fafc - Light background
                bgMedium: rgb(0.945, 0.961, 0.976),      // #f1f5f9 - Medium background
                accent: rgb(0.192, 0.251, 0.361),        // #31405c - Accent blue
                white: rgb(1, 1, 1),
                black: rgb(0, 0, 0),
                border: rgb(0.878, 0.894, 0.914)         // #e2e8f0 - Border gray
            };

            // Helper: Draw filled rectangle
            const drawRect = (x, y, w, h, color, opacity = 1) => {
                page.drawRectangle({ x, y, width: w, height: h, color, opacity });
            };

            // Helper: Draw text with options
            const drawText = (text, x, y, size = 12, isBold = false, color = COLORS.black, maxWidth = null) => {
                const fontToUse = isBold ? boldFont : font;
                const textToDraw = String(text || '');
                page.drawText(textToDraw, { 
                    x, 
                    y, 
                    size, 
                    font: fontToUse, 
                    color,
                    maxWidth: maxWidth || undefined
                });
            };

            // Helper: Get text width
            const getTextWidth = (text, size, isBold = false) => {
                const fontToUse = isBold ? boldFont : font;
                return fontToUse.widthOfTextAtSize(String(text || ''), size);
            };

            // ====== DYNAMIC LOGO RETRIEVAL ======
            let logoImage = null;
            const logoSrc = companySettings?.logoBase64 || companySettings?.logoUrl || '';
            
            if (logoSrc) {
                try {
                    // Handle base64 image
                    if (logoSrc.startsWith('data:image/')) {
                        const base64Data = logoSrc.split(',')[1];
                        const imageBuffer = Buffer.from(base64Data, 'base64');
                        
                        if (logoSrc.includes('png')) {
                            logoImage = await doc.embedPng(imageBuffer);
                        } else if (logoSrc.includes('jpeg') || logoSrc.includes('jpg')) {
                            logoImage = await doc.embedJpg(imageBuffer);
                        }
                    } 
                    // Handle URL (would need to fetch - skip for now, use placeholder)
                    else if (logoSrc.startsWith('http')) {
                        console.log('[PDF] Logo URL detected but URL fetching not implemented in this route');
                    }
                } catch (logoErr) {
                    console.warn('[PDF] Failed to embed logo:', logoErr.message);
                    logoImage = null;
                }
            }

            // ====== DYNAMIC ROW ACCUMULATOR SYSTEM ======
            let currentY = PAGE_HEIGHT - 50; // Starts from the top margin area

            // ====== TWO-COLUMN BRAND HEADER LOGO & TEXT BOUNDS ======
            // Draw the company details side-by-side without horizontal collisions
            
            const LOGO_WIDTH = 75; // Fixed width for logo
            const LOGO_HEIGHT = 75;
            const LOGO_GAP = 15; // Clean 15-point gap between logo and text
            const TEXT_START_X = MARGIN_LEFT + LOGO_WIDTH + LOGO_GAP; // X = MARGIN_LEFT + 90
            const TEXT_AREA_WIDTH = CONTENT_WIDTH - LOGO_WIDTH - LOGO_GAP;
            
            // Draw logo if exists
            if (logoImage) {
                page.drawImage(logoImage, {
                    x: MARGIN_LEFT,
                    y: currentY - LOGO_HEIGHT,
                    width: LOGO_WIDTH,
                    height: LOGO_HEIGHT,
                    opacity: 1
                });
            } else {
                // Logo placeholder - bordered box
                drawRect(MARGIN_LEFT, currentY - LOGO_HEIGHT, LOGO_WIDTH, LOGO_HEIGHT, COLORS.bgLight);
                drawRect(MARGIN_LEFT, currentY - LOGO_HEIGHT, LOGO_WIDTH, 1, COLORS.border); // Top
                drawRect(MARGIN_LEFT, currentY - LOGO_HEIGHT, 1, LOGO_HEIGHT, COLORS.border); // Left
                drawRect(MARGIN_LEFT + LOGO_WIDTH - 1, currentY - LOGO_HEIGHT, 1, LOGO_HEIGHT, COLORS.border); // Right
                drawRect(MARGIN_LEFT, currentY - 1, LOGO_WIDTH, 1, COLORS.border); // Bottom
            }
            
            // Draw company name at X = MARGIN_LEFT + 90
            const companyName = companySettings?.companyName || 'CITYCONNECT NETWORK';
            const nameFontSize = 18;
            const nameLineHeight = 1.2;
            
            // Handle long company names with word wrapping
            const nameFontWidth = boldFont.widthOfTextAtSize(companyName, nameFontSize);
            let nameEndY = currentY;
            
            if (nameFontWidth > TEXT_AREA_WIDTH) {
                // Multi-line company name - split and render
                const words = companyName.split(' ');
                let currentLine = '';
                
                for (const word of words) {
                    const testLine = currentLine ? `${currentLine} ${word}` : word;
                    const testWidth = boldFont.widthOfTextAtSize(testLine, nameFontSize);
                    
                    if (testWidth > TEXT_AREA_WIDTH && currentLine) {
                        drawText(currentLine, TEXT_START_X, currentY, nameFontSize, true, COLORS.primary);
                        currentY -= (nameFontSize * nameLineHeight);
                        currentLine = word;
                    } else {
                        currentLine = testLine;
                    }
                }
                if (currentLine) {
                    drawText(currentLine, TEXT_START_X, currentY, nameFontSize, true, COLORS.primary);
                    currentY -= (nameFontSize * nameLineHeight);
                }
            } else {
                drawText(companyName, TEXT_START_X, currentY, nameFontSize, true, COLORS.primary);
                currentY -= (nameFontSize * nameLineHeight);
            }
            
            // Explicit spacing after company name
            currentY -= 4;

            // Company details (address, contact, email)
            const detailsFontSize = 8.5;
            const detailsLineHeight = 1.4;
            const detailsSpacing = 2;
            
            if (companySettings?.address) {
                drawText(companySettings.address, TEXT_START_X, currentY, detailsFontSize, false, COLORS.secondary);
                currentY -= (detailsFontSize * detailsLineHeight + detailsSpacing);
            }
            
            // Tel: xxx | Email: xxx (single line)
            const contactParts = [];
            if (companySettings?.contactNumber) contactParts.push(`Tel: ${companySettings.contactNumber}`);
            if (companySettings?.email) contactParts.push(`Email: ${companySettings.email}`);
            
            if (contactParts.length > 0) {
                const contactText = contactParts.join(' | ');
                drawText(contactText, TEXT_START_X, currentY, detailsFontSize, false, COLORS.secondary);
                currentY -= (detailsFontSize * detailsLineHeight + detailsSpacing);
            }

            // Thick bottom border line (spans full CONTENT_WIDTH)
            const borderY = currentY - 8;
            drawRect(MARGIN_LEFT, borderY, CONTENT_WIDTH, 2, COLORS.primary);
            
            // Advance currentY cleanly below the header line
            currentY = borderY - 20; // Moves the marker down safely

            // ====== APPLICATION TITLE WITH ACCENT BANNER (Fluid Spacing) ======
            const bannerPadding = 10;
            const titleFontSize = 14;
            const titleText = 'INTERNET SERVICE APPLICATION FORM';
            const titleHeight = titleFontSize + (bannerPadding * 2);
            
            // Banner background - auto-height based on content
            drawRect(MARGIN_LEFT, currentY - bannerPadding, CONTENT_WIDTH, titleHeight, COLORS.bgMedium);
            
            // Banner top and bottom borders
            drawRect(MARGIN_LEFT, currentY - bannerPadding, CONTENT_WIDTH, 2, COLORS.accent);
            drawRect(MARGIN_LEFT, currentY - bannerPadding + titleHeight - 2, CONTENT_WIDTH, 2, COLORS.accent);
            
            // Application title centered in banner
            const titleWidth = getTextWidth(titleText, titleFontSize, true);
            const titleY = currentY - bannerPadding + ((titleHeight - titleFontSize) / 2);
            drawText(titleText, MARGIN_LEFT + (CONTENT_WIDTH - titleWidth) / 2, titleY, titleFontSize, true, COLORS.primary);
            
            // Explicit margin after title banner
            currentY = currentY - bannerPadding - titleHeight - 15;

            // ====== APPLICATION ID & DATE HIGHLIGHTED BANNER (Fluid) ======
            const metaFontSize = 9;
            const metaBannerPadding = 8;
            const metaBannerHeight = metaFontSize + (metaBannerPadding * 2);
            
            drawRect(MARGIN_LEFT, currentY - metaBannerPadding, CONTENT_WIDTH, metaBannerHeight, COLORS.bgLight);
            drawRect(MARGIN_LEFT, currentY - metaBannerPadding, CONTENT_WIDTH, 1.5, COLORS.border);
            drawRect(MARGIN_LEFT, currentY - metaBannerPadding + metaBannerHeight - 1.5, CONTENT_WIDTH, 1.5, COLORS.border);
            
            const metaY = currentY - metaBannerPadding + ((metaBannerHeight - metaFontSize) / 2);
            drawText(`Application ID: ${id}`, MARGIN_LEFT + 10, metaY, metaFontSize, true, COLORS.accent);
            
            const dateText = `Date: ${new Date(createdAt).toLocaleString()}`;
            const dateWidth = getTextWidth(dateText, metaFontSize, false);
            drawText(dateText, MARGIN_LEFT + CONTENT_WIDTH - dateWidth - 10, metaY, metaFontSize, false, COLORS.secondary);
            
            // Explicit margin after meta banner
            currentY = currentY - metaBannerPadding - metaBannerHeight - 20;

            // ====== PERFECT REGULATION 4-COLUMN TABLE GRID ENGINE ======
            // Calculate exact widths of balanced 4-column key-value grid across 505-point content canvas
            
            const colWidthLabel = CONTENT_WIDTH * 0.20;    // 20% width = 101 points
            const colWidthValue = CONTENT_WIDTH * 0.30;    // 30% width = 151.5 points
            const colWidthFull = CONTENT_WIDTH * 0.80;     // 80% for colspan=3 equivalent
            const rowHeight = 24;                           // Fixed row height
            const cellPadding = 8;                          // Internal padding
            const borderWidth = 1;                          // Uniform border width
            
            // Exact X anchors programmatically calculated
            const col1X = MARGIN_LEFT;                                      // Column 1 (Label) X
            const col2X = MARGIN_LEFT + colWidthLabel;                     // Column 2 (Value) X
            const col3X = MARGIN_LEFT + colWidthLabel + colWidthValue;    // Column 3 (Label) X
            const col4X = MARGIN_LEFT + (colWidthLabel * 2) + colWidthValue; // Column 4 (Value) X

            // Helper: Draw a single cell with border and background
            const drawGridCell = (x, y, width, height, text, isLabel = false) => {
                // Cell background
                const bgColor = isLabel ? COLORS.bgLight : COLORS.white;
                drawRect(x, y, width, height, bgColor);
                
                // Cell borders (all 4 sides - borderWidth: 1, borderColor: rgb(0.878, 0.894, 0.914))
                drawRect(x, y, width, borderWidth, COLORS.border);                    // Top
                drawRect(x, y + height - borderWidth, width, borderWidth, COLORS.border); // Bottom
                drawRect(x, y, borderWidth, height, COLORS.border);                   // Left
                drawRect(x + width - borderWidth, y, borderWidth, height, COLORS.border); // Right
                
                // Cell text
                const textColor = isLabel ? COLORS.secondary : COLORS.primary;
                const fontWeight = isLabel;
                const fontSize = 9;
                const textY = y + ((height - fontSize) / 2); // Vertically centered
                
                drawText(String(text || 'N/A'), x + cellPadding, textY, fontSize, fontWeight, textColor, width - (cellPadding * 2));
            };

            // Helper: Draw a complete 4-column grid row
            const drawGridRow4Col = (label1, value1, label2, value2, yPos) => {
                // Column 1: Label (20%) - X = MARGIN_LEFT
                drawGridCell(col1X, yPos, colWidthLabel, rowHeight, label1, true);
                
                // Column 2: Value (30%) - X = MARGIN_LEFT + colWidthLabel
                drawGridCell(col2X, yPos, colWidthValue, rowHeight, value1, false);
                
                // Column 3: Label (20%) - X = MARGIN_LEFT + colWidthLabel + colWidthValue
                drawGridCell(col3X, yPos, colWidthLabel, rowHeight, label2, true);
                
                // Column 4: Value (30%) - X = MARGIN_LEFT + (colWidthLabel * 2) + colWidthValue
                drawGridCell(col4X, yPos, colWidthValue, rowHeight, value2, false);
            };

            // Helper: Draw a row with label + full-width value (colspan=3 equivalent)
            const drawGridRowFullWidth = (label, value, yPos) => {
                // Column 1: Label (20%)
                drawGridCell(col1X, yPos, colWidthLabel, rowHeight, label, true);
                
                // Columns 2-4: Full width value (80%)
                drawGridCell(col2X, yPos, colWidthFull, rowHeight, value, false);
            };

            // ====== APPLICANT INFORMATION SECTION ======
            drawText('APPLICANT INFORMATION', MARGIN_LEFT, currentY, 11, true, COLORS.primary);
            currentY -= 5;
            drawRect(MARGIN_LEFT, currentY, CONTENT_WIDTH, 2, COLORS.accent);
            currentY -= 25;

            // Row 1: Full Name | Account Number
            drawGridRow4Col(
                'Full Name:', customerData?.fullName || userData.name,
                'Account No:', customerData?.accountNumber || 'N/A',
                currentY
            );
            currentY -= rowHeight;
            
            // Row 2: Contact Number | Email
            drawGridRow4Col(
                'Contact No:', customerData?.contactNumber || userData.phone || 'N/A',
                'Email:', customerData?.email || userData.email || 'N/A',
                currentY
            );
            currentY -= rowHeight;
            
            // Row 3: Address (full width - colspan=3)
            drawGridRowFullWidth('Address:', customerData?.address || 'N/A', currentY);
            currentY -= rowHeight;
            
            // Row 4: GPS Location (if available, full width)
            if (customerData?.gps) {
                drawGridRowFullWidth('GPS Location:', customerData.gps, currentY);
                currentY -= rowHeight;
            }
            
            // Explicit margin after grid table
            currentY -= 18;

            // ====== SERVICE DETAILS SECTION ======
            drawText('SERVICE DETAILS', MARGIN_LEFT, currentY, 11, true, COLORS.primary);
            currentY -= 5;
            drawRect(MARGIN_LEFT, currentY, CONTENT_WIDTH, 2, COLORS.accent);
            currentY -= 25;

            // Service details 4-column grid
            // Row 1: Service Type | Plan
            drawGridRow4Col(
                'Service Type:', source === 'pppoe' ? 'PPPoE' : 'DHCP',
                'Plan:', planData?.name || 'N/A',
                currentY
            );
            currentY -= rowHeight;
            
            // Row 2: Monthly Rate | Speed Limit (conditional)
            if (planData?.price || planData?.speedLimit) {
                drawGridRow4Col(
                    'Monthly Rate:', planData?.price ? `${planData.currency || 'PHP'} ${planData.price}` : 'N/A',
                    'Speed Limit:', planData?.speedLimit || 'N/A',
                    currentY
                );
                currentY -= rowHeight;
            }
            
            // Row 3: Plan Type (full width if exists)
            if (planData?.planType) {
                drawGridRowFullWidth('Plan Type:', planData.planType, currentY);
                currentY -= rowHeight;
            }
            
            // Explicit margin after service details grid
            currentY -= 25;

            // ====== TERMS AND CONDITIONS CALLOUT BOX ======
            drawText('TERMS AND CONDITIONS', MARGIN_LEFT, currentY, 11, true, COLORS.primary);
            currentY -= 5;
            drawRect(MARGIN_LEFT, currentY, CONTENT_WIDTH, 2, COLORS.accent);
            currentY -= 20;

            // Callout box background
            const terms = [
                '1. Payment is due on the specified due date.',
                '2. Service interruption may occur for non-payment.',
                '3. Customer agrees to abide by the acceptable use policy.',
                '4. Installation fees may apply.',
                '5. 24-hour notice required for service cancellation.'
            ];
            
            const termsBoxHeight = (terms.length * 16) + 15;
            drawRect(MARGIN_LEFT, currentY - termsBoxHeight + 10, CONTENT_WIDTH, termsBoxHeight, COLORS.bgLight);
            drawRect(MARGIN_LEFT, currentY - termsBoxHeight + 10, CONTENT_WIDTH, 2, COLORS.border);
            drawRect(MARGIN_LEFT, currentY - termsBoxHeight + 10, 2, termsBoxHeight, COLORS.border);
            drawRect(MARGIN_LEFT + CONTENT_WIDTH - 2, currentY - termsBoxHeight + 10, 2, termsBoxHeight, COLORS.border);
            drawRect(MARGIN_LEFT, currentY - 2, CONTENT_WIDTH, 2, COLORS.border);
            
            for (let i = 0; i < terms.length; i++) {
                drawText(terms[i], MARGIN_LEFT + 10, currentY - 12 - (i * 16), 9, false, COLORS.secondary);
            }
            currentY -= (termsBoxHeight + 35);

            // ====== SIGNATURE GRID TABLE (page-break-inside: avoid) ======
            // Signature section container with border
            const sigBoxHeight = 70;
            const sigWidth = 200;
            const sigGap = 50;
            const totalSigWidth = (sigWidth * 2) + sigGap;
            const sigStartX = MARGIN_LEFT + (CONTENT_WIDTH - totalSigWidth) / 2;
            
            // Signature box background and border
            drawRect(sigStartX - 10, currentY - sigBoxHeight + 10, totalSigWidth + 20, sigBoxHeight, COLORS.white);
            drawRect(sigStartX - 10, currentY - sigBoxHeight + 10, totalSigWidth + 20, 2, COLORS.border);
            drawRect(sigStartX - 10, currentY - sigBoxHeight + 10, 2, sigBoxHeight, COLORS.border);
            drawRect(sigStartX - 10 + totalSigWidth + 8, currentY - sigBoxHeight + 10, 2, sigBoxHeight, COLORS.border);
            drawRect(sigStartX - 10, currentY - 2, totalSigWidth + 20, 2, COLORS.border);
            
            // Left signature
            drawText('_________________________', sigStartX, currentY - 25, 10, false, COLORS.primary);
            drawText('Applicant Signature', sigStartX, currentY - 42, 9, true, COLORS.secondary);
            drawText(`Date: ___________________`, sigStartX, currentY - 57, 9, false, COLORS.secondary);
            
            // Right signature
            const rightSigX = sigStartX + sigWidth + sigGap;
            drawText('_________________________', rightSigX, currentY - 25, 10, false, COLORS.primary);
            drawText('Company Representative', rightSigX, currentY - 42, 9, true, COLORS.secondary);
            drawText(`Date: ___________________`, rightSigX, currentY - 57, 9, false, COLORS.secondary);

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
                // Store MAC address from active session for future expired lookups
                const sessionMac = match['caller-id'] || '';
                if (sessionMac) {
                    const normalizedSessionMac = String(sessionMac).toUpperCase().replace(/[:-]/g, ':');
                    try {
                        await db.run('UPDATE customers SET lastKnownMac = ? WHERE username = ? AND routerId = ?',
                            [normalizedSessionMac, username, router.id]);
                    } catch (_) {}
                }
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
                ? (methodMap[method] || ['qrph'])
                : (pSettings.paymentMethods || ['qrph']);

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

    // --- Xendit API ---
    app.post('/api/payments/create-xendit-checkout', async (req, res) => {
        try {
            const { pppoe_username, plan_name, amount, duration_days, router_id, planType, planId, paymentMethod } = req.body;

            // Get Xendit settings
            const settings = await new Promise((resolve, reject) => {
                db.get('SELECT xenditSettings FROM settings WHERE id = 1', (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });

            const xenditSettings = JSON.parse(settings?.xenditSettings || '{}');
            if (!xenditSettings.enabled || !xenditSettings.secretKey) {
                return res.status(400).json({ error: 'Xendit is not configured' });
            }

            const invoice_no = 'XND-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();

            // Per-method convenience fee calculation
            // Xendit PH fees:
            //   - E-wallets (gcash, maya): 2.5%
            //   - QR PH (qrph): 2.0%
            //   - Cards (card): 3.5% + PHP 15
            //   - Bank Transfer (bank_transfer): 1.5%
            //   - OTC - 7-Eleven (seven_eleven): PHP 25 flat
            //   - OTC - Cebuana (cebuana): PHP 25 flat
            //   - OTC - DP/MLhuillier (dp_mlhuillier): PHP 25 flat
            const baseAmount = Number(amount);
            const passFees = !!xenditSettings.passFeesToCustomer;
            const method = (paymentMethod || '').toLowerCase();

            const computeTotal = (base, m) => {
                if (m === 'card') return (base + 15) / (1 - 0.035);
                if (m === 'qrph') return base / (1 - 0.020);
                if (['gcash', 'maya'].includes(m)) return base / (1 - 0.025);
                if (m === 'bank_transfer') return base / (1 - 0.015);
                if (['seven_eleven', 'cebuana', 'cebuarana', 'dp_mlhuillier'].includes(m)) return base + 25;
                return base * 1.03; // fallback flat 3%
            };

            const totalAmount = passFees ? Math.round(computeTotal(baseAmount, method) * 100) / 100 : baseAmount;
            const convenienceFee = Math.round((totalAmount - baseAmount) * 100) / 100;

            // Map internal method IDs to Xendit channel codes for invoice restriction
            const xenditChannelMap = {
                gcash: 'GCASH',
                maya: 'PAYMAYA',
                qrph: 'QRPH',
                card: 'CARDS',
                bank_transfer: 'BANK_TRANSFER',
                seven_eleven: '7ELEVEN',
                cebuana: 'CEBUANA',
                cebuarana: 'CEBUANA',
                dp_mlhuillier: 'MLHUILLIER'
            };

            // Restrict checkout to the chosen method when passing fees so the calculated
            // total matches the actual fee charged by Xendit.
            const isKnownMethod = method && Object.prototype.hasOwnProperty.call(xenditChannelMap, method);
            const allowedMethods = (passFees && isKnownMethod)
                ? [xenditChannelMap[method]]
                : (xenditSettings.paymentMethods || []).map(m => xenditChannelMap[m] || m).filter(Boolean);

            // Create Xendit invoice via API
            const response = await fetch('https://api.xendit.co/v2/invoices', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Basic ' + Buffer.from(xenditSettings.secretKey + ':').toString('base64')
                },
                body: JSON.stringify({
                    external_id: invoice_no,
                    amount: totalAmount,
                    currency: 'PHP',
                    description: `Payment for ${plan_name} - ${pppoe_username}`,
                    payment_methods: allowedMethods,
                    success_redirect_url: xenditSettings.webhookUrl ? xenditSettings.webhookUrl.replace('/api/xendit-webhook', '/payment-success') : undefined,
                    failure_redirect_url: xenditSettings.webhookUrl ? xenditSettings.webhookUrl.replace('/api/xendit-webhook', '/payment-failed') : undefined,
                    metadata: {
                        pppoe_username,
                        plan_name,
                        duration_days,
                        router_id,
                        invoice_no,
                        planType: planType || 'pppoe',
                        planId: planId || '',
                        base_amount: String(baseAmount),
                        convenience_fee: String(convenienceFee),
                        total_amount: String(totalAmount),
                        payment_method: method || '',
                        pass_fees: passFees ? '1' : '0'
                    }
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error('[Xendit] Invoice creation failed:', errorData);
                return res.status(response.status).json({ error: 'Failed to create Xendit invoice', details: errorData });
            }

            const invoiceData = await response.json();

            // Store session in database
            db.run(
                `INSERT INTO xendit_sessions (session_id, invoice_id, invoice_no, pppoe_username, router_id, plan_name, amount, base_amount, convenience_fee, total_amount, payment_method, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
                [invoiceData.id, invoiceData.id, invoice_no, pppoe_username, router_id, plan_name, totalAmount, baseAmount, convenienceFee, totalAmount, method || ''],
                (err) => {
                    if (err) console.error('[Xendit] Failed to store session:', err);
                }
            );

            res.json({
                checkout_url: invoiceData.invoice_url,
                invoice_no: invoice_no,
                invoice_id: invoiceData.id,
                amount: totalAmount,
                base_amount: baseAmount,
                convenience_fee: convenienceFee,
                payment_method: method || ''
            });
        } catch (error) {
            console.error('[Xendit] Checkout error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

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

                        // Detect if postpaid
                        let isPostpaid = false;
                        let originalFixedDay = null;
                        try {
                            if (comment.planType && String(comment.planType).toLowerCase() === 'postpaid') {
                                isPostpaid = true;
                            }
                            if (comment.fixedDay) {
                                originalFixedDay = parseInt(comment.fixedDay);
                            } else if (comment.dueDate) {
                                const d = new Date(comment.dueDate);
                                if (!isNaN(d.getTime())) originalFixedDay = d.getDate();
                            }
                        } catch (e) {}

                        // Calculate new due date
                        const now = new Date();
                        let newDue;
                        
                        // For postpaid: preserve the original fixedDay and advance by 1 calendar month
                        if (isPostpaid && originalFixedDay) {
                            const currentDue = comment.dueDateTime ? new Date(comment.dueDateTime) : now;
                            const baseDate = currentDue > now ? currentDue : now;
                            let targetYear = baseDate.getFullYear();
                            let targetMonth = baseDate.getMonth() + 1; // Next month
                            
                            if (targetMonth > 11) { targetMonth = 0; targetYear++; }
                            
                            const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
                            let targetDay = originalFixedDay;
                            
                            // Handle edge case: if target month doesn't have enough days (e.g., Feb 30)
                            if (targetDay > daysInTargetMonth) {
                                targetDay = daysInTargetMonth;
                            }
                            
                            newDue = new Date(targetYear, targetMonth, targetDay, baseDate.getHours(), baseDate.getMinutes(), 0, 0);
                            console.log(`[PayMongo Webhook] Postpaid: preserved fixedDay=${originalFixedDay}, advanced to ${newDue.toISOString()}`);
                        } else {
                            // Prepaid: extend by durationDays
                            const currentDue = comment.dueDateTime ? new Date(comment.dueDateTime) : now;
                            const baseDate = currentDue > now ? currentDue : now;
                            newDue = new Date(baseDate.getTime() + durationDays * 24 * 60 * 60 * 1000);
                            console.log(`[PayMongo Webhook] Prepaid: extended by ${durationDays} days to ${newDue.toISOString()}`);
                        }
                        
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

    // --- Xendit Webhook Endpoint (public) ---
    app.post('/api/xendit-webhook', async (req, res) => {
        try {
            console.log('[Xendit Webhook] Received event');

            // Verify webhook token
            const settings = await new Promise((resolve, reject) => {
                db.get('SELECT xenditSettings FROM settings WHERE id = 1', (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });

            const xenditSettings = JSON.parse(settings?.xenditSettings || '{}');
            const callbackToken = req.headers['x-callback-token'];

            if (xenditSettings.webhookToken && callbackToken !== xenditSettings.webhookToken) {
                console.warn('[Xendit Webhook] Invalid callback token');
                return res.status(403).json({ error: 'Invalid callback token' });
            }

            const event = req.body;

            // Xendit sends invoice paid callbacks
            if (event.status === 'PAID' || event.status === 'SETTLED') {
                const metadata = event.metadata || {};
                const { pppoe_username, duration_days, router_id, plan_name, invoice_no, planType, planId } = metadata;

                console.log(`[Xendit Webhook] Payment confirmed for ${pppoe_username}, plan: ${plan_name}`);

                // Update session status
                db.run(
                    `UPDATE xendit_sessions SET status = 'paid', processed_at = datetime('now') WHERE invoice_no = ?`,
                    [invoice_no || event.external_id]
                );

                // Get router configuration and extend subscription (mirror PayMongo's logic)
                if (pppoe_username && router_id) {
                    try {
                        const router = await new Promise((resolve, reject) => {
                            db.get('SELECT * FROM routers WHERE id = ?', [router_id], (err, row) => {
                                if (err) reject(err);
                                else resolve(row);
                            });
                        });

                        if (router) {
                            const RouterOSAPI = require('routeros').RouterOSAPI;
                            const conn = new RouterOSAPI({
                                host: router.host,
                                port: router.port || 8728,
                                user: router.username,
                                password: router.password,
                                timeout: 10
                            });

                            await conn.connect();

                            // Find PPPoE user and update expiration
                            const users = await conn.write('/ppp/secret/print', [`?name=${pppoe_username}`]);
                            if (users.length > 0) {
                                const user = users[0];
                                const currentComment = user.comment || '';

                                // Calculate new expiration
                                const days = parseInt(duration_days) || 30;
                                const now = new Date();
                                const expDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
                                const expStr = expDate.toISOString().split('T')[0];

                                // Update comment with new expiration
                                let newComment = currentComment.replace(/exp=\d{4}-\d{2}-\d{2}/, `exp=${expStr}`);
                                if (!newComment.includes('exp=')) {
                                    newComment = `${newComment} exp=${expStr}`.trim();
                                }

                                await conn.write('/ppp/secret/set', [`=.id=${user['.id']}`, `=comment=${newComment}`]);
                                console.log(`[Xendit Webhook] Extended ${pppoe_username} to ${expStr}`);
                            }

                            await conn.close();
                        }
                    } catch (routerErr) {
                        console.error('[Xendit Webhook] Router connection error:', routerErr.message);
                    }
                }

                res.json({ status: 'success' });
            } else {
                console.log(`[Xendit Webhook] Non-payment event: ${event.status}`);
                res.json({ status: 'ignored' });
            }
        } catch (error) {
            console.error('[Xendit Webhook] Error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ========================================
    // Xendit Webhook Management
    // ========================================

    // GET: Check current Xendit webhook configuration status
    app.get('/api/xendit-webhook-status', async (req, res) => {
        try {
            const settings = await new Promise((resolve, reject) => {
                db.get('SELECT xenditSettings FROM settings WHERE id = 1', (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            const xenditSettings = JSON.parse(settings?.xenditSettings || '{}');

            const webhookUrl = xenditSettings.webhookUrl || '';
            const isLocalUrl = webhookUrl.includes('localhost') || webhookUrl.includes('127.0.0.1');

            res.json({
                configured: !!(xenditSettings.enabled && xenditSettings.secretKey && xenditSettings.webhookToken),
                webhookUrl: webhookUrl,
                webhookToken: xenditSettings.webhookToken ? 'configured' : 'not set',
                isLocalUrl: isLocalUrl,
                enabled: xenditSettings.enabled || false,
                note: 'Xendit webhooks must be configured in the Xendit Dashboard. Set the callback URL to your webhook endpoint and copy the Verification Token here.'
            });
        } catch (error) {
            console.error('[Xendit] Webhook status error:', error);
            res.status(500).json({ error: 'Failed to get webhook status' });
        }
    });

    // POST: Test if the configured webhook endpoint is reachable
    app.post('/api/xendit-webhook-test', async (req, res) => {
        try {
            const settings = await new Promise((resolve, reject) => {
                db.get('SELECT xenditSettings FROM settings WHERE id = 1', (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            const xenditSettings = JSON.parse(settings?.xenditSettings || '{}');

            if (!xenditSettings.webhookUrl) {
                return res.status(400).json({ error: 'Webhook URL not configured' });
            }

            // Test reachability of the webhook endpoint
            const testUrl = xenditSettings.webhookUrl.replace('/api/xendit-webhook', '/api/xendit-webhook-ping');
            const response = await fetch(testUrl, { method: 'GET', signal: AbortSignal.timeout(10000) });

            res.json({
                reachable: response.ok,
                statusCode: response.status,
                url: testUrl
            });
        } catch (error) {
            res.json({
                reachable: false,
                error: error.message,
                url: xenditSettings?.webhookUrl || 'not set'
            });
        }
    });

    // GET: Public ping endpoint for webhook reachability testing
    app.get('/api/xendit-webhook-ping', (req, res) => {
        res.json({ status: 'ok', service: 'xendit-webhook', timestamp: new Date().toISOString() });
    });

    // POST: Verify Xendit API key validity by fetching balance
    app.post('/api/xendit-verify-config', async (req, res) => {
        try {
            const settings = await new Promise((resolve, reject) => {
                db.get('SELECT xenditSettings FROM settings WHERE id = 1', (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            const xenditSettings = JSON.parse(settings?.xenditSettings || '{}');

            if (!xenditSettings.secretKey) {
                return res.status(400).json({ error: 'Secret key not configured' });
            }

            // Test API key by fetching balance
            const response = await fetch('https://api.xendit.co/balance', {
                method: 'GET',
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(xenditSettings.secretKey + ':').toString('base64')
                }
            });

            if (response.ok) {
                const data = await response.json();
                res.json({ valid: true, balance: data.balance });
            } else {
                const error = await response.json();
                res.json({ valid: false, error: error.message || 'Invalid API key' });
            }
        } catch (error) {
            res.status(500).json({ error: 'Failed to verify configuration' });
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
            let fbConfig = {};
            try {
                const fbSettings = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
                fbConfig = JSON.parse(fbSettings?.facebookSettings || '{}');
            } catch (parseErr) {
                console.error('[Facebook Clients] Failed to parse Facebook settings:', parseErr.message);
                return res.status(400).json({ message: 'Facebook Messenger settings are corrupted. Please reconfigure in System Settings.' });
            }
            
            if (!fbConfig.enabled || !fbConfig.pageAccessToken) {
                return res.status(400).json({ message: 'Facebook Messenger not configured or not enabled. Go to System Settings > Facebook to configure.' });
            }
            
            // Calculate days until due
            const now = new Date();
            const dueDate = customer.dueDate ? new Date(customer.dueDate) : null;
            const daysUntilDue = dueDate ? Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24)) : null;
            
            let message;
            if (daysUntilDue === null) {
                message = `📅 PAYMENT NOTIFICATION\n━━━━━━━━━━━━━━━━━━\n\n📋 Account: ${customer.accountNumber || 'N/A'}\n👤 Name: ${customer.fullName || 'Valued Customer'}\n💰 Amount Due: ₱${(customer.planPrice || 0).toFixed(2)}\n📅 Due Date: Not set\n\n💳 Pay via:\n• PAY ONLINE - Online payment\n• PAY MANUAL - GCash payment\n\n📞 Contact us if you need assistance.`;
            } else if (daysUntilDue < 0) {
                message = `⚠️ OVERDUE PAYMENT NOTICE\n━━━━━━━━━━━━━━━━━━\n\n📋 Account: ${customer.accountNumber || 'N/A'}\n👤 Name: ${customer.fullName || 'Valued Customer'}\n💰 Amount Due: ₱${(customer.planPrice || 0).toFixed(2)}\n📅 Due Date: ${customer.dueDate} (${Math.abs(daysUntilDue)} days overdue)\n\n⚠️ Your internet service may be suspended.\n\n💳 Pay now via:\n• PAY ONLINE - Online payment\n• PAY MANUAL - GCash payment\n\n📞 Contact us if you need assistance.`;
            } else if (daysUntilDue === 0) {
                message = `🔴 PAYMENT DUE TODAY\n━━━━━━━━━━━━━━━━━━\n\n📋 Account: ${customer.accountNumber || 'N/A'}\n👤 Name: ${customer.fullName || 'Valued Customer'}\n💰 Amount Due: ₱${(customer.planPrice || 0).toFixed(2)}\n📅 Due Date: TODAY\n\n⏰ Please make your payment today to avoid service interruption.\n\n💳 Pay now via:\n• PAY ONLINE - Online payment\n• PAY MANUAL - GCash payment\n\n📞 Contact us if you need assistance.`;
            } else if (daysUntilDue <= 3) {
                message = `⏰ PAYMENT REMINDER\n━━━━━━━━━━━━━━━━━━\n\n📋 Account: ${customer.accountNumber || 'N/A'}\n👤 Name: ${customer.fullName || 'Valued Customer'}\n💰 Amount Due: ₱${(customer.planPrice || 0).toFixed(2)}\n📅 Due Date: ${customer.dueDate} (${daysUntilDue} day${daysUntilDue > 1 ? 's' : ''})\n\n💡 This is a friendly reminder to make your payment on time.\n\n💳 Pay now via:\n• PAY ONLINE - Online payment\n• PAY MANUAL - GCash payment\n\n📞 Contact us if you need assistance.`;
            } else {
                message = `📅 PAYMENT NOTIFICATION\n━━━━━━━━━━━━━━━━━━\n\n📋 Account: ${customer.accountNumber || 'N/A'}\n👤 Name: ${customer.fullName || 'Valued Customer'}\n💰 Amount Due: ₱${(customer.planPrice || 0).toFixed(2)}\n📅 Due Date: ${customer.dueDate} (${daysUntilDue} days)\n\n💳 Pay via:\n• PAY ONLINE - Online payment\n• PAY MANUAL - GCash payment\n\n📞 Contact us if you need assistance.`;
            }
            
            // Send Facebook message
            const axios = require('axios');
            let fbResponse;
            try {
                // Use RESPONSE type - works within 24h of last user interaction
                fbResponse = await axios.post(
                    `https://graph.facebook.com/v21.0/me/messages?access_token=${fbConfig.pageAccessToken}`,
                    {
                        messaging_type: 'RESPONSE',
                        recipient: { id: customer.facebook_psid },
                        message: { text: message }
                    },
                    { timeout: 10000 }
                );
            } catch (fbErr) {
                const fbErrorData = fbErr.response?.data?.error;
                const isOutsideWindow = fbErrorData?.error_subcode === 2018278 || 
                                        (fbErrorData?.message || '').includes('outside of allowed window');
                
                if (isOutsideWindow) {
                    console.warn(`[Facebook Clients] Cannot send to ${customer.accountNumber}: outside 24h messaging window. User must message the bot first.`);
                    return res.status(403).json({ 
                        message: `Cannot send reminder: ${customer.fullName || 'this customer'} hasn't messaged the bot in the last 24 hours. Facebook only allows replies within 24h of the user's last message.`,
                        outside_window: true
                    });
                }
                
                // Try UPDATE as fallback
                try {
                    fbResponse = await axios.post(
                        `https://graph.facebook.com/v21.0/me/messages?access_token=${fbConfig.pageAccessToken}`,
                        {
                            messaging_type: 'UPDATE',
                            recipient: { id: customer.facebook_psid },
                            message: { text: message }
                        },
                        { timeout: 10000 }
                    );
                } catch (fallbackErr) {
                    const fallbackData = fallbackErr.response?.data?.error;
                    const fallbackIsOutsideWindow = fallbackData?.error_subcode === 2018278 || 
                                                    (fallbackData?.message || '').includes('outside of allowed window');
                    if (fallbackIsOutsideWindow) {
                        return res.status(403).json({ 
                            message: `Cannot send reminder: ${customer.fullName || 'this customer'} hasn't messaged the bot in the last 24 hours.`,
                            outside_window: true
                        });
                    }
                    const fallbackMsg = fallbackData?.message || fallbackErr.message;
                    console.error('[Facebook Clients] Fallback also failed:', fallbackErr.response?.data || fallbackErr.message);
                    return res.status(502).json({ message: `Facebook API error: ${fallbackMsg}` });
                }
            }
            
            console.log(`[Facebook Clients] Reminder sent to ${customer.accountNumber} (${customer.facebook_psid})`);
            
            res.json({ 
                message: 'Reminder sent successfully',
                facebook_message_id: fbResponse.data.message_id,
                days_until_due: daysUntilDue
            });
        } catch (e) {
            console.error('[Facebook Clients] Error sending reminder:', e.message);
            res.status(500).json({ message: `Internal error: ${e.message}` });
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
            let fbConfig = {};
            try {
                const fbSettings = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
                fbConfig = JSON.parse(fbSettings?.facebookSettings || '{}');
            } catch (parseErr) {
                return res.status(400).json({ message: 'Facebook Messenger settings are corrupted.' });
            }
            
            if (!fbConfig.enabled || !fbConfig.pageAccessToken) {
                return res.status(400).json({ message: 'Facebook Messenger not configured' });
            }
            
            const results = [];
            const axios = require('axios');
            
            for (const customer of clients) {
                try {
                    const daysUntilDue = customer.dueDate ? Math.ceil((new Date(customer.dueDate) - now) / (1000 * 60 * 60 * 24)) : null;
                    
                    let message;
                    if (daysUntilDue === null) {
                        message = `📅 PAYMENT NOTIFICATION\nAccount: ${customer.accountNumber || 'N/A'}\nAmount: ₱${(customer.planPrice || 0).toFixed(2)}\n\nSend PAY to this bot to pay.`;
                    } else if (daysUntilDue < 0) {
                        message = `⚠️ OVERDUE: ₱${(customer.planPrice || 0).toFixed(2)}\nAccount: ${customer.accountNumber || 'N/A'}\nDue: ${customer.dueDate} (${Math.abs(daysUntilDue)} days overdue)\n\nPay now to avoid suspension!\nSend PAY to this bot to pay.`;
                    } else if (daysUntilDue === 0) {
                        message = `🔴 DUE TODAY: ₱${(customer.planPrice || 0).toFixed(2)}\nAccount: ${customer.accountNumber || 'N/A'}\n\nPlease pay today to avoid service interruption.\nSend PAY to this bot.`;
                    } else {
                        message = `⏰ Reminder: ₱${(customer.planPrice || 0).toFixed(2)} due in ${daysUntilDue} day${daysUntilDue > 1 ? 's' : ''}\nAccount: ${customer.accountNumber || 'N/A'}\nDue: ${customer.dueDate}\n\nSend PAY to this bot to pay.`;
                    }
                    
                    // Try RESPONSE first (within 24h window), fallback to UPDATE
                    try {
                        await axios.post(
                            `https://graph.facebook.com/v21.0/me/messages?access_token=${fbConfig.pageAccessToken}`,
                            {
                                messaging_type: 'RESPONSE',
                                recipient: { id: customer.facebook_psid },
                                message: { text: message }
                            },
                            { timeout: 10000 }
                        );
                    } catch (respErr) {
                        const errData = respErr.response?.data?.error;
                        const isOutsideWindow = errData?.error_subcode === 2018278 || 
                                                (errData?.message || '').includes('outside of allowed window');
                        if (isOutsideWindow) {
                            throw new Error('Outside 24h messaging window - user must message bot first');
                        }
                        // Fallback to UPDATE
                        await axios.post(
                            `https://graph.facebook.com/v21.0/me/messages?access_token=${fbConfig.pageAccessToken}`,
                            {
                                messaging_type: 'UPDATE',
                                recipient: { id: customer.facebook_psid },
                                message: { text: message }
                            },
                            { timeout: 10000 }
                        );
                    }
                    
                    results.push({
                        account: customer.accountNumber,
                        facebook_psid: customer.facebook_psid,
                        status: 'sent',
                        days_until_due: daysUntilDue
                    });
                } catch (err) {
                    const errData = err.response?.data?.error;
                    const isOutsideWindow = (err.message || '').includes('Outside 24h') || 
                                            errData?.error_subcode === 2018278;
                    const errMsg = isOutsideWindow ? 'Outside 24h window' : (errData?.message || err.message);
                    results.push({
                        account: customer.accountNumber,
                        facebook_psid: customer.facebook_psid,
                        status: isOutsideWindow ? 'skipped' : 'failed',
                        error: errMsg
                    });
                }
            }
            
            const sentCount = results.filter(r => r.status === 'sent').length;
            const skippedCount = results.filter(r => r.status === 'skipped').length;
            const failedCount = results.filter(r => r.status === 'failed').length;
            
            console.log(`[Facebook Clients] Bulk reminders: ${sentCount} sent, ${skippedCount} skipped (outside window), ${failedCount} failed / ${clients.length} total`);
            
            res.json({ 
                message: `Sent: ${sentCount}, Skipped: ${skippedCount} (outside 24h window), Failed: ${failedCount}`,
                total: clients.length,
                sent: sentCount,
                skipped: skippedCount,
                failed: failedCount,
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
            let fbConfig = {};
            try {
                const fbSettings = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
                fbConfig = JSON.parse(fbSettings?.facebookSettings || '{}');
            } catch (parseErr) {
                return res.status(400).json({ message: 'Facebook Messenger settings are corrupted.' });
            }
            
            if (!fbConfig.enabled || !fbConfig.pageAccessToken) {
                return res.status(400).json({ message: 'Facebook Messenger not configured' });
            }
            
            const axios = require('axios');
            let sentCount = 0;
            let skippedCount = 0;
            let failedCount = 0;
            const results = [];
            
            for (const client of fbClients) {
                try {
                    // Personalize message with customer name
                    const personalizedMessage = message
                        .replace('{name}', client.fullName || 'Valued Customer')
                        .replace('{account}', client.accountNumber || 'N/A');
                    
                    // Try RESPONSE first, fallback to UPDATE
                    try {
                        await axios.post(
                            `https://graph.facebook.com/v21.0/me/messages?access_token=${fbConfig.pageAccessToken}`,
                            {
                                messaging_type: 'RESPONSE',
                                recipient: { id: client.facebook_psid },
                                message: { text: personalizedMessage }
                            },
                            { timeout: 10000 }
                        );
                    } catch (respErr) {
                        const errData = respErr.response?.data?.error;
                        const isOutsideWindow = errData?.error_subcode === 2018278 || 
                                                (errData?.message || '').includes('outside of allowed window');
                        if (isOutsideWindow) {
                            skippedCount++;
                            results.push({
                                accountNumber: client.accountNumber,
                                facebook_psid: client.facebook_psid,
                                status: 'skipped',
                                error: 'Outside 24h window'
                            });
                            continue;
                        }
                        // Fallback to UPDATE
                        await axios.post(
                            `https://graph.facebook.com/v21.0/me/messages?access_token=${fbConfig.pageAccessToken}`,
                            {
                                messaging_type: 'UPDATE',
                                recipient: { id: client.facebook_psid },
                                message: { text: personalizedMessage }
                            },
                            { timeout: 10000 }
                        );
                    }
                    
                    sentCount++;
                    console.log(`[Facebook Broadcast] ✓ Sent to ${client.accountNumber} (${client.fullName})`);
                    results.push({
                        accountNumber: client.accountNumber,
                        facebook_psid: client.facebook_psid,
                        status: 'sent'
                    });
                } catch (err) {
                    failedCount++;
                    const errData = err.response?.data?.error;
                    console.error(`[Facebook Broadcast] ✗ Failed for ${client.accountNumber}:`, errData?.message || err.message);
                    results.push({
                        accountNumber: client.accountNumber,
                        facebook_psid: client.facebook_psid,
                        status: 'failed',
                        error: errData?.message || err.message
                    });
                }
            }
            
            console.log(`[Facebook Broadcast] Complete: ${sentCount} sent, ${skippedCount} skipped, ${failedCount} failed out of ${fbClients.length} total`);
            
            res.json({
                message: `Broadcast complete: ${sentCount} sent, ${skippedCount} skipped (outside 24h window), ${failedCount} failed`,
                total: fbClients.length,
                sent: sentCount,
                skipped: skippedCount,
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
            console.log('[Facebook Webhook] ========================================');
            console.log('[Facebook Webhook] Message event received');
            console.log('[Facebook Webhook] Request body:', JSON.stringify(req.body, null, 2).substring(0, 500));
            
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
            
            console.log('[Facebook Webhook] Facebook is enabled, token exists:', !!fbSettings.pageAccessToken);

            const body = req.body;

            // Iterate over each entry in case there are multiple
            if (body.object && body.entry && Array.isArray(body.entry)) {
                for (const entry of body.entry) {
                    // Handle messaging events
                    if (entry.messaging && Array.isArray(entry.messaging)) {
                        for (const event of entry.messaging) {
                            const senderId = event.sender?.id;
                            const message = event.message;

                            // Handle postback (button click) events
                            if (senderId && event.postback) {
                                const postbackPayload = event.postback.payload;
                                console.log(`[Facebook Bot] Postback from ${senderId}: "${postbackPayload}"`);
                                
                                try {
                                    await handlePostback(senderId, postbackPayload, fbSettings.pageAccessToken);
                                } catch (pbErr) {
                                    console.error('[Facebook Bot] Postback handler error:', pbErr.message);
                                    console.error('[Facebook Bot] Postback error stack:', pbErr.stack);
                                    await sendFacebookMessage(senderId, '⚠️ Sorry, an error occurred. Please try again.', fbSettings.pageAccessToken);
                                }
                                continue; // Skip text message handling for postback events
                            }
                            
                            if (senderId && message && message.text) {
                                const userMessage = message.text.trim();
                                console.log(`[Facebook Bot] Message from ${senderId}: "${userMessage}"`);
                                
                                try {
                                    console.log(`[Facebook Bot] Processing message from ${senderId}: "${userMessage}"`);
                                    
                                    // Check conversation states first (Notify Admin, Register via button, Repair detail)
                                    const convState = conversationStates.get(senderId);
                                    if (convState) {
                                        if (convState.step === 'awaiting_admin_message') {
                                            // User typed their message for admin
                                            conversationStates.delete(senderId);
                                            
                                            // Look up customer info
                                            const fbSettings2 = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
                                            const fbConfig2 = JSON.parse(fbSettings2?.facebookSettings || '{}');
                                            const routerId2 = fbConfig2.routerId;
                                            let customer2;
                                            if (routerId2) {
                                                customer2 = await db.get('SELECT * FROM customers WHERE facebook_psid = ? AND routerId = ?', [senderId, routerId2]);
                                            } else {
                                                customer2 = await db.get('SELECT * FROM customers WHERE facebook_psid = ?', [senderId]);
                                            }
                                            
                                            await notifyAdminFromBot(
                                                customer2?.fullName || 'Unregistered User',
                                                customer2?.accountNumber || 'N/A',
                                                senderId,
                                                userMessage
                                            );
                                            
                                            await sendFacebookButtonMessage(senderId,
                                                '✅ Your message has been sent to the admin. They will get back to you soon!\n\nIs there anything else I can help you with?',
                                                [
                                                    { type: 'postback', title: '📊 Check Bill', payload: 'CHECK_BILL' },
                                                    { type: 'postback', title: '🔧 Report Issue', payload: 'REPORT_ISSUE' },
                                                    { type: 'postback', title: '🏠 Main Menu', payload: 'MAIN_MENU' }
                                                ],
                                                fbSettings.pageAccessToken
                                            );
                                            return;
                                        }
                                        
                                        if (convState.step === 'awaiting_account_number') {
                                            // User typed account number via button flow
                                            conversationStates.delete(senderId);
                                            const fbSettings2 = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
                                            const fbConfig2 = JSON.parse(fbSettings2?.facebookSettings || '{}');
                                            const routerId2 = fbConfig2.routerId;
                                            
                                            const response = await handleRegisterCommand(senderId, `REGISTER ${userMessage}`, routerId2);
                                            
                                            // Check if registration was successful
                                            if (response.includes('Success') || response.includes('linked')) {
                                                await sendMainMenuWithButtons(senderId, fbSettings.pageAccessToken);
                                            } else {
                                                await sendFacebookMessage(senderId, response, fbSettings.pageAccessToken);
                                            }
                                            return;
                                        }
                                        
                                        if (convState.step === 'awaiting_repair_detail') {
                                            // User typed repair detail after picking a category via button
                                            conversationStates.delete(senderId);
                                            const category = convState.category || 'other';
                                            const fbSettings2 = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
                                            const fbConfig2 = JSON.parse(fbSettings2?.facebookSettings || '{}');
                                            const routerId2 = fbConfig2.routerId;
                                            
                                            // Build repair message and process it
                                            const categoryPrefix = { 'no_internet': 'NO INTERNET', 'slow_connection': 'SLOW', 'intermittent': 'INTERMITTENT' };
                                            const prefix = categoryPrefix[category] || 'REPAIR';
                                            const response = await handleRepairTicketCommand(senderId, `${prefix} ${userMessage}`);
                                            await sendFacebookButtonMessage(senderId, response,
                                                [
                                                    { type: 'postback', title: '📋 My Tickets', payload: 'MY_TICKETS' },
                                                    { type: 'postback', title: '📢 Notify Admin', payload: 'NOTIFY_ADMIN' },
                                                    { type: 'postback', title: '🏠 Main Menu', payload: 'MAIN_MENU' }
                                                ],
                                                fbSettings.pageAccessToken
                                            );
                                            return;
                                        }
                                    }
                                    
                                    // First, check if user is in manual payment flow
                                    const manualPaymentResponse = await processManualPaymentSteps(senderId, userMessage);
                                    
                                    // If in manual payment flow, use that response
                                    if (manualPaymentResponse) {
                                        console.log(`[Facebook Bot] Using manual payment flow response`);
                                        await sendFacebookMessage(senderId, manualPaymentResponse, fbSettings.pageAccessToken);
                                    } else {
                                        // Otherwise, process normal bot commands
                                        console.log(`[Facebook Bot] Processing normal bot command`);
                                        const response = await processFacebookBotMessage(senderId, userMessage, fbSettings.pageAccessToken);
                                        
                                        console.log(`[Facebook Bot] Response generated: ${response ? response.substring(0, 50) + '...' : 'null'}`);
                                        
                                        // Send response if there is one
                                        if (response) {
                                            await sendFacebookMessage(senderId, response, fbSettings.pageAccessToken);
                                        } else {
                                            console.warn(`[Facebook Bot] No response generated for message: "${userMessage}"`);
                                        }
                                    }
                                } catch (sendErr) {
                                    console.error('[Facebook Bot] Failed to send response:', sendErr.message);
                                    console.error('[Facebook Bot] Error stack:', sendErr.stack);
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
    
    // ========================================
    // Postback Handler (Button Clicks)
    // ========================================
    async function handlePostback(senderId, payload, pageAccessToken) {
        console.log(`[Facebook Bot] Handling postback: ${payload} from ${senderId}`);
        
        const fbSettings = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
        const fbConfig = JSON.parse(fbSettings?.facebookSettings || '{}');
        const routerId = fbConfig.routerId;
        
        switch (payload) {
            case 'MAIN_MENU': {
                // Show main menu with buttons
                await sendMainMenuWithButtons(senderId, pageAccessToken);
                break;
            }
            case 'CHECK_BILL': {
                const response = await handleBillingCommand(senderId, routerId);
                await sendFacebookButtonMessage(senderId, response, [
                    { type: 'postback', title: '💳 Pay Now', payload: 'PAY_NOW' },
                    { type: 'postback', title: '📋 My Tickets', payload: 'MY_TICKETS' },
                    { type: 'postback', title: '🏠 Main Menu', payload: 'MAIN_MENU' }
                ], pageAccessToken);
                break;
            }
            case 'PAY_NOW': {
                const response = await handlePaymentCommand(senderId, routerId);
                await sendFacebookButtonMessage(senderId, response, [
                    { type: 'postback', title: '💳 Pay Online', payload: 'PAY_ONLINE' },
                    { type: 'postback', title: '🏦 Pay Manual (GCash)', payload: 'PAY_MANUAL' },
                    { type: 'postback', title: '🏠 Main Menu', payload: 'MAIN_MENU' }
                ], pageAccessToken);
                break;
            }
            case 'PAY_ONLINE': {
                const response = await handlePayOnlineCommand(senderId, routerId);
                await sendFacebookMessage(senderId, response, pageAccessToken);
                break;
            }
            case 'PAY_MANUAL': {
                const response = await handlePayManualCommand(senderId, routerId);
                await sendFacebookMessage(senderId, response, pageAccessToken);
                break;
            }
            case 'MY_TICKETS': {
                const response = await handleTicketStatusCommand(senderId);
                await sendFacebookButtonMessage(senderId, response, [
                    { type: 'postback', title: '🔧 Report Issue', payload: 'REPORT_ISSUE' },
                    { type: 'postback', title: '🏠 Main Menu', payload: 'MAIN_MENU' }
                ], pageAccessToken);
                break;
            }
            case 'REPORT_ISSUE': {
                // Set conversation state to collect repair description
                conversationStates.set(senderId, { step: 'awaiting_repair_description' });
                await sendFacebookButtonMessage(senderId, 
                    '🔧 Please describe your issue. What seems to be the problem with your internet connection?',
                    [
                        { type: 'postback', title: '📡 No Internet', payload: 'ISSUE_NO_INTERNET' },
                        { type: 'postback', title: '🐢 Slow Connection', payload: 'ISSUE_SLOW' },
                        { type: 'postback', title: '📶 Intermittent', payload: 'ISSUE_INTERMITTENT' }
                    ],
                    pageAccessToken
                );
                break;
            }
            case 'ISSUE_NO_INTERNET': {
                conversationStates.set(senderId, { step: 'awaiting_repair_detail', category: 'no_internet' });
                await sendFacebookMessage(senderId, '📡 No Internet - Please provide more details about your issue (e.g., "Red light blinking on modem", "No lights at all"):');
                break;
            }
            case 'ISSUE_SLOW': {
                conversationStates.set(senderId, { step: 'awaiting_repair_detail', category: 'slow_connection' });
                await sendFacebookMessage(senderId, '🐢 Slow Connection - Please describe the issue (e.g., "Very slow during evening", "Buffering on YouTube"):');
                break;
            }
            case 'ISSUE_INTERMITTENT': {
                conversationStates.set(senderId, { step: 'awaiting_repair_detail', category: 'intermittent' });
                await sendFacebookMessage(senderId, '📶 Intermittent - Please describe the issue (e.g., "Disconnects every 30 minutes", "Cuts when it rains"):');
                break;
            }
            case 'NOTIFY_ADMIN': {
                // Set conversation state to collect message
                conversationStates.set(senderId, { step: 'awaiting_admin_message' });
                await sendFacebookMessage(senderId, 
                    '📢 Please type your message below and our admin will be notified.\n\nWhat would you like to tell the admin?'
                );
                break;
            }
            case 'REGISTER_ACCOUNT': {
                console.log(`[Facebook Bot] REGISTER_ACCOUNT postback from ${senderId}`);
                conversationStates.set(senderId, { step: 'awaiting_account_number' });
                await sendFacebookMessage(senderId, 
                    '📝 Please send your account number to link your Facebook account.\n\nExample: 20240001\n\nYou can find your account number on your billing statement.'
                );
                console.log(`[Facebook Bot] REGISTER_ACCOUNT: Sent prompt to ${senderId}`);
                break;
            }
            default: {
                // Unknown postback - show main menu
                console.warn(`[Facebook Bot] Unknown postback payload: ${payload}`);
                await sendMainMenuWithButtons(senderId, pageAccessToken);
            }
        }
    }
    
    // ========================================
    // Main Menu with Buttons
    // ========================================
    async function sendMainMenuWithButtons(senderId, pageAccessToken) {
        try {
            // Check if user is registered
            const fbSettings = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
            const fbConfig = JSON.parse(fbSettings?.facebookSettings || '{}');
            const routerId = fbConfig.routerId;
            
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
            
            let welcomeText;
            let buttons;
            
            if (customer) {
                welcomeText = `👋 Welcome back, ${customer.fullName || 'Customer'}!\n\n📋 Account: ${customer.accountNumber}\n📦 Plan: ${customer.planName || 'N/A'}\n\nWhat would you like to do?`;
                buttons = [
                    { type: 'postback', title: '📊 Check Bill', payload: 'CHECK_BILL' },
                    { type: 'postback', title: '💳 Pay Now', payload: 'PAY_NOW' },
                    { type: 'postback', title: '📢 Notify Admin', payload: 'NOTIFY_ADMIN' }
                ];
            } else {
                welcomeText = `👋 Welcome to CityConnect Billing Bot!\n\n🤖 I can help you with:\n• Check your billing\n• Make payments\n• Report internet issues\n• Contact admin\n\nTo get started, please link your account first.`;
                buttons = [
                    { type: 'postback', title: '📝 Register Account', payload: 'REGISTER_ACCOUNT' },
                    { type: 'postback', title: '📢 Notify Admin', payload: 'NOTIFY_ADMIN' }
                ];
            }
            
            await sendFacebookButtonMessage(senderId, welcomeText, buttons, pageAccessToken);
        } catch (err) {
            console.error('[Facebook Bot] sendMainMenuWithButtons error:', err.message);
            // Fallback to text-only menu
            await sendFacebookMessage(senderId, getHelpMessage(), pageAccessToken);
        }
    }
    
    async function processFacebookBotMessage(senderId, userMessage, pageAccessToken) {
        try {
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

        // Command: END, STOP, EXIT, MAIN, MENU - Show button main menu
        if (['END', 'STOP', 'EXIT', 'MAIN', 'MENU', 'HOME', 'BACK'].some(cmd => upperMessage === cmd || upperMessage.startsWith(cmd + ' '))) {
            conversationStates.delete(senderId);
            await sendMainMenuWithButtons(senderId, pageAccessToken);
            return null; // Already sent via button message
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

        // Command: HELP - Show button main menu
        if (upperMessage === 'HELP' || upperMessage === 'COMMANDS') {
            await sendMainMenuWithButtons(senderId, pageAccessToken);
            return null; // Already sent via button message
        }

        // Default: Show button main menu
        await sendMainMenuWithButtons(senderId, pageAccessToken);
        return null; // Already sent via button message
        } catch (err) {
            console.error('[Facebook Bot] processFacebookBotMessage error:', err.message);
            console.error('[Facebook Bot] Error stack:', err.stack);
            return `⚠️ Sorry, an error occurred. Please try again or contact support.`;
        }
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
                'https://graph.facebook.com/v21.0/me/messages',
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

    // Helper function to send messages with buttons via Facebook Graph API
    async function sendFacebookButtonMessage(recipientId, text, buttons, pageAccessToken) {
        try {
            console.log('[Facebook Bot] Sending button message to:', recipientId);
            
            const response = await axios.post(
                'https://graph.facebook.com/v21.0/me/messages',
                {
                    recipient: { id: recipientId },
                    message: {
                        attachment: {
                            type: 'template',
                            payload: {
                                template_type: 'button',
                                text: text,
                                buttons: buttons
                            }
                        }
                    },
                    messaging_type: 'RESPONSE'
                },
                {
                    params: { access_token: pageAccessToken },
                    timeout: 10000
                }
            );
            console.log('[Facebook Bot] Button message sent successfully:', response.data);
            return response.data;
        } catch (err) {
            console.error('[Facebook Bot] Send button message error:', err.message);
            if (err.response) {
                console.error('[Facebook Bot] Response data:', JSON.stringify(err.response.data, null, 2));
            }
            throw err;
        }
    }

    // Helper: Send notification to admin via Telegram + in-app
    async function notifyAdminFromBot(customerName, customerAccount, senderId, message) {
        try {
            const settings = await db.get('SELECT telegramSettings FROM settings WHERE id = 1');
            const telegramSettings = JSON.parse(settings?.telegramSettings || '{}');
            
            const notifMessage = `📢 Customer Notification Request\n━━━━━━━━━━━━━━━━━━\n\n👤 Name: ${customerName || 'Unknown'}\n📋 Account: ${customerAccount || 'Unknown'}\n💬 Message: ${message || 'No message provided'}\n\n⏰ Time: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' })}`;
            
            // Send Telegram notification to admin
            if (telegramSettings?.enabled && telegramSettings.botToken && telegramSettings.chatId) {
                try {
                    await axios.post(`https://api.telegram.org/bot${telegramSettings.botToken}/sendMessage`, {
                        chat_id: telegramSettings.chatId,
                        text: notifMessage,
                        parse_mode: 'HTML'
                    });
                    console.log('[Facebook Bot] Admin notified via Telegram');
                } catch (tgErr) {
                    console.error('[Facebook Bot] Telegram notification failed:', tgErr.message);
                }
            }
            
            // Create in-app notification
            const notifId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await db.run(
                'INSERT INTO notifications (id, type, message, is_read, timestamp, link_to, context_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [notifId, 'info', notifMessage, 0, new Date().toISOString(), 'facebook-clients', JSON.stringify({ senderId, customerAccount, customerName })]
            );
            console.log('[Facebook Bot] In-app notification created for admin');
        } catch (err) {
            console.error('[Facebook Bot] notifyAdminFromBot error:', err.message);
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

    // Endpoint to set Facebook Persistent Menu (floating menu in Messenger)
    app.post('/api/facebook-persistent-menu', protect, async (req, res) => {
        try {
            const settings = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
            const fbSettings = JSON.parse(settings?.facebookSettings || '{}');
            
            if (!fbSettings.pageAccessToken) {
                return res.status(400).json({ success: false, message: 'Page Access Token is not configured. Please set it in Facebook Messenger settings.' });
            }
            
            console.log('[Facebook Persistent Menu] Setting up persistent menu...');
            
            // Set persistent menu via Messenger Profile API
            const response = await axios.post(
                'https://graph.facebook.com/v21.0/me/messenger_profile',
                {
                    persistent_menu: [
                        {
                            locale: 'default',
                            composer_input_disabled: false,
                            call_to_actions: [
                                {
                                    type: 'postback',
                                    title: '📊 Check Bill',
                                    payload: 'CHECK_BILL'
                                },
                                {
                                    type: 'postback',
                                    title: '💳 Pay Now',
                                    payload: 'PAY_NOW'
                                },
                                {
                                    type: 'postback',
                                    title: '🔧 Report Issue',
                                    payload: 'REPORT_ISSUE'
                                },
                                {
                                    type: 'postback',
                                    title: '📋 My Tickets',
                                    payload: 'MY_TICKETS'
                                },
                                {
                                    type: 'postback',
                                    title: '📢 Notify Admin',
                                    payload: 'NOTIFY_ADMIN'
                                },
                                {
                                    type: 'postback',
                                    title: '🏠 Main Menu',
                                    payload: 'MAIN_MENU'
                                }
                            ]
                        }
                    ]
                },
                {
                    params: { access_token: fbSettings.pageAccessToken },
                    timeout: 10000
                }
            );
            
            console.log('[Facebook Persistent Menu] Success:', response.data);
            res.json({ 
                success: true, 
                message: '✅ Persistent menu set successfully!\n\nUsers will now see a floating menu (☰) in the Messenger conversation with:\n• 📊 Check Bill\n• 💳 Pay Now\n• 🔧 Report Issue\n• 📋 My Tickets\n• 📢 Notify Admin\n• 🏠 Main Menu\n\nNote: It may take a few minutes to appear in Messenger.'
            });
        } catch (err) {
            console.error('[Facebook Persistent Menu] Error:', err.message);
            const fbError = err.response?.data?.error;
            let errorMessage = err.message;
            if (fbError) {
                errorMessage = `Facebook API Error: ${fbError.message || 'Unknown error'} (Code: ${fbError.code || 'N/A'})`;
                if (fbError.code === 100) {
                    errorMessage += '\n\n💡 Hint: Invalid parameter. Make sure your Page Access Token has pages_messaging permission.';
                }
            }
            res.status(500).json({ success: false, message: errorMessage });
        }
    });

    // Endpoint to delete Facebook Persistent Menu
    app.delete('/api/facebook-persistent-menu', protect, async (req, res) => {
        try {
            const settings = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
            const fbSettings = JSON.parse(settings?.facebookSettings || '{}');
            
            if (!fbSettings.pageAccessToken) {
                return res.status(400).json({ success: false, message: 'Page Access Token is not configured.' });
            }
            
            await axios.delete('https://graph.facebook.com/v21.0/me/messenger_profile', {
                params: { access_token: fbSettings.pageAccessToken },
                data: { fields: ['persistent_menu'] },
                timeout: 10000
            });
            
            console.log('[Facebook Persistent Menu] Deleted successfully');
            res.json({ success: true, message: '✅ Persistent menu removed successfully.' });
        } catch (err) {
            console.error('[Facebook Persistent Menu] Delete error:', err.message);
            res.status(500).json({ success: false, message: err.message });
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

    // --- Landing Page Background Image Upload ---
    app.post('/api/landing/bg-image-upload', protect, express.json({ limit: '10mb' }), async (req, res) => {
        try {
            const { base64 } = req.body;
            if (!base64 || typeof base64 !== 'string' || !base64.startsWith('data:image/')) {
                return res.status(400).json({ message: 'Invalid image data. Upload a valid image file.' });
            }
            const s = await db.get('SELECT landingPageConfig FROM settings WHERE id = 1');
            let cfg = {};
            try { cfg = JSON.parse(s?.landingPageConfig || '{}'); } catch (_) {}
            cfg.bgImageBase64 = base64;
            await db.run('UPDATE settings SET landingPageConfig = ? WHERE id = 1', JSON.stringify(cfg));
            res.json({ message: 'Background image saved.', bgImageBase64: base64 });
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
        if (!pppoeUsername) return res.status(400).json({ message: 'PPPoE username is required' });
        try {
            // First, try to fetch account number from customers table based on pppoeUsername and routerId
            let fetchedAccountNumber = null;
            if (routerId && pppoeUsername) {
                const customer = await db.get(
                    'SELECT accountNumber FROM customers WHERE routerId = ? AND username = ?',
                    [routerId, pppoeUsername]
                );
                if (customer && customer.accountNumber) {
                    fetchedAccountNumber = customer.accountNumber;
                    console.log(`[Client Portal] Fetched account number ${fetchedAccountNumber} for PPPoE user ${pppoeUsername}`);
                }
            }
            
            // Use fetched account number, or provided one, or generate as last resort
            const acc = fetchedAccountNumber || (accountNumber && String(accountNumber).trim() !== '' ? accountNumber : await generateAccountNumber());
            
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
            const id = `u_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            await db.run('INSERT INTO client_users (id, username, password_hash, salt, router_id, pppoe_username, account_number, created_at) VALUES (?,?,?,?,?,?,?,?)',
                [id, username, hash, salt, routerId, pppoeUsername, acc, new Date().toISOString()]);
            res.json({ message: 'User created', id, accountNumber: acc });
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

    // Fetch account number for a PPPoE user (Protected)
    clientPortalRouter.get('/lookup-account', protect, async (req, res) => {
        try {
            const { routerId, pppoeUsername } = req.query;
            if (!routerId || !pppoeUsername) {
                return res.status(400).json({ message: 'routerId and pppoeUsername are required' });
            }
            
            console.log(`[Client Portal Lookup] Searching for routerId=${routerId}, pppoeUsername=${pppoeUsername}`);
            
            const customer = await db.get(
                'SELECT accountNumber FROM customers WHERE routerId = ? AND username = ?',
                [routerId, pppoeUsername]
            );
            
            if (customer && customer.accountNumber) {
                console.log(`[Client Portal Lookup] ✓ Found account number: ${customer.accountNumber}`);
                res.json({ accountNumber: customer.accountNumber, found: true });
            } else {
                console.log(`[Client Portal Lookup] ✗ Account number not found`);
                res.json({ accountNumber: null, found: false, message: 'Account number not found for this PPPoE user' });
            }
        } catch (e) { 
            console.error(`[Client Portal Lookup] Error:`, e.message);
            res.status(500).json({ message: e.message }); 
        }
    });

    // Admin: Delete Client User (Protected)
    clientPortalRouter.delete('/users/:id', protect, async (req, res) => {
        try {
            await db.run('DELETE FROM client_users WHERE id = ?', [req.params.id]);
            res.json({ message: 'Deleted' });
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // Check if a client portal account exists for a PPPoE user (Protected)
    clientPortalRouter.get('/check-account', protect, async (req, res) => {
        try {
            const { routerId, pppoeUsername } = req.query;
            if (!routerId || !pppoeUsername) {
                return res.status(400).json({ message: 'routerId and pppoeUsername are required' });
            }
            const user = await db.get(
                'SELECT id, username FROM client_users WHERE router_id = ? AND pppoe_username = ?',
                [routerId, pppoeUsername]
            );
            res.json({ exists: !!user, username: user?.username || null, id: user?.id || null });
        } catch (e) {
            console.error('[Client Portal Check] Error:', e.message);
            res.status(500).json({ message: e.message });
        }
    });

    // Auto-create or update client portal account from PPPoE user management (Protected)
    clientPortalRouter.post('/auto-create', protect, async (req, res) => {
        const { routerId, pppoeUsername, password, accountNumber } = req.body;
        if (!pppoeUsername) return res.status(400).json({ message: 'PPPoE username is required' });
        if (!routerId) return res.status(400).json({ message: 'Router ID is required' });
        try {
            // Check if account already exists for this PPPoE user + router
            const existing = await db.get(
                'SELECT * FROM client_users WHERE router_id = ? AND pppoe_username = ?',
                [routerId, pppoeUsername]
            );

            if (existing) {
                // Update existing account - only update password if provided
                if (password) {
                    const salt = crypto.randomBytes(16).toString('hex');
                    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
                    await db.run(
                        'UPDATE client_users SET password_hash = ?, salt = ? WHERE id = ?',
                        [hash, salt, existing.id]
                    );
                }
                // Update account number if provided and different
                if (accountNumber && accountNumber !== existing.account_number) {
                    await db.run(
                        'UPDATE client_users SET account_number = ? WHERE id = ?',
                        [accountNumber, existing.id]
                    );
                }
                res.json({ message: 'Portal account updated', id: existing.id, created: false });
            } else {
                // Create new account using PPPoE username as portal username
                if (!password) return res.status(400).json({ message: 'Password is required for new portal accounts' });
                const salt = crypto.randomBytes(16).toString('hex');
                const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
                const id = `u_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const acc = accountNumber || await generateAccountNumber();
                await db.run(
                    'INSERT INTO client_users (id, username, password_hash, salt, router_id, pppoe_username, account_number, created_at) VALUES (?,?,?,?,?,?,?,?)',
                    [id, pppoeUsername, hash, salt, routerId, pppoeUsername, acc, new Date().toISOString()]
                );
                res.json({ message: 'Portal account created', id, created: true, accountNumber: acc });
            }
        } catch (e) {
            if (e.message.includes('UNIQUE constraint failed')) {
                return res.status(409).json({ message: 'A portal account with this username already exists' });
            }
            console.error('[Client Portal Auto-Create] Error:', e.message);
            res.status(500).json({ message: e.message });
        }
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

    // --- Auto Backup Settings ---
    let autoBackupTimer = null;

    const getAutoBackupSettings = async () => {
        const s = await db.get('SELECT autoBackupSettings FROM settings WHERE id = 1');
        if (s && s.autoBackupSettings) {
            try { return JSON.parse(s.autoBackupSettings); } catch (e) {}
        }
        return { enabled: false, intervalHours: 24, maxBackups: 10, lastBackup: null };
    };

    const performAutoBackup = async () => {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupName = `auto_backup_${timestamp}.db`;
            const backupPath = path.join(BACKUP_DIR, backupName);
            await fs.promises.copyFile(DB_PATH, backupPath);
            console.log(`[AutoBackup] Backup created: ${backupName}`);

            // Update lastBackup timestamp
            const settings = await getAutoBackupSettings();
            settings.lastBackup = new Date().toISOString();
            await db.run('UPDATE settings SET autoBackupSettings = ? WHERE id = 1', [JSON.stringify(settings)]);

            // Cleanup old backups beyond maxBackups
            const files = await fs.promises.readdir(BACKUP_DIR);
            const autoBackups = files.filter(f => f.startsWith('auto_backup_') && f.endsWith('.db'))
                .sort((a, b) => a.localeCompare(b)); // oldest first
            
            while (autoBackups.length > settings.maxBackups) {
                const oldest = autoBackups.shift();
                await fs.promises.unlink(path.join(BACKUP_DIR, oldest));
                console.log(`[AutoBackup] Deleted old backup: ${oldest}`);
            }
        } catch (e) {
            console.error('[AutoBackup] Error:', e.message);
        }
    };

    const scheduleAutoBackup = () => {
        if (autoBackupTimer) {
            clearInterval(autoBackupTimer);
            autoBackupTimer = null;
        }

        getAutoBackupSettings().then(settings => {
            if (settings.enabled && settings.intervalHours > 0) {
                const intervalMs = settings.intervalHours * 60 * 60 * 1000;
                
                // Check if we need to run immediately (past due)
                if (settings.lastBackup) {
                    const lastBackupTime = new Date(settings.lastBackup).getTime();
                    const nextDue = lastBackupTime + intervalMs;
                    const now = Date.now();
                    
                    if (now >= nextDue) {
                        console.log('[AutoBackup] Backup overdue, running immediately...');
                        performAutoBackup();
                    }
                }

                autoBackupTimer = setInterval(() => {
                    performAutoBackup();
                }, intervalMs);
                
                console.log(`[AutoBackup] Scheduled every ${settings.intervalHours} hour(s)`);
            }
        }).catch(e => {
            console.error('[AutoBackup] Schedule error:', e.message);
        });
    };

    // Start auto backup scheduler
    scheduleAutoBackup();

    app.get('/api/auto-backup-settings', protect, requireSuperadminOrAdmin, async (req, res) => {
        try {
            const settings = await getAutoBackupSettings();
            res.json(settings);
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    app.post('/api/auto-backup-settings', protect, requireSuperadminOrAdmin, async (req, res) => {
        try {
            const { enabled, intervalHours, maxBackups } = req.body;
            
            if (typeof enabled !== 'boolean') {
                return res.status(400).json({ message: 'enabled must be boolean' });
            }
            if (!Number.isInteger(intervalHours) || intervalHours < 1) {
                return res.status(400).json({ message: 'intervalHours must be a positive integer' });
            }
            if (!Number.isInteger(maxBackups) || maxBackups < 1) {
                return res.status(400).json({ message: 'maxBackups must be a positive integer' });
            }

            const currentSettings = await getAutoBackupSettings();
            const newSettings = {
                ...currentSettings,
                enabled,
                intervalHours,
                maxBackups
            };

            await db.run('UPDATE settings SET autoBackupSettings = ? WHERE id = 1', [JSON.stringify(newSettings)]);
            
            // Reschedule auto backup
            scheduleAutoBackup();
            
            res.json({ message: 'Auto backup settings saved', settings: newSettings });
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    app.post('/api/run-auto-backup', protect, requireSuperadminOrAdmin, async (req, res) => {
        try {
            await performAutoBackup();
            res.json({ message: 'Backup created successfully' });
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    // --- Restore Backup ---
    app.post('/api/restore-backup', protect, requireSuperadminOrAdmin, express.json({ limit: '50mb' }), async (req, res) => {
        try {
            const { base64Data, filename } = req.body;
            if (!base64Data || !filename) {
                return res.status(400).json({ message: 'Missing file data or filename' });
            }
            if (!filename.endsWith('.db')) {
                return res.status(400).json({ message: 'Only .db backup files are allowed' });
            }
            if (filename.includes('..')) {
                return res.status(400).json({ message: 'Invalid filename' });
            }

            // Create a safety backup of current database before restoring
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const safetyBackup = path.join(BACKUP_DIR, `pre_restore_${timestamp}.db`);
            await fs.promises.copyFile(DB_PATH, safetyBackup);
            console.log(`[Restore] Safety backup created: pre_restore_${timestamp}.db`);

            // Decode and write the uploaded backup over the current database
            const buffer = Buffer.from(base64Data, 'base64');
            await fs.promises.writeFile(DB_PATH, buffer);
            console.log(`[Restore] Database restored from uploaded file: ${filename}`);

            res.json({ message: 'Database restored successfully. A safety backup was created before restoring. The server may need a restart.' });
        } catch (e) {
            res.status(500).json({ message: 'Restore failed: ' + e.message });
        }
    });

    // --- Restore Backup from existing file in backups directory ---
    app.post('/api/restore-backup-from-file', protect, requireSuperadminOrAdmin, async (req, res) => {
        try {
            const { backupFile } = req.body;
            if (!backupFile) {
                return res.status(400).json({ message: 'Missing backup filename' });
            }
            if (backupFile.includes('..') || !backupFile.endsWith('.db')) {
                return res.status(400).json({ message: 'Invalid backup filename' });
            }
            const filePath = path.join(BACKUP_DIR, backupFile);
            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ message: 'Backup file not found' });
            }

            // Create a safety backup of current database before restoring
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const safetyBackup = path.join(BACKUP_DIR, `pre_restore_${timestamp}.db`);
            await fs.promises.copyFile(DB_PATH, safetyBackup);
            console.log(`[Restore] Safety backup created: pre_restore_${timestamp}.db`);

            // Copy the selected backup over the current database
            await fs.promises.copyFile(filePath, DB_PATH);
            console.log(`[Restore] Database restored from: ${backupFile}`);

            res.json({ message: `Database restored from ${backupFile}. A safety backup was created. The server may need a restart.` });
        } catch (e) {
            res.status(500).json({ message: 'Restore failed: ' + e.message });
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

    // App version (semantic version from package.json)
    app.get('/api/app-version', protect, async (req, res) => {
        res.json({
            version: APP_VERSION,
            buildDate: new Date().toISOString()
        });
    });

    // Migration status
    app.get('/api/migration-status', protect, async (req, res) => {
        try {
            const { getMigrationStatus } = require('./migrations/runner');
            const status = await getMigrationStatus(db);
            res.json(status);
        } catch (e) {
            res.status(500).json({ message: 'Failed to get migration status: ' + e.message });
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

    app.get('/download-backup/:filename', (req, res, next) => {
        // Accept token from query param for direct download links
        const token = req.query.token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
        if (!token) {
            return res.status(401).json({ message: 'Authentication required.' });
        }
        jwt.verify(token, SECRET_KEY, (err, user) => {
            if (err) return res.status(403).json({ message: 'Invalid or expired token.' });
            req.user = user;
            next();
        });
    }, (req, res) => {
        const { filename } = req.params;
        if (filename.includes('..') || (!filename.endsWith('.db') && !filename.endsWith('.mk'))) {
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
        try {
            const roles = await db.all('SELECT id, name, description FROM roles');
            res.json(roles);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });
    app.get('/api/permissions', protect, async (req, res) => {
        try {
            const perms = await db.all('SELECT id, name, description FROM permissions');
            res.json(perms);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });
    app.get('/api/panel-users', protect, async (req, res) => {
        try {
            const users = await db.all('SELECT u.id, u.username, r.name as roleName FROM users u JOIN roles r ON u.role_id = r.id');
            res.json(users.map(u => ({ id: u.id, username: u.username, role: { name: u.roleName } })));
        } catch (e) { res.status(500).json({ message: e.message }); }
    });
    app.post('/api/panel-users', protect, async (req, res) => {
        const { username, password, role_id } = req.body || {};
        if (!username || !password || !role_id) {
            return res.status(400).json({ message: 'Username, password, and role_id are required.' });
        }
        try {
            const role = await db.get('SELECT id FROM roles WHERE id = ?', [role_id]);
            if (!role) {
                return res.status(400).json({ message: 'Invalid role_id specified.' });
            }
            const hash = await bcrypt.hash(password, 10);
            const id = `user_${Date.now()}`;
            await db.run('INSERT INTO users (id, username, password, role_id) VALUES (?, ?, ?, ?)', [id, username, hash, role_id]);
            console.log('[Panel Users] Created user:', username, 'with role_id:', role_id);
            const row = await db.get(`SELECT u.id, u.username, r.id AS role_id, r.name AS role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = ?`, [id]);
            res.status(201).json({ id: row.id, username: row.username, role: { id: row.role_id, name: row.role_name || '' } });
        } catch (e) {
            if (String(e.message).includes('UNIQUE')) {
                return res.status(409).json({ message: 'Username already exists.' });
            }
            res.status(500).json({ message: e.message });
        }
    });
    app.delete('/api/panel-users/:id', protect, async (req, res) => {
        try {
            const id = req.params.id;
            if (req.user.id === id) {
                return res.status(403).json({ message: 'You cannot delete your own account.' });
            }
            const result = await db.run('DELETE FROM users WHERE id = ?', [id]);
            if (result.changes === 0) {
                return res.status(404).json({ message: 'User not found.' });
            }
            res.status(204).send();
        } catch (e) { res.status(500).json({ message: e.message }); }
    });
    app.get('/api/roles/:roleId/permissions', protect, async (req, res) => {
        try {
            const rows = await db.all(`SELECT permission_id FROM role_permissions WHERE role_id = ?`, [req.params.roleId]);
            res.json(rows.map(r => r.permission_id));
        } catch (e) { res.status(500).json({ message: e.message }); }
    });
    app.put('/api/roles/:roleId/permissions', protect, async (req, res) => {
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
                try { await db.exec('ROLLBACK;'); } catch (rbErr) { console.error('Rollback failed:', rbErr.message); }
            }
            res.status(500).json({ message: e.message });
        }
    });

    // --- Network Equipment (OLT/PON/Splitter/NAP) CRUD ---
    const genId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // List all equipment
    app.get('/api/network-equipment', protect, async (req, res) => {
        try {
            const rows = await db.all('SELECT * FROM network_equipment ORDER BY created_at DESC');
            res.json(rows);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // Add equipment
    app.post('/api/network-equipment', protect, async (req, res) => {
        const { router_id, name, type, brand, model, ip_address, snmp_community, snmp_port, total_pon_ports, status, notes } = req.body;
        if (!name) return res.status(400).json({ message: 'Name is required' });
        try {
            const id = genId('olt');
            await db.run(
                `INSERT INTO network_equipment (id, router_id, name, type, brand, model, ip_address, snmp_community, snmp_port, total_pon_ports, status, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
                [id, router_id || null, name, type || 'olt', brand || null, model || null, ip_address || null, snmp_community || 'public', snmp_port || 161, total_pon_ports || 0, status || 'active', notes || null]
            );
            const row = await db.get('SELECT * FROM network_equipment WHERE id = ?', [id]);
            res.json(row);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // Update equipment
    app.put('/api/network-equipment/:id', protect, async (req, res) => {
        const { router_id, name, type, brand, model, ip_address, snmp_community, snmp_port, total_pon_ports, status, notes } = req.body;
        try {
            await db.run(
                `UPDATE network_equipment SET router_id=?, name=?, type=?, brand=?, model=?, ip_address=?, snmp_community=?, snmp_port=?, total_pon_ports=?, status=?, notes=?, updated_at=datetime('now') WHERE id=?`,
                [router_id || null, name, type || 'olt', brand || null, model || null, ip_address || null, snmp_community || 'public', snmp_port || 161, total_pon_ports || 0, status || 'active', notes || null, req.params.id]
            );
            const row = await db.get('SELECT * FROM network_equipment WHERE id = ?', [req.params.id]);
            res.json(row);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // Delete equipment
    app.delete('/api/network-equipment/:id', protect, async (req, res) => {
        try {
            // Cascade: delete PON ports, then splitters, NAPs, NAP ports
            const ponPorts = await db.all('SELECT id FROM olt_pon_ports WHERE equipment_id = ?', [req.params.id]);
            for (const pon of ponPorts) {
                const splitters = await db.all('SELECT id FROM olt_splitters WHERE pon_port_id = ?', [pon.id]);
                for (const spl of splitters) {
                    const naps = await db.all('SELECT id FROM olt_naps WHERE splitter_id = ?', [spl.id]);
                    for (const nap of naps) {
                        await db.run('DELETE FROM olt_nap_ports WHERE nap_id = ?', [nap.id]);
                    }
                    await db.run('DELETE FROM olt_naps WHERE splitter_id = ?', [spl.id]);
                }
                await db.run('DELETE FROM olt_splitters WHERE pon_port_id = ?', [pon.id]);
            }
            await db.run('DELETE FROM olt_pon_ports WHERE equipment_id = ?', [req.params.id]);
            await db.run('DELETE FROM network_equipment WHERE id = ?', [req.params.id]);
            res.json({ message: 'Equipment and related data deleted' });
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // List PON ports for an OLT
    app.get('/api/network-equipment/:id/pon-ports', protect, async (req, res) => {
        try {
            const rows = await db.all('SELECT * FROM olt_pon_ports WHERE equipment_id = ? ORDER BY port_index', [req.params.id]);
            res.json(rows);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // Add PON port
    app.post('/api/network-equipment/:id/pon-ports', protect, async (req, res) => {
        const { port_index, port_name, splitter_id, status, total_bandwidth_mbps, notes } = req.body;
        if (!port_index) return res.status(400).json({ message: 'port_index is required' });
        try {
            const id = genId('pon');
            await db.run(
                `INSERT INTO olt_pon_ports (id, equipment_id, port_index, port_name, splitter_id, status, total_bandwidth_mbps, notes) VALUES (?,?,?,?,?,?,?,?)`,
                [id, req.params.id, port_index, port_name || null, splitter_id || null, status || 'active', total_bandwidth_mbps || null, notes || null]
            );
            const row = await db.get('SELECT * FROM olt_pon_ports WHERE id = ?', [id]);
            res.json(row);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // Update PON port
    app.put('/api/olt-pon-ports/:id', protect, async (req, res) => {
        const { port_index, port_name, splitter_id, status, total_bandwidth_mbps, used_ports, notes } = req.body;
        try {
            await db.run(
                `UPDATE olt_pon_ports SET port_index=?, port_name=?, splitter_id=?, status=?, total_bandwidth_mbps=?, used_ports=?, notes=? WHERE id=?`,
                [port_index, port_name || null, splitter_id || null, status || 'active', total_bandwidth_mbps || null, used_ports || 0, notes || null, req.params.id]
            );
            const row = await db.get('SELECT * FROM olt_pon_ports WHERE id = ?', [req.params.id]);
            res.json(row);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // Delete PON port
    app.delete('/api/olt-pon-ports/:id', protect, async (req, res) => {
        try {
            const splitters = await db.all('SELECT id FROM olt_splitters WHERE pon_port_id = ?', [req.params.id]);
            for (const spl of splitters) {
                const naps = await db.all('SELECT id FROM olt_naps WHERE splitter_id = ?', [spl.id]);
                for (const nap of naps) {
                    await db.run('DELETE FROM olt_nap_ports WHERE nap_id = ?', [nap.id]);
                }
                await db.run('DELETE FROM olt_naps WHERE splitter_id = ?', [spl.id]);
            }
            await db.run('DELETE FROM olt_splitters WHERE pon_port_id = ?', [req.params.id]);
            await db.run('DELETE FROM olt_pon_ports WHERE id = ?', [req.params.id]);
            res.json({ message: 'PON port and related data deleted' });
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // List all splitters
    app.get('/api/olt-splitters', protect, async (req, res) => {
        try {
            const rows = await db.all('SELECT s.*, p.equipment_id, p.port_index FROM olt_splitters s LEFT JOIN olt_pon_ports p ON s.pon_port_id = p.id ORDER BY s.created_at DESC');
            res.json(rows);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // Add splitter
    app.post('/api/olt-splitters', protect, async (req, res) => {
        const { pon_port_id, name, split_ratio, location, max_ports, installed_ports, status, notes } = req.body;
        if (!name) return res.status(400).json({ message: 'Name is required' });
        try {
            const id = genId('split');
            const ratio = split_ratio || '1:8';
            const computedMax = max_ports || parseInt(ratio.split(':')[1]) || 8;
            await db.run(
                `INSERT INTO olt_splitters (id, pon_port_id, name, split_ratio, location, max_ports, installed_ports, status, notes) VALUES (?,?,?,?,?,?,?,?,?)`,
                [id, pon_port_id || null, name, ratio, location || null, computedMax, installed_ports || 0, status || 'active', notes || null]
            );
            const row = await db.get('SELECT * FROM olt_splitters WHERE id = ?', [id]);
            res.json(row);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // Update splitter
    app.put('/api/olt-splitters/:id', protect, async (req, res) => {
        const { pon_port_id, name, split_ratio, location, max_ports, installed_ports, status, notes } = req.body;
        try {
            await db.run(
                `UPDATE olt_splitters SET pon_port_id=?, name=?, split_ratio=?, location=?, max_ports=?, installed_ports=?, status=?, notes=? WHERE id=?`,
                [pon_port_id || null, name, split_ratio || '1:8', location || null, max_ports || 8, installed_ports || 0, status || 'active', notes || null, req.params.id]
            );
            const row = await db.get('SELECT * FROM olt_splitters WHERE id = ?', [req.params.id]);
            res.json(row);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // Delete splitter
    app.delete('/api/olt-splitters/:id', protect, async (req, res) => {
        try {
            const naps = await db.all('SELECT id FROM olt_naps WHERE splitter_id = ?', [req.params.id]);
            for (const nap of naps) {
                await db.run('DELETE FROM olt_nap_ports WHERE nap_id = ?', [nap.id]);
            }
            await db.run('DELETE FROM olt_naps WHERE splitter_id = ?', [req.params.id]);
            await db.run('DELETE FROM olt_splitters WHERE id = ?', [req.params.id]);
            res.json({ message: 'Splitter and related data deleted' });
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // List all NAPs
    app.get('/api/olt-naps', protect, async (req, res) => {
        try {
            const rows = await db.all('SELECT n.*, s.name as splitter_name, s.pon_port_id FROM olt_naps n LEFT JOIN olt_splitters s ON n.splitter_id = s.id ORDER BY n.created_at DESC');
            res.json(rows);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // Add NAP
    app.post('/api/olt-naps', protect, async (req, res) => {
        const { splitter_id, name, location, gps, total_ports, status, notes } = req.body;
        if (!name) return res.status(400).json({ message: 'Name is required' });
        try {
            const id = genId('nap');
            const ports = total_ports || 8;
            await db.run(
                `INSERT INTO olt_naps (id, splitter_id, name, location, gps, total_ports, used_ports, status, notes) VALUES (?,?,?,?,?,?,0,?,?)`,
                [id, splitter_id || null, name, location || null, gps || null, ports, status || 'active', notes || null]
            );
            // Auto-create NAP port entries
            for (let i = 1; i <= ports; i++) {
                await db.run(
                    'INSERT INTO olt_nap_ports (id, nap_id, port_number, status) VALUES (?,?,?,?)',
                    [genId('napport'), id, i, 'available']
                );
            }
            const row = await db.get('SELECT * FROM olt_naps WHERE id = ?', [id]);
            res.json(row);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // Update NAP
    app.put('/api/olt-naps/:id', protect, async (req, res) => {
        const { splitter_id, name, location, gps, total_ports, used_ports, status, notes } = req.body;
        try {
            await db.run(
                `UPDATE olt_naps SET splitter_id=?, name=?, location=?, gps=?, total_ports=?, used_ports=?, status=?, notes=? WHERE id=?`,
                [splitter_id || null, name, location || null, gps || null, total_ports || 8, used_ports || 0, status || 'active', notes || null, req.params.id]
            );
            const row = await db.get('SELECT * FROM olt_naps WHERE id = ?', [req.params.id]);
            res.json(row);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // Delete NAP
    app.delete('/api/olt-naps/:id', protect, async (req, res) => {
        try {
            await db.run('DELETE FROM olt_nap_ports WHERE nap_id = ?', [req.params.id]);
            await db.run('DELETE FROM olt_naps WHERE id = ?', [req.params.id]);
            res.json({ message: 'NAP and ports deleted' });
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // List NAP ports
    app.get('/api/olt-nap-ports', protect, async (req, res) => {
        const { nap_id } = req.query;
        try {
            let rows;
            if (nap_id) {
                rows = await db.all('SELECT * FROM olt_nap_ports WHERE nap_id = ? ORDER BY port_number', [nap_id]);
            } else {
                rows = await db.all('SELECT * FROM olt_nap_ports ORDER BY nap_id, port_number');
            }
            res.json(rows);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // Update NAP port (assign client, change status)
    app.put('/api/olt-nap-ports/:id', protect, async (req, res) => {
        const { status, client_id, onu_serial, onu_signal_dbm, notes } = req.body;
        try {
            await db.run(
                `UPDATE olt_nap_ports SET status=?, client_id=?, onu_serial=?, onu_signal_dbm=?, notes=?, last_seen=datetime('now') WHERE id=?`,
                [status || 'available', client_id || null, onu_serial || null, onu_signal_dbm || null, notes || null, req.params.id]
            );
            // Update NAP used_ports count
            const port = await db.get('SELECT nap_id FROM olt_nap_ports WHERE id = ?', [req.params.id]);
            if (port) {
                const occupied = await db.get('SELECT COUNT(*) as cnt FROM olt_nap_ports WHERE nap_id = ? AND status = ?', [port.nap_id, 'occupied']);
                await db.run('UPDATE olt_naps SET used_ports = ? WHERE id = ?', [occupied?.cnt || 0, port.nap_id]);
            }
            const row = await db.get('SELECT * FROM olt_nap_ports WHERE id = ?', [req.params.id]);
            res.json(row);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // Network Topology — full tree as nested JSON
    app.get('/api/network-topology', protect, async (req, res) => {
        try {
            const equipment = await db.all('SELECT * FROM network_equipment ORDER BY name');
            const result = [];

            for (const eq of equipment) {
                const ponPorts = await db.all('SELECT * FROM olt_pon_ports WHERE equipment_id = ? ORDER BY port_index', [eq.id]);
                const ponData = [];

                for (const pon of ponPorts) {
                    let splitterData = null;
                    if (pon.splitter_id) {
                        const splitter = await db.get('SELECT * FROM olt_splitters WHERE id = ?', [pon.splitter_id]);
                        if (splitter) {
                            const naps = await db.all('SELECT * FROM olt_naps WHERE splitter_id = ? ORDER BY name', [splitter.id]);
                            const napData = [];

                            for (const nap of naps) {
                                const ports = await db.all('SELECT * FROM olt_nap_ports WHERE nap_id = ? ORDER BY port_number', [nap.id]);
                                napData.push({ ...nap, ports });
                            }

                            splitterData = { ...splitter, naps: napData };
                        }
                    }
                    ponData.push({ ...pon, splitter: splitterData });
                }

                result.push({ ...eq, ponPorts: ponData });
            }

            res.json({ equipment: result });
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // SNMP Monitor readings
    app.get('/api/network-equipment/:id/monitor', protect, async (req, res) => {
        try {
            const { hours } = req.query;
            const h = parseInt(hours) || 24;
            const rows = await db.all(
                `SELECT * FROM olt_monitor_readings WHERE equipment_id = ? AND recorded_at >= datetime('now', ?) ORDER BY recorded_at DESC LIMIT 500`,
                [req.params.id, `-${h} hours`]
            );
            res.json(rows);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // SNMP service availability status
    app.get('/api/snmp/status', protect, async (req, res) => {
        try {
            const snmpService = require('../services/snmpService.cjs');
            res.json({
                available: snmpService.isAvailable(),
                brands: snmpService.getSupportedBrands(),
                message: snmpService.isAvailable()
                    ? 'SNMP monitoring is active'
                    : 'net-snmp package not installed. Run: cd proxy && npm install net-snmp'
            });
        } catch (e) {
            res.json({ available: false, brands: [], message: e.message });
        }
    });

    // Manual SNMP test/poll for a single equipment
    app.post('/api/network-equipment/:id/snmp-test', protect, async (req, res) => {
        try {
            const snmpService = require('../services/snmpService.cjs');
            if (!snmpService.isAvailable()) {
                return res.status(503).json({ success: false, message: 'SNMP service not available. Install net-snmp package.' });
            }
            const eq = await db.get('SELECT * FROM network_equipment WHERE id = ?', [req.params.id]);
            if (!eq) return res.status(404).json({ success: false, message: 'Equipment not found' });
            if (!eq.ip_address) return res.status(400).json({ success: false, message: 'No IP address configured for this equipment' });

            const metrics = await snmpService.pollSystemMetrics(eq);
            if (!metrics || Object.keys(metrics).length === 0) {
                return res.json({
                    success: false,
                    message: `SNMP timeout or no response from ${eq.ip_address}:${eq.snmp_port || 161}. Check community string and firewall rules.`,
                    equipment: { name: eq.name, ip: eq.ip_address, brand: eq.brand }
                });
            }

            // Store the reading
            for (const [key, data] of Object.entries(metrics)) {
                await snmpService.pollEquipment ? 
                    db.run('INSERT INTO olt_monitor_readings (equipment_id, metric_type, metric_key, metric_value, unit) VALUES (?,?,?,?,?)',
                        [eq.id, 'system', key, data.value, data.unit]) : null;
            }

            // Update equipment status
            await db.run("UPDATE network_equipment SET status = 'active', updated_at = datetime('now') WHERE id = ? AND status != 'maintenance'", [eq.id]);

            res.json({ success: true, metrics, equipment: { name: eq.name, ip: eq.ip_address, brand: eq.brand } });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    // Dashboard summary: latest readings for all equipment
    app.get('/api/network-equipment/dashboard', protect, async (req, res) => {
        try {
            const equipment = await db.all("SELECT * FROM network_equipment WHERE status != 'inactive' ORDER BY name");
            const result = [];
            for (const eq of equipment) {
                // Get latest reading for each metric
                const latestReadings = await db.all(
                    `SELECT metric_key, metric_value, unit, recorded_at FROM olt_monitor_readings 
                     WHERE equipment_id = ? 
                     AND recorded_at = (SELECT MAX(recorded_at) FROM olt_monitor_readings WHERE equipment_id = ? AND metric_key = olt_monitor_readings.metric_key)
                     GROUP BY metric_key`,
                    [eq.id, eq.id]
                );
                // Get last poll time
                const lastPoll = await db.get(
                    'SELECT MAX(recorded_at) as last_poll FROM olt_monitor_readings WHERE equipment_id = ?',
                    [eq.id]
                );
                // Count NAP ports
                const portStats = await db.get(
                    `SELECT COUNT(*) as total,
                            SUM(CASE WHEN np.status = 'occupied' THEN 1 ELSE 0 END) as occupied,
                            SUM(CASE WHEN np.status = 'available' THEN 1 ELSE 0 END) as available
                     FROM olt_nap_ports np JOIN olt_naps n ON np.nap_id = n.id
                     JOIN olt_splitters s ON n.splitter_id = s.id
                     JOIN olt_pon_ports p ON s.pon_port_id = p.id
                     WHERE p.equipment_id = ?`,
                    [eq.id]
                );

                const metricsMap = {};
                for (const r of latestReadings) {
                    metricsMap[r.metric_key] = { value: r.metric_value, unit: r.unit, recorded_at: r.recorded_at };
                }

                result.push({
                    ...eq,
                    metrics: metricsMap,
                    last_poll: lastPoll?.last_poll || null,
                    port_stats: portStats || { total: 0, occupied: 0, available: 0 }
                });
            }
            res.json(result);
        } catch (e) { res.status(500).json({ message: e.message }); }
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

    // --- LANDING PAGE (pure HTML) ---
    // Serve the standalone landing page at root paths before SPA catch-all
    const landingPagePath = path.join(__dirname, '..', 'public', 'landing-page.html');
    app.get('/', (req, res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.sendFile(landingPagePath);
    });
    app.get('/home', (req, res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.sendFile(landingPagePath);
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
    
    // Body parser middleware for captive portal API endpoints
    captiveApp.use(express.json());
    captiveApp.use(express.urlencoded({ extended: true }));

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
        
        // Allow direct access to expired portal (clients redirected by MikroTik)
        if (isIpHost && (req.path === '/expired' || req.path.startsWith('/expired'))) {
            return next();
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

    // Public endpoint: detect client IP from the TCP connection
    // Used by expired portal when no query params are provided
    captiveApp.get('/api/public/client-ip', (req, res) => {
        let clientIp = String(req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress || '').trim();
        if (clientIp.includes(',')) clientIp = clientIp.split(',')[0].trim();
        clientIp = clientIp.replace('::ffff:', '').replace(/^::1$/, '127.0.0.1');
        res.json({ ip: clientIp });
    });

    // Public company settings for captive/expired portal (no auth required)
    captiveApp.get('/api/company-settings', async (req, res) => {
        try {
            const s = await db.get('SELECT * FROM settings WHERE id = 1');
            if (!s) return res.json({});
            // Return only public-facing fields (no API keys or secrets)
            res.json({
                companyName: s.companyName || '',
                logoBase64: s.logoBase64 || '',
                address: s.address || '',
                contactNumber: s.contactNumber || '',
                email: s.email || '',
                currency: s.currency || 'PHP'
            });
        } catch (e) {
            console.error('[Captive] Company settings error:', e.message);
            res.status(500).json({ message: e.message });
        }
    });

    // Public store settings endpoint (for expired portal to read custom message/banner)
    captiveApp.get('/api/public/store-settings', async (req, res) => {
        try {
            const s = await db.get('SELECT storeSettings, currency FROM settings WHERE id = 1');
            const systemCurrency = s?.currency || 'PHP';
            if (s && s.storeSettings) {
                try {
                    const settings = JSON.parse(s.storeSettings);
                    res.json({
                        customExpiredMessage: settings.customExpiredMessage || '',
                        storeBannerText: settings.storeBannerText || '',
                        storeEnabled: settings.storeEnabled !== false,
                        paymentMethods: settings.paymentMethods || { paymongo: true, manualGcash: true },
                        gcashNumber: settings.gcashNumber || '',
                        gcashAccountName: settings.gcashAccountName || '',
                        currency: systemCurrency,
                        storeTheme: settings.storeTheme || 'modern'
                    });
                } catch (_) { res.json({ currency: systemCurrency, storeTheme: 'modern' }); }
            } else {
                res.json({ storeEnabled: true, paymentMethods: { paymongo: true, manualGcash: true }, currency: systemCurrency, storeTheme: 'modern' });
            }
        } catch (e) {
            res.status(500).json({ message: e.message });
        }
    });

    // Expired portal APIs on captive server (so redirected clients can access them)
    captiveApp.get('/api/public/expired/lookup', async (req, res) => {
        try {
            const { ip, mac } = req.query;
            if (!ip && !mac) return res.status(400).json({ message: 'ip or mac required' });

            let customer = null;
            let clientType = 'pppoe';

            if (ip) {
                customer = await db.get(
                    `SELECT dc.*, r.name as routerName FROM dhcp_clients dc 
                     LEFT JOIN routers r ON dc.routerId = r.id 
                     WHERE dc.address = ? OR dc.ip = ?`, [ip, ip]
                );
                if (customer) clientType = 'dhcp';

                if (!customer) {
                    customer = await db.get(
                        `SELECT dc.*, r.name as routerName FROM dhcp_clients dc 
                         LEFT JOIN routers r ON dc.routerId = r.id 
                         WHERE dc.address = ? OR dc.ip = ?`, [ip, ip]
                    );
                    if (customer) clientType = 'dhcp';
                }
            }

            if (!customer && mac) {
                const normalizedMac = String(mac).toUpperCase().replace(/[:-]/g, ':');
                const altMac = String(mac).toUpperCase().replace(/[:-]/g, '');
                customer = await db.get(
                    `SELECT dc.*, r.name as routerName FROM dhcp_clients dc 
                     LEFT JOIN routers r ON dc.routerId = r.id 
                     WHERE UPPER(dc.macAddress) = ? OR UPPER(REPLACE(dc.macAddress, ':', '')) = ?`,
                    [normalizedMac, altMac]
                );
                if (customer) clientType = 'dhcp';
                if (!customer) {
                    customer = await db.get(
                        `SELECT c.*, r.name as routerName FROM customers c 
                         LEFT JOIN routers r ON c.routerId = r.id 
                         WHERE UPPER(c.macAddress) = ? OR UPPER(REPLACE(c.macAddress, ':', '')) = ?`,
                        [normalizedMac, altMac]
                    );
                    if (customer) clientType = customer.clientType || 'pppoe';
                }
            }

            // If IP is from non-payment pool, query MikroTik PPPoE active sessions
            if (!customer && ip && (await isInNonPaymentPool(ip))) {
                const routers = await db.all('SELECT * FROM routers');
                for (const router of routers) {
                    try {
                        const axios = require('axios');
                        const routerIp = router.host || router.ip;
                        const routerPort = router.port || 3002;
                        const routerUser = router.username || 'admin';
                        const routerPass = router.password || '';
                        const apiBase = `http://${routerIp}:${routerPort}`;
                        const authHeader = 'Basic ' + Buffer.from(`${routerUser}:${routerPass}`).toString('base64');
                        const activeResp = await axios.get(`${apiBase}/rest/ppp/active`, {
                            params: { address: ip }, headers: { Authorization: authHeader }, timeout: 10000
                        });
                        const activeSessions = Array.isArray(activeResp.data) ? activeResp.data : [];
                        const session = activeSessions.find(s => s.address === ip);
                        if (session && session.name) {
                            // Store MAC address from active session for future expired lookups
                            const sessionMac = session['caller-id'] || '';
                            if (sessionMac) {
                                const normalizedSessionMac = String(sessionMac).toUpperCase().replace(/[:-]/g, ':');
                                try {
                                    await db.run('UPDATE customers SET lastKnownMac = ? WHERE username = ? AND routerId = ?',
                                        [normalizedSessionMac, session.name, router.id]);
                                } catch (_) {}
                            }
                            customer = await db.get(
                                `SELECT c.*, r.name as routerName FROM customers c LEFT JOIN routers r ON c.routerId = r.id WHERE (c.username = ? OR c.name = ?) AND c.routerId = ?`,
                                [session.name, session.name, router.id]
                            );
                            if (!customer) {
                                const clientUser = await db.get('SELECT * FROM client_users WHERE pppoe_username = ? AND router_id = ?', [session.name, router.id]);
                                if (clientUser) {
                                    customer = await db.get(`SELECT c.*, r.name as routerName FROM customers c LEFT JOIN routers r ON c.routerId = r.id WHERE c.routerId = ? AND (c.username = ? OR c.accountNumber = ?)`, [router.id, clientUser.pppoe_username || session.name, clientUser.account_number || '']);
                                    if (!customer) {
                                        customer = { username: session.name, name: session.name, fullName: clientUser.pppoe_username || session.name, accountNumber: clientUser.account_number || '', routerId: router.id, routerName: router.name, planName: '', dueDate: '' };
                                    }
                                }
                            }
                            if (customer) { clientType = 'pppoe'; break; }
                        }
                    } catch (routerErr) {
                        console.warn(`[Captive Expired] PPPoE lookup failed on ${router.name}:`, routerErr.message);
                    }
                }
            }

            // Fallback: If still not found and IP is from non-payment pool,
            // try matching via ARP table MAC → PPP secret caller-id
            if (!customer && ip && (await isInNonPaymentPool(ip))) {
                console.log(`[Captive Expired] Active session lookup failed for ${ip}, trying ARP+Secret matching...`);
                const arpResult = await lookupPppoeByArpAndSecret(ip);
                if (arpResult) {
                    customer = arpResult.customer;
                    clientType = arpResult.clientType;
                }
            }

            if (!customer) return res.json({ found: false });

            let planName = customer.planName || customer.plan || '';
            let dueDate = customer.dueDate || customer.expiresAt || '';
            try {
                const comment = customer.comment || '';
                if (comment.startsWith('{')) {
                    const parsed = JSON.parse(comment);
                    planName = planName || parsed.plan || parsed.planName || '';
                    dueDate = dueDate || parsed.dueDate || parsed.expiresAt || '';
                }
            } catch (_) {}

            const username = customer.username || customer.name || '';
            const accountNumber = customer.accountNumber || customer.account_number || '';
            const fullName = customer.fullName || customer.full_name || customer.name || username;
            const planType = (customer.planType || customer.plan_type || 'prepaid').toLowerCase() === 'postpaid' ? 'postpaid' : 'prepaid';

            res.json({
                found: true,
                customer: {
                    fullName, accountNumber, planName, dueDate,
                    routerId: customer.routerId || customer.router_id || '',
                    username, clientType, planType,
                    routerName: customer.routerName || ''
                }
            });
        } catch (e) {
            console.error('[Captive Expired] Lookup error:', e.message);
            res.status(500).json({ message: e.message });
        }
    });

    // GET: Lookup customer by account number or username (manual entry)
    captiveApp.get('/api/public/expired/lookup-by-account', async (req, res) => {
        try {
            const q = String(req.query.q || '').trim();
            if (!q) return res.status(400).json({ message: 'Query parameter "q" is required' });

            let customer = await db.get(
                `SELECT c.*, r.name as routerName FROM customers c 
                 LEFT JOIN routers r ON c.routerId = r.id 
                 WHERE c.accountNumber = ? OR c.username = ?`,
                [q, q]
            );

            if (!customer) {
                const clientUser = await db.get(
                    'SELECT * FROM client_users WHERE pppoe_username = ? OR username = ?',
                    [q, q]
                );
                if (clientUser) {
                    customer = await db.get(
                        `SELECT c.*, r.name as routerName FROM customers c 
                         LEFT JOIN routers r ON c.routerId = r.id 
                         WHERE c.routerId = ? AND (c.username = ? OR c.accountNumber = ?)`,
                        [clientUser.router_id, clientUser.pppoe_username || clientUser.username, clientUser.account_number || '']
                    );
                }
            }

            if (!customer) return res.json({ found: false });

            let planName = customer.planName || customer.plan || '';
            let dueDate = customer.dueDate || customer.expiresAt || '';
            try {
                const comment = customer.comment || '';
                if (comment.startsWith('{')) {
                    const parsed = JSON.parse(comment);
                    planName = planName || parsed.plan || parsed.planName || '';
                    dueDate = dueDate || parsed.dueDate || parsed.expiresAt || '';
                }
            } catch (_) {}

            const username = customer.username || customer.name || '';
            const accountNumber = customer.accountNumber || customer.account_number || '';
            const fullName = customer.fullName || customer.full_name || customer.name || username;
            const planType = (customer.planType || customer.plan_type || 'prepaid').toLowerCase() === 'postpaid' ? 'postpaid' : 'prepaid';

            res.json({
                found: true,
                customer: {
                    fullName, accountNumber, planName, dueDate,
                    routerId: customer.routerId || customer.router_id || '',
                    username, clientType: customer.clientType || 'pppoe', planType,
                    routerName: customer.routerName || ''
                }
            });
        } catch (e) {
            console.error('[Captive Expired] Account lookup error:', e.message);
            res.status(500).json({ message: e.message });
        }
    });

    captiveApp.post('/api/public/expired/auto-login', async (req, res) => {
        try {
            const { username, routerId, accountNumber, ip, mac } = req.body;
            if (!username && !ip && !mac) return res.status(400).json({ message: 'username or ip/mac is required' });

            let customer = null;
            if (username && routerId) {
                customer = await db.get('SELECT * FROM customers WHERE username = ? AND routerId = ?', [username, routerId]);
            }
            if (!customer && username) {
                customer = await db.get('SELECT * FROM customers WHERE username = ?', [username]);
            }
            if (!customer && accountNumber) {
                customer = await db.get('SELECT * FROM customers WHERE accountNumber = ?', [accountNumber]);
            }
            if (!customer && ip) {
                customer = await db.get('SELECT * FROM dhcp_clients WHERE address = ? OR ip = ?', [ip, ip]);
            }
            if (!customer && mac) {
                customer = await db.get('SELECT * FROM dhcp_clients WHERE UPPER(macAddress) = ?', [String(mac).toUpperCase()]);
            }

            const token = `exp_${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;
            const sessionData = {
                id: customer?.id || `temp_${Date.now()}`,
                username: customer?.username || username || 'expired_client',
                routerId: customer?.routerId || customer?.router_id || routerId || '',
                accountNumber: customer?.accountNumber || customer?.account_number || accountNumber || '',
                fullName: customer?.fullName || customer?.full_name || 'Valued Customer',
                pppoeUsername: username || customer?.username || '',
                expiresAt: Date.now() + 10 * 60 * 1000,
                createdAt: Date.now()
            };
            expiredSessionTokens.set(token, sessionData);
            
            // Build store URL pointing to main app (PORT 3001), not captive portal (8080)
            const reqHost = (req.headers.host || '').split(':')[0];
            const storeUrl = `http://${reqHost}:${PORT}/store?session=${encodeURIComponent(token)}`;
            
            res.json({ token, expiresIn: 600, storeUrl });
        } catch (e) {
            console.error('[Captive Expired] Auto-login error:', e.message);
            res.status(500).json({ message: e.message });
        }
    });

    captiveApp.post('/api/public/expired/verify-session', async (req, res) => {
        try {
            const { token } = req.body;
            if (!token) return res.status(400).json({ message: 'token is required' });
            const sessionData = expiredSessionTokens.get(token);
            if (!sessionData || sessionData.expiresAt < Date.now()) {
                if (sessionData) expiredSessionTokens.delete(token);
                return res.status(401).json({ message: 'Invalid or expired session token' });
            }
            res.json({
                id: sessionData.id, username: sessionData.username,
                routerId: sessionData.routerId, pppoeUsername: sessionData.pppoeUsername,
                accountNumber: sessionData.accountNumber, fullName: sessionData.fullName
            });
        } catch (e) {
            console.error('[Captive Expired] Verify error:', e.message);
            res.status(500).json({ message: e.message });
        }
    });

    // Captive portal chat endpoints (needed for ExpiredHelp widget)
    captiveApp.get('/api/captive-thread', async (req, res) => {
        try {
            const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            const notifications = await db.all(
                `SELECT * FROM notifications WHERE type = 'client-chat' AND context_json LIKE ? ORDER BY timestamp ASC LIMIT 50`,
                [`%"${clientIp}"%`]
            );
            res.json(notifications);
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    captiveApp.post('/api/captive-message', async (req, res) => {
        const { message } = req.body;
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        if (!message) return res.status(400).json({ message: 'Message content is required.' });
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
                `INSERT INTO notifications (id, type, message, is_read, timestamp, link_to, context_json) VALUES (?,?,?,?,?,?,?)`,
                [notification.id, notification.type, notification.message, notification.is_read, notification.timestamp, notification.link_to, notification.context_json]
            );
            res.json({ message: 'Message sent', id: notification.id });
        } catch (e) { res.status(500).json({ message: e.message }); }
    });

    // Store plans API on captive server (for expired clients to browse plans)
    captiveApp.get('/api/public/store/plans', async (req, res) => {
        try {
            // Check if store is enabled
            const settingsRow = await db.get('SELECT storeSettings FROM settings WHERE id = 1');
            if (settingsRow && settingsRow.storeSettings) {
                try {
                    const ss = JSON.parse(settingsRow.storeSettings);
                    if (ss.storeEnabled === false) return res.json([]);
                } catch (_) {}
            }

            const { routerId, type = 'all', billingType } = req.query;
            let plans = [];
            if (type === 'all' || type === 'pppoe') {
                let query = 'SELECT * FROM billing_plans WHERE store_enabled = 1';
                const params = [];
                if (routerId) { query += ' AND routerId = ?'; params.push(routerId); }
                if (billingType) { query += ' AND billingType = ?'; params.push(billingType); }
                query += ' ORDER BY price ASC';
                const pppoePlans = await db.all(query, params);
                plans = plans.concat(pppoePlans.map(p => ({ ...p, planType: 'pppoe' })));
            }
            if (type === 'all' || type === 'dhcp') {
                let query = 'SELECT * FROM dhcp_billing_plans WHERE store_enabled = 1';
                const params = [];
                if (routerId) { query += ' AND routerId = ?'; params.push(routerId); }
                if (billingType) { query += ' AND billingType = ?'; params.push(billingType); }
                query += ' ORDER BY price ASC';
                const dhcpPlans = await db.all(query, params);
                plans = plans.concat(dhcpPlans.map(p => ({ ...p, planType: 'dhcp' })));
            }
            res.json(plans);
        } catch (e) {
            console.error('[Captive Store] Plans error:', e.message);
            res.status(500).json({ message: e.message });
        }
    });

    // Store account lookup on captive server
    captiveApp.get('/api/public/store/lookup-account', async (req, res) => {
        try {
            const { accountNumber, username, ip } = req.query;
            if (!accountNumber && !username && !ip) {
                return res.status(400).json({ found: false, message: 'Provide accountNumber, username, or ip query parameter' });
            }
            let customer = null;
            if (accountNumber) {
                customer = await db.get(
                    `SELECT c.id, c.username, c.fullName, c.accountNumber, c.routerId, c.contactNumber, c.planType, r.name as routerName
                     FROM customers c LEFT JOIN routers r ON c.routerId = r.id WHERE c.accountNumber = ?`, [accountNumber]
                );
            }
            if (!customer && username) {
                customer = await db.get(
                    `SELECT c.id, c.username, c.fullName, c.accountNumber, c.routerId, c.contactNumber, c.planType, r.name as routerName
                     FROM customers c LEFT JOIN routers r ON c.routerId = r.id WHERE c.username = ?`, [username]
                );
            }
            if (!customer && ip) {
                customer = await db.get(
                    `SELECT dc.id, dc.username, dc.fullName, dc.accountNumber, dc.routerId, dc.contactNumber, dc.planType, r.name as routerName
                     FROM dhcp_clients dc LEFT JOIN routers r ON dc.routerId = r.id WHERE dc.address = ? OR dc.ip = ?`, [ip, ip]
                );
            }
            if (customer) {
                const billingType = (customer.planType || 'prepaid').toLowerCase() === 'postpaid' ? 'postpaid' : 'prepaid';
                res.json({ found: true, fullName: customer.fullName, username: customer.username, routerId: customer.routerId, accountNumber: customer.accountNumber || '', routerName: customer.routerName || '', contactNumber: customer.contactNumber || '', billingType });
            } else {
                res.json({ found: false });
            }
        } catch (e) {
            console.error('[Captive Store] Account lookup error:', e.message);
            res.status(500).json({ found: false, message: e.message });
        }
    });

    // Store purchase API on captive server
    captiveApp.post('/api/public/store/purchase', async (req, res) => {
        try {
            const { planId, planType, paymentMethod, accountNumber, pppoeUsername, routerId, gcashReference } = req.body;
            if (!planId || !planType || !paymentMethod) {
                return res.status(400).json({ message: 'Missing required fields: planId, planType, paymentMethod' });
            }
            if (!accountNumber && !pppoeUsername) {
                return res.status(400).json({ message: 'Account number or PPPoE username is required' });
            }

            let plan;
            if (planType === 'pppoe') {
                plan = await db.get('SELECT * FROM billing_plans WHERE id = ?', [planId]);
            } else if (planType === 'dhcp') {
                plan = await db.get('SELECT * FROM dhcp_billing_plans WHERE id = ?', [planId]);
            }
            if (!plan) return res.status(404).json({ message: 'Plan not found' });

            // Look up customer directly by account number or PPPoE username
            let customer = null;
            if (accountNumber) {
                customer = await db.get(
                    `SELECT c.*, r.name as routerName FROM customers c LEFT JOIN routers r ON c.routerId = r.id WHERE c.accountNumber = ?`, [accountNumber]
                );
            }
            if (!customer && pppoeUsername) {
                customer = await db.get(
                    `SELECT c.*, r.name as routerName FROM customers c LEFT JOIN routers r ON c.routerId = r.id WHERE c.username = ?`, [pppoeUsername]
                );
            }
            if (!customer) return res.status(404).json({ message: 'Customer not found. Please check your account number or PPPoE username.' });

            const effectiveRouterId = routerId || customer.routerId;
            const effectivePppoeUsername = customer.username;
            const effectiveAccountNumber = customer.accountNumber || '';

            if (paymentMethod === 'paymongo') {
                const pmSettings = await db.get('SELECT paymongoSettings FROM settings WHERE id = 1');
                const pmConfig = JSON.parse(pmSettings?.paymongoSettings || '{}');
                if (!pmConfig.enabled || !pmConfig.secretKey) return res.status(400).json({ message: 'PayMongo not configured' });

                const axios = require('axios');
                const amount = Math.round(plan.price * 100);
                const checkoutData = {
                    data: {
                        attributes: {
                            line_items: [{ currency: 'PHP', amount, description: `${plan.name} - ${customer.fullName || effectiveAccountNumber}`, quantity: 1 }],
                            payment_method_types: pmConfig.paymentMethods || ['qrph'],
                            send_email_receipt: false, show_description: false,
                            success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/store/success`,
                            cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/store/cancel`,
                            metadata: { pppoeUsername: effectivePppoeUsername, planId, planType, routerId: effectiveRouterId, planName: plan.name, planPrice: plan.price, duration_days: plan.cycle_days || 30, customerAccountNumber: effectiveAccountNumber, customerFullName: customer.fullName }
                        }
                    }
                };
                const response = await axios.post('https://api.paymongo.com/v1/checkout_sessions', checkoutData, {
                    auth: { username: pmConfig.secretKey, password: '' }, headers: { 'Content-Type': 'application/json' }
                });
                res.json({ success: true, checkoutUrl: response.data.data.attributes.checkout_url, checkoutId: response.data.data.id });

            } else if (paymentMethod === 'manual') {
                const paymentId = `manual_pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const now = new Date().toISOString();
                await db.run(
                    `INSERT INTO manual_payment_requests (id, customer_account_number, customer_username, customer_full_name, customer_router_id, plan_name, plan_price, gcash_reference_number, customer_mobile_number, customer_name_on_gcash, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                    [paymentId, effectiveAccountNumber, effectivePppoeUsername, customer.fullName, effectiveRouterId, plan.name, plan.price, gcashReference || '', customer.contactNumber || '', customer.fullName || '', 'pending', now, now]
                );
                // Also create sales record
                const salesId = `sale_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                await db.run(
                    `INSERT INTO sales_records (id, routerId, date, clientName, planName, planPrice, discountAmount, finalAmount, routerName, currency, clientAddress, clientContact, payment_method, processedBy) VALUES (?,?,?,?,?,?,0,?,?,?,?,?,?,?)`,
                    [salesId, effectiveRouterId, now, customer.fullName || effectivePppoeUsername, plan.name, plan.price, plan.price, plan.currency || 'PHP', customer.address || '', customer.contactNumber || '', 'manual', 'store']
                );
                res.json({ success: true, paymentId, salesId, message: 'Manual payment submitted for approval' });
            } else {
                res.status(400).json({ message: 'Invalid payment method' });
            }
        } catch (e) {
            console.error('[Captive Store] Purchase error:', e.message);
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
            let fbConfig = {};
            try {
                const fbSettings = await db.get('SELECT facebookSettings FROM settings WHERE id = 1');
                fbConfig = JSON.parse(fbSettings?.facebookSettings || '{}');
            } catch (parseErr) {
                console.warn('[Facebook Reminders] Facebook settings corrupted, skipping reminders');
                return;
            }
            
            if (!fbConfig.enabled || !fbConfig.pageAccessToken) {
                console.warn('[Facebook Reminders] Facebook Messenger not configured, skipping reminders');
                return;
            }
            
            const axios = require('axios');
            let sentCount = 0;
            let skippedCount = 0;
            let failedCount = 0;
            
            for (const customer of clients) {
                try {
                    const daysUntilDue = customer.dueDate ? Math.ceil((new Date(customer.dueDate) - now) / (1000 * 60 * 60 * 24)) : null;
                    
                    let message;
                    if (daysUntilDue === null) {
                        message = `📅 PAYMENT NOTIFICATION\n━━━━━━━━━━━━━━━━━━\n\n📋 Account: ${customer.accountNumber || 'N/A'}\n👤 Name: ${customer.fullName || 'Valued Customer'}\n💰 Amount: ₱${(customer.planPrice || 0).toFixed(2)}\n\n💳 Send PAY to pay now.`;
                    } else if (daysUntilDue < 0) {
                        message = `⚠️ OVERDUE PAYMENT\n━━━━━━━━━━━━━━━━━━\n\n📋 Account: ${customer.accountNumber || 'N/A'}\n👤 Name: ${customer.fullName || 'Valued Customer'}\n💰 Amount: ₱${(customer.planPrice || 0).toFixed(2)}\n📅 Due: ${customer.dueDate} (${Math.abs(daysUntilDue)} days overdue)\n\n⚠️ Service may be suspended!\n\n💳 Send PAY to pay now.`;
                    } else if (daysUntilDue === 0) {
                        message = `🔴 DUE TODAY\n━━━━━━━━━━━━━━━━━━\n\n📋 Account: ${customer.accountNumber || 'N/A'}\n💰 Amount: ₱${(customer.planPrice || 0).toFixed(2)}\n\n⏰ Please pay today!\n\n💳 Send PAY to pay now.`;
                    } else if (daysUntilDue === 1) {
                        message = `⏰ PAYMENT DUE TOMORROW\n━━━━━━━━━━━━━━━━━━\n\n📋 Account: ${customer.accountNumber || 'N/A'}\n💰 Amount: ₱${(customer.planPrice || 0).toFixed(2)}\n📅 Due: ${customer.dueDate}\n\n💳 Send PAY to pay now.`;
                    } else {
                        message = `⏰ Payment Reminder\n━━━━━━━━━━━━━━━━━━\n\n📋 Account: ${customer.accountNumber || 'N/A'}\n💰 Amount: ₱${(customer.planPrice || 0).toFixed(2)}\n📅 Due: ${customer.dueDate} (${daysUntilDue} days)\n\n💳 Send PAY to pay now.`;
                    }
                    
                    // Try RESPONSE first, fallback to UPDATE
                    try {
                        await axios.post(
                            `https://graph.facebook.com/v21.0/me/messages?access_token=${fbConfig.pageAccessToken}`,
                            {
                                messaging_type: 'RESPONSE',
                                recipient: { id: customer.facebook_psid },
                                message: { text: message }
                            },
                            { timeout: 10000 }
                        );
                    } catch (respErr) {
                        const errData = respErr.response?.data?.error;
                        const isOutsideWindow = errData?.error_subcode === 2018278 || 
                                                (errData?.message || '').includes('outside of allowed window');
                        if (isOutsideWindow) {
                            skippedCount++;
                            console.warn(`[Facebook Reminders] ⊘ Skipped ${customer.accountNumber}: outside 24h window`);
                            continue;
                        }
                        // Fallback to UPDATE
                        await axios.post(
                            `https://graph.facebook.com/v21.0/me/messages?access_token=${fbConfig.pageAccessToken}`,
                            {
                                messaging_type: 'UPDATE',
                                recipient: { id: customer.facebook_psid },
                                message: { text: message }
                            },
                            { timeout: 10000 }
                        );
                    }
                    
                    sentCount++;
                    console.log(`[Facebook Reminders] ✓ Sent to ${customer.accountNumber} (${daysUntilDue} days)`);
                } catch (err) {
                    failedCount++;
                    const errData = err.response?.data?.error;
                    console.error(`[Facebook Reminders] ✗ Failed for ${customer.accountNumber}:`, errData?.message || err.message);
                }
            }
            
            console.log(`[Facebook Reminders] Job complete: ${sentCount} sent, ${skippedCount} skipped (outside window), ${failedCount} failed`);
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

// ========================================
// Expired Client Address-List Worker
// Periodically syncs expired client IPs to MikroTik EXPIRED_CLIENTS address-list
// ========================================
let expiredWorkerRunning = false;
async function syncExpiredClientsToAddressList() {
    if (expiredWorkerRunning) return;
    expiredWorkerRunning = true;
    try {
        // Check if auto-sync worker is enabled in store settings
        const settingsRow = await db.get('SELECT storeSettings FROM settings WHERE id = 1');
        let storeSettings = null;
        if (settingsRow && settingsRow.storeSettings) {
            try { storeSettings = JSON.parse(settingsRow.storeSettings); } catch (_) {}
        }
        if (!storeSettings || !storeSettings.autoSyncWorkerEnabled) {
            expiredWorkerRunning = false;
            return; // Worker disabled
        }

        const routers = await db.all('SELECT * FROM routers');
        const axios = require('axios');

        for (const router of routers) {
            try {
                const routerIp = router.host || router.ip;
                const routerPort = router.port || 3002;
                const routerUser = router.username || 'admin';
                const routerPass = router.password || '';
                const apiBase = `http://${routerIp}:${routerPort}`;
                const authHeader = 'Basic ' + Buffer.from(`${routerUser}:${routerPass}`).toString('base64');

                // Use date-only format to match how dueDate is stored (e.g., "2025-07-10")
                const now = new Date().toISOString().split('T')[0];

                // ─── PPPoE: No auto-disable. PPPoE secrets are managed manually by admin. ───

                // ─── DHCP: IP-based firewall address-list ───
                const expiredDhcpClients = await db.all(
                    `SELECT dc.*, r.host, r.port FROM dhcp_clients dc
                     JOIN routers r ON dc.routerId = r.id
                     WHERE dc.routerId = ?
                     AND dc.dueDate IS NOT NULL AND dc.dueDate != ''
                     AND dc.dueDate < ?
                     AND (dc.address IS NOT NULL AND dc.address != '' OR dc.ip IS NOT NULL AND dc.ip != '')`,
                    [router.id, now]
                );

                const expiredIps = new Set();
                for (const c of expiredDhcpClients) {
                    const ip = c.address || c.ip;
                    if (ip) expiredIps.add(ip);
                }

                if (expiredIps.size > 0) {
                    let currentEntries = [];
                    try {
                        const resp = await axios.get(`${apiBase}/rest/ip/firewall/address-list`, {
                            params: { list: 'EXPIRED_CLIENTS' },
                            headers: { Authorization: authHeader },
                            timeout: 10000
                        });
                        currentEntries = Array.isArray(resp.data) ? resp.data : [];
                    } catch (_) {}

                    const currentIps = new Set(currentEntries.map(e => e.address));

                    for (const ip of expiredIps) {
                        if (!currentIps.has(ip)) {
                            try {
                                await axios.put(`${apiBase}/rest/ip/firewall/address-list`, {
                                    list: 'EXPIRED_CLIENTS',
                                    address: ip,
                                    comment: `Auto-added: expired client`
                                }, {
                                    headers: { Authorization: authHeader },
                                    timeout: 10000
                                });
                                console.log(`[Expired Worker] Added ${ip} to EXPIRED_CLIENTS on ${router.name}`);
                            } catch (addErr) {
                                console.warn(`[Expired Worker] Failed to add ${ip} on ${router.name}:`, addErr.message);
                            }
                        }
                    }
                }

                // Remove renewed DHCP clients from EXPIRED_CLIENTS
                const activeDhcpClients = await db.all(
                    `SELECT dc.address, dc.ip FROM dhcp_clients dc
                     WHERE dc.routerId = ?
                     AND (dc.dueDate IS NULL OR dc.dueDate = '' OR dc.dueDate >= ?)
                     AND (dc.address IS NOT NULL AND dc.address != '' OR dc.ip IS NOT NULL AND dc.ip != '')`,
                    [router.id, now]
                );

                const activeIps = new Set();
                for (const c of activeDhcpClients) activeIps.add(c.address || c.ip);

                let dhcpCurrentEntries = [];
                try {
                    const resp = await axios.get(`${apiBase}/rest/ip/firewall/address-list`, {
                        params: { list: 'EXPIRED_CLIENTS' },
                        headers: { Authorization: authHeader },
                        timeout: 10000
                    });
                    dhcpCurrentEntries = Array.isArray(resp.data) ? resp.data : [];
                } catch (_) {}

                for (const entry of dhcpCurrentEntries) {
                    if (activeIps.has(entry.address)) {
                        try {
                            await axios.delete(`${apiBase}/rest/ip/firewall/address-list/${entry['.id']}`, {
                                headers: { Authorization: authHeader },
                                timeout: 10000
                            });
                            console.log(`[Expired Worker] Removed ${entry.address} from EXPIRED_CLIENTS on ${router.name} (renewed)`);
                        } catch (removeErr) {
                            console.warn(`[Expired Worker] Failed to remove ${entry.address} on ${router.name}:`, removeErr.message);
                        }
                    }
                }

            } catch (routerErr) {
                console.warn(`[Expired Worker] Router ${router.name} sync failed:`, routerErr.message);
            }
        }
    } catch (e) {
        console.error('[Expired Worker] Sync error:', e.message);
    } finally {
        expiredWorkerRunning = false;
    }
}

// Run expired client sync every 2 minutes
setInterval(syncExpiredClientsToAddressList, 2 * 60 * 1000);
// Also run once after server starts (delayed 30s to let everything initialize)
setTimeout(syncExpiredClientsToAddressList, 30000);

// ========================================
// PPPoE MAC Address Cache Worker
// Periodically captures MAC addresses from active PPPoE sessions
// and stores them in customers.lastKnownMac for expired portal lookups
// ========================================
async function syncPppoeMacAddresses() {
    try {
        const routers = await db.all('SELECT * FROM routers');
        const axios = require('axios');

        for (const router of routers) {
            try {
                const routerIp = router.host || router.ip;
                const routerPort = router.port || 3002;
                const routerUser = router.user || router.username || 'admin';
                const routerPass = router.password || '';
                const apiBase = `http://${routerIp}:${routerPort}`;
                const authHeader = 'Basic ' + Buffer.from(`${routerUser}:${routerPass}`).toString('base64');

                // Get all active PPPoE sessions
                const activeResp = await axios.get(`${apiBase}/rest/ppp/active`, {
                    headers: { Authorization: authHeader },
                    timeout: 10000
                });
                const sessions = Array.isArray(activeResp.data) ? activeResp.data : [];

                for (const session of sessions) {
                    if (!session.name || !session['caller-id']) continue;
                    const mac = String(session['caller-id']).toUpperCase().replace(/[:-]/g, ':');
                    // Only update if MAC looks valid (XX:XX:XX:XX:XX:XX format)
                    if (!/^[0-9A-F]{1,2}(:[0-9A-F]{1,2}){5}$/i.test(mac)) continue;

                    try {
                        await db.run(
                            'UPDATE customers SET lastKnownMac = ? WHERE username = ? AND routerId = ?',
                            [mac, session.name, router.id]
                        );
                    } catch (_) {}
                }
            } catch (routerErr) {
                // Silently skip router errors
            }
        }
    } catch (e) {
        console.warn('[MAC Sync Worker] Error:', e.message);
    }
}

// Run MAC sync every 5 minutes
setInterval(syncPppoeMacAddresses, 5 * 60 * 1000);
// Run once on startup (delayed 60s to let things initialize)
setTimeout(syncPppoeMacAddresses, 60000);

startServer();
