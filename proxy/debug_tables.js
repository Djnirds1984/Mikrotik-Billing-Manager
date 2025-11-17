import sqlite3 from '@vscode/sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Connect to the database
const dbPath = path.join(__dirname, 'mikrotik_billing.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        return;
    }
    console.log('Connected to SQLite database');
});

async function debugDatabase() {
    try {
        // Get all tables
        const tables = await new Promise((resolve, reject) => {
            db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        console.log('\n=== ALL TABLES ===');
        tables.forEach(table => {
            console.log(`- ${table.name}`);
        });

        // Check specific tables
        const checkTables = ['users', 'expenses', 'auth'];
        
        for (const tableName of checkTables) {
            console.log(`\n=== CHECKING TABLE: ${tableName} ===`);
            
            try {
                // Check if table exists
                const tableInfo = await new Promise((resolve, reject) => {
                    db.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    });
                });
                
                if (tableInfo.length > 0) {
                    console.log(`Table ${tableName} EXISTS with columns:`);
                    tableInfo.forEach(col => {
                        console.log(`  - ${col.name} (${col.type})`);
                    });
                    
                    // Try to count rows
                    const count = await new Promise((resolve, reject) => {
                        db.get(`SELECT COUNT(*) as count FROM ${tableName}`, (err, row) => {
                            if (err) reject(err);
                            else resolve(row.count);
                        });
                    });
                    console.log(`Row count: ${count}`);
                } else {
                    console.log(`Table ${tableName} does NOT exist`);
                }
                
            } catch (error) {
                console.log(`Error checking ${tableName}:`, error.message);
            }
        }
        
        // Test the exact queries from the API endpoints
        console.log('\n=== TESTING API QUERIES ===');
        
        // Test auth/has-users query
        try {
            const userCount = await new Promise((resolve, reject) => {
                db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            console.log('Auth has-users query SUCCESS:', userCount);
        } catch (error) {
            console.log('Auth has-users query ERROR:', error.message);
        }
        
        // Test expenses query
        try {
            const expenses = await new Promise((resolve, reject) => {
                db.all("SELECT * FROM expenses", (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
            console.log('Expenses query SUCCESS, found', expenses.length, 'rows');
        } catch (error) {
            console.log('Expenses query ERROR:', error.message);
        }
        
    } catch (error) {
        console.error('Database debug error:', error);
    } finally {
        db.close();
    }
}

debugDatabase();