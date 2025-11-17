import sqlite3 from '@vscode/sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Connect to the database
const dbPath = path.join(__dirname, 'mikrotik_billing.db');
console.log('Using database:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        return;
    }
    console.log('Connected to SQLite database');
});

// Promisify database operations
const dbGet = (sql) => new Promise((resolve, reject) => {
    db.get(sql, (err, row) => {
        if (err) reject(err);
        else resolve(row);
    });
});

const dbAll = (sql) => new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
    });
});

const dbExec = (sql) => new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
    });
});

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this);
    });
});

async function runMigrations() {
    try {
        // Check current version
        let { user_version } = await dbGet('PRAGMA user_version;');
        console.log(`Current database version: ${user_version}`);

        if (user_version < 1) {
            console.log('Applying migration v1...');
            await dbExec(`
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
            await dbExec('PRAGMA user_version = 1;');
            user_version = 1;
            console.log('Migration v1 applied successfully');
        }

        if (user_version < 6) {
            console.log('Applying migration v6 (Add expenses table)...');
            await dbExec(`
                CREATE TABLE IF NOT EXISTS expenses (
                    id TEXT PRIMARY KEY,
                    date TEXT NOT NULL,
                    category TEXT NOT NULL,
                    description TEXT,
                    amount REAL NOT NULL
                );
            `);
            await dbExec('PRAGMA user_version = 6;');
            user_version = 6;
            console.log('Migration v6 applied successfully');
        }

        if (user_version < 9) {
            console.log('Applying migration v9 (Add users table for auth)...');
            await dbExec(`
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL
                );
            `);
            await dbExec('PRAGMA user_version = 9;');
            user_version = 9;
            console.log('Migration v9 applied successfully');
        }

        console.log(`Database updated to version: ${user_version}`);
        console.log('Migrations completed successfully!');

        // Verify tables exist
        const tables = await dbAll("SELECT name FROM sqlite_master WHERE type='table'");
        console.log('\n=== TABLES AFTER MIGRATIONS ===');
        tables.forEach(table => {
            console.log(`- ${table.name}`);
        });

        // Test the problematic queries
        console.log('\n=== TESTING QUERIES ===');
        try {
            const userCount = await dbGet("SELECT COUNT(*) as count FROM users");
            console.log('Users table query successful:', userCount);
        } catch (error) {
            console.log('Users table query failed:', error.message);
        }

        try {
            const expenses = await dbAll("SELECT * FROM expenses");
            console.log('Expenses table query successful, found', expenses.length, 'rows');
        } catch (error) {
            console.log('Expenses table query failed:', error.message);
        }

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        db.close();
    }
}

runMigrations();