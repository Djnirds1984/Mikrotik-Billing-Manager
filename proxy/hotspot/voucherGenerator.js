// ============================================================
// Hotspot Controller - Voucher Code Generator (Isolated)
// ============================================================

const crypto = require('crypto');

// Unambiguous characters: no 0/O, 1/I/l
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Generate a random voucher code.
 * @param {number} length - Length of the code (default 6)
 * @returns {string}
 */
function generateCode(length = 6) {
    let code = '';
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
        code += CHARSET[bytes[i] % CHARSET.length];
    }
    return code;
}

/**
 * Generate a batch of unique voucher codes.
 * @param {number} count - Number of codes to generate (1-500)
 * @param {object} plan - Plan data with durationSeconds, rateLimit, price
 * @param {string} routerId
 * @param {string} batchId
 * @param {import('sqlite').Database} db
 * @returns {Promise<Array>} Array of voucher objects ready for DB insert
 */
async function generateBatch(count, plan, routerId, batchId, db) {
    const maxAttempts = count * 3;
    const codes = new Set();
    let attempts = 0;

    while (codes.size < count && attempts < maxAttempts) {
        codes.add(generateCode(6));
        attempts++;
    }

    if (codes.size < count) {
        throw new Error(`Could not generate ${count} unique codes after ${maxAttempts} attempts`);
    }

    const vouchers = [];
    for (const code of codes) {
        vouchers.push({
            batchId,
            routerId,
            code,
            durationSeconds: plan.durationSeconds,
            rateLimit: plan.rateLimit || null,
            price: plan.price,
        });
    }

    // Insert into DB
    const now = new Date().toISOString();
    const stmt = await db.prepare(
        'INSERT INTO hotspot_vouchers (id, batch_id, router_id, code, duration_seconds, rate_limit, price, status, sold_via, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const v of vouchers) {
        const id = `vch_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        await stmt.run([id, v.batchId, v.routerId, v.code, v.durationSeconds, v.rateLimit, v.price, 'available', 'manual', now]);
    }
    await stmt.finalize();

    return vouchers;
}

module.exports = { generateCode, generateBatch };
