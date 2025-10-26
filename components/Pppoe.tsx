import React, { useState, useEffect, useCallback } from 'react';
import type { RouterConfigWithId, PppSecret, PppActiveConnection, PppProfile, PppServer, SaleRecord } from '../types.ts';
import { getPppSecrets, getPppActiveConnections, getPppProfiles, getPppServers, processPppPayment } from '../services/mikrotikService.ts';
import { useCustomers } from '../hooks/useCustomers.ts';
import { useBillingPlans } from '../hooks/useBillingPlans.ts';
import { Loader } from './Loader.tsx';
import { PaymentModal } from './PaymentModal.tsx';
import { Billing } from './Billing.tsx';
import { UsersIcon, SignalIcon, ServerIcon } from '../constants.tsx';

type PppoeTab = 'secrets' | 'active' | 'profiles' | 'servers' | 'billing';

const TabButton: React.FC<{ label: string, isActive: boolean, onClick: () => void }> = ({ label, isActive, onClick }) => (
    <button
        onClick={onClick}
        className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors duration-200 focus:outline-none ${
            isActive
                ? 'border-[--color-primary-500] text-[--color-primary-500]'
                : 'border-transparent text-slate-500 hover:text-slate-700'
        }`}
    >
        {label}
    </button>
);

const SecretsManager: React.FC<{ 
    selectedRouter: RouterConfigWithId,
    addSale: (saleData: Omit<SaleRecord, 'id' | 'date' | 'routerName'>) => Promise<void>
}> = ({ selectedRouter, addSale }) => {
    const [secrets, setSecrets] = useState<PppSecret[]>([]);
    const [activeConnections, setActiveConnections] = useState<PppActiveConnection[]>([]);
    const [profiles, setProfiles] = useState<PppProfile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [selectedSecret, setSelectedSecret] = useState<PppSecret | null>(null);

    const { customers, isLoading: isLoadingCustomers } = useCustomers(selectedRouter.id);
    const { plans, isLoading: isLoadingPlans } = useBillingPlans(selectedRouter.id);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [secretsData, activeData, profilesData] = await Promise.all([
                getPppSecrets(selectedRouter),
                getPppActiveConnections(selectedRouter),
                getPppProfiles(selectedRouter)
            ]);

            const secretsWithCustomerData = secretsData.map(secret => {
                const customer = customers.find(c => c.username === secret.name);
                return { ...secret, customer };
            });

            setSecrets(secretsWithCustomerData);
            setActiveConnections(activeData);
            setProfiles(profilesData);
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    }, [selectedRouter, customers]);

    useEffect(() => {
        if (!isLoadingCustomers) {
            fetchData();
        }
    }, [fetchData, isLoadingCustomers]);

    const handleProcessPayment = async (data: any) => {
        if (!selectedSecret) return false;
        try {
            await processPppPayment(selectedRouter, { secret: selectedSecret, ...data.payment });
            await addSale({ ...data.sale, routerName: selectedRouter.name });
            await fetchData();
            return true;
        } catch (error) {
            alert(`Payment processing failed: ${(error as Error).message}`);
            return false;
        }
    };
    
    if (isLoading || isLoadingCustomers || isLoadingPlans) return <Loader />;

    return (
        <div>
            <PaymentModal 
                isOpen={isPaymentModalOpen}
                onClose={() => setIsPaymentModalOpen(false)}
                secret={selectedSecret}
                plans={plans}
                profiles={profiles}
                onSave={handleProcessPayment}
                companySettings={{}} // This should be passed down from App.tsx eventually
            />
             <div className="bg-white dark:bg-slate-800 border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                    <thead><tr className="border-b"><th className="p-4 text-left">Name</th><th className="p-4 text-left">Profile</th><th className="p-4 text-left">Status</th><th className="p-4 text-right">Actions</th></tr></thead>
                    <tbody>
                        {secrets.map(s => (
                            <tr key={s.id} className="border-b last:border-0">
                                <td className="p-4">{s.customer?.fullName || s.name}</td>
                                <td className="p-4">{s.profile}</td>
                                <td className="p-4">{activeConnections.some(ac => ac.name === s.name) ? <span className="text-green-500">Online</span> : <span className="text-slate-500">Offline</span>}</td>
                                <td className="p-4 text-right">
                                    <button onClick={() => { setSelectedSecret(s); setIsPaymentModalOpen(true); }} className="bg-green-500 text-white px-3 py-1 rounded-md text-xs">Pay</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export const Pppoe: React.FC<{ 
    selectedRouter: RouterConfigWithId | null,
    addSale: (saleData: Omit<SaleRecord, 'id'|'date'|'routerName'>) => Promise<void> 
}> = ({ selectedRouter, addSale }) => {
    const [activeTab, setActiveTab] = useState<PppoeTab>('secrets');
    const [profiles, setProfiles] = useState<PppProfile[]>([]);

     useEffect(() => {
        if (selectedRouter) {
            getPppProfiles(selectedRouter).then(setProfiles).catch(console.error);
        }
    }, [selectedRouter]);

    if (!selectedRouter) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center bg-white dark:bg-slate-800 rounded-lg border">
                <UsersIcon className="w-16 h-16 text-slate-400 mb-4" />
                <h2 className="text-2xl font-bold">PPPoE Manager</h2>
                <p className="mt-2 text-slate-500">Please select a router to manage PPPoE services.</p>
            </div>
        );
    }
    
    const renderContent = () => {
        switch(activeTab) {
            case 'secrets':
                return <SecretsManager selectedRouter={selectedRouter} addSale={addSale} />;
            case 'billing':
                return <Billing selectedRouter={selectedRouter} profiles={profiles} />;
            case 'active':
            case 'profiles':
            case 'servers':
                 return <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">Component for {activeTab} is under construction.</div>;
            default:
                return null;
        }
    };

    return (
        <div className="space-y-6">
            <div className="border-b border-slate-200 dark:border-slate-700">
                <nav className="flex space-x-2 -mb-px overflow-x-auto" aria-label="Tabs">
                    <TabButton label="Secrets" isActive={activeTab === 'secrets'} onClick={() => setActiveTab('secrets')} />
                    <TabButton label="Active" isActive={activeTab === 'active'} onClick={() => setActiveTab('active')} />
                    <TabButton label="Profiles" isActive={activeTab === 'profiles'} onClick={() => setActiveTab('profiles')} />
                    <TabButton label="Servers" isActive={activeTab === 'servers'} onClick={() => setActiveTab('servers')} />
                    <TabButton label="Billing Plans" isActive={activeTab === 'billing'} onClick={() => setActiveTab('billing')} />
                </nav>
            </div>
            <div>
                {renderContent()}
            </div>
        </div>
    );
};
