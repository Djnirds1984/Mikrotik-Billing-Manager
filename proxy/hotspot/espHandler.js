// ============================================================
// Hotspot Controller - ESP Device Handler (Isolated)
// ============================================================

const db = require('./db');

/**
 * Validate an ESP device by its API key.
 * @param {string} apiKey
 * @param {import('sqlite').Database} database
 * @returns {Promise<object|null>} The device record or null
 */
async function validateEspApiKey(apiKey, database) {
    if (!apiKey) return null;
    return db.getEspDeviceByApiKey(database, apiKey);
}

/**
 * Process a coin insertion event from an ESP device.
 * Determines the best plan for the amount, then authorizes the device.
 * 
 * @param {object} device - The ESP device record
 * @param {string} macAddress - Client MAC address
 * @param {string} ipAddress - Client IP address
 * @param {number} coinPulses - Number of coin pulses detected
 * @param {import('sqlite').Database} database
 * @param {object} sessionManager - The session manager module
 * @returns {Promise<object>} Result with success, message, duration, plan info
 */
async function processCoinInsert(device, macAddress, ipAddress, coinPulses, database, sessionManager) {
    const amount = coinPulses * device.coin_value;

    // Find the best matching plan (highest duration that fits the amount)
    const plans = await db.getHotspotPlans(database, device.router_id);
    if (!plans || plans.length === 0) {
        return { success: false, message: 'No hotspot plans configured for this router.' };
    }

    // Sort plans by price ascending and find the best match (highest price <= amount)
    const affordablePlans = plans.filter(p => p.price <= amount).sort((a, b) => b.price - a.price);
    
    let selectedPlan;
    if (affordablePlans.length > 0) {
        selectedPlan = affordablePlans[0]; // Best (most expensive) affordable plan
    } else {
        return { success: false, message: `Amount ${amount} is not enough for any plan. Minimum: ${plans[0].price}` };
    }

    // Check if this MAC already has an active session - extend it
    const existingSession = await db.getActiveSessionByMac(database, device.router_id, macAddress);
    
    let session;
    if (existingSession) {
        // Extend existing session
        session = await sessionManager.extendDeviceSession(device.router_id, existingSession, selectedPlan.duration_seconds, database);
        if (!session) {
            return { success: false, message: 'Failed to extend existing session on MikroTik.' };
        }
    } else {
        // Create new session
        const username = `hs_${macAddress.replace(/:/g, '')}_${Date.now().toString(36)}`;
        session = await sessionManager.authorizeDevice(
            device.router_id,
            macAddress,
            ipAddress,
            selectedPlan.duration_seconds,
            selectedPlan.rate_limit,
            username,
            selectedPlan.shared_users,
            database
        );
        if (!session) {
            return { success: false, message: 'Failed to authorize device on MikroTik.' };
        }
    }

    // Log the transaction
    const txn = await db.createCoinslotTransaction(database, {
        espDeviceId: device.id,
        routerId: device.router_id,
        macAddress,
        ipAddress,
        coinsInserted: coinPulses,
        amount,
        durationSeconds: selectedPlan.duration_seconds,
        sessionId: session.id,
    });

    // Update session amount_paid
    // (accumulate if extending)

    return {
        success: true,
        message: `Granted ${formatDuration(selectedPlan.duration_seconds)} (${selectedPlan.name})`,
        durationSeconds: selectedPlan.duration_seconds,
        expiresAt: session.expiresAt || session.expires_at,
        planName: selectedPlan.name,
        transactionId: txn.id,
    };
}

/**
 * Format seconds into human-readable duration string.
 */
function formatDuration(seconds) {
    if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d`;
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h`;
    if (seconds >= 60) return `${Math.floor(seconds / 60)}min`;
    return `${seconds}s`;
}

module.exports = { validateEspApiKey, processCoinInsert };
