import React, { useState } from 'react';
import type { RouterConfigWithId, SaleRecord } from '../types.ts';
import { DhcpClientManagement } from './DhcpClientManagement.tsx';
import { DhcpBillingPlans } from './DhcpBillingPlans.tsx';
import { DhcpCaptivePortalInstaller } from './DhcpCaptivePortalInstaller.tsx';
import { DhcpPortalPageEditor } from './DhcpPortalPageEditor.tsx';
import { DhcpPortalServerManager } from './DhcpPortalServerManager.tsx';
import { ServerIcon } from '../constants.tsx';

type DhcpTab = 'clients' | 'billing' | 'servers' | 'editor' | 'installer';

const TabButton: React.FC<{ label: string, isActive: boolean, onClick: () => void }> = ({ label, isActive, onClick }) => (
    <button
        onClick={onClick}
        className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors duration-200 focus:outline-none ${
            isActive
                ? 'border-[--color-primary-500] text-[--color-primary-500] dark:text-[--color-primary-400]'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
        }`}
    >
        {label}
    </button>
);

export const DhcpPortal: React.FC<{ 
    selectedRouter: RouterConfigWithId | null;
    addSale: (saleData: Omit<SaleRecord, 'id' | 'date' | 'routerName'>) => Promise<void>;
}> = ({ selectedRouter, addSale }) => {
    const [activeTab, setActiveTab] = useState<DhcpTab>('clients');

    if (!selectedRouter) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                <ServerIcon className="w-16 h-16 text-slate-400 dark:text-slate-600 mb-4" />
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">DHCP Captive Portal</h2>
                <p className="mt-2 text-slate-500 dark:text-slate-400">Please select a router to manage the DHCP portal.</p>
            </div>
        );
    }
    
    const renderContent = () => {
        switch(activeTab) {
            case 'clients':
                return <DhcpClientManagement selectedRouter={selectedRouter} addSale={addSale} />;
            case 'billing':
                return <DhcpBillingPlans selectedRouter={selectedRouter} />;
            case 'servers':
                return <DhcpPortalServerManager selectedRouter={selectedRouter} />;
            case 'editor':
                return <DhcpPortalPageEditor selectedRouter={selectedRouter} />;
            case 'installer':
                return <DhcpCaptivePortalInstaller selectedRouter={selectedRouter} />;
            default:
                return null;
        }
    };

    return (
        <div className="space-y-6">
            <div className="border-b border-slate-200 dark:border-slate-700">
                <nav className="flex space-x-2 -mb-px overflow-x-auto" aria-label="Tabs">
                    <TabButton label="Client Management" isActive={activeTab === 'clients'} onClick={() => setActiveTab('clients')} />
                    <TabButton label="Billing Plans" isActive={activeTab === 'billing'} onClick={() => setActiveTab('billing')} />
                    <TabButton label="Server Manager" isActive={activeTab === 'servers'} onClick={() => setActiveTab('servers')} />
                    <TabButton label="Page Editor" isActive={activeTab === 'editor'} onClick={() => setActiveTab('editor')} />
                    <TabButton label="Installer" isActive={activeTab === 'installer'} onClick={() => setActiveTab('installer')} />
                </nav>
            </div>
            <div>
                {renderContent()}
            </div>
        </div>
    );
};
