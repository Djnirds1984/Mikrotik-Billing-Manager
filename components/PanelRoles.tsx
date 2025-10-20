import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { Loader } from './Loader.tsx';
import { TrashIcon, UsersIcon, EyeIcon, EyeSlashIcon, EditIcon } from '../constants.tsx';
import { getAuthHeader } from '../services/databaseService.ts';

interface PanelUser {
    id: string;
    username: string;
    role: { name: string; };
}

interface Role {
    id: string;
    name: string;
    description: string;
}

interface Permission {
    id: string;
    name: string;
    description: string;
}

const PermissionsModal: React.FC<{
    role: Role;
    allPermissions: Permission[];
    onClose: () => void;
    onSaveSuccess: () => void;
}> = ({ role, allPermissions, onClose, onSaveSuccess }) => {
    const [currentPermissions, setCurrentPermissions] = useState<Set<string>>(new Set());
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!role) return;
        setIsLoading(true);
        setError('');
        fetch(`/api/roles/${role.id}/permissions`, { headers: getAuthHeader() })
            .then(res => {
                if (!res.ok) throw new Error('Failed to fetch role permissions');
                return res.json();
            })
            .then(permIds => {
                setCurrentPermissions(new Set(permIds));
                setIsLoading(false);
            })
            .catch(err => {
                setError((err as Error).message);
                setIsLoading(false);
            });
    }, [role]);

    const handleTogglePermission = (permId: string) => {
        setCurrentPermissions(prev => {
            const newSet = new Set(prev);
            if (newSet.has(permId)) {
                newSet.delete(permId);
            } else {
                newSet.add(permId);
            }
            return newSet;
        });
    };

    const handleSave = async () => {
        setIsSaving(true);
        setError('');
        try {
            const response = await fetch(`/api/roles/${role.id}/permissions`, {
                method: 'PUT',
                headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ permissionIds: Array.from(currentPermissions) })
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'Failed to update permissions.');
            }
            onSaveSuccess();
            onClose();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-2xl border border-slate-200 dark:border-slate-700 flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400]">Edit Permissions for "{role.name}"</h3>
                </div>
                <div className="p-6 overflow-y-auto">
                    {isLoading ? <div className="flex justify-center"><Loader /></div> :
                     error ? <p className="text-red-500">{error}</p> :
                     <div className="space-y-4">
                        {allPermissions.map(perm => (
                            <label key={perm.id} className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-md cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700">
                                <input
                                    type="checkbox"
                                    checked={currentPermissions.has(perm.id)}
                                    onChange={() => handleTogglePermission(perm.id)}
                                    className="mt-1 h-4 w-4 rounded border-slate-300 text-[--color-primary-600] focus:ring-[--color-primary-500]"
                                />
                                <div>
                                    <span className="font-mono text-sm text-slate-800 dark:text-slate-200">{perm.name}</span>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">{perm.description}</p>
                                </div>
                            </label>
                        ))}
                     </div>
                    }
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg flex-shrink-0">
                    <button onClick={onClose} disabled={isSaving} className="px-4 py-2 text-sm font-medium rounded-md text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600">Cancel</button>
                    <button onClick={handleSave} disabled={isSaving || isLoading} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-[--color-primary-600] hover:bg-[--color-primary-500]">
                        {isSaving ? 'Saving...' : 'Save Permissions'}
                    </button>
                </div>
            </div>
        </div>
    );
};


export const PanelRoles: React.FC = () => {
    const { user: currentUser, verifyToken } = useAuth();
    const token = localStorage.getItem('authToken');

    const [users, setUsers] = useState<PanelUser[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [newUsername, setNewUsername] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [selectedRoleId, setSelectedRoleId] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const [editingRole, setEditingRole] = useState<Role | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [usersRes, rolesRes, permsRes] = await Promise.all([
                fetch('/api/panel-users', { headers: getAuthHeader() }),
                fetch('/api/roles', { headers: getAuthHeader() }),
                fetch('/api/permissions', { headers: getAuthHeader() })
            ]);
            
            if (!usersRes.ok || !rolesRes.ok || !permsRes.ok) {
                const errorData = await (usersRes.ok ? (rolesRes.ok ? permsRes : rolesRes) : usersRes).json();
                throw new Error(errorData.message || 'Failed to fetch initial role management data.');
            }
            
            const usersData = await usersRes.json();
            const rolesData = await rolesRes.json();
            const permsData = await permsRes.json();

            setUsers(usersData);
            setRoles(rolesData);
            setAllPermissions(permsData);

            if (rolesData.length > 0 && !selectedRoleId) {
                const employeeRole = rolesData.find((r: Role) => r.name.toLowerCase() === 'employee');
                setSelectedRoleId(employeeRole ? employeeRole.id : rolesData[0].id);
            }
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsLoading(false);
        }
    }, [selectedRoleId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleAddUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);
        try {
            const response = await fetch('/api/panel-users', {
                method: 'POST',
                headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: newUsername, password: newPassword, role_id: selectedRoleId })
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'Failed to add user');
            }
            setNewUsername('');
            setNewPassword('');
            fetchData();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleDeleteUser = async (userId: string) => {
        if (window.confirm("Are you sure you want to delete this user? This action cannot be undone.")) {
            setIsSubmitting(true);
            setError(null);
            try {
                const response = await fetch(`/api/panel-users/${userId}`, { method: 'DELETE', headers: getAuthHeader() });
                if (!response.ok) {
                    const data = await response.json().catch(() => ({ message: 'Failed to delete user' }));
                    throw new Error(data.message);
                }
                fetchData();
            } catch (err) {
                setError((err as Error).message);
            } finally {
                setIsSubmitting(false);
            }
        }
    };
    
    const handlePermissionsSaveSuccess = () => {
        if (token) {
            verifyToken(token);
        }
        fetchData(); // Also refetch to update any related data if necessary
    };

    if (isLoading) {
        return <div className="flex justify-center p-8"><Loader /></div>;
    }
    
    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Panel User & Role Management</h2>
            {error && <div className="p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-600 rounded-md text-red-700 dark:text-red-300 text-sm">{error}</div>}
            
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700"><h3 className="text-lg font-semibold">Panel Users</h3></div>
                <form onSubmit={handleAddUser} className="p-6 space-y-4 border-b border-slate-200 dark:border-slate-700">
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                             <label className="block text-sm font-medium">Username</label>
                             <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)} required className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" />
                        </div>
                        <div className="relative">
                            <label className="block text-sm font-medium">Password</label>
                            <input type={showPassword ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)} required className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700" />
                            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-9 text-slate-400 hover:text-slate-600">
                                {showPassword ? <EyeSlashIcon className="w-5 h-5"/> : <EyeIcon className="w-5 h-5"/>}
                            </button>
                        </div>
                        <div>
                            <label className="block text-sm font-medium">Role</label>
                            <select value={selectedRoleId} onChange={e => setSelectedRoleId(e.target.value)} className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700">
                                {roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
                            </select>
                        </div>
                     </div>
                     <div className="flex justify-end">
                         <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-[--color-primary-600] text-white font-bold rounded-lg disabled:opacity-50">
                            {isSubmitting ? 'Adding...' : 'Add User'}
                        </button>
                     </div>
                </form>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                         <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50">
                            <tr>
                                <th className="px-6 py-3">Username</th><th className="px-6 py-3">Role</th><th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(user => (
                                <tr key={user.id} className="border-b dark:border-slate-700 last:border-b-0">
                                    <td className="px-6 py-4 font-medium flex items-center gap-2"><UsersIcon className="w-5 h-5 text-slate-400"/>{user.username}</td>
                                    <td className="px-6 py-4"><span className={`px-2 py-1 text-xs font-semibold rounded-full ${user.role.name === 'Administrator' ? 'bg-sky-100 dark:bg-sky-900 text-sky-800 dark:text-sky-200' : 'bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-300'}`}>{user.role.name}</span></td>
                                    <td className="px-6 py-4 text-right">
                                        <button onClick={() => handleDeleteUser(user.id)} disabled={isSubmitting || currentUser?.id === user.id} className="p-2 text-slate-500 hover:text-red-500 disabled:opacity-50 disabled:cursor-not-allowed" title={currentUser?.id === user.id ? 'Cannot delete yourself' : 'Delete user'}><TrashIcon className="h-5 w-5" /></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
                 <div className="p-4 border-b border-slate-200 dark:border-slate-700"><h3 className="text-lg font-semibold">Role Permissions</h3></div>
                 <div className="p-6 space-y-3">
                    {roles.map(role => (
                        <div key={role.id} className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-md flex justify-between items-center">
                            <div>
                                <p className="font-bold text-slate-800 dark:text-slate-200">{role.name}</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">{role.description}</p>
                            </div>
                            {role.name.toLowerCase() !== 'administrator' && (
                                <button onClick={() => setEditingRole(role)} className="p-2 text-slate-500 hover:text-[--color-primary-500] rounded-full" title={`Edit permissions for ${role.name}`}>
                                    <EditIcon className="w-5 h-5" />
                                </button>
                            )}
                        </div>
                    ))}
                 </div>
            </div>
            
            {editingRole && <PermissionsModal role={editingRole} allPermissions={allPermissions} onClose={() => setEditingRole(null)} onSaveSuccess={handlePermissionsSaveSuccess} />}
        </div>
    );
};
