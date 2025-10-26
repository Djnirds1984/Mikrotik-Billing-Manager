import React, { useState } from 'react';
import type { RouterConfigWithId } from '../types.ts';
import { Firewall } from './Firewall.tsx';
import { SimpleQueues } from './SimpleQueues.tsx';
import { IpRoutes } from './IpRoutes.tsx';
import { Vlans } from './Vlans.tsx';
import { getInterfaces } from '../services/mikrotikService.ts';
import { ShareIcon, Loader } from '../constants.tsx';

type NetworkTab = 'routes' | 'vlans' | 'firewall' | 'queues';

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

export const Network: React.FC<{ selectedRouter: RouterConfigWithId | null }> = ({ selectedRouter }) => {
    const [activeTab, setActiveTab] = useState<NetworkTab>('routes');
    const [interfaces, setInterfaces] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    React.useEffect(() => {
        if (selectedRouter) {
            setIsLoading(true);
            getInterfaces(selectedRouter)
                .then(setInterfaces)
                .catch(err => console.error("Failed to fetch interfaces for Network view", err))
                .finally(() => setIsLoading(false));
        }
    }, [selectedRouter]);
    
    if (!selectedRouter) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center bg-white dark:bg-slate-800 rounded-lg border">
                <ShareIcon className="w-16 h-16 text-slate-400 mb-4" />
                <h2 className="text-2xl font-bold">Network Management</h2>
                <p className="mt-2 text-slate-500">Please select a router to manage its network configuration.</p>
            </div>
        );
    }
    
    if (isLoading) {
        return <div className="flex justify-center p-8"><Loader /></div>;
    }

    const renderContent = () => {
        switch(activeTab) {
            case 'routes':
                return <IpRoutes selectedRouter={selectedRouter} interfaces={interfaces} />;
            case 'vlans':
                return <Vlans selectedRouter={selectedRouter} interfaces={interfaces} />;
            case 'firewall':
                return <Firewall selectedRouter={selectedRouter} interfaces={interfaces} />;
            case 'queues':
                 return <SimpleQueues selectedRouter={selectedRouter} />;
            default:
                return null;
        }
    };

    return (
        <div className="space-y-6">
            <div className="border-b border-slate-200 dark:border-slate-700">
                <nav className="flex space-x-2 -mb-px overflow-x-auto" aria-label="Tabs">
                    <TabButton label="IP Routes" isActive={activeTab === 'routes'} onClick={() => setActiveTab('routes')} />
                    <TabButton label="VLANs" isActive={activeTab === 'vlans'} onClick={() => setActiveTab('vlans')} />
                    <TabButton label="Firewall" isActive={activeTab === 'firewall'} onClick={() => setActiveTab('firewall')} />
                    <TabButton label="Simple Queues" isActive={activeTab === 'queues'} onClick={() => setActiveTab('queues')} />
                </nav>
            </div>
            <div>
                {renderContent()}
            </div>
        </div>
    );
};
// Dummy sub-components for structure
const IpRoutes: React.FC<any> = ({ selectedRouter }) => <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">IP Routes management for {selectedRouter.name}. Component under construction.</div>;
const Vlans: React.FC<any> = ({ selectedRouter }) => <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">VLANs management for {selectedRouter.name}. Component under construction.</div>;
const SimpleQueues: React.FC<any> = ({ selectedRouter }) => <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">Simple Queues management for {selectedRouter.name}. Component under construction.</div>;
