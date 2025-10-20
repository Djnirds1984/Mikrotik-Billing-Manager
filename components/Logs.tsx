import React, { useState, useEffect, useCallback } from 'react';
import type { RouterConfigWithId, MikroTikLogEntry } from '../types.ts';
import { getRouterLogs } from '../services/mikrotikService.ts';
import { getHostLog } from '../services/panelService.ts';
import { Loader } from './Loader.tsx';
import { RouterIcon, CodeBracketIcon } from '../constants.tsx';
import { CodeBlock } from './CodeBlock.tsx';

// SudoInstructionBox for this page's specific needs
const SudoInstructionBox: React.FC = () => {
    const visudoCommand = `sudo visudo`;
    const lineToAdd = `<your_username> ALL=(ALL) NOPASSWD: /usr/bin/pm2, /usr/bin/tail`;

    return (
        <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700/50 text-amber-900 dark:text-amber-200">
            <h4 className="font-bold text-lg mb-2">Action Required: Configure `sudo` for Logs</h4>
            <div className="text-sm space-y-2 text-amber-800 dark:text-amber-300">
                <p>To view Panel and Nginx logs, the panel needs passwordless `sudo` access for `pm2` and `tail` commands.</p>
                <ol className="list-decimal list-inside space-y-2 pl-2">
                    <li>SSH into your panel's host machine (your Orange Pi).</li>
                    <li>Run this command: <div className="my-1"><CodeBlock script={visudoCommand} /></div></li>
                    <li>Add the following line at the very bottom of the file. <strong className="block">Replace `&lt;your_username&gt;` with the user that runs this panel.</strong></li>
                    <li><div className="my-1"><CodeBlock script={lineToAdd} /></div></li>
                    <li>Save and exit: Press <kbd className="font-mono bg-slate-200 dark:bg-slate-700 px-1 py-0.5 rounded">Ctrl+X</kbd>, then <kbd className="font-mono bg-slate-200 dark:bg-slate-700 px-1 py-0.5 rounded">Y</kbd>, then <kbd className="font-mono bg-slate-200 dark:bg-slate-700 px-1 py-0.5 rounded">Enter</kbd>.</li>
                </ol>
                <p className="text-xs pt-2">Note: The path to `pm2` might differ. You can find it by running `which pm2` on your server.</p>
            </div>
        </div>
    );
};


const TabButton: React.FC<{ label: string, isActive: boolean, onClick: () => void }> = ({ label, isActive, onClick }) => (
    <button
        onClick={onClick}
        className={`px-4 py-2 text-sm font-medium transition-colors duration-200 focus:outline-none ${
            isActive
                ? 'border-b-2 border-[--color-primary-500] text-[--color-primary-500]'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
        }`}
    >
        {label}
    </button>
);

const LogViewer: React.FC<{ logs: string, title: string, onRefresh: () => void, isLoading: boolean, error: string | null }> = ({ logs, title, onRefresh, isLoading, error }) => (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">{title}</h3>
            <button onClick={onRefresh} disabled={isLoading} className="px-4 py-2 bg-slate-200 dark:bg-slate-600 rounded-lg text-sm font-semibold disabled:opacity-50">
                {isLoading ? 'Loading...' : 'Refresh'}
            </button>
        </div>
        <div className="p-4">
            {isLoading && <div className="flex justify-center p-8"><Loader /></div>}
            {error && <pre className="text-red-500 text-xs font-mono whitespace-pre-wrap p-4 bg-red-50 dark:bg-red-900/20 rounded-md">{error}</pre>}
            {!isLoading && !error && (
                <div className="h-96 overflow-y-auto bg-slate-100 dark:bg-slate-900 rounded-md p-2">
                    <pre className="text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{logs || 'No log entries found.'}</pre>
                </div>
            )}
        </div>
    </div>
);

export const Logs: React.FC<{ selectedRouter: RouterConfigWithId | null }> = ({ selectedRouter }) => {
    type MainTab = 'router' | 'panel' | 'nginx';
    type SubTab = 'panel-ui' | 'panel-api' | 'nginx-access' | 'nginx-error';

    const [activeTab, setActiveTab] = useState<MainTab>('router');
    const [activeSubTab, setActiveSubTab] = useState<SubTab>('panel-ui');

    const [routerLogs, setRouterLogs] = useState<MikroTikLogEntry[]>([]);
    const [hostLog, setHostLog] = useState('');
    
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchRouterLogs = useCallback(async () => {
        if (!selectedRouter) return;
        setIsLoading(true);
        setError(null);
        try {
            const data = await getRouterLogs(selectedRouter);
            setRouterLogs(data.reverse()); // Show newest first
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsLoading(false);
        }
    }, [selectedRouter]);

    const fetchHostLogs = useCallback(async (type: SubTab) => {
        setIsLoading(true);
        setError(null);
        setHostLog('');
        try {
            const data = await getHostLog(type);
            setHostLog(data);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        let isCancelled = false;
        const loadLogs = () => {
            if (isCancelled) return;
            if (activeTab === 'router') {
                if (selectedRouter) fetchRouterLogs();
            } else {
                const type = activeSubTab as SubTab;
                fetchHostLogs(type);
            }
        };
        loadLogs();
        return () => { isCancelled = true; };
    }, [activeTab, activeSubTab, selectedRouter, fetchRouterLogs, fetchHostLogs]);
    
    const handleTabClick = (tab: MainTab) => {
        setActiveTab(tab);
        // Set default sub-tab when switching main tabs
        if (tab === 'panel' && !['panel-ui', 'panel-api'].includes(activeSubTab)) {
            setActiveSubTab('panel-ui');
        } else if (tab === 'nginx' && !['nginx-access', 'nginx-error'].includes(activeSubTab)) {
            setActiveSubTab('nginx-access');
        }
    };

    const handleRefresh = () => {
        if (activeTab === 'router') {
            fetchRouterLogs();
        } else {
            fetchHostLogs(activeSubTab);
        }
    };

    const renderContent = () => {
        if (activeTab === 'router') {
            if (!selectedRouter) {
                return <div className="text-center p-8 bg-slate-50 dark:bg-slate-800 rounded-lg"><RouterIcon className="w-12 h-12 mx-auto text-slate-400 mb-4" />Please select a router to view its logs.</div>;
            }
            return (
                 <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
                    <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Router Logs ({selectedRouter.name})</h3>
                        <button onClick={handleRefresh} disabled={isLoading} className="px-4 py-2 bg-slate-200 dark:bg-slate-600 rounded-lg text-sm font-semibold disabled:opacity-50">
                            {isLoading ? 'Loading...' : 'Refresh'}
                        </button>
                    </div>
                     <div className="p-4">
                        {isLoading && <div className="flex justify-center p-8"><Loader /></div>}
                        {error && <div className="text-red-500 p-4">{error}</div>}
                        {!isLoading && !error && (
                             <div className="h-96 overflow-y-auto bg-slate-100 dark:bg-slate-900 rounded-md p-2 text-xs font-mono">
                                {routerLogs.map(log => (
                                    <div key={log.id} className="flex border-b border-slate-200 dark:border-slate-800 py-1">
                                        <span className="w-28 flex-shrink-0 text-slate-500">{log.time}</span>
                                        <span className="w-32 flex-shrink-0 text-cyan-500">{log.topics}</span>
                                        <span className="text-slate-700 dark:text-slate-300">{log.message}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                 </div>
            );
        }

        if (activeTab === 'panel' || activeTab === 'nginx') {
            const isPanel = activeTab === 'panel';
            const subTabs = isPanel 
                ? [{id: 'panel-ui', label: 'Panel UI (mikrotik-manager)'}, {id: 'panel-api', label: 'Panel API (mikrotik-api-backend)'}] 
                : [{id: 'nginx-access', label: 'Nginx Access'}, {id: 'nginx-error', label: 'Nginx Error'}];
            const currentSubTab = subTabs.find(st => st.id === activeSubTab);

            return (
                <div className="space-y-4">
                     <div className="flex border-b border-slate-200 dark:border-slate-700">
                        {subTabs.map(sub => <TabButton key={sub.id} label={sub.label} isActive={activeSubTab === sub.id} onClick={() => setActiveSubTab(sub.id as any)} />)}
                    </div>
                    <SudoInstructionBox />
                    <LogViewer logs={hostLog} title={currentSubTab?.label || ''} onRefresh={handleRefresh} isLoading={isLoading} error={error} />
                </div>
            );
        }
        return null;
    };
    
    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-3">
                <CodeBracketIcon className="w-8 h-8"/> Log Viewer
            </h2>
            <div className="border-b border-slate-200 dark:border-slate-700">
                <nav className="flex space-x-2">
                    <TabButton label="Router Logs" isActive={activeTab === 'router'} onClick={() => handleTabClick('router')} />
                    <TabButton label="Panel Logs" isActive={activeTab === 'panel'} onClick={() => handleTabClick('panel')} />
                    <TabButton label="Nginx Logs" isActive={activeTab === 'nginx'} onClick={() => handleTabClick('nginx')} />
                </nav>
            </div>
            {renderContent()}
        </div>
    );
};
