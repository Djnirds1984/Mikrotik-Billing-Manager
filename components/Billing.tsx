import React, { useState, useEffect } from 'react';
import type { BillingPlan, BillingPlanWithId, PppProfile, RouterConfigWithId } from '../types.ts';
import { useBillingPlans } from '../hooks/useBillingPlans.ts';
import { getPppProfiles } from '../services/mikrotikService.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { EditIcon, TrashIcon, SignalIcon, RouterIcon } from '../constants.tsx';
import { Loader } from './Loader.tsx';

// Form component for adding/editing plans
const PlanForm: React.FC<{
    onSave: (plan: BillingPlan | BillingPlanWithId) => void;
    onCancel: () => void;
    initialData?: BillingPlanWithId | null;
    profiles: PppProfile[];
    isLoadingProfiles: boolean;
}> = ({ onSave, onCancel, initialData, profiles, isLoadingProfiles }) => {
    // FIX: Add currency to plan state and handle it during initialization.
    const { t, currency } = useLocalization();
    const defaultPlanState: BillingPlan = { name: '', price: 0, cycle: 'Monthly', pppoeProfile: '', description: '', currency };
    const [plan, setPlan] = useState<BillingPlan>(initialData || defaultPlanState);
    
    useEffect(() => {
        // If it's an existing plan, it will have its own currency.
        // If it's a new plan, it will get the current global currency from the context.
        const initialState = initialData ? 
            { ...initialData } : 
            { ...defaultPlanState, currency: currency };

        if (!initialState.pppoeProfile && profiles.length > 0) {
            initialState.pppoeProfile = profiles[0].name;
        }
        setPlan(initialState);
    }, [initialData, profiles, currency]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setPlan(prev => ({ ...prev, [name]: name === 'price' ? parseFloat(value) || 0 : value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(initialData ? { ...initialData, ...plan } : plan);
    };

    return (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
            <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400] mb-4">{initialData ? t('billing.edit_plan_title', { name: initialData.name }) : t('billing.add_plan_title')}</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t('billing.plan_name')}</label>
                        <input type="text" name="name" value={plan.name} onChange={handleChange} required className="mt-1 block w-full bg-white dark:bg-slate-900/50 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[--color-primary-500] focus:border-[--color-primary-500]" placeholder={t('billing.plan_name_placeholder')} />
                    </div>
                    <div>
                        <label htmlFor="pppoeProfile" className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t('billing.pppoe_profile')}</label>
                        <select name="pppoeProfile" value={plan.pppoeProfile} onChange={handleChange} required disabled={isLoadingProfiles || profiles.length === 0} className="mt-1 block w-full bg-white dark:bg-slate-900/50 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[--color-primary-500] focus:border-[--color-primary-500] disabled:opacity-50">
                            {isLoadingProfiles ? <option>{t('billing.loading_profiles')}</option> : profiles.length === 0 ? <option>{t('billing.no_profiles_found')}</option> : profiles.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                        </select>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="price" className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t('billing.price')}</label>
                        <input type="number" name="price" value={plan.price} onChange={handleChange} required className="mt-1 block w-full bg-white dark:bg-slate-900/50 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                    </div>
                     <div>
                        <label htmlFor="cycle" className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t('billing.cycle')}</label>
                        <select name="cycle" value={plan.cycle} onChange={handleChange} className="mt-1 block w-full bg-white dark:bg-slate-900/50 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[--color-primary-500] focus:border-[--color-primary-500]">
                            <option>{t('billing.monthly')}</option>
                            <option>{t('billing.quarterly')}</option>
                            <option>{t('billing.yearly')}</option>
                        </select>
                    </div>
                </div>
                <div>
                    <label htmlFor="description" className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t('billing.description')}</label>
                    <textarea name="description" value={plan.description} onChange={handleChange} rows={2} className="mt-1 block w-full bg-white dark:bg-slate-900/50 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[--color-primary-500] focus:border-[--color-primary-500]" placeholder={t('billing.description_placeholder')}></textarea>
                </div>
                <div className="flex items-center justify-end space-x-4 pt-4">
                    <button type="button" onClick={onCancel} className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-sm font-medium rounded-lg shadow-sm text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700">{t('common.cancel')}</button>
                    <button type="submit" className="px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-[--color-primary-600] hover:bg-[--color-primary-700] transition-all hover:shadow-md">{t('common.save_plan')}</button>
                </div>
            </form>
        </div>
    );
};

interface BillingProps {
  selectedRouter: RouterConfigWithId | null;
}

export const Billing: React.FC<BillingProps> = ({ selectedRouter }) => {
    const { plans, addPlan, updatePlan, deletePlan, isLoading: isLoadingPlans, error: plansError } = useBillingPlans(selectedRouter?.id || null);
    const { t, formatCurrency } = useLocalization();
    const [editingPlan, setEditingPlan] = useState<BillingPlanWithId | null>(null);
    const [isAdding, setIsAdding] = useState(false);
    const [profiles, setProfiles] = useState<PppProfile[]>([]);
    const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);

    useEffect(() => {
        if ((isAdding || editingPlan) && selectedRouter) {
            setIsLoadingProfiles(true);
            getPppProfiles(selectedRouter)
                .then(setProfiles)
                .catch(err => {
                    console.error("Failed to fetch PPP profiles:", err);
                    setProfiles([]);
                })
                .finally(() => setIsLoadingProfiles(false));
        }
    }, [isAdding, editingPlan, selectedRouter]);

    const handleSave = (planData: BillingPlan | BillingPlanWithId) => {
        if ('id' in planData && planData.id) {
            updatePlan(planData as BillingPlanWithId);
        } else {
            addPlan(planData as BillingPlan);
        }
        setEditingPlan(null);
        setIsAdding(false);
    };

    const handleDelete = (planId: string) => {
        if (window.confirm(t('billing.delete_confirm'))) {
            deletePlan(planId);
        }
    };
    
    const handleAddNew = () => {
        if (!selectedRouter) {
            alert(t('billing.select_router_alert'));
            return;
        }
        setIsAdding(true);
        setEditingPlan(null);
    }
    
    const handleEdit = (plan: BillingPlanWithId) => {
        if (!selectedRouter) {
            alert(t('billing.select_router_alert'));
            return;
        }
        setEditingPlan(plan);
        setIsAdding(false);
    }

    const handleCancel = () => {
        setIsAdding(false);
        setEditingPlan(null);
    }

    return (
        <div className="max-w-4xl mx-auto">
             <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">{t('titles.billing')}</h2>
                {!isAdding && !editingPlan && (
                     <button onClick={handleAddNew} className="bg-[--color-primary-600] hover:bg-[--color-primary-700] text-white font-bold py-2 px-4 rounded-lg shadow-sm hover:shadow-md transition-all">
                        {t('billing.add_new_plan')}
                    </button>
                )}
            </div>

            {(isAdding || editingPlan) && (
                <div className="mb-8">
                    { !selectedRouter ? (
                        <div className="text-center p-8 bg-yellow-50 dark:bg-slate-800 rounded-lg border border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-300">
                           <p>{t('billing.select_router_manage')}</p>
                        </div>
                    ) : (
                        <PlanForm
                            onSave={handleSave}
                            onCancel={handleCancel}
                            initialData={editingPlan}
                            profiles={profiles}
                            isLoadingProfiles={isLoadingProfiles}
                        />
                    )}
                </div>
            )}
            
            {isLoadingPlans && (
                 <div className="flex flex-col items-center justify-center h-64">
                    <Loader />
                    <p className="mt-4 text-[--color-primary-500] dark:text-[--color-primary-400]">{t('billing.loading_plans')}</p>
                </div>
            )}

            {!isLoadingPlans && (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
                    <ul role="list" className="divide-y divide-slate-200 dark:divide-slate-700">
                        {plans.map((plan) => (
                            <li key={plan.id} className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                <div className="flex items-center gap-4 mb-2 sm:mb-0">
                                    <SignalIcon className="h-8 w-8 text-[--color-primary-500] dark:text-[--color-primary-400] flex-shrink-0" />
                                    <div>
                                        <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{plan.name}</p>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">
                                            <span className="font-bold text-slate-800 dark:text-slate-200">{formatCurrency(plan.price)}</span> / {t(`billing.${plan.cycle.toLowerCase()}`)}
                                            <span className="mx-2 text-slate-300 dark:text-slate-600">|</span>
                                            {t('billing.profile')}: <span className="font-mono bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded text-xs">{plan.pppoeProfile}</span>
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center space-x-2 self-end sm:self-center">
                                    <button onClick={() => handleEdit(plan)} className="p-2 text-slate-500 dark:text-slate-400 hover:text-[--color-primary-500] dark:hover:text-[--color-primary-400]">
                                        <EditIcon className="h-5 w-5" />
                                    </button>
                                    <button onClick={() => handleDelete(plan.id)} className="p-2 text-slate-500 dark:text-slate-400 hover:text-red-500">
                                        <TrashIcon className="h-5 w-5" />
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};