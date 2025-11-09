import React, { useState, useEffect } from 'react';
import type { DhcpBillingPlan, DhcpBillingPlanWithId } from '../types.ts';
import { useDhcpBillingPlans } from '../hooks/useDhcpBillingPlans.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { EditIcon, TrashIcon, SignalIcon } from '../constants.tsx';
import { Loader } from './Loader.tsx';

// Form component for adding/editing DHCP plans
const DhcpPlanForm: React.FC<{
    onSave: (plan: DhcpBillingPlan | DhcpBillingPlanWithId) => void;
    onCancel: () => void;
    initialData?: DhcpBillingPlanWithId | null;
}> = ({ onSave, onCancel, initialData }) => {
    const { currency, t } = useLocalization();
    const [plan, setPlan] = useState<Partial<DhcpBillingPlanWithId>>({});
    
    useEffect(() => {
        const defaults = { name: '', price: 0, cycle_days: 30, speedLimit: '', currency, billingType: 'prepaid' } as Partial<DhcpBillingPlanWithId>;
        const init = initialData ? { ...initialData, billingType: (initialData as any).billingType || 'prepaid' } : defaults;
        setPlan(init);
    }, [initialData, currency]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type } = e.target;
        setPlan(prev => ({ ...prev, [name]: type === 'number' ? (value ? parseFloat(value) : '') : value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(plan as DhcpBillingPlanWithId);
    };

    return (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
            <h3 className="text-xl font-bold mb-4">{initialData ? `Edit DHCP Plan` : 'Add New DHCP Plan'}</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium">Plan Name</label>
                        <input type="text" name="name" value={plan.name || ''} onChange={handleChange} required className="mt-1 block w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium">Price ({currency})</label>
                        <input type="number" name="price" value={plan.price || ''} onChange={handleChange} required min="0" step="0.01" className="mt-1 block w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium">Validity (Days)</label>
                        <input type="number" name="cycle_days" value={plan.cycle_days || ''} onChange={handleChange} required min="1" className="mt-1 block w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium">Speed Limit (Mbps)</label>
                        <input type="number" name="speedLimit" value={plan.speedLimit || ''} onChange={handleChange} placeholder="e.g., 5 for 5Mbps" className="mt-1 block w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium">{t('billing.type')}</label>
                        <select name="billingType" value={(plan as any).billingType || 'prepaid'} onChange={handleChange} className="mt-1 block w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">
                            <option value="prepaid">{t('billing.prepaid')}</option>
                            <option value="postpaid">{t('billing.postpaid')}</option>
                        </select>
                    </div>
                </div>
                <div className="flex justify-end gap-4 pt-4">
                    <button type="button" onClick={onCancel} className="px-4 py-2 text-sm rounded-md">Cancel</button>
                    <button type="submit" className="px-4 py-2 text-sm bg-[--color-primary-600] text-white rounded-md">Save Plan</button>
                </div>
            </form>
        </div>
    );
};

export const DhcpBillingPlans: React.FC<{ routerId: string }> = ({ routerId }) => {
    const { plans, addPlan, updatePlan, deletePlan, isLoading, error } = useDhcpBillingPlans(routerId);
    const { formatCurrency, t } = useLocalization();
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingPlan, setEditingPlan] = useState<DhcpBillingPlanWithId | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async (planData: any) => {
        setIsSaving(true);
        try {
            if (planData.id) {
                await updatePlan(planData);
                alert('Plan updated successfully.');
            } else {
                await addPlan(planData);
                alert('Plan created successfully.');
            }
            setIsFormOpen(false);
        } catch (err) {
            alert(`Failed to save plan: ${(err as Error).message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const handleEdit = (plan: DhcpBillingPlanWithId) => {
        setEditingPlan(plan);
        setIsFormOpen(true);
    };

    const handleDelete = async (planId: string) => {
        if (window.confirm("Are you sure?")) {
            try {
                await deletePlan(planId);
                alert('Plan deleted successfully.');
            } catch (err) {
                alert(`Failed to delete plan: ${(err as Error).message}`);
            }
        }
    };

    return (
        <div className="space-y-6">
            {!isFormOpen && (
                <div className="flex justify-end">
                    <button
                        onClick={() => {
                            if (!routerId) {
                                alert(t('select_router_alert'));
                                return;
                            }
                            setEditingPlan(null);
                            setIsFormOpen(true);
                        }}
                        className="bg-[--color-primary-600] hover:bg-[--color-primary-700] text-white font-bold py-2 px-4 rounded-lg"
                        disabled={!routerId}
                    >
                        Add New Plan
                    </button>
                </div>
            )}

            {isFormOpen && (
                <DhcpPlanForm
                    onSave={handleSave}
                    onCancel={() => setIsFormOpen(false)}
                    initialData={editingPlan}
                />
            )}

            {isLoading ? <div className="flex justify-center p-8"><Loader /></div> : (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
                    {error && (
                        <div className="p-4 text-sm text-red-600">{error}</div>
                    )}
                    <ul role="list" className="divide-y divide-slate-200 dark:divide-slate-700">
                        {plans.map((plan) => (
                            <li key={plan.id} className="p-4 flex justify-between items-center">
                                <div className="flex items-center gap-4">
                                    <SignalIcon className="h-8 w-8 text-[--color-primary-500]" />
                                    <div>
                                        <p className="font-semibold">{plan.name}</p>
                                        <p className="text-sm text-slate-500">
                                            <span className="font-bold">{formatCurrency(plan.price)}</span> for {plan.cycle_days} days
                                            {plan.speedLimit && ` | Speed: ${plan.speedLimit}Mbps`}
                                            <span className="mx-2 text-slate-300">|</span>
                                            {t('billing.type')}: <span className="inline-block px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs">{t(`billing.${(plan as any).billingType || 'prepaid'}`)}</span>
                                        </p>
                                    </div>
                                </div>
                                <div className="space-x-2">
                                    <button onClick={() => handleEdit(plan)} className="p-2 text-slate-500 hover:text-sky-500" disabled={isSaving}><EditIcon className="w-5 h-5"/></button>
                                    <button onClick={() => handleDelete(plan.id)} className="p-2 text-slate-500 hover:text-red-500" disabled={isSaving}><TrashIcon className="w-5 h-5"/></button>
                                </div>
                            </li>
                        ))}
                         {plans.length === 0 && (
                            <li className="p-6 text-center text-slate-500">
                                No DHCP billing plans created yet.
                            </li>
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
};
