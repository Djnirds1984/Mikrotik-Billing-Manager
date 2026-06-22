import React, { useState, useEffect, useCallback } from 'react';
import type { HotspotPlan, HotspotPlanData } from '../../types/hotspot.ts';
import { getHotspotPlans, createHotspotPlan, updateHotspotPlan, deleteHotspotPlan } from '../../services/hotspotControllerService.ts';
import { Loader } from '../Loader.tsx';

const DURATION_PRESETS = [
    { label: '30 min', seconds: 1800 },
    { label: '1 hour', seconds: 3600 },
    { label: '3 hours', seconds: 10800 },
    { label: '6 hours', seconds: 21600 },
    { label: '12 hours', seconds: 43200 },
    { label: '24 hours', seconds: 86400 },
];

interface Props {
    routerId: string;
}

export const HotspotPlanManager: React.FC<Props> = ({ routerId }) => {
    const [plans, setPlans] = useState<HotspotPlan[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingPlan, setEditingPlan] = useState<HotspotPlan | null>(null);

    // Form state
    const [formName, setFormName] = useState('');
    const [formDuration, setFormDuration] = useState(3600);
    const [formPrice, setFormPrice] = useState(0);
    const [formRateLimit, setFormRateLimit] = useState('');
    const [formSharedUsers, setFormSharedUsers] = useState(1);
    const [formCurrency, setFormCurrency] = useState('PHP');

    const fetchPlans = useCallback(async () => {
        if (!routerId) return;
        setIsLoading(true);
        setError(null);
        try {
            const data = await getHotspotPlans(routerId);
            setPlans(data);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsLoading(false);
        }
    }, [routerId]);

    useEffect(() => { fetchPlans(); }, [fetchPlans]);

    const openCreateModal = () => {
        setEditingPlan(null);
        setFormName('');
        setFormDuration(3600);
        setFormPrice(0);
        setFormRateLimit('');
        setFormSharedUsers(1);
        setFormCurrency('PHP');
        setIsModalOpen(true);
    };

    const openEditModal = (plan: HotspotPlan) => {
        setEditingPlan(plan);
        setFormName(plan.name);
        setFormDuration(plan.durationSeconds);
        setFormPrice(plan.price);
        setFormRateLimit(plan.rateLimit || '');
        setFormSharedUsers(plan.sharedUsers);
        setFormCurrency(plan.currency);
        setIsModalOpen(true);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            const data: HotspotPlanData = {
                routerId,
                name: formName,
                durationSeconds: formDuration,
                price: formPrice,
                rateLimit: formRateLimit || undefined,
                sharedUsers: formSharedUsers,
                currency: formCurrency,
            };
            if (editingPlan) {
                await updateHotspotPlan(editingPlan.id, data);
            } else {
                await createHotspotPlan(data);
            }
            setIsModalOpen(false);
            await fetchPlans();
        } catch (err) {
            alert(`Error: ${(err as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Delete this plan?')) return;
        try {
            await deleteHotspotPlan(id);
            await fetchPlans();
        } catch (err) {
            alert(`Error: ${(err as Error).message}`);
        }
    };

    const formatDuration = (s: number) => {
        if (s >= 86400) return `${Math.floor(s / 86400)}d`;
        if (s >= 3600) return `${Math.floor(s / 3600)}h`;
        return `${Math.floor(s / 60)}min`;
    };

    if (isLoading) return <div className="flex justify-center p-8"><Loader /></div>;

    return (
        <div>
            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg">
                        <form onSubmit={handleSave}>
                            <div className="p-6">
                                <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400] mb-4">
                                    {editingPlan ? 'Edit Plan' : 'Create New Plan'}
                                </h3>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Plan Name</label>
                                        <input type="text" value={formName} onChange={e => setFormName(e.target.value)} required
                                            placeholder="e.g. 1 Hour Basic"
                                            className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2 text-slate-900 dark:text-white" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Duration</label>
                                        <div className="flex flex-wrap gap-2 mt-1 mb-2">
                                            {DURATION_PRESETS.map(p => (
                                                <button key={p.seconds} type="button"
                                                    onClick={() => setFormDuration(p.seconds)}
                                                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${formDuration === p.seconds ? 'bg-[--color-primary-600] text-white' : 'bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-300'}`}
                                                >{p.label}</button>
                                            ))}
                                        </div>
                                        <input type="number" value={formDuration} onChange={e => setFormDuration(Number(e.target.value))}
                                            min={60} className="block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2 text-slate-900 dark:text-white"
                                            placeholder="Custom seconds" />
                                        <p className="text-xs text-slate-500 mt-1">= {formatDuration(formDuration)}</p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Price</label>
                                            <input type="number" value={formPrice} onChange={e => setFormPrice(Number(e.target.value))} step="0.01" min="0"
                                                className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2 text-slate-900 dark:text-white" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Currency</label>
                                            <select value={formCurrency} onChange={e => setFormCurrency(e.target.value)}
                                                className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2 text-slate-900 dark:text-white">
                                                <option value="PHP">PHP</option>
                                                <option value="USD">USD</option>
                                                <option value="EUR">EUR</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Rate Limit (rx/tx)</label>
                                            <input type="text" value={formRateLimit} onChange={e => setFormRateLimit(e.target.value)}
                                                placeholder="e.g. 5M/10M"
                                                className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2 text-slate-900 dark:text-white" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Shared Users</label>
                                            <input type="number" value={formSharedUsers} onChange={e => setFormSharedUsers(Number(e.target.value))} min="1"
                                                className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2 text-slate-900 dark:text-white" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-3 rounded-b-lg">
                                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 rounded-md text-slate-700 dark:text-slate-300">Cancel</button>
                                <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-[--color-primary-600] text-white rounded-md disabled:opacity-50">
                                    {isSubmitting ? 'Saving...' : 'Save'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Hotspot Plans ({plans.length})</h3>
                <button onClick={openCreateModal} className="bg-[--color-primary-600] text-white font-bold py-2 px-4 rounded-lg hover:bg-[--color-primary-500]">
                    Add Plan
                </button>
            </div>

            {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-600 dark:text-red-400">{error}</div>}

            {/* Table */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                            <tr>
                                <th className="px-6 py-3">Name</th>
                                <th className="px-6 py-3">Duration</th>
                                <th className="px-6 py-3">Price</th>
                                <th className="px-6 py-3">Rate Limit</th>
                                <th className="px-6 py-3">Shared</th>
                                <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {plans.length > 0 ? plans.map(plan => (
                                <tr key={plan.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <td className="px-6 py-4 font-medium text-slate-900 dark:text-slate-200">{plan.name}</td>
                                    <td className="px-6 py-4 font-mono text-slate-600 dark:text-slate-300">{formatDuration(plan.durationSeconds)}</td>
                                    <td className="px-6 py-4 font-mono text-green-600 dark:text-green-400">{plan.currency === 'PHP' ? '\u20B1' : '$'}{plan.price.toFixed(2)}</td>
                                    <td className="px-6 py-4 text-slate-600 dark:text-slate-300">{plan.rateLimit || 'N/A'}</td>
                                    <td className="px-6 py-4 text-slate-600 dark:text-slate-300">{plan.sharedUsers}</td>
                                    <td className="px-6 py-4 text-right space-x-2">
                                        <button onClick={() => openEditModal(plan)} className="text-[--color-primary-600] hover:text-[--color-primary-400] font-medium text-xs">Edit</button>
                                        <button onClick={() => handleDelete(plan.id)} className="text-red-600 hover:text-red-400 font-medium text-xs">Delete</button>
                                    </td>
                                </tr>
                            )) : (
                                <tr><td colSpan={6} className="text-center py-8 text-slate-500">No plans configured yet.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
