import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { dbApi } from '../services/databaseService.ts';
import { getDhcpClients, getDhcpServers, updateDhcpClientDetails, deleteDhcpClient } from '../services/mikrotikService.ts';
import type { DhcpClient, DhcpClientDbRecord, DhcpClientActionParams, RouterConfigWithId, SaleRecord, DhcpBillingPlanWithId } from '../types.ts';
import { useDhcpBillingPlans } from '../hooks/useDhcpBillingPlans.ts';
import { Loader } from './Loader.tsx';
import { EditIcon, TrashIcon, ExclamationTriangleIcon } from '../constants.tsx';
import { ActivationPaymentModal } from './ActivationPaymentModal.tsx';
import { GracePeriodModal } from './GracePeriodModal.tsx';

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
                    if (parsed.dueDateTime) {
                        // Format for datetime-local input: YYYY-MM-DDThh:mm
                        const date = new Date(parsed.dueDateTime);
                        // Adjust for local timezone offset to show correct local time in input
                        const offset = date.getTimezoneOffset() * 60000;
                        currentExpiresAt = new Date(date.getTime() - offset).toISOString().slice(0, 16);
                    } else if (parsed.dueDate) {
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
    const [isGraceModalOpen, setGraceModalOpen] = useState(false);
    const [selectedClient, setSelectedClient] = useState<DhcpClient | null>(null);

    const isLegacyApi = selectedRouter.api_type === 'legacy';
    const [portalEnabledServers, setPortalEnabledServers] = useState<string[]>([]);
    const PORTAL_SCRIPT_NAME = "dhcp-lease-add-to-pending";

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [routerClients, localClients, serversData] = await Promise.all([
                getDhcpClients(selectedRouter),
                dbApi.get<DhcpClientDbRecord[]>(`/dhcp_clients?routerId=${selectedRouter.id}`),
                getDhcpServers(selectedRouter)
            ]);
            const enabled = serversData.filter(s => s['lease-script'] === PORTAL_SCRIPT_NAME).map(s => s.name);
            setPortalEnabledServers(enabled);
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
        const visible = clients.filter(c => c.server && portalEnabledServers.includes(c.server as string));
        return visible.map(client => {
            const dbData = dbClientMap.get(client.macAddress);
            if (dbData) {
                const typedDbData = dbData as any;
                return { ...client, customerInfo: typedDbData.customerInfo, contactNumber: typedDbData.contactNumber, email: typedDbData.email, speedLimit: typedDbData.speedLimit };
            }
            return client;
        });
    }, [clients, dbClients, portalEnabledServers]);
    
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

    const handleGraceSave = async ({ graceDays, graceTime }: { graceDays: number; graceTime: string; }) => {
        if (!selectedClient) return false;
        setIsSubmitting(true);
        try {
            await updateDhcpClientDetails(selectedRouter, selectedClient, {
                customerInfo: selectedClient.customerInfo || selectedClient.hostName,
                graceDays,
                graceTime,
            });
            setGraceModalOpen(false);
            await fetchData();
            return true;
        } catch (err) {
            alert(`Failed to grant grace: ${(err as Error).message}`);
            return false;
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

    const getExpirationDisplay = (client: DhcpClient) => {
        if (client.status !== 'active') return 'N/A';
        
        if (client.comment) {
            try {
                const parsed = JSON.parse(client.comment);
                if (parsed.dueDateTime) {
                    return new Date(parsed.dueDateTime).toLocaleString();
                }
                if (parsed.dueDate) {
                    return parsed.dueDate;
                }
            } catch (e) {
                // ignore
            }
        }
        return client.timeout || 'N/A';
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
            <GracePeriodModal
                isOpen={isGraceModalOpen}
                onClose={() => setGraceModalOpen(false)}
                subject={selectedClient}
                onSave={handleGraceSave as any}
            />

            <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">DHCP Client Management</h2>

            {isLegacyApi && (
                <div className="p-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 text-blue-800 dark:text-blue-300 rounded-lg flex items-start gap-3">
                    <ExclamationTriangleIcon className="w-6 h-6 text-blue-500 flex-shrink-0 mt-1" />
                    <div>
                        <h4 className="font-bold">Legacy API Compatibility</h4>
                        <p className="text-sm">This router uses the legacy API (RouterOS v6). DHCP client actions (Activate, Renew, Edit, Deactivate) are supported via the compatibility layer. PPPoE is unaffected.</p>
                    </div>
                </div>
            )}

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
                                        {getExpirationDisplay(client)}
                                    </td>
                                    <td className="px-6 py-4 text-right space-x-1">
                                         {client.status === 'pending' ? (
                                             <>
                                                <button onClick={() => { setSelectedClient(client); setPaymentModalOpen(true); }} className="px-3 py-1 text-sm bg-green-600 text-white rounded-md font-semibold" title="Activate Client">Activate</button>
                                                <button onClick={() => handleDeactivateOrDelete(client)} className="p-2 text-slate-500 hover:text-red-500" title="Delete from pending list"><TrashIcon className="w-5 h-5"/></button>
                                             </>
                                         ) : (
                                            <>
                                                <button onClick={() => { setSelectedClient(client); setPaymentModalOpen(true); }} className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md font-semibold" title="Pay/Renew">Pay/Renew</button>
                                                <button onClick={() => { setSelectedClient(client); setGraceModalOpen(true); }} className="px-3 py-1 text-sm bg-purple-600 text-white rounded-md font-semibold" title="Grant Grace Period">Grace</button>
                                                <button onClick={() => { setSelectedClient(client); setEditModalOpen(true); }} className="p-2 text-slate-500 hover:text-sky-500" title="Edit Client"><EditIcon className="w-5 h-5"/></button>
                                                <button onClick={() => handleDeactivateOrDelete(client)} className="px-3 py-1 text-sm bg-yellow-600 text-white rounded-md font-semibold" title="Deactivate">Deactivate</button>
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