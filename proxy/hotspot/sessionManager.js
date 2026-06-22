// ============================================================
// Hotspot Controller - Session Manager (Isolated)
// Handles MikroTik hotspot user authorization and session lifecycle
// ============================================================

const axios = require('axios');
const db = require('./db');

const MIKROTIK_API_BASE = 'http://localhost:3002';

/**
 * Make a MikroTik API call via the api-backend.
 * @param {string} routerId
 * @param {string} endpoint - e.g. 'ip/hotspot/user/add'
 * @param {string} method - GET, POST, DELETE
 * @param {object} body - Request body
 */
async function mikrotikCall(routerId, endpoint, method = 'GET', body = null) {
    const url = `${MIKROTIK_API_BASE}/${routerId}/${endpoint}`;
    try {
        if (method === 'GET') {
            const resp = await axios.get(url, { timeout: 10000 });
            return resp.data;
        } else if (method === 'POST') {
            const resp = await axios.post(url, body, { timeout: 10000 });
            return resp.data;
        } else if (method === 'DELETE') {
            const resp = await axios.delete(url, { timeout: 10000 });
            return resp.data;
        }
    } catch (err) {
        console.error(`[HotspotController] MikroTik call failed: ${endpoint}`, err.message);
        throw err;
    }
}

/**
 * Authorize a device by creating a hotspot user on MikroTik with a time limit.
 * @param {string} routerId
 * @param {string} macAddress - Client MAC
 * @param {string} ipAddress - Client IP
 * @param {number} durationSeconds - Session duration
 * @param {string} rateLimit - e.g. "5M/10M"
 * @param {string} username - Unique username for this session
 * @param {number} sharedUsers - Max shared users
 * @param {import('sqlite').Database} database
 * @returns {Promise<object|null>} Session record or null on failure
 */
async function authorizeDevice(routerId, macAddress, ipAddress, durationSeconds, rateLimit, username, sharedUsers, database) {
    try {
        // Step 1: Create a hotspot user profile on MikroTik
        // We use the MAC-based approach: create a user with the client's MAC as a binding
        const hotspotUser = {
            name: username,
            password: username, // password = username for simplicity (internal use only)
            'limit-uptime': `${durationSeconds}s`,
            comment: `HS-Controller:${macAddress}`,
        };

        // Add rate limit if specified
        if (rateLimit) {
            const [rx, tx] = rateLimit.split('/');
            if (rx && tx) {
                hotspotUser['limit-bytes-in'] = 0; // No byte limit, just uptime
                hotspotUser['limit-bytes-out'] = 0;
            }
        }

        // Add the user to MikroTik hotspot
        await mikrotikCall(routerId, 'ip/hotspot/user/add', 'POST', hotspotUser);

        // Step 2: Create a host binding so the MAC is auto-authorized
        // This makes the user auto-login when their MAC is detected
        try {
            await mikrotikCall(routerId, 'ip/hotspot/host/make-binding', 'POST', {
                'mac-address': macAddress,
                server: 'all',
                type: 'bypassed',
                comment: `HS:${username}`,
            });
        } catch (bindErr) {
            // If binding fails, try adding as a regular IP binding
            console.warn('[HotspotController] make-binding failed, trying ip/hotspot/ip-binding:', bindErr.message);
            try {
                await mikrotikCall(routerId, 'ip/hotspot/ip-binding/add', 'POST', {
                    'mac-address': macAddress,
                    server: 'all',
                    type: 'bypassed',
                    comment: `HS:${username}`,
                });
            } catch (ipBindErr) {
                console.warn('[HotspotController] ip-binding also failed:', ipBindErr.message);
                // Continue anyway - the user is still created and can authenticate
            }
        }

        // Step 3: Create session record in DB
        const session = await db.createSession(database, {
            routerId,
            username,
            macAddress,
            ipAddress,
            durationSeconds,
            amountPaid: 0,
            paymentMethod: 'coinslot',
        });

        console.log(`[HotspotController] Authorized ${macAddress} for ${durationSeconds}s (user: ${username})`);
        return session;

    } catch (err) {
        console.error(`[HotspotController] Failed to authorize ${macAddress}:`, err.message);
        return null;
    }
}

/**
 * Authorize a device using a voucher code.
 * @param {string} routerId
 * @param {string} macAddress
 * @param {string} ipAddress
 * @param {object} voucher - The voucher record from DB
 * @param {import('sqlite').Database} database
 * @returns {Promise<object|null>} Session or null
 */
async function authorizeWithVoucher(routerId, macAddress, ipAddress, voucher, database) {
    const username = `vch_${voucher.code}_${Date.now().toString(36)}`;

    try {
        // Create hotspot user with uptime limit
        const hotspotUser = {
            name: username,
            password: username,
            'limit-uptime': `${voucher.duration_seconds}s`,
            comment: `HS-Voucher:${voucher.code}:${macAddress}`,
        };

        await mikrotikCall(routerId, 'ip/hotspot/user/add', 'POST', hotspotUser);

        // Create host binding for auto-login
        try {
            await mikrotikCall(routerId, 'ip/hotspot/host/make-binding', 'POST', {
                'mac-address': macAddress,
                server: 'all',
                type: 'bypassed',
                comment: `HS:${username}`,
            });
        } catch (bindErr) {
            console.warn('[HotspotController] Voucher binding failed, trying ip-binding:', bindErr.message);
            try {
                await mikrotikCall(routerId, 'ip/hotspot/ip-binding/add', 'POST', {
                    'mac-address': macAddress,
                    server: 'all',
                    type: 'bypassed',
                    comment: `HS:${username}`,
                });
            } catch (e) { /* continue */ }
        }

        // Activate the voucher
        await db.activateVoucher(database, voucher.id, macAddress, ipAddress);

        // Create session
        const session = await db.createSession(database, {
            voucherId: voucher.id,
            routerId,
            username,
            macAddress,
            ipAddress,
            durationSeconds: voucher.duration_seconds,
            amountPaid: voucher.price,
            paymentMethod: 'voucher',
        });

        console.log(`[HotspotController] Voucher ${voucher.code} activated for ${macAddress}`);
        return session;

    } catch (err) {
        console.error(`[HotspotController] Voucher auth failed for ${voucher.code}:`, err.message);
        return null;
    }
}

/**
 * Deauthorize a device - remove hotspot user and binding from MikroTik.
 * @param {string} routerId
 * @param {string} username - The hotspot username to remove
 * @param {import('sqlite').Database} database
 */
async function deauthorizeDevice(routerId, username, database) {
    try {
        // Find and remove the hotspot user by name
        const users = await mikrotikCall(routerId, 'ip/hotspot/user/print', 'GET');
        const userList = Array.isArray(users) ? users : [];
        const targetUser = userList.find(u => u.name === username);

        if (targetUser) {
            await mikrotikCall(routerId, 'ip/hotspot/user/remove', 'POST', { '.id': targetUser['.id'] || targetUser.id });
        }

        // Remove any host bindings for this user
        try {
            const bindings = await mikrotikCall(routerId, 'ip/hotspot/host/print', 'GET');
            const bindingList = Array.isArray(bindings) ? bindings : [];
            const targetBinding = bindingList.find(b => (b.comment || '').includes(username));
            if (targetBinding) {
                await mikrotikCall(routerId, 'ip/hotspot/host/remove-binding', 'POST', { '.id': targetBinding['.id'] || targetBinding.id });
            }
        } catch (bindErr) {
            // Try ip-binding removal as fallback
            try {
                const ipBindings = await mikrotikCall(routerId, 'ip/hotspot/ip-binding/print', 'GET');
                const ipList = Array.isArray(ipBindings) ? ipBindings : [];
                const targetIpBinding = ipList.find(b => (b.comment || '').includes(username));
                if (targetIpBinding) {
                    await mikrotikCall(routerId, 'ip/hotspot/ip-binding/remove', 'POST', { '.id': targetIpBinding['.id'] || targetIpBinding.id });
                }
            } catch (e) { /* continue */ }
        }

        console.log(`[HotspotController] Deauthorized user: ${username}`);
        return true;

    } catch (err) {
        console.error(`[HotspotController] Failed to deauthorize ${username}:`, err.message);
        return false;
    }
}

/**
 * Extend an existing session on MikroTik and in the DB.
 * @param {string} routerId
 * @param {object} existingSession - The current session record
 * @param {number} additionalSeconds
 * @param {import('sqlite').Database} database
 */
async function extendDeviceSession(routerId, existingSession, additionalSeconds, database) {
    try {
        // Calculate new total uptime from session start
        const currentExpiry = new Date(existingSession.expires_at).getTime();
        const newExpiry = new Date(currentExpiry + additionalSeconds * 1000);
        const totalFromStart = Math.floor((newExpiry.getTime() - new Date(existingSession.started_at).getTime()) / 1000);

        // Update MikroTik user's limit-uptime
        const users = await mikrotikCall(routerId, 'ip/hotspot/user/print', 'GET');
        const userList = Array.isArray(users) ? users : [];
        const targetUser = userList.find(u => u.name === existingSession.username);

        if (targetUser) {
            await mikrotikCall(routerId, 'ip/hotspot/user/set', 'POST', {
                '.id': targetUser['.id'] || targetUser.id,
                'limit-uptime': `${totalFromStart}s`,
            });
        }

        // Update DB session
        const updatedSession = await db.extendSession(database, existingSession.id, additionalSeconds);
        console.log(`[HotspotController] Extended session for ${existingSession.mac_address} by ${additionalSeconds}s`);
        return updatedSession;

    } catch (err) {
        console.error(`[HotspotController] Failed to extend session for ${existingSession.mac_address}:`, err.message);
        return null;
    }
}

/**
 * Kick an active session - remove from MikroTik and update DB.
 * @param {string} sessionId
 * @param {import('sqlite').Database} database
 */
async function kickSession(sessionId, database) {
    const session = await db.getSession(database, sessionId);
    if (!session) return false;

    // Remove from MikroTik
    await deauthorizeDevice(session.router_id, session.username, database);

    // Update DB
    await db.kickSession(database, sessionId);

    // Expire the voucher if linked
    if (session.voucher_id) {
        await db.useVoucher(database, session.voucher_id);
    }

    console.log(`[HotspotController] Kicked session ${sessionId} for ${session.mac_address}`);
    return true;
}

/**
 * Check for expired sessions and clean them up on MikroTik.
 * Call this periodically (every 30s).
 * @param {import('sqlite').Database} database
 */
async function checkExpiredSessions(database) {
    try {
        const expired = await db.getExpiredActiveSessions(database);
        if (!expired || expired.length === 0) return;

        for (const session of expired) {
            try {
                // Remove from MikroTik
                await deauthorizeDevice(session.router_id, session.username, database);
                
                // Mark as expired in DB
                await db.expireSession(database, session.id);

                // Expire the voucher if linked
                if (session.voucher_id) {
                    await db.useVoucher(database, session.voucher_id);
                }

                console.log(`[HotspotController] Expired session ${session.id} for ${session.mac_address}`);
            } catch (err) {
                console.error(`[HotspotController] Error expiring session ${session.id}:`, err.message);
            }
        }
    } catch (err) {
        console.error('[HotspotController] Error in expiry checker:', err.message);
    }
}

/**
 * Start the periodic session expiry checker.
 * @param {import('sqlite').Database} database
 * @param {number} intervalMs - Check interval (default 30000ms)
 * @returns {NodeJS.Timeout} The interval handle
 */
function startExpiryChecker(database, intervalMs = 30000) {
    console.log(`[HotspotController] Session expiry checker started (${intervalMs}ms interval)`);
    // Run immediately on start
    checkExpiredSessions(database);
    // Then run periodically
    return setInterval(() => checkExpiredSessions(database), intervalMs);
}

/**
 * Mark ESP devices as offline if they haven't sent a heartbeat recently.
 * @param {import('sqlite').Database} database
 * @param {number} timeoutMs - Time after which a device is considered offline (default 120000ms)
 */
async function checkEspDeviceHeartbeats(database, timeoutMs = 120000) {
    const cutoff = new Date(Date.now() - timeoutMs).toISOString();
    await database.run(
        "UPDATE esp_devices SET status = 'offline' WHERE status = 'online' AND (last_seen IS NULL OR last_seen < ?)",
        [cutoff]
    );
}

module.exports = {
    mikrotikCall,
    authorizeDevice,
    authorizeWithVoucher,
    deauthorizeDevice,
    extendDeviceSession,
    kickSession,
    checkExpiredSessions,
    startExpiryChecker,
    checkEspDeviceHeartbeats,
};
