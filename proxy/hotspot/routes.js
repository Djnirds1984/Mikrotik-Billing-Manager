// ============================================================
// Hotspot Controller - Express Routes (Isolated)
// Mounted at /api/hotspot by the main proxy server
// ============================================================

const express = require('express');
const router = express.Router();

const db = require('./db');
const voucherGen = require('./voucherGenerator');
const espHandler = require('./espHandler');
const sessionManager = require('./sessionManager');

// ============================================================
// Middleware
// ============================================================

/**
 * JWT auth middleware for admin endpoints.
 * Re-implements the protect logic locally so this module is self-contained.
 */
function protect(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authentication required.' });
    }
    const jwt = require('jsonwebtoken');
    const SECRET_KEY = process.env.JWT_SECRET || 'a-very-weak-secret-key-for-dev-only';
    const token = authHeader.split(' ')[1];
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid or expired token.' });
        req.user = user;
        next();
    });
}

/**
 * ESP API key auth middleware.
 */
function espAuth(req, res, next) {
    const apiKey = req.headers['x-esp-api-key'];
    if (!apiKey) {
        return res.status(401).json({ message: 'ESP API key required.' });
    }
    espHandler.validateEspApiKey(apiKey, req.app.locals.hotspotDb).then(device => {
        if (!device) {
            return res.status(403).json({ message: 'Invalid ESP API key.' });
        }
        req.espDevice = device;
        next();
    }).catch(err => {
        res.status(500).json({ message: 'ESP auth error: ' + err.message });
    });
}

// ============================================================
// ESP Endpoints (auth via X-ESP-API-Key)
// ============================================================

/**
 * POST /esp/coin-insert
 * ESP reports coins inserted for a client device.
 */
router.post('/esp/coin-insert', espAuth, async (req, res) => {
    try {
        const { macAddress, ipAddress, coinPulses } = req.body;
        if (!macAddress || !coinPulses) {
            return res.status(400).json({ success: false, message: 'macAddress and coinPulses are required.' });
        }

        const hotspotDb = req.app.locals.hotspotDb;
        const result = await espHandler.processCoinInsert(
            req.espDevice, macAddress, ipAddress, coinPulses, hotspotDb, sessionManager
        );

        // Update heartbeat
        await db.updateEspHeartbeat(hotspotDb, req.espDevice.api_key);

        res.json(result);
    } catch (err) {
        console.error('[HotspotAPI] /esp/coin-insert error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /esp/heartbeat
 * ESP sends periodic heartbeat.
 */
router.post('/esp/heartbeat', espAuth, async (req, res) => {
    try {
        const hotspotDb = req.app.locals.hotspotDb;
        await db.updateEspHeartbeat(hotspotDb, req.espDevice.api_key);
        res.json({ success: true, message: 'Heartbeat received.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /esp/status
 * ESP self-check - returns device info and active sessions.
 */
router.get('/esp/status', espAuth, async (req, res) => {
    try {
        const hotspotDb = req.app.locals.hotspotDb;
        const plans = await db.getHotspotPlans(hotspotDb, req.espDevice.router_id);
        const sessions = await db.getSessions(hotspotDb, { routerId: req.espDevice.router_id, status: 'active' });
        const recentTxns = await db.getCoinslotTransactions(hotspotDb, { espDeviceId: req.espDevice.id });
        
        res.json({
            device: { id: req.espDevice.id, name: req.espDevice.device_name, coinValue: req.espDevice.coin_value },
            plans: plans.map(p => ({ name: p.name, price: p.price, duration: p.duration_seconds })),
            activeSessions: sessions.length,
            recentTransactions: recentTxns.slice(0, 10),
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ============================================================
// Hotspot Plans (Admin - JWT protected)
// ============================================================

router.get('/plans', protect, async (req, res) => {
    try {
        const hotspotDb = req.app.locals.hotspotDb;
        const plans = await db.getHotspotPlans(hotspotDb, req.query.routerId);
        res.json(plans);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/plans', protect, async (req, res) => {
    try {
        const hotspotDb = req.app.locals.hotspotDb;
        const plan = await db.createHotspotPlan(hotspotDb, {
            routerId: req.body.routerId,
            name: req.body.name,
            durationSeconds: req.body.durationSeconds,
            price: req.body.price,
            rateLimit: req.body.rateLimit,
            sharedUsers: req.body.sharedUsers,
            currency: req.body.currency,
        });
        res.json(plan);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.patch('/plans/:id', protect, async (req, res) => {
    try {
        const hotspotDb = req.app.locals.hotspotDb;
        const plan = await db.updateHotspotPlan(hotspotDb, req.params.id, req.body);
        if (!plan) return res.status(404).json({ message: 'Plan not found or no changes.' });
        res.json(plan);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.delete('/plans/:id', protect, async (req, res) => {
    try {
        const hotspotDb = req.app.locals.hotspotDb;
        await db.deleteHotspotPlan(hotspotDb, req.params.id);
        res.json({ message: 'Plan deleted.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ============================================================
// Voucher Batches (Admin)
// ============================================================

router.get('/vouchers/batches', protect, async (req, res) => {
    try {
        const hotspotDb = req.app.locals.hotspotDb;
        const batches = await db.getVoucherBatches(hotspotDb, req.query.routerId);
        res.json(batches);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/vouchers/batch', protect, async (req, res) => {
    try {
        const hotspotDb = req.app.locals.hotspotDb;
        const { routerId, planId, count, batchName } = req.body;

        if (!routerId || !planId || !count) {
            return res.status(400).json({ message: 'routerId, planId, and count are required.' });
        }
        if (count < 1 || count > 500) {
            return res.status(400).json({ message: 'Count must be between 1 and 500.' });
        }

        const plan = await db.getHotspotPlan(hotspotDb, planId);
        if (!plan) return res.status(404).json({ message: 'Plan not found.' });

        const batch = await db.createVoucherBatch(hotspotDb, {
            routerId,
            batchName: batchName || `${plan.name} - ${new Date().toLocaleDateString()}`,
            planId,
            durationSeconds: plan.duration_seconds,
            rateLimit: plan.rate_limit,
            price: plan.price,
            totalCount: count,
        });

        // Generate voucher codes
        const vouchers = await voucherGen.generateBatch(count, plan, routerId, batch.id, hotspotDb);

        res.json({ batch, voucherCount: vouchers.length });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.delete('/vouchers/batch/:id', protect, async (req, res) => {
    try {
        const hotspotDb = req.app.locals.hotspotDb;
        await db.deleteBatchVouchers(hotspotDb, req.params.id);
        res.json({ message: 'Batch and unused vouchers deleted.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ============================================================
// Vouchers (Admin)
// ============================================================

router.get('/vouchers', protect, async (req, res) => {
    try {
        const hotspotDb = req.app.locals.hotspotDb;
        const vouchers = await db.getVouchers(hotspotDb, {
            routerId: req.query.routerId,
            status: req.query.status,
            batchId: req.query.batchId,
        });
        res.json(vouchers);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ============================================================
// Hotspot Login (Public - called by captive portal page)
// ============================================================

router.post('/login', async (req, res) => {
    try {
        const { code, routerId, mac, ip } = req.body;
        if (!code || !routerId || !mac) {
            return res.status(400).json({ success: false, message: 'code, routerId, and mac are required.' });
        }

        const hotspotDb = req.app.locals.hotspotDb;

        // Validate voucher
        const voucher = await db.getVoucherByCode(hotspotDb, code);
        if (!voucher) {
            return res.json({ success: false, message: 'Invalid voucher code.' });
        }
        if (voucher.status !== 'available') {
            return res.json({ success: false, message: `Voucher is ${voucher.status}.` });
        }
        if (voucher.router_id !== routerId) {
            return res.json({ success: false, message: 'Voucher is not valid for this network.' });
        }

        // Authorize via MikroTik
        const session = await sessionManager.authorizeWithVoucher(routerId, mac, ip, voucher, hotspotDb);
        if (!session) {
            return res.json({ success: false, message: 'Failed to authorize on the network. Please try again.' });
        }

        res.json({
            success: true,
            message: `Connected! You have ${formatDuration(voucher.duration_seconds)} of access.`,
            session,
        });
    } catch (err) {
        console.error('[HotspotAPI] /login error:', err.message);
        res.status(500).json({ success: false, message: 'Server error. Please try again.' });
    }
});

router.post('/logout', async (req, res) => {
    try {
        const { sessionId } = req.body;
        if (!sessionId) return res.status(400).json({ message: 'sessionId required.' });

        const hotspotDb = req.app.locals.hotspotDb;
        const result = await sessionManager.kickSession(sessionId, hotspotDb);
        res.json({ success: result, message: result ? 'Logged out.' : 'Session not found.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ============================================================
// Sessions (Admin)
// ============================================================

router.get('/sessions', protect, async (req, res) => {
    try {
        const hotspotDb = req.app.locals.hotspotDb;
        const sessions = await db.getSessions(hotspotDb, {
            routerId: req.query.routerId,
            status: req.query.status,
        });
        res.json(sessions);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/sessions/:id/kick', protect, async (req, res) => {
    try {
        const hotspotDb = req.app.locals.hotspotDb;
        const result = await sessionManager.kickSession(req.params.id, hotspotDb);
        res.json({ success: result });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/sessions/:id/extend', protect, async (req, res) => {
    try {
        const { additionalSeconds } = req.body;
        if (!additionalSeconds) return res.status(400).json({ message: 'additionalSeconds required.' });

        const hotspotDb = req.app.locals.hotspotDb;
        const session = await db.getSession(hotspotDb, req.params.id);
        if (!session) return res.status(404).json({ message: 'Session not found.' });

        const updated = await sessionManager.extendDeviceSession(session.router_id, session, additionalSeconds, hotspotDb);
        if (!updated) return res.status(500).json({ message: 'Failed to extend session.' });
        res.json(updated);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ============================================================
// ESP Device Management (Admin)
// ============================================================

router.get('/devices', protect, async (req, res) => {
    try {
        const hotspotDb = req.app.locals.hotspotDb;
        const devices = await db.getEspDevices(hotspotDb, req.query.routerId);
        res.json(devices);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/devices', protect, async (req, res) => {
    try {
        const hotspotDb = req.app.locals.hotspotDb;
        const device = await db.createEspDevice(hotspotDb, {
            routerId: req.body.routerId,
            deviceName: req.body.deviceName,
            macAddress: req.body.macAddress,
            coinValue: req.body.coinValue,
        });
        res.json(device);
    } catch (err) {
        if (err.message.includes('UNIQUE')) {
            return res.status(409).json({ message: 'A device with this MAC address already exists.' });
        }
        res.status(500).json({ message: err.message });
    }
});

router.patch('/devices/:id', protect, async (req, res) => {
    try {
        const hotspotDb = req.app.locals.hotspotDb;
        const device = await db.updateEspDevice(hotspotDb, req.params.id, req.body);
        if (!device) return res.status(404).json({ message: 'Device not found.' });
        res.json(device);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.delete('/devices/:id', protect, async (req, res) => {
    try {
        const hotspotDb = req.app.locals.hotspotDb;
        await db.deleteEspDevice(hotspotDb, req.params.id);
        res.json({ message: 'Device deleted.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ============================================================
// Coinslot Transactions (Admin)
// ============================================================

router.get('/transactions', protect, async (req, res) => {
    try {
        const hotspotDb = req.app.locals.hotspotDb;
        const txns = await db.getCoinslotTransactions(hotspotDb, {
            routerId: req.query.routerId,
            espDeviceId: req.query.espDeviceId,
        });
        res.json(txns);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ============================================================
// Public Plans (for login page - no auth required)
// ============================================================

router.get('/public/plans', async (req, res) => {
    try {
        const hotspotDb = req.app.locals.hotspotDb;
        const plans = await db.getHotspotPlans(hotspotDb, req.query.routerId);
        res.json(plans);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ============================================================
// Portal Init (Public - called by captive portal on page load)
// Creates a pending session so the ESP can extend it when coins arrive.
// ============================================================

router.post('/portal/init', async (req, res) => {
    try {
        const { routerId, mac, ip } = req.body;
        if (!routerId || !mac) {
            return res.status(400).json({ success: false, message: 'routerId and mac are required.' });
        }

        const hotspotDb = req.app.locals.hotspotDb;

        // Check if there's already an active session for this MAC
        const existing = await db.getActiveSessionByMac(hotspotDb, routerId, mac);
        if (existing) {
            return res.json({
                success: true,
                session: existing,
                alreadyActive: true,
                message: 'Session already active.',
            });
        }

        // Create a pending session with 60s grace period
        const username = `pend_${mac.replace(/:/g, '')}_${Date.now().toString(36)}`;
        const gracePeriod = 60; // seconds

        const session = await sessionManager.authorizeDevice(
            routerId, mac, ip, gracePeriod, null, username, 1, hotspotDb
        );

        if (!session) {
            return res.json({
                success: false,
                message: 'Failed to create pending session on MikroTik.',
            });
        }

        // Mark as pending (waiting for coins)
        await hotspotDb.run(
            "UPDATE hotspot_sessions SET status = 'pending' WHERE id = ?",
            [session.id]
        );

        res.json({
            success: true,
            session: { ...session, status: 'pending' },
            message: 'Pending session created. Insert coins to activate.',
        });
    } catch (err) {
        console.error('[HotspotAPI] /portal/init error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// Helpers
// ============================================================

function formatDuration(seconds) {
    if (seconds >= 86400) return `${Math.floor(seconds / 86400)} day(s)`;
    if (seconds >= 3600) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return m > 0 ? `${h}h ${m}min` : `${h} hour(s)`;
    }
    if (seconds >= 60) return `${Math.floor(seconds / 60)} minute(s)`;
    return `${seconds} seconds`;
}

module.exports = router;
