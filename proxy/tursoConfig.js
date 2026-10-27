const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class TursoError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

function normalizeConfig(input, previous = {}) {
    if (!input || typeof input.url !== 'string') throw new TursoError('Enter a Turso URL or host.');
    const raw = input.url.trim();
    let url;
    try {
        url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    } catch (_) {
        throw new TursoError('Enter a valid Turso Cloud URL.');
    }
    // Restrict server-side credential forwarding to official Turso Cloud endpoints.
    // Turso hostnames can have multiple subdomain levels: {db}-{org}.{region}.turso.io
    if (!['https:', 'libsql:'].includes(url.protocol) ||
        !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.turso\.io$/.test(url.hostname) ||
        url.username || url.password || url.port || (url.pathname && url.pathname !== '/') ||
        url.search || url.hash || /:\d+(?:\/|$)/.test(raw)) {
        throw new TursoError('Use an HTTPS or libsql Turso Cloud host (*.turso.io) without a port, path, or query.');
    }
    const normalizedUrl = `https://${url.hostname}`;
    const databaseName = typeof input.databaseName === 'string' ? input.databaseName.trim() : '';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(databaseName)) {
        throw new TursoError('Enter a database name using letters, numbers, hyphens, or underscores.');
    }
    if (input.authToken !== undefined && typeof input.authToken !== 'string') {
        throw new TursoError('Auth Token must be text.');
    }
    const authToken = input.authToken?.trim() || (previous.url === normalizedUrl ? previous.authToken : '');
    if (!authToken || authToken.length > 16384 || /\s/.test(authToken)) {
        throw new TursoError('Enter an Auth Token. A new endpoint requires its own token.');
    }
    return { version: 1, url: normalizedUrl, databaseName, authToken, enabled: true };
}

function createConfigStore(filePath) {
    return {
        load() {
            try {
                const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (parsed.version !== 1 || typeof parsed.enabled !== 'boolean') throw new Error('Invalid config');
                return { ...normalizeConfig(parsed), enabled: parsed.enabled };
            } catch (error) {
                if (error.code === 'ENOENT') return null;
                throw new TursoError('Saved Turso configuration is invalid or unreadable. Re-enter the credentials.', 503);
            }
        },
        async save(config) {
            const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
            try {
                await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
                const handle = await fs.promises.open(temporary, 'wx', 0o600);
                try {
                    await handle.writeFile(JSON.stringify(config, null, 2));
                    await handle.sync();
                } finally {
                    await handle.close();
                }
                await fs.promises.rename(temporary, filePath);
                await fs.promises.chmod(filePath, 0o600);
            } catch (_) {
                throw new TursoError('Could not save Turso configuration. Check server file permissions.', 500);
            } finally {
                await fs.promises.unlink(temporary).catch(() => {});
            }
        }
    };
}

function publicError(error) {
    // Driver errors may contain endpoint details, SQL, tokens, or customer data.
    return error instanceof TursoError ? error.message :
        'Turso synchronization failed. Check connectivity, token read/write access, and compatible panel versions.';
}

module.exports = { TursoError, normalizeConfig, createConfigStore, publicError };
