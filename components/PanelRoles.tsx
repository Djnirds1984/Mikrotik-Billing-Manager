import React, { useState, useEffect, useCallback } from 'react';
import { dbApi } from '../services/databaseService.ts';
import { Loader } from './Loader.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';
import { KeyIcon } from '../constants.tsx';

interface User {
    id: string;
    username: string;
    role: { id: string; name: string; };
}
interface Role {
    id: string;
    name: string;
    permissions: string[];
}
const ALL_PERMISSIONS = [
    'dashboard:view',
    'routers:view', 'routers:create', 'routers:edit', 'routers:delete',
    'pppoe:view', 'pppoe:create', 'pppoe:edit', 'pppoe:delete',
    'hotspot:view', 'hotspot:create', 'hotspot:edit', 'hotspot:delete',
    'billing:view', 'billing:create', 'billing:edit', 'billing:delete',
    'system:view', 'system:edit',
];

export const PanelRoles: React.FC = () => {
    const { user: currentUser } = useAuth();
    const [users, setUsers] = useState<User[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [usersData, rolesData] = await Promise.all([
                dbApi.get<User[]>('/users'),
                dbApi.get<Role[]>('/roles'),
            ]);
            setUsers(usersData);
            setRoles(rolesData);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleRoleChange = async (userId: string, roleId: string) => {
        // Prevent users from changing their own role to avoid lockout
        if (currentUser?.id === userId) {
            alert("For security, you cannot change your own role.");
            return;
        }
        try {
            await dbApi.patch(`/users/${userId}`, { roleId });
            await fetchData();
        } catch (err) {
            alert(`Failed to update role: ${(err as Error).message}`);
        }
    };

    if (isLoading) return <div className="flex justify-center p-8"><Loader /></div>;
    if (error) return <div className="p-4 bg-red-100 text-red-700 rounded-md">{error}</div>;

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-3"><KeyIcon className="w-8 h-8"/> User Roles & Permissions</h2>
            
            {/* User Management */}
            <div className="bg-white dark:bg-slate-800 border rounded-lg shadow-md">
                <h3 className="text-lg font-semibold p-4 border-b">Users</h3>
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b">
                            <th className="px-6 py-3 text-left">Username</th>
                            <th className="px-6 py-3 text-left">Role</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map(user => (
                            <tr key={user.id} className="border-b last:border-0">
                                <td className="px-6 py-4 font-semibold">{user.username}</td>
                                <td className="px-6 py-4">
                                    <select 
                                        value={user.role.id}
                                        onChange={e => handleRoleChange(user.id, e.target.value)}
                                        disabled={currentUser?.id === user.id}
                                        className="bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md p-2 disabled:opacity-70"
                                    >
                                        {roles.map(role => (
                                            <option key={role.id} value={role.id}>{role.name}</option>
                                        ))}
                                    </select>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Role Permissions */}
            <div className="bg-white dark:bg-slate-800 border rounded-lg shadow-md">
                 <h3 className="text-lg font-semibold p-4 border-b">Role Permissions (Read-only)</h3>
                 <div className="p-6 space-y-4">
                     {roles.map(role => (
                        <div key={role.id}>
                            <h4 className="font-bold text-md text-sky-600 dark:text-sky-400">{role.name}</h4>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {role.permissions.includes('*:*') ? (
                                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">All Permissions (Administrator)</span>
                                ) : (
                                    ALL_PERMISSIONS.map(permission => (
                                        <span key={permission} className={`px-2 py-1 text-xs font-semibold rounded-full ${role.permissions.includes(permission) ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-500'}`}>
                                            {permission}
                                        </span>
                                    ))
                                )}
                            </div>
                        </div>
                     ))}
                 </div>
            </div>
        </div>
    );
};
