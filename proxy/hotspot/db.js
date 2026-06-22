// ============================================================
// Hotspot Controller - Database Module (Isolated)
// ============================================================

const crypto = require('crypto');

const generateId = (prefix) => `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

/**
 * Initialize all hotspot controller tables.
 * @param {import('sqlite').Database} db - The sqlite database instance
 */
async function initHotspotTables(db) {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS esp_devices (
            id TEXT PRIMARY KEY,
            router_id TEXT NOT NULL,
            device_name TEXT NOT NULL,
            mac_address TEXT UNIQUE,
            api_key TEXT NOT NULL,
            coin_value REAL NOT NULL DEFAULT 1.0,
            status TEXT NOT NULL DEFAULT 'offline',
            last_seen TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS hotspot_plans (
            id TEXT PRIMARY KEY,
            router_id TEXT NOT NULL,
            name TEXT NOT NULL,
            duration_seconds INTEGER NOT NULL,
            price REAL NOT NULL,
            rate_limit TEXT,
            shared_users INTEGER DEFAULT 1,
            currency TEXT DEFAULT 'PHP',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS hotspot_voucher_batches (
            id TEXT PRIMARY KEY,
            router_id TEXT NOT NULL,
            batch_name TEXT NOT NULL,
            plan_id TEXT NOT NULL,
            duration_seconds INTEGER NOT NULL,
            rate_limit TEXT,
            price REAL NOT NULL DEFAULT 0,
            total_count INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS hotspot_vouchers (
            id TEXT PRIMARY KEY,
            batch_id TEXT NOT NULL,
            router_id TEXT NOT NULL,
            code TEXT NOT NULL UNIQUE,
            duration_seconds INTEGER NOT NULL,
            rate_limit TEXT,
            price REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'available',
            activated_at TEXT,
            expires_at TEXT,
            mac_address TEXT,
            ip_address TEXT,
            sold_via TEXT DEFAULT 'manual',
            esp_device_id TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS hotspot_sessions (
            id TEXT PRIMARY KEY,
            voucher_id TEXT,
            router_id TEXT NOT NULL,
            esp_device_id TEXT,
            username TEXT NOT NULL,
            mac_address TEXT NOT NULL,
            ip_address TEXT,
            duration_seconds INTEGER NOT NULL,
            started_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            amount_paid REAL DEFAULT 0,
            payment_method TEXT DEFAULT 'coinslot',
            bytes_in INTEGER DEFAULT 0,
            bytes_out INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS coinslot_transactions (
            id TEXT PRIMARY KEY,
            esp_device_id TEXT NOT NULL,
            router_id TEXT NOT NULL,
            mac_address TEXT NOT NULL,
            ip_address TEXT,
            coins_inserted INTEGER NOT NULL,
            amount REAL NOT NULL,
            duration_seconds INTEGER NOT NULL,
            session_id TEXT,
            status TEXT DEFAULT 'completed',
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_hotspot_vouchers_code ON hotspot_vouchers(code);
        CREATE INDEX IF NOT EXISTS idx_hotspot_vouchers_status ON hotspot_vouchers(status);
        CREATE INDEX IF NOT EXISTS idx_hotspot_vouchers_router ON hotspot_vouchers(router_id);
        CREATE INDEX IF NOT EXISTS idx_hotspot_sessions_status ON hotspot_sessions(status);
        CREATE INDEX IF NOT EXISTS idx_hotspot_sessions_router ON hotspot_sessions(router_id);
        CREATE INDEX IF NOT EXISTS idx_esp_devices_api_key ON esp_devices(api_key);
        CREATE INDEX IF NOT EXISTS idx_hotspot_plans_router ON hotspot_plans(router_id);
    `);
}

// ============================================================
// ESP Devices
// ============================================================

async function getEspDevices(db, routerId) {
    if (routerId) {
        return db.all('SELECT * FROM esp_devices WHERE router_id = ? ORDER BY created_at DESC', [routerId]);
    }
    return db.all('SELECT * FROM esp_devices ORDER BY created_at DESC');
}

async function getEspDevice(db, id) {
    return db.get('SELECT * FROM esp_devices WHERE id = ?', [id]);
}

async function getEspDeviceByApiKey(db, apiKey) {
    return db.get('SELECT * FROM esp_devices WHERE api_key = ?', [apiKey]);
}

async function getEspDeviceByMac(db, macAddress) {
    return db.get('SELECT * FROM esp_devices WHERE mac_address = ?', [macAddress]);
}

async function createEspDevice(db, { routerId, deviceName, macAddress, coinValue }) {
    const id = generateId('esp');
    const apiKey = crypto.randomBytes(24).toString('hex');
    const now = new Date().toISOString();
    await db.run(
        'INSERT INTO esp_devices (id, router_id, device_name, mac_address, api_key, coin_value, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, routerId, deviceName, macAddress || null, apiKey, coinValue || 1.0, 'offline', now]
    );
    return { id, routerId, deviceName, macAddress, apiKey, coinValue: coinValue || 1.0, status: 'offline', createdAt: now };
}

async function updateEspDevice(db, id, updates) {
    const fields = [];
    const values = [];
    if (updates.deviceName !== undefined) { fields.push('device_name = ?'); values.push(updates.deviceName); }
    if (updates.coinValue !== undefined) { fields.push('coin_value = ?'); values.push(updates.coinValue); }
    if (updates.macAddress !== undefined) { fields.push('mac_address = ?'); values.push(updates.macAddress); }
    if (fields.length === 0) return null;
    values.push(id);
    await db.run(`UPDATE esp_devices SET ${fields.join(', ')} WHERE id = ?`, values);
    return getEspDevice(db, id);
}

async function deleteEspDevice(db, id) {
    await db.run('DELETE FROM esp_devices WHERE id = ?', [id]);
}

async function updateEspHeartbeat(db, apiKey) {
    await db.run(
        "UPDATE esp_devices SET status = 'online', last_seen = ? WHERE api_key = ?",
        [new Date().toISOString(), apiKey]
    );
}

// ============================================================
// Hotspot Plans
// ============================================================

async function getHotspotPlans(db, routerId) {
    if (routerId) {
        return db.all('SELECT * FROM hotspot_plans WHERE router_id = ? ORDER BY price ASC', [routerId]);
    }
    return db.all('SELECT * FROM hotspot_plans ORDER BY price ASC');
}

async function getHotspotPlan(db, id) {
    return db.get('SELECT * FROM hotspot_plans WHERE id = ?', [id]);
}

async function createHotspotPlan(db, { routerId, name, durationSeconds, price, rateLimit, sharedUsers, currency }) {
    const id = generateId('plan');
    const now = new Date().toISOString();
    await db.run(
        'INSERT INTO hotspot_plans (id, router_id, name, duration_seconds, price, rate_limit, shared_users, currency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, routerId, name, durationSeconds, price, rateLimit || null, sharedUsers || 1, currency || 'PHP', now]
    );
    return { id, routerId, name, durationSeconds, price, rateLimit, sharedUsers: sharedUsers || 1, currency: currency || 'PHP', createdAt: now };
}

async function updateHotspotPlan(db, id, updates) {
    const fields = [];
    const values = [];
    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.durationSeconds !== undefined) { fields.push('duration_seconds = ?'); values.push(updates.durationSeconds); }
    if (updates.price !== undefined) { fields.push('price = ?'); values.push(updates.price); }
    if (updates.rateLimit !== undefined) { fields.push('rate_limit = ?'); values.push(updates.rateLimit); }
    if (updates.sharedUsers !== undefined) { fields.push('shared_users = ?'); values.push(updates.sharedUsers); }
    if (updates.currency !== undefined) { fields.push('currency = ?'); values.push(updates.currency); }
    if (fields.length === 0) return null;
    values.push(id);
    await db.run(`UPDATE hotspot_plans SET ${fields.join(', ')} WHERE id = ?`, values);
    return getHotspotPlan(db, id);
}

async function deleteHotspotPlan(db, id) {
    await db.run('DELETE FROM hotspot_plans WHERE id = ?', [id]);
}

// ============================================================
// Voucher Batches
// ============================================================

async function getVoucherBatches(db, routerId) {
    let query = `
        SELECT b.*, 
            (SELECT COUNT(*) FROM hotspot_vouchers WHERE batch_id = b.id AND status = 'available') as remaining_count
        FROM hotspot_voucher_batches b
    `;
    const params = [];
    if (routerId) {
        query += ' WHERE b.router_id = ?';
        params.push(routerId);
    }
    query += ' ORDER BY b.created_at DESC';
    return db.all(query, params);
}

async function createVoucherBatch(db, { routerId, batchName, planId, durationSeconds, rateLimit, price, totalCount }) {
    const id = generateId('batch');
    const now = new Date().toISOString();
    await db.run(
        'INSERT INTO hotspot_voucher_batches (id, router_id, batch_name, plan_id, duration_seconds, rate_limit, price, total_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, routerId, batchName, planId, durationSeconds, rateLimit || null, price, totalCount, now]
    );
    return { id, routerId, batchName, planId, durationSeconds, rateLimit, price, totalCount, createdAt: now };
}

// ============================================================
// Vouchers
// ============================================================

async function getVouchers(db, { routerId, status, batchId } = {}) {
    let query = 'SELECT * FROM hotspot_vouchers WHERE 1=1';
    const params = [];
    if (routerId) { query += ' AND router_id = ?'; params.push(routerId); }
    if (status) { query += ' AND status = ?'; params.push(status); }
    if (batchId) { query += ' AND batch_id = ?'; params.push(batchId); }
    query += ' ORDER BY created_at DESC';
    return db.all(query, params);
}

async function getVoucherByCode(db, code) {
    return db.get('SELECT * FROM hotspot_vouchers WHERE code = ?', [code]);
}

async function createVoucher(db, { batchId, routerId, code, durationSeconds, rateLimit, price }) {
    const id = generateId('vch');
    const now = new Date().toISOString();
    await db.run(
        'INSERT INTO hotspot_vouchers (id, batch_id, router_id, code, duration_seconds, rate_limit, price, status, sold_via, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, batchId, routerId, code, durationSeconds, rateLimit || null, price, 'available', 'manual', now]
    );
    return { id, batchId, routerId, code, durationSeconds, rateLimit, price, status: 'available', soldVia: 'manual', createdAt: now };
}

async function activateVoucher(db, voucherId, macAddress, ipAddress) {
    const now = new Date().toISOString();
    const voucher = await db.get('SELECT * FROM hotspot_vouchers WHERE id = ?', [voucherId]);
    if (!voucher) return null;
    const expiresAt = new Date(Date.now() + voucher.duration_seconds * 1000).toISOString();
    await db.run(
        "UPDATE hotspot_vouchers SET status = 'active', activated_at = ?, expires_at = ?, mac_address = ?, ip_address = ? WHERE id = ?",
        [now, expiresAt, macAddress, ipAddress, voucherId]
    );
    return { ...voucher, status: 'active', activatedAt: now, expiresAt, macAddress, ipAddress };
}

async function expireVoucher(db, voucherId) {
    await db.run("UPDATE hotspot_vouchers SET status = 'expired' WHERE id = ?", [voucherId]);
}

async function useVoucher(db, voucherId) {
    await db.run("UPDATE hotspot_vouchers SET status = 'used' WHERE id = ?", [voucherId]);
}

async function deleteBatchVouchers(db, batchId) {
    await db.run("DELETE FROM hotspot_vouchers WHERE batch_id = ? AND status = 'available'", [batchId]);
    await db.run('DELETE FROM hotspot_voucher_batches WHERE id = ?', [batchId]);
}

// ============================================================
// Sessions
// ============================================================

async function getSessions(db, { routerId, status } = {}) {
    let query = 'SELECT * FROM hotspot_sessions WHERE 1=1';
    const params = [];
    if (routerId) { query += ' AND router_id = ?'; params.push(routerId); }
    if (status) { query += ' AND status = ?'; params.push(status); }
    query += ' ORDER BY started_at DESC';
    return db.all(query, params);
}

async function getSession(db, id) {
    return db.get('SELECT * FROM hotspot_sessions WHERE id = ?', [id]);
}

async function getActiveSessionByMac(db, routerId, macAddress) {
    return db.get(
        "SELECT * FROM hotspot_sessions WHERE router_id = ? AND mac_address = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1",
        [routerId, macAddress]
    );
}

async function getLatestActiveSession(db, routerId) {
    return db.get(
        "SELECT * FROM hotspot_sessions WHERE router_id = ? AND status IN ('active', 'pending') ORDER BY started_at DESC LIMIT 1",
        [routerId]
    );
}

async function createSession(db, { voucherId, routerId, espDeviceId, username, macAddress, ipAddress, durationSeconds, amountPaid, paymentMethod }) {
    const id = generateId('sess');
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + durationSeconds * 1000).toISOString();
    await db.run(
        'INSERT INTO hotspot_sessions (id, voucher_id, router_id, esp_device_id, username, mac_address, ip_address, duration_seconds, started_at, expires_at, status, amount_paid, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, voucherId || null, routerId, espDeviceId || null, username, macAddress, ipAddress || null, durationSeconds, now, expiresAt, 'active', amountPaid || 0, paymentMethod || 'coinslot']
    );
    return { id, voucherId, routerId, espDeviceId, username, macAddress, ipAddress, durationSeconds, startedAt: now, expiresAt, status: 'active', amountPaid: amountPaid || 0, paymentMethod: paymentMethod || 'coinslot', bytesIn: 0, bytesOut: 0 };
}

async function expireSession(db, sessionId) {
    await db.run("UPDATE hotspot_sessions SET status = 'expired' WHERE id = ?", [sessionId]);
}

async function kickSession(db, sessionId) {
    await db.run("UPDATE hotspot_sessions SET status = 'kicked' WHERE id = ?", [sessionId]);
}

async function extendSession(db, sessionId, additionalSeconds) {
    const session = await getSession(db, sessionId);
    if (!session) return null;
    const currentExpiry = new Date(session.expires_at).getTime();
    const newExpiry = new Date(currentExpiry + additionalSeconds * 1000).toISOString();
    const newDuration = session.duration_seconds + additionalSeconds;
    await db.run(
        'UPDATE hotspot_sessions SET expires_at = ?, duration_seconds = ? WHERE id = ?',
        [newExpiry, newDuration, sessionId]
    );
    return { ...session, expiresAt: newExpiry, durationSeconds: newDuration };
}

async function getExpiredActiveSessions(db) {
    const now = new Date().toISOString();
    return db.all(
        "SELECT * FROM hotspot_sessions WHERE status = 'active' AND expires_at <= ?",
        [now]
    );
}

// ============================================================
// Coinslot Transactions
// ============================================================

async function createCoinslotTransaction(db, { espDeviceId, routerId, macAddress, ipAddress, coinsInserted, amount, durationSeconds, sessionId }) {
    const id = generateId('txn');
    const now = new Date().toISOString();
    await db.run(
        'INSERT INTO coinslot_transactions (id, esp_device_id, router_id, mac_address, ip_address, coins_inserted, amount, duration_seconds, session_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, espDeviceId, routerId, macAddress, ipAddress || null, coinsInserted, amount, durationSeconds, sessionId || null, 'completed', now]
    );
    return { id, espDeviceId, routerId, macAddress, ipAddress, coinsInserted, amount, durationSeconds, sessionId, status: 'completed', createdAt: now };
}

async function getCoinslotTransactions(db, { routerId, espDeviceId } = {}) {
    let query = 'SELECT * FROM coinslot_transactions WHERE 1=1';
    const params = [];
    if (routerId) { query += ' AND router_id = ?'; params.push(routerId); }
    if (espDeviceId) { query += ' AND esp_device_id = ?'; params.push(espDeviceId); }
    query += ' ORDER BY created_at DESC LIMIT 200';
    return db.all(query, params);
}

module.exports = {
    generateId,
    initHotspotTables,
    // ESP Devices
    getEspDevices, getEspDevice, getEspDeviceByApiKey, getEspDeviceByMac, createEspDevice, updateEspDevice, deleteEspDevice, updateEspHeartbeat,
    // Plans
    getHotspotPlans, getHotspotPlan, createHotspotPlan, updateHotspotPlan, deleteHotspotPlan,
    // Batches
    getVoucherBatches, createVoucherBatch,
    // Vouchers
    getVouchers, getVoucherByCode, createVoucher, activateVoucher, expireVoucher, useVoucher, deleteBatchVouchers,
    // Sessions
    getSessions, getSession, getActiveSessionByMac, getLatestActiveSession, createSession, expireSession, kickSession, extendSession, getExpiredActiveSessions,
    // Transactions
    createCoinslotTransaction, getCoinslotTransactions,
};
