import React, { useState } from 'react';
import type { DhcpBillingPlan, DhcpBillingPlanWithId, RouterConfigWithId } from '../types.ts';
import { useDhcpBillingPlans } from '../hooks/useDhcpBillingPlans.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { Loader } from './Loader.tsx';
import { SignalIcon, EditIcon, TrashIcon } from '../constants.tsx';

const PlanFormModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (plan: Omit<DhcpBillingPlan, 'routerId'> | DhcpBillingPlanWithId) => void;
    plan: DhcpBillingPlanWithId | null;
    isLoading: boolean;
}> = ({ isOpen, onClose, onSave, plan, isLoading }) => {
    const { currency } = useLocalization();
    const [formState, setFormState] = useState<Omit<DhcpBillingPlan, 'routerId'>>({
        name: '',
        price: 0,
        cycle_days: 30,
        speedLimit: '',
        currency: currency,
    });

    React.useEffect(() => {
        if (isOpen) {
            if (plan) {
                setFormState({
                    name: plan.name,
                    price: plan.price,
                    cycle_days: plan.cycle_days,
                    speedLimit: plan.speedLimit || '',
                    currency: plan.currency || currency,
                });
            } else {
                setFormState({
                    name: '',
                    price: 0,
                    cycle_days: 30,
                    speedLimit: '',
                    currency: currency,
                });
            }
        }
    }, [isOpen, plan, currency]);

    if (!isOpen) return null;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: name === 'price' || name === 'cycle_days' ? parseFloat(value) || 0 : value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(plan ? { ...formState, id: plan.id } : formState);
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold mb-4">{plan ? 'Edit' : 'Add'} DHCP Billing Plan</h3>
                        <div className="space-y-4">
                            <div><label>Plan Name</label><input name="name" value={formState.name} onChange={handleChange} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" /></div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label>Price ({currency})</label><input type="number" name="price" value={formState.price} onChange={handleChange} required min="0" step="0.01" className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" /></div>
                                <div><label>Cycle (Days)</label><input type="number" name="cycle_days" value={formState.cycle_days} onChange={handleChange} required min="1" className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" /></div>
                            </div>
                            <div><label>Speed Limit (e.g., 5M/5M)</label><input name="speedLimit" value={formState.speedLimit} onChange={handleChange} placeholder="Leave empty for no limit" className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" /></div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-4">
                        <button type="button" onClick={onClose}>Cancel</button>
                        <button type="submit" disabled={isLoading} className="px-4 py-2 bg-[--color-primary-600] text-white rounded-md disabled:opacity-50">{isLoading ? 'Saving...' : 'Save Plan'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export const DhcpBillingPlans: React.FC<{ selectedRouter: RouterConfigWithId }> = ({ selectedRouter }) => {
    const { plans, addPlan, updatePlan, deletePlan, isLoading, error, fetchPlans } = useDhcpBillingPlans(selectedRouter.id);
    const { formatCurrency } = useLocalization();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingPlan, setEditingPlan] = useState<DhcpBillingPlanWithId | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleOpenAddModal = () => {
        setEditingPlan(null);
        setIsModalOpen(true);
    };

    const handleOpenEditModal = (plan: DhcpBillingPlanWithId) => {
        setEditingPlan(plan);
        setIsModalOpen(true);
    };

    const handleSave = async (planData: Omit<DhcpBillingPlan, 'routerId'> | DhcpBillingPlanWithId) => {
        setIsSubmitting(true);
        try {
            if ('id' in planData) {
                await updatePlan(planData);
            } else {
                await addPlan(planData);
            }
        } catch (err) {
            alert(`Failed to save plan: ${(err as Error).message}`);
        }
        setIsSubmitting(false);
        setIsModalOpen(false);
    };

    const handleDelete = async (planId: string) => {
        if (window.confirm('Are you sure you want to delete this plan?')) {
            await deletePlan(planId);
        }
    };

    if (isLoading) {
        return <div className="flex justify-center p-8"><Loader /></div>;
    }

    if (error) {
        return <div className="p-4 bg-red-100 text-red-700 rounded-md">Error loading billing plans: {error}</div>;
    }

    return (
        <div className="space-y-6">
            <PlanFormModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSave} plan={editingPlan} isLoading={isSubmitting} />
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2"><SignalIcon className="w-6 h-6" /> DHCP Billing Plans</h2>
                <button onClick={handleOpenAddModal} className="bg-[--color-primary-600] hover:bg-[--color-primary-700] text-white font-bold py-2 px-4 rounded-lg">
                    Add Plan
                </button>
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50">
                            <tr>
                                <th className="px-6 py-3">Plan Name</th>
                                <th className="px-6 py-3">Price</th>
                                <th className="px-6 py-3">Cycle</th>
                                <th className="px-6 py-3">Speed Limit</th>
                                <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {plans.map(plan => (
                                <tr key={plan.id} className="border-b dark:border-slate-700">
                                    <td className="px-6 py-4 font-semibold">{plan.name}</td>
                                    <td className="px-6 py-4">{formatCurrency(plan.price)}</td>
                                    <td className="px-6 py-4">{plan.cycle_days} Days</td>
                                    <td className="px-6 py-4 font-mono">{plan.speedLimit || 'Unlimited'}</td>
                                    <td className="px-6 py-4 text-right space-x-2">
                                        <button onClick={() => handleOpenEditModal(plan)} className="p-2 text-slate-500 hover:text-sky-500"><EditIcon className="w-5 h-5" /></button>
                                        <button onClick={() => handleDelete(plan.id)} className="p-2 text-slate-500 hover:text-red-500"><TrashIcon className="w-5 h-5" /></button>
                                    </td>
                                </tr>
                            ))}
                            {plans.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="text-center py-8 text-slate-500">No billing plans found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
