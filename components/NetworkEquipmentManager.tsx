import React, { useState, useEffect, useCallback } from 'react';
import type { NetworkEquipment, OltPonPort, OltSplitter, OltNap, OltNapPort } from '../types.ts';
import { Loader } from './Loader.tsx';
import { EditIcon, TrashIcon, PlusIcon, XMarkIcon } from '../constants.tsx';

type Tab = 'equipment' | 'pon' | 'splitter' | 'nap' | 'topology';

const authHeaders = () => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('authToken')}` });

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
    const colors: Record<string, string> = {
        active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
        inactive: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
        maintenance: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
        available: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
        occupied: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
        faulty: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    };
    return <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${colors[status] || colors.inactive}`}>{status}</span>;
};

const OccupancyBar: React.FC<{ used: number; total: number }> = ({ used, total }) => {
    const pct = total > 0 ? Math.round((used / total) * 100) : 0;
    const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-green-500';
    return (
        <div className="flex items-center gap-2">
            <div className="w-24 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">{used}/{total}</span>
        </div>
    );
};

const TabButton: React.FC<{ label: string; isActive: boolean; onClick: () => void }> = ({ label, isActive, onClick }) => (
    <button onClick={onClick} className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${isActive ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
        {label}
    </button>
);

// ─── Equipment Form Modal ────────────────────────────────────────────
const EquipmentFormModal: React.FC<{
    isOpen: boolean; onClose: () => void; onSave: (data: Partial<NetworkEquipment>) => void;
    initialData: NetworkEquipment | null; isSubmitting: boolean;
}> = ({ isOpen, onClose, onSave, initialData, isSubmitting }) => {
    const [form, setForm] = useState<Partial<NetworkEquipment>>({});
    useEffect(() => {
        if (isOpen) {
            setForm(initialData || { name: '', type: 'olt', brand: 'huawei', status: 'active', total_pon_ports: 0, snmp_community: 'public', snmp_port: 161 });
        }
    }, [isOpen, initialData]);
    if (!isOpen) return null;
    const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave(form); };
    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg">
                <form onSubmit={handleSubmit}>
                    <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
                        <h3 className="text-lg font-bold">{initialData ? 'Edit Equipment' : 'Add Network Equipment'}</h3>
                        <div><label className="text-sm font-medium">Name *</label><input type="text" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /></div>
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="text-sm font-medium">Type</label><select value={form.type || 'olt'} onChange={e => setForm(f => ({ ...f, type: e.target.value as any }))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700"><option value="olt">OLT</option><option value="switch">Switch</option><option value="router">Router</option></select></div>
                            <div><label className="text-sm font-medium">Brand</label><select value={form.brand || ''} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700"><option value="">-- Select --</option><option value="huawei">Huawei</option><option value="zte">ZTE</option><option value="bdcom">BDCOM</option><option value="vsol">VSOL</option><option value="cdata">CDATA</option><option value="fiberhome">FiberHome</option><option value="nokia">Nokia (Alcatel-Lucent)</option><option value="calix">Calix</option><option value="dasan">Dasan</option><option value="generic">Generic / Other</option></select></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="text-sm font-medium">Model</label><input type="text" value={form.model || ''} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /></div>
                            <div><label className="text-sm font-medium">IP Address</label><input type="text" value={form.ip_address || ''} onChange={e => setForm(f => ({ ...f, ip_address: e.target.value }))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="text-sm font-medium">SNMP Community</label><input type="text" value={form.snmp_community || 'public'} onChange={e => setForm(f => ({ ...f, snmp_community: e.target.value }))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /></div>
                            <div><label className="text-sm font-medium">SNMP Port</label><input type="number" value={form.snmp_port || 161} onChange={e => setForm(f => ({ ...f, snmp_port: parseInt(e.target.value) || 161 }))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="text-sm font-medium">Total PON Ports</label><input type="number" value={form.total_pon_ports || 0} onChange={e => setForm(f => ({ ...f, total_pon_ports: parseInt(e.target.value) || 0 }))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /></div>
                            <div><label className="text-sm font-medium">Status</label><select value={form.status || 'active'} onChange={e => setForm(f => ({ ...f, status: e.target.value as any }))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700"><option value="active">Active</option><option value="inactive">Inactive</option><option value="maintenance">Maintenance</option></select></div>
                        </div>
                        <div><label className="text-sm font-medium">Notes</label><textarea value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /></div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-3">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md hover:bg-slate-200 dark:hover:bg-slate-700">Cancel</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">{isSubmitting ? 'Saving...' : 'Save'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// ─── PON Port Form Modal ────────────────────────────────────────────
const PonPortFormModal: React.FC<{
    isOpen: boolean; onClose: () => void; onSave: (data: Partial<OltPonPort>) => void;
    initialData: OltPonPort | null; isSubmitting: boolean;
}> = ({ isOpen, onClose, onSave, initialData, isSubmitting }) => {
    const [form, setForm] = useState<Partial<OltPonPort>>({});
    useEffect(() => { if (isOpen) setForm(initialData || { port_index: '', status: 'active' }); }, [isOpen, initialData]);
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-md">
                <form onSubmit={e => { e.preventDefault(); onSave(form); }}>
                    <div className="p-6 space-y-4">
                        <h3 className="text-lg font-bold">{initialData ? 'Edit PON Port' : 'Add PON Port'}</h3>
                        <div><label className="text-sm font-medium">Port Index * (e.g., 0/1/1)</label><input type="text" value={form.port_index || ''} onChange={e => setForm(f => ({ ...f, port_index: e.target.value }))} required className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /></div>
                        <div><label className="text-sm font-medium">Port Name</label><input type="text" value={form.port_name || ''} onChange={e => setForm(f => ({ ...f, port_name: e.target.value }))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /></div>
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="text-sm font-medium">Bandwidth (Mbps)</label><input type="number" value={form.total_bandwidth_mbps || ''} onChange={e => setForm(f => ({ ...f, total_bandwidth_mbps: parseInt(e.target.value) || undefined }))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /></div>
                            <div><label className="text-sm font-medium">Status</label><select value={form.status || 'active'} onChange={e => setForm(f => ({ ...f, status: e.target.value as any }))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700"><option value="active">Active</option><option value="inactive">Inactive</option><option value="maintenance">Maintenance</option></select></div>
                        </div>
                        <div><label className="text-sm font-medium">Notes</label><textarea value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /></div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-3">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md hover:bg-slate-200 dark:hover:bg-slate-700">Cancel</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">{isSubmitting ? 'Saving...' : 'Save'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// ─── Splitter Form Modal ────────────────────────────────────────────
const SplitterFormModal: React.FC<{
    isOpen: boolean; onClose: () => void; onSave: (data: Partial<OltSplitter>) => void;
    initialData: OltSplitter | null; isSubmitting: boolean; ponPorts: OltPonPort[];
}> = ({ isOpen, onClose, onSave, initialData, isSubmitting, ponPorts }) => {
    const [form, setForm] = useState<Partial<OltSplitter>>({});
    useEffect(() => { if (isOpen) setForm(initialData || { name: '', split_ratio: '1:8', status: 'active' }); }, [isOpen, initialData]);
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-md">
                <form onSubmit={e => { e.preventDefault(); onSave(form); }}>
                    <div className="p-6 space-y-4">
                        <h3 className="text-lg font-bold">{initialData ? 'Edit Splitter' : 'Add Splitter'}</h3>
                        <div><label className="text-sm font-medium">Name *</label><input type="text" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /></div>
                        <div><label className="text-sm font-medium">PON Port</label><select value={form.pon_port_id || ''} onChange={e => setForm(f => ({ ...f, pon_port_id: e.target.value }))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700"><option value="">-- None --</option>{ponPorts.map(p => <option key={p.id} value={p.id}>{p.port_index} {p.port_name || ''}</option>)}</select></div>
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="text-sm font-medium">Split Ratio</label><select value={form.split_ratio || '1:8'} onChange={e => setForm(f => ({ ...f, split_ratio: e.target.value }))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700"><option value="1:4">1:4</option><option value="1:8">1:8</option><option value="1:16">1:16</option><option value="1:32">1:32</option><option value="1:64">1:64</option></select></div>
                            <div><label className="text-sm font-medium">Status</label><select value={form.status || 'active'} onChange={e => setForm(f => ({ ...f, status: e.target.value as any }))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700"><option value="active">Active</option><option value="inactive">Inactive</option><option value="maintenance">Maintenance</option></select></div>
                        </div>
                        <div><label className="text-sm font-medium">Location</label><input type="text" value={form.location || ''} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /></div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-3">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md hover:bg-slate-200 dark:hover:bg-slate-700">Cancel</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">{isSubmitting ? 'Saving...' : 'Save'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// ─── NAP Form Modal ────────────────────────────────────────────
const NapFormModal: React.FC<{
    isOpen: boolean; onClose: () => void; onSave: (data: Partial<OltNap>) => void;
    initialData: OltNap | null; isSubmitting: boolean; splitters: OltSplitter[];
}> = ({ isOpen, onClose, onSave, initialData, isSubmitting, splitters }) => {
    const [form, setForm] = useState<Partial<OltNap>>({});
    useEffect(() => { if (isOpen) setForm(initialData || { name: '', total_ports: 8, status: 'active' }); }, [isOpen, initialData]);
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-md">
                <form onSubmit={e => { e.preventDefault(); onSave(form); }}>
                    <div className="p-6 space-y-4">
                        <h3 className="text-lg font-bold">{initialData ? 'Edit NAP' : 'Add NAP'}</h3>
                        <div><label className="text-sm font-medium">Name *</label><input type="text" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /></div>
                        <div><label className="text-sm font-medium">Splitter</label><select value={form.splitter_id || ''} onChange={e => setForm(f => ({ ...f, splitter_id: e.target.value }))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700"><option value="">-- None --</option>{splitters.map(s => <option key={s.id} value={s.id}>{s.name} ({s.split_ratio})</option>)}</select></div>
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="text-sm font-medium">Total Ports</label><input type="number" value={form.total_ports || 8} onChange={e => setForm(f => ({ ...f, total_ports: parseInt(e.target.value) || 8 }))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /></div>
                            <div><label className="text-sm font-medium">Status</label><select value={form.status || 'active'} onChange={e => setForm(f => ({ ...f, status: e.target.value as any }))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700"><option value="active">Active</option><option value="inactive">Inactive</option><option value="maintenance">Maintenance</option></select></div>
                        </div>
                        <div><label className="text-sm font-medium">Location</label><input type="text" value={form.location || ''} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /></div>
                        <div><label className="text-sm font-medium">GPS</label><input type="text" value={form.gps || ''} onChange={e => setForm(f => ({ ...f, gps: e.target.value }))} placeholder="lat, lng" className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /></div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-3">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md hover:bg-slate-200 dark:hover:bg-slate-700">Cancel</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">{isSubmitting ? 'Saving...' : 'Save'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// ─── NAP Port Detail Modal ────────────────────────────────────
const NapPortDetailModal: React.FC<{
    isOpen: boolean; onClose: () => void; nap: OltNap | null;
    onUpdatePort: (portId: string, data: Partial<OltNapPort>) => Promise<void>;
}> = ({ isOpen, onClose, nap, onUpdatePort }) => {
    const [ports, setPorts] = useState<OltNapPort[]>([]);
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        if (isOpen && nap) {
            setLoading(true);
            fetch(`/api/olt-nap-ports?nap_id=${nap.id}`, { headers: authHeaders() })
                .then(r => r.ok ? r.json() : []).then(data => { setPorts(Array.isArray(data) ? data : []); setLoading(false); })
                .catch(() => { setPorts([]); setLoading(false); });
        }
    }, [isOpen, nap]);
    if (!isOpen || !nap) return null;
    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                    <h3 className="text-lg font-bold">NAP Ports: {nap.name}</h3>
                    <button onClick={onClose}><XMarkIcon className="w-5 h-5" /></button>
                </div>
                <div className="p-4 overflow-y-auto flex-1">
                    {loading ? <Loader /> : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {ports.map(port => {
                                let clientInfo: any = null;
                                try { if (port.client_id) clientInfo = JSON.parse(port.client_id); } catch {}
                                return (
                                    <div key={port.id} className={`p-3 rounded-lg border text-sm ${port.status === 'occupied' ? 'border-green-300 bg-green-50 dark:bg-green-900/10 dark:border-green-800' : port.status === 'faulty' ? 'border-red-300 bg-red-50 dark:bg-red-900/10 dark:border-red-800' : 'border-slate-200 bg-slate-50 dark:bg-slate-700/50 dark:border-slate-600'}`}>
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="font-semibold">Port {port.port_number}</span>
                                            <StatusBadge status={port.status} />
                                        </div>
                                        {clientInfo && (
                                            <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                                                <p>{clientInfo.username || clientInfo.macAddress || 'Unknown'}</p>
                                                <p className="uppercase text-[10px]">{clientInfo.type}</p>
                                            </div>
                                        )}
                                        {port.onu_serial && <p className="text-xs text-slate-500 mt-1">ONU: {port.onu_serial}</p>}
                                        {port.onu_signal_dbm != null && <p className="text-xs text-slate-500">Signal: {port.onu_signal_dbm} dBm</p>}
                                        <div className="mt-2 flex gap-1">
                                            {port.status === 'available' && (
                                                <button onClick={() => onUpdatePort(port.id, { status: 'occupied' })} className="text-[10px] px-2 py-0.5 bg-green-600 text-white rounded">Mark Occupied</button>
                                            )}
                                            {port.status === 'occupied' && (
                                                <button onClick={() => onUpdatePort(port.id, { status: 'available', client_id: null })} className="text-[10px] px-2 py-0.5 bg-red-600 text-white rounded">Free Port</button>
                                            )}
                                            {port.status !== 'faulty' && (
                                                <button onClick={() => onUpdatePort(port.id, { status: 'faulty' })} className="text-[10px] px-2 py-0.5 bg-yellow-600 text-white rounded">Faulty</button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ─── Main Component ────────────────────────────────────────────
export const NetworkEquipmentManager: React.FC = () => {
    const [activeTab, setActiveTab] = useState<Tab>('equipment');
    const [equipment, setEquipment] = useState<NetworkEquipment[]>([]);
    const [ponPorts, setPonPorts] = useState<OltPonPort[]>([]);
    const [splitters, setSplitters] = useState<OltSplitter[]>([]);
    const [naps, setNaps] = useState<OltNap[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedEquipment, setSelectedEquipment] = useState<NetworkEquipment | null>(null);
    const [selectedPon, setSelectedPon] = useState<OltPonPort | null>(null);
    const [selectedSplitter, setSelectedSplitter] = useState<OltSplitter | null>(null);
    const [selectedNap, setSelectedNap] = useState<OltNap | null>(null);
    const [eqModalOpen, setEqModalOpen] = useState(false);
    const [ponModalOpen, setPonModalOpen] = useState(false);
    const [splitModalOpen, setSplitModalOpen] = useState(false);
    const [napModalOpen, setNapModalOpen] = useState(false);
    const [napPortModalOpen, setNapPortModalOpen] = useState(false);
    const [selectedOlForPon, setSelectedOlForPon] = useState<string>('');

    const safeArray = async (res: Response): Promise<any[]> => {
        if (!res.ok) return [];
        try { const data = await res.json(); return Array.isArray(data) ? data : []; }
        catch { return []; }
    };

    const fetchAll = useCallback(async () => {
        setIsLoading(true);
        try {
            const [eqRes, splRes, napRes] = await Promise.all([
                fetch('/api/network-equipment', { headers: authHeaders() }),
                fetch('/api/olt-splitters', { headers: authHeaders() }),
                fetch('/api/olt-naps', { headers: authHeaders() })
            ]);
            setEquipment(await safeArray(eqRes));
            setSplitters(await safeArray(splRes));
            setNaps(await safeArray(napRes));
            // Fetch PON ports for selected equipment or all
            if (selectedOlForPon) {
                const r = await fetch(`/api/network-equipment/${selectedOlForPon}/pon-ports`, { headers: authHeaders() });
                setPonPorts(await safeArray(r));
            }
        } catch (e) { console.error(e); }
        setIsLoading(false);
    }, [selectedOlForPon]);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    // Equipment CRUD
    const handleSaveEquipment = async (data: Partial<NetworkEquipment>) => {
        setIsSubmitting(true);
        try {
            const method = selectedEquipment ? 'PUT' : 'POST';
            const url = selectedEquipment ? `/api/network-equipment/${selectedEquipment.id}` : '/api/network-equipment';
            await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(data) });
            setEqModalOpen(false); setSelectedEquipment(null); fetchAll();
        } catch (e) { console.error(e); }
        setIsSubmitting(false);
    };
    const handleDeleteEquipment = async (id: string) => {
        if (!confirm('Delete this equipment and all related PON ports, splitters, NAPs?')) return;
        await fetch(`/api/network-equipment/${id}`, { method: 'DELETE', headers: authHeaders() });
        fetchAll();
    };

    // PON Port CRUD
    const handleSavePonPort = async (data: Partial<OltPonPort>) => {
        setIsSubmitting(true);
        try {
            const method = selectedPon ? 'PUT' : 'POST';
            const url = selectedPon ? `/api/olt-pon-ports/${selectedPon.id}` : `/api/network-equipment/${selectedOlForPon}/pon-ports`;
            await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(data) });
            setPonModalOpen(false); setSelectedPon(null); fetchAll();
        } catch (e) { console.error(e); }
        setIsSubmitting(false);
    };
    const handleDeletePonPort = async (id: string) => {
        if (!confirm('Delete this PON port and related splitters/NAPs?')) return;
        await fetch(`/api/olt-pon-ports/${id}`, { method: 'DELETE', headers: authHeaders() });
        fetchAll();
    };

    // Splitter CRUD
    const handleSaveSplitter = async (data: Partial<OltSplitter>) => {
        setIsSubmitting(true);
        try {
            const method = selectedSplitter ? 'PUT' : 'POST';
            const url = selectedSplitter ? `/api/olt-splitters/${selectedSplitter.id}` : '/api/olt-splitters';
            await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(data) });
            setSplitModalOpen(false); setSelectedSplitter(null); fetchAll();
        } catch (e) { console.error(e); }
        setIsSubmitting(false);
    };
    const handleDeleteSplitter = async (id: string) => {
        if (!confirm('Delete this splitter and related NAPs?')) return;
        await fetch(`/api/olt-splitters/${id}`, { method: 'DELETE', headers: authHeaders() });
        fetchAll();
    };

    // NAP CRUD
    const handleSaveNap = async (data: Partial<OltNap>) => {
        setIsSubmitting(true);
        try {
            const method = selectedNap ? 'PUT' : 'POST';
            const url = selectedNap ? `/api/olt-naps/${selectedNap.id}` : '/api/olt-naps';
            await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(data) });
            setNapModalOpen(false); setSelectedNap(null); fetchAll();
        } catch (e) { console.error(e); }
        setIsSubmitting(false);
    };
    const handleDeleteNap = async (id: string) => {
        if (!confirm('Delete this NAP and all its ports?')) return;
        await fetch(`/api/olt-naps/${id}`, { method: 'DELETE', headers: authHeaders() });
        fetchAll();
    };

    // NAP Port update
    const handleUpdateNapPort = async (portId: string, data: Partial<OltNapPort>) => {
        await fetch(`/api/olt-nap-ports/${portId}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(data) });
        // Refresh NAP ports in modal
        if (selectedNap) {
            const r = await fetch(`/api/olt-nap-ports?nap_id=${selectedNap.id}`, { headers: authHeaders() });
            const updated = await r.json();
            // Also refresh NAP list for used_ports
            fetchAll();
        }
    };

    // Load PON ports when equipment selected
    const handleSelectEquipmentForPon = async (eqId: string) => {
        setSelectedOlForPon(eqId);
        if (eqId) {
            const r = await fetch(`/api/network-equipment/${eqId}/pon-ports`, { headers: authHeaders() });
            setPonPorts(await safeArray(r));
        } else {
            setPonPorts([]);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">Network Equipment</h2>
            </div>
            <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
                <TabButton label="Equipment" isActive={activeTab === 'equipment'} onClick={() => setActiveTab('equipment')} />
                <TabButton label="PON Ports" isActive={activeTab === 'pon'} onClick={() => setActiveTab('pon')} />
                <TabButton label="Splitters" isActive={activeTab === 'splitter'} onClick={() => setActiveTab('splitter')} />
                <TabButton label="NAPs" isActive={activeTab === 'nap'} onClick={() => setActiveTab('nap')} />
                <TabButton label="Topology" isActive={activeTab === 'topology'} onClick={() => setActiveTab('topology')} />
            </div>

            {isLoading && <Loader />}

            {/* ─── Equipment Tab ─── */}
            {activeTab === 'equipment' && !isLoading && (
                <div>
                    <div className="mb-4"><button onClick={() => { setSelectedEquipment(null); setEqModalOpen(true); }} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700"><PlusIcon className="w-4 h-4" /> Add Equipment</button></div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-100 dark:bg-slate-800"><tr><th className="p-3 text-left">Name</th><th className="p-3 text-left">Brand</th><th className="p-3 text-left">Model</th><th className="p-3 text-left">IP</th><th className="p-3 text-left">PON Ports</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">Actions</th></tr></thead>
                            <tbody>
                                {equipment.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-500">No equipment added yet. Click "Add Equipment" to start.</td></tr>}
                                {equipment.map(eq => (
                                    <tr key={eq.id} className="border-t border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                        <td className="p-3 font-medium">{eq.name}</td>
                                        <td className="p-3 capitalize">{eq.brand || '-'}</td>
                                        <td className="p-3">{eq.model || '-'}</td>
                                        <td className="p-3 font-mono text-xs">{eq.ip_address || '-'}</td>
                                        <td className="p-3">{eq.total_pon_ports}</td>
                                        <td className="p-3"><StatusBadge status={eq.status} /></td>
                                        <td className="p-3 flex gap-2">
                                            <button onClick={() => { setSelectedEquipment(eq); setEqModalOpen(true); }} className="text-blue-600 hover:text-blue-800"><EditIcon className="w-4 h-4" /></button>
                                            <button onClick={() => handleDeleteEquipment(eq.id)} className="text-red-600 hover:text-red-800"><TrashIcon className="w-4 h-4" /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ─── PON Ports Tab ─── */}
            {activeTab === 'pon' && !isLoading && (
                <div>
                    <div className="mb-4 flex items-center gap-4">
                        <select value={selectedOlForPon} onChange={e => handleSelectEquipmentForPon(e.target.value)} className="p-2 rounded-md bg-slate-100 dark:bg-slate-700 text-sm">
                            <option value="">-- Select OLT --</option>
                            {equipment.map(eq => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
                        </select>
                        {selectedOlForPon && <button onClick={() => { setSelectedPon(null); setPonModalOpen(true); }} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700"><PlusIcon className="w-4 h-4" /> Add PON Port</button>}
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-100 dark:bg-slate-800"><tr><th className="p-3 text-left">Port Index</th><th className="p-3 text-left">Name</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">Bandwidth</th><th className="p-3 text-left">Actions</th></tr></thead>
                            <tbody>
                                {ponPorts.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-slate-500">{selectedOlForPon ? 'No PON ports yet.' : 'Select an OLT first.'}</td></tr>}
                                {ponPorts.map(pon => (
                                    <tr key={pon.id} className="border-t border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                        <td className="p-3 font-mono font-semibold">{pon.port_index}</td>
                                        <td className="p-3">{pon.port_name || '-'}</td>
                                        <td className="p-3"><StatusBadge status={pon.status} /></td>
                                        <td className="p-3">{pon.total_bandwidth_mbps ? `${pon.total_bandwidth_mbps} Mbps` : '-'}</td>
                                        <td className="p-3 flex gap-2">
                                            <button onClick={() => { setSelectedPon(pon); setPonModalOpen(true); }} className="text-blue-600 hover:text-blue-800"><EditIcon className="w-4 h-4" /></button>
                                            <button onClick={() => handleDeletePonPort(pon.id)} className="text-red-600 hover:text-red-800"><TrashIcon className="w-4 h-4" /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ─── Splitters Tab ─── */}
            {activeTab === 'splitter' && !isLoading && (
                <div>
                    <div className="mb-4"><button onClick={() => { setSelectedSplitter(null); setSplitModalOpen(true); }} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700"><PlusIcon className="w-4 h-4" /> Add Splitter</button></div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-100 dark:bg-slate-800"><tr><th className="p-3 text-left">Name</th><th className="p-3 text-left">Split Ratio</th><th className="p-3 text-left">Location</th><th className="p-3 text-left">Ports</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">Actions</th></tr></thead>
                            <tbody>
                                {splitters.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-500">No splitters added yet.</td></tr>}
                                {splitters.map(s => (
                                    <tr key={s.id} className="border-t border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                        <td className="p-3 font-medium">{s.name}</td>
                                        <td className="p-3 font-mono">{s.split_ratio}</td>
                                        <td className="p-3">{s.location || '-'}</td>
                                        <td className="p-3"><OccupancyBar used={s.installed_ports} total={s.max_ports} /></td>
                                        <td className="p-3"><StatusBadge status={s.status} /></td>
                                        <td className="p-3 flex gap-2">
                                            <button onClick={() => { setSelectedSplitter(s); setSplitModalOpen(true); }} className="text-blue-600 hover:text-blue-800"><EditIcon className="w-4 h-4" /></button>
                                            <button onClick={() => handleDeleteSplitter(s.id)} className="text-red-600 hover:text-red-800"><TrashIcon className="w-4 h-4" /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ─── NAPs Tab ─── */}
            {activeTab === 'nap' && !isLoading && (
                <div>
                    <div className="mb-4"><button onClick={() => { setSelectedNap(null); setNapModalOpen(true); }} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700"><PlusIcon className="w-4 h-4" /> Add NAP</button></div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-100 dark:bg-slate-800"><tr><th className="p-3 text-left">Name</th><th className="p-3 text-left">Splitter</th><th className="p-3 text-left">Location</th><th className="p-3 text-left">Port Usage</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">Actions</th></tr></thead>
                            <tbody>
                                {naps.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-500">No NAPs added yet.</td></tr>}
                                {naps.map(n => (
                                    <tr key={n.id} className="border-t border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                        <td className="p-3 font-medium">{n.name}</td>
                                        <td className="p-3">{n.splitter_name || '-'}</td>
                                        <td className="p-3">{n.location || '-'}</td>
                                        <td className="p-3"><OccupancyBar used={n.used_ports} total={n.total_ports} /></td>
                                        <td className="p-3"><StatusBadge status={n.status} /></td>
                                        <td className="p-3 flex gap-2">
                                            <button onClick={() => { setSelectedNap(n); setNapPortModalOpen(true); }} className="text-xs px-2 py-1 bg-slate-200 dark:bg-slate-600 rounded hover:bg-slate-300 dark:hover:bg-slate-500">View Ports</button>
                                            <button onClick={() => { setSelectedNap(n); setNapModalOpen(true); }} className="text-blue-600 hover:text-blue-800"><EditIcon className="w-4 h-4" /></button>
                                            <button onClick={() => handleDeleteNap(n.id)} className="text-red-600 hover:text-red-800"><TrashIcon className="w-4 h-4" /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ─── Topology Tab ─── */}
            {activeTab === 'topology' && (
                <NetworkTopologyPlaceholder equipment={equipment} />
            )}

            {/* ─── Modals ─── */}
            <EquipmentFormModal isOpen={eqModalOpen} onClose={() => { setEqModalOpen(false); setSelectedEquipment(null); }} onSave={handleSaveEquipment} initialData={selectedEquipment} isSubmitting={isSubmitting} />
            <PonPortFormModal isOpen={ponModalOpen} onClose={() => { setPonModalOpen(false); setSelectedPon(null); }} onSave={handleSavePonPort} initialData={selectedPon} isSubmitting={isSubmitting} />
            <SplitterFormModal isOpen={splitModalOpen} onClose={() => { setSplitModalOpen(false); setSelectedSplitter(null); }} onSave={handleSaveSplitter} initialData={selectedSplitter} isSubmitting={isSubmitting} ponPorts={ponPorts} />
            <NapFormModal isOpen={napModalOpen} onClose={() => { setNapModalOpen(false); setSelectedNap(null); }} onSave={handleSaveNap} initialData={selectedNap} isSubmitting={isSubmitting} splitters={splitters} />
            <NapPortDetailModal isOpen={napPortModalOpen} onClose={() => { setNapPortModalOpen(false); setSelectedNap(null); }} nap={selectedNap} onUpdatePort={handleUpdateNapPort} />
        </div>
    );
};

// ─── Topology Placeholder (will be replaced by full component in Task 6) ───
const NetworkTopologyPlaceholder: React.FC<{ equipment: NetworkEquipment[] }> = ({ equipment }) => {
    const [topology, setTopology] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setLoading(true);
        fetch('/api/network-topology', { headers: authHeaders() })
            .then(r => r.ok ? r.json() : { equipment: [] }).then(data => { setTopology(data); setLoading(false); })
            .catch(() => { setTopology({ equipment: [] }); setLoading(false); });
    }, [equipment]);

    if (loading) return <Loader />;
    if (!topology?.equipment?.length) return <div className="p-8 text-center text-slate-500">No topology data. Add equipment, PON ports, splitters, and NAPs first.</div>;

    return (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold">Network Topology Tree</h3>
            {topology.equipment.map((eq: any) => (
                <div key={eq.id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                        <StatusBadge status={eq.status} />
                        <span className="font-bold text-lg">{eq.name}</span>
                        <span className="text-xs text-slate-500 capitalize">({eq.brand || 'unknown'} {eq.model || ''})</span>
                    </div>
                    {eq.ponPorts?.map((pon: any) => (
                        <div key={pon.id} className="ml-4 border-l-2 border-blue-300 dark:border-blue-700 pl-4 mb-3">
                            <div className="flex items-center gap-2 mb-2">
                                <StatusBadge status={pon.status} />
                                <span className="font-semibold">PON {pon.port_index}</span>
                                {pon.port_name && <span className="text-xs text-slate-500">({pon.port_name})</span>}
                            </div>
                            {pon.splitter && (
                                <div className="ml-4 border-l-2 border-green-300 dark:border-green-700 pl-4 mb-2">
                                    <div className="flex items-center gap-2 mb-2">
                                        <StatusBadge status={pon.splitter.status} />
                                        <span className="font-semibold">{pon.splitter.name}</span>
                                        <span className="text-xs text-slate-500">({pon.splitter.split_ratio})</span>
                                        <OccupancyBar used={pon.splitter.installed_ports} total={pon.splitter.max_ports} />
                                    </div>
                                    {pon.splitter.naps?.map((nap: any) => (
                                        <div key={nap.id} className="ml-4 border-l-2 border-purple-300 dark:border-purple-700 pl-4 mb-2">
                                            <div className="flex items-center gap-2 mb-2">
                                                <StatusBadge status={nap.status} />
                                                <span className="font-semibold">{nap.name}</span>
                                                <OccupancyBar used={nap.used_ports} total={nap.total_ports} />
                                            </div>
                                            <div className="grid grid-cols-4 sm:grid-cols-8 gap-1">
                                                {nap.ports?.map((port: any) => (
                                                    <div key={port.id} className={`text-center p-1 rounded text-[10px] font-mono ${port.status === 'occupied' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400' : port.status === 'faulty' ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'}`} title={port.client_id ? JSON.parse(port.client_id || '{}').username || '' : 'Available'}>
                                                        {port.port_number}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
};

export default NetworkEquipmentManager;
