import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { RouterConfigWithId, VlanInterface, Interface, IpAddress, IpRoute, IpRouteData, WanRoute, FailoverStatus } from '../types.ts';
import { 
    getVlans, addVlan, deleteVlan, getInterfaces, getIpAddresses, getIpRoutes, 
    addIpRoute, updateIpRoute, deleteIpRoute, getWanRoutes, getWanFailoverStatus,
    setRouteProperty, configureWanFailover
} from '../services/mikrotikService.ts';
import { generateMultiWanScript } from '../services/geminiService.ts';
import { Loader } from './Loader.tsx';
import { RouterIcon, TrashIcon, VlanIcon, ShareIcon, EditIcon, ShieldCheckIcon } from '../constants.tsx';
import { CodeBlock } from './CodeBlock.tsx';
import { Firewall } from './Firewall.tsx';

// Reusable ToggleSwitch component
const ToggleSwitch: React.FC<{ checked: boolean; onChange: () => void; disabled?: boolean; }> = ({ checked, onChange, disabled }) => (
    <label className="relative inline-flex items-center cursor-pointer">
        <input
            type="checkbox"
            checked={checked}
            onChange={onChange}
            disabled={disabled}
            className="sr-only peer"
        />
        <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 rounded-full peer peer-focus:ring-2 peer-focus:ring-[--color-primary-500] peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[--color-primary-600] disabled:opacity-50"></div>
    </label>
);


// --- VLAN Add/Edit Modal ---
interface VlanFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (vlanData: Omit<VlanInterface, 'id'>) => void;
    interfaces: Interface[];
    isLoading: boolean;
}

const VlanFormModal: React.FC<VlanFormModalProps> = ({ isOpen, onClose, onSave, interfaces, isLoading }) => {
    const [vlanData, setVlanData] = useState({ name: '', 'vlan-id': '', interface: '' });

    useEffect(() => {
        if (isOpen) {
            // Reset form and select first available physical interface
            const firstPhysicalInterface = interfaces.find(i => i.type === 'ether' || i.type === 'sfp' || i.type === 'wlan')?.name || '';
            setVlanData({ name: '', 'vlan-id': '', interface: firstPhysicalInterface });
        }
    }, [isOpen, interfaces]);

    if (!isOpen) return null;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setVlanData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(vlanData);
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg border border-slate-200 dark:border-slate-700">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400] mb-4">Add New VLAN</h3>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">VLAN Name</label>
                                <input type="text" name="name" id="name" value={vlanData.name} onChange={handleChange} required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-[--color-primary-500]" placeholder="e.g., vlan10-guests" />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="vlan-id" className="block text-sm font-medium text-slate-700 dark:text-slate-300">VLAN ID</label>
                                    <input type="number" name="vlan-id" id="vlan-id" value={vlanData['vlan-id']} onChange={handleChange} min="1" max="4094" required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                                </div>
                                <div>
                                    <label htmlFor="interface" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Parent Interface</label>
                                    <select name="interface" id="interface" value={vlanData.interface} onChange={handleChange} required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-[--color-primary-500]">
                                        {interfaces.filter(i => i.type === 'ether' || i.type === 'sfp' || i.type === 'wlan' || i.type === 'bridge').map(i => <option key={i.name} value={i.name}>{i.name}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                        <button type="button" onClick={onClose} disabled={isLoading} className="px-4 py-2 text-sm font-medium rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
                        <button type="submit" disabled={isLoading} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-[--color-primary-600] hover:bg-[--color-primary-500]">
                            {isLoading ? 'Saving...' : 'Save VLAN'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- Route Add/Edit Modal ---
interface RouteFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (routeData: IpRouteData | (Partial<IpRouteData> & { id: string })) => void;
    initialData: IpRoute | null;
    isLoading: boolean;
}

const RouteFormModal: React.FC<RouteFormModalProps> = ({ isOpen, onClose, onSave, initialData, isLoading }) => {
    const [route, setRoute] = useState<Partial<IpRouteData>>({ 'dst-address': '0.0.0.0/0', gateway: '', distance: '1', comment: '' });

    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                setRoute({
                    'dst-address': initialData['dst-address'],
                    gateway: initialData.gateway || '',
                    distance: initialData.distance || '1',
                    comment: initialData.comment || ''
                });
            } else {
                setRoute({ 'dst-address': '0.0.0.0/0', gateway: '', distance: '1', comment: '' });
            }
        }
    }, [initialData, isOpen]);
    
    if (!isOpen) return null;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setRoute(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(initialData ? { ...route, id: initialData.id } : route as IpRouteData);
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg border border-slate-200 dark:border-slate-700">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400] mb-4">{initialData ? 'Edit IP Route' : 'Add New IP Route'}</h3>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="dst-address" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Destination Address</label>
                                <input type="text" name="dst-address" id="dst-address" value={route['dst-address']} onChange={handleChange} required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" placeholder="e.g., 0.0.0.0/0 or 192.168.10.0/24" />
                            </div>
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="gateway" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Gateway</label>
                                    <input type="text" name="gateway" id="gateway" value={route.gateway} onChange={handleChange} required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" placeholder="e.g., 192.168.88.1" />
                                </div>
                                <div>
                                    <label htmlFor="distance" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Distance</label>
                                    <input type="number" name="distance" id="distance" value={route.distance} onChange={handleChange} min="1" className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                                </div>
                            </div>
                            <div>
                                <label htmlFor="comment" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Comment</label>
                                <input type="text" name="comment" id="comment" value={route.comment} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                        <button type="button" onClick={onClose} disabled={isLoading} className="px-4 py-2 text-sm font-medium rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
                        <button type="submit" disabled={isLoading} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-[--color-primary-600] hover:bg-[--color-primary-500]">
                            {isLoading ? 'Saving...' : 'Save Route'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const TabButton: React.FC<{ label: string, icon: React.ReactNode, isActive: boolean, onClick: () => void }> = ({ label, icon, isActive, onClick }) => (
    <button
        onClick={onClick}
        className={`flex items-center px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors duration-200 focus:outline-none ${
            isActive
                ? 'border-[--color-primary-500] text-[--color-primary-500] dark:text-[--color-primary-400]'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
        }`}
    >
        {icon}
        <span className="ml-2">{label}</span>
    </button>
);

// --- WAN Failover Sub-component ---
const WanFailoverManager: React.FC<{ selectedRouter: RouterConfigWithId }> = ({ selectedRouter }) => {
    const [wanRoutes, setWanRoutes] = useState<WanRoute[]>([]);
    const [failoverStatus, setFailoverStatus] = useState<FailoverStatus | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isToggling, setIsToggling] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        // Don't set loading to true on refetch, only on initial load
        if (!wanRoutes.length) setIsLoading(true);
        setError(null);
        try {
            const [routes, status] = await Promise.all([
                getWanRoutes(selectedRouter),
                getWanFailoverStatus(selectedRouter)
            ]);
            setWanRoutes(routes);
            setFailoverStatus(status);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsLoading(false);
        }
    }, [selectedRouter, wanRoutes.length]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleToggleRoute = async (routeId: string, isDisabled: boolean) => {
        try {
            await setRouteProperty(selectedRouter, routeId, { disabled: isDisabled ? 'false' : 'true' });
            await fetchData();
        } catch (err) {
            alert(`Failed to toggle route: ${(err as Error).message}`);
        }
    };

    const handleToggleFailover = async () => {
        if (!failoverStatus) return;
        const confirmAction = window.confirm(`Are you sure you want to ${failoverStatus.enabled ? 'DISABLE' : 'ENABLE'} all WAN routes?`);
        if (!confirmAction) return;
        
        setIsToggling(true);
        try {
            await configureWanFailover(selectedRouter, !failoverStatus.enabled);
            await fetchData();
        } catch (err) {
            alert(`Failed to configure failover: ${(err as Error).message}`);
        } finally {
            setIsToggling(false);
        }
    };

    if (isLoading) return <div className="flex justify-center p-8"><Loader /></div>;
    if (error) return <div className="p-4 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg">{error}</div>;

    return (
        <div className="space-y-6">
            <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 flex justify-between items-center">
                <div>
                    <h4 className="font-semibold text-lg text-slate-800 dark:text-slate-200">Master Failover Switch</h4>
                    <p className="text-sm text-slate-500">Enable or disable all WAN routes that have `check-gateway` configured.</p>
                </div>
                <button 
                    onClick={handleToggleFailover} 
                    disabled={isToggling} 
                    className={`px-4 py-2 rounded-lg font-semibold text-white w-32 ${failoverStatus?.enabled ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'} disabled:opacity-50`}
                >
                    {isToggling ? 'Working...' : (failoverStatus?.enabled ? 'Disable All' : 'Enable All')}
                </button>
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
                 <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Monitored WAN Routes</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50">
                            <tr>
                                <th className="px-6 py-3">Gateway</th>
                                <th className="px-6 py-3">Check Method</th>
                                <th className="px-6 py-3">Distance</th>
                                <th className="px-6 py-3">Status</th>
                                <th className="px-6 py-3 text-center">Enabled</th>
                            </tr>
                        </thead>
                        <tbody>
                            {wanRoutes.map(route => (
                                <tr key={route.id} className="border-b dark:border-slate-700 last:border-0">
                                    <td className="px-6 py-4 font-mono text-cyan-600 dark:text-cyan-400">{route.gateway}</td>
                                    <td className="px-6 py-4 font-mono">{route['check-gateway']}</td>
                                    <td className="px-6 py-4 font-mono">{route.distance}</td>
                                    <td className="px-6 py-4">
                                        {/* FIX: Changed boolean check to string comparison for 'active' property. */}
                                        {route.active === 'true'
                                            ? <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-700">Active</span>
                                            : <span className="px-2 py-1 text-xs font-semibold rounded-full bg-slate-200 text-slate-600">Inactive</span>
                                        }
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        {/* FIX: Comparisons will now be correct as the underlying type is changed to string. */}
                                        <ToggleSwitch checked={route.disabled === 'false'} onChange={() => handleToggleRoute(route.id, route.disabled === 'true')} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};


// --- Main Component ---
export const Network: React.FC<{ selectedRouter: RouterConfigWithId | null }> = ({ selectedRouter }) => {
    const [activeTab, setActiveTab] = useState<'wan' | 'routes' | 'firewall' | 'aiwan'>('wan');
    const [vlans, setVlans] = useState<VlanInterface[]>([]);
    const [interfaces, setInterfaces] = useState<Interface[]>([]);
    const [ipAddresses, setIpAddresses] = useState<IpAddress[]>([]);
    const [routes, setRoutes] = useState<IpRoute[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isVlanModalOpen, setIsVlanModalOpen] = useState(false);
    const [isRouteModalOpen, setIsRouteModalOpen] = useState(false);
    const [editingRoute, setEditingRoute] = useState<IpRoute | null>(null);

    // Multi-WAN state
    const [wanInterfaces, setWanInterfaces] = useState('ether1, ether2');
    const [lanInterface, setLanInterface] = useState('');
    const [wanType, setWanType] = useState<'pcc' | 'pbr'>('pcc');
    const [wanScript, setWanScript] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);

    const fetchData = useCallback(async () => {
        if (!selectedRouter) {
            setIsLoading(false);
            setVlans([]);
            setInterfaces([]);
            setIpAddresses([]);
            setRoutes([]);
            return;
        }
        setIsLoading(true);
        setError(null);

        try {
            const [vlanData, interfaceData, ipData, routeData] = await Promise.all([
                getVlans(selectedRouter),
                getInterfaces(selectedRouter),
                getIpAddresses(selectedRouter),
                getIpRoutes(selectedRouter)
            ]);
            setVlans(vlanData);
            setInterfaces(interfaceData);
            setIpAddresses(ipData);
            setRoutes(routeData);
            
            // Set default LAN interface for multi-WAN form
            if (interfaceData.length > 0) {
                const defaultLan = interfaceData.find(i => i.type === 'bridge' && i.name.toLowerCase().includes('lan'))?.name || interfaceData.find(i => i.type === 'bridge')?.name || '';
                setLanInterface(defaultLan);
            }
        } catch (err) {
            console.error("Failed to fetch network data:", err);
            setError(`Could not fetch network data from "${selectedRouter.name}". Ensure the router is connected.`);
        } finally {
            setIsLoading(false);
        }
    }, [selectedRouter]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const sortedRoutes = useMemo(() => {
        return [...routes].sort((a, b) => {
            if (a['dst-address'] === '0.0.0.0/0') return -1;
            if (b['dst-address'] === '0.0.0.0/0') return 1;
            return a['dst-address'].localeCompare(b['dst-address']);
        });
    }, [routes]);

    const handleAddVlan = async (vlanData: Omit<VlanInterface, 'id'>) => {
        if (!selectedRouter) return;
        setIsSubmitting(true);
        try {
            await addVlan(selectedRouter, vlanData);
            setIsVlanModalOpen(false);
            await fetchData();
        } catch (err) {
            alert(`Error adding VLAN: ${(err as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteVlan = async (vlanId: string) => {
        if (!selectedRouter || !window.confirm("Are you sure you want to delete this VLAN interface?")) return;
        setIsSubmitting(true);
        try {
            await deleteVlan(selectedRouter, vlanId);
            await fetchData();
        } catch (err) {
            alert(`Error deleting VLAN: ${(err as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSaveRoute = async (routeData: IpRouteData | (Partial<IpRouteData> & { id: string })) => {
        if (!selectedRouter) return;
        setIsSubmitting(true);
        try {
            if ('id' in routeData) {
                const { id, ...dataToUpdate } = routeData;
                await updateIpRoute(selectedRouter, id, dataToUpdate);
            } else {
                await addIpRoute(selectedRouter, routeData as IpRouteData);
            }
            setIsRouteModalOpen(false);
            await fetchData();
        } catch (err) {
            alert(`Error saving route: ${(err as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteRoute = async (route: IpRoute) => {
        // FIX: Changed boolean checks to string comparisons for 'dynamic' and 'connected' properties.
        if (!selectedRouter || route.dynamic === 'true' || route.connected === 'true') return;
        if (window.confirm(`Are you sure you want to delete the route to "${route['dst-address']}"?`)) {
            setIsSubmitting(true);
            try {
                await deleteIpRoute(selectedRouter, route.id);
                await fetchData();
            } catch (err) {
                alert(`Error deleting route: ${(err as Error).message}`);
            } finally {
                setIsSubmitting(false);
            }
        }
    };

    const handleGenerateWanScript = async () => {
        if (!wanInterfaces.trim() || !lanInterface) {
            alert("Please specify at least one WAN interface and a LAN interface.");
            return;
        }
        setIsGenerating(true);
        setWanScript('');
        try {
            const wanList = wanInterfaces.split(',').map(i => i.trim()).filter(Boolean);
            const script = await generateMultiWanScript(wanList, lanInterface, wanType);
            setWanScript(script);
        } catch (err) {
            setWanScript(`# Error generating script: ${(err as Error).message}`);
        } finally {
            setIsGenerating(false);
        }
    };

    const wanIps = useMemo(() => {
        const wanNames = wanInterfaces.split(',').map(i => i.trim().toLowerCase());
        return ipAddresses
            .filter(ip => wanNames.includes(ip.interface.toLowerCase()))
            .map(ip => `${ip.interface} (${ip.address})`)
            .join(', ');
    }, [wanInterfaces, ipAddresses]);

    const lanIp = useMemo(() => {
        return ipAddresses.find(ip => ip.interface.toLowerCase() === lanInterface.toLowerCase())?.address || null;
    }, [lanInterface, ipAddresses]);
    
    if (!selectedRouter) {
        return (
            <div className="flex flex-col items-center justify-center h-96 text-center bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                <RouterIcon className="w-16 h-16 text-slate-400 dark:text-slate-600 mb-4" />
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">Network Management</h2>
                <p className="mt-2 text-slate-500 dark:text-slate-400">Please select a router to manage its network settings.</p>
            </div>
        );
    }
    
    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-64">
                <Loader />
                <p className="mt-4 text-[--color-primary-500] dark:text-[--color-primary-400]">Fetching network data from {selectedRouter.name}...</p>
            </div>
        );
    }
    
    if (error && (activeTab !== 'wan')) { // Let WAN tab handle its own errors
         return (
            <div className="flex flex-col items-center justify-center h-64 bg-white dark:bg-slate-800 rounded-lg border border-red-300 dark:border-red-700 p-6 text-center">
                <p className="text-xl font-semibold text-red-600 dark:text-red-400">Failed to load data.</p>
                <p className="mt-2 text-slate-500 dark:text-slate-400 text-sm">{error}</p>
            </div>
         );
    }

    const renderActiveTab = () => {
        switch(activeTab) {
            case 'wan':
                return <WanFailoverManager selectedRouter={selectedRouter} />;
            case 'routes':
                 return (
                    <div className="space-y-8">
                        {/* IP Routes Card */}
                        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
                            <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">IP Routes</h3>
                                <button onClick={() => { setEditingRoute(null); setIsRouteModalOpen(true); }} className="bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-bold py-2 px-3 rounded-lg text-sm">
                                    Add Route
                                </button>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                                        <tr>
                                            <th className="px-6 py-3">Destination</th><th className="px-6 py-3">Gateway</th><th className="px-6 py-3">Distance</th><th className="px-6 py-3">Status</th><th className="px-6 py-3">Comment</th><th className="px-6 py-3 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedRoutes.map(route => (
                                            <tr key={route.id} className="border-b border-slate-200 dark:border-slate-700 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                                <td className="px-6 py-4 font-mono text-slate-800 dark:text-slate-200">{route['dst-address']}</td>
                                                <td className="px-6 py-4 font-mono text-cyan-600 dark:text-cyan-400">{route.gateway}</td>
                                                <td className="px-6 py-4 font-mono">{route.distance}</td>
                                                {/* FIX: Changed boolean checks to string comparisons for 'active' and 'disabled' properties. */}
                                                <td className="px-6 py-4"><div className="flex items-center flex-wrap gap-1">
                                                    {route.active === 'true' && route.disabled === 'false' && <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400">Active</span>}
                                                    {route.active === 'false' && route.disabled === 'false' && <span className="px-2 py-1 text-xs font-semibold rounded-full bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-400">Inactive</span>}
                                                    {route.disabled === 'true' && <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400">Disabled</span>}
                                                </div></td>
                                                <td className="px-6 py-4 text-slate-500 italic">{route.comment}</td>
                                                <td className="px-6 py-4 text-right">
                                                    {/* FIX: Changed boolean checks to string comparisons for 'dynamic' and 'connected' properties. */}
                                                    <button onClick={() => { setEditingRoute(route); setIsRouteModalOpen(true); }} disabled={route.dynamic === 'true' || route.connected === 'true'} className="p-2 text-slate-500 dark:text-slate-400 hover:text-sky-500 rounded-md disabled:opacity-50"><EditIcon className="h-5 w-5" /></button>
                                                    <button onClick={() => handleDeleteRoute(route)} disabled={isSubmitting || route.dynamic === 'true' || route.connected === 'true'} className="p-2 text-slate-500 dark:text-slate-400 hover:text-red-500 rounded-md disabled:opacity-50"><TrashIcon className="h-5 w-5" /></button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        {/* VLAN Management Card */}
                        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
                            <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">VLAN Interfaces</h3>
                                <button onClick={() => setIsVlanModalOpen(true)} className="bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-bold py-2 px-3 rounded-lg text-sm">Add VLAN</button>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                     <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                                        <tr><th className="px-6 py-3">VLAN Name</th><th className="px-6 py-3">VLAN ID</th><th className="px-6 py-3">Parent Interface</th><th className="px-6 py-3 text-right">Actions</th></tr>
                                    </thead>
                                    <tbody>
                                        {vlans.map(vlan => (
                                            <tr key={vlan.id} className="border-b border-slate-200 dark:border-slate-700 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                                <td className="px-6 py-4 font-medium text-slate-900 dark:text-slate-200">{vlan.name}</td>
                                                <td className="px-6 py-4 font-mono text-cyan-600 dark:text-cyan-400">{vlan['vlan-id']}</td>
                                                <td className="px-6 py-4 font-mono text-slate-600 dark:text-slate-300">{vlan.interface}</td>
                                                <td className="px-6 py-4 text-right"><button onClick={() => handleDeleteVlan(vlan.id)} disabled={isSubmitting} className="p-2 text-slate-500 dark:text-slate-400 hover:text-red-500 rounded-md"><TrashIcon className="h-5 w-5" /></button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                 );
            case 'firewall':
                return <Firewall selectedRouter={selectedRouter} interfaces={interfaces} />;
            case 'aiwan':
                return (
                     <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3"><h3 className="text-lg font-semibold text-[--color-primary-500] dark:text-[--color-primary-400]">AI Multi-WAN Script Assistant</h3></div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
                            <div className="space-y-4">
                                <div>
                                    <label htmlFor="wanInterfaces" className="block text-sm font-medium text-slate-700 dark:text-slate-300">WAN Interfaces</label>
                                    <input type="text" name="wanInterfaces" id="wanInterfaces" value={wanInterfaces} onChange={e => setWanInterfaces(e.target.value)} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" placeholder="e.g., ether1, ether2, pppoe-out1"/>
                                    {wanIps && <p className="text-xs text-green-600 dark:text-green-400 mt-1 font-mono">Detected IPs: {wanIps}</p>}
                                </div>
                                 <div>
                                    <label htmlFor="lanInterface" className="block text-sm font-medium text-slate-700 dark:text-slate-300">LAN Interface</label>
                                    <select name="lanInterface" id="lanInterface" value={lanInterface} onChange={e => setLanInterface(e.target.value)} required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white">
                                         {interfaces.filter(i => i.type === 'bridge' || i.type === 'ether').map(i => <option key={i.name} value={i.name}>{i.name}</option>)}
                                    </select>
                                     {lanIp && <p className="text-xs text-green-600 dark:text-green-400 mt-1 font-mono">Detected IP: {lanIp}</p>}
                                </div>
                                <div>
                                    <label htmlFor="wanType" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Configuration Type</label>
                                    <select name="wanType" id="wanType" value={wanType} onChange={e => setWanType(e.target.value as 'pcc' | 'pbr')} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white">
                                        <option value="pcc">PCC - Load Balance (Merge Speed)</option><option value="pbr">PBR - Failover</option>
                                    </select>
                                </div>
                                <button onClick={handleGenerateWanScript} disabled={isGenerating} className="w-full bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center disabled:opacity-50">
                                    {isGenerating ? 'Generating...' : 'Generate Script'}
                                </button>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-2 border border-slate-200 dark:border-slate-700 min-h-[300px] relative">
                                {isGenerating && <div className="absolute inset-0 bg-slate-50/80 dark:bg-slate-900/80 flex items-center justify-center"><Loader /></div>}
                                <CodeBlock script={wanScript || '# Your generated multi-WAN script will appear here.'} />
                            </div>
                        </div>
                    </div>
                );
            default:
                return null;
        }
    }


    return (
        <div className="max-w-7xl mx-auto space-y-8">
            <VlanFormModal isOpen={isVlanModalOpen} onClose={() => setIsVlanModalOpen(false)} onSave={handleAddVlan} interfaces={interfaces} isLoading={isSubmitting} />
            <RouteFormModal isOpen={isRouteModalOpen} onClose={() => setIsRouteModalOpen(false)} onSave={handleSaveRoute} initialData={editingRoute} isLoading={isSubmitting} />
            
            <div className="border-b border-slate-200 dark:border-slate-700">
                <nav className="flex space-x-2" aria-label="Tabs">
                    <TabButton label="WAN & Failover" icon={<ShareIcon className="w-5 h-5" />} isActive={activeTab === 'wan'} onClick={() => setActiveTab('wan')} />
                    <TabButton label="Firewall" icon={<ShieldCheckIcon className="w-5 h-5" />} isActive={activeTab === 'firewall'} onClick={() => setActiveTab('firewall')} />
                    <TabButton label="Routes & VLANs" icon={<VlanIcon className="w-5 h-5" />} isActive={activeTab === 'routes'} onClick={() => setActiveTab('routes')} />
                    <TabButton label="AI Multi-WAN" icon={<span className="font-bold text-lg">AI</span>} isActive={activeTab === 'aiwan'} onClick={() => setActiveTab('aiwan')} />
                </nav>
            </div>

            <div className="mt-4">
                {renderActiveTab()}
            </div>
        </div>
    );
};
