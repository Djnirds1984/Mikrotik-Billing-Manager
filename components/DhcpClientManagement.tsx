import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { RouterConfigWithId, DhcpClient, DhcpClientActionParams, SaleRecord, DhcpClientDbRecord, DhcpBillingPlanWithId } from '../types.ts';
import { updateDhcpClientDetails, deleteDhcpClient } from '../services/mikrotikService.ts';
import { dbApi } from '../services/databaseService.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { useDhcpBillingPlans } from '../hooks/useDhcpBillingPlans.ts';
import { getDhcpClients } from '../services/mikrotikService.ts';
import { Loader } from './Loader.tsx';
import { EditIcon, TrashIcon, ExclamationTriangleIcon } from '../constants.tsx';

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
    const [dueDateTime, setDueDateTime] = useState('');
    const [billingType, setBillingType] = useState<'prepaid' | 'postpaid'>('prepaid');

    useEffect(() => {
        if (isOpen && client) {
            // FIX: Add explicit type to help TypeScript infer the shape of the merged object.
            const initialData: Partial<DhcpClient & DhcpClientDbRecord> = { ...client, ...(dbClient || {}) };
            setCustomerInfo(initialData.customerInfo || initialData.hostName || '');
            setContactNumber(initialData.contactNumber || '');
            setEmail(initialData.email || '');
            // Initialize due date/time from existing comment if available
            let initialDueDateTime = '';
            if (client.comment) {
                try {
                    const parsed = JSON.parse(client.comment);
                    if (parsed.dueDate) {
                        initialDueDateTime = `${parsed.dueDate}T23:59`;
                    }
                    if (parsed.billingType === 'postpaid' || parsed.billingType === 'prepaid') {
                        setBillingType(parsed.billingType);
                    } else {
                        setBillingType('prepaid');
                    }
                } catch(e) {}
            }
            setDueDateTime(initialDueDateTime);

            if (plans.length > 0) {
                // Try to find a plan that matches the last known plan for this client
                const lastPlanName = dbClient?.customerInfo ? JSON.parse(client.comment || '{}').planName : null;
                const lastPlan = lastPlanName ? plans.find(p => p.name === lastPlanName) : null;
                setSelectedPlanId(lastPlan?.id || plans[0].id);
            }
        }
    }, [isOpen, client, dbClient, plans]);

    const selectedPlan = useMemo(() => plans.find(p => p.id === selectedPlanId), [plans, selectedPlanId]);
    
    const finalAmount = useMemo(() => {
        if (!selectedPlan) return 0;
        return selectedPlan.price;
    }, [selectedPlan]);

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
            // Send plan for UI sale info but we will use manual due date for update
            plan: selectedPlan,
            expiresAt: dueDateTime,
            speedLimit: selectedPlan?.speedLimit,
            billingType,
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
                                        <label className="block text-sm font-medium">Due Date & Time</label>
                                        <input type="datetime-local" value={dueDateTime} onChange={e => setDueDateTime(e.target.value)} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium">Billing Type</label>
                                        <select value={billingType} onChange={e => setBillingType(e.target.value as 'prepaid' | 'postpaid')} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">
                                            <option value="prepaid">Prepaid</option>
                                            <option value="postpaid">Postpaid</option>
                                        </select>
                                    </div>
                                </div>
                                {selectedPlan && (
                                <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-md space-y-1 text-sm">
                                    <div className="flex justify-between"><span>Plan Price:</span> <span>{formatCurrency(selectedPlan.price)}</span></div>
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
    const [billingType, setBillingType] = useState<'prepaid' | 'postpaid'>('prepaid');
    
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
                    if (parsed.billingType === 'postpaid' || parsed.billingType === 'prepaid') {
                        setBillingType(parsed.billingType);
                    } else {
                        setBillingType('prepaid');
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
        onSave({ ...(formData as DhcpClientActionParams), billingType });
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
                            <div>
                                <label>Billing Type</label>
                                <select value={billingType} onChange={e => setBillingType(e.target.value as 'prepaid' | 'postpaid')} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">
                                    <option value="prepaid">Prepaid</option>
                                    <option value="postpaid">Postpaid</option>
                                </select>
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

    const isLegacyApi = selectedRouter.api_type === 'legacy';

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
            if (dbData) {
                // FIX: Cast dbData to 'any' to resolve a TypeScript inference issue where the compiler incorrectly sees the type as 'unknown'.
                const typedDbData = dbData as any;
                return { ...client, customerInfo: typedDbData.customerInfo, contactNumber: typedDbData.contactNumber, email: typedDbData.email, speedLimit: typedDbData.speedLimit };
            }
            return client;
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
            // Use manual due date/time, avoid plan-based auto-add of cycle days
            const paramsForUpdate: DhcpClientActionParams = {
                customerInfo: params.customerInfo,
                contactNumber: params.contactNumber,
                email: params.email,
                expiresAt: params.expiresAt,
                speedLimit: params.speedLimit,
                billingType: params.billingType,
            };
            await updateDhcpClientDetails(selectedRouter, selectedClient, paramsForUpdate);

            const discountAmount = 0;
            const finalAmount = params.plan.price;

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
