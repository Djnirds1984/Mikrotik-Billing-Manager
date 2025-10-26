import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { 
    RouterConfigWithId, 
    HotspotActiveUser, 
    HotspotHost, 
    HotspotProfile,
    HotspotUserProfile,
    IpPool,
    HotspotProfileData,
    HotspotUserProfileData,
    Interface,
    SslCertificate,
    HotspotSetupParams
} from '../types.ts';
import { 
    getHotspotActiveUsers, 
    getHotspotHosts, 
    removeHotspotActiveUser,
    getHotspotProfiles, addHotspotProfile, updateHotspotProfile, deleteHotspotProfile,
    getHotspotUserProfiles, addHotspotUserProfile, updateHotspotUserProfile, deleteHotspotUserProfile,
    getIpPools,
    getInterfaces, getSslCertificates, runHotspotSetup
} from '../services/mikrotikService.ts';
import { generateHotspotSetupScript } from '../services/geminiService.ts';
import { Loader } from './Loader.tsx';
import { CodeBlock } from './CodeBlock.tsx';
import { RouterIcon, UsersIcon, ServerIcon, EditIcon, TrashIcon, ChipIcon, CodeBracketIcon, ExclamationTriangleIcon } from '../constants.tsx';
import { NodeMcuManager } from './NodeMcuManager.tsx';
import { HotspotEditor } from './HotspotEditor.tsx';
import { HotspotInstaller } from './HotspotInstaller.tsx';

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
        <span className="ml-2 hidden sm:inline">{label}</span>
    </button>
);

const formatBytes = (bytes?: number): string => {
    if (typeof bytes !== 'number' || isNaN(bytes) || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// --- User Activity Tab (Now Presentational) ---
interface HotspotUserActivityProps {
    activeUsers: HotspotActiveUser[];
    hosts: HotspotHost[];
    onKickUser: (userId: string) => void;
    isSubmitting: boolean;
}

const HotspotUserActivity: React.FC<HotspotUserActivityProps> = ({ activeUsers, hosts, onKickUser, isSubmitting }) => {
    return (
        <div className="space-y-8">
            <div>
                <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-4">Active Users ({activeUsers.length})</h3>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                                <tr>
                                    <th scope="col" className="px-6 py-3">User</th><th scope="col" className="px-6 py-3">Address</th>
                                    <th scope="col" className="px-6 py-3">MAC Address</th><th scope="col" className="px-6 py-3">Uptime</th>
                                    <th scope="col" className="px-6 py-3">Data Usage (Down/Up)</th><th scope="col" className="px-6 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activeUsers.length > 0 ? activeUsers.map(user => (
                                    <tr key={user.id} className="border-b border-slate-200 dark:border-slate-700 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-slate-200">{user.user}</td>
                                        <td className="px-6 py-4 font-mono text-cyan-600 dark:text-cyan-400">{user.address}</td>
                                        <td className="px-6 py-4 font-mono text-slate-600 dark:text-slate-300">{user.macAddress}</td>
                                        <td className="px-6 py-4 font-mono text-slate-600 dark:text-slate-300">{user.uptime}</td>
                                        <td className="px-6 py-4 font-mono text-green-600 dark:text-green-400">{formatBytes(user.bytesIn)} / {formatBytes(user.bytesOut)}</td>
                                        <td className="px-6 py-4 text-right">
                                            <button onClick={() => onKickUser(user.id)} disabled={isSubmitting} className="p-2 text-slate-500 dark:text-slate-400 hover:text-red-500 rounded-md disabled:opacity-50" title="Kick User">
                                                <TrashIcon className="h-5 w-5" />
                                            </button>
                                        </td>
                                    </tr>
                                )) : (
                                    <tr><td colSpan={6} className="text-center py-8 text-slate-500">No active Hotspot users.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            <div>
                <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-4">All Hosts ({hosts.length})</h3>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md overflow-hidden">
                    <div className="overflow-x-auto">
                         <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                                <tr>
                                    <th scope="col" className="px-6 py-3">MAC Address</th><th scope="col" className="px-6 py-3">Address</th><th scope="col" className="px-6 py-3">To Address</th><th scope="col" className="px-6 py-3">Status</th>
                                </tr>
                            </thead>
                             <tbody>
                                {hosts.length > 0 ? hosts.map(host => (
                                    <tr key={host.id} className="border-b border-slate-200 dark:border-slate-700 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                        <td className="px-6 py-4 font-mono text-slate-900 dark:text-slate-200">{host.macAddress}</td>
                                        <td className="px-6 py-4 font-mono text-cyan-600 dark:text-cyan-400">{host.address}</td>
                                        <td className="px-6 py-4 font-mono text-slate-600 dark:text-slate-300">{host.toAddress}</td>
                                        <td className="px-6 py-4 space-x-2">
                                            {host.authorized && <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400">Authorized</span>}
                                            {host.bypassed && <span className="px-2 py-1 text-xs font-semibold rounded-full bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-400">Bypassed</span>}
                                            {!host.authorized && !host.bypassed && <span className="px-2 py-1 text-xs font-semibold rounded-full bg-slate-200 dark:bg-slate-600/50 text-slate-600 dark:text-slate-400">Guest</span>}
                                        </td>
                                    </tr>
                                )) : (
                                    <tr><td colSpan={4} className="text-center py-8 text-slate-500">No Hotspot hosts found.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Server Profiles Tab ---
const HotspotServerProfilesManager: React.FC<{ selectedRouter: RouterConfigWithId }> = ({ selectedRouter }) => {
    const [profiles, setProfiles] = useState<HotspotProfile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProfile, setEditingProfile] = useState<HotspotProfile | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const profilesData = await getHotspotProfiles(selectedRouter);
            setProfiles(profilesData);
        } catch (err) {
            setError(`Could not fetch data: ${(err as Error).message}`);
        } finally {
            setIsLoading(false);
        }
    }, [selectedRouter]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleSave = async (profileData: HotspotProfile | HotspotProfileData) => {
        setIsSubmitting(true);
        try {
            if ('id' in profileData) {
                await updateHotspotProfile(selectedRouter, profileData);
            } else {
                await addHotspotProfile(selectedRouter, profileData);
            }
            setIsModalOpen(false);
            setEditingProfile(null);
            await fetchData();
        } catch (err) { 
            alert(`Error saving profile: ${(err as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (profileId: string) => {
        if (!window.confirm("Are you sure?")) return;
        try {
            await deleteHotspotProfile(selectedRouter, profileId);
            await fetchData();
        } catch (err) { 
            alert(`Error deleting profile: ${(err as Error).message}`);
        }
    };

    const ProfileFormModal: React.FC<{
        isOpen: boolean;
        onClose: () => void;
        onSave: (data: HotspotProfile | HotspotProfileData) => void;
        initialData: HotspotProfile | null;
    }> = ({ isOpen, onClose, onSave, initialData }) => {
        const [profile, setProfile] = useState<Partial<HotspotProfileData>>({ name: '', 'hotspot-address': '', 'rate-limit': '' });
        
        useEffect(() => {
            if (isOpen) {
                if (initialData) {
                    setProfile({ 
                        name: initialData.name, 
                        'hotspot-address': initialData['hotspot-address'] || '',
                        'rate-limit': initialData['rate-limit'] || ''
                    });
                } else {
                    setProfile({ name: '', 'hotspot-address': '', 'rate-limit': '' });
                }
            }
        }, [initialData, isOpen]);

        if (!isOpen) return null;
        
        const handleSubmit = (e: React.FormEvent) => { 
            e.preventDefault(); 
            onSave(initialData ? { ...profile, id: initialData.id } as HotspotProfile : profile as HotspotProfileData); 
        };
        
        const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
            setProfile(p => ({ ...p, [e.target.name]: e.target.value }));
        };

        return (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg">
                    <form onSubmit={handleSubmit}>
                        <div className="p-6">
                            <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400] mb-4">{initialData ? 'Edit Profile' : 'Add New Profile'}</h3>
                           <div className="space-y-4">
                                <div><label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Profile Name</label><input type="text" name="name" value={profile.name} onChange={handleChange} required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2" /></div>
                                <div><label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Hotspot Address</label><input type="text" name="hotspot-address" value={profile['hotspot-address']} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2" /></div>
                                <div><label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Rate Limit (rx/tx)</label><input type="text" placeholder="e.g., 10M/20M" name="rate-limit" value={profile['rate-limit']} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2" /></div>
                            </div>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-3"><button type="button" onClick={onClose} className="px-4 py-2 rounded-md">Cancel</button><button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-[--color-primary-600] text-white rounded-md">Save</button></div>
                    </form>
                </div>
            </div>
        );
    };

    if (isLoading) return <div className="flex justify-center p-8"><Loader /></div>;
    if (error) return <div className="p-4 text-red-600">{error}</div>;

    return (
        <div>
            <ProfileFormModal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditingProfile(null); }} onSave={handleSave} initialData={editingProfile} />
            <div className="flex justify-end mb-4">
                <button onClick={() => { setEditingProfile(null); setIsModalOpen(true); }} className="bg-[--color-primary-600] text-white font-bold py-2 px-4 rounded-lg">Add New Profile</button>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50"><tr><th className="px-6 py-3">Name</th><th className="px-6 py-3">Hotspot Address</th><th className="px-6 py-3">Rate Limit</th><th className="px-6 py-3 text-right">Actions</th></tr></thead>
                    <tbody>
                        {profiles.map(p => (
                            <tr key={p.id} className="border-b dark:border-slate-700">
                                <td className="px-6 py-4 font-medium">{p.name}</td>
                                <td className="px-6 py-4">{p['hotspot-address'] || 'n/a'}</td>
                                <td className="px-6 py-4">{p['rate-limit'] || 'N/A'}</td>
                                <td className="px-6 py-4 text-right space-x-2"><button onClick={() => { setEditingProfile(p); setIsModalOpen(true); }} className="p-1"><EditIcon className="w-5 h-5"/></button><button onClick={() => handleDelete(p.id)} className="p-1"><TrashIcon className="w-5 h-5"/></button></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// --- User Profiles Tab ---
const HotspotUserProfilesManager: React.FC<{ selectedRouter: RouterConfigWithId }> = ({ selectedRouter }) => {
    const [profiles, setProfiles] = useState<HotspotUserProfile[]>([]);
    const [pools, setPools] = useState<IpPool[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProfile, setEditingProfile] = useState<HotspotUserProfile | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [profilesData, poolsData] = await Promise.all([
                getHotspotUserProfiles(selectedRouter),
                getIpPools(selectedRouter),
            ]);
            setProfiles(profilesData);
            setPools(poolsData);
        } catch (err) {
            setError(`Could not fetch data: ${(err as Error).message}`);
        } finally {
            setIsLoading(false);
        }
    }, [selectedRouter]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleSave = async (profileData: HotspotUserProfile | HotspotUserProfileData) => {
        setIsSubmitting(true);
        try {
            if ('id' in profileData) {
                await updateHotspotUserProfile(selectedRouter, profileData);
            } else {
                await addHotspotUserProfile(selectedRouter, profileData);
            }
            setIsModalOpen(false);
            setEditingProfile(null);
            await fetchData();
        } catch (err) { 
            alert(`Error saving profile: ${(err as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (profileId: string) => {
        if (!window.confirm("Are you sure you want to delete this user profile?")) return;
        try {
            await deleteHotspotUserProfile(selectedRouter, profileId);
            await fetchData();
        } catch (err) { 
            alert(`Error deleting profile: ${(err as Error).message}`);
        }
    };

    const ProfileFormModal: React.FC<{
        isOpen: boolean;
        onClose: () => void;
        onSave: (data: HotspotUserProfile | HotspotUserProfileData) => void;
        initialData: HotspotUserProfile | null;
    }> = ({ isOpen, onClose, onSave, initialData }) => {
        const [profile, setProfile] = useState<Partial<HotspotUserProfileData>>({ name: '', 'address-pool': 'none', 'rate-limit': '', 'session-timeout': '00:00:00', 'shared-users': '1' });
        
        useEffect(() => {
            if (isOpen) {
                if (initialData) {
                    setProfile({ 
                        name: initialData.name, 
                        'address-pool': initialData['address-pool'] || 'none',
                        'rate-limit': initialData['rate-limit'] || '',
                        'session-timeout': initialData['session-timeout'] || '00:00:00',
                        'shared-users': initialData['shared-users'] || '1'
                    });
                } else {
                    setProfile({ name: '', 'address-pool': 'none', 'rate-limit': '', 'session-timeout': '00:00:00', 'shared-users': '1' });
                }
            }
        }, [initialData, isOpen]);

        if (!isOpen) return null;
        
        const handleSubmit = (e: React.FormEvent) => { 
            e.preventDefault(); 
            onSave(initialData ? { ...profile, id: initialData.id } as HotspotUserProfile : profile as HotspotUserProfileData); 
        };

        return (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg">
                    <form onSubmit={handleSubmit}>
                        <div className="p-6">
                            <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400] mb-4">{initialData ? 'Edit User Profile' : 'Add New User Profile'}</h3>
                           <div className="space-y-4">
                                <div><label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Profile Name</label><input type="text" name="name" value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2" /></div>
                                <div><label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Address Pool</label><select name="address-pool" value={profile['address-pool']} onChange={e => setProfile(p => ({ ...p, 'address-pool': e.target.value }))} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2"><option value="none">none</option>{pools.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}</select></div>
                                <div><label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Rate Limit (rx/tx)</label><input type="text" placeholder="e.g., 512k/5M" name="rate-limit" value={profile['rate-limit']} onChange={e => setProfile(p => ({ ...p, 'rate-limit': e.target.value }))} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2" /></div>
                                <div className="grid grid-cols-2 gap-4">
                                <div><label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Session Timeout</label><input type="text" placeholder="00:30:00" name="session-timeout" value={profile['session-timeout']} onChange={e => setProfile(p => ({ ...p, 'session-timeout': e.target.value }))} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2" /></div>
                                <div><label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Shared Users</label><input type="number" name="shared-users" value={profile['shared-users']} onChange={e => setProfile(p => ({ ...p, 'shared-users': e.target.value }))} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2" /></div>
                                </div>
                            </div>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-3"><button type="button" onClick={onClose} className="px-4 py-2 rounded-md">Cancel</button><button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-[--color-primary-600] text-white rounded-md">Save</button></div>
                    </form>
                </div>
            </div>
        );
    };

    if (isLoading) return <div className="flex justify-center p-8"><Loader /></div>;
    if (error) return <div className="p-4 text-red-600">{error}</div>;

    return (
        <div>
            <ProfileFormModal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditingProfile(null); }} onSave={handleSave} initialData={editingProfile} />
            <div className="flex justify-end mb-4">
                <button onClick={() => { setEditingProfile(null); setIsModalOpen(true); }} className="bg-[--color-primary-600] text-white font-bold py-2 px-4 rounded-lg">Add New User Profile</button>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50"><tr><th className="px-6 py-3">Name</th><th className="px-6 py-3">Address Pool</th><th className="px-6 py-3">Rate Limit</th><th className="px-6 py-3">Shared Users</th><th className="px-6 py-3 text-right">Actions</th></tr></thead>
                    <tbody>
                        {profiles.map(p => (
                            <tr key={p.id} className="border-b dark:border-slate-700">
                                <td className="px-6 py-4 font-medium">{p.name}</td>
                                <td className="px-6 py-4">{p['address-pool'] || 'none'}</td>
                                <td className="px-6 py-4">{p['rate-limit'] || 'N/A'}</td>
                                <td className="px-6 py-4">{p['shared-users'] || 'N/A'}</td>
                                <td className="px-6 py-4 text-right space-x-2"><button onClick={() => { setEditingProfile(p); setIsModalOpen(true); }} className="p-1"><EditIcon className="w-5 h-5"/></button><button onClick={() => handleDelete(p.id)} className="p-1"><TrashIcon className="w-5 h-5"/></button></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// --- Main Hotspot Component ---

export const Hotspot: React.FC<{ selectedRouter: RouterConfigWithId | null }> = ({ selectedRouter }) => {
    const [activeTab, setActiveTab] = useState<'user-activity' | 'nodemcu' | 'editor' | 'server-profiles' | 'user-profiles' | 'setup'>('user-activity');
    
    // --- LIFTED STATE & LOGIC for user-activity and nodemcu ---
    const [activeUsers, setActiveUsers] = useState<HotspotActiveUser[]>([]);
    const [hosts, setHosts] = useState<HotspotHost[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<Record<string, string> | null>(null);

    const fetchData = useCallback(async (isInitial = false) => {
        if (!selectedRouter) {
            setActiveUsers([]);
            setHosts([]);
            if (isInitial) setIsLoading(false);
            return;
        }

        if (isInitial) setIsLoading(true);
        setError(null);
        
        const [activeRes, hostsRes] = await Promise.allSettled([
            getHotspotActiveUsers(selectedRouter),
            getHotspotHosts(selectedRouter)
        ]);

        const newErrors: Record<string, string> = {};
        if (activeRes.status === 'fulfilled') {
            setActiveUsers(activeRes.value);
        } else {
            console.error("Failed to fetch Hotspot active users:", activeRes.reason);
            newErrors.active = "Could not fetch active users. The Hotspot package might not be configured.";
            setActiveUsers([]);
        }

        if (hostsRes.status === 'fulfilled') {
            setHosts(hostsRes.value);
        } else {
            console.error("Failed to fetch Hotspot hosts:", hostsRes.reason);
            newErrors.hosts = "Could not fetch device hosts.";
            setHosts([]);
        }

        if (Object.keys(newErrors).length > 0) {
            setError(newErrors);
        }

        if (isInitial) setIsLoading(false);
    }, [selectedRouter]);

    useEffect(() => {
        if (!selectedRouter) return;
        if (activeTab === 'user-activity' || activeTab === 'nodemcu') {
            fetchData(true);
            const interval = setInterval(() => fetchData(false), 5000);
            return () => clearInterval(interval);
        }
    }, [selectedRouter, fetchData, activeTab]);

    const handleKickUser = async (userId: string) => {
        if (!selectedRouter || !window.confirm("Are you sure you want to kick this user?")) return;
        setIsSubmitting(true);
        try {
            await removeHotspotActiveUser(selectedRouter, userId);
            await fetchData(true); // Force a full refresh
        } catch(err) {
            alert(`Error kicking user: ${(err as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!selectedRouter) {
        return (
             <div className="flex flex-col items-center justify-center h-96 text-center bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                <RouterIcon className="w-16 h-16 text-slate-400 dark:text-slate-600 mb-4" />
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">Hotspot Management</h2>
                <p className="mt-2 text-slate-500 dark:text-slate-400">Please select a router to manage its Hotspot.</p>
            </div>
        );
    }
    
    const renderTabContent = () => {
        if (isLoading && (activeTab === 'user-activity' || activeTab === 'nodemcu')) {
            return (
                <div className="flex flex-col items-center justify-center h-64">
                    <Loader />
                    <p className="mt-4 text-[--color-primary-500] dark:text-[--color-primary-400]">Fetching Hotspot data from {selectedRouter.name}...</p>
                </div>
            );
        }
        
        if (error && (activeTab === 'user-activity' || activeTab === 'nodemcu')) {
             return (
                 <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700/50 text-yellow-800 dark:text-yellow-300 p-3 rounded-lg text-sm flex items-center gap-3">
                    <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0" />
                    <div>
                        <p className="font-semibold">Data Warning:</p>
                        <ul className="list-disc pl-5">
                            {Object.values(error).map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                    </div>
                </div>
             );
        }

        switch (activeTab) {
            case 'user-activity': 
                return <HotspotUserActivity activeUsers={activeUsers} hosts={hosts} onKickUser={handleKickUser} isSubmitting={isSubmitting} />;
            case 'nodemcu': 
                return <NodeMcuManager hosts={hosts} />;
            case 'editor': 
                return <HotspotEditor selectedRouter={selectedRouter} />;
            case 'server-profiles': 
                return <HotspotServerProfilesManager selectedRouter={selectedRouter} />;
            case 'user-profiles': 
                return <HotspotUserProfilesManager selectedRouter={selectedRouter} />;
            case 'setup': 
                return <HotspotInstaller selectedRouter={selectedRouter} />;
            default: return null;
        }
    };

    return (
        <div className="space-y-6">
             <div className="border-b border-slate-200 dark:border-slate-700">
                <nav className="flex space-x-2 -mb-px overflow-x-auto" aria-label="Tabs">
                    <TabButton label="User Activity" icon={<UsersIcon className="w-5 h-5"/>} isActive={activeTab === 'user-activity'} onClick={() => setActiveTab('user-activity')} />
                    <TabButton label="NodeMCU Vendo" icon={<ChipIcon className="w-5 h-5"/>} isActive={activeTab === 'nodemcu'} onClick={() => setActiveTab('nodemcu')} />
                    <TabButton label="Login Page Editor" icon={<CodeBracketIcon className="w-5 h-5"/>} isActive={activeTab === 'editor'} onClick={() => setActiveTab('editor')} />
                    <TabButton label="Server Profiles" icon={<ServerIcon className="w-5 h-5"/>} isActive={activeTab === 'server-profiles'} onClick={() => setActiveTab('server-profiles')} />
                    <TabButton label="User Profiles" icon={<UsersIcon className="w-5 h-5"/>} isActive={activeTab === 'user-profiles'} onClick={() => setActiveTab('user-profiles')} />
                    <TabButton label="Server Setup" icon={<ServerIcon className="w-5 h-5"/>} isActive={activeTab === 'setup'} onClick={() => setActiveTab('setup')} />
                </nav>
            </div>
            <div>
                {renderTabContent()}
            </div>
        </div>
    );
};
