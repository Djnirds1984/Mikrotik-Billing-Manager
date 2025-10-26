import React, { useState, useEffect } from 'react';
import type { RouterConfig, RouterConfigWithId } from '../types.ts';
import { testRouterConnection } from '../services/mikrotikService.ts';
import { RouterIcon, EditIcon, TrashIcon, CheckCircleIcon, ExclamationTriangleIcon } from '../constants.tsx';
import { Loader } from './Loader.tsx';

const RouterFormModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (router: RouterConfig | RouterConfigWithId) => void;
    router: RouterConfigWithId | null;
}> = ({ isOpen, onClose, onSave, router }) => {
    const [formState, setFormState] = useState<RouterConfig>({
        name: '', host: '', user: 'admin', password: '', port: 8728, api_type: 'rest'
    });
    const [testStatus, setTestStatus] = useState<{ type: 'idle' | 'testing' | 'success' | 'error', message: string }>({ type: 'idle', message: '' });

    useEffect(() => {
        if (isOpen) {
            setFormState(router ? { ...router } : { name: '', host: '', user: 'admin', password: '', port: 8728, api_type: 'rest' });
            setTestStatus({ type: 'idle', message: '' });
        }
    }, [isOpen, router]);

    if (!isOpen) return null;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: name === 'port' ? parseInt(value, 10) : value }));
    };

    const handleTest = async () => {
        setTestStatus({ type: 'testing', message: 'Connecting...' });
        try {
            const result = await testRouterConnection(formState);
            setTestStatus({ type: 'success', message: result.message });
        } catch (err) {
            setTestStatus({ type: 'error', message: (err as Error).message });
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(router ? { ...formState, id: router.id } : formState);
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold mb-4">{router ? 'Edit' : 'Add'} Router</h3>
                        <div className="space-y-4">
                            <div><label>Name</label><input name="name" value={formState.name} onChange={handleChange} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md"/></div>
                            <div><label>Host/IP</label><input name="host" value={formState.host} onChange={handleChange} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md"/></div>
                             <div className="grid grid-cols-2 gap-4">
                                <div><label>Username</label><input name="user" value={formState.user} onChange={handleChange} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md"/></div>
                                <div><label>Password</label><input type="password" name="password" value={formState.password} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md"/></div>
                            </div>
                             <div className="grid grid-cols-2 gap-4">
                                <div><label>Port</label><input type="number" name="port" value={formState.port} onChange={handleChange} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md"/></div>
                                <div><label>API Type</label><select name="api_type" value={formState.api_type} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md"><option value="rest">REST (v7+)</option><option value="legacy">Legacy (v6)</option></select></div>
                            </div>
                            {testStatus.type !== 'idle' && (
                                <div className={`flex items-center gap-2 p-2 rounded-md text-sm ${testStatus.type === 'success' ? 'bg-green-100 text-green-800' : testStatus.type === 'error' ? 'bg-red-100 text-red-800' : 'bg-sky-100 text-sky-800'}`}>
                                    {testStatus.type === 'success' && <CheckCircleIcon className="w-5 h-5"/>}
                                    {testStatus.type === 'error' && <ExclamationTriangleIcon className="w-5 h-5"/>}
                                    {testStatus.type === 'testing' && <Loader />}
                                    <span>{testStatus.message}</span>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-between items-center">
                        <button type="button" onClick={handleTest} disabled={testStatus.type === 'testing'} className="px-4 py-2 text-sm bg-slate-200 dark:bg-slate-600 rounded-md disabled:opacity-50">Test Connection</button>
                        <div className="flex gap-4">
                            <button type="button" onClick={onClose}>Cancel</button>
                            <button type="submit" className="px-4 py-2 bg-[--color-primary-600] text-white rounded-md">Save</button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};

export const Routers: React.FC<{
    routers: RouterConfigWithId[];
    onAddRouter: (router: RouterConfig) => void;
    onUpdateRouter: (router: RouterConfigWithId) => void;
    onDeleteRouter: (id: string) => void;
}> = ({ routers, onAddRouter, onUpdateRouter, onDeleteRouter }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingRouter, setEditingRouter] = useState<RouterConfigWithId | null>(null);

    const handleSave = (router: RouterConfig | RouterConfigWithId) => {
        if ('id' in router) {
            onUpdateRouter(router as RouterConfigWithId);
        } else {
            onAddRouter(router);
        }
        setIsModalOpen(false);
    };

    return (
        <div className="space-y-6">
            <RouterFormModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSave} router={editingRouter} />

            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2"><RouterIcon className="w-6 h-6" /> Router Management</h2>
                <button onClick={() => { setEditingRouter(null); setIsModalOpen(true); }} className="bg-[--color-primary-600] hover:bg-[--color-primary-700] text-white font-bold py-2 px-4 rounded-lg">
                    Add Router
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {routers.map(router => (
                    <div key={router.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md p-6 flex flex-col justify-between">
                        <div>
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{router.name}</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 font-mono">{router.user}@{router.host}:{router.port}</p>
                            <span className="text-xs font-semibold uppercase px-2 py-1 bg-slate-200 dark:bg-slate-700 rounded-full mt-2 inline-block">{router.api_type || 'rest'}</span>
                        </div>
                        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                            <button onClick={() => { setEditingRouter(router); setIsModalOpen(true); }} className="p-2 text-slate-500 hover:text-sky-500"><EditIcon className="w-5 h-5"/></button>
                            <button onClick={() => onDeleteRouter(router.id)} className="p-2 text-slate-500 hover:text-red-500"><TrashIcon className="w-5 h-5"/></button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
