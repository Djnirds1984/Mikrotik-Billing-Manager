import React, { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Network, Options } from 'vis-network/standalone';
import { DataSet } from 'vis-data';
import 'vis-network/styles/vis-network.css';
import { PlusIcon, EditIcon, TrashIcon, SearchIcon, XMarkIcon, CogIcon, ServerIcon, ShareIcon, CheckCircleIcon, ExclamationTriangleIcon } from '../constants';
import type { ElectricPole, FiberCable, SpliceClosure, PoleMaterial, PoleFunction, PoleCondition, CableType, DeploymentMethod, ClosureType } from '../types';

const authHeaders = () => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('authToken')}` });

type Tab = 'dashboard' | 'map' | 'poles' | 'cables' | 'splices' | 'topology';

const POLE_MATERIALS: PoleMaterial[] = ['wood', 'concrete', 'steel', 'fiberglass', 'ductile_iron'];
const POLE_FUNCTIONS: PoleFunction[] = ['intermediate', 'corner', 'anchor', 'end', 'branch', 'a_frame', 'h_frame'];
const POLE_CONDITIONS: PoleCondition[] = ['good', 'fair', 'poor', 'needs_replacement'];
const CABLE_TYPES: CableType[] = ['feeder', 'distribution', 'drop'];
const DEPLOYMENT_METHODS: DeploymentMethod[] = ['aerial', 'underground', 'direct_buried'];
const CLOSURE_TYPES: ClosureType[] = ['aerial', 'underground', 'dome'];

const POLE_MATERIAL_COLORS: Record<PoleMaterial, string> = {
    wood: '#8B4513',
    concrete: '#808080',
    steel: '#C0C0C0',
    fiberglass: '#FFD700',
    ductile_iron: '#2F4F4F'
};

const CABLE_TYPE_COLORS: Record<CableType, string> = {
    feeder: '#3B82F6',
    distribution: '#10B981',
    drop: '#EF4444'
};

const CONDITION_BADGES: Record<PoleCondition, string> = {
    good: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    fair: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    poor: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    needs_replacement: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
};

function genPoleTag() {
    return `POLE-${Date.now().toString(36).toUpperCase()}`;
}
function genCableTag() {
    return `CABLE-${Date.now().toString(36).toUpperCase()}`;
}
function genClosureTag() {
    return `SPLICE-${Date.now().toString(36).toUpperCase()}`;
}

function parseGps(gps: string): [number, number] | null {
    if (!gps) return null;
    const parts = gps.split(',').map(s => parseFloat(s.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return [parts[0], parts[1]];
    return null;
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const FtthPlanner: React.FC = () => {
    const [activeTab, setActiveTab] = useState<Tab>('dashboard');
    const [poles, setPoles] = useState<ElectricPole[]>([]);
    const [cables, setCables] = useState<FiberCable[]>([]);
    const [closures, setClosures] = useState<SpliceClosure[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    // Dashboard stats
    const [dashboard, setDashboard] = useState<any>(null);

    // Pole modal
    const [showPoleModal, setShowPoleModal] = useState(false);
    const [editingPole, setEditingPole] = useState<ElectricPole | null>(null);
    const [poleForm, setPoleForm] = useState<Partial<ElectricPole>>({});

    // Cable modal
    const [showCableModal, setShowCableModal] = useState(false);
    const [editingCable, setEditingCable] = useState<FiberCable | null>(null);
    const [cableForm, setCableForm] = useState<Partial<FiberCable>>({});

    // Closure modal
    const [showClosureModal, setShowClosureModal] = useState(false);
    const [editingClosure, setEditingClosure] = useState<SpliceClosure | null>(null);
    const [closureForm, setClosureForm] = useState<Partial<SpliceClosure>>({});

    // Map
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<L.Map | null>(null);
    const poleLayerRef = useRef<L.LayerGroup | null>(null);
    const cableLayerRef = useRef<L.LayerGroup | null>(null);
    const closureLayerRef = useRef<L.LayerGroup | null>(null);
    const [showPoleLayer, setShowPoleLayer] = useState(true);
    const [showCableLayer, setShowCableLayer] = useState(true);
    const [showClosureLayer, setShowClosureLayer] = useState(true);
    const [placingPole, setPlacingPole] = useState(false);

    // Topology
    const topologyRef = useRef<HTMLDivElement>(null);
    const networkRef = useRef<Network | null>(null);

    // Fetch all data
    const fetchData = useCallback(async () => {
        try {
            const [polesRes, cablesRes, closuresRes, dashRes] = await Promise.all([
                fetch('/api/electric-poles', { headers: authHeaders() }),
                fetch('/api/fiber-cables', { headers: authHeaders() }),
                fetch('/api/splice-closures', { headers: authHeaders() }),
                fetch('/api/ftth-planner/dashboard', { headers: authHeaders() })
            ]);
            if (polesRes.ok) setPoles(await polesRes.json());
            if (cablesRes.ok) setCables(await cablesRes.json());
            if (closuresRes.ok) setClosures(await closuresRes.json());
            if (dashRes.ok) setDashboard(await dashRes.json());
        } catch (e) {
            console.error('Failed to fetch FTTH data:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    // CRUD helpers
    const savePole = async () => {
        const isEdit = !!editingPole;
        const url = isEdit ? `/api/electric-poles/${editingPole!.id}` : '/api/electric-poles';
        const method = isEdit ? 'PUT' : 'POST';
        const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(poleForm) });
        if (res.ok) {
            setShowPoleModal(false);
            setEditingPole(null);
            setPoleForm({});
            fetchData();
        }
    };

    const deletePole = async (id: string) => {
        if (!confirm('Delete this pole?')) return;
        await fetch(`/api/electric-poles/${id}`, { method: 'DELETE', headers: authHeaders() });
        fetchData();
    };

    const saveCable = async () => {
        const isEdit = !!editingCable;
        const url = isEdit ? `/api/fiber-cables/${editingCable!.id}` : '/api/fiber-cables';
        const method = isEdit ? 'PUT' : 'POST';
        const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(cableForm) });
        if (res.ok) {
            setShowCableModal(false);
            setEditingCable(null);
            setCableForm({});
            fetchData();
        }
    };

    const deleteCable = async (id: string) => {
        if (!confirm('Delete this cable?')) return;
        await fetch(`/api/fiber-cables/${id}`, { method: 'DELETE', headers: authHeaders() });
        fetchData();
    };

    const saveClosure = async () => {
        const isEdit = !!editingClosure;
        const url = isEdit ? `/api/splice-closures/${editingClosure!.id}` : '/api/splice-closures';
        const method = isEdit ? 'PUT' : 'POST';
        const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(closureForm) });
        if (res.ok) {
            setShowClosureModal(false);
            setEditingClosure(null);
            setClosureForm({});
            fetchData();
        }
    };

    const deleteClosure = async (id: string) => {
        if (!confirm('Delete this splice closure?')) return;
        await fetch(`/api/splice-closures/${id}`, { method: 'DELETE', headers: authHeaders() });
        fetchData();
    };

    // Map initialization
    useEffect(() => {
        if (activeTab !== 'map' || !mapRef.current || mapInstanceRef.current) return;

        const map = L.map(mapRef.current).setView([14.5995, 120.9842], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);

        poleLayerRef.current = L.layerGroup().addTo(map);
        cableLayerRef.current = L.layerGroup().addTo(map);
        closureLayerRef.current = L.layerGroup().addTo(map);

        mapInstanceRef.current = map;

        map.on('click', (e: L.LeafletMouseEvent) => {
            if (placingPole) {
                const gps = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
                setPoleForm(prev => ({ ...prev, gps }));
                setPlacingPole(false);
                setShowPoleModal(true);
            }
        });

        return () => {
            map.remove();
            mapInstanceRef.current = null;
        };
    }, [activeTab, placingPole]);

    // Update map layers when data changes
    useEffect(() => {
        if (!mapInstanceRef.current) return;

        // Poles
        if (poleLayerRef.current) {
            poleLayerRef.current.clearLayers();
            if (showPoleLayer) {
                poles.forEach(pole => {
                    const coords = parseGps(pole.gps);
                    if (!coords) return;
                    const color = POLE_MATERIAL_COLORS[pole.material] || '#808080';
                    const icon = L.divIcon({
                        className: '',
                        html: `<div style="width:14px;height:14px;background:${color};border:2px solid #333;border-radius:2px;transform:rotate(0deg);"></div>`,
                        iconSize: [14, 14],
                        iconAnchor: [7, 7]
                    });
                    const marker = L.marker(coords, { icon }).addTo(poleLayerRef.current!);
                    marker.bindTooltip(pole.pole_tag, { permanent: false, direction: 'top' });
                    marker.bindPopup(`
                        <div style="min-width:200px">
                            <b>${pole.pole_tag}</b><br/>
                            Serial: ${pole.serial_number || 'N/A'}<br/>
                            Material: ${pole.material}<br/>
                            Type: ${pole.function_type}<br/>
                            Height: ${pole.height_meters}m<br/>
                            Condition: ${pole.condition}<br/>
                            Location: ${pole.location || 'N/A'}<br/>
                            GPS: ${pole.gps}
                        </div>
                    `);
                });
            }
        }

        // Cables
        if (cableLayerRef.current) {
            cableLayerRef.current.clearLayers();
            if (showCableLayer) {
                cables.forEach(cable => {
                    const resolveCoords = (type: string, id: string): [number, number] | null => {
                        if (type === 'pole') {
                            const el = poles.find(p => p.id === id);
                            return el ? parseGps(el.gps) : null;
                        }
                        if (type === 'splice_closure') {
                            const el = closures.find(c => c.id === id);
                            return el ? parseGps(el.gps) : null;
                        }
                        return null;
                    };
                    const fromCoords = resolveCoords(cable.from_element_type, cable.from_element_id);
                    const toCoords = resolveCoords(cable.to_element_type, cable.to_element_id);
                    if (fromCoords && toCoords) {
                        const color = CABLE_TYPE_COLORS[cable.cable_type] || '#3B82F6';
                        const polyline = L.polyline([fromCoords, toCoords], {
                            color,
                            weight: cable.cable_type === 'feeder' ? 4 : cable.cable_type === 'distribution' ? 3 : 2,
                            dashArray: cable.deployment_method === 'underground' ? '8,4' : undefined
                        }).addTo(cableLayerRef.current!);
                        polyline.bindTooltip(`${cable.cable_tag} (${cable.cable_type})`, { permanent: false });
                        polyline.bindPopup(`
                            <div style="min-width:200px">
                                <b>${cable.cable_tag}</b><br/>
                                Type: ${cable.cable_type}<br/>
                                Method: ${cable.deployment_method}<br/>
                                Fibers: ${cable.fiber_count} (${cable.fibers_used} used)<br/>
                                Length: ${cable.length_meters ? cable.length_meters.toFixed(0) + 'm' : 'N/A'}
                            </div>
                        `);
                    } else {
                        console.warn(`Cable ${cable.cable_tag} cannot be rendered:`, {
                            fromType: cable.from_element_type,
                            fromId: cable.from_element_id,
                            fromResolved: !!fromCoords,
                            toType: cable.to_element_type,
                            toId: cable.to_element_id,
                            toResolved: !!toCoords,
                            availablePoles: poles.map(p => p.id),
                            availableClosures: closures.map(c => c.id)
                        });
                    }
                });
            }
        }

        // Closures
        if (closureLayerRef.current) {
            closureLayerRef.current.clearLayers();
            if (showClosureLayer) {
                closures.forEach(closure => {
                    const coords = parseGps(closure.gps);
                    if (!coords) return;
                    const icon = L.divIcon({
                        className: '',
                        html: `<div style="width:12px;height:12px;background:#FBBF24;border:2px solid #92400E;border-radius:50%;"></div>`,
                        iconSize: [12, 12],
                        iconAnchor: [6, 6]
                    });
                    const marker = L.marker(coords, { icon }).addTo(closureLayerRef.current!);
                    marker.bindTooltip(closure.closure_tag, { permanent: false, direction: 'top' });
                    marker.bindPopup(`
                        <div style="min-width:200px">
                            <b>${closure.closure_tag}</b><br/>
                            Type: ${closure.closure_type}<br/>
                            Fibers: ${closure.fiber_count}<br/>
                            Location: ${closure.location || 'N/A'}<br/>
                            GPS: ${closure.gps}
                        </div>
                    `);
                });
            }
        }

        // Fit bounds if we have data
        const allCoords: [number, number][] = [];
        poles.forEach(p => { const c = parseGps(p.gps); if (c) allCoords.push(c); });
        closures.forEach(c => { const c2 = parseGps(c.gps); if (c2) allCoords.push(c2); });
        if (allCoords.length > 0 && mapInstanceRef.current) {
            const bounds = L.latLngBounds(allCoords);
            mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50] });
        }
    }, [poles, cables, closures, showPoleLayer, showCableLayer, showClosureLayer, activeTab]);

    // Topology visualization
    useEffect(() => {
        if (activeTab !== 'topology' || !topologyRef.current) return;

        // Destroy existing network
        if (networkRef.current) {
            networkRef.current.destroy();
            networkRef.current = null;
        }

        if (poles.length === 0 && closures.length === 0) return;

        const nodes: any[] = [];
        const edges: any[] = [];

        // Add poles as nodes
        poles.forEach(pole => {
            nodes.push({
                id: `pole_${pole.id}`,
                label: pole.pole_tag,
                shape: 'box',
                color: {
                    background: POLE_MATERIAL_COLORS[pole.material] || '#808080',
                    border: '#333',
                    highlight: { background: POLE_MATERIAL_COLORS[pole.material] || '#808080', border: '#000' }
                },
                font: { color: '#fff', size: 10 },
                size: 20,
                title: `<b>${pole.pole_tag}</b><br/>Serial: ${pole.serial_number || 'N/A'}<br/>Material: ${pole.material}<br/>Type: ${pole.function_type}<br/>Condition: ${pole.condition}`
            });
        });

        // Add closures as nodes
        closures.forEach(closure => {
            nodes.push({
                id: `closure_${closure.id}`,
                label: closure.closure_tag,
                shape: 'dot',
                color: {
                    background: '#FBBF24',
                    border: '#92400E',
                    highlight: { background: '#FCD34D', border: '#92400E' }
                },
                size: 15,
                title: `<b>${closure.closure_tag}</b><br/>Type: ${closure.closure_type}<br/>Fibers: ${closure.fiber_count}`
            });
        });

        // Add cables as edges
        cables.forEach(cable => {
            const fromId = `${cable.from_element_type === 'splice_closure' ? 'closure' : 'pole'}_${cable.from_element_id}`;
            const toId = `${cable.to_element_type === 'splice_closure' ? 'closure' : 'pole'}_${cable.to_element_id}`;
            
            // Only add edge if both nodes exist
            const fromNode = nodes.find(n => n.id === fromId);
            const toNode = nodes.find(n => n.id === toId);
            
            if (fromNode && toNode) {
                edges.push({
                    from: fromId,
                    to: toId,
                    color: {
                        color: CABLE_TYPE_COLORS[cable.cable_type] || '#3B82F6',
                        highlight: CABLE_TYPE_COLORS[cable.cable_type] || '#3B82F6',
                        hover: CABLE_TYPE_COLORS[cable.cable_type] || '#3B82F6'
                    },
                    width: cable.cable_type === 'feeder' ? 3 : cable.cable_type === 'distribution' ? 2 : 1,
                    dashes: cable.deployment_method === 'underground',
                    title: `<b>${cable.cable_tag}</b><br/>Type: ${cable.cable_type}<br/>Method: ${cable.deployment_method}<br/>Fibers: ${cable.fiber_count} (${cable.fibers_used} used)<br/>Length: ${cable.length_meters ? cable.length_meters.toFixed(0) + 'm' : 'N/A'}`,
                    label: cable.cable_tag
                });
            }
        });

        const options: Options = {
            nodes: {
                borderWidth: 2,
                shadow: true
            },
            edges: {
                smooth: {
                    type: 'continuous',
                    roundness: 0.5
                },
                shadow: true
            },
            physics: {
                enabled: true,
                barnesHut: {
                    gravitationalConstant: -3000,
                    centralGravity: 0.3,
                    springLength: 150,
                    springConstant: 0.04,
                    damping: 0.09
                },
                stabilization: {
                    iterations: 200
                }
            },
            interaction: {
                hover: true,
                tooltipDelay: 200,
                navigationButtons: true,
                keyboard: true
            }
        };

        const data = { nodes: new (window as any).vis.DataSet(nodes), edges: new (window as any).vis.DataSet(edges) };
        networkRef.current = new Network(topologyRef.current, data, options);

        return () => {
            if (networkRef.current) {
                networkRef.current.destroy();
                networkRef.current = null;
            }
        };
    }, [poles, cables, closures, activeTab]);

    const openNewPoleModal = () => {
        setEditingPole(null);
        setPoleForm({
            pole_tag: genPoleTag(),
            serial_number: '',
            material: 'concrete',
            function_type: 'intermediate',
            height_meters: 10,
            burial_depth_m: 1.6,
            condition: 'good',
            has_power_lines: false,
            has_fiber_attachment: false
        });
        setShowPoleModal(true);
    };

    const openEditPoleModal = (pole: ElectricPole) => {
        setEditingPole(pole);
        setPoleForm(pole);
        setShowPoleModal(true);
    };

    const openNewCableModal = () => {
        setEditingCable(null);
        setCableForm({
            cable_tag: genCableTag(),
            cable_type: 'distribution',
            deployment_method: 'aerial',
            fiber_count: 12,
            fibers_used: 0,
            fiber_technology: 'G.652D',
            from_element_type: 'pole',
            to_element_type: 'pole',
            slack_factor: 0.05
        });
        setShowCableModal(true);
    };

    const openEditCableModal = (cable: FiberCable) => {
        setEditingCable(cable);
        setCableForm(cable);
        setShowCableModal(true);
    };

    const openNewClosureModal = () => {
        setEditingClosure(null);
        setClosureForm({
            closure_tag: genClosureTag(),
            closure_type: 'aerial',
            fiber_count: 12
        });
        setShowClosureModal(true);
    };

    const openEditClosureModal = (closure: SpliceClosure) => {
        setEditingClosure(closure);
        setClosureForm(closure);
        setShowClosureModal(true);
    };

    const filteredPoles = poles.filter(p =>
        p.pole_tag.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.serial_number || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.location || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.material.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.function_type.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const filteredCables = cables.filter(c =>
        c.cable_tag.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.cable_type.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.deployment_method.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const filteredClosures = closures.filter(c =>
        c.closure_tag.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.location || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.closure_type.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">FTTH Planner</h1>
                <div className="flex gap-2">
                    {activeTab === 'poles' && (
                        <button onClick={openNewPoleModal} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                            <PlusIcon className="w-5 h-5" /> Add Pole
                        </button>
                    )}
                    {activeTab === 'cables' && (
                        <button onClick={openNewCableModal} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                            <PlusIcon className="w-5 h-5" /> Add Cable
                        </button>
                    )}
                    {activeTab === 'splices' && (
                        <button onClick={openNewClosureModal} className="flex items-center gap-2 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700">
                            <PlusIcon className="w-5 h-5" /> Add Closure
                        </button>
                    )}
                    {activeTab === 'map' && (
                        <button onClick={() => { setPlacingPole(!placingPole); openNewPoleModal(); }} className={`flex items-center gap-2 px-4 py-2 rounded-lg ${placingPole ? 'bg-red-600' : 'bg-blue-600'} text-white hover:opacity-90`}>
                            <PlusIcon className="w-5 h-5" /> {placingPole ? 'Cancel' : 'Place Pole on Map'}
                        </button>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 p-1 rounded-lg">
                {([
                    { id: 'dashboard', label: 'Dashboard', icon: <ServerIcon className="w-4 h-4" /> },
                    { id: 'map', label: 'Map', icon: <ShareIcon className="w-4 h-4" /> },
                    { id: 'topology', label: 'Topology', icon: <ShareIcon className="w-4 h-4" /> },
                    { id: 'poles', label: 'Poles', icon: <CogIcon className="w-4 h-4" /> },
                    { id: 'cables', label: 'Cables', icon: <ShareIcon className="w-4 h-4" /> },
                    { id: 'splices', label: 'Splices', icon: <ShareIcon className="w-4 h-4" /> }
                ] as { id: Tab; label: string; icon: React.ReactNode }[]).map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            activeTab === tab.id
                                ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow'
                                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                        }`}
                    >
                        {tab.icon} {tab.label}
                    </button>
                ))}
            </div>

            {/* Dashboard Tab */}
            {activeTab === 'dashboard' && dashboard && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">Total Poles</p>
                                    <p className="text-3xl font-bold text-gray-900 dark:text-white">{dashboard.poles?.total || 0}</p>
                                    <p className="text-xs text-gray-400 mt-1">{dashboard.poles?.with_fiber || 0} with fiber</p>
                                </div>
                                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                                    <CogIcon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                                </div>
                            </div>
                        </div>
                        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">Total Cables</p>
                                    <p className="text-3xl font-bold text-gray-900 dark:text-white">{dashboard.cables?.total || 0}</p>
                                    <p className="text-xs text-gray-400 mt-1">{dashboard.cables?.total_length ? `${(dashboard.cables.total_length / 1000).toFixed(1)} km` : '0 km'}</p>
                                </div>
                                <div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center">
                                    <ShareIcon className="w-6 h-6 text-green-600 dark:text-green-400" />
                                </div>
                            </div>
                        </div>
                        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">Splice Closures</p>
                                    <p className="text-3xl font-bold text-gray-900 dark:text-white">{dashboard.closures?.total || 0}</p>
                                </div>
                                <div className="w-12 h-12 bg-yellow-100 dark:bg-yellow-900 rounded-lg flex items-center justify-center">
                                    <ShareIcon className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Pole breakdown */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Poles by Material</h3>
                            <div className="space-y-2">
                                {(dashboard.poles?.by_material || []).map((item: any) => (
                                    <div key={item.material} className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="w-3 h-3 rounded" style={{ background: POLE_MATERIAL_COLORS[item.material as PoleMaterial] || '#808080' }}></div>
                                            <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">{item.material}</span>
                                        </div>
                                        <span className="text-sm font-medium text-gray-900 dark:text-white">{item.count}</span>
                                    </div>
                                ))}
                                {(!dashboard.poles?.by_material || dashboard.poles.by_material.length === 0) && (
                                    <p className="text-sm text-gray-400">No poles yet</p>
                                )}
                            </div>
                        </div>
                        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Poles by Condition</h3>
                            <div className="space-y-2">
                                {(dashboard.poles?.by_condition || []).map((item: any) => (
                                    <div key={item.condition} className="flex items-center justify-between">
                                        <span className={`text-xs px-2 py-1 rounded-full capitalize ${CONDITION_BADGES[item.condition as PoleCondition] || ''}`}>{item.condition}</span>
                                        <span className="text-sm font-medium text-gray-900 dark:text-white">{item.count}</span>
                                    </div>
                                ))}
                                {(!dashboard.poles?.by_condition || dashboard.poles.by_condition.length === 0) && (
                                    <p className="text-sm text-gray-400">No poles yet</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Cable breakdown */}
                    <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Cables by Type</h3>
                        <div className="space-y-2">
                            {(dashboard.cables?.by_type || []).map((item: any) => (
                                <div key={item.cable_type} className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded" style={{ background: CABLE_TYPE_COLORS[item.cable_type as CableType] || '#3B82F6' }}></div>
                                        <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">{item.cable_type}</span>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-sm font-medium text-gray-900 dark:text-white">{item.count} cables</span>
                                        <span className="text-xs text-gray-400 ml-2">{item.total_length ? `${(item.total_length / 1000).toFixed(1)} km` : '0 km'}</span>
                                    </div>
                                </div>
                            ))}
                            {(!dashboard.cables?.by_type || dashboard.cables.by_type.length === 0) && (
                                <p className="text-sm text-gray-400">No cables yet</p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Map Tab */}
            {activeTab === 'map' && (
                <div className="space-y-4">
                    <div className="flex gap-4 items-center bg-white dark:bg-slate-800 p-3 rounded-lg shadow">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Layers:</span>
                        <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={showPoleLayer} onChange={() => setShowPoleLayer(!showPoleLayer)} className="rounded" />
                            <span className="w-3 h-3 rounded bg-gray-600 inline-block"></span> Poles
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={showCableLayer} onChange={() => setShowCableLayer(!showCableLayer)} className="rounded" />
                            <span className="w-3 h-3 rounded bg-green-500 inline-block"></span> Cables
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={showClosureLayer} onChange={() => setShowClosureLayer(!showClosureLayer)} className="rounded" />
                            <span className="w-3 h-3 rounded-full bg-yellow-400 inline-block"></span> Splice Closures
                        </label>
                        <div className="ml-auto text-xs text-gray-400">
                            {poles.length} poles | {cables.length} cables | {closures.length} closures
                        </div>
                    </div>
                    <div ref={mapRef} className="w-full h-[600px] rounded-lg shadow" style={{ zIndex: 0 }}></div>
                </div>
            )}

            {/* Poles Tab */}
            {activeTab === 'poles' && (
                <div className="space-y-4">
                    <div className="relative">
                        <SearchIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search poles by tag, location, material, type..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                        />
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-lg shadow overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-slate-700">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Tag</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Serial No.</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Material</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Function</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Height</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Condition</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">GPS</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Location</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                                {filteredPoles.map(pole => (
                                    <tr key={pole.id} className="hover:bg-gray-50 dark:hover:bg-slate-750">
                                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{pole.pole_tag}</td>
                                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300 font-mono text-xs">{pole.serial_number || '-'}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <div className="w-3 h-3 rounded" style={{ background: POLE_MATERIAL_COLORS[pole.material] }}></div>
                                                <span className="text-gray-700 dark:text-gray-300 capitalize">{pole.material}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300 capitalize">{pole.function_type.replace('_', ' ')}</td>
                                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{pole.height_meters}m</td>
                                        <td className="px-4 py-3">
                                            <span className={`text-xs px-2 py-1 rounded-full capitalize ${CONDITION_BADGES[pole.condition]}`}>{pole.condition}</span>
                                        </td>
                                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-mono">{pole.gps}</td>
                                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300 max-w-[200px] truncate">{pole.location || '-'}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex gap-2">
                                                <button onClick={() => openEditPoleModal(pole)} className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"><EditIcon className="w-4 h-4" /></button>
                                                <button onClick={() => deletePole(pole.id)} className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"><TrashIcon className="w-4 h-4" /></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {filteredPoles.length === 0 && (
                                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No poles found. Click "Add Pole" to create one.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Cables Tab */}
            {activeTab === 'cables' && (
                <div className="space-y-4">
                    <div className="relative">
                        <SearchIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search cables by tag, type, method..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                        />
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-lg shadow overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-slate-700">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Tag</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Method</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Fibers</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Technology</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Length</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">From → To</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                                {filteredCables.map(cable => {
                                    const resolveName = (type: string, id: string) => {
                                        if (type === 'pole') return poles.find(p => p.id === id)?.pole_tag;
                                        if (type === 'splice_closure') return closures.find(c => c.id === id)?.closure_tag;
                                        return null;
                                    };
                                    const fromName = resolveName(cable.from_element_type, cable.from_element_id);
                                    const toName = resolveName(cable.to_element_type, cable.to_element_id);
                                    const hasBrokenEndpoint = !fromName || !toName;
                                    return (
                                        <tr key={cable.id} className={`hover:bg-gray-50 dark:hover:bg-slate-750 ${hasBrokenEndpoint ? 'bg-orange-50 dark:bg-orange-900/10' : ''}`}>
                                            <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                                                <div className="flex items-center gap-1">
                                                    {cable.cable_tag}
                                                    {hasBrokenEndpoint && (
                                                        <ExclamationTriangleIcon className="w-4 h-4 text-orange-500" title="Cable endpoints not found - cannot render on map" />
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-3 rounded" style={{ background: CABLE_TYPE_COLORS[cable.cable_type] }}></div>
                                                    <span className="text-gray-700 dark:text-gray-300 capitalize">{cable.cable_type}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-gray-700 dark:text-gray-300 capitalize">{cable.deployment_method}</td>
                                            <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{cable.fibers_used}/{cable.fiber_count}</td>
                                            <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{cable.fiber_technology}</td>
                                            <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{cable.length_meters ? `${cable.length_meters.toFixed(0)}m` : '-'}</td>
                                            <td className="px-4 py-3 text-xs">
                                                <span className={fromName ? 'text-gray-500 dark:text-gray-400' : 'text-orange-500 font-medium'}>
                                                    {fromName || `${cable.from_element_type}:${cable.from_element_id.slice(0, 8)}`}
                                                </span>
                                                {' → '}
                                                <span className={toName ? 'text-gray-500 dark:text-gray-400' : 'text-orange-500 font-medium'}>
                                                    {toName || `${cable.to_element_type}:${cable.to_element_id.slice(0, 8)}`}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex gap-2">
                                                    <button onClick={() => openEditCableModal(cable)} className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"><EditIcon className="w-4 h-4" /></button>
                                                    <button onClick={() => deleteCable(cable.id)} className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"><TrashIcon className="w-4 h-4" /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {filteredCables.length === 0 && (
                                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No cables found. Click "Add Cable" to create one.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Splices Tab */}
            {activeTab === 'splices' && (
                <div className="space-y-4">
                    <div className="relative">
                        <SearchIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search closures by tag, location, type..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                        />
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-lg shadow overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-slate-700">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Tag</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Fiber Count</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Mounted On</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">GPS</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Location</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                                {filteredClosures.map(closure => (
                                    <tr key={closure.id} className="hover:bg-gray-50 dark:hover:bg-slate-750">
                                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{closure.closure_tag}</td>
                                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300 capitalize">{closure.closure_type}</td>
                                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{closure.fiber_count}</td>
                                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{(closure as any).pole_tag || '-'}</td>
                                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-mono">{closure.gps}</td>
                                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300 max-w-[200px] truncate">{closure.location || '-'}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex gap-2">
                                                <button onClick={() => openEditClosureModal(closure)} className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"><EditIcon className="w-4 h-4" /></button>
                                                <button onClick={() => deleteClosure(closure.id)} className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"><TrashIcon className="w-4 h-4" /></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {filteredClosures.length === 0 && (
                                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No splice closures found. Click "Add Closure" to create one.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Topology Tab */}
            {activeTab === 'topology' && (
                <div className="space-y-4">
                    <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-4">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Network Topology</h3>
                            <div className="flex gap-4 text-sm">
                                <span className="flex items-center gap-2"><span className="w-3 h-3 rounded" style={{ background: '#808080' }}></span> Pole</span>
                                <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: '#FBBF24' }}></span> Closure</span>
                                <span className="flex items-center gap-2"><span className="w-3 h-1" style={{ background: '#3B82F6' }}></span> Feeder</span>
                                <span className="flex items-center gap-2"><span className="w-3 h-1" style={{ background: '#10B981' }}></span> Distribution</span>
                                <span className="flex items-center gap-2"><span className="w-3 h-1" style={{ background: '#EF4444' }}></span> Drop</span>
                            </div>
                        </div>
                        <div ref={topologyRef} className="w-full h-[600px] border border-gray-200 dark:border-slate-700 rounded-lg"></div>
                    </div>
                </div>
            )}

            {/* Pole Modal */}
            {showPoleModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-slate-700">
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{editingPole ? 'Edit Pole' : 'Add Electric Pole'}</h2>
                            <button onClick={() => setShowPoleModal(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded"><XMarkIcon className="w-5 h-5 text-gray-500" /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pole Tag *</label>
                                    <input type="text" value={poleForm.pole_tag || ''} onChange={e => setPoleForm({ ...poleForm, pole_tag: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Serial Number</label>
                                    <input type="text" value={poleForm.serial_number || ''} onChange={e => setPoleForm({ ...poleForm, serial_number: e.target.value })} placeholder="Manufacturer serial / asset number" className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Material</label>
                                    <select value={poleForm.material || 'concrete'} onChange={e => setPoleForm({ ...poleForm, material: e.target.value as PoleMaterial })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                                        {POLE_MATERIALS.map(m => <option key={m} value={m} className="capitalize">{m}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Function Type</label>
                                    <select value={poleForm.function_type || 'intermediate'} onChange={e => setPoleForm({ ...poleForm, function_type: e.target.value as PoleFunction })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                                        {POLE_FUNCTIONS.map(f => <option key={f} value={f}>{f.replace('_', ' ')}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Condition</label>
                                    <select value={poleForm.condition || 'good'} onChange={e => setPoleForm({ ...poleForm, condition: e.target.value as PoleCondition })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                                        {POLE_CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Height (m)</label>
                                    <input type="number" value={poleForm.height_meters || 10} onChange={e => setPoleForm({ ...poleForm, height_meters: parseFloat(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Burial Depth (m)</label>
                                    <input type="number" step="0.1" value={poleForm.burial_depth_m || 1.6} onChange={e => setPoleForm({ ...poleForm, burial_depth_m: parseFloat(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">GPS Coordinates * (lat, lng)</label>
                                    <input type="text" value={poleForm.gps || ''} onChange={e => setPoleForm({ ...poleForm, gps: e.target.value })} placeholder="14.5995, 120.9842" className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Elevation (m)</label>
                                    <input type="number" step="0.1" value={poleForm.elevation_m || ''} onChange={e => setPoleForm({ ...poleForm, elevation_m: parseFloat(e.target.value) || undefined })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Location / Address</label>
                                <input type="text" value={poleForm.location || ''} onChange={e => setPoleForm({ ...poleForm, location: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                            </div>
                            <div className="flex gap-6">
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={poleForm.has_power_lines || false} onChange={e => setPoleForm({ ...poleForm, has_power_lines: e.target.checked })} className="rounded" />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">Has Power Lines</span>
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={poleForm.has_fiber_attachment || false} onChange={e => setPoleForm({ ...poleForm, has_fiber_attachment: e.target.checked })} className="rounded" />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">Has Fiber Attachment</span>
                                </label>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
                                <textarea value={poleForm.notes || ''} onChange={e => setPoleForm({ ...poleForm, notes: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 p-6 border-t border-gray-200 dark:border-slate-700">
                            <button onClick={() => setShowPoleModal(false)} className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg">Cancel</button>
                            <button onClick={savePole} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">{editingPole ? 'Update' : 'Create'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Cable Modal */}
            {showCableModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-slate-700">
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{editingCable ? 'Edit Cable' : 'Add Fiber Cable'}</h2>
                            <button onClick={() => setShowCableModal(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded"><XMarkIcon className="w-5 h-5 text-gray-500" /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cable Tag *</label>
                                    <input type="text" value={cableForm.cable_tag || ''} onChange={e => setCableForm({ ...cableForm, cable_tag: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cable Type</label>
                                    <select value={cableForm.cable_type || 'distribution'} onChange={e => setCableForm({ ...cableForm, cable_type: e.target.value as CableType })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                                        {CABLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Deployment Method</label>
                                    <select value={cableForm.deployment_method || 'aerial'} onChange={e => setCableForm({ ...cableForm, deployment_method: e.target.value as DeploymentMethod })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                                        {DEPLOYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fiber Count</label>
                                    <input type="number" value={cableForm.fiber_count || 12} onChange={e => setCableForm({ ...cableForm, fiber_count: parseInt(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fiber Technology</label>
                                    <select value={cableForm.fiber_technology || 'G.652D'} onChange={e => setCableForm({ ...cableForm, fiber_technology: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                                        <option value="G.652D">G.652D (Standard)</option>
                                        <option value="G.657">G.657 (Bend-insensitive)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Length (m)</label>
                                    <input type="number" value={cableForm.length_meters || ''} onChange={e => setCableForm({ ...cableForm, length_meters: parseFloat(e.target.value) || undefined })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">From Element Type</label>
                                    <select value={cableForm.from_element_type || 'pole'} onChange={e => setCableForm({ ...cableForm, from_element_type: e.target.value, from_element_id: '' })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                                        <option value="pole">Pole</option>
                                        <option value="splice_closure">Splice Closure</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">From Element</label>
                                    <select value={cableForm.from_element_id || ''} onChange={e => setCableForm({ ...cableForm, from_element_id: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                                        <option value="">Select...</option>
                                        {(cableForm.from_element_type === 'splice_closure' ? closures : poles).map(p => <option key={p.id} value={p.id}>{'pole_tag' in p ? p.pole_tag : p.closure_tag}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">To Element Type</label>
                                    <select value={cableForm.to_element_type || 'pole'} onChange={e => setCableForm({ ...cableForm, to_element_type: e.target.value, to_element_id: '' })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                                        <option value="pole">Pole</option>
                                        <option value="splice_closure">Splice Closure</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">To Element</label>
                                    <select value={cableForm.to_element_id || ''} onChange={e => setCableForm({ ...cableForm, to_element_id: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                                        <option value="">Select...</option>
                                        {(cableForm.to_element_type === 'splice_closure' ? closures : poles).map(p => <option key={p.id} value={p.id}>{'pole_tag' in p ? p.pole_tag : p.closure_tag}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
                                <textarea value={cableForm.notes || ''} onChange={e => setCableForm({ ...cableForm, notes: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 p-6 border-t border-gray-200 dark:border-slate-700">
                            <button onClick={() => setShowCableModal(false)} className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg">Cancel</button>
                            <button onClick={saveCable} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">{editingCable ? 'Update' : 'Create'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Closure Modal */}
            {showClosureModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-slate-700">
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{editingClosure ? 'Edit Splice Closure' : 'Add Splice Closure'}</h2>
                            <button onClick={() => setShowClosureModal(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded"><XMarkIcon className="w-5 h-5 text-gray-500" /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Closure Tag *</label>
                                    <input type="text" value={closureForm.closure_tag || ''} onChange={e => setClosureForm({ ...closureForm, closure_tag: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Closure Type</label>
                                    <select value={closureForm.closure_type || 'aerial'} onChange={e => setClosureForm({ ...closureForm, closure_type: e.target.value as ClosureType })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                                        {CLOSURE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fiber Count</label>
                                    <input type="number" value={closureForm.fiber_count || 12} onChange={e => setClosureForm({ ...closureForm, fiber_count: parseInt(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">GPS Coordinates *</label>
                                    <input type="text" value={closureForm.gps || ''} onChange={e => setClosureForm({ ...closureForm, gps: e.target.value })} placeholder="14.5995, 120.9842" className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mounted on Pole</label>
                                <select value={closureForm.pole_id || ''} onChange={e => setClosureForm({ ...closureForm, pole_id: e.target.value || undefined })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                                    <option value="">None (standalone)</option>
                                    {poles.map(p => <option key={p.id} value={p.id}>{p.pole_tag}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Location / Address</label>
                                <input type="text" value={closureForm.location || ''} onChange={e => setClosureForm({ ...closureForm, location: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
                                <textarea value={closureForm.notes || ''} onChange={e => setClosureForm({ ...closureForm, notes: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 p-6 border-t border-gray-200 dark:border-slate-700">
                            <button onClick={() => setShowClosureModal(false)} className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg">Cancel</button>
                            <button onClick={saveClosure} className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700">{editingClosure ? 'Update' : 'Create'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FtthPlanner;
