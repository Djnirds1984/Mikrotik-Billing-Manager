-- Migration: v2.1.0 Network Equipment (OLT/PON/Splitter/NAP)
-- Description: Adds fiber network equipment inventory tables for OLT management,
-- PON ports, splitters, NAPs, NAP ports, and client-to-port mapping.

-- OLT devices (and other network equipment)
CREATE TABLE IF NOT EXISTS network_equipment (
    id TEXT PRIMARY KEY,
    router_id TEXT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'olt',
    brand TEXT,
    model TEXT,
    ip_address TEXT,
    snmp_community TEXT DEFAULT 'public',
    snmp_port INTEGER DEFAULT 161,
    total_pon_ports INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);

-- PON ports on OLTs
CREATE TABLE IF NOT EXISTS olt_pon_ports (
    id TEXT PRIMARY KEY,
    equipment_id TEXT NOT NULL,
    port_index TEXT NOT NULL,
    port_name TEXT,
    splitter_id TEXT,
    status TEXT DEFAULT 'active',
    total_bandwidth_mbps INTEGER,
    used_ports INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(equipment_id, port_index)
);

-- Splitters
CREATE TABLE IF NOT EXISTS olt_splitters (
    id TEXT PRIMARY KEY,
    pon_port_id TEXT,
    name TEXT NOT NULL,
    split_ratio TEXT NOT NULL DEFAULT '1:8',
    location TEXT,
    max_ports INTEGER NOT NULL,
    installed_ports INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- NAPs (Network Access Points / distribution boxes)
CREATE TABLE IF NOT EXISTS olt_naps (
    id TEXT PRIMARY KEY,
    splitter_id TEXT,
    name TEXT NOT NULL,
    location TEXT,
    gps TEXT,
    total_ports INTEGER NOT NULL DEFAULT 8,
    used_ports INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- NAP ports (individual fiber drop positions)
CREATE TABLE IF NOT EXISTS olt_nap_ports (
    id TEXT PRIMARY KEY,
    nap_id TEXT NOT NULL,
    port_number INTEGER NOT NULL,
    status TEXT DEFAULT 'available',
    client_id TEXT,
    onu_serial TEXT,
    onu_signal_dbm REAL,
    last_seen TEXT,
    notes TEXT,
    UNIQUE(nap_id, port_number)
);

-- SNMP monitor readings for live status
CREATE TABLE IF NOT EXISTS olt_monitor_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id TEXT NOT NULL,
    metric_type TEXT NOT NULL,
    metric_key TEXT,
    metric_value REAL,
    unit TEXT,
    recorded_at TEXT DEFAULT (datetime('now'))
);

-- Add oltNapPortId to customers table (camelCase to match existing convention)
-- This is handled in server.js initDb() via PRAGMA table_info check
-- since SQLite ALTER TABLE doesn't support IF NOT EXISTS
