

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { RouterConfigWithId, Bridge, BridgePort, Interface, BridgeData, BridgePortData } from '../types.ts';
import {
    getBridges, addBridge, updateBridge, deleteBridge,
    getBridgePorts, addBridgePort, deleteBridgePort
} from '../services/mikrotikService.ts';
import { Loader } from './Loader.tsx';
// FIX: Import missing BridgeIcon component.
import { EditIcon, TrashIcon, BridgeIcon } from '../constants.tsx';

const ToggleSwitch: React.FC<{ checked: boolean; onChange: () => void; disabled?: boolean; }> = ({ checked, onChange, disabled }) => (
    <label className="relative inline-flex items-center cursor-pointer">
        <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} className="sr-only peer" />
        <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 rounded-full peer peer-focus:ring-2 peer-focus:ring-[--color-primary-500] peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[--color-primary-600] disabled:opacity-50"></div>
    </label>
);

const BridgeFormModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: BridgeData, id?: string) => void;
    initialData: Bridge | null;
    isLoading: boolean;
}> = ({ isOpen, onClose, onSave, initialData, isLoading }) => {
    const [bridge, setBridge] = useState<BridgeData>({});

    useEffect(() => {
        if (isOpen) {
            setBridge(initialData ? { ...initialData } : { name: '', 'vlan-filtering': 'false' });
        }
    }, [initialData, isOpen]);

    if (!isOpen) return null;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setBridge(b => ({ ...b, [e.target.name]: e.target.value }));
    };

    const handleToggle = (key: keyof BridgeData) => {
        setBridge(b => ({ ...b, [key]: b[key] === 'true' ? 'false' : 'true' }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(bridge, initialData?.id);
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold mb-4">{initialData ? `Edit Bridge "${initialData.name}"` : 'Add New Bridge'}</h3>
                        <div className="space-y-4">
                            <div><label>Name</label><input name="name" value={bridge.name || ''} onChange={handleChange} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded" /></div>
                            <div className="flex items-center justify-between"><label>VLAN Filtering</label><ToggleSwitch checked={bridge['vlan-filtering'] === 'true'} onChange={() => handleToggle('vlan-filtering')} /></div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-4">
                        <button type="button" onClick={onClose} disabled={isLoading}>Cancel</button>
                        <button type="submit" disabled={isLoading} className="px-4 py-2 bg-[--color-primary-600] text-white rounded disabled:opacity-50">{isLoading ? 'Saving...' : 'Save'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const BridgePortFormModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: BridgePortData) => void;
    bridgeName: string | null;
    interfaces: Interface[];
    isLoading: boolean;
}> = ({ isOpen, onClose, onSave, bridgeName, interfaces, isLoading }) => {
    const [port, setPort] = useState<BridgePortData>({});

    useEffect(() => {
        if (isOpen && bridgeName) {
            setPort({ bridge: bridgeName, interface: interfaces[0]?.name || '', pvid: '1' });
        }
    }, [isOpen, bridgeName, interfaces]);

    if (!isOpen) return null;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setPort(p => ({ ...p, [e.target.name]: e.target.value }));
    };
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(port);
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold mb-4">Add Port to "{bridgeName}"</h3>
                        <div className="space-y-4">
                            <div><label>Interface</label><select name="interface" value={port.interface} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded">{interfaces.map(i => <option key={i.id} value={i.name}>{i.name}</option>)}</select></div>
                            <div><label>PVID (VLAN ID)</label><input type="number" name="pvid" value={port.pvid} onChange={handleChange} min="1" className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded" /></div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-4">
                        <button type="button" onClick={onClose} disabled={isLoading}>Cancel</button>
                        <button type="submit" disabled={isLoading} className="px-4 py-2 bg-[--color-primary-600] text-white rounded disabled:opacity-50">{isLoading ? 'Adding...' : 'Add Port'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

interface BridgeManagerProps {
    selectedRouter: RouterConfigWithId;
    interfaces: Interface[];
    onDataChange: () => void;
}

export const BridgeManager: React.FC<BridgeManagerProps> = ({ selectedRouter, interfaces, onDataChange }) => {
    const [bridges, setBridges] = useState<Bridge[]>([]);
    const [ports, setPorts] = useState<BridgePort[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isBridgeModalOpen, setIsBridgeModalOpen] = useState(false);
    const [editingBridge, setEditingBridge] = useState<Bridge | null>(null);
    const [isPortModalOpen, setIsPortModalOpen] = useState(false);
    const [selectedBridgeForPort, setSelectedBridgeForPort] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [bridgesData, portsData] = await Promise.all([
                getBridges(selectedRouter),
                getBridgePorts(selectedRouter)
            ]);
            setBridges(bridgesData);
            setPorts(portsData);
        } catch (err) {
            setError(`Failed to fetch bridge data: ${(err as Error).message}`);
        } finally {
            setIsLoading(false);
        }
    }, [selectedRouter]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleSaveBridge = async (bridgeData: BridgeData, bridgeId?: string) => {
        setIsSubmitting(true);
        try {
            if (bridgeId) await updateBridge(selectedRouter, bridgeId, bridgeData);
            else await addBridge(selectedRouter, bridgeData);
            setIsBridgeModalOpen(false);
            await fetchData();
            onDataChange();
        } catch (err) { alert(`Failed to save bridge: ${(err as Error).message}`); }
        finally { setIsSubmitting(false); }
    };
    
    const handleDeleteBridge = async (bridge: Bridge) => {
        if (!window.confirm(`Are you sure you want to delete bridge "${bridge.name}"?`)) return;
        setIsSubmitting(true);
        try {
            await deleteBridge(selectedRouter, bridge.id);
            await fetchData();
            onDataChange();
        } catch(err) { alert(`Failed to delete bridge: ${(err as Error).message}`); }
        finally { setIsSubmitting(false); }
    };

    const handleSavePort = async (portData: BridgePortData) => {
        setIsSubmitting(true);
        try {
            await addBridgePort(selectedRouter, portData);
            setIsPortModalOpen(false);
            await fetchData();
            onDataChange();
        } catch (err) { alert(`Failed to add port: ${(err as Error).message}`); }
        finally { setIsSubmitting(false); }
    };

    const handleDeletePort = async (port: BridgePort) => {
         if (!window.confirm(`Remove interface "${port.interface}" from bridge "${port.bridge}"?`)) return;
         setIsSubmitting(true);
         try {
            await deleteBridgePort(selectedRouter, port.id);
            await fetchData();
            onDataChange();
         } catch(err) { alert(`Failed to remove port: ${(err as Error).message}`); }
         finally { setIsSubmitting(false); }
    };

    if (isLoading) return <div className="flex justify-center p-8"><Loader /></div>;
    if (error) return <div className="p-4 bg-red-100 text-red-700">{error}</div>;

    return (
        <div className="space-y-6">
            <BridgeFormModal isOpen={isBridgeModalOpen} onClose={() => setIsBridgeModalOpen(false)} onSave={handleSaveBridge} initialData={editingBridge} isLoading={isSubmitting} />
            <BridgePortFormModal isOpen={isPortModalOpen} onClose={() => setIsPortModalOpen(false)} onSave={handleSavePort} bridgeName={selectedBridgeForPort} interfaces={interfaces} isLoading={isSubmitting} />
            <div className="flex justify-end">
                <button onClick={() => { setEditingBridge(null); setIsBridgeModalOpen(true); }} className="bg-[--color-primary-600] text-white font-bold py-2 px-4 rounded-lg">Add Bridge</button>
            </div>
            
            {bridges.map(bridge => (
                <div key={bridge.id} className="bg-white dark:bg-slate-800 rounded-lg shadow-md border border-slate-200 dark:border-slate-700">
                    <div className="p-4 flex justify-between items-center border-b border-slate-200 dark:border-slate-700">
                        <div className="flex items-center gap-3">
                            <BridgeIcon className="w-6 h-6 text-[--color-primary-500]" />
                            <div>
                                <h4 className="font-bold text-lg">{bridge.name}</h4>
                                <span className="text-xs font-mono text-slate-500">{bridge['mac-address']}</span>
                            </div>
                        </div>
                        <div className="space-x-2">
                             <button onClick={() => { setEditingBridge(bridge); setIsBridgeModalOpen(true); }} className="p-2 text-slate-500 hover:text-sky-500"><EditIcon className="w-5 h-5"/></button>
                             <button onClick={() => handleDeleteBridge(bridge)} className="p-2 text-slate-500 hover:text-red-500"><TrashIcon className="w-5 h-5"/></button>
                        </div>
                    </div>
                    <div className="p-4">
                        <div className="flex justify-end mb-2">
                             <button onClick={() => { setSelectedBridgeForPort(bridge.name); setIsPortModalOpen(true); }} className="text-sm bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 px-3 py-1 rounded-md">Add Port</button>
                        </div>
                         <table className="w-full text-sm">
                             <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50"><tr><th className="px-4 py-2">Interface</th><th className="px-4 py-2">PVID</th><th className="px-4 py-2">HW Offload</th><th className="px-4 py-2 text-right">Actions</th></tr></thead>
                            <tbody>
                                {ports.filter(p => p.bridge === bridge.name).map(port => (
                                <tr key={port.id} className={`border-t dark:border-slate-700 ${port.disabled==='true' ? 'opacity-50':''}`}>
                                    <td className="px-4 py-2 font-mono">{port.interface}</td>
                                    <td className="px-4 py-2 font-mono">{port.pvid}</td>
                                    <td><span className={`px-2 py-1 text-xs font-semibold rounded-full ${port.hw==='true' ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>{port.hw === 'true' ? 'Yes' : 'No'}</span></td>
                                    <td className="px-4 py-2 text-right"><button onClick={() => handleDeletePort(port)} className="p-1"><TrashIcon className="w-4 h-4"/></button></td>
                                </tr>))}
                             </tbody>
                        </table>
                    </div>
                </div>
            ))}

            {bridges.length === 0 && (
                <div className="text-center py-12 text-slate-500">No bridge interfaces found.</div>
            )}
        </div>
    );
};