-- Migration: v2.3.0 FTTH Planner
-- Description: Adds fiber optic network planning tables for electric poles,
-- fiber cables, cable route waypoints, splice closures, and splice records.

-- Electric/utility poles for fiber deployment
CREATE TABLE IF NOT EXISTS electric_poles (
    id TEXT PRIMARY KEY,
    pole_tag TEXT UNIQUE NOT NULL,
    serial_number TEXT,
    material TEXT NOT NULL DEFAULT 'concrete',
    function_type TEXT NOT NULL DEFAULT 'intermediate',
    height_meters REAL DEFAULT 10,
    burial_depth_m REAL DEFAULT 1.6,
    condition TEXT DEFAULT 'good',
    load_capacity_kg REAL,
    gps TEXT NOT NULL,
    elevation_m REAL,
    location TEXT,
    router_id TEXT,
    has_power_lines INTEGER DEFAULT 0,
    has_fiber_attachment INTEGER DEFAULT 0,
    notes TEXT,
    photo_url TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);

-- Fiber cable segments between network elements
CREATE TABLE IF NOT EXISTS fiber_cables (
    id TEXT PRIMARY KEY,
    cable_tag TEXT UNIQUE NOT NULL,
    cable_type TEXT NOT NULL DEFAULT 'distribution',
    deployment_method TEXT NOT NULL DEFAULT 'aerial',
    fiber_count INTEGER NOT NULL DEFAULT 12,
    fibers_used INTEGER DEFAULT 0,
    fiber_technology TEXT DEFAULT 'G.652D',
    from_element_type TEXT NOT NULL,
    from_element_id TEXT NOT NULL,
    to_element_type TEXT NOT NULL,
    to_element_id TEXT NOT NULL,
    length_meters REAL,
    slack_factor REAL DEFAULT 0.05,
    router_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);

-- Waypoints along a cable route (poles, splice points, etc.)
CREATE TABLE IF NOT EXISTS cable_route_waypoints (
    id TEXT PRIMARY KEY,
    cable_id TEXT NOT NULL,
    sequence_order INTEGER NOT NULL,
    gps TEXT NOT NULL,
    element_type TEXT,
    element_id TEXT,
    elevation_m REAL,
    notes TEXT,
    FOREIGN KEY (cable_id) REFERENCES fiber_cables(id) ON DELETE CASCADE
);

-- Splice closures (aerial, underground, dome)
CREATE TABLE IF NOT EXISTS splice_closures (
    id TEXT PRIMARY KEY,
    closure_tag TEXT UNIQUE NOT NULL,
    closure_type TEXT NOT NULL DEFAULT 'aerial',
    fiber_count INTEGER NOT NULL DEFAULT 12,
    gps TEXT NOT NULL,
    pole_id TEXT,
    location TEXT,
    router_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    FOREIGN KEY (pole_id) REFERENCES electric_poles(id) ON DELETE SET NULL
);

-- Individual fiber splices within a closure
CREATE TABLE IF NOT EXISTS splice_records (
    id TEXT PRIMARY KEY,
    closure_id TEXT NOT NULL,
    input_cable_id TEXT,
    input_fiber_number INTEGER NOT NULL,
    output_cable_id TEXT,
    output_fiber_number INTEGER NOT NULL,
    splice_loss_db REAL DEFAULT 0.1,
    splice_type TEXT DEFAULT 'fusion',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (closure_id) REFERENCES splice_closures(id) ON DELETE CASCADE
);

-- Add pole_id to existing olt_splitters table
-- SQLite doesn't support ADD COLUMN IF NOT EXISTS, so this is handled in server.js initDb()
