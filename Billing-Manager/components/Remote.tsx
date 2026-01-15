import React, { useState } from 'react';
import { ZeroTier } from './ZeroTier.tsx';
import { PiTunnel } from './PiTunnel.tsx';
import { NgrokManager } from './NgrokManager.tsx';
import { Dataplicity } from './Dataplicity.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { ZeroTierIcon, CloudIcon, DataplicityIcon } from '../constants.tsx';

type ActiveTab = 'zerotier' | 'pitunnel' | 'ngrok' | 'dataplicity';

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

export const Remote: React.FC = () => {
    const { t } = useLocalization();
    const [activeTab, setActiveTab] = useState<ActiveTab>('zerotier');

    const renderContent = () => {
        switch (activeTab) {
            case 'zerotier':
                return <ZeroTier />;
            case 'pitunnel':
                return <PiTunnel />;
            case 'ngrok':
                return <NgrokManager />;
            case 'dataplicity':
                return <Dataplicity />;
            default:
                return null;
        }
    };

    return (
        <div className="space-y-6 max-w-4xl mx-auto">
             <div className="border-b border-slate-200 dark:border-slate-700">
                <nav className="flex space-x-2 -mb-px overflow-x-auto" aria-label="Tabs">
                    <TabButton label={t('remote.zerotier')} icon={<ZeroTierIcon className="w-5 h-5"/>} isActive={activeTab === 'zerotier'} onClick={() => setActiveTab('zerotier')} />
                    <TabButton label={t('remote.pitunnel')} icon={<CloudIcon className="w-5 h-5"/>} isActive={activeTab === 'pitunnel'} onClick={() => setActiveTab('pitunnel')} />
                    <TabButton label={t('remote.ngrok')} icon={<CloudIcon className="w-5 h-5"/>} isActive={activeTab === 'ngrok'} onClick={() => setActiveTab('ngrok')} />
                    <TabButton label={t('remote.dataplicity')} icon={<DataplicityIcon className="w-5 h-5"/>} isActive={activeTab === 'dataplicity'} onClick={() => setActiveTab('dataplicity')} />
                </nav>
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md p-6">
                {renderContent()}
            </div>
        </div>
    );
};
