import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { RouterConfigWithId, PppProfile, IpPool, PppProfileData, PppSecret, PppActiveConnection, SaleRecord, BillingPlanWithId, Customer, PppSecretData, PppServer, PppServerData, Interface } from '../types.ts';
import { 
    getPppProfiles, getIpPools, addPppProfile, updatePppProfile, deletePppProfile,
    getPppSecrets, getPppActiveConnections, addPppSecret, updatePppSecret, deletePppSecret, processPppPayment,
    deletePppActiveConnection,
    getPppServers, addPppServer, updatePppServer, deletePppServer, getInterfaces,
    savePppUser // Import the new service function
} from '../services/mikrotikService.ts';
import { useBillingPlans } from '../hooks/useBillingPlans.ts';
import { useCustomers } from '../hooks/useCustomers.ts';
import { Loader } from './Loader.tsx';
import { RouterIcon, EditIcon, TrashIcon, ExclamationTriangleIcon, UsersIcon, SignalIcon, CurrencyDollarIcon, KeyIcon, SearchIcon, EyeIcon, EyeSlashIcon, ServerIcon } from '../constants.tsx';
import { PaymentModal } from './PaymentModal.tsx';
import { GracePeriodModal } from './GracePeriodModal.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { useCompanySettings } from '../hooks/useCompanySettings.ts';
import { useAuth } from '../contexts/AuthContext.tsx';

// --- Reusable Components ---
const TabButton: React.FC<{ label: string, icon: React.ReactNode, isActive: boolean, onClick: () => void }> = ({ label, icon, isActive, onClick }) => (
    <button
        onClick={onClick}
        className={`flex items-center px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors duration-200 focus:outline-none ${
            isActive
                ? 'border-[--color-primary-500] text-[--color-primary-500] dark:text-[--color-primary-400]'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
        }`}
    >
        {icon}
        <span className="ml-2">{label}</span>
    </button>
);

// --- Profile Form Modal (Refactored) ---
const ProfileFormModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: PppProfile | PppProfileData) => void;
    initialData: PppProfile | null;
    pools: IpPool[];
    isSubmitting: boolean;
}> = ({ isOpen, onClose, onSave, initialData, pools, isSubmitting }) => {
    const [profile, setProfile] = useState<Partial<PppProfileData>>({});

    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                setProfile({ 
                    name: initialData.name, 
                    'local-address': initialData['local-address'] || '', 
                    'remote-address': initialData['remote-address'] || 'none', 
                    'rate-limit': initialData['rate-limit'] || '' 
                });
            } else {
                setProfile({ name: '', 'local-address': '', 'remote-address': 'none', 'rate-limit': '' });
            }
        }
    }, [initialData, isOpen]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(initialData ? { ...profile, id: initialData.id } as PppProfile : profile as PppProfileData);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setProfile(p => ({ ...p, [e.target.name]: e.target.value }));
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold mb-4">{initialData ? 'Edit Profile' : 'Add New Profile'}</h3>
                        <div className="space-y-4">
                            <div>
                                <label>Profile Name</label>
                                <input type="text" name="name" value={profile.name} onChange={handleChange} required disabled={!!initialData} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2 disabled:opacity-50" />
                            </div>
                            <div>
                                <label>Local Address</label>
                                <input type="text" name="local-address" value={profile['local-address']} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2" />
                            </div>
                            <div>
                                <label>Remote Address (Pool)</label>
                                <select name="remote-address" value={profile['remote-address']} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2">
                                    <option value="none">none</option>
                                    {pools.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label>Rate Limit (rx/tx)</label>
                                <input type="text" placeholder="e.g., 10M/20M" name="rate-limit" value={profile['rate-limit']} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2" />
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-3">
                        <button type="button" onClick={onClose} disabled={isSubmitting}>Cancel</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-[--color-primary-600] text-white rounded-md disabled:opacity-50">
                            {isSubmitting ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- Profiles Management Sub-component ---
const ProfilesManager: React.FC<{ selectedRouter: RouterConfigWithId }> = ({ selectedRouter }) => {
    const [profiles, setProfiles] = useState<PppProfile[]>([]);
    const [pools, setPools] = useState<IpPool[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<{ profiles?: string; pools?: string } | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProfile, setEditingProfile] = useState<PppProfile | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [profilesData, poolsData] = await Promise.all([
                getPppProfiles(selectedRouter),
                getIpPools(selectedRouter),
            ]);
            setProfiles(profilesData);
            setPools(poolsData);
        } catch (err) {
            setError({ profiles: `Could not fetch data: ${(err as Error).message}` });
        } finally {
            setIsLoading(false);
        }
    }, [selectedRouter]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleSave = async (profileData: PppProfile | PppProfileData) => {
        setIsSubmitting(true);
        try {
            if ('id' in profileData) await updatePppProfile(selectedRouter, profileData);
            else await addPppProfile(selectedRouter, profileData);
            setIsModalOpen(false);
            setEditingProfile(null);
            await fetchData();
        } catch (err) { alert(`Error saving profile: ${(err as Error).message}`); }
        finally { setIsSubmitting(false); }
    };

    const handleDelete = async (profileId: string) => {
        if (!window.confirm("Are you sure?")) return;
        try {
            await deletePppProfile(selectedRouter, profileId);
            await fetchData();
        } catch (err) { alert(`Error deleting profile: ${(err as Error).message}`); }
    };
    

    if (isLoading) return <div className="flex justify-center p-8"><Loader /></div>;
    if (error?.profiles) return <div className="p-4 text-red-600">{error.profiles}</div>;

    return (
        <div>
            <ProfileFormModal 
                isOpen={isModalOpen} 
                onClose={() => { setIsModalOpen(false); setEditingProfile(null); }} 
                onSave={handleSave} 
                initialData={editingProfile} 
                pools={pools}
                isSubmitting={isSubmitting} 
            />
            <div className="flex justify-end mb-4">
                <button onClick={() => { setEditingProfile(null); setIsModalOpen(true); }} className="bg-[--color-primary-600] text-white font-bold py-2 px-4 rounded-lg">Add New Profile</button>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50"><tr><th className="px-6 py-3">Name</th><th className="px-6 py-3">Local Address</th><th className="px-6 py-3">Remote Pool</th><th className="px-6 py-3">Rate Limit</th><th className="px-6 py-3 text-right">Actions</th></tr></thead>
                    <tbody>
                        {profiles.map(p => (
                            <tr key={p.id} className="border-b dark:border-slate-700">
                                <td className="px-6 py-4 font-medium">{p.name}</td><td className="px-6 py-4">{p['local-address'] || 'n/a'}</td><td className="px-6 py-4">{p['remote-address'] || 'n/a'}</td><td className="px-6 py-4">{p['rate-limit'] || 'N/A'}</td>
                                <td className="px-6 py-4 text-right space-x-2"><button onClick={() => { setEditingProfile(p); setIsModalOpen(true); }} className="p-1"><EditIcon className="w-5 h-5"/></button><button onClick={() => handleDelete(p.id)} className="p-1"><TrashIcon className="w-5 h-5"/></button></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// --- User Form Modal ---
const UserFormModal: React.FC<any> = ({ isOpen, onClose, onSave, initialData, plans, customers, profiles, isSubmitting }) => {
    const [secret, setSecret] = useState({ name: '', password: '', profile: '' }); // profile is plan ID
    const [customer, setCustomer] = useState({ fullName: '', address: '', contactNumber: '', email: '' });
    const [showPass, setShowPass] = useState(false);
    const [dueDate, setDueDate] = useState('');
    const [nonPaymentProfile, setNonPaymentProfile] = useState('');
    const [planType, setPlanType] = useState<'prepaid' | 'postpaid'>('prepaid');
    const toDatetimeLocal = (s: string) => {
        try {
            const d = new Date(s);
            const pad = (n: number) => String(n).padStart(2, '0');
            const yyyy = d.getFullYear();
            const mm = pad(d.getMonth() + 1);
            const dd = pad(d.getDate());
            const hh = pad(d.getHours());
            const mi = pad(d.getMinutes());
            return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
        } catch { return s; }
    };


    useEffect(() => {
        if (!isOpen) {
            return;
        }

        if (initialData) {
            const linkedCustomer = customers.find(c => c.username === initialData.name);
            const linkedPlan = plans.find(p => p.pppoeProfile === initialData.profile);
            
            setSecret({ name: initialData.name, password: '', profile: linkedPlan?.id || '' });
            setCustomer({ 
                fullName: linkedCustomer?.fullName || '', 
                address: linkedCustomer?.address || '', 
                contactNumber: linkedCustomer?.contactNumber || '', 
                email: linkedCustomer?.email || '' 
            });
            try {
                const commentData = JSON.parse(initialData.comment);
                if (commentData.dueDateTime) {
                    setDueDate(toDatetimeLocal(commentData.dueDateTime));
                } else if (commentData.dueDate) {
                    const dateTime = `${commentData.dueDate}T23:59`;
                    setDueDate(dateTime);
                } else {
                    setDueDate('');
                }
                const pt = String(commentData.planType || '').toLowerCase().trim();
                setPlanType(pt === 'postpaid' ? 'postpaid' : 'prepaid');
            } catch (e) {
                setDueDate('');
                setPlanType('prepaid');
            }

        } else {
            setSecret({ name: '', password: '', profile: plans.length > 0 ? plans[0].id : '' });
            setCustomer({ fullName: '', address: '', contactNumber: '', email: '' });
            setDueDate('');
            setPlanType('prepaid');
        }
        
        if (profiles.length > 0) {
            const defaultNonPayment = profiles.find(p => p.name.toLowerCase().includes('cut') || p.name.toLowerCase().includes('disable'))?.name || profiles[0].name;
            setNonPaymentProfile(defaultNonPayment);
        }
    }, [isOpen, initialData, plans, customers, profiles]);

    useEffect(() => {
        if (isOpen && !initialData && plans.length > 0 && !secret.profile) {
            setSecret(s => ({...s, profile: plans[0].id}));
        }
    }, [isOpen, initialData, plans, secret.profile]);


    if (!isOpen) return null;
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const selectedPlan = plans.find(p => p.id === secret.profile);
        
        const secretPayload: PppSecretData = {
            name: secret.name,
            service: 'pppoe',
            profile: initialData?.profile || 'default',
            comment: initialData?.comment || '',
            disabled: initialData?.disabled || 'false',
        };

        if (selectedPlan) {
            secretPayload.profile = selectedPlan.pppoeProfile;
        }

        if (secret.password) {
            secretPayload.password = secret.password;
        }
        onSave(secretPayload, customer, { dueDate, nonPaymentProfile, planId: secret.profile, planType });
    }

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
                <div className="p-6 overflow-y-auto">
                     <h3 className="text-xl font-bold mb-4">{initialData ? `Edit User: ${initialData.name}` : 'Add New User'}</h3>
                     <div className="space-y-4">
                        <div><label>Username</label><input type="text" value={secret.name} onChange={e => setSecret(s => ({...s, name: e.target.value}))} disabled={!!initialData} required className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700 disabled:opacity-50" /></div>
                        <div className="relative"><label>Password</label><input type={showPass ? 'text' : 'password'} value={secret.password} onChange={e => setSecret(s => ({...s, password: e.target.value}))} placeholder={initialData ? "Leave blank to keep old" : ""} required={!initialData} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /><button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-9">{showPass ? <EyeSlashIcon className="w-5 h-5"/> : <EyeIcon className="w-5 h-5"/>}</button></div>
                        <div><label>Billing Plan</label><select value={secret.profile} onChange={e => setSecret(s => ({...s, profile: e.target.value}))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700">
                            {initialData && <option value="">-- No Change --</option>}
                            {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select></div>
                        <hr className="my-4 border-slate-200 dark:border-slate-700" />
                        <h4 className="font-semibold">Subscription Details</h4>
                        <div>
                            <label>Due Date & Time</label>
                            <input type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" />
                            <p className="text-xs text-slate-500 mt-1">Leave blank for no expiration.</p>
                        </div>
                        <div>
                            <label>Plan Type</label>
                            <select value={planType} onChange={e => setPlanType(e.target.value as 'prepaid' | 'postpaid')} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2">
                                <option value="prepaid">Prepaid</option>
                                <option value="postpaid">Postpaid</option>
                            </select>
                        </div>
                        <div>
                            <label>Profile on Expiry</label>
                            <select value={nonPaymentProfile} onChange={e => setNonPaymentProfile(e.target.value)} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2">
                                {profiles.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                            </select>
                            <p className="text-xs text-slate-500 mt-1">Profile to apply when the due date is reached.</p>
                        </div>
                        <hr className="my-4 border-slate-200 dark:border-slate-700" />
                        <h4 className="font-semibold">Customer Information (Optional)</h4>
                        <div><label>Full Name</label><input type="text" value={customer.fullName} onChange={e => setCustomer(c => ({...c, fullName: e.target.value}))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /></div>
                        <div><label>Full Address</label><input type="text" value={customer.address} onChange={e => setCustomer(c => ({...c, address: e.target.value}))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /></div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div><label>Contact Number</label><input type="text" value={customer.contactNumber} onChange={e => setCustomer(c => ({...c, contactNumber: e.target.value}))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /></div>
                            <div><label>Email</label><input type="email" value={customer.email} onChange={e => setCustomer(c => ({...c, email: e.target.value}))} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" /></div>
                        </div>
                     </div>
                </div>
                 <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-3 flex-shrink-0"><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={isSubmitting}>Save</button></div>
            </form>
            </div>
        </div>
    )
};

// --- Users Management Sub-component ---
const UsersManager: React.FC<{ selectedRouter: RouterConfigWithId, addSale: (saleData: Omit<SaleRecord, 'id'>) => Promise<void> }> = ({ selectedRouter, addSale }) => {
    const { hasPermission } = useAuth();
    const [secrets, setSecrets] = useState<PppSecret[]>([]);
    const [profiles, setProfiles] = useState<PppProfile[]>([]);
    const { plans } = useBillingPlans(selectedRouter.id);
    const { customers, addCustomer, updateCustomer, fetchCustomers } = useCustomers(selectedRouter.id);
    const { settings: companySettings } = useCompanySettings();

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    const [isUserModalOpen, setUserModalOpen] = useState(false);
    const [isPaymentModalOpen, setPaymentModalOpen] = useState(false);
    const [isGraceModalOpen, setGraceModalOpen] = useState(false);
    const [selectedSecret, setSelectedSecret] = useState<PppSecret | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [secretsData, profilesData] = await Promise.all([
                getPppSecrets(selectedRouter),
                getPppProfiles(selectedRouter),
                fetchCustomers() // from useCustomers hook
            ]);
            setSecrets(secretsData);
            setProfiles(profilesData);
        } catch (err) {
            setError(`Failed to fetch PPPoE users: ${(err as Error).message}`);
        } finally {
            setIsLoading(false);
        }
    }, [selectedRouter, fetchCustomers]);

    useEffect(() => { fetchData() }, [fetchData]);
    
    const combinedUsers = useMemo(() => {
        return secrets.map(secret => {
            const customer = customers.find(c => c.username === secret.name);
            let subscription = { plan: 'N/A', dueDate: 'No Info', planType: 'prepaid' as 'prepaid' | 'postpaid' };
            if (secret.comment) {
                try { 
                    const parsedComment = JSON.parse(secret.comment);
                    subscription.plan = parsedComment.plan || 'N/A';
                    if (parsedComment.dueDateTime) {
                        const dt = new Date(parsedComment.dueDateTime);
                        const y = dt.getFullYear();
                        const m = String(dt.getMonth() + 1).padStart(2, '0');
                        const d = String(dt.getDate()).padStart(2, '0');
                        const hh = String(dt.getHours()).padStart(2, '0');
                        const mm = String(dt.getMinutes()).padStart(2, '0');
                        subscription.dueDate = `${y}-${m}-${d} ${hh}:${mm}`;
                    } else {
                        subscription.dueDate = parsedComment.dueDate || 'No Info';
                    }
                    const pt = String(parsedComment.planType || '').toLowerCase().trim();
                    subscription.planType = pt === 'postpaid' ? 'postpaid' : 'prepaid';
                } catch (e) { /* ignore */ }
            }
            return {
                ...secret,
                customer,
                subscription
            };
        });
    }, [secrets, customers]);
    
    const handleSaveUser = async (secretData: PppSecretData, customerData: Partial<Customer>, subscriptionData: { dueDate: string; nonPaymentProfile: string; planId: string; planType?: 'prepaid' | 'postpaid' }) => {
        setIsSubmitting(true);
        try {
            const existingCustomer = customers.find(c => c.username === secretData.name);

            // Construct comment based on subscription and customer data
            let commentJson: any = {};
            try {
                if (selectedSecret?.comment) {
                    commentJson = JSON.parse(selectedSecret.comment);
                }
            } catch (e) { /* ignore malformed comment */ }

            if (subscriptionData.dueDate) {
                commentJson.dueDate = subscriptionData.dueDate.split('T')[0];
                commentJson.dueDateTime = subscriptionData.dueDate;
            } else {
                delete commentJson.dueDate; // Remove due date if field is cleared
                delete commentJson.dueDateTime;
            }
            
            const selectedPlan = plans.find(p => p.id === subscriptionData.planId);
            if (selectedPlan) {
                secretData.profile = selectedPlan.pppoeProfile; // Set the actual profile on the secret
                commentJson.plan = selectedPlan.name;
                commentJson.price = selectedPlan.price;
                commentJson.currency = selectedPlan.currency;
            }
            if (subscriptionData.planType) {
                const pt = String(subscriptionData.planType).toLowerCase().trim();
                commentJson.planType = pt === 'postpaid' ? 'postpaid' : 'prepaid';
            }
            // Persist customer info in comment on the secret
            if (customerData) {
                const hasCustomerInfo = Object.values(customerData).some(val => val && String(val).trim() !== '');
                if (hasCustomerInfo) {
                    commentJson.customer = {
                        fullName: customerData.fullName || '',
                        address: customerData.address || '',
                        contactNumber: customerData.contactNumber || '',
                        email: customerData.email || ''
                    };
                }
            }
            secretData.comment = JSON.stringify(commentJson);

            // This new service function handles secret creation/update and scheduler management
            await savePppUser(selectedRouter, {
                initialSecret: selectedSecret,
                secretData,
                subscriptionData,
                customerData,
            });

            // Update local customer DB
            if (existingCustomer) {
                await updateCustomer({ ...existingCustomer, ...customerData });
            } else {
                const hasCustomerInfo = Object.values(customerData).some(val => val && String(val).trim() !== '');
                if (hasCustomerInfo) {
                    await addCustomer({ 
                        routerId: selectedRouter.id, 
                        username: secretData.name, 
                        ...customerData 
                    });
                }
            }
            
            setUserModalOpen(false);
            setSelectedSecret(null);
            await fetchData();
        } catch(err) {
            alert(`Failed to save user: ${(err as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleDeleteUser = async (secretId: string) => {
        if (!window.confirm("Are you sure?")) return;
        try {
            await deletePppSecret(selectedRouter, secretId);
            await fetchData();
        } catch (err) { alert(`Error deleting user: ${(err as Error).message}`); }
    };

    const handlePayment = async ({ sale, payment }: any) => {
        if (!selectedSecret) return false;
        try {
            await processPppPayment(selectedRouter, { secret: selectedSecret, ...payment });
            await addSale({ ...sale, routerName: selectedRouter.name, date: new Date().toISOString() });
            await fetchData();
            return true;
        } catch (err) {
            alert(`Payment failed: ${(err as Error).message}`);
            return false;
        }
    };

    const handleGraceSave = async ({ graceDays, nonPaymentProfile, graceTime }: { graceDays: number; nonPaymentProfile: string; graceTime: string }) => {
        if (!selectedSecret) return false;
        try {
            const planName = (selectedSecret as any).subscription?.plan;
            const originalPlan = plans.find(p => p.name === planName);
            const secretData: PppSecretData = {
                name: selectedSecret.name,
                service: 'pppoe',
                profile: originalPlan?.pppoeProfile || selectedSecret.profile,
                comment: selectedSecret.comment,
                disabled: selectedSecret.disabled,
            };
            await savePppUser(selectedRouter, {
                initialSecret: selectedSecret,
                secretData,
                subscriptionData: { dueDate: '', nonPaymentProfile, graceDays, graceTime, planId: originalPlan?.id }
            });
            setGraceModalOpen(false);
            await fetchData();
            return true;
        } catch (err) {
            alert(`Failed to grant grace: ${(err as Error).message}`);
            return false;
        }
    };
    
    if (isLoading) return <div className="flex justify-center p-8"><Loader /></div>;
    if (error) return <div className="p-4 text-red-600">{error}</div>;

    return (
        <div>
            <UserFormModal 
                isOpen={isUserModalOpen} 
                onClose={() => setUserModalOpen(false)} 
                onSave={handleSaveUser} 
                initialData={selectedSecret} 
                plans={plans} 
                customers={customers}
                profiles={profiles}
                isSubmitting={isSubmitting}
            />
            <PaymentModal isOpen={isPaymentModalOpen} onClose={() => setPaymentModalOpen(false)} secret={selectedSecret} plans={plans} profiles={profiles} onSave={handlePayment} companySettings={companySettings} />
            <GracePeriodModal isOpen={isGraceModalOpen} onClose={() => setGraceModalOpen(false)} subject={selectedSecret} profiles={profiles} onSave={handleGraceSave} />

             <div className="flex justify-end mb-4">
                <button onClick={() => { setSelectedSecret(null); setUserModalOpen(true); }} className="bg-[--color-primary-600] text-white font-bold py-2 px-4 rounded-lg">Add New User</button>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md overflow-hidden">
                 <table className="w-full text-sm">
                    <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50">
                        <tr>
                            <th className="px-6 py-3">Username/Customer</th>
                            <th className="px-6 py-3">Profile</th>
                            <th className="px-6 py-3">Plan Type</th>
                            <th className="px-6 py-3">Subscription Due</th>
                            <th className="px-6 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {combinedUsers.map(user => (
                            <tr key={user.id} className={`border-b dark:border-slate-700 ${user.disabled === 'true' ? 'opacity-50' : ''}`}>
                                <td className="px-6 py-4 font-medium">
                                    <p className="text-slate-900 dark:text-slate-100">{user.name}</p>
                                    <p className="text-xs text-slate-500">{user.customer?.fullName}</p>
                                </td>
                                <td>{user.profile}</td>
                                <td>
                                    {user.subscription.planType === 'postpaid' ? (
                                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300">Postpaid</span>
                                    ) : (
                                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">Prepaid</span>
                                    )}
                                </td>
                                <td>{user.subscription.dueDate}</td>
                                <td className="px-6 py-4 text-right space-x-2">
                                    <button
                                        onClick={() => { setSelectedSecret(user); setPaymentModalOpen(true); }}
                                        className="px-3 py-1 text-sm bg-green-600 text-white rounded-md font-semibold hover:bg-green-700 transition-colors"
                                        title="Process Payment"
                                    >
                                        Pay
                                    </button>
                                    {(() => {
                                        const isPostpaid = user.subscription.planType === 'postpaid';
                                        let isDue = false;
                                        try {
                                            if (user.comment) {
                                                const parsed = JSON.parse(user.comment);
                                                if (parsed.dueDateTime) {
                                                    isDue = new Date(parsed.dueDateTime).getTime() <= Date.now();
                                                } else if (parsed.dueDate) {
                                                    const dt = new Date(`${parsed.dueDate}T23:59:59`);
                                                    isDue = dt.getTime() <= Date.now();
                                                }
                                            }
                                        } catch (_) {}
                                        const profileName = (user.profile || '').toLowerCase();
                                        const isNonPayProfile = ['non-payment','nonpayment','cut','disable','disabled'].some(tag => profileName.includes(tag));
                                        return (isPostpaid && (isDue || isNonPayProfile)) ? (
                                            <button
                                                onClick={() => { setSelectedSecret(user); setGraceModalOpen(true); }}
                                                className="px-3 py-1 text-sm bg-purple-600 text-white rounded-md font-semibold hover:bg-purple-700 transition-colors"
                                                title="Grant Grace Period"
                                            >
                                                Grace
                                            </button>
                                        ) : null;
                                    })()}
                                    <button
                                        onClick={() => { setSelectedSecret(user); setUserModalOpen(true); }}
                                        className="px-3 py-1 text-sm bg-sky-600 text-white rounded-md font-semibold hover:bg-sky-700 transition-colors"
                                        title="Edit User"
                                    >
                                        Edit
                                    </button>
                                    {hasPermission('pppoe_users:delete') && (
                                        <button
                                            onClick={() => handleDeleteUser(user.id)}
                                            className="px-3 py-1 text-sm bg-red-600 text-white rounded-md font-semibold hover:bg-red-700 transition-colors"
                                            title="Delete User"
                                        >
                                            Delete
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// --- Active Users Manager ---
const ActiveUsersManager: React.FC<{ selectedRouter: RouterConfigWithId }> = ({ selectedRouter }) => {
    const [activeUsers, setActiveUsers] = useState<PppActiveConnection[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isKicking, setIsKicking] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await getPppActiveConnections(selectedRouter);
            setActiveUsers(data);
        } catch (err) {
            setError(`Failed to fetch active connections: ${(err as Error).message}`);
        } finally {
            setIsLoading(false);
        }
    }, [selectedRouter]);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 5000); // Poll every 5 seconds
        return () => clearInterval(interval);
    }, [fetchData]);

    const handleKickUser = async (connectionId: string) => {
        if (!window.confirm("Are you sure you want to kick this user?")) return;
        setIsKicking(connectionId);
        try {
            await deletePppActiveConnection(selectedRouter, connectionId);
            await fetchData(); // Refresh data after kicking
        } catch (err) {
            alert(`Failed to kick user: ${(err as Error).message}`);
        } finally {
            setIsKicking(null);
        }
    };

    if (isLoading && activeUsers.length === 0) return <div className="flex justify-center p-8"><Loader /></div>;
    if (error) return <div className="p-4 text-red-600">{error}</div>;

    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50">
                        <tr>
                            <th className="px-6 py-3">Username</th>
                            <th className="px-6 py-3">Service</th>
                            <th className="px-6 py-3">IP Address</th>
                            <th className="px-6 py-3">Caller ID (MAC)</th>
                            <th className="px-6 py-3">Uptime</th>
                            <th className="px-6 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {activeUsers.map(user => (
                            <tr key={user.id} className="border-b dark:border-slate-700">
                                <td className="px-6 py-4 font-medium">{user.name}</td>
                                <td className="px-6 py-4">{user.service}</td>
                                <td className="px-6 py-4 font-mono">{user.address}</td>
                                <td className="px-6 py-4 font-mono">{user['caller-id']}</td>
                                <td className="px-6 py-4 font-mono">{user.uptime}</td>
                                <td className="px-6 py-4 text-right">
                                    <button 
                                        onClick={() => handleKickUser(user.id)} 
                                        disabled={isKicking === user.id}
                                        className="px-3 py-1 text-sm bg-red-600 text-white rounded-md font-semibold disabled:opacity-50"
                                    >
                                        {isKicking === user.id ? 'Kicking...' : 'Kick'}
                                    </button>
                                </td>
                            </tr>
                        ))}
                         {activeUsers.length === 0 && (
                            <tr>
                                <td colSpan={6} className="text-center py-8 text-slate-500">
                                    No active PPPoE users.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// --- Servers Management Sub-component ---
const ServersManager: React.FC<{ selectedRouter: RouterConfigWithId }> = ({ selectedRouter }) => {
    const { t } = useLocalization();
    const [servers, setServers] = useState<PppServer[]>([]);
    const [interfaces, setInterfaces] = useState<Interface[]>([]);
    const [profiles, setProfiles] = useState<PppProfile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingServer, setEditingServer] = useState<PppServer | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [serversData, interfacesData, profilesData] = await Promise.all([
                getPppServers(selectedRouter),
                getInterfaces(selectedRouter),
                getPppProfiles(selectedRouter),
            ]);
            setServers(serversData);
            setInterfaces(interfacesData.filter(i => i.type === 'bridge' || i.type === 'ether' || i.type === 'vlan'));
            setProfiles(profilesData);
        } catch (err) {
            setError(`Could not fetch data: ${(err as Error).message}`);
        } finally {
            setIsLoading(false);
        }
    }, [selectedRouter]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleSave = async (serverData: any, serverId?: string) => {
        setIsSubmitting(true);
        try {
            const payload = { ...serverData };
            if (Array.isArray(payload.authentication)) {
                payload.authentication = payload.authentication.join(',');
            }

            if (serverId) {
                await updatePppServer(selectedRouter, serverId, payload);
            } else {
                await addPppServer(selectedRouter, payload);
            }
            setIsModalOpen(false);
            setEditingServer(null);
            await fetchData();
        } catch (err) {
            alert(`Error saving server: ${(err as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleDelete = async (serverId: string) => {
        if (!window.confirm("Are you sure? This will disconnect all users on this server.")) return;
        try {
            await deletePppServer(selectedRouter, serverId);
            await fetchData();
        } catch (err) {
            alert(`Error deleting server: ${(err as Error).message}`);
        }
    };
    
    const ServerFormModal: React.FC<any> = ({ isOpen, onClose, onSave, initialData, isSubmitting }) => {
        const [server, setServer] = useState<PppServerData>({ 'service-name': '', interface: '', 'default-profile': '', authentication: ['pap', 'chap', 'mschap1', 'mschap2'], disabled: 'false' });
        
        useEffect(() => {
            if (isOpen) {
                if (initialData) {
                    setServer({
                        'service-name': initialData['service-name'] || '',
                        interface: initialData.interface,
                        'default-profile': initialData['default-profile'],
                        authentication: (initialData.authentication?.split(',') || []) as PppServerData['authentication'],
                        disabled: initialData.disabled,
                    });
                } else {
                     setServer({
                        'service-name': 'pppoe-in',
                        interface: interfaces.length > 0 ? interfaces[0].name : '',
                        'default-profile': profiles.length > 0 ? profiles[0].name : '',
                        authentication: ['pap', 'chap', 'mschap1', 'mschap2'],
                        disabled: 'false',
                    });
                }
            }
        }, [initialData, isOpen, interfaces, profiles]);
        
        if (!isOpen) return null;

        const handleAuthChange = (authMethod: string, checked: boolean) => {
            setServer(s => ({
                ...s,
                authentication: checked
                    ? [...s.authentication, authMethod as any]
                    : s.authentication.filter(m => m !== authMethod)
            }));
        };

        const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave(server, initialData?.id); };

        return (
             <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg">
                    <form onSubmit={handleSubmit}>
                        <div className="p-6">
                            <h3 className="text-xl font-bold mb-4">{initialData ? t('pppoe.edit_server') : t('pppoe.add_new_server')}</h3>
                            <div className="space-y-4">
                                <div><label>{t('pppoe.service_name')}</label><input value={server['service-name']} onChange={e => setServer(s => ({...s, 'service-name': e.target.value}))} required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2" /></div>
                                <div><label>{t('pppoe.interface')}</label><select value={server.interface} onChange={e => setServer(s => ({...s, interface: e.target.value}))} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2">{interfaces.map(i => <option key={i.name} value={i.name}>{i.name}</option>)}</select></div>
                                <div><label>{t('pppoe.default_profile')}</label><select value={server['default-profile']} onChange={e => setServer(s => ({...s, 'default-profile': e.target.value}))} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2">{profiles.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}</select></div>
                                <div><label>{t('pppoe.authentication')}</label><div className="flex flex-wrap gap-4 mt-2">
                                    {['pap','chap','mschap1','mschap2'].map(method => (
                                        <label key={method} className="flex items-center gap-2"><input type="checkbox" checked={server.authentication.includes(method as any)} onChange={e => handleAuthChange(method, e.target.checked)} />{method}</label>
                                    ))}
                                </div></div>
                                 <label className="flex items-center gap-2"><input type="checkbox" checked={server.disabled === 'true'} onChange={e => setServer(s => ({...s, disabled: e.target.checked ? 'true' : 'false'}))} /> Disabled</label>
                            </div>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-3"><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={isSubmitting}>Save</button></div>
                    </form>
                </div>
            </div>
        );
    };

    if (isLoading) return <div className="flex justify-center p-8"><Loader /></div>;
    if (error) return <div className="p-4 text-red-600">{error}</div>;

    return (
        <div>
            <ServerFormModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSave} initialData={editingServer} isSubmitting={isSubmitting} />
            <div className="flex justify-end mb-4"><button onClick={() => { setEditingServer(null); setIsModalOpen(true); }} className="bg-[--color-primary-600] text-white font-bold py-2 px-4 rounded-lg">{t('pppoe.add_new_server')}</button></div>
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md overflow-hidden">
                <table className="w-full text-sm"><thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50">
                    <tr><th className="px-6 py-3">Service</th><th className="px-6 py-3">Interface</th><th className="px-6 py-3">Default Profile</th><th className="px-6 py-3">Status</th><th className="px-6 py-3 text-right">Actions</th></tr></thead>
                    <tbody>{servers.map(s => (
                        <tr key={s.id} className={`border-b dark:border-slate-700 ${s.disabled === 'true' ? 'opacity-50' : ''}`}>
                            <td className="px-6 py-4 font-medium">{s['service-name']}</td><td className="px-6 py-4">{s.interface}</td><td className="px-6 py-4">{s['default-profile']}</td>
                            <td className="px-6 py-4">{s.disabled === 'true' ? <span className="text-red-500">Disabled</span> : <span className="text-green-500">Enabled</span>}</td>
                            <td className="px-6 py-4 text-right space-x-2"><button onClick={() => { setEditingServer(s); setIsModalOpen(true); }} className="p-1"><EditIcon className="w-5 h-5"/></button><button onClick={() => handleDelete(s.id)} className="p-1"><TrashIcon className="w-5 h-5"/></button></td>
                        </tr>
                    ))}</tbody>
                </table>
            </div>
        </div>
    );
}


// --- Main Container Component ---
type PppoeTab = 'users' | 'active_users' | 'profiles' | 'servers';

export const Pppoe: React.FC<{ 
    selectedRouter: RouterConfigWithId | null;
    addSale: (saleData: Omit<SaleRecord, 'id'>) => Promise<void>;
}> = ({ selectedRouter, addSale }) => {
    const { t } = useLocalization();
    const [activeTab, setActiveTab] = useState<PppoeTab>('users');
    
    if (!selectedRouter) {
        return (
            <div className="flex flex-col items-center justify-center h-96 text-center bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                <RouterIcon className="w-16 h-16 text-slate-400 dark:text-slate-600 mb-4" />
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">PPPoE Management</h2>
                <p className="mt-2 text-slate-500 dark:text-slate-400">Please select a router to manage PPPoE.</p>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div className="border-b border-slate-200 dark:border-slate-700">
                <nav className="flex space-x-2" aria-label="Tabs">
                    <TabButton label={t('pppoe.users')} icon={<UsersIcon className="w-5 h-5" />} isActive={activeTab === 'users'} onClick={() => setActiveTab('users')} />
                    <TabButton label={t('pppoe.active_users')} icon={<UsersIcon className="w-5 h-5" />} isActive={activeTab === 'active_users'} onClick={() => setActiveTab('active_users')} />
                    <TabButton label={t('pppoe.profiles')} icon={<SignalIcon className="w-5 h-5" />} isActive={activeTab === 'profiles'} onClick={() => setActiveTab('profiles')} />
                    <TabButton label={t('pppoe.servers')} icon={<ServerIcon className="w-5 h-5" />} isActive={activeTab === 'servers'} onClick={() => setActiveTab('servers')} />
                </nav>
            </div>

            {activeTab === 'users' && <UsersManager selectedRouter={selectedRouter} addSale={addSale} />}
            {activeTab === 'active_users' && <ActiveUsersManager selectedRouter={selectedRouter} />}
            {activeTab === 'profiles' && <ProfilesManager selectedRouter={selectedRouter} />}
            {activeTab === 'servers' && <ServersManager selectedRouter={selectedRouter} />}
        </div>
    );
};
