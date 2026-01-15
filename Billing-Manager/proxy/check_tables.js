import sqlite3 from '@vscode/sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkDatabaseTables() {
    const DB_PATH = path.join(__dirname, 'panel.db');
    
    try {
        const db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });

        console.log('🔍 Checking database schema...');
        
        // Check user version
        const userVersion = await db.get('PRAGMA user_version');
        console.log('📊 Database user_version:', userVersion.user_version);
        
        // List all tables
        const tables = await db.all(`
            SELECT name FROM sqlite_master 
            WHERE type='table' ORDER BY name
        `);
        
        console.log('\n📋 All tables in database:');
        tables.forEach(table => {
            console.log('  -', table.name);
        });
        
        // Check for specific tables mentioned in errors
        const requiredTables = [
            'users', 'expenses', 'auth', 'customers', 'inventory', 
            'sales_records', 'billing_plans', 'routers'
        ];
        
        console.log('\n🔍 Checking for required tables:');
        for (const tableName of requiredTables) {
            const table = await db.get(`
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name = ?
            `, [tableName]);
            
            if (table) {
                console.log(`  ✅ ${tableName}: EXISTS`);
            } else {
                console.log(`  ❌ ${tableName}: MISSING`);
            }
        }
        
        // Check expenses table specifically
        console.log('\n🔍 Checking expenses table structure:');
        try {
            const expensesInfo = await db.all(`PRAGMA table_info(expenses)`);
            if (expensesInfo.length > 0) {
                console.log('  ✅ expenses table structure:');
                expensesInfo.forEach(column => {
                    console.log(`     - ${column.name} (${column.type})`);
                });
            } else {
                console.log('  ❌ expenses table exists but has no columns');
            }
        } catch (error) {
            console.log('  ❌ expenses table does not exist');
        }
        
        await db.close();
        
    } catch (error) {
        console.error('❌ Database error:', error.message);
    }
}

checkDatabaseTables();