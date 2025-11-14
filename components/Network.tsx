import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { RouterConfigWithId, VlanInterface, Interface, IpAddress, IpRoute, IpRouteData, WanRoute, FailoverStatus, DhcpServer, DhcpLease, IpPool, DhcpServerData, DhcpServerSetupParams } from '../types.ts';
import { 
    getVlans, addVlan, deleteVlan, getInterfaces, getIpAddresses, getIpRoutes, 
    addIpRoute, updateIpRoute, deleteIpRoute, getWanRoutes, getWanFailoverStatus,
    setRouteProperty, configureWanFailover,
    getDhcpServers, addDhcpServer, updateDhcpServer, deleteDhcpServer,
    getDhcpLeases, makeLeaseStatic, deleteDhcpLease, runDhcpSetup, getIpPools,
    addIpPool, updateIpPool, deleteIpPool,
    setupFailoverRoutes, removeFailoverRoutes, setupDualWanPCC, setupMultiWanPCC
} from '../services/mikrotikService.ts';
import { generateMultiWanScript } from '../services/geminiService.ts';
import { Loader } from './Loader.tsx';
import { RouterIcon, TrashIcon, VlanIcon, ShareIcon, EditIcon, ShieldCheckIcon, ServerIcon, CircleStackIcon, BridgeIcon } from '../constants.tsx';
import { CodeBlock } from './CodeBlock.tsx';
import { Firewall } from './Firewall.tsx';
import { DhcpCaptivePortalInstaller } from './DhcpCaptivePortalInstaller.tsx';
import { BridgeManager } from './BridgeManager.tsx';


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

// --- DHCP Management Component & Sub-components ---
type DhcpView = 'servers' | 'leases' | 'installer';

const DhcpServerFormModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (serverData: DhcpServerData, serverId?: string) => void;
    initialData: DhcpServer | null;
    interfaces: Interface[];
    pools: IpPool[];
    isLoading: boolean;
}> = ({ isOpen, onClose, onSave, initialData, interfaces, pools, isLoading }) => {
    const [server, setServer] = useState<DhcpServerData>({});

    useEffect(() => {
        if (isOpen) {
            const defaults = {
                name: '',
                interface: interfaces.length > 0 ? interfaces[0].name : '',
                'address-pool': pools.length > 0 ? pools[0].name : 'none',
                'lease-time': '00:10:00',
                // FIX: Use 'as const' to ensure the type of 'disabled' is inferred as the literal 'false', not 'string'.
                disabled: 'false' as const
            };
            setServer(initialData ? { ...initialData } : defaults);
        }
    }, [initialData, isOpen, interfaces, pools]);
    
    if (!isOpen) return null;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setServer(s => ({...s, [name]: value}));
    };
    
    const handleToggle = () => {
        setServer(s => ({...s, disabled: s.disabled === 'true' ? 'false' : 'true'}));
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(server, initialData?.id);
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold mb-4">{initialData ? 'Edit DHCP Server' : 'Add DHCP Server'}</h3>
                        <div className="space-y-4">
                            <div><label>Server Name</label><input name="name" value={server.name} onChange={handleChange} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md"/></div>
                            <div><label>Interface</label><select name="interface" value={server.interface} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">{interfaces.map(i=><option key={i.id} value={i.name}>{i.name}</option>)}</select></div>
                            <div><label>Address Pool</label><select name="address-pool" value={server['address-pool']} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md"><option value="none">none</option>{pools.map(p=><option key={p.id} value={p.name}>{p.name}</option>)}</select></div>
                            <div><label>Lease Time</label><input name="lease-time" value={server['lease-time']} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md"/></div>
                            <div className="flex items-center gap-4"><label>Disabled</label><ToggleSwitch checked={server.disabled === 'true'} onChange={handleToggle}/></div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-4">
                        <button type="button" onClick={onClose} className="px-4 py-2 rounded-md">Cancel</button>
                        <button type="submit" disabled={isLoading} className="px-4 py-2 bg-[--color-primary-600] text-white rounded-md disabled:opacity-50">{isLoading ? 'Saving...' : 'Save'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};


const DhcpSmartInstaller: React.FC<{
    selectedRouter: RouterConfigWithId,
    interfaces: Interface[],
    onSuccess: () => void,
}> = ({ selectedRouter, interfaces, onSuccess }) => {
    const [params, setParams] = useState<DhcpServerSetupParams>({
        dhcpInterface: interfaces.find(i => i.type === 'bridge')?.name || interfaces[0]?.name || '',
        dhcpAddressSpace: '192.168.88.0/24',
        gateway: '192.168.88.1',
        addressPool: '192.168.88.2-192.168.88.254',
        dnsServers: '8.8.8.8,1.1.1.1',
        leaseTime: '00:10:00'
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');

    const getGatewayFromNetwork = (network: string): string => {
        if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(network)) return '';
        const ipParts = network.split('/')[0].split('.');
        ipParts[3] = '1';
        return ipParts.join('.');
    };
    
    const getPoolFromNetwork = (network: string): string => {
        if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(network)) return '';
        const [ip, cidrStr] = network.split('/');
        const ipParts = ip.split('.').map(Number);
        const cidr = parseInt(cidrStr, 10);
        if (cidr < 8 || cidr > 30) return '';
        const startIp = [...ipParts];
        startIp[3] = 2; 
        const ipAsInt = (ipParts[0] << 24 | ipParts[1] << 16 | ipParts[2] << 8 | ipParts[3]) >>> 0;
        const subnetMask = (0xffffffff << (32 - cidr)) >>> 0;
        const networkAddress = ipAsInt & subnetMask;
        const broadcastAddress = networkAddress | ~subnetMask;
        const endIpParts = [(broadcastAddress >> 24) & 255, (broadcastAddress >> 16) & 255, (broadcastAddress >> 8) & 255, (broadcastAddress & 255) - 1];
        return `${startIp.join('.')}-${endIpParts.join('.')}`;
    };
    
    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setParams(p => {
            const newParams = { ...p, [name]: value };
            if (name === 'dhcpAddressSpace') {
                newParams.gateway = getGatewayFromNetwork(value);
                newParams.addressPool = getPoolFromNetwork(value);
            }
            return newParams;
        });
    };
    
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError('');
        try {
            await runDhcpSetup(selectedRouter, params);
            alert('DHCP Server setup successful!');
            onSuccess();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="max-w-xl mx-auto">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md border border-slate-200 dark:border-slate-700">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="font-semibold">DHCP Smart Installer</h3>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {error && <div className="p-3 bg-red-100 text-red-700 rounded-md">{error}</div>}
                    <div><label className="text-sm font-medium">DHCP Server Interface</label><select name="dhcpInterface" value={params.dhcpInterface} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">{interfaces.map(i => <option key={i.id} value={i.name}>{i.name}</option>)}</select></div>
                    <div><label className="text-sm font-medium">DHCP Address Space</label><input name="dhcpAddressSpace" value={params.dhcpAddressSpace} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" /></div>
                    <div><label className="text-sm font-medium">Gateway for DHCP Network</label><input name="gateway" value={params.gateway} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" /></div>
                    <div><label className="text-sm font-medium">Addresses to Give Out</label><input name="addressPool" value={params.addressPool} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" /></div>
                    <div><label className="text-sm font-medium">DNS Servers</label><input name="dnsServers" value={params.dnsServers} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" /></div>
                    <div><label className="text-sm font-medium">Lease Time</label><input name="leaseTime" value={params.leaseTime} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" /></div>
                    <div className="flex justify-end pt-4"><button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-[--color-primary-600] text-white font-bold rounded-lg disabled:opacity-50">{isSubmitting ? 'Working...' : 'Run Setup'}</button></div>
                </form>
            </div>
        </div>
    );
};


const DhcpManager: React.FC<{ selectedRouter: RouterConfigWithId }> = ({ selectedRouter }) => {
    const [dhcpView, setDhcpView] = useState<DhcpView>('servers');
    const [servers, setServers] = useState<DhcpServer[]>([]);
    const [leases, setLeases] = useState<DhcpLease[]>([]);
    const [interfaces, setInterfaces] = useState<Interface[]>([]);
    const [pools, setPools] = useState<IpPool[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingServer, setEditingServer] = useState<DhcpServer | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [serversData, leasesData, interfacesData, poolsData] = await Promise.all([
                getDhcpServers(selectedRouter),
                getDhcpLeases(selectedRouter),
                getInterfaces(selectedRouter),
                getIpPools(selectedRouter)
            ]);
            setServers(serversData);
            setLeases(leasesData);
            setInterfaces(interfacesData);
            setPools(poolsData);
        } catch (err) {
            setError(`Failed to fetch DHCP data: ${(err as Error).message}`);
        } finally {
            setIsLoading(false);
        }
    }, [selectedRouter]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);
    
    const handleSaveServer = async (serverData: DhcpServerData, serverId?: string) => {
        setIsSubmitting(true);
        try {
            if (serverId) {
                await updateDhcpServer(selectedRouter, serverId, serverData);
            } else {
                await addDhcpServer(selectedRouter, serverData as Required<DhcpServerData>);
            }
            setIsModalOpen(false);
            await fetchData();
        } catch (err) {
            alert(`Failed to save server: ${(err as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleDeleteServer = async (serverId: string) => {
        if (!window.confirm("Are you sure?")) return;
        try {
            await deleteDhcpServer(selectedRouter, serverId);
            await fetchData();
        } catch (err) {
            alert(`Failed to delete server: ${(err as Error).message}`);
        }
    };

    const handleMakeStatic = async (leaseId: string) => {
        try {
            await makeLeaseStatic(selectedRouter, leaseId);
            await fetchData();
        } catch (err) {
             alert(`Failed to make lease static: ${(err as Error).message}`);
        }
    };
    
    const handleDeleteLease = async (leaseId: string) => {
        if (!window.confirm("Are you sure?")) return;
        try {
            await deleteDhcpLease(selectedRouter, leaseId);
            await fetchData();
        } catch (err) {
            alert(`Failed to delete lease: ${(err as Error).message}`);
        }
    };

    const getLeaseStatusChip = (status: string) => {
        switch (status) {
            case 'bound': return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400">Bound</span>;
            case 'waiting': return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400">Waiting</span>;
            default: return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-slate-200 dark:bg-slate-600/50 text-slate-600 dark:text-slate-400">{status}</span>;
        }
    };
    
    const renderContent = () => {
        if (isLoading) return <div className="flex justify-center p-8"><Loader /></div>
        if (error) return <div className="p-4 bg-red-100 text-red-700 rounded-md">{error}</div>

        switch(dhcpView) {
            case 'servers': return (
                <div>
                    <div className="flex justify-end mb-4"><button onClick={() => { setEditingServer(null); setIsModalOpen(true); }} className="bg-[--color-primary-600] text-white font-bold py-2 px-4 rounded-lg">Add Server</button></div>
                    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md overflow-hidden"><table className="w-full text-sm">
                        <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50"><tr><th className="px-6 py-3">Name</th><th className="px-6 py-3">Interface</th><th className="px-6 py-3">Address Pool</th><th className="px-6 py-3">Lease Time</th><th className="px-6 py-3">Status</th><th className="px-6 py-3 text-right">Actions</th></tr></thead>
                        <tbody>{servers.map(s => <tr key={s.id} className={`border-b dark:border-slate-700 ${s.disabled==='true' ? 'opacity-50':''}`}>
                            <td className="px-6 py-4">{s.name}</td><td>{s.interface}</td><td>{s['address-pool']}</td><td>{s['lease-time']}</td>
                            <td>{s.disabled==='true' ? <span className="text-red-500">Disabled</span> : <span className="text-green-500">Enabled</span>}</td>
                            <td className="px-6 py-4 text-right space-x-2"><button onClick={() => { setEditingServer(s); setIsModalOpen(true); }}><EditIcon className="w-5 h-5"/></button><button onClick={()=>handleDeleteServer(s.id)}><TrashIcon className="w-5 h-5"/></button></td>
                        </tr>)}</tbody>
                    </table></div>
                </div>
            );
            case 'leases': return (
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md overflow-hidden"><table className="w-full text-sm">
                    <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50"><tr><th className="px-6 py-3">IP Address</th><th className="px-6 py-3">MAC Address</th><th className="px-6 py-3">Server</th><th className="px-6 py-3">Status</th><th className="px-6 py-3">Type</th><th className="px-6 py-3 text-right">Actions</th></tr></thead>
                    <tbody>{leases.map(l => <tr key={l.id} className="border-b dark:border-slate-700">
                        <td className="px-6 py-4 font-mono">{l.address}</td><td className="font-mono">{l['mac-address']}</td><td>{l.server}</td><td>{getLeaseStatusChip(l.status)}</td>
                        <td>{l.dynamic==='true' ? 'Dynamic' : 'Static'}</td>
                        <td className="px-6 py-4 text-right space-x-2">
                            {l.dynamic === 'true' && <button onClick={() => handleMakeStatic(l.id)} className="text-sm text-sky-600">Make Static</button>}
                            <button onClick={()=>handleDeleteLease(l.id)}><TrashIcon className="w-5 h-5"/></button>
                        </td>
                    </tr>)}</tbody>
                </table></div>
            );
            case 'installer': return <DhcpSmartInstaller selectedRouter={selectedRouter} interfaces={interfaces} onSuccess={fetchData} />;
        }
    };

    return (
        <div className="space-y-4">
             <DhcpServerFormModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveServer} initialData={editingServer} interfaces={interfaces} pools={pools} isLoading={isSubmitting} />
             <div className="flex border-b border-slate-200 dark:border-slate-700">
                <button onClick={() => setDhcpView('servers')} className={`px-4 py-2 text-sm ${dhcpView === 'servers' ? 'border-b-2 border-[--color-primary-500]' : ''}`}>Servers</button>
                <button onClick={() => setDhcpView('leases')} className={`px-4 py-2 text-sm ${dhcpView === 'leases' ? 'border-b-2 border-[--color-primary-500]' : ''}`}>Leases</button>
                <button onClick={() => setDhcpView('installer')} className={`px-4 py-2 text-sm ${dhcpView === 'installer' ? 'border-b-2 border-[--color-primary-500]' : ''}`}>Smart Installer</button>
            </div>
            {renderContent()}
        </div>
    );
};


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
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const hasLoadedRef = useRef(false);

    // Interfaces for Netwatch/PCC setup
    const [interfaces, setInterfaces] = useState<Interface[]>([]);
    const [selectedWans, setSelectedWans] = useState<string[]>([]);
    const [healthHost, setHealthHost] = useState('8.8.8.8');
    const [healthInterval, setHealthInterval] = useState('00:00:10');

    const [wan1Interface, setWan1Interface] = useState('');
    const [wan2Interface, setWan2Interface] = useState('');
    const [lanInterface, setLanInterface] = useState('');
    const [wan1Gateway, setWan1Gateway] = useState('');
    const [wan2Gateway, setWan2Gateway] = useState('');

    // Multi-WAN PCC state (up to 10 WANs)
    const [pccSelectedWans, setPccSelectedWans] = useState<string[]>([]);
    const [pccWanGateways, setPccWanGateways] = useState<Record<string, string>>({});

    const fetchData = useCallback(async () => {
        if (!hasLoadedRef.current) {
            setIsLoading(true);
        } else {
            setIsRefreshing(true);
        }
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
            hasLoadedRef.current = true;
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, [selectedRouter]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        if (!autoRefresh || isEditing) return;
        const interval = setInterval(fetchData, 5000);
        return () => clearInterval(interval);
    }, [fetchData, autoRefresh, isEditing]);

    useEffect(() => {
        const loadInterfaces = async () => {
            try {
                const data = await getInterfaces(selectedRouter);
                setInterfaces(data);
            } catch (err) {
                // Non-fatal for the page; log in console
                console.warn('Failed to load interfaces for WAN setup:', (err as Error).message);
            }
        };
        loadInterfaces();
    }, [selectedRouter]);

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

    const handleNetwatchSetup = async () => {
        if (selectedWans.length < 1) {
            alert('Select at least one WAN interface.');
            return;
        }
        if (!wan1Gateway || !wan2Gateway) {
            alert('Please provide gateway IP addresses for both WAN interfaces.');
            return;
        }
        setIsToggling(true);
        try {
            // Use only routing-based failover with check-gateway (universal compatibility)
            await setupFailoverRoutes(selectedRouter, { routes: [
                { gateway: wan1Gateway, distance: 1, comment: `failover-route-${wan1Gateway}` },
                { gateway: wan2Gateway, distance: 2, comment: `failover-route-${wan2Gateway}` },
            ], checkGateway: 'ping' });
            alert('Configured route-based failover using check-gateway.');
        } catch (err) {
            alert(`Failed to configure failover: ${(err as Error).message}`);
        } finally {
            setIsToggling(false);
        }
    };

    const handleNetwatchRemove = async () => {
        if (selectedWans.length < 1) {
            alert('Select the WAN interfaces to remove failover entries for.');
            return;
        }
        if (!wan1Gateway && !wan2Gateway) {
            alert('No gateway information available to remove failover entries.');
            return;
        }
        setIsToggling(true);
        try {
            // Remove only route-based entries
            const targets = [] as string[];
            if (wan1Gateway) targets.push(wan1Gateway, `failover-route-${wan1Gateway}`);
            if (wan2Gateway) targets.push(wan2Gateway, `failover-route-${wan2Gateway}`);
            await removeFailoverRoutes(selectedRouter, { targets });
            alert('Route-based failover entries removed.');
        } catch (err) {
            alert(`Failed to remove failover entries: ${(err as Error).message}`);
        } finally {
            setIsToggling(false);
        }
    };

    const handlePccSetup = async () => {
        if (!wan1Interface || !wan2Interface || !lanInterface || !wan1Gateway || !wan2Gateway) {
            alert('Fill WAN1, WAN2, LAN, and both gateway IPs.');
            return;
        }
        setIsToggling(true);
        try {
            await setupDualWanPCC(selectedRouter, { wan1Interface, wan2Interface, lanInterface, wan1Gateway, wan2Gateway });
            alert('Dual-WAN PCC setup applied.');
        } catch (err) {
            alert(`Failed to set up PCC: ${(err as Error).message}`);
        } finally {
            setIsToggling(false);
        }
    };

    const handleMultiPccSetup = async () => {
        if (!lanInterface || pccSelectedWans.length < 2) {
            alert('Select LAN and at least two WAN interfaces.');
            return;
        }
        // Ensure each selected WAN has a gateway defined
        for (const w of pccSelectedWans) {
            if (!pccWanGateways[w]) {
                alert(`Missing gateway IP for ${w}.`);
                return;
            }
        }
        setIsToggling(true);
        try {
            await setupMultiWanPCC(selectedRouter, {
                wanInterfaces: pccSelectedWans.slice(0, 10),
                lanInterface,
                wanGateways: pccWanGateways,
            });
            alert(`Multi-WAN PCC setup applied for ${pccSelectedWans.length} WANs.`);
        } catch (err) {
            alert(`Failed to set up Multi-WAN PCC: ${(err as Error).message}`);
        } finally {
            setIsToggling(false);
        }
    };

    if (isLoading && !hasLoadedRef.current) return <div className="flex justify-center p-8"><Loader /></div>;
    if (error) return <div className="p-4 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg">{error}</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                    {isRefreshing ? 'Refreshing status…' : 'Status up to date.'}
                    {isEditing ? ' Editing paused auto-refresh.' : ''}
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-600 dark:text-slate-300">Auto-refresh</span>
                    <ToggleSwitch checked={autoRefresh && !isEditing} onChange={() => setAutoRefresh(prev => !prev)} />
                </div>
            </div>
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

            {/* Netwatch Auto-Disable Setup */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                    <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Automatic WAN Disable (Netwatch)</h3>
                </div>
                <div className="p-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="text-sm">Health Host</label>
                            <input value={healthHost} onChange={e=>{ setHealthHost(e.target.value); setIsEditing(true); }} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" placeholder="8.8.8.8" />
                        </div>
                        <div>
                            <label className="text-sm">Interval (hh:mm:ss)</label>
                            <input value={healthInterval} onChange={e=>{ setHealthInterval(e.target.value); setIsEditing(true); }} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" placeholder="00:00:10" />
                        </div>
                        <div>
                            <label className="text-sm">WAN Interfaces</label>
                            <div className="mt-1 bg-slate-100 dark:bg-slate-700 rounded-md p-2 max-h-36 overflow-y-auto">
                                {interfaces.filter(i=>i.type==='ether').map(intf=>{
                                    const checked = selectedWans.includes(intf.name);
                                    return (
                                        <label key={intf.id} className="flex items-center gap-2 text-sm py-1">
                                            <input type="checkbox" checked={checked} onChange={()=>{
                                                setSelectedWans(prev=> checked ? prev.filter(n=>n!==intf.name) : [...prev, intf.name]);
                                                setIsEditing(true);
                                            }} />
                                            <span className="font-mono">{intf.name}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                        <button onClick={handleNetwatchRemove} disabled={isToggling} className="px-4 py-2 bg-slate-200 dark:bg-slate-600 rounded-lg disabled:opacity-50">Remove</button>
                        <button onClick={handleNetwatchSetup} disabled={isToggling} className="px-4 py-2 bg-[--color-primary-600] text-white rounded-lg disabled:opacity-50">Apply</button>
                    </div>
                </div>
            </div>

            {/* Dual-WAN Merge (PCC) */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Dual-WAN Merge (PCC)</h3>
                    <p className="text-sm text-slate-500">Mark connections and load-balance traffic across two WANs.</p>
                </div>
                <div className="p-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="text-sm">WAN1 Interface</label>
                            <select value={wan1Interface} onChange={e=>{ setWan1Interface(e.target.value); setIsEditing(true); }} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">
                                <option value="">Select</option>
                                {interfaces.filter(i=>i.type==='ether').map(i=> <option key={i.id} value={i.name}>{i.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-sm">WAN2 Interface</label>
                            <select value={wan2Interface} onChange={e=>{ setWan2Interface(e.target.value); setIsEditing(true); }} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">
                                <option value="">Select</option>
                                {interfaces.filter(i=>i.type==='ether').map(i=> <option key={i.id} value={i.name}>{i.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-sm">LAN Interface</label>
                            <select value={lanInterface} onChange={e=>{ setLanInterface(e.target.value); setIsEditing(true); }} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">
                                <option value="">Select</option>
                                {interfaces.filter(i=> i.type==='bridge' || i.type==='ether').map(i=> <option key={i.id} value={i.name}>{i.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-sm">WAN1 Gateway IP</label>
                            <input value={wan1Gateway} onChange={e=>{ setWan1Gateway(e.target.value); setIsEditing(true); }} placeholder="192.168.1.1" className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                        </div>
                        <div>
                            <label className="text-sm">WAN2 Gateway IP</label>
                            <input value={wan2Gateway} onChange={e=>{ setWan2Gateway(e.target.value); setIsEditing(true); }} placeholder="192.168.2.1" className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                        </div>
                    </div>
                    <div className="flex justify-end">
                        <button onClick={handlePccSetup} disabled={isToggling} className="px-4 py-2 bg-[--color-primary-600] text-white rounded-lg disabled:opacity-50">Apply PCC Setup</button>
                    </div>
                    <div className="text-xs text-slate-500">
                        Tip: If FastTrack is enabled, disable it for proper PCC behavior.
                    </div>
                </div>
            </div>

            {/* Multi-WAN Merge (PCC up to 10 WANs) */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Multi-WAN Merge (PCC up to 10)</h3>
                    <p className="text-sm text-slate-500">Select multiple WANs, set gateways, and apply PCC across all.</p>
                </div>
                <div className="p-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="text-sm">LAN Interface</label>
                            <select value={lanInterface} onChange={e=>{ setLanInterface(e.target.value); setIsEditing(true); }} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">
                                <option value="">Select</option>
                                {interfaces.filter(i=> i.type==='bridge' || i.type==='ether').map(i=> <option key={i.id} value={i.name}>{i.name}</option>)}
                            </select>
                        </div>
                        <div className="md:col-span-2">
                            <label className="text-sm">WAN Interfaces (select up to 10)</label>
                            <div className="mt-1 bg-slate-100 dark:bg-slate-700 rounded-md p-2 max-h-36 overflow-y-auto">
                                {interfaces.filter(i=>i.type==='ether').map(intf=>{
                                    const checked = pccSelectedWans.includes(intf.name);
                                    return (
                                        <label key={intf.id} className="flex items-center gap-2 text-sm py-1">
                                            <input type="checkbox" checked={checked} onChange={()=>{
                                                setPccSelectedWans(prev=> {
                                                    const next = checked ? prev.filter(n=>n!==intf.name) : [...prev, intf.name];
                                                    return next.slice(0, 10);
                                                });
                                                setIsEditing(true);
                                            }} />
                                            <span className="font-mono">{intf.name}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                    {pccSelectedWans.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {pccSelectedWans.map(w=> (
                                <div key={w}>
                                    <label className="text-sm">Gateway for {w}</label>
                                    <input
                                        value={pccWanGateways[w] || ''}
                                        onChange={e=> { setPccWanGateways(prev=> ({ ...prev, [w]: e.target.value })); setIsEditing(true); }}
                                        placeholder="x.x.x.x"
                                        className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md"
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="flex justify-end">
                        <button onClick={handleMultiPccSetup} disabled={isToggling} className="px-4 py-2 bg-[--color-primary-600] text-white rounded-lg disabled:opacity-50">Apply Multi-WAN PCC</button>
                    </div>
                    <div className="text-xs text-slate-500">
                        Tip: Disable FastTrack if present; ensure each WAN gateway is reachable.
                    </div>
                </div>
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
                                        {route.active === 'true'
                                            ? <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-700">Active</span>
                                            : <span className="px-2 py-1 text-xs font-semibold rounded-full bg-slate-200 text-slate-600">Inactive</span>
                                        }
                                    </td>
                                    <td className="px-6 py-4 text-center">
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

// --- IP Pool Management Component & Sub-components ---
const PoolFormModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (poolData: Omit<IpPool, 'id'>, poolId?: string) => void;
    initialData: IpPool | null;
    isLoading: boolean;
}> = ({ isOpen, onClose, onSave, initialData, isLoading }) => {
    const [pool, setPool] = useState({ name: '', ranges: '' });

    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                setPool({ name: initialData.name, ranges: initialData.ranges });
            } else {
                setPool({ name: '', ranges: '' });
            }
        }
    }, [initialData, isOpen]);

    if (!isOpen) return null;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setPool(p => ({ ...p, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(pool, initialData?.id);
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold mb-4">{initialData ? 'Edit IP Pool' : 'Add New IP Pool'}</h3>
                        <div className="space-y-4">
                            <div>
                                <label>Pool Name</label>
                                <input name="name" value={pool.name} onChange={handleChange} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                            </div>
                            <div>
                                <label>Ranges</label>
                                <input name="ranges" value={pool.ranges} onChange={handleChange} required placeholder="e.g., 192.168.10.2-192.168.10.254" className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-4">
                        <button type="button" onClick={onClose} className="px-4 py-2 rounded-md">Cancel</button>
                        <button type="submit" disabled={isLoading} className="px-4 py-2 bg-[--color-primary-600] text-white rounded-md disabled:opacity-50">
                            {isLoading ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const IpPoolManager: React.FC<{ selectedRouter: RouterConfigWithId }> = ({ selectedRouter }) => {
    const [pools, setPools] = useState<IpPool[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingPool, setEditingPool] = useState<IpPool | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await getIpPools(selectedRouter);
            setPools(data);
        } catch (err) {
            setError(`Failed to fetch IP pools: ${(err as Error).message}`);
        } finally {
            setIsLoading(false);
        }
    }, [selectedRouter]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleSave = async (poolData: Omit<IpPool, 'id'>, poolId?: string) => {
        setIsSubmitting(true);
        try {
            if (poolId) {
                await updateIpPool(selectedRouter, poolId, poolData);
            } else {
                await addIpPool(selectedRouter, poolData);
            }
            setIsModalOpen(false);
            await fetchData();
        } catch (err) {
            alert(`Failed to save IP pool: ${(err as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (poolId: string) => {
        if (!window.confirm("Are you sure you want to delete this IP pool?")) return;
        try {
            await deleteIpPool(selectedRouter, poolId);
            await fetchData();
        } catch (err) {
            alert(`Failed to delete IP pool: ${(err as Error).message}`);
        }
    };

    if (isLoading) return <div className="flex justify-center p-8"><Loader /></div>;
    if (error) return <div className="p-4 bg-red-100 text-red-700 rounded-md">{error}</div>;

    return (
        <div>
            <PoolFormModal 
                isOpen={isModalOpen} 
                onClose={() => setIsModalOpen(false)} 
                onSave={handleSave} 
                initialData={editingPool} 
                isLoading={isSubmitting} 
            />
            <div className="flex justify-end mb-4">
                <button 
                    onClick={() => { setEditingPool(null); setIsModalOpen(true); }} 
                    className="bg-[--color-primary-600] hover:bg-[--color-primary-700] text-white font-bold py-2 px-4 rounded-lg"
                >
                    Add Pool
                </button>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50">
                        <tr>
                            <th className="px-6 py-3">Name</th>
                            <th className="px-6 py-3">Ranges</th>
                            <th className="px-6 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {pools.map(pool => (
                            <tr key={pool.id} className="border-b dark:border-slate-700">
                                <td className="px-6 py-4 font-medium">{pool.name}</td>
                                <td className="px-6 py-4 font-mono">{pool.ranges}</td>
                                <td className="px-6 py-4 text-right space-x-2">
                                    <button onClick={() => { setEditingPool(pool); setIsModalOpen(true); }} className="p-1"><EditIcon className="w-5 h-5"/></button>
                                    <button onClick={() => handleDelete(pool.id)} className="p-1"><TrashIcon className="w-5 h-5"/></button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};


// --- Main Component ---
type ActiveTab = 'wan' | 'routes' | 'firewall' | 'aiwan' | 'dhcp' | 'pools' | 'bridge';

export const Network: React.FC<{ selectedRouter: RouterConfigWithId | null }> = ({ selectedRouter }) => {
    const [activeTab, setActiveTab] = useState<ActiveTab>('wan');
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
    
    if (isLoading && activeTab !== 'dhcp' && activeTab !== 'pools') { // Let DHCP/Pool manager handle its own loading
        return (
            <div className="flex flex-col items-center justify-center h-64">
                <Loader />
                <p className="mt-4 text-[--color-primary-500] dark:text-[--color-primary-400]">Fetching network data from {selectedRouter.name}...</p>
            </div>
        );
    }
    
    if (error && (activeTab !== 'wan' && activeTab !== 'dhcp' && activeTab !== 'pools')) { 
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
                                                <td className="px-6 py-4"><div className="flex items-center flex-wrap gap-1">
                                                    {route.active === 'true' && route.disabled === 'false' && <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400">Active</span>}
                                                    {route.active === 'false' && route.disabled === 'false' && <span className="px-2 py-1 text-xs font-semibold rounded-full bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-400">Inactive</span>}
                                                    {route.disabled === 'true' && <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400">Disabled</span>}
                                                </div></td>
                                                <td className="px-6 py-4 text-slate-500 italic">{route.comment}</td>
                                                <td className="px-6 py-4 text-right">
                                                    <button onClick={() => { setEditingRoute(route); setIsRouteModalOpen(true); }} disabled={route.dynamic === 'true' || route.connected === 'true'} className="p-2 text-slate-500 dark:text-slate-400 hover:text-sky-500 rounded-md disabled:opacity-50"><EditIcon className="h-5 w-5" /></button>
                                                    <button onClick={() => handleDeleteRoute(route)} disabled={isSubmitting || route.dynamic === 'true' || route.connected === 'true'} className="p-2 text-slate-500 dark:text-slate-400 hover:text-red-500 rounded-md disabled:opacity-50"><TrashIcon className="h-5 w-5" /></button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
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
            case 'dhcp':
                return <DhcpManager selectedRouter={selectedRouter} />;
            case 'pools':
                return <IpPoolManager selectedRouter={selectedRouter} />;
            case 'bridge':
                return <BridgeManager selectedRouter={selectedRouter} interfaces={interfaces} onDataChange={fetchData} />;
            default:
                return null;
        }
    }

    return (
        <div className="max-w-7xl mx-auto space-y-8">
            <VlanFormModal isOpen={isVlanModalOpen} onClose={() => setIsVlanModalOpen(false)} onSave={handleAddVlan} interfaces={interfaces} isLoading={isSubmitting} />
            <RouteFormModal isOpen={isRouteModalOpen} onClose={() => setIsRouteModalOpen(false)} onSave={handleSaveRoute} initialData={editingRoute} isLoading={isSubmitting} />
            
            <div className="border-b border-slate-200 dark:border-slate-700">
                <nav className="flex space-x-2 overflow-x-auto" aria-label="Tabs">
                    <TabButton label="WAN & Failover" icon={<ShareIcon className="w-5 h-5" />} isActive={activeTab === 'wan'} onClick={() => setActiveTab('wan')} />
                    <TabButton label="Firewall" icon={<ShieldCheckIcon className="w-5 h-5" />} isActive={activeTab === 'firewall'} onClick={() => setActiveTab('firewall')} />
                    <TabButton label="Routes & VLANs" icon={<VlanIcon className="w-5 h-5" />} isActive={activeTab === 'routes'} onClick={() => setActiveTab('routes')} />
                    <TabButton label="Bridge" icon={<BridgeIcon className="w-5 h-5" />} isActive={activeTab === 'bridge'} onClick={() => setActiveTab('bridge')} />
                    <TabButton label="AI Multi-WAN" icon={<span className="font-bold text-lg">AI</span>} isActive={activeTab === 'aiwan'} onClick={() => setActiveTab('aiwan')} />
                    <TabButton label="DHCP" icon={<ServerIcon className="w-5 h-5" />} isActive={activeTab === 'dhcp'} onClick={() => setActiveTab('dhcp')} />
                    <TabButton label="IP Pools" icon={<CircleStackIcon className="w-5 h-5" />} isActive={activeTab === 'pools'} onClick={() => setActiveTab('pools')} />
                </nav>
            </div>

            <div className="mt-4">
                {renderActiveTab()}
            </div>
        </div>
    );
};
