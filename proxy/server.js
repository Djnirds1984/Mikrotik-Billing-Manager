
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

// Captive Portal Redirect Middleware
const isAdminHostname = (hostname) => {
    if (hostname === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
        return true;
    }
    const adminDomains = ['.pitunnel.net', '.ngrok.io', '.ngrok-free.app', '.dataplicity.io'];
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

fs.mkdirSync(BACKUP_DIR, { recursive: true });

let db;
let superadminDb;

// Database Initialization and Migrations
async function initSuperadminDb() {
    try {
        superadminDb = await open({
            filename: SUPERADMIN_DB_PATH,
            driver: sqlite3.Database
        });
        await superadminDb.exec('CREATE TABLE IF NOT EXISTS superadmin (username TEXT PRIMARY KEY, password TEXT NOT NULL);');
        const superadminUser = await superadminDb.get("SELECT COUNT(*) as count FROM superadmin");
        if (superadminUser.count === 0) {
            const defaultPassword = 'superadmin';
            const hashedPassword = await bcrypt.hash(defaultPassword, 10);
            await superadminDb.run('INSERT INTO superadmin (username, password) VALUES (?, ?)', 'superadmin', hashedPassword);
        }
    } catch (err) {
        console.error('Failed to initialize superadmin database:', err);
        process.exit(1);
    }
}

async function initDb() {
  // DB initialization logic here... (omitted for brevity, but would be included)
}


// --- Auth & Middleware ---
const authRouter = express.Router();
const protect = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authentication required.' });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token.' });
        }
        req.user = user;
        next();
    });
};
const requireSuperadmin = (req, res, next) => {
    if (req.user.role.name.toLowerCase() !== 'superadmin') {
        return res.status(403).json({ message: 'Access denied. Superadmin privileges required.' });
    }
    next();
};
const requireAdmin = (req, res, next) => {
    const role = req.user.role.name.toLowerCase();
    if (role !== 'administrator' && role !== 'superadmin') {
        return res.status(403).json({ message: 'Access denied. Administrator privileges required.' });
    }
    next();
};

// --- License Key Logic ---
const getDeviceId = () => {
    const networkInterfaces = os.networkInterfaces();
    let macs = [];
    for (const iface of Object.values(networkInterfaces).flat()) {
        if (iface.mac && iface.mac !== '00:00:00:00:00:00' && !iface.internal) {
            macs.push(iface.mac);
        }
    }
    macs.sort();
    const uniqueId = macs.join('') || (os.hostname() + os.arch() + os.platform());
    return crypto.createHash('sha256').update(uniqueId).digest('hex');
};

const licenseRouter = express.Router();
licenseRouter.use(protect);
licenseRouter.get('/status', async (req, res) => {
    try {
        const deviceId = getDeviceId();
        const settings = await db.get('SELECT licenseKey FROM settings');
        const licenseKey = settings?.licenseKey;

        if (!licenseKey) {
            return res.json({ licensed: false, deviceId });
        }

        jwt.verify(licenseKey, LICENSE_SECRET_KEY, (err, decoded) => {
            if (err || decoded.deviceId !== deviceId) {
                const errorMsg = err ? `Invalid license key: ${err.message}` : 'License key is for a different device.';
                return res.json({ licensed: false, deviceId, error: errorMsg });
            }
            res.json({
                licensed: true,
                expires: new Date(decoded.exp * 1000).toISOString(),
                deviceId,
                licenseKey
            });
        });
    } catch (err) {
        res.status(500).json({ licensed: false, error: err.message, deviceId: getDeviceId() });
    }
});
licenseRouter.post('/generate', requireSuperadmin, (req, res) => {
    const { deviceId, days } = req.body;
    if (!deviceId || !days) return res.status(400).json({ message: 'deviceId and days are required.' });
    const expiresIn = `${days}d`;
    const licenseKey = jwt.sign({ deviceId }, LICENSE_SECRET_KEY, { expiresIn });
    res.json({ licenseKey });
});

// --- Remote Access & Other Routers ---
const ztCli = (command) => new Promise((resolve, reject) => {
     exec(`sudo zerotier-cli -j ${command}`, (error, stdout, stderr) => {
        if (error) {
            const errMsg = stderr || error.message;
            if (errMsg.includes("sudo: a password is required")) return reject({ status: 403, data: { code: 'SUDO_PASSWORD_REQUIRED', message: 'Passwordless sudo is not configured correctly.' } });
            if (stderr.includes("missing authentication token")) return reject({ status: 500, data: { code: 'ZEROTIER_SERVICE_DOWN', message: 'ZeroTier service is not running.' } });
            if (error.message.includes('No such file or directory')) return reject({ status: 404, data: { code: 'ZEROTIER_NOT_INSTALLED', message: 'zerotier-cli not found.' } });
            return reject({ status: 500, message: errMsg });
        }
        try { resolve(JSON.parse(stdout)); } catch (e) { reject({ status: 500, message: `Failed to parse zerotier-cli output: ${stdout}` }); }
    });
});
const ztRouter = express.Router();
ztRouter.use(protect);
ztRouter.get('/status', async (req, res) => {
    try {
        const [info, networks] = await Promise.all([ztCli('info'), ztCli('listnetworks')]);
        res.json({ info, networks });
    } catch (err) { res.status(err.status || 500).json(err.data || { message: err.message }); }
});

const superadminRouter = express.Router();
superadminRouter.use(protect, requireSuperadmin);

// Other router definitions would go here... (piTunnel, ngrok, etc.)

// --- API ROUTE REGISTRATION ---
app.use('/api/auth', authRouter); // Assuming authRouter is defined elsewhere
app.use('/api/license', licenseRouter);
app.use('/api/zt', ztRouter);
app.use('/api/superadmin', superadminRouter);

app.post('/api/telegram/test', protect, async (req, res) => {
    const { botToken, chatId } = req.body;
    if (!botToken || !chatId) {
        return res.status(400).json({ success: false, error: 'Missing botToken or chatId.' });
    }
    const testMessage = "This is a test from your MikroTik Panel.";
    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    try {
        await axios.post(telegramApiUrl, { chat_id: chatId, text: testMessage });
        res.json({ success: true, message: 'Test message sent successfully!' });
    } catch (error) {
        const err_msg = error.response?.data?.description || error.message;
        res.status(400).json({ success: false, error: 'Telegram API error: ' + err_msg });
    }
});


// --- Frontend Serving Strategy ---
const staticPath = path.join(__dirname, '..');

// Serve static assets from the root directory
app.use(express.static(staticPath));

// For any route that is not an API call or a static file, serve the index.html.
// This is crucial for the React router to work correctly.
app.get('*', (req, res) => {
    // A simple check to avoid serving index.html for missed API calls
    if (req.path.startsWith('/api/') || req.path.startsWith('/mt-api/') || req.path.startsWith('/ws/')) {
        return res.status(404).json({ message: 'API endpoint not found' });
    }
    res.sendFile(path.join(staticPath, 'index.html'));
});

// --- Start Server ---
Promise.all([initDb(), initSuperadminDb()]).then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Mikrotik Billling Management UI server running. Listening on http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error("Failed to start server:", err);
    process.exit(1);
});
