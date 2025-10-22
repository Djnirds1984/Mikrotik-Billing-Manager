import React, { useState } from 'react';
import type { RouterConfigWithId } from '../types.ts';
import { DhcpClientManagement } from './DhcpClientManagement.tsx';
import { DhcpCaptivePortalInstaller } from './DhcpCaptivePortalInstaller.tsx';
import { DhcpPortalServerManager } from './DhcpPortalServerManager.tsx';
import { UsersIcon, ServerIcon, RouterIcon } from '../constants.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';

const TabButton: React.FC<{ label: string, icon: React.ReactNode, isActive: boolean, onClick: () => void }> = ({ label, icon, isActive, onClick }) => (
    <button
        onClick={onClick}
        className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors duration-200 focus:outline-none ${
            isActive
                ? 'border-[--color-primary-500] text-[--color-primary-500] dark:text-[--color-primary-400]'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
        }`}
    >
        {icon}
        <span className="hidden sm:inline">{label}</span>
    </button>
);

type ActiveTab = 'clients' | 'server' | 'installer';

export const DhcpPortal: React.FC<{ selectedRouter: RouterConfigWithId | null }> = ({ selectedRouter }) => {
    const { t } = useLocalization();
    const [activeTab, setActiveTab] = useState<ActiveTab>('clients');

    if (!selectedRouter) {
        return (
            <div className="flex flex-col items-center justify-center h-96 text-center bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                <RouterIcon className="w-16 h-16 text-slate-400 dark:text-slate-600 mb-4" />
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">DHCP Captive Portal</h2>
                <p className="mt-2 text-slate-500 dark:text-slate-400">Please select a router to manage its DHCP Portal.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
             <div className="border-b border-slate-200 dark:border-slate-700">
                <nav className="flex space-x-2 -mb-px overflow-x-auto" aria-label="Tabs">
                    <TabButton label={t('dhcp_portal.client_management')} icon={<UsersIcon className="w-5 h-5"/>} isActive={activeTab === 'clients'} onClick={() => setActiveTab('clients')} />
                    <TabButton label={t('dhcp_portal.portal_server')} icon={<ServerIcon className="w-5 h-5"/>} isActive={activeTab === 'server'} onClick={() => setActiveTab('server')} />
                    <TabButton label={t('dhcp_portal.portal_installer')} icon={<ServerIcon className="w-5 h-5"/>} isActive={activeTab === 'installer'} onClick={() => setActiveTab('installer')} />
                </nav>
            </div>
            <div>
                {activeTab === 'clients' && <DhcpClientManagement selectedRouter={selectedRouter} />}
                {activeTab === 'server' && <DhcpPortalServerManager selectedRouter={selectedRouter} />}
                {activeTab === 'installer' && <DhcpCaptivePortalInstaller selectedRouter={selectedRouter} />}
            </div>
        </div>
    );
};