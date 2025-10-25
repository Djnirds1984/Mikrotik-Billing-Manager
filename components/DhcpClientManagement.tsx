import React, { useState, useEffect, useCallback } from 'react';
import type { RouterConfigWithId, DhcpClient, DhcpClientActionParams, SaleRecord, DhcpClientDbRecord } from '../types.ts';
import { getDhcpClients, updateDhcpClientDetails, deleteDhcpClient } from '../services/mikrotikService.ts';
import { dbApi } from '../services/databaseService.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { Loader } from './Loader.tsx';
import { EditIcon, TrashIcon, CheckCircleIcon, CurrencyDollarIcon } from '../constants.tsx';

const ActivateClientModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (params: DhcpClientActionParams) => void;
    client: DhcpClient | null;
    isSubmitting: boolean;
}> = ({ isOpen, onClose, onSave, client, isSubmitting }) => {
    const [customerInfo, setCustomerInfo] = useState('');
    const [expiresAt, setExpiresAt] = useState('');
    const [speedLimit, setSpeedLimit] = useState('');
    const [contactNumber, setContactNumber] = useState('');
    const [email, setEmail] = useState('');


    useEffect(() => {
        if (isOpen && client) {
            setCustomerInfo(client.customerInfo || '');
            setSpeedLimit(client.speedLimit || '');
            setContactNumber(client.contactNumber || '');
            setEmail(client.email || '');
            
            // If timeout exists, calculate expiry date, otherwise set a default
            if (client.status === 'active' && client.creationTime && client.timeout) {
                 const creation = new Date(client.creationTime);
                 // MikroTik timeout is like 29d23h59m58s
                 const durationRegex = /(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/;
                 const matches = client.timeout.match(durationRegex);
                 let seconds = 0;
                 if(matches){
                    seconds += (parseInt(matches[1] || '0') * 7 * 24 * 60 * 60); // weeks
                    seconds += (parseInt(matches[2] || '0') * 24 * 60 * 60); // days
                    seconds += (parseInt(matches[3] || '0') * 60 * 60); // hours
                    seconds += (parseInt(matches[4] || '0') * 60); // minutes
                    seconds += (parseInt(matches[5] || '0')); // seconds
                 }
                 const expiry = new Date(creation.getTime() + seconds * 1000);
                 // Format for datetime-local input
                 const localISO = new Date(expiry.getTime() - (expiry.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
                 setExpiresAt(localISO);

            } else {
                 const defaultExpiry = new Date();
                 defaultExpiry.setDate(defaultExpiry.getDate() + 30);
                 const localISO = new Date(defaultExpiry.getTime() - (defaultExpiry.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
                 setExpiresAt(localISO);
            }

        }
    }, [isOpen, client]);

    if (!isOpen || !client) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({ 
            addressListId: client.id, 
            macAddress: client.macAddress,
            address: client.address,
            customerInfo, 
            expiresAt,
            speedLimit,
            contactNumber,
            email
        });
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold mb-4">{client.status === 'pending' ? 'Activate Client' : 'Edit Client'}</h3>
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
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium">Speed Limit (Mbps)</label>
                                    <input type="number" value={speedLimit} onChange={e => setSpeedLimit(e.target.value)} placeholder="e.g., 5" className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium">Expires At</label>
                                    <input type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-4">
                        <button type="button" onClick={onClose} className="px-4 py-2 rounded-md">Cancel</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-[--color-primary-600] text-white rounded-md disabled:opacity-50">
                            {isSubmitting ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const PayModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: { amount: number, description: string }) => void;
    client: DhcpClient | null;
    isSubmitting: boolean;
}> = ({ isOpen, onClose, onSave, client, isSubmitting }) => {
    const { formatCurrency } = useLocalization();
    const [amount, setAmount] = useState('');
    const [description, setDescription] = useState('1 Month Internet Access');

    useEffect(() => {
        if (isOpen) {
            setAmount('');
            setDescription('1 Month Internet Access');
        }
    }, [isOpen]);

    if (!isOpen || !client) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({ amount: parseFloat(amount) || 0, description });
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-md">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold mb-4">Process Payment</h3>
                        <p className="text-sm text-slate-500 mb-4">For client: {client.customerInfo || client.hostName} ({client.macAddress})</p>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium">Payment Amount</label>
                                <input type="number" value={amount} onChange={e => setAmount(e.target.value)} required min="0" step="0.01" className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium">Description for Sales Report</label>
                                <input value={description} onChange={e => setDescription(e.target.value)} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-4">
                        <button type="button" onClick={onClose} className="px-4 py-2 rounded-md">Cancel</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-[--color-primary-600] text-white rounded-md disabled:opacity-50">
                            {isSubmitting ? 'Processing...' : 'Confirm & Activate'}
                        </button>
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
    const { currency } = useLocalization();
    const [clients, setClients] = useState<DhcpClient[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    const [isActivateModalOpen, setActivateModalOpen] = useState(false);
    const [selectedClient, setSelectedClient] = useState<DhcpClient | null>(null);

    const [isPayModalOpen, setPayModalOpen] = useState(false);
    const [payingClient, setPayingClient] = useState<DhcpClient | null>(null);

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
        const interval = setInterval(fetchData, 8000);
        return () => clearInterval(interval);
    }, [fetchData]);
    
    const upsertDbClient = async (clientData: Omit<DhcpClientDbRecord, 'id'>) => {
        try {
            const existingClients = await dbApi.get<DhcpClientDbRecord[]>(`/dhcp_clients?routerId=${clientData.routerId}`);
            const existing = existingClients.find(c => c.macAddress === clientData.macAddress);

            if (existing) {
                await dbApi.patch(`/dhcp_clients/${existing.id}`, clientData);
            } else {
                const newRecord = { ...clientData, id: `dhcp_client_${Date.now()}` };
                await dbApi.post('/dhcp_clients', newRecord);
            }
        } catch (e) {
            console.error("Failed to save DHCP client to local DB:", e);
        }
    };


    const handleAction = async (params: DhcpClientActionParams) => {
        if (!selectedClient) return;
        setIsSubmitting(true);
        try {
            await updateDhcpClientDetails(selectedRouter, selectedClient, params);
            await upsertDbClient({
                routerId: selectedRouter.id,
                macAddress: params.macAddress,
                customerInfo: params.customerInfo,
                contactNumber: params.contactNumber,
                email: params.email,
                speedLimit: params.speedLimit,
                lastSeen: new Date().toISOString(),
            });
            setActivateModalOpen(false);
            await fetchData();
        } catch (err) {
            alert(`Failed to save client: ${(err as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleProcessPayment = async ({ amount, description }: { amount: number, description: string }) => {
        if (!payingClient) return;
        setIsSubmitting(true);
        try {
            const expiresAt = new Date();
            expiresAt.setMonth(expiresAt.getMonth() + 1);

            const params: DhcpClientActionParams = {
                addressListId: payingClient.id,
                macAddress: payingClient.macAddress,
                address: payingClient.address,
                customerInfo: payingClient.customerInfo || payingClient.hostName,
                expiresAt: expiresAt.toISOString(),
                speedLimit: payingClient.speedLimit,
                contactNumber: payingClient.contactNumber,
                email: payingClient.email,
            };
            await updateDhcpClientDetails(selectedRouter, payingClient, params);

            // FIX: Added missing 'date' and 'routerName' properties to the sale record object to match the 'SaleRecord' type and resolve the TypeScript error.
            await addSale({
                clientName: payingClient.customerInfo || payingClient.hostName,
                planName: description,
                planPrice: amount,
                discountAmount: 0,
                finalAmount: amount,
                currency: currency,
                clientAddress: 'N/A',
                clientContact: payingClient.contactNumber,
                clientEmail: payingClient.email,
                routerId: selectedRouter.id,
                date: new Date().toISOString(),
                routerName: selectedRouter.name
            });
            
             await upsertDbClient({
                routerId: selectedRouter.id,
                macAddress: params.macAddress,
                customerInfo: params.customerInfo,
                contactNumber: params.contactNumber,
                email: params.email,
                speedLimit: params.speedLimit,
                lastSeen: new Date().toISOString(),
            });

            setPayModalOpen(false);
            await fetchData();
        } catch (err) {
            alert(`Payment process failed: ${(err as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    
    const handleDeactivateOrDelete = async (client: DhcpClient) => {
         if (window.confirm(`Are you sure you want to ${client.status === 'active' ? 'deactivate' : 'delete'} this client record? Deactivating will remove internet access.`)) {
            try {
                await deleteDhcpClient(selectedRouter, client);
                await fetchData();
            } catch (err) {
                alert(`Failed to perform action: ${(err as Error).message}`);
            }
         }
    };
    
    if (isLoading && clients.length === 0) return <div className="flex justify-center p-8"><Loader /></div>;
    if (error) return <div className="p-4 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md">{error}</div>;

    return (
        <div className="space-y-6">
            <ActivateClientModal isOpen={isActivateModalOpen} onClose={() => setActivateModalOpen(false)} onSave={handleAction} client={selectedClient} isSubmitting={isSubmitting} />
            <PayModal isOpen={isPayModalOpen} onClose={() => setPayModalOpen(false)} onSave={handleProcessPayment} client={payingClient} isSubmitting={isSubmitting} />

            <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">DHCP Client Management</h2>
            <p className="text-sm text-slate-500 -mt-4">Activate new installations and manage DHCP-based customers.</p>

            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                            <tr>
                                <th className="px-6 py-3">Status</th>
                                <th className="px-6 py-3">IP Address</th>
                                <th className="px-6 py-3">MAC Address</th>
                                <th className="px-6 py-3">Client Hostname</th>
                                <th className="px-6 py-3">Customer Info</th>
                                <th className="px-6 py-3">Expires In</th>
                                <th className="px-6 py-3 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {clients.map(client => (
                                <tr key={client.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <td className="px-6 py-4">
                                        {client.status === 'active' ? 
                                            <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400">Active</span> : 
                                            <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400">Pending</span>
                                        }
                                    </td>
                                    <td className="px-6 py-4 font-mono">{client.address}</td>
                                    <td className="px-6 py-4 font-mono">{client.macAddress}</td>
                                    <td className="px-6 py-4">{client.hostName || 'N/A'}</td>
                                    <td className="px-6 py-4 text-slate-500 italic">{client.customerInfo || 'N/A'}</td>
                                    <td className="px-6 py-4 font-mono text-sm text-slate-500 dark:text-slate-400">
                                        {client.status === 'active' ? client.timeout || 'N/A' : 'N/A'}
                                    </td>
                                    <td className="px-6 py-4 text-right space-x-1">
                                         <button onClick={() => { setPayingClient(client); setPayModalOpen(true); }} className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md font-semibold disabled:opacity-50" title="Process Payment & Activate for 1 Month" disabled={client.id.startsWith('lease_')}>
                                            <CurrencyDollarIcon className="w-5 h-5"/>
                                        </button>
                                        {client.status === 'pending' && (
                                            <>
                                                <button onClick={() => { setSelectedClient(client); setActivateModalOpen(true); }} className="px-3 py-1 text-sm bg-green-600 text-white rounded-md font-semibold disabled:opacity-50" disabled={client.id.startsWith('lease_')}>Activate</button>
                                                <button onClick={() => handleDeactivateOrDelete(client)} className="p-2 text-slate-500 hover:text-red-500 disabled:opacity-50" title="Remove from pending list" disabled={client.id.startsWith('lease_')}><TrashIcon className="w-5 h-5"/></button>
                                            </>
                                        )}
                                        {client.status === 'active' && (
                                            <>
                                                <button onClick={() => handleDeactivateOrDelete(client)} className="px-3 py-1 text-sm bg-yellow-500 text-white rounded-md font-semibold">Deactivate</button>
                                                <button onClick={() => { setSelectedClient(client); setActivateModalOpen(true); }} className="p-2 text-slate-500 hover:text-sky-500" title="Edit Client Details"><EditIcon className="w-5 h-5"/></button>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            ))}
                             {clients.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="text-center py-8 text-slate-500">No DHCP clients found in pending or authorized lists on portal-enabled servers.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};