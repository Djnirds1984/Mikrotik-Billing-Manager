
const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const util = require('util');
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
const axios = require('axios');

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

const execPromise = util.promisify(exec);

app.use(express.json({ limit: '10mb' }));
app.use(express.text({ limit: '10mb' })); // For AI fixer

// --- Global Helpers ---
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


// --- Captive Portal Redirect Middleware ---
const isAdminHostname = (hostname) => {
    if (hostname === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
        return true;
    }
    const adminDomains = [
        '.pitunnel.net',
        '.ngrok.io',
        '.ngrok-free.app',
        '.dataplicity.io'
    ];
    return adminDomains.some(domain => hostname.endsWith(domain));
};

app.use((req, res, next) => {
    const isDirectAccess = isAdminHostname(req.hostname);
    const ignoredPaths = ['/api/', '/mt-api/', '/ws/', '/captive', '/env.js'];
    const isStaticAsset = req.path.match(/\.(js|css|tsx|ts|svg|png|jpg|ico|json|map)$/);

    if (!isDirectAccess && !isStaticAsset && !ignoredPaths.some(p => req.path.startsWith(p))) {
        return res.redirect('/captive');
    }
    next();
});

// ... (rest of the server setup) ...

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
                if (superadminDb) await superadminDb.close();
                await fsPromises.unlink(SUPERADMIN_DB_PATH);
                return initSuperadminDb();
            } catch (deleteErr) {
                console.error('CRITICAL: Failed to delete corrupt superadmin database.', deleteErr);
                process.exit(1);
            }
        } else {
            console.error('Failed to initialize superadmin database:', err);
            process.exit(1);
        }
    }
}

async function initDb() {
    // ... (All existing DB migrations remain the same) ...
}

// ... (Authentication routes remain the same) ...

// --- Auth Helper & Middleware ---
const authRouter = express.Router();
const protect = (req, res, next) => {
    // ... (protect middleware implementation) ...
};
const requireSuperadmin = (req, res, next) => {
    // ... (requireSuperadmin middleware implementation) ...
};
const requireAdmin = (req, res, next) => {
    // ... (requireAdmin middleware implementation) ...
};


// --- ZeroTier CLI ---
const ztCli = (command) => new Promise((resolve, reject) => {
    exec(`sudo zerotier-cli -j ${command}`, (error, stdout, stderr) => {
        if (error) {
            const errMsg = stderr || error.message;
            if (errMsg.includes("sudo: a password is required")) {
                return reject({ status: 403, data: { code: 'SUDO_PASSWORD_REQUIRED', message: 'Passwordless sudo is not configured correctly for the panel user.' } });
            }
            if (stderr.includes("zerotier-cli: missing authentication token")) {
                return reject({ status: 500, data: { code: 'ZEROTIER_SERVICE_DOWN', message: 'ZeroTier service is not running or token is missing.' } });
            }
            if (error.message.includes('No such file or directory')) {
                return reject({ status: 404, data: { code: 'ZEROTIER_NOT_INSTALLED', message: 'zerotier-cli not found.' } });
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

const ztRouter = express.Router();
ztRouter.use(protect);

ztRouter.get('/status', async (req, res) => {
    try {
        const [info, networks] = await Promise.all([
            ztCli('info'),
            ztCli('listnetworks')
        ]);
        res.json({ info, networks });
    } catch (err) {
        res.status(err.status || 500).json(err.data || { message: err.message });
    }
});
ztRouter.post('/join', async (req, res) => {
    try {
        await ztCli(`join ${req.body.networkId}`);
        res.json({ message: 'Join command sent successfully. It may take a moment to connect.' });
    } catch (err) {
        res.status(err.status || 500).json({ message: err.message });
    }
});
// ... other ztRouter endpoints ...

// --- Remote Access Service Helpers ---
const sudoExecOptions = { env: { ...process.env, PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' } };
const streamExec = (res, command, message) => {
    // ... (streamExec implementation) ...
};

// --- Pi Tunnel, Dataplicity, Ngrok Routers ---
const piTunnelRouter = express.Router();
piTunnelRouter.use(protect);
// ... (All PiTunnel routes implemented here) ...

const dataplicityRouter = express.Router();
dataplicityRouter.use(protect);
// ... (All Dataplicity routes implemented here) ...

const ngrokApi = express.Router();
ngrokApi.use(protect);
// ... (All Ngrok routes implemented here) ...


// --- Super Admin Backup/Restore ---
const superadminRouter = express.Router();
superadminRouter.use(protect, requireSuperadmin);
// ... (All Super Admin routes remain the same) ...


// --- API ROUTE REGISTRATION ---
app.use('/api/auth', authRouter);
app.use('/api/license', licenseRouter);
app.use('/api', updaterRouter); 

// ... (All other API routes remain the same) ...

app.use('/api/zt', ztRouter);
app.use('/api/pitunnel', piTunnelRouter);
app.use('/api/dataplicity', dataplicityRouter);
app.use('/api/ngrok', ngrokApi);
app.use('/api/superadmin', superadminRouter);

// --- Telegram Test Endpoint ---
app.post('/api/telegram/test', protect, async (req, res) => {
    const { botToken, chatId } = req.body;
    if (!botToken || !chatId) {
        return res.status(400).json({ success: false, error: 'Missing botToken or chatId.' });
    }
    const testMessage = "🧪 <b>Test Message</b>\n\nThis is a test from your MikroTik Panel. Integration is working!";
    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    try {
        await axios.post(telegramApiUrl, { chat_id: chatId, text: testMessage, parse_mode: 'HTML' });
        res.json({ success: true, message: 'Test message sent successfully!' });
    } catch (error) {
        const err_msg = error.response?.data?.description || error.message;
        console.error('Telegram test failed:', err_msg);
        res.status(400).json({ success: false, error: 'Telegram API returned an error: ' + err_msg });
    }
});


// Panel Admin routes
app.use('/api', panelAdminRouter);

// --- Frontend Serving Strategy ---
// ... (rest of the file remains the same) ...

// --- Start Server ---
Promise.all([initDb(), initSuperadminDb()]).then(() => {
    app.listen(PORT, () => {
        console.log(`Mikrotik Billling Management UI server running. Listening on http://localhost:${PORT}`);
    });
});
