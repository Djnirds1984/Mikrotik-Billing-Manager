import sqlite3 from '@vscode/sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkRouters() {
    const DB_PATH = path.join(__dirname, 'panel.db');
    
    try {
        const db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });

        console.log('🔍 Checking routers in database...');
        
        // Get all routers
        const routers = await db.all('SELECT * FROM routers');
        
        console.log(`📊 Found ${routers.length} routers:`);
        routers.forEach(router => {
            console.log(`  - ID: ${router.id}`);
            console.log(`    Name: ${router.name}`);
            console.log(`    Host: ${router.host}`);
            console.log(`    Port: ${router.port}`);
            console.log(`    User: ${router.user}`);
            console.log(`    API Type: ${router.api_type}`);
            console.log('');
        });
        
        await db.close();
        
    } catch (error) {
        console.error('❌ Database error:', error.message);
    }
}

checkRouters();