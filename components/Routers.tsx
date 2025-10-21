

import React, { useState, useEffect } from 'react';
import type { RouterConfig, RouterConfigWithId } from '../types.ts';
import { testRouterConnection } from '../services/mikrotikService.ts';
import { EditIcon, TrashIcon, RouterIcon } from '../constants.tsx';

interface RouterFormProps {
    onSave: (routerConfig: RouterConfig | RouterConfigWithId) => void;
    onCancel: () => void;
    initialData?: RouterConfigWithId | null;
}

const RouterForm: React.FC<RouterFormProps> = ({ onSave, onCancel, initialData }) => {
    const [router, setRouter] = useState<RouterConfig>({
        name: '',
        host: '',
        user: 'admin',
        password: '',
        port: 80, // Default MikroTik REST API port
        api_type: 'rest',
    });
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    useEffect(() => {
        if (initialData) {
            // Don't pre-fill password for security, but keep the rest
            setRouter({ ...initialData, password: '' });
        } else {
            // Reset form for new entry
             setRouter({
                name: '',
                host: '',
                user: 'admin',
                password: '',
                port: 80,
                api_type: 'rest',
            });
        }
    }, [initialData]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setRouter(prev => ({ ...prev, [name]: name === 'port' ? parseInt(value, 10) || 0 : value }));
        setTestResult(null); // Clear test result on change
    };

    const handleApiTypeChange = (apiType: 'rest' | 'legacy') => {
        setRouter(prev => ({
            ...prev,
            api_type: apiType,
            port: apiType === 'legacy' ? 8728 : 80
        }));
        setTestResult(null);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (initialData) {
            const finalRouterData = { ...initialData, ...router };
            if (!router.password) {
                // @ts-ignore
                finalRouterData.password = initialData.password;
            }
            onSave(finalRouterData);
        } else {
            onSave(router);
        }
    };
    
    const handleTestConnection = async () => {
        setIsTesting(true);
        setTestResult(null);
        const testConfig: RouterConfig = {...router};
        if (initialData && !router.password) {
             // @ts-ignore
             testConfig.password = initialData.password;
        }
        const result = await testRouterConnection(testConfig);
        setTestResult(result);
        setIsTesting(false);
    };

    return (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
            <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400] mb-4">{initialData ? `Edit '${initialData.name}'` : 'Add New Router'}</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Router Name</label>
                    <input type="text" name="name" id="name" value={router.name} onChange={handleChange} required className="mt-1 block w-full bg-white dark:bg-slate-900/50 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[--color-primary-500] focus:border-[--color-primary-500] sm:text-sm" placeholder="e.g., Home Router" />
                </div>
                 <div>
                    <label htmlFor="host" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Host / IP Address</label>
                    <input type="text" name="host" id="host" value={router.host} onChange={handleChange} required className="mt-1 block w-full bg-white dark:bg-slate-900/50 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[--color-primary-500] focus:border-[--color-primary-500] sm:text-sm" placeholder="e.g., 192.168.88.1" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">API Type</label>
                    <div className="mt-1 grid grid-cols-2 gap-2 rounded-lg bg-slate-100 dark:bg-slate-700 p-1">
                        <button type="button" onClick={() => handleApiTypeChange('rest')} className={`w-full rounded-md py-2 px-3 text-sm font-medium ${router.api_type === 'rest' ? 'bg-white dark:bg-slate-900 text-[--color-primary-600]' : 'text-slate-600 dark:text-slate-300'}`}>REST API (v7+)</button>
                        <button type="button" onClick={() => handleApiTypeChange('legacy')} className={`w-full rounded-md py-2 px-3 text-sm font-medium ${router.api_type === 'legacy' ? 'bg-white dark:bg-slate-900 text-[--color-primary-600]' : 'text-slate-600 dark:text-slate-300'}`}>Legacy API (v6)</button>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="user" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Username</label>
                        <input type="text" name="user" id="user" value={router.user} onChange={handleChange} required className="mt-1 block w-full bg-white dark:bg-slate-900/50 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[--color-primary-500] focus:border-[--color-primary-500] sm:text-sm" />
                    </div>
                    <div>
                        <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Password</label>
                        <input type="password" name="password" id="password" value={router.password || ''} onChange={handleChange} className="mt-1 block w-full bg-white dark:bg-slate-900/50 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[--color-primary-500] focus:border-[--color-primary-500] sm:text-sm" placeholder={initialData ? "Leave blank to keep existing" : ""} />
                    </div>
                </div>
                 <div>
                    <label htmlFor="port" className="block text-sm font-medium text-slate-700 dark:text-slate-300">API Port</label>
                    <input type="number" name="port" id="port" value={router.port} onChange={handleChange} required className="mt-1 block w-full bg-white dark:bg-slate-900/50 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[--color-primary-500] focus:border-[--color-primary-500] sm:text-sm" />
                </div>
                
                {testResult && (
                    <div className={`p-3 rounded-md text-sm ${testResult.success ? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-700' : 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-700'}`}>
                        {testResult.message}
                    </div>
                )}

                <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:items-center gap-3 pt-4">
                     <button type="submit" className="w-full sm:w-auto px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-[--color-primary-600] hover:bg-[--color-primary-700] transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-slate-800 focus:ring-[--color-primary-500]">
                        Save Router
                    </button>
                    <button type="button" onClick={onCancel} className="w-full sm:w-auto px-4 py-2 border border-slate-300 dark:border-slate-600 text-sm font-medium rounded-lg shadow-sm text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-none">Cancel</button>
                    <button
                        type="button"
                        onClick={handleTestConnection}
                        disabled={isTesting || !router.host || !router.user}
                        className="w-full sm:w-auto px-4 py-2 border border-slate-300 dark:border-slate-600 text-sm font-medium rounded-lg shadow-sm text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-slate-800 focus:ring-slate-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isTesting ? 'Testing...' : 'Test Connection'}
                    </button>
                </div>
            </form>
        </div>
    );
};

interface RoutersProps {
    routers: RouterConfigWithId[];
    onAddRouter: (routerConfig: RouterConfig) => void;
    onUpdateRouter: (updatedRouter: RouterConfigWithId) => void;
    onDeleteRouter: (routerId: string) => void;
}

export const Routers: React.FC<RoutersProps> = ({ routers, onAddRouter, onUpdateRouter, onDeleteRouter }) => {
    const [editingRouter, setEditingRouter] = useState<RouterConfigWithId | null>(null);
    const [isAdding, setIsAdding] = useState(false);

    const handleSave = (routerData: RouterConfig | RouterConfigWithId) => {
        if ('id' in routerData && routerData.id) {
            onUpdateRouter(routerData as RouterConfigWithId);
        } else {
            onAddRouter(routerData as RouterConfig);
        }
        setEditingRouter(null);
        setIsAdding(false);
    };

    const handleCancel = () => {
        setEditingRouter(null);
        setIsAdding(false);
    };
    
    const handleAddNew = () => {
        setIsAdding(true);
        setEditingRouter(null);
    };

    const handleEdit = (router: RouterConfigWithId) => {
        setEditingRouter(router);
        setIsAdding(false);
    };

    const handleDelete = (routerId: string) => {
        if (window.confirm("Are you sure you want to delete this router?")) {
            onDeleteRouter(routerId);
        }
    };

    return (
        <div className="max-w-4xl mx-auto">
            <div className="flex flex-col gap-4 md:flex-row justify-between md:items-center mb-6">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Manage Routers</h2>
                {!isAdding && !editingRouter && (
                     <button
                        onClick={handleAddNew}
                        className="bg-[--color-primary-600] hover:bg-[--color-primary-700] text-white font-bold py-2 px-4 rounded-lg transition-colors shadow-sm hover:shadow-md self-start md:self-auto"
                    >
                        Add New Router
                    </button>
                )}
            </div>

            {(isAdding || editingRouter) && (
                <div className="mb-8">
                    <RouterForm 
                        onSave={handleSave} 
                        onCancel={handleCancel}
                        initialData={editingRouter} 
                    />
                </div>
            )}

            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
                <ul role="list" className="divide-y divide-slate-200 dark:divide-slate-700">
                    {routers.length > 0 ? (
                        routers.map((router) => (
                            <li key={router.id} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                                <div className="flex items-center gap-4">
                                    <RouterIcon className="h-8 w-8 text-[--color-primary-500] dark:text-[--color-primary-400]" />
                                    <div>
                                        <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{router.name}</p>
                                        <p className="text-sm text-slate-500 dark:text-slate-400 font-mono">{router.user}@{router.host}:{router.port}</p>
                                    </div>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <button onClick={() => handleEdit(router)} className="p-2 text-slate-500 dark:text-slate-400 hover:text-[--color-primary-500] dark:hover:text-[--color-primary-400] rounded-md transition-colors" title="Edit Router">
                                        <EditIcon className="h-5 w-5" />
                                    </button>
                                     <button onClick={() => handleDelete(router.id)} className="p-2 text-slate-500 dark:text-slate-400 hover:text-red-500 rounded-md transition-colors" title="Delete Router">
                                        <TrashIcon className="h-5 w-5" />
                                    </button>
                                </div>
                            </li>
                        ))
                    ) : (
                         <li className="p-6 text-center text-slate-500">
                            No routers configured. Click 'Add New Router' to get started.
                        </li>
                    )}
                </ul>
            </div>
        </div>
    );
};