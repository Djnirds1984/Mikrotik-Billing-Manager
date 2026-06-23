import React, { useState, useEffect, useMemo } from 'react';
import { Loader } from './Loader.tsx';
import { useRouters } from '../hooks/useRouters.ts';

interface ClientUser {
    id: string;
    username: string;
    router_id: string;
    pppoe_username: string;
    account_number?: string;
    created_at: string;
}

export const ClientPortalUsers: React.FC = () => {
    const [users, setUsers] = useState<ClientUser[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const { routers } = useRouters();

    // Form State
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [routerId, setRouterId] = useState('');
    const [pppoeUsername, setPppoeUsername] = useState('');
    const [accountNumber, setAccountNumber] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/client-portal/users', {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
            });
            if (!res.ok) throw new Error('Failed to fetch users');
            const data = await res.json();
            setUsers(data);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    // Auto-fetch account number when pppoeUsername or routerId changes
    useEffect(() => {
        const fetchAccountNumber = async () => {
            if (!routerId || !pppoeUsername) {
                setAccountNumber('');
                return;
            }
            
            try {
                const res = await fetch(
                    `/api/client-portal/lookup-account?routerId=${encodeURIComponent(routerId)}&pppoeUsername=${encodeURIComponent(pppoeUsername)}`,
                    {
                        headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
                    }
                );
                
                if (!res.ok) {
                    console.error('Failed to fetch account number');
                    return;
                }
                
                const data = await res.json();
                if (data.found && data.accountNumber) {
                    setAccountNumber(data.accountNumber);
                } else {
                    setAccountNumber('');
                    console.warn('Account number not found for this PPPoE user');
                }
            } catch (e) {
                console.error('Error fetching account number:', e);
            }
        };
        
        fetchAccountNumber();
    }, [routerId, pppoeUsername]);

    // Filter users by search term
    const filteredUsers = useMemo(() => {
        if (!searchTerm.trim()) return users;
        const term = searchTerm.toLowerCase().trim();
        return users.filter(u =>
            (u.username || '').toLowerCase().includes(term) ||
            (u.pppoe_username || '').toLowerCase().includes(term) ||
            (u.account_number || '').toLowerCase().includes(term) ||
            (routers.find(r => r.id === u.router_id)?.name || '').toLowerCase().includes(term)
        );
    }, [users, searchTerm, routers]);

    // Count auto-created vs manually created (auto-created = username matches pppoe_username)
    const autoCreatedCount = useMemo(() => users.filter(u => u.username === u.pppoe_username).length, [users]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!username || !password || !routerId || !pppoeUsername) {
            alert('Portal Username, Password, Router, and PPPoE Username are required');
            return;
        }
        if (!accountNumber) {
            alert('Account number not found for this PPPoE user. Please ensure the PPPoE user exists in the system.');
            return;
        }
        setIsSubmitting(true);
        try {
            const res = await fetch('/api/client-portal/users', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                },
                body: JSON.stringify({ username, password, routerId, pppoeUsername, accountNumber })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            
            setUsername('');
            setPassword('');
            setPppoeUsername('');
            setAccountNumber('');
            // routerId kept as is for convenience
            fetchData();
            alert('User created successfully');
        } catch (e) {
            alert((e as Error).message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Are you sure?')) return;
        try {
            const res = await fetch(`/api/client-portal/users/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
            });
            if (!res.ok) throw new Error('Failed to delete');
            fetchData();
        } catch (e) {
            alert((e as Error).message);
        }
    };

    if (isLoading && users.length === 0) return <Loader />;

    return (
        <div className="max-w-6xl mx-auto space-y-6 p-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Client Portal Users</h2>
                <div className="flex items-center gap-3 text-sm">
                    <span className="px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium">
                        Total: <strong>{users.length}</strong>
                    </span>
                    <span className="px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-medium">
                        Auto-synced: <strong>{autoCreatedCount}</strong>
                    </span>
                    <span className="px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium">
                        Manual: <strong>{users.length - autoCreatedCount}</strong>
                    </span>
                </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <p className="text-sm text-blue-800 dark:text-blue-300">
                    <strong>Note:</strong> Client portal accounts are automatically created when you add or edit a PPPoE user from the PPPoE User Management page. 
                    The portal username and password match the PPPoE credentials. You can also manually create accounts here if needed.
                </p>
            </div>
            
            <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-md border border-slate-200 dark:border-slate-700">
                <h3 className="text-lg font-semibold mb-4 text-slate-800 dark:text-white">Manually Create Credentials</h3>
                <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Portal Username</label>
                        <input 
                            value={username} 
                            onChange={e => setUsername(e.target.value)} 
                            className="mt-1 w-full p-2 rounded border dark:bg-slate-700 dark:border-slate-600" 
                            placeholder="Login username"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Portal Password</label>
                        <input 
                            type="password"
                            value={password} 
                            onChange={e => setPassword(e.target.value)} 
                            className="mt-1 w-full p-2 rounded border dark:bg-slate-700 dark:border-slate-600" 
                            placeholder="Login password"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Router</label>
                        <select 
                            value={routerId} 
                            onChange={e => setRouterId(e.target.value)} 
                            className="mt-1 w-full p-2 rounded border dark:bg-slate-700 dark:border-slate-600"
                        >
                            <option value="">Select Router...</option>
                            {routers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Linked PPPoE Username</label>
                        <input 
                            value={pppoeUsername} 
                            onChange={e => setPppoeUsername(e.target.value)} 
                            className="mt-1 w-full p-2 rounded border dark:bg-slate-700 dark:border-slate-600" 
                            placeholder="e.g. client123 (Must match PPPoE Secret)"
                        />
                        <p className="text-xs text-slate-500 mt-1">This links the portal login to the actual PPPoE account for billing/status.</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Account Number</label>
                        <input 
                            value={accountNumber} 
                            readOnly
                            className="mt-1 w-full p-2 rounded border dark:bg-slate-700 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 cursor-not-allowed" 
                            placeholder="Auto-filled from PPPoE user"
                        />
                        <p className="text-xs text-slate-500 mt-1">
                            {accountNumber 
                                ? '✓ Fetched from PPPoE user database' 
                                : 'Enter PPPoE username to auto-fetch account number'}
                        </p>
                    </div>
                    <div className="md:col-span-2">
                        <button 
                            type="submit" 
                            disabled={isSubmitting}
                            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                            {isSubmitting ? 'Creating...' : 'Create Credentials'}
                        </button>
                    </div>
                </form>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <h3 className="text-lg font-semibold text-slate-800 dark:text-white">All Portal Accounts</h3>
                    <div className="relative w-full sm:w-64">
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            placeholder="Search by username, PPPoE, account..."
                            className="w-full pl-8 pr-3 py-2 text-sm border rounded-md dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                        />
                        <svg className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>
                </div>
                <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
                    <thead className="bg-slate-100 dark:bg-slate-900 uppercase font-semibold">
                        <tr>
                            <th className="px-6 py-3">Portal Username</th>
                            <th className="px-6 py-3">Type</th>
                            <th className="px-6 py-3">Linked Router</th>
                            <th className="px-6 py-3">PPPoE Account</th>
                            <th className="px-6 py-3">Account Number</th>
                            <th className="px-6 py-3">Created At</th>
                            <th className="px-6 py-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {filteredUsers.map(u => {
                            const rName = routers.find(r => r.id === u.router_id)?.name || u.router_id || '-';
                            const isAutoCreated = u.username === u.pppoe_username;
                            return (
                                <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">{u.username}</td>
                                    <td className="px-6 py-4">
                                        {isAutoCreated ? (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                                                Auto-synced
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                                Manual
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4">{rName}</td>
                                    <td className="px-6 py-4">{u.pppoe_username || '-'}</td>
                                    <td className="px-6 py-4">{u.account_number || '-'}</td>
                                    <td className="px-6 py-4">{new Date(u.created_at).toLocaleDateString()}</td>
                                    <td className="px-6 py-4">
                                        <button 
                                            onClick={() => handleDelete(u.id)} 
                                            className="text-red-600 hover:text-red-800 font-medium"
                                        >
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                        {filteredUsers.length === 0 && (
                            <tr>
                                <td colSpan={7} className="px-6 py-8 text-center text-slate-500">
                                    {users.length === 0 ? 'No client portal accounts yet.' : 'No matching accounts found.'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
