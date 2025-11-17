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

async function checkMigrations() {
    try {
        // Check user_version
        const userVersion = await new Promise((resolve, reject) => {
            db.get("PRAGMA user_version", (err, row) => {
                if (err) reject(err);
                else resolve(row.user_version);
            });
        });
        
        console.log(`Database user_version: ${userVersion}`);
        
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
        
        // Check if we're missing critical tables
        const tableNames = tables.map(t => t.name);
        const missingTables = [];
        
        if (!tableNames.includes('users')) missingTables.push('users');
        if (!tableNames.includes('expenses')) missingTables.push('expenses');
        
        console.log('\n=== ANALYSIS ===');
        if (missingTables.length > 0) {
            console.log(`Missing tables: ${missingTables.join(', ')}`);
            console.log('This explains the 500 errors - the migrations haven\'t been applied properly!');
        } else {
            console.log('All required tables exist');
        }
        
    } catch (error) {
        console.error('Database check error:', error);
    } finally {
        db.close();
    }
}

checkMigrations();