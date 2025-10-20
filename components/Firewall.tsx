// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import type { RouterConfigWithId, FirewallFilterRule, FirewallNatRule, FirewallMangleRule, FirewallRule, FirewallRuleData, Interface } from '../types.ts';
import { getFirewallFilter, addFirewallFilter, updateFirewallFilter, deleteFirewallFilter, getFirewallNat, addFirewallNat, updateFirewallNat, deleteFirewallNat, getFirewallMangle, addFirewallMangle, updateFirewallMangle, deleteFirewallMangle } from '../services/mikrotikService.ts';
import { Loader } from './Loader.tsx';
import { EditIcon, TrashIcon, ExclamationTriangleIcon } from '../constants.tsx';

const FIREWALL_CONSTANTS = {
    filter: {
        chains: ['input', 'forward', 'output'],
        actions: ['accept', 'add-dst-to-address-list', 'add-src-to-address-list', 'drop', 'fasttrack-connection', 'jump', 'log', 'passthrough', 'reject', 'return', 'tarpit'],
    },
    nat: {
        chains: ['srcnat', 'dstnat'],
        actions: ['accept', 'add-dst-to-address-list', 'add-src-to-address-list', 'dst-nat', 'jump', 'log', 'masquerade', 'netmap', 'passthrough', 'redirect', 'return', 'same', 'src-nat'],
    },
    mangle: {
        chains: ['prerouting', 'input', 'forward', 'output', 'postrouting'],
        actions: ['accept', 'add-dst-to-address-list', 'add-src-to-address-list', 'change-dscp', 'change-mss', 'change-ttl', 'clear-df', 'jump', 'log', 'mark-connection', 'mark-packet', 'mark-routing', 'passthrough', 'return', 'set-priority', 'strip-ipv4-options'],
    }
};

type RuleType = 'filter' | 'nat' | 'mangle';

const RuleFormModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (ruleData: FirewallRuleData, ruleId?: string) => void;
    initialData: FirewallRule | null;
    ruleType: RuleType;
    interfaces: Interface[];
    isLoading: boolean;
}> = ({ isOpen, onClose, onSave, initialData, ruleType, interfaces, isLoading }) => {

    const [rule, setRule] = useState<FirewallRuleData>({});

    useEffect(() => {
        if (isOpen) {
            const defaults = {
                chain: FIREWALL_CONSTANTS[ruleType].chains[0],
                action: FIREWALL_CONSTANTS[ruleType].actions[0],
                disabled: 'false'
            };
            setRule(initialData ? { ...initialData, disabled: initialData.disabled } : defaults);
        }
    }, [initialData, isOpen, ruleType]);

    if (!isOpen) return null;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type, checked } = e.target;
        if (type === 'checkbox') {
            setRule(r => ({ ...r, [name]: checked ? 'true' : 'false' }));
        } else {
            setRule(r => ({ ...r, [name]: value }));
        }
    };
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(rule, initialData?.id);
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-2xl border border-slate-200 dark:border-slate-700 flex flex-col max-h-[90vh]">
                <form onSubmit={handleSubmit}>
                    <div className="p-6 overflow-y-auto">
                        <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400] mb-4">{initialData ? 'Edit' : 'Add'} {ruleType.charAt(0).toUpperCase() + ruleType.slice(1)} Rule</h3>
                        <div className="space-y-4 text-sm">
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div><label className="block font-medium">Chain</label><select name="chain" value={rule.chain} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md p-2">{FIREWALL_CONSTANTS[ruleType].chains.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                                <div><label className="block font-medium">Action</label><select name="action" value={rule.action} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md p-2">{FIREWALL_CONSTANTS[ruleType].actions.map(a => <option key={a} value={a}>{a}</option>)}</select></div>
                            </div>
                            <div><label className="block font-medium">Comment</label><input type="text" name="comment" value={rule.comment || ''} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md p-2" /></div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div><label className="block font-medium">Src. Address</label><input type="text" name="src-address" value={rule['src-address'] || ''} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md p-2" /></div>
                                <div><label className="block font-medium">Dst. Address</label><input type="text" name="dst-address" value={rule['dst-address'] || ''} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md p-2" /></div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div><label className="block font-medium">In. Interface</label><select name="in-interface" value={rule['in-interface'] || ''} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md p-2"><option value="">any</option>{interfaces.map(i => <option key={i.name} value={i.name}>{i.name}</option>)}</select></div>
                                <div><label className="block font-medium">Out. Interface</label><select name="out-interface" value={rule['out-interface'] || ''} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md p-2"><option value="">any</option>{interfaces.map(i => <option key={i.name} value={i.name}>{i.name}</option>)}</select></div>
                            </div>
                           {/* Conditional fields */}
                            {ruleType === 'nat' && <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div><label className="block font-medium">To Addresses</label><input type="text" name="to-addresses" value={rule['to-addresses'] || ''} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md p-2" /></div>
                                <div><label className="block font-medium">To Ports</label><input type="text" name="to-ports" value={rule['to-ports'] || ''} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md p-2" /></div>
                            </div>}
                            {ruleType === 'mangle' && <div><label className="block font-medium">New Routing Mark</label><input type="text" name="new-routing-mark" value={rule['new-routing-mark'] || ''} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md p-2" /></div>}
                            <div className="flex items-center gap-2"><input type="checkbox" name="disabled" id="disabled" checked={rule.disabled === 'true'} onChange={handleChange} className="h-4 w-4 rounded" /><label htmlFor="disabled">Disabled</label></div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                        <button type="button" onClick={onClose} disabled={isLoading} className="px-4 py-2 text-sm font-medium rounded-md text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600">Cancel</button>
                        <button type="submit" disabled={isLoading} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-[--color-primary-600] hover:bg-[--color-primary-500]">{isLoading ? 'Saving...' : 'Save Rule'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export const Firewall: React.FC<{ selectedRouter: RouterConfigWithId; interfaces: Interface[] }> = ({ selectedRouter, interfaces }) => {
    const [activeTab, setActiveTab] = useState<RuleType>('filter');
    const [rules, setRules] = useState<Record<RuleType, FirewallRule[]>>({ filter: [], nat: [], mangle: [] });
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingRule, setEditingRule] = useState<FirewallRule | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [filter, nat, mangle] = await Promise.all([
                getFirewallFilter(selectedRouter),
                getFirewallNat(selectedRouter),
                getFirewallMangle(selectedRouter),
            ]);
            setRules({ filter, nat, mangle });
        } catch (err) {
            setError(`Failed to fetch firewall rules: ${(err as Error).message}`);
        } finally {
            setIsLoading(false);
        }
    }, [selectedRouter]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleSave = async (ruleData: FirewallRuleData, ruleId?: string) => {
        setIsSubmitting(true);
        try {
            const api = {
                filter: { add: addFirewallFilter, update: updateFirewallFilter },
                nat: { add: addFirewallNat, update: updateFirewallNat },
                mangle: { add: addFirewallMangle, update: updateFirewallMangle },
            }[activeTab];

            if (ruleId) {
                await api.update(selectedRouter, ruleId, ruleData);
            } else {
                await api.add(selectedRouter, ruleData);
            }
            setIsModalOpen(false);
            await fetchData();
        } catch (err) {
            alert(`Failed to save rule: ${(err as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleDelete = async (ruleId: string) => {
         if (!window.confirm("Are you sure you want to delete this firewall rule?")) return;
         setIsSubmitting(true);
         try {
             const api = {
                filter: deleteFirewallFilter,
                nat: deleteFirewallNat,
                mangle: deleteFirewallMangle,
             }[activeTab];
             await api(selectedRouter, ruleId);
             await fetchData();
         } catch(err) {
            alert(`Failed to delete rule: ${(err as Error).message}`);
         } finally {
            setIsSubmitting(false);
         }
    };

    const handleAdd = () => {
        setEditingRule(null);
        setIsModalOpen(true);
    };

    const handleEdit = (rule: FirewallRule) => {
        setEditingRule(rule);
        setIsModalOpen(true);
    };
    
    const formatBytes = (bytes) => {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const renderTable = () => {
        const currentRules = rules[activeTab];
        return (
             <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                            <tr>
                                <th className="px-4 py-3">#</th><th className="px-4 py-3">Chain</th><th className="px-4 py-3">Action</th>
                                <th className="px-4 py-3">Src/Dst Address</th><th className="px-4 py-3">Data</th><th className="px-4 py-3">Comment</th>
                                <th className="px-4 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {currentRules.map((rule, index) => (
                                <tr key={rule.id} className={`border-b border-slate-200 dark:border-slate-700 ${rule.disabled === 'true' ? 'opacity-50' : ''} ${rule.invalid === 'true' ? 'bg-red-50 dark:bg-red-900/20' : ''}`}>
                                    <td className="px-4 py-3">{index}</td>
                                    <td className="px-4 py-3 font-mono">{rule.chain}</td>
                                    <td className="px-4 py-3 font-mono">{rule.action}</td>
                                    <td className="px-4 py-3 font-mono text-xs">{rule['src-address'] || ''} &rarr; {rule['dst-address'] || ''}</td>
                                    <td className="px-4 py-3 font-mono text-xs">{formatBytes(rule.bytes)} / {rule.packets} pkts</td>
                                    <td className="px-4 py-3 italic text-slate-500">{rule.comment}</td>
                                    <td className="px-4 py-3 text-right"><button onClick={()=>handleEdit(rule)}><EditIcon className="h-5 w-5" /></button><button onClick={()=>handleDelete(rule.id)}><TrashIcon className="h-5 w-5" /></button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-4">
            <RuleFormModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSave} initialData={editingRule} ruleType={activeTab} interfaces={interfaces} isLoading={isSubmitting} />
             <div className="flex justify-between items-center">
                 <div className="flex border-b border-slate-200 dark:border-slate-700">
                    <button onClick={() => setActiveTab('filter')} className={`px-4 py-2 ${activeTab === 'filter' ? 'border-b-2 border-[--color-primary-500]' : ''}`}>Filter</button>
                    <button onClick={() => setActiveTab('nat')} className={`px-4 py-2 ${activeTab === 'nat' ? 'border-b-2 border-[--color-primary-500]' : ''}`}>NAT</button>
                    <button onClick={() => setActiveTab('mangle')} className={`px-4 py-2 ${activeTab === 'mangle' ? 'border-b-2 border-[--color-primary-500]' : ''}`}>Mangle</button>
                </div>
                <button onClick={handleAdd} className="bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-bold py-2 px-3 rounded-lg text-sm">Add Rule</button>
            </div>
            {isLoading ? <div className="flex justify-center p-8"><Loader /></div> : error ? <div className="p-4 text-red-600">{error}</div> : renderTable()}
        </div>
    );
};
