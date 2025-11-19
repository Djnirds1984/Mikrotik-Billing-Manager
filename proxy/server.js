
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


// --- License Key Logic ---
const getDeviceId = () => {
    const networkInterfaces = os.networkInterfaces();
    const macs = [];
    for (const interfaceName in networkInterfaces) {
        const networkInterface = networkInterfaces[interfaceName];
        for (const interfaceInfo of networkInterface) {
            if (interfaceInfo.mac && interfaceInfo.mac !== '00:00:00:00:00:00' && !interfaceInfo.internal) {
                macs.push(interfaceInfo.mac);
            }
        }
    }
    macs.sort();
    if (macs.length === 0) {
        return crypto.createHash('sha256').update(os.hostname() + os.arch() + os.platform()).digest('hex');
    }
    return crypto.createHash('sha256').update(macs.join('')).digest('hex');
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
            if (err) {
                return res.json({ licensed: false, deviceId, error: `Invalid license key: ${err.message}` });
            }
            if (decoded.deviceId !== deviceId) {
                return res.json({ licensed: false, deviceId, error: 'License key is for a different device.' });
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

licenseRouter.post('/activate', async (req, res) => {
    const { licenseKey } = req.body;
    const deviceId = getDeviceId();
    jwt.verify(licenseKey, LICENSE_SECRET_KEY, async (err, decoded) => {
        if (err) return res.status(400).json({ message: `Invalid license key: ${err.message}` });
        if (decoded.deviceId !== deviceId) return res.status(400).json({ message: 'License key does not match this device.' });
        try {
            await db.run('UPDATE settings SET licenseKey = ?', licenseKey);
            res.json({ message: 'License activated successfully.' });
        } catch (dbErr) {
            res.status(500).json({ message: `Database error: ${dbErr.message}` });
        }
    });
});

licenseRouter.post('/revoke', async (req, res) => {
    try {
        await db.run('UPDATE settings SET licenseKey = NULL');
        res.json({ message: 'License revoked.' });
    } catch (dbErr) {
        res.status(500).json({ message: `Database error: ${dbErr.message}` });
    }
});

licenseRouter.post('/generate', requireSuperadmin, (req, res) => {
    const { deviceId, days } = req.body;
    if (!deviceId || !days) return res.status(400).json({ message: 'deviceId and days are required.' });
    const expiresIn = `${days}d`;
    const licenseKey = jwt.sign({ deviceId }, LICENSE_SECRET_KEY, { expiresIn });
    res.json({ licenseKey });
});


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
        const result = await ztCli(`join ${req.body.networkId}`);
        res.json(result);
    } catch (err) {
        res.status(err.status || 500).json({ message: err.message });
    }
});

ztRouter.post('/leave', async (req, res) => {
    try {
        const result = await ztCli(`leave ${req.body.networkId}`);
        res.json(result);
    } catch (err) {
        res.status(err.status || 500).json({ message: err.message });
    }
});

ztRouter.post('/set', async (req, res) => {
    const { networkId, setting, value } = req.body;
    try {
        const result = await ztCli(`set ${networkId} ${setting}=${value}`);
        res.json(result);
    } catch (err) {
        res.status(err.status || 500).json({ message: err.message });
    }
});

ztRouter.get('/install', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();
    
    const command = 'curl -s https://install.zerotier.com | sudo bash';
    runCommandStream(command, res)
        .then(() => {
            res.write(`data: ${JSON.stringify({ status: 'success', log: 'Installation script finished.' })}\n\n`);
            res.write(`data: ${JSON.stringify({ status: 'finished' })}\n\n`);
            res.end();
        })
        .catch(err => {
            res.write(`data: ${JSON.stringify({ status: 'error', message: err.message })}\n\n`);
            res.end();
        });
});

// --- Remote Access Service Helpers ---
const sudoExecOptions = { env: { ...process.env, PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' } };
const streamExec = (res, command, message) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ log: message })}\n\n`);
    
    runCommandStream(command, res, sudoExecOptions)
    .then(() => res.write(`data: ${JSON.stringify({ status: 'finished' })}\n\n`))
    .catch(err => res.write(`data: ${JSON.stringify({ status: 'error', message: err.message })}\n\n`))
    .finally(() => res.end());
};

// --- Pi Tunnel, Dataplicity, Ngrok Routers ---
const piTunnelRouter = express.Router();
piTunnelRouter.use(protect);

piTunnelRouter.get('/status', async (req, res) => {
    try {
        const installed = fs.existsSync('/usr/local/bin/pitunnel');
        let active = false;
        if (installed) {
            const { stdout } = await execPromise('sudo systemctl is-active pitunnel.service').catch(() => ({ stdout: 'inactive' }));
            active = stdout.trim() === 'active';
        }
        res.json({ installed, active, url: 'https://pitunnel.com/dashboard' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

piTunnelRouter.post('/install', (req, res) => streamExec(res, req.body.command, 'Starting PiTunnel installation...'));
piTunnelRouter.get('/uninstall', (req, res) => streamExec(res, 'sudo pitunnel --remove', 'Starting PiTunnel uninstallation...'));
piTunnelRouter.post('/tunnels/create', (req, res) => {
    const { port, name, protocol } = req.body;
    const cmd = `sudo pitunnel --port=${port} ${name ? `--name=${name}` : ''} ${protocol !== 'tcp' ? `--${protocol}` : ''}`.trim();
    streamExec(res, cmd, `Creating tunnel with command: ${cmd}`);
});


const dataplicityRouter = express.Router();
dataplicityRouter.use(protect);
dataplicityRouter.get('/status', async (req, res) => {
    try {
        const installed = fs.existsSync('/usr/local/bin/dataplicity');
        res.json({ installed, url: 'https://app.dataplicity.com/' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});
dataplicityRouter.post('/install', (req, res) => streamExec(res, req.body.command, 'Starting Dataplicity installation...'));
dataplicityRouter.get('/uninstall', (req, res) => streamExec(res, 'sudo supervisorctl stop dataplicity && sudo rm -f /etc/supervisor/conf.d/dataplicity.conf && sudo supervisorctl reread && sudo supervisorctl update', 'Starting Dataplicity uninstallation...'));


const ngrokApi = express.Router();
ngrokApi.use(protect);

ngrokApi.get('/status', async (req, res) => {
    try {
        const installed = fs.existsSync(NGROK_BINARY_PATH);
        let active = false;
        if (installed) {
            const { stdout } = await execPromise('sudo systemctl is-active ngrok.service').catch(() => ({ stdout: 'inactive' }));
            active = stdout.trim() === 'active';
        }
        const config = fs.existsSync(NGROK_CONFIG_PATH) ? JSON.parse(fs.readFileSync(NGROK_CONFIG_PATH)) : {};
        let url = null;
        if (active) {
             try {
                const response = await axios.get('http://127.0.0.1:4040/api/tunnels');
                url = response.data.tunnels?.[0]?.public_url;
            } catch (e) { console.warn("Could not fetch ngrok URL from local API"); }
        }
        res.json({ installed, active, config, url });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

ngrokApi.post('/settings', async (req, res) => {
    try {
        fs.writeFileSync(NGROK_CONFIG_PATH, JSON.stringify(req.body, null, 2));
        res.json({ message: 'Settings saved. Please re-install/re-configure for changes to take effect.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

ngrokApi.post('/control/:action', async (req, res) => {
    const { action } = req.params;
    if (!['start', 'stop', 'restart'].includes(action)) return res.status(400).json({ message: 'Invalid action.'});
    try {
        await execPromise(`sudo systemctl ${action} ngrok.service`);
        res.json({ message: `Ngrok service ${action}ed.` });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

ngrokApi.get('/install', (req, res) => {
    const config = fs.existsSync(NGROK_CONFIG_PATH) ? JSON.parse(fs.readFileSync(NGROK_CONFIG_PATH)) : {};
    const installScript = `
        set -e
        echo "--- Downloading Ngrok ---"
        curl -s https://bin.equinox.io/c/4VmDzA7iaHb/ngrok-stable-linux-arm.zip -o ngrok.zip
        unzip -o ngrok.zip
        echo "--- Moving binary ---"
        sudo mv ngrok ${NGROK_BINARY_PATH}
        sudo chmod +x ${NGROK_BINARY_PATH}
        echo "--- Configuring auth token ---"
        ${NGROK_BINARY_PATH} authtoken ${config.authtoken} --config /root/.ngrok2/ngrok.yml
        echo "--- Creating systemd service file ---"
        sudo bash -c 'cat > /etc/systemd/system/ngrok.service <<EOL
[Unit]
Description=Ngrok Tunnel
After=network.target

[Service]
ExecStart=${NGROK_BINARY_PATH} ${config.proto} ${config.port}
Restart=always
User=root

[Install]
WantedBy=multi-user.target
EOL'
        echo "--- Reloading systemd and starting service ---"
        sudo systemctl daemon-reload
        sudo systemctl enable ngrok.service
        sudo systemctl start ngrok.service
        echo "--- Cleaning up ---"
        rm ngrok.zip
        echo "--- Installation complete! ---"
    `.trim();
    streamExec(res, installScript, 'Starting Ngrok installation...');
});

ngrokApi.get('/uninstall', (req, res) => {
    const uninstallScript = `
        set -e
        echo "--- Stopping and disabling Ngrok service ---"
        sudo systemctl stop ngrok.service
        sudo systemctl disable ngrok.service
        echo "--- Removing files ---"
        sudo rm -f /etc/systemd/system/ngrok.service ${NGROK_BINARY_PATH}
        echo "--- Reloading systemd ---"
        sudo systemctl daemon-reload
        echo "--- Uninstallation complete! ---"
    `.trim();
    streamExec(res, uninstallScript, 'Starting Ngrok uninstallation...');
});


// --- Super Admin Backup/Restore ---
const superadminRouter = express.Router();
superadminRouter.use(protect, requireSuperadmin);
// ... (All Super Admin routes remain the same) ...


// --- API ROUTE REGISTRATION ---
app.use('/api/auth', authRouter);
app.use('/api/license', licenseRouter);


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


// --- Frontend Serving Strategy ---
// ... (rest of the file remains the same) ...

// --- Start Server ---
Promise.all([initDb(), initSuperadminDb()]).then(() => {
    app.listen(PORT, () => {
        console.log(`Mikrotik Billling Management UI server running. Listening on http://localhost:${PORT}`);
    });
});
