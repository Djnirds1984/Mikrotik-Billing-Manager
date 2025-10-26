import React, { useState, useEffect, useCallback } from 'react';
import type { RouterConfigWithId, DhcpClient, DhcpClientActionParams, DhcpBillingPlanWithId } from '../types.ts';
import { getDhcpClients, updateDhcpClientDetails, deleteDhcpClient } from '../services/mikrotikService.ts';
import { useDhcpBillingPlans } from '../hooks/useDhcpBillingPlans.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { Loader } from './Loader.tsx';
import { CheckCircleIcon, ExclamationTriangleIcon, SearchIcon, TrashIcon } from '../constants.tsx';

// --- Update/Activation Modal ---
const ClientUpdateModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (client: DhcpClient, params: DhcpClientActionParams) => void;
    client: DhcpClient | null;
    plans: DhcpBillingPlanWithId[];
    isLoading: boolean;
}> = ({ isOpen, onClose, onSave, client, plans, isLoading }) => {
    const { formatCurrency } = useLocalization();
    const [params, setParams] = useState<DhcpClientActionParams>({ customerInfo: '' });
    const [updateType, setUpdateType] = useState<'plan' | 'manual'>('plan');

    useEffect(() => {
        if (client) {
            setParams({
                customerInfo: client.customerInfo || '',
                contactNumber: client.contactNumber || '',
                email: client.email || '',
                plan: plans[0],
                downtimeDays: 0,
            });
            setUpdateType('plan');
        }
    }, [client, plans]);

    if (!isOpen || !client) return null;

    const selectedPlan = params.plan;
    const planPrice = selectedPlan?.price || 0;
    const daysInCycle = selectedPlan?.cycle_days || 30;
    const pricePerDay = daysInCycle > 0 ? planPrice / daysInCycle : 0;
    const downtimeDays = params.downtimeDays || 0;
    const discountAmount = pricePerDay * downtimeDays;
    const finalAmount = Math.max(0, planPrice - discountAmount);
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(client, params);
    };

    const handlePlanChange = (planId: string) => {
        const newPlan = plans.find(p => p.id === planId);
        setParams(p => ({ ...p, plan: newPlan }));
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold mb-4">Update Client: <span className="font-mono text-[--color-primary-500]">{client.address}</span></h3>
                        <div className="space-y-4">
                            <div><label>Customer Name</label><input value={params.customerInfo} onChange={e => setParams(p => ({ ...p, customerInfo: e.target.value }))} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" /></div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label>Contact No.</label><input value={params.contactNumber} onChange={e => setParams(p => ({ ...p, contactNumber: e.target.value }))} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" /></div>
                                <div><label>Email</label><input type="email" value={params.email} onChange={e => setParams(p => ({ ...p, email: e.target.value }))} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" /></div>
                            </div>

                             <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                                <label>Billing Plan</label>
                                <select onChange={e => handlePlanChange(e.target.value)} value={selectedPlan?.id || ''} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">
                                    {plans.map(p => <option key={p.id} value={p.id}>{p.name} ({formatCurrency(p.price)} / {p.cycle_days} days)</option>)}
                                </select>
                            </div>
                            <div>
                                <label>Discount for Downtime (Days)</label>
                                <input type="number" min="0" value={params.downtimeDays} onChange={e => setParams(p => ({...p, downtimeDays: parseInt(e.target.value) || 0 }))} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                            </div>
                            
                            <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                                <div className="flex justify-between text-lg font-bold text-slate-900 dark:text-white mt-2">
                                    <span>TOTAL:</span>
                                    <span>{formatCurrency(finalAmount)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-4">
                        <button type="button" onClick={onClose} disabled={isLoading}>Cancel</button>
                        <button type="submit" disabled={isLoading} className="px-4 py-2 bg-[--color-primary-600] text-white rounded-md disabled:opacity-50">
                            {isLoading ? 'Saving...' : (client.status === 'active' ? 'Update Subscription' : 'Activate Client')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};


// --- Main Component ---
export const DhcpClientManagement: React.FC<{ selectedRouter: RouterConfigWithId, addSale: (saleData: any) => Promise<void> }> = ({ selectedRouter, addSale }) => {
    const [clients, setClients] = useState<DhcpClient[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedClient, setSelectedClient] = useState<DhcpClient | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    const { plans, isLoading: isLoadingPlans } = useDhcpBillingPlans(selectedRouter.id);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await getDhcpClients(selectedRouter);
            setClients(data);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsLoading(false);
        }
    }, [selectedRouter]);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000); // Poll for new clients
        return () => clearInterval(interval);
    }, [fetchData]);

    const handleSave = async (client: DhcpClient, params: DhcpClientActionParams) => {
        setIsSubmitting(true);
        try {
            await updateDhcpClientDetails(selectedRouter, client, params);
            
            // Log the sale if a plan was used
            if (params.plan) {
                const planPrice = params.plan.price;
                const pricePerDay = params.plan.cycle_days > 0 ? planPrice / params.plan.cycle_days : 0;
                const discountAmount = pricePerDay * (params.downtimeDays || 0);
                const finalAmount = Math.max(0, planPrice - discountAmount);

                await addSale({
                    clientName: params.customerInfo,
                    planName: params.plan.name,
                    planPrice: planPrice,
                    discountAmount,
                    finalAmount,
                    currency: params.plan.currency,
                    routerName: selectedRouter.name,
                    clientAddress: '',
                    clientContact: params.contactNumber,
                    clientEmail: params.email
                });
            }
            
            setIsModalOpen(false);
            await fetchData();
        } catch (err) {
            alert(`Failed to update client: ${(err as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleDelete = async (client: DhcpClient) => {
        const action = client.status === 'active' ? 'deactivate' : 'remove';
        if (!window.confirm(`Are you sure you want to ${action} client ${client.address}?`)) return;
        
        setIsSubmitting(true);
        try {
            await deleteDhcpClient(selectedRouter, client);
            await fetchData();
        } catch (err) {
            alert(`Failed to ${action} client: ${(err as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const filteredClients = clients.filter(c => 
        c.address.includes(searchTerm) ||
        c.macAddress.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.customerInfo && c.customerInfo.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    return (
        <div className="space-y-4">
            <ClientUpdateModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSave} client={selectedClient} plans={plans} isLoading={isSubmitting || isLoadingPlans} />
            <div className="relative">
                <input type="text" placeholder="Search by IP, MAC, or Name..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full p-3 pl-10 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg" />
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            </div>
            
            {isLoading && <div className="flex justify-center p-8"><Loader /></div>}
            {error && <div className="p-4 bg-red-100 text-red-700 rounded-md">{error}</div>}
            
            {!isLoading && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredClients.map(client => (
                        <div key={client.id} className={`p-4 rounded-lg border ${client.status === 'active' ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700/50' : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-700/50'}`}>
                            <div className="flex justify-between items-start">
                                <div>
                                    <h4 className="font-bold text-lg text-slate-800 dark:text-slate-200">{client.customerInfo !== 'N/A' ? client.customerInfo : (client.hostName || 'Unknown Host')}</h4>
                                    <p className="font-mono text-sm text-slate-500">{client.address} | {client.macAddress}</p>
                                </div>
                                <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${client.status === 'active' ? 'bg-green-200 text-green-800' : 'bg-yellow-200 text-yellow-800'}`}>
                                    {client.status === 'active' ? <CheckCircleIcon className="w-4 h-4" /> : <ExclamationTriangleIcon className="w-4 h-4" />}
                                    {client.status}
                                </span>
                            </div>
                            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                                <button onClick={() => handleDelete(client)} disabled={isSubmitting} className="px-3 py-1 text-sm text-red-700 bg-red-100 hover:bg-red-200 rounded-md disabled:opacity-50">
                                    {client.status === 'active' ? 'Deactivate' : 'Remove'}
                                </button>
                                <button onClick={() => { setSelectedClient(client); setIsModalOpen(true); }} disabled={isSubmitting} className="px-3 py-1 text-sm text-white bg-sky-600 hover:bg-sky-500 rounded-md disabled:opacity-50">
                                    {client.status === 'active' ? 'Update' : 'Activate'}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
