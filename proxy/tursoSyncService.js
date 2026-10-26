const { TursoError, normalizeConfig, createConfigStore, publicError } = require('./tursoConfig');

const TABLES = Object.freeze([
    'routers', 'billing_plans', 'dhcp_billing_plans', 'customers', 'dhcp_clients',
    'client_users', 'client_invoices', 'sales_records', 'manual_payment_requests',
    'paymongo_sessions', 'xendit_sessions', 'billing_ledger', 'client_balances',
    'expenses', 'expense_categories'
]);
const REMOTE_TABLE = 'mbm_sync_rows_v1';
const PAGE_SIZE = 100;
const quote = name => `"${name.replace(/"/g, '""')}"`;
const REMOTE_SCHEMA = `CREATE TABLE IF NOT EXISTS ${REMOTE_TABLE} (
    source_table TEXT NOT NULL, row_id TEXT NOT NULL, payload TEXT,
    deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0, 1)),
    updated_at TEXT NOT NULL, PRIMARY KEY(source_table, row_id)
)`;

class TursoSyncService {
    constructor({ db, configPath, store, clientFactory, intervalMs = 60000, timeoutMs = 15000 }) {
        this.db = db;
        this.store = store || createConfigStore(configPath);
        this.clientFactory = clientFactory || (options => require('@libsql/client/http').createClient(options));
        this.intervalMs = intervalMs;
        this.timeoutMs = timeoutMs;
        this.columns = new Map();
        this.stopped = true;
        this.recovered = false;
        this.ready = false;
        this.failures = 0;
        this.state = { status: 'disabled', lastSuccess: null, lastAttempt: null, error: null, restored: 0, conflicts: 0 };
        try {
            this.config = this.store.load();
        } catch (error) {
            this.state.status = 'failed';
            this.state.error = publicError(error);
        }
    }

    async initialize() {
        try {
            await this.initializeTracking();
        } catch (_) {
            this.state.status = 'failed';
            this.state.error = 'Local Turso change tracking could not be initialized. Local SQLite remains available.';
        }
        this.start();
    }

    async initializeTracking() {
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS _turso_changes (
                source_table TEXT NOT NULL, row_id TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1, synced_version INTEGER NOT NULL DEFAULT 0,
                deleted INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(source_table, row_id)
            );
            CREATE TABLE IF NOT EXISTS _turso_meta (key TEXT PRIMARY KEY, value TEXT);
            CREATE INDEX IF NOT EXISTS _turso_pending ON _turso_changes(source_table, synced_version, version);
        `);
        for (const table of TABLES) {
            const columns = await this.db.all(`PRAGMA table_info(${quote(table)})`);
            if (!columns.some(column => column.name === 'id' && column.pk)) {
                throw new TursoError('A required operational table is missing its primary key. Update the panel schema.', 503);
            }
            this.columns.set(table, columns);
            const change = (ref, deleted, condition = '') => `
                INSERT INTO _turso_changes (source_table, row_id, version, synced_version, deleted)
                SELECT '${table}', CAST(${ref}.id AS TEXT), 1, 0, ${deleted} ${condition}
                ON CONFLICT(source_table, row_id) DO UPDATE SET
                    version = version + 1, deleted = excluded.deleted;`;
            await this.db.exec(`
                CREATE TRIGGER IF NOT EXISTS ${quote(`_turso_${table}_insert`)} AFTER INSERT ON ${quote(table)}
                BEGIN ${change('NEW', 0)} END;
                CREATE TRIGGER IF NOT EXISTS ${quote(`_turso_${table}_update`)} AFTER UPDATE ON ${quote(table)}
                BEGIN ${change('OLD', 1, 'WHERE OLD.id IS NOT NEW.id')} ${change('NEW', 0)} END;
                CREATE TRIGGER IF NOT EXISTS ${quote(`_turso_${table}_delete`)} AFTER DELETE ON ${quote(table)}
                BEGIN ${change('OLD', 1)} END;
                INSERT OR IGNORE INTO _turso_changes(source_table, row_id)
                    SELECT '${table}', CAST(id AS TEXT) FROM ${quote(table)} WHERE id IS NOT NULL;
            `);
        }
        this.ready = true;
    }

    start() {
        if (this.closing) return;
        this.stopped = false;
        if (this.config?.enabled) this.schedule(0);
    }

    schedule(delay) {
        clearTimeout(this.timer);
        if (this.stopped || !this.config?.enabled) return;
        this.timer = setTimeout(() => { void this.sync(); }, delay);
        this.timer.unref?.();
    }

    async stop() {
        this.stopped = true;
        clearTimeout(this.timer);
        this.activeRequest?.abort();
        await this.flight;
    }

    async status() {
        const pending = this.ready ? await this.db.get(
            'SELECT COUNT(*) AS count FROM _turso_changes WHERE version > synced_version'
        ) : { count: 0 };
        return {
            ...this.state,
            enabled: Boolean(this.config?.enabled), configured: Boolean(this.config),
            url: this.config?.url || '', databaseName: this.config?.databaseName || '',
            hasAuthToken: Boolean(this.config?.authToken), pending: pending.count,
            tables: TABLES
        };
    }

    async remote(config, action) {
        const controller = new AbortController();
        this.activeRequest = controller;
        const client = this.clientFactory({
            url: config.url, authToken: config.authToken,
            fetch: (input, init) => fetch(input, { ...init, signal: controller.signal, redirect: 'error' })
        });
        let timer;
        const cancelled = new Promise((_, reject) => {
            controller.signal.addEventListener('abort', () => reject(
                new TursoError('Turso request timed out or was stopped. Pending changes are retained.', 503)
            ), { once: true });
            timer = setTimeout(() => controller.abort(), this.timeoutMs);
        });
        try {
            return await Promise.race([action(client), cancelled]);
        } finally {
            clearTimeout(timer);
            client.close();
            if (this.activeRequest === controller) this.activeRequest = null;
        }
    }

    controlled(action) {
        if (this.controlFlight || this.closing) {
            return Promise.reject(new TursoError('Turso settings are busy. Try again shortly.', 409));
        }
        this.controlFlight = (async () => {
            await this.stop();
            if (this.closing) throw new TursoError('The panel is shutting down.', 503);
            return action();
        })().finally(() => {
            this.controlFlight = null;
            this.start();
        });
        return this.controlFlight;
    }

    async shutdown() {
        this.closing = true;
        await this.stop();
        await this.controlFlight?.catch(() => {});
    }

    test(input) {
        return this.controlled(async () => {
            const config = normalizeConfig(input, this.config || {});
            await this.remote(config, client => client.execute('SELECT 1 AS connected'));
            return { message: 'Connection verified (read access). Save to enable backup and verify write access.' };
        });
    }

    configure(input) {
        return this.controlled(async () => {
            const config = normalizeConfig(input, this.config || {});
            await this.remote(config, client => client.execute('SELECT 1 AS connected'));
            await this.store.save(config);
            this.config = config;
            this.recovered = false;
            this.failures = 0;
            this.state = { status: 'connecting', lastSuccess: null, lastAttempt: null, error: null, restored: 0, conflicts: 0 };
            return this.status();
        });
    }

    disable() {
        return this.controlled(async () => {
            if (this.config) {
                const disabled = { ...this.config, enabled: false };
                await this.store.save(disabled);
                this.config = disabled;
            }
            this.state.status = 'disabled';
            this.state.error = null;
            return this.status();
        });
    }

    sync() {
        if (this.flight) return this.flight;
        if (this.stopped || !this.config?.enabled) return Promise.resolve();
        clearTimeout(this.timer);
        this.flight = this.run().catch(error => {
            if (!this.stopped) {
                this.failures++;
                this.state.status = 'failed';
                this.state.error = publicError(error);
            }
        }).finally(() => {
            this.flight = null;
            this.schedule(this.failures ? Math.min(300000, 5000 * 2 ** Math.min(this.failures - 1, 6)) : this.intervalMs);
        });
        return this.flight;
    }

    checkRunning() {
        if (this.stopped) throw new TursoError('Turso synchronization is stopped.', 503);
    }

    async run() {
        this.state.status = this.recovered ? 'syncing' : 'recovering';
        this.state.lastAttempt = new Date().toISOString();
        this.state.error = null;
        if (!this.ready) await this.initializeTracking();
        const target = await this.db.get("SELECT value FROM _turso_meta WHERE key = 'target'");
        if (target?.value !== this.config.url) {
            await this.db.run('UPDATE _turso_changes SET synced_version = 0');
            await this.db.run("INSERT INTO _turso_meta(key, value) VALUES ('target', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", this.config.url);
            this.recovered = false;
        }
        // Also detect implicit deletes caused by INSERT OR REPLACE on a different unique key.
        for (const table of TABLES) {
            this.checkRunning();
            await this.db.run(`UPDATE _turso_changes SET deleted = 1, version = version + 1
                WHERE source_table = ? AND deleted = 0 AND NOT EXISTS
                (SELECT 1 FROM ${quote(table)} WHERE id = _turso_changes.row_id)`, table);
        }
        this.checkRunning();
        await this.remote(this.config, client => client.execute(REMOTE_SCHEMA));
        if (!this.recovered) {
            this.state.restored = 0;
            this.state.conflicts = 0;
            await this.recover();
            this.recovered = true;
        }
        await this.upload();
        this.checkRunning();
        this.failures = 0;
        this.state.status = this.state.conflicts ? 'warning' : 'active';
        this.state.lastSuccess = new Date().toISOString();
    }

    validatePayload(table, row) {
        let envelope;
        try { envelope = JSON.parse(row.payload); } catch (_) { /* Checked below. */ }
        const data = envelope?.data;
        const names = new Set(this.columns.get(table).map(column => column.name));
        if (envelope?.schemaVersion !== 1 || !data || Array.isArray(data) || typeof data !== 'object' ||
            !Object.hasOwn(data, 'id') || String(data.id) !== row.row_id ||
            Object.entries(data).some(([key, value]) => !names.has(key) ||
                !(value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))))) {
            throw new TursoError('Cloud backup schema is incompatible or invalid. Update the panel before restoring.', 503);
        }
        return data;
    }

    async recover() {
        for (const table of TABLES) {
            let cursor = '';
            while (true) {
                this.checkRunning();
                const result = await this.remote(this.config, client => client.execute({
                    sql: `SELECT row_id, payload, deleted FROM ${REMOTE_TABLE}
                        WHERE source_table = ? AND row_id > ? ORDER BY row_id LIMIT ?`,
                    args: [table, cursor, PAGE_SIZE]
                }));
                for (const row of result.rows) {
                    this.checkRunning();
                    if (typeof row.row_id !== 'string' || !row.row_id || ![0, 1].includes(row.deleted)) {
                        throw new TursoError('Invalid cloud backup metadata.', 503);
                    }
                    cursor = row.row_id;
                    if (row.deleted === 1) continue;
                    const data = this.validatePayload(table, row);
                    const entries = Object.entries(data);
                    // Both predicates run atomically with the insert: concurrent local edits/deletes win.
                    try {
                        const inserted = await this.db.run(`INSERT INTO ${quote(table)} (${entries.map(([key]) => quote(key)).join(',')})
                            SELECT ${entries.map(() => '?').join(',')} WHERE NOT EXISTS
                            (SELECT 1 FROM ${quote(table)} WHERE id = ?) AND NOT EXISTS
                            (SELECT 1 FROM _turso_changes WHERE source_table = ? AND row_id = ?)`,
                        [...entries.map(([, value]) => value), data.id, table, row.row_id]);
                        this.state.restored += inserted.changes;
                    } catch (error) {
                        if (error.code === 'SQLITE_CONSTRAINT' && /UNIQUE constraint failed/.test(error.message)) {
                            this.state.conflicts++;
                        } else {
                            throw new TursoError('A cloud record could not be restored into the local schema. Local data was not overwritten.', 503);
                        }
                    }
                }
                if (result.rows.length < PAGE_SIZE) break;
            }
        }
    }

    async upload() {
        // Bound each pass even if local writers continuously update records.
        for (const table of TABLES) {
            let cursor = '';
            while (true) {
                this.checkRunning();
                // Read the payload and its change version in ONE SQLite snapshot.
                const rows = await this.db.all(`SELECT t.*, c.row_id AS __key, c.version AS __version, c.deleted AS __deleted
                    FROM _turso_changes c LEFT JOIN ${quote(table)} t ON t.id = c.row_id
                    WHERE c.source_table = ? AND c.version > c.synced_version AND c.row_id > ?
                    ORDER BY c.row_id LIMIT ?`, [table, cursor, PAGE_SIZE]);
                if (!rows.length) break;
                const statements = rows.map(row => {
                    const { __key, __version, __deleted, ...data } = row;
                    return {
                        sql: `INSERT INTO ${REMOTE_TABLE}(source_table, row_id, payload, deleted, updated_at)
                            VALUES (?, ?, ?, ?, ?) ON CONFLICT(source_table, row_id) DO UPDATE SET
                            payload = excluded.payload, deleted = excluded.deleted, updated_at = excluded.updated_at`,
                        args: [table, __key, __deleted ? null : JSON.stringify({ schemaVersion: 1, data }), __deleted, new Date().toISOString()]
                    };
                });
                await this.remote(this.config, client => client.batch(statements, 'write'));
                for (const row of rows) {
                    this.checkRunning();
                    await this.db.run(`UPDATE _turso_changes SET synced_version = ?
                        WHERE source_table = ? AND row_id = ? AND version = ?`,
                    [row.__version, table, row.__key, row.__version]);
                }
                cursor = rows[rows.length - 1].__key;
            }
        }
    }
}

module.exports = { TursoSyncService, TABLES, REMOTE_TABLE };
