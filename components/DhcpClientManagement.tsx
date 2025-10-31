import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { RouterConfigWithId, DhcpClient, DhcpClientActionParams, SaleRecord, DhcpClientDbRecord, DhcpBillingPlanWithId } from '../types.ts';
import { updateDhcpClientDetails, deleteDhcpClient } from '../services/mikrotikService.ts';
import { dbApi } from '../services/databaseService.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { useDhcpBillingPlans } from '../hooks/useDhcpBillingPlans.ts';
import { getDhcpClients } from '../services/mikrotikService.ts';
import { Loader } from './Loader.tsx';
import { EditIcon, TrashIcon } from '../constants.tsx';

// The new unified modal for activation and payment
const ActivationPaymentModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (params: DhcpClientActionParams) => void;
    client: DhcpClient | null;
    plans: DhcpBillingPlanWithId[];
    isSubmitting: boolean;
    dbClient?: DhcpClientDbRecord | null;
}> = ({ isOpen, onClose, onSave, client, plans, isSubmitting, dbClient }) => {
    const { formatCurrency } = useLocalization();
    const [customerInfo, setCustomerInfo] = useState('');
    const [contactNumber, setContactNumber] = useState('');
    const [email, setEmail] = useState('');
    const [selectedPlanId, setSelectedPlanId] = useState('');
    const [downtimeDays, setDowntimeDays] = useState('0');

    useEffect(() => {
        if (isOpen && client) {
            // FIX: Add explicit type to help TypeScript infer the shape of the merged object.
            const initialData: Partial<DhcpClient & DhcpClientDbRecord> = { ...client, ...(dbClient || {}) };
            setCustomerInfo(initialData.customerInfo || initialData.hostName || '');
            setContactNumber(initialData.contactNumber || '');
            setEmail(initialData.email || '');
            setDowntimeDays('0');

            if (plans.length > 0) {
                // Try to find a plan that matches the last known plan for this client
                const lastPlanName = dbClient?.customerInfo ? JSON.parse(client.comment || '{}').planName : null;
                const lastPlan = lastPlanName ? plans.find(p => p.name === lastPlanName) : null;
                setSelectedPlanId(lastPlan?.id || plans[0].id);
            }
        }
    }, [isOpen, client, dbClient, plans]);

    const selectedPlan = useMemo(() => plans.find(p => p.id === selectedPlanId), [plans, selectedPlanId]);
    
    const pricePerDay = useMemo(() => {
        if (!selectedPlan || !selectedPlan.cycle_days || selectedPlan.cycle_days === 0) return 0;
        return selectedPlan.price / selectedPlan.cycle_days;
    }, [selectedPlan]);

    const discountAmount = useMemo(() => {
        const days = parseInt(downtimeDays, 10) || 0;
        return pricePerDay * days;
    }, [downtimeDays, pricePerDay]);

    const finalAmount = useMemo(() => {
        if (!selectedPlan) return 0;
        return Math.max(0, selectedPlan.price - discountAmount);
    }, [selectedPlan, discountAmount]);

    if (!isOpen || !client) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedPlan) {
            alert("Please select a billing plan.");
            return;
        }
        onSave({
            customerInfo,
            contactNumber,
            email,
            plan: selectedPlan,
            downtimeDays: parseInt(downtimeDays, 10) || 0,
        });
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold mb-4">{client.status === 'pending' ? 'Activate Client' : 'Renew Subscription'}</h3>
                        <p className="text-sm text-slate-500 mb-4 font-mono">{client.address} ({client.macAddress})</p>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium">Customer Name</label>
                                <input value={customerInfo} onChange={e => setCustomerInfo(e.target.value)} placeholder="e.g., John Doe - Unit 5" required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium">Contact Number</label>
                                    <input type="tel" value={contactNumber} onChange={e => setContactNumber(e.target.value)} placeholder="Optional" className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium">Email Address</label>
                                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Optional" className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                </div>
                            </div>
                            <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                     <div>
                                        <label className="block text-sm font-medium">Billing Plan</label>
                                        <select value={selectedPlanId} onChange={e => setSelectedPlanId(e.target.value)} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">
                                            {plans.length > 0 ? plans.map(p => <option key={p.id} value={p.id}>{p.name} ({formatCurrency(p.price)})</option>) : <option>No plans found</option>}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium">Downtime Discount (Days)</label>
                                        <input type="number" value={downtimeDays} onChange={e => setDowntimeDays(e.target.value)} min="0" className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                    </div>
                                </div>
                                {selectedPlan && (
                                <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-md space-y-1 text-sm">
                                    <div className="flex justify-between"><span>Plan Price:</span> <span>{formatCurrency(selectedPlan.price)}</span></div>
                                    <div className="flex justify-between text-yellow-600 dark:text-yellow-400"><span>Discount:</span> <span>- {formatCurrency(discountAmount)}</span></div>
                                    <div className="flex justify-between font-bold text-lg pt-1 border-t border-slate-200 dark:border-slate-600"><span>Total Due:</span> <span>{formatCurrency(finalAmount)}</span></div>
                                </div>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-4">
                        <button type="button" onClick={onClose} className="px-4 py-2 rounded-md">Cancel</button>
                        <button type="submit" disabled={isSubmitting || !selectedPlan} className="px-4 py-2 bg-[--color-primary-600] text-white rounded-md disabled:opacity-50">
                            {isSubmitting ? 'Saving...' : 'Save & Activate'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// New modal for manual editing
const EditClientModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (params: DhcpClientActionParams) => void;
    client: DhcpClient | null;
    isSubmitting: boolean;
    dbClient?: DhcpClientDbRecord | null;
}> = ({ isOpen, onClose, onSave, client, isSubmitting, dbClient }) => {
    const [formData, setFormData] = useState<Partial<DhcpClientActionParams>>({});
    
    useEffect(() => {
        if (isOpen && client) {
            // FIX: Add explicit type to help TypeScript infer the shape of the merged object.
            const initialData: Partial<DhcpClient & DhcpClientDbRecord> = { ...client, ...(dbClient || {}) };
            
            let currentExpiresAt = '';
            if (client.comment) {
                try {
                    const parsed = JSON.parse(client.comment);
                    if (parsed.dueDate) {
                        // The saved date is YYYY-MM-DD. We assume end of day for datetime-local.
                        currentExpiresAt = `${parsed.dueDate}T23:59`;
                    }
                } catch(e) {}
            }

            setFormData({
                customerInfo: initialData.customerInfo || initialData.hostName || '',
                contactNumber: initialData.contactNumber || '',
                email: initialData.email || '',
                speedLimit: initialData.speedLimit || '',
                expiresAt: currentExpiresAt,
            });
        }
    }, [isOpen, client, dbClient]);

    if (!isOpen || !client) return null;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData(prev => ({...prev, [e.target.name]: e.target.value}));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(formData as DhcpClientActionParams);
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold mb-4">Edit Client</h3>
                        <div className="space-y-4">
                            <div><label>Customer Name</label><input name="customerInfo" value={formData.customerInfo} onChange={handleChange} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" /></div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label>Contact Number</label><input name="contactNumber" value={formData.contactNumber} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" /></div>
                                <div><label>Email</label><input type="email" name="email" value={formData.email} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" /></div>
                            </div>
                             <div className="grid grid-cols-2 gap-4">
                                <div><label>Speed Limit (Mbps)</label><input type="number" name="speedLimit" value={formData.speedLimit} onChange={handleChange} placeholder="Leave blank for no limit" className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" /></div>
                                <div>
                                    <label>Expires At</label>
                                    <input type="datetime-local" name="expiresAt" value={formData.expiresAt} onChange={handleChange} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-4">
                        <button type="button" onClick={onClose}>Cancel</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-[--color-primary-600] text-white rounded-md disabled:opacity-50">{isSubmitting ? 'Saving...' : 'Save Changes'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};


interface DhcpClientManagementProps {
    selectedRouter: RouterConfigWithId;
    addSale: (saleData: Omit<SaleRecord, 'id'>) => Promise<void>;
}

export const DhcpClientManagement: React.FC<DhcpClientManagementProps> = ({ selectedRouter, addSale }) => {
    const [clients, setClients] = useState<DhcpClient[]>([]);
    const [dbClients, setDbClients] = useState<DhcpClientDbRecord[]>([]);
    const { plans, isLoading: isLoadingPlans } = useDhcpBillingPlans(selectedRouter.id);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    const [isPaymentModalOpen, setPaymentModalOpen] = useState(false);
    const [isEditModalOpen, setEditModalOpen] = useState(false);
    const [selectedClient, setSelectedClient] = useState<DhcpClient | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [routerClients, localClients] = await Promise.all([
                getDhcpClients(selectedRouter),
                dbApi.get<DhcpClientDbRecord[]>(`/dhcp_clients?routerId=${selectedRouter.id}`)
            ]);
            setClients(routerClients);
            setDbClients(localClients);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsLoading(false);
        }
    }, [selectedRouter]);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 8000);
        return () => clearInterval(interval);
    }, [fetchData]);

    const combinedClients = useMemo(() => {
        const dbClientMap = new Map(dbClients.map(c => [c.macAddress, c]));
        return clients.map(client => {
            const dbData = dbClientMap.get(client.macAddress);
            return dbData ? { ...client, customerInfo: dbData.customerInfo, contactNumber: dbData.contactNumber, email: dbData.email, speedLimit: dbData.speedLimit } : client;
        });
    }, [clients, dbClients]);
    
    const upsertDbClient = async (clientData: Omit<DhcpClientDbRecord, 'id'>) => {
        try {
            const existing = dbClients.find(c => c.macAddress === clientData.macAddress);
            if (existing) {
                await dbApi.patch(`/dhcp_clients/${existing.id}`, clientData);
            } else {
                const newRecord = { ...clientData, id: `dhcp_client_${Date.now()}` };
                await dbApi.post('/dhcp_clients', newRecord);
            }
        } catch (e) { console.error("Failed to save DHCP client to local DB:", e); }
    };

    const handleSavePayment = async (params: DhcpClientActionParams) => {
        if (!selectedClient || !params.plan) return;
        setIsSubmitting(true);
        try {
            await updateDhcpClientDetails(selectedRouter, selectedClient, params);

            const pricePerDay = params.plan.cycle_days > 0 ? params.plan.price / params.plan.cycle_days : 0;
            const discountAmount = pricePerDay * (params.downtimeDays || 0);
            const finalAmount = Math.max(0, params.plan.price - discountAmount);

            await addSale({
                clientName: params.customerInfo,
                planName: params.plan.name,
                planPrice: params.plan.price,
                discountAmount,
                finalAmount,
                currency: params.plan.currency,
                clientContact: params.contactNumber,
                clientEmail: params.email,
                routerId: selectedRouter.id,
                routerName: selectedRouter.name,
                date: new Date().toISOString()
            });
            
            await upsertDbClient({
                routerId: selectedRouter.id,
                macAddress: selectedClient.macAddress,
                customerInfo: params.customerInfo,
                contactNumber: params.contactNumber,
                email: params.email,
                speedLimit: params.plan.speedLimit,
                lastSeen: new Date().toISOString(),
            });

            setPaymentModalOpen(false);
            await fetchData();
        } catch (err) {
            alert(`Failed to save client: ${(err as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleSaveEdit = async (params: DhcpClientActionParams) => {
        if (!selectedClient) return;
        setIsSubmitting(true);
        try {
             await updateDhcpClientDetails(selectedRouter, selectedClient, params);
             await upsertDbClient({
                routerId: selectedRouter.id,
                macAddress: selectedClient.macAddress,
                customerInfo: params.customerInfo,
                contactNumber: params.contactNumber,
                email: params.email,
                speedLimit: params.speedLimit,
                lastSeen: new Date().toISOString(),
            });
            setEditModalOpen(false);
            await fetchData();
        } catch (err) {
            alert(`Failed to save client: ${(err as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleDeactivateOrDelete = async (client: DhcpClient) => {
         if (window.confirm(`Are you sure you want to ${client.status === 'active' ? 'deactivate' : 'delete'} this client?`)) {
            try {
                await deleteDhcpClient(selectedRouter, client);
                await fetchData();
            } catch (err) { alert(`Failed to perform action: ${(err as Error).message}`); }
         }
    };
    
    if ((isLoading || isLoadingPlans) && clients.length === 0) return <div className="flex justify-center p-8"><Loader /></div>;
    if (error) return <div className="p-4 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md">{error}</div>;

    return (
        <div className="space-y-6">
            <ActivationPaymentModal 
                isOpen={isPaymentModalOpen} 
                onClose={() => setPaymentModalOpen(false)} 
                onSave={handleSavePayment} 
                client={selectedClient} 
                plans={plans}
                isSubmitting={isSubmitting}
                dbClient={dbClients.find(c => c.macAddress === selectedClient?.macAddress)}
            />
            <EditClientModal
                isOpen={isEditModalOpen}
                onClose={() => setEditModalOpen(false)}
                onSave={handleSaveEdit}
                client={selectedClient}
                isSubmitting={isSubmitting}
                dbClient={dbClients.find(c => c.macAddress === selectedClient?.macAddress)}
            />

            <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">DHCP Client Management</h2>

            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                            <tr>
                                <th className="px-6 py-3">Status</th>
                                <th className="px-6 py-3">IP Address</th>
                                <th className="px-6 py-3">MAC Address</th>
                                <th className="px-6 py-3">Customer Info</th>
                                <th className="px-6 py-3">Expires In</th>
                                <th className="px-6 py-3 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {combinedClients.map(client => (
                                <tr key={client.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <td className="px-6 py-4">
                                        {client.status === 'active' ? 
                                            <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400">Active</span> : 
                                            <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400">Pending</span>
                                        }
                                    </td>
                                    <td className="px-6 py-4 font-mono">{client.address}</td>
                                    <td className="px-6 py-4 font-mono">{client.macAddress}</td>
                                    <td className="px-6 py-4">
                                        <p className="font-semibold text-slate-800 dark:text-slate-200">{client.customerInfo || client.hostName}</p>
                                        <p className="text-xs text-slate-500">{client.contactNumber}</p>
                                    </td>
                                    <td className="px-6 py-4 font-mono text-sm text-slate-500 dark:text-slate-400">
                                        {client.status === 'active' ? client.timeout || 'N/A' : 'N/A'}
                                    </td>
                                    <td className="px-6 py-4 text-right space-x-1">
                                         {client.status === 'pending' ? (
                                             <>
                                                <button onClick={() => { setSelectedClient(client); setPaymentModalOpen(true); }} className="px-3 py-1 text-sm bg-green-600 text-white rounded-md font-semibold">Activate</button>
                                                <button onClick={() => handleDeactivateOrDelete(client)} className="p-2 text-slate-500 hover:text-red-500" title="Delete from pending list"><TrashIcon className="w-5 h-5"/></button>
                                             </>
                                         ) : (
                                            <>
                                                <button onClick={() => { setSelectedClient(client); setPaymentModalOpen(true); }} className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md font-semibold">Pay/Renew</button>
                                                <button onClick={() => { setSelectedClient(client); setEditModalOpen(true); }} className="p-2 text-slate-500 hover:text-sky-500" title="Edit Client"><EditIcon className="w-5 h-5"/></button>
                                                <button onClick={() => handleDeactivateOrDelete(client)} className="px-3 py-1 text-sm bg-yellow-600 text-white rounded-md font-semibold">Deactivate</button>
                                            </>
                                         )}
                                    </td>
                                </tr>
                            ))}
                             {combinedClients.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="text-center py-8 text-slate-500">No DHCP clients found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};