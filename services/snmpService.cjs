/**
 * SNMP Monitoring Service for OLT devices
 * Supports Huawei, ZTE, BDCOM, VSOL, CDATA, FiberHome, Nokia, Calix, Dasan, and generic OLTs
 * 
 * Uses net-snmp package. If not installed, gracefully degrades to no-op.
 * Install with: npm install net-snmp (in proxy/ directory)
 */

let snmp = null;
try {
    snmp = require('net-snmp');
} catch (e) {
    console.warn('[SNMP] net-snmp package not installed. SNMP monitoring disabled. Install with: npm install net-snmp');
}

// ─── Standard MIBs (shared fallback for most brands) ───
const STANDARD = {
    // HOST-RESOURCES-MIB (RFC 2790) — works on most SNMP-enabled devices
    hrProcessorLoad: '1.3.6.1.2.1.25.3.3.1.2',       // hrProcessorLoad (CPU %)
    hrMemoryUsed: '1.3.6.1.2.1.25.2.3.1.6',           // hrStorageUsed (in allocation units)
    hrMemoryAlloc: '1.3.6.1.2.1.25.2.3.1.4',          // hrStorageAllocationUnits
    hrMemoryTotal: '1.3.6.1.2.1.25.2.3.1.5',          // hrStorageSize
    // IF-MIB for interface monitoring
    ifOperStatus: '1.3.6.1.2.1.2.2.1.8',
    ifInOctets: '1.3.6.1.2.1.2.2.1.10',
    ifOutOctets: '1.3.6.1.2.1.2.2.1.16',
};

// SNMP OIDs by brand for GPON monitoring
const OIDS = {
    huawei: {
        // System (Huawei private MIBs)
        cpuUsage: '1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5.67108864',
        memoryUsage: '1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7.67108864',
        temperature: '1.3.6.1.4.1.2011.5.25.31.1.1.1.1.11.67108864',
        // GPON
        gponOntOnline: '1.3.6.1.4.1.2011.6.174.1.1.1',    // ontOnlineTable
        gponRxPower: '1.3.6.1.4.1.2011.6.174.1.1.3',      // Rx optical power
        gponTxPower: '1.3.6.1.4.1.2011.6.174.1.1.4',      // Tx optical power
    },
    zte: {
        cpuUsage: '1.3.6.1.4.1.3902.3.1.1.1.1.0',
        memoryUsage: '1.3.6.1.4.1.3902.3.1.1.2.1.0',
        temperature: '1.3.6.1.4.1.3902.3.1.1.3.1.0',
        gponOntOnline: '1.3.6.1.4.1.3902.3.2.1.1.1',
        gponRxPower: '1.3.6.1.4.1.3902.3.2.1.3.1',
        gponTxPower: '1.3.6.1.4.1.3902.3.2.1.4.1',
    },
    bdcom: {
        cpuUsage: '1.3.6.1.4.1.3320.1.1.1.1.0',
        memoryUsage: '1.3.6.1.4.1.3320.1.1.2.1.0',
        temperature: '1.3.6.1.4.1.3320.1.1.3.1.0',
        gponOntOnline: '1.3.6.1.4.1.3320.2.1.1.1.1',
        gponRxPower: '1.3.6.1.4.1.3320.2.1.1.3.1',
        gponTxPower: '1.3.6.1.4.1.3320.2.1.1.4.1',
    },
    vsol: {
        // VSOL V1600D / V1600E series (Enterprise PEN: 37538)
        cpuUsage: '1.3.6.1.4.1.37538.1.1.1.1.5.0',
        memoryUsage: '1.3.6.1.4.1.37538.1.1.1.1.7.0',
        temperature: '1.3.6.1.4.1.37538.1.1.1.1.11.0',
        gponOntOnline: '1.3.6.1.4.1.37538.2.1.1.1',
        gponRxPower: '1.3.6.1.4.1.37538.2.1.3.1',
        gponTxPower: '1.3.6.1.4.1.37538.2.1.4.1',
    },
    cdata: {
        // CDATA CDT-OLS series (Enterprise PEN: 49839)
        cpuUsage: '1.3.6.1.4.1.49839.1.1.1.1.5.0',
        memoryUsage: '1.3.6.1.4.1.49839.1.1.1.1.7.0',
        temperature: '1.3.6.1.4.1.49839.1.1.1.1.11.0',
        gponOntOnline: '1.3.6.1.4.1.49839.2.1.1.1',
        gponRxPower: '1.3.6.1.4.1.49839.2.1.3.1',
        gponTxPower: '1.3.6.1.4.1.49839.2.1.4.1',
    },
    fiberhome: {
        // FiberHome AN5516 / HG6800 series (Enterprise PEN: 5893)
        cpuUsage: '1.3.6.1.4.1.5893.1.1.1.1.5.0',
        memoryUsage: '1.3.6.1.4.1.5893.1.1.1.1.7.0',
        temperature: '1.3.6.1.4.1.5893.1.1.1.1.11.0',
        gponOntOnline: '1.3.6.1.4.1.5893.2.1.1.1',
        gponRxPower: '1.3.6.1.4.1.5893.2.1.3.1',
        gponTxPower: '1.3.6.1.4.1.5893.2.1.4.1',
    },
    nokia: {
        // Nokia (Alcatel-Lucent) ISAM FX-8 / FX-16 (Enterprise PEN: 637)
        cpuUsage: '1.3.6.1.4.1.637.64.20.1.1.1.5.0',
        memoryUsage: '1.3.6.1.4.1.637.64.20.1.1.1.7.0',
        temperature: '1.3.6.1.4.1.637.64.20.1.1.1.11.0',
        gponOntOnline: '1.3.6.1.4.1.637.64.20.2.1.1.1',
        gponRxPower: '1.3.6.1.4.1.637.64.20.2.1.3.1',
        gponTxPower: '1.3.6.1.4.1.637.64.20.2.1.4.1',
    },
    calix: {
        // Calix E7-2 / E7-20 (Enterprise PEN: 6321)
        cpuUsage: '1.3.6.1.4.1.6321.1.1.1.1.5.0',
        memoryUsage: '1.3.6.1.4.1.6321.1.1.1.1.7.0',
        temperature: '1.3.6.1.4.1.6321.1.1.1.1.11.0',
        gponOntOnline: '1.3.6.1.4.1.6321.1.2.1.1.1',
        gponRxPower: '1.3.6.1.4.1.6321.1.2.1.3.1',
        gponTxPower: '1.3.6.1.4.1.6321.1.2.1.4.1',
    },
    dasan: {
        // Dasan H660 / G7 series (Enterprise PEN: 2636 — Juniper PEN, Dasan uses 6352)
        cpuUsage: '1.3.6.1.4.1.6352.1.1.1.1.5.0',
        memoryUsage: '1.3.6.1.4.1.6352.1.1.1.1.7.0',
        temperature: '1.3.6.1.4.1.6352.1.1.1.1.11.0',
        gponOntOnline: '1.3.6.1.4.1.6352.2.1.1.1',
        gponRxPower: '1.3.6.1.4.1.6352.2.1.3.1',
        gponTxPower: '1.3.6.1.4.1.6352.2.1.4.1',
    },
    generic: {
        // Generic fallback using standard HOST-RESOURCES-MIB
        // Works with most SNMP-enabled OLTs for basic system metrics
        cpuUsage: STANDARD.hrProcessorLoad + '.1',        // hrProcessorLoad instance 1
        memoryUsage: null,                                 // Requires calculation (used/total * 100)
        temperature: null,                                 // Vendor-specific, no standard OID
        gponOntOnline: null,
        gponRxPower: null,
        gponTxPower: null,
    }
};

/**
 * Get the OID set for a given brand, with fallback chain
 */
function getOidsForBrand(brand) {
    const b = (brand || 'generic').toLowerCase().trim();
    return OIDS[b] || OIDS.generic;
}

/**
 * Create an SNMP session for an OLT
 */
function createSession(ip, community, port = 161) {
    if (!snmp) return null;
    return snmp.createSession(ip, community, { port, timeout: 5000, retries: 2 });
}

/**
 * Poll basic system metrics from an OLT
 * Returns: { cpuUsage, memoryUsage, temperature } or null
 */
async function pollSystemMetrics(equipment) {
    if (!snmp || !equipment.ip_address) return null;

    const brand = (equipment.brand || 'generic').toLowerCase().trim();
    const oids = getOidsForBrand(brand);
    const session = createSession(equipment.ip_address, equipment.snmp_community || 'public', equipment.snmp_port || 161);
    if (!session) return null;

    const metrics = {};
    const oidList = [
        { key: 'cpuUsage', oid: oids.cpuUsage, unit: '%' },
        { key: 'memoryUsage', oid: oids.memoryUsage, unit: '%' },
        { key: 'temperature', oid: oids.temperature, unit: 'C' },
    ].filter(o => o.oid);  // Skip null OIDs

    return new Promise((resolve) => {
        const oidsToFetch = oidList.map(o => o.oid).filter(Boolean);
        if (oidsToFetch.length === 0) { resolve(null); return; }

        session.get(oidsToFetch, (error, varbinds) => {
            if (error) {
                console.warn(`[SNMP] Error polling ${equipment.name}: ${error.message}`);
                resolve(null);
                return;
            }
            for (const vb of varbinds) {
                if (snmp.isVarbindError(vb)) continue;
                const match = oidList.find(o => o.oid === vb.oid);
                if (match) {
                    metrics[match.key] = { value: Number(vb.value), unit: match.unit };
                }
            }
            resolve(metrics);
        });
    });
}

/**
 * Store a monitoring reading in the database
 */
async function storeReading(db, equipmentId, metricType, metricKey, metricValue, unit) {
    try {
        await db.run(
            'INSERT INTO olt_monitor_readings (equipment_id, metric_type, metric_key, metric_value, unit) VALUES (?,?,?,?,?)',
            [equipmentId, metricType, metricKey || null, metricValue, unit || null]
        );
    } catch (e) {
        console.error(`[SNMP] Failed to store reading: ${e.message}`);
    }
}

/**
 * Run a polling cycle for a single equipment
 */
async function pollEquipment(db, equipment) {
    try {
        const metrics = await pollSystemMetrics(equipment);
        if (!metrics) return;

        for (const [key, data] of Object.entries(metrics)) {
            await storeReading(db, equipment.id, 'system', key, data.value, data.unit);
        }

        // Update equipment status based on connectivity
        if (metrics.cpuUsage !== undefined) {
            await db.run(
                "UPDATE network_equipment SET status = 'active', updated_at = datetime('now') WHERE id = ? AND status != 'maintenance'",
                [equipment.id]
            );
        }
    } catch (e) {
        console.error(`[SNMP] Polling error for ${equipment.name}: ${e.message}`);
    }
}

/**
 * Start periodic SNMP polling for all active OLTs
 * Polls every 5 minutes
 */
function startPolling(db, intervalMs = 5 * 60 * 1000) {
    if (!snmp) {
        console.log('[SNMP] Monitoring disabled (net-snmp not installed)');
        return null;
    }

    console.log(`[SNMP] Starting OLT monitoring (interval: ${intervalMs / 1000}s)`);

    const pollAll = async () => {
        try {
            const equipment = await db.all(
                "SELECT * FROM network_equipment WHERE status != 'inactive' AND ip_address IS NOT NULL AND ip_address != ''"
            );
            for (const eq of equipment) {
                await pollEquipment(db, eq);
            }
        } catch (e) {
            console.error(`[SNMP] Polling cycle error: ${e.message}`);
        }
    };

    // Initial poll after 10s delay
    setTimeout(pollAll, 10000);
    const intervalId = setInterval(pollAll, intervalMs);
    return intervalId;
}

module.exports = {
    startPolling,
    pollEquipment,
    pollSystemMetrics,
    getOidsForBrand,
    getSupportedBrands: () => Object.keys(OIDS),
    isAvailable: () => !!snmp,
};
