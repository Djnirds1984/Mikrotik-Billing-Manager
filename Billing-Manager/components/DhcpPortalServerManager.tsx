import React, { useState, useEffect, useCallback } from 'react';
import type { RouterConfigWithId, DhcpServer, DhcpServerData, Interface, IpPool } from '../types.ts';
import { getDhcpServers, addDhcpServer, updateDhcpServer, deleteDhcpServer, getInterfaces, getIpPools } from '../services/mikrotikService.ts';
import { Loader } from './Loader.tsx';
import { EditIcon, TrashIcon, CheckCircleIcon } from '../constants.tsx';

const PORTAL_SCRIPT_NAME = "dhcp-lease-add-to-pending";

const ToggleSwitch: React.FC<{ checked: boolean; onChange: () => void; disabled?: boolean; }> = ({ checked, onChange, disabled }) => (
    <label className="relative inline-flex items-center cursor-pointer">
        <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} className="sr-only peer" />
        <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 rounded-full peer peer-focus:ring-2 peer-focus:ring-[--color-primary-500] peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[--color-primary-600] disabled:opacity-50"></div>
    </label>
);

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
            const defaults: DhcpServerData = {
                name: '',
                interface: interfaces.length > 0 ? interfaces[0].name : '',
                'address-pool': pools.length > 0 ? pools[0].name : 'none',
                'lease-time': '00:10:00',
                'lease-script': PORTAL_SCRIPT_NAME,
                disabled: 'false'
            };
            setServer(initialData ? { ...initialData } : defaults);
        }
    }, [initialData, isOpen, interfaces, pools]);

    if (!isOpen) return null;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setServer(s => ({ ...s, [name]: value }));
    };

    const handleToggle = (key: 'disabled' | 'lease-script') => {
        if (key === 'disabled') {
            setServer(s => ({ ...s, disabled: s.disabled === 'true' ? 'false' : 'true' }));
        } else if (key === 'lease-script') {
            setServer(s => ({...s, 'lease-script': s['lease-script'] === PORTAL_SCRIPT_NAME ? 'none' : PORTAL_SCRIPT_NAME }));
        }
    };

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
                            <div><label>Server Name</label><input name="name" value={server.name} onChange={handleChange} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" /></div>
                            <div><label>Interface</label><select name="interface" value={server.interface} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">{interfaces.map(i => <option key={i.id} value={i.name}>{i.name}</option>)}</select></div>
                            <div><label>Address Pool</label><select name="address-pool" value={server['address-pool']} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md"><option value="none">none</option>{pools.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}</select></div>
                            <div><label>Lease Time</label><input name="lease-time" value={server['lease-time']} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" /></div>
                            <div className="flex items-center justify-between"><label>Enable Captive Portal</label><ToggleSwitch checked={server['lease-script'] === PORTAL_SCRIPT_NAME} onChange={() => handleToggle('lease-script')} /></div>
                            <div className="flex items-center justify-between"><label>Disabled</label><ToggleSwitch checked={server.disabled === 'true'} onChange={() => handleToggle('disabled')} /></div>
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


export const DhcpPortalServerManager: React.FC<{ selectedRouter: RouterConfigWithId }> = ({ selectedRouter }) => {
    const [servers, setServers] = useState<DhcpServer[]>([]);
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
            const [serversData, interfacesData, poolsData] = await Promise.all([
                getDhcpServers(selectedRouter),
                getInterfaces(selectedRouter),
                getIpPools(selectedRouter)
            ]);
            setServers(serversData);
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

    if (isLoading) return <div className="flex justify-center p-8"><Loader /></div>
    if (error) return <div className="p-4 bg-red-100 text-red-700 rounded-md">{error}</div>

    return (
        <div className="space-y-6">
            <DhcpServerFormModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveServer} initialData={editingServer} interfaces={interfaces} pools={pools} isLoading={isSubmitting} />
            <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">DHCP Portal Servers</h2>
            <p className="text-sm text-slate-500 -mt-4">Manage DHCP servers and toggle the captive portal script on them.</p>

            <div className="flex justify-end mb-4">
                <button onClick={() => { setEditingServer(null); setIsModalOpen(true); }} className="bg-[--color-primary-600] hover:bg-[--color-primary-700] text-white font-bold py-2 px-4 rounded-lg">Add Server</button>
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50">
                            <tr>
                                <th className="px-6 py-3">Status</th>
                                <th className="px-6 py-3">Name</th>
                                <th className="px-6 py-3">Interface</th>
                                <th className="px-6 py-3">Address Pool</th>
                                <th className="px-6 py-3">Portal Enabled</th>
                                <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {servers.map(s => {
                                const isPortalEnabled = s['lease-script'] === PORTAL_SCRIPT_NAME;
                                return (
                                <tr key={s.id} className={`border-b dark:border-slate-700 ${s.disabled === 'true' ? 'opacity-50' : ''}`}>
                                    <td className="px-6 py-4">{s.disabled === 'true' ? <span className="text-red-500">Disabled</span> : <span className="text-green-500">Enabled</span>}</td>
                                    <td className="px-6 py-4 font-semibold">{s.name}</td>
                                    <td className="px-6 py-4 font-mono">{s.interface}</td>
                                    <td className="px-6 py-4 font-mono">{s['address-pool']}</td>
                                    <td className="px-6 py-4">
                                        {isPortalEnabled ? (
                                            <span className="flex items-center gap-1 text-green-600 dark:text-green-400 font-semibold"><CheckCircleIcon className="w-5 h-5" /> Yes</span>
                                        ) : (
                                            <span className="text-slate-500">No</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-right space-x-2">
                                        <button onClick={() => { setEditingServer(s); setIsModalOpen(true); }} className="p-2 text-slate-500 hover:text-sky-500"><EditIcon className="w-5 h-5" /></button>
                                        <button onClick={() => handleDeleteServer(s.id)} className="p-2 text-slate-500 hover:text-red-500"><TrashIcon className="w-5 h-5" /></button>
                                    </td>
                                </tr>
                            )})}
                            {servers.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="text-center py-8 text-slate-500">No DHCP servers found on this router.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};