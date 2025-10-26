import React, { useState, useEffect, useCallback } from 'react';
import type { RouterConfigWithId, HotspotActiveUser, HotspotHost, HotspotProfile, HotspotUserProfile } from '../types.ts';
import { 
    getHotspotActiveUsers, removeHotspotActiveUser, getHotspotHosts, 
    getHotspotProfiles, addHotspotProfile, updateHotspotProfile, deleteHotspotProfile,
    getHotspotUserProfiles, addHotspotUserProfile, updateHotspotUserProfile, deleteHotspotUserProfile
} from '../services/mikrotikService.ts';
import { Loader } from './Loader.tsx';
import { HotspotInstaller } from './HotspotInstaller.tsx';
import { HotspotEditor } from './HotspotEditor.tsx';
import { PanelHotspot } from './VoucherHotspot.tsx';
import { NodeMcuManager } from './NodeMcuManager.tsx';
import { WifiIcon, UsersIcon, ServerIcon, EditIcon, TrashIcon } from '../constants.tsx';

type HotspotTab = 'active' | 'hosts' | 'users' | 'user_profiles' | 'server_profiles' | 'installer' | 'editor' | 'vouchers' | 'vendo';

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

const ActiveUsers: React.FC<{ selectedRouter: RouterConfigWithId }> = ({ selectedRouter }) => {
    const [users, setUsers] = useState<HotspotActiveUser[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await getHotspotActiveUsers(selectedRouter);
            setUsers(data);
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    }, [selectedRouter]);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 5000);
        return () => clearInterval(interval);
    }, [fetchData]);

    const handleKick = async (id: string) => {
        if (window.confirm('Kick this user?')) {
            await removeHotspotActiveUser(selectedRouter, id);
            fetchData();
        }
    };
    
    if (isLoading) return <Loader />;

    return (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md overflow-hidden">
             <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50">
                        <tr>
                            <th className="px-6 py-3">User</th>
                            <th className="px-6 py-3">Address</th>
                            <th className="px-6 py-3">Uptime</th>
                            <th className="px-6 py-3">Comment</th>
                            <th className="px-6 py-3 text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map(user => (
                            <tr key={user.id} className="border-b dark:border-slate-700">
                                <td className="px-6 py-4">{user.user}</td>
                                <td className="px-6 py-4 font-mono">{user.address}</td>
                                <td className="px-6 py-4">{user.uptime}</td>
                                <td className="px-6 py-4">{user.comment}</td>
                                <td className="px-6 py-4 text-right">
                                    <button onClick={() => handleKick(user.id)} className="text-red-500 hover:text-red-700"><TrashIcon className="w-5 h-5" /></button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export const Hotspot: React.FC<{ selectedRouter: RouterConfigWithId | null }> = ({ selectedRouter }) => {
    const [activeTab, setActiveTab] = useState<HotspotTab>('active');
    const [hosts, setHosts] = useState<HotspotHost[] | null>(null);

    useEffect(() => {
        if (selectedRouter && (activeTab === 'hosts' || activeTab === 'vendo')) {
            getHotspotHosts(selectedRouter).then(setHosts);
        }
    }, [selectedRouter, activeTab]);

    if (!selectedRouter) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center bg-white dark:bg-slate-800 rounded-lg border">
                <WifiIcon className="w-16 h-16 text-slate-400 mb-4" />
                <h2 className="text-2xl font-bold">Hotspot Manager</h2>
                <p className="mt-2 text-slate-500">Please select a router to manage Hotspot services.</p>
            </div>
        );
    }
    
    const renderContent = () => {
        switch(activeTab) {
            case 'active':
                return <ActiveUsers selectedRouter={selectedRouter} />;
            case 'hosts':
                return hosts ? <div>{hosts.length} hosts found. Display component needed.</div> : <Loader />;
            case 'vendo':
                return <NodeMcuManager hosts={hosts} />;
            case 'installer':
                return <HotspotInstaller selectedRouter={selectedRouter} />;
            case 'editor':
                return <HotspotEditor selectedRouter={selectedRouter} />;
            case 'vouchers':
                return <PanelHotspot selectedRouter={selectedRouter} />;
            default:
                return <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">Content for {activeTab} is under construction.</div>;
        }
    };

    return (
        <div className="space-y-6">
            <div className="border-b border-slate-200 dark:border-slate-700">
                <nav className="flex space-x-2 -mb-px overflow-x-auto" aria-label="Tabs">
                    <TabButton label="Active" isActive={activeTab === 'active'} onClick={() => setActiveTab('active')} />
                    <TabButton label="Hosts" isActive={activeTab === 'hosts'} onClick={() => setActiveTab('hosts')} />
                    <TabButton label="Users" isActive={activeTab === 'users'} onClick={() => setActiveTab('users')} />
                    <TabButton label="User Profiles" isActive={activeTab === 'user_profiles'} onClick={() => setActiveTab('user_profiles')} />
                    <TabButton label="Server Profiles" isActive={activeTab === 'server_profiles'} onClick={() => setActiveTab('server_profiles')} />
                    <TabButton label="Vendo Machines" isActive={activeTab === 'vendo'} onClick={() => setActiveTab('vendo')} />
                    <TabButton label="Panel Vouchers" isActive={activeTab === 'vouchers'} onClick={() => setActiveTab('vouchers')} />
                    <TabButton label="Installer" isActive={activeTab === 'installer'} onClick={() => setActiveTab('installer')} />
                    <TabButton label="Login Page Editor" isActive={activeTab === 'editor'} onClick={() => setActiveTab('editor')} />
                </nav>
            </div>
            <div>
                {renderContent()}
            </div>
        </div>
    );
};
