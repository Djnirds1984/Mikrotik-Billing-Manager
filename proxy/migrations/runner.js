const fs = require('fs');
const path = require('path');

/**
 * Database Migration Runner
 * 
 * Scans the migrations/ directory for .sql files, compares them against
 * the schema_migrations table, and applies any pending migrations in order.
 */

async function runMigrations(db) {
  console.log('[Migration] Checking for pending migrations...');

  // Create the schema_migrations tracking table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT UNIQUE NOT NULL,
      applied_at TEXT NOT NULL,
      description TEXT
    );
  `);

  // Get list of migration files
  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.log('[Migration] No migrations directory found, skipping.');
    return { applied: [], pending: [] };
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort(); // Sort alphabetically (e.g., 001_..., 002_...)

  if (files.length === 0) {
    console.log('[Migration] No migration files found.');
    return { applied: [], pending: [] };
  }

  // Get already-applied migrations
  const applied = await db.all('SELECT version FROM schema_migrations ORDER BY version');
  const appliedVersions = new Set(applied.map(r => r.version));

  const appliedNow = [];
  const pending = [];

  for (const file of files) {
    // Extract version from filename: "001_v2.0.0_init.sql" -> "2.0.0"
    const versionMatch = file.match(/^\d+_(v[\d.]+(?:-\w+)?)/);
    if (!versionMatch) {
      console.warn(`[Migration] Skipping file with invalid name format: ${file}`);
      continue;
    }
    const version = versionMatch[1];

    if (appliedVersions.has(version)) {
      continue; // Already applied
    }

    pending.push(file);
  }

  if (pending.length === 0) {
    console.log('[Migration] Database is up to date. No pending migrations.');
    return { applied: [], pending: [] };
  }

  console.log(`[Migration] Found ${pending.length} pending migration(s): ${pending.join(', ')}`);

  for (const file of pending) {
    const versionMatch = file.match(/^\d+_(v[\d.]+(?:-\w+)?)/);
    const version = versionMatch[1];
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    try {
      // Run migration in a transaction
      await db.exec('BEGIN TRANSACTION;');
      await db.exec(sql);
      await db.run(
        'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)',
        version,
        new Date().toISOString(),
        file
      );
      await db.exec('COMMIT;');

      appliedNow.push(file);
      console.log(`[Migration] ✓ Applied: ${file} (version ${version})`);
    } catch (err) {
      await db.exec('ROLLBACK;');
      console.error(`[Migration] ✗ Failed to apply ${file}: ${err.message}`);
      throw err; // Stop migration chain on failure
    }
  }

  console.log(`[Migration] Successfully applied ${appliedNow.length} migration(s).`);
  return { applied: appliedNow, pending };
}

/**
 * Get migration status (for API endpoint)
 */
async function getMigrationStatus(db) {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
    : [];

  const applied = await db.all('SELECT version, applied_at, description FROM schema_migrations ORDER BY version');
  const appliedVersions = new Set(applied.map(r => r.version));

  const pendingMigrations = [];
  for (const file of files) {
    const versionMatch = file.match(/^\d+_(v[\d.]+(?:-\w+)?)/);
    if (!versionMatch) continue;
    const version = versionMatch[1];
    if (!appliedVersions.has(version)) {
      pendingMigrations.push(version);
    }
  }

  const lastMigration = applied.length > 0 ? applied[applied.length - 1] : null;
  const currentVersion = lastMigration ? lastMigration.version : '0.0.0';

  return {
    currentVersion,
    pendingMigrations,
    appliedMigrations: applied
  };
}

module.exports = { runMigrations, getMigrationStatus };
