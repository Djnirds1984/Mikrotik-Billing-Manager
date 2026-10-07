# FTTH Planner - Feature Research & Plan

## Overview

An FTTH (Fiber to the Home) Planner module for the Mikrotik Billing Manager that enables ISP network operators to plan, map, and manage fiber optic network infrastructure — from OLT at the central office all the way to customer premises — using GPS-based GIS mapping on Leaflet.

This extends the existing `NetworkEquipmentManager` (which already handles OLT, PON ports, splitters, NAPs, and a basic map) by adding **electric/utility poles**, **cable routes**, **splice closures**, and a **full GIS planner view**.

---

## 1. FTTH Network Architecture Layers

A standard FTTH/PON network has three cable layers:

```
[OLT] ──── Feeder Cable ──── [FDH/Splitter] ──── Distribution Cable ──── [NAP] ──── Drop Cable ──── [Customer/ONU]
```

| Layer | From → To | Cable Type | Typical Distance |
|---|---|---|---|
| **Feeder** | OLT (Central Office) → Fiber Distribution Hub (FDH) | Armored loose-tube (12–144 fibers) | 1–20 km |
| **Distribution** | FDH/Splitter → Network Access Point (NAP) | Buffered tight-tube (6–24 fibers) | 100m–2 km |
| **Drop** | NAP → Customer Premises (ONU/ONT) | Drop cable (1–2 fibers, G.657 bend-insensitive) | 10–300m |

---

## 2. Electric Post / Utility Pole Types

### 2.1 By Material

| Material | Typical Use | Pros | Cons |
|---|---|---|---|
| **Wood (Treated)** | Rural/suburban distribution | Low cost, easy to climb, widely available | Rot, termites, fire risk, ~40yr lifespan |
| **Concrete (Spun/Prestressed)** | Urban, tropical (Philippines common) | Durable, fireproof, heavy-duty | Heavy, expensive, hard to drill/modify |
| **Steel (Tubular/Monopole)** | High-wind areas, corner/anchor posts | Strong, tall, slim profile | Corrosion, cost, needs grounding |
| **Fiberglass (FRP)** | Coastal/corrosive environments | Lightweight, non-conductive, no corrosion | Expensive, limited load capacity |
| **Ductile Iron** | Heavy-load urban intersections | Extremely strong, long lifespan | Very expensive, very heavy |

### 2.2 By Function (Structural Role)

| Pole Type | Description | Fiber Planning Impact |
|---|---|---|
| **Intermediate** | Straight-line pole between corners; carries cable in-line | Most common type; simple pass-through lashing |
| **Corner** | At direction changes (any angle < 180°); handles angle tension | Requires tension hardware; cable bend radius matters |
| **Anchor / Dead-End** | Terminates a cable run; absorbs full cable tension | Heavy-duty; guy wire or brace rod needed |
| **End** | At start/end of a line; one-directional tension | Similar to anchor but single-direction |
| **Branch / Tee** | Where a cable line branches off in another direction | Cable splitting point; may house a splitter or NAP |
| **A-Frame / H-Frame** | Two poles braced together for heavy loads (transformers, heavy corners) | Reinforced structure; high load capacity |

### 2.3 Standard Pole Dimensions (Philippines Context)

| Specification | Typical Values |
|---|---|
| **Total Length** | 9m, 10m, 12m, 14m (concrete); 30–40ft (wood) |
| **Burial Depth** | ~10% of total length + 0.6m (e.g., 10m pole → 1.6m buried) |
| **Above Ground Height** | ~7–12m depending on total length |
| **Pole Spacing** | Urban: 30–50m; Rural: 50–100m; Mountain: 100–150m |
| **Communication Zone** | Below power lines, typically 3–4m from ground (per Telcordia GR-3174 / NESC) |

### 2.4 Pole Attachment Zones (Vertical Clearance)

```
┌─────────────────────┐
│  Power Supply Zone  │  Top of pole (primary/secondary power lines)
├─────────────────────┤
│  Neutral / Ground   │  Ground wire
├─────────────────────┤
│  Communication Zone │  Fiber optic cable, drop wire (WHERE FIBER LIVES)
├─────────────────────┤
│  Supply / Plant     │  Service drops to buildings
└─────────────────────┘
```

---

## 3. GPS Coordinates & Geolocation Data

Every network element needs precise GPS coordinates for the planner map:

### 3.1 Coordinate Requirements Per Element

| Element | GPS Data | Additional Location Data |
|---|---|---|
| **OLT / Central Office** | `lat, lng` | Building address, floor/room |
| **Electric Pole** | `lat, lng` | Height, material, function type, condition |
| **Fiber Distribution Hub (FDH)** | `lat, lng` | Enclosure type (wall-mount / pole-mount / pedestal) |
| **Splitter** | `lat, lng` | Enclosure type, split ratio, mounted on which pole |
| **Splice Closure** | `lat, lng` | Type (aerial / underground / dome), fiber count |
| **NAP** | `lat, lng` | Mounted on which pole, port count |
| **Customer Premises** | `lat, lng` | Address, building type |

### 3.2 Coordinate Format

Existing system uses `"lat, lng"` string format (e.g., `"14.5995, 120.9842"`). The FTTH planner should maintain this format for consistency but add:
- **Decimal precision**: minimum 6 decimal places (~0.11m accuracy)
- **Elevation/altitude**: optional, for terrain-aware planning
- **Accuracy indicator**: GPS fix quality (from mobile survey app)

---

## 4. FTTH Planner Feature Set

### 4.1 Core Map View (Leaflet GIS)

| Feature | Description |
|---|---|
| **Multi-layer Map** | Toggle layers: Poles, Cables, Splitters, NAPs, Customers, Coverage zones |
| **Aerial/Satellite Tiles** | Switch between OpenStreetMap, satellite (Esri/Mapbox), terrain views |
| **Network Trace** | Click any element → highlight full upstream/downstream path (OLT → Customer) |
| **Measurement Tools** | Click-to-measure distance along cable routes; estimate cable length |
| **Heatmap / Coverage** | Show fiber coverage density by area; identify unserved zones |
| **Print / Export** | Export map as PDF with legend, scale bar, north arrow (extends existing PrintableMapPreview) |

### 4.2 Electric Pole Management

| Feature | Description |
|---|---|
| **Pole CRUD** | Create, edit, delete poles with full attributes |
| **Pole Types** | Material (wood/concrete/steel/fiberglass/iron), Function (intermediate/corner/anchor/end/branch) |
| **Pole Attributes** | Height, burial depth, condition (good/fair/poor/needs-replacement), load capacity |
| **GPS Capture** | Click-on-map to place pole; auto-fill coordinates |
| **Photo Attachment** | Upload pole photos for field survey documentation |
| **Attachment Registry** | What's mounted on each pole: power lines, fiber cables, splitters, NAPs, splice closures |
| **Pole ID / Tagging** | Unique pole identifier (e.g., "POLE-MNL-001") for field crew reference |

### 4.3 Cable Route Planning

| Feature | Description |
|---|---|
| **Route Drawing** | Draw cable paths on map by clicking poles/waypoints in sequence |
| **Cable Segments** | Each segment: from-pole → to-pole, with cable type, fiber count, length (auto-calculated from GPS) |
| **Cable Types** | Feeder (armored loose-tube), Distribution (buffered), Drop (G.657), Self-supporting (ADSS/figure-8) |
| **Deployment Method** | Aerial (lashed to messenger wire on poles), Underground (duct/conduit), Direct-buried |
| **Fiber Count Tracking** | How many fibers in each segment; how many used vs. available (for capacity planning) |
| **Auto-Length Calculation** | GPS distance between poles + slack factor (typically 5–10% extra for sag/splicing) |

### 4.4 Splice Closure Management

| Feature | Description |
|---|---|
| **Splice CRUD** | Create/manage splice closures with GPS location |
| **Splice Type** | Aerial (on pole), Underground (handhole/vault), Dome (direct-buried) |
| **Fiber Splicing Matrix** | Track which input fiber → which output fiber at each splice point |
| **Loss Budget** | Per-splice loss value (typical: 0.05–0.3 dB per fusion splice) |

### 4.5 Network Topology & Design

| Feature | Description |
|---|---|
| **PON Tree View** | Visual hierarchy: OLT → PON Port → Splitter → NAP → Customer (extends existing topology tab) |
| **Split Plan Configurator** | Design split ratios: 1:4, 1:8, 1:16, 1:32, 1:64; single-stage or cascaded (e.g., 1:4 → 1:8 = 1:32) |
| **Optical Loss Budget Calculator** | Total loss = fiber attenuation + splitter loss + splice loss + connector loss; verify within GPON budget (13–28 dB) |
| **Capacity Planning** | Show utilization: OLT PON ports used/total, splitter ports used/total, NAP ports used/total |

### 4.6 Survey & Field Tools

| Feature | Description |
|---|---|
| **Mobile GPS Import** | Import pole coordinates from mobile survey (CSV/KML/GeoJSON) |
| **Waypoint Recording** | Record GPS track while walking cable route; auto-generate cable path |
| **Pole Condition Survey** | Field crew marks pole condition, attachments, available duct space |
| **Photo Geotagging** | Photos auto-tagged with GPS coordinates from phone camera |

### 4.7 Reporting & Documentation

| Feature | Description |
|---|---|
| **Bill of Materials (BoM)** | Auto-generate: cable lengths, pole counts, splitter counts, NAP counts, splice closures, hardware |
| **Cost Estimation** | Unit costs per element → total project cost estimate |
| **Construction Pack** | Printable map + BoM + cable schedules + splice diagrams for field crew |
| **Fiber Assignment Report** | Which customer → which NAP port → which splitter → which OLT PON port |

---

## 5. Database Schema (New Tables)

### 5.1 `electric_poles`

```sql
CREATE TABLE electric_poles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pole_tag TEXT UNIQUE NOT NULL,           -- e.g., "POLE-MNL-001"
    material TEXT NOT NULL DEFAULT 'concrete', -- wood, concrete, steel, fiberglass, iron
    function_type TEXT NOT NULL DEFAULT 'intermediate', -- intermediate, corner, anchor, end, branch, a_frame, h_frame
    height_meters REAL DEFAULT 10,
    burial_depth_m REAL DEFAULT 1.6,
    condition TEXT DEFAULT 'good',           -- good, fair, poor, needs_replacement
    load_capacity_kg REAL,
    gps TEXT NOT NULL,                       -- "lat, lng"
    elevation_m REAL,                        -- altitude above sea level (optional)
    location TEXT,                           -- human-readable address/description
    router_id TEXT,                          -- which router/network this pole belongs to
    has_power_lines INTEGER DEFAULT 0,       -- 1 if power lines present
    has_fiber_attachment INTEGER DEFAULT 0,  -- 1 if fiber is attached
    notes TEXT,
    photo_url TEXT,                          -- path to pole photo
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 5.2 `fiber_cables`

```sql
CREATE TABLE fiber_cables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cable_tag TEXT UNIQUE NOT NULL,          -- e.g., "CABLE-FDR-001"
    cable_type TEXT NOT NULL,                -- feeder, distribution, drop
    deployment_method TEXT NOT NULL DEFAULT 'aerial', -- aerial, underground, direct_buried
    fiber_count INTEGER NOT NULL DEFAULT 12,
    fibers_used INTEGER DEFAULT 0,
    fiber_technology TEXT DEFAULT 'G.652D',  -- G.652D (standard), G.657 (bend-insensitive)
    from_element_type TEXT NOT NULL,         -- 'olt', 'splitter', 'pole', 'splice_closure'
    from_element_id TEXT NOT NULL,
    to_element_type TEXT NOT NULL,
    to_element_id TEXT NOT NULL,
    length_meters REAL,                      -- auto-calculated from GPS + slack
    slack_factor REAL DEFAULT 0.05,          -- 5% default slack
    router_id TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 5.3 `cable_route_waypoints`

```sql
CREATE TABLE cable_route_waypoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cable_id INTEGER NOT NULL REFERENCES fiber_cables(id),
    sequence_order INTEGER NOT NULL,         -- order in the route (1, 2, 3...)
    gps TEXT NOT NULL,                       -- "lat, lng"
    element_type TEXT,                       -- 'pole', 'splice_closure', or 'waypoint'
    element_id TEXT,                         -- FK to pole or splice_closure if applicable
    elevation_m REAL,
    notes TEXT
);
```

### 5.4 `splice_closures`

```sql
CREATE TABLE splice_closures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    closure_tag TEXT UNIQUE NOT NULL,
    closure_type TEXT NOT NULL DEFAULT 'aerial', -- aerial, underground, dome
    fiber_count INTEGER NOT NULL DEFAULT 12,
    gps TEXT NOT NULL,
    pole_id INTEGER REFERENCES electric_poles(id),  -- if mounted on a pole
    location TEXT,
    router_id TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 5.5 `splice_records`

```sql
CREATE TABLE splice_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    closure_id INTEGER NOT NULL REFERENCES splice_closures(id),
    input_cable_id INTEGER REFERENCES fiber_cables(id),
    input_fiber_number INTEGER NOT NULL,
    output_cable_id INTEGER REFERENCES fiber_cables(id),
    output_fiber_number INTEGER NOT NULL,
    splice_loss_db REAL DEFAULT 0.1,
    splice_type TEXT DEFAULT 'fusion',       -- fusion, mechanical
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 5.6 Extend existing `olt_splitters` and `olt_naps`

Add `pole_id INTEGER REFERENCES electric_poles(id)` to both tables so splitters and NAPs can be linked to the pole they're mounted on.

---

## 6. Data Model (TypeScript)

```typescript
// --- FTTH Planner Types ---

export type PoleMaterial = 'wood' | 'concrete' | 'steel' | 'fiberglass' | 'ductile_iron';
export type PoleFunction = 'intermediate' | 'corner' | 'anchor' | 'end' | 'branch' | 'a_frame' | 'h_frame';
export type PoleCondition = 'good' | 'fair' | 'poor' | 'needs_replacement';
export type CableType = 'feeder' | 'distribution' | 'drop';
export type DeploymentMethod = 'aerial' | 'underground' | 'direct_buried';
export type ClosureType = 'aerial' | 'underground' | 'dome';

export interface ElectricPole {
    id: string;
    pole_tag: string;
    material: PoleMaterial;
    function_type: PoleFunction;
    height_meters: number;
    burial_depth_m: number;
    condition: PoleCondition;
    load_capacity_kg?: number;
    gps: string;
    elevation_m?: number;
    location?: string;
    router_id?: string;
    has_power_lines: boolean;
    has_fiber_attachment: boolean;
    notes?: string;
    photo_url?: string;
    created_at?: string;
    updated_at?: string;
}

export interface FiberCable {
    id: string;
    cable_tag: string;
    cable_type: CableType;
    deployment_method: DeploymentMethod;
    fiber_count: number;
    fibers_used: number;
    fiber_technology: string;
    from_element_type: string;
    from_element_id: string;
    to_element_type: string;
    to_element_id: string;
    length_meters: number;
    slack_factor: number;
    router_id?: string;
    notes?: string;
    waypoints?: CableRouteWaypoint[];
    created_at?: string;
    updated_at?: string;
}

export interface CableRouteWaypoint {
    id: string;
    cable_id: string;
    sequence_order: number;
    gps: string;
    element_type?: string;
    element_id?: string;
    elevation_m?: number;
}

export interface SpliceClosure {
    id: string;
    closure_tag: string;
    closure_type: ClosureType;
    fiber_count: number;
    gps: string;
    pole_id?: string;
    location?: string;
    router_id?: string;
    notes?: string;
    created_at?: string;
    updated_at?: string;
}

export interface SpliceRecord {
    id: string;
    closure_id: string;
    input_cable_id: string;
    input_fiber_number: number;
    output_cable_id: string;
    output_fiber_number: number;
    splice_loss_db: number;
    splice_type: 'fusion' | 'mechanical';
    notes?: string;
}
```

---

## 7. UI Components

### 7.1 New Components

| Component | Description |
|---|---|
| `FtthPlanner.tsx` | Main container with tabs: Map, Poles, Cables, Splices, Topology, BoM |
| `FtthMap.tsx` | Full-featured Leaflet map with all FTTH layers, drawing tools, measurements |
| `PoleManager.tsx` | CRUD table + map view for electric poles |
| `PoleDetailModal.tsx` | Pole detail view: attributes, attached cables, mounted equipment, photo |
| `CableRouteEditor.tsx` | Interactive tool to draw cable routes on map by clicking poles/waypoints |
| `CableManager.tsx` | CRUD table for fiber cable segments |
| `SpliceClosureManager.tsx` | CRUD for splice closures + fiber splicing matrix |
| `LossBudgetCalculator.tsx` | Optical loss budget calculator form |
| `BomReport.tsx` | Bill of Materials report generator |
| `FtthTopology.tsx` | Enhanced topology view including poles and cables |

### 7.2 Map Layer Icons

| Element | Icon Style | Color |
|---|---|---|
| OLT | Large square (existing) | Blue |
| Splitter | Diamond (existing) | Orange |
| NAP | Small circle (existing) | Green |
| **Pole** | Small cross/plus marker | Brown (wood) / Gray (concrete) / Silver (steel) |
| **Splice Closure** | Small triangle | Yellow |
| **Cable Route** | Polyline connecting elements | Blue (feeder) / Green (distribution) / Red (drop) |
| **Customer** | House icon (existing) | Purple |

---

## 8. Integration with Existing System

### 8.1 Leverages Existing Infrastructure

- **Leaflet map** — already configured with OpenStreetMap tiles, custom markers, print support
- **NetworkEquipmentManager** — extends with poles, cables, splice closures as additional layers
- **GPS coordinates** — same `"lat, lng"` format used throughout
- **Topology tree** — extends to include poles and cable segments in the hierarchy
- **Router association** — poles/cables linked to routers via `router_id`
- **SQLite + migrations** — new tables via `proxy/migrations/004_v2.3.0_ftth_planner.sql`
- **API routes** — extend `proxy/server.js` with CRUD endpoints for new tables

### 8.2 Data Flow

```
Field Survey (GPS) → Electric Poles + Cable Routes → FTTH Planner Map
                                                         ↓
Customer Activation → NAP Port Assignment → OLT Config → Billing
```

---

## 9. Implementation Phases

### Phase 1: Foundation (Poles + Map)
- Database migration for `electric_poles` table
- Backend CRUD API routes
- `PoleManager` component (table + map)
- Leaflet map layer for poles with material-based coloring
- Click-on-map pole placement with GPS auto-fill

### Phase 2: Cable Routes
- Database migration for `fiber_cables` + `cable_route_waypoints`
- Backend CRUD API routes
- `CableRouteEditor` with interactive map drawing
- Auto cable length calculation from GPS waypoints
- Cable layer on map with type-based coloring

### Phase 3: Splice Closures
- Database migration for `splice_closures` + `splice_records`
- Backend CRUD API routes
- `SpliceClosureManager` with fiber matrix
- Splice layer on map

### Phase 4: Advanced Features
- Optical loss budget calculator
- Bill of Materials generator
- Construction pack export (PDF)
- Mobile GPS import (CSV/KML/GeoJSON)
- Network trace highlighting
- Coverage heatmap

---

## 10. Key References

- **GPON Power Budget**: Class B+ = 13–28 dB (supports up to 1:64 split at ~20km)
- **Fiber Attenuation**: G.652D = 0.35 dB/km @ 1310nm; G.657 = same but bend-insensitive
- **Splice Loss**: Fusion = 0.05–0.1 dB; Mechanical = 0.1–0.3 dB
- **Connector Loss**: SC/APC = 0.2–0.5 dB per connector
- **Pole Communication Zone**: Per Telcordia GR-3174 / NESC — below power lines, 3–4m min from ground
- **Cable Slack Factor**: 5% for aerial, 3% for underground, 10% for drop
