import React, { useState, useEffect } from 'react';
import { Loader } from './Loader.tsx';
import { useRouters } from '../hooks/useRouters.ts';

interface ClientUser {
    id: string;
    username: string;
    router_id: string;
    pppoe_username: string;
    created_at: string;
}

export const ClientPortalUsers: React.FC = () => {
    const [users, setUsers] = useState<ClientUser[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { routers } = useRouters();

    // Form State
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [routerId, setRouterId] = useState('');
    const [pppoeUsername, setPppoeUsername] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/client-portal/users', {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!username || !password || !routerId || !pppoeUsername) {
            alert('All fields are required');
            return;
        }
        setIsSubmitting(true);
        try {
            const res = await fetch('/api/client-portal/users', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ username, password, routerId, pppoeUsername })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            
            setUsername('');
            setPassword('');
            setPppoeUsername('');
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
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
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
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Client Portal Users</h2>
            
            <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-md border border-slate-200 dark:border-slate-700">
                <h3 className="text-lg font-semibold mb-4 text-slate-800 dark:text-white">Create New Credentials</h3>
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
                <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
                    <thead className="bg-slate-100 dark:bg-slate-900 uppercase font-semibold">
                        <tr>
                            <th className="px-6 py-3">Username</th>
                            <th className="px-6 py-3">Linked Router</th>
                            <th className="px-6 py-3">PPPoE Account</th>
                            <th className="px-6 py-3">Created At</th>
                            <th className="px-6 py-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {users.map(u => {
                            const rName = routers.find(r => r.id === u.router_id)?.name || u.router_id;
                            return (
                                <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">{u.username}</td>
                                    <td className="px-6 py-4">{rName}</td>
                                    <td className="px-6 py-4">{u.pppoe_username}</td>
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
                        {users.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-6 py-8 text-center text-slate-500">No client users created yet.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
