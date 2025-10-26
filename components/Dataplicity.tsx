import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getDataplicityStatus, streamUninstallDataplicity, streamInstallDataplicity } from '../services/dataplicityService.ts';
import type { DataplicityStatus } from '../types.ts';
import { Loader } from './Loader.tsx';
import { DataplicityIcon, CheckCircleIcon, TrashIcon } from '../constants.tsx';
import { SudoInstructionBox } from './SudoInstructionBox.tsx';

const LogViewer: React.FC<{ logs: string[] }> = ({ logs }) => {
    const logContainerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div ref={logContainerRef} className="bg-slate-100 dark:bg-slate-900 text-xs font-mono text-slate-700 dark:text-slate-300 p-4 rounded-md h-64 overflow-y-auto border border-slate-200 dark:border-slate-600">
            {logs.map((log, index) => (
                <pre key={index} className="whitespace-pre-wrap break-words">{log}</pre>
            ))}
        </div>
    );
};

export const Dataplicity: React.FC = () => {
    const [status, setStatus] = useState<'loading' | 'not_installed' | 'installed' | 'uninstalling' | 'installing' | 'error'>('loading');
    const [data, setData] = useState<DataplicityStatus | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [command, setCommand] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    const fetchData = useCallback(async () => {
        setStatus('loading');
        setLogs([]);
        setErrorMessage('');
        try {
            const result = await getDataplicityStatus();
            setData(result);
            setStatus(result.installed ? 'installed' : 'not_installed');
        } catch (err) {
            setStatus('error');
            setErrorMessage((err as Error).message);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleInstall = () => {
        if (!command.trim()) {
            setErrorMessage("Please paste the installation command from Dataplicity.");
            return;
        }
        setStatus('installing');
        setLogs([]);
        setErrorMessage('');
        
        streamInstallDataplicity(command, {
            onMessage: (data: any) => {
                if (data.log) setLogs(prev => [...prev, data.log.trim()]);
                if (data.status === 'error') {
                    setStatus('error');
                    setErrorMessage(data.message || 'An unknown error occurred.');
                }
            },
            onClose: () => {
                // Check status again after a delay to ensure it's not an error state
                if (status !== 'error') {
                    setTimeout(fetchData, 1000); 
                }
            },
            onError: (err: Error) => {
                setStatus('error');
                setErrorMessage(`Connection to server failed: ${err.message}`);
            }
        });
    };

    const handleUninstall = () => {
        if (window.confirm("Are you sure you want to uninstall Dataplicity? This will remove remote access.")) {
            setStatus('uninstalling');
            setLogs([]);
            setErrorMessage('');
            
            streamUninstallDataplicity({
                onMessage: (data: any) => {
                    if (data.log) setLogs(prev => [...prev, data.log.trim()]);
                    if (data.status === 'error') {
                        setStatus('error');
                        setErrorMessage(data.message || 'An unknown error occurred during the process.');
                    }
                },
                onClose: () => {
                     if (status !== 'error') {
                        setTimeout(fetchData, 1000); 
                    }
                },
                onError: (err: Error) => {
                    setStatus('error');
                    setErrorMessage(`Connection to server failed: ${err.message}`);
                }
            });
        }
    };

    const isWorking = ['loading', 'uninstalling', 'installing'].includes(status);

    return (
        <div className="max-w-3xl mx-auto space-y-8">
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
                <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-3">
                        <DataplicityIcon className="w-8 h-8 text-[--color-primary-500]" />
                        Dataplicity Remote Shell
                    </h2>
                </div>

                <div className="p-6 space-y-6">
                    {isWorking && (
                         <div className="flex flex-col items-center justify-center p-8">
                             <Loader />
                             <p className="mt-4 capitalize">{status}...</p>
                         </div>
                    )}
                    
                    {errorMessage && <div className="p-4 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg">{errorMessage}</div>}

                    {(status === 'uninstalling' || status === 'installing') && logs.length > 0 && <LogViewer logs={logs} />}

                    {status === 'installed' && data && (
                        <div className="space-y-4">
                            <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/50 border border-green-200 dark:border-green-700 text-center">
                                <CheckCircleIcon className="w-12 h-12 text-green-500 dark:text-green-400 mx-auto mb-2" />
                                <h3 className="text-xl font-bold text-green-800 dark:text-green-300">DATAPLICITY IS ONLINE</h3>
                            </div>
                            <div className="p-4 rounded-lg bg-sky-50 dark:bg-sky-900/50 border border-sky-200 dark:border-sky-700 text-sky-800 dark:text-sky-300">
                                <p className="font-semibold">Next Step:</p>
                                <p className="text-sm">Please enable <strong className="font-bold">Wormhole</strong> in your <a href={data.url || 'https://app.dataplicity.com/'} target="_blank" rel="noopener noreferrer" className="underline hover:text-sky-600 dark:hover:text-sky-200">Dataplicity device settings</a> to remote this panel.</p>
                            </div>
                            <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                                <button onClick={handleUninstall} disabled={isWorking} className="w-full sm:w-auto px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg flex items-center justify-center gap-2">
                                    <TrashIcon className="w-5 h-5"/>
                                    Uninstall Dataplicity
                                </button>
                            </div>
                        </div>
                    )}
                    
                    {status === 'not_installed' && !isWorking && (
                         <div className="space-y-6">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">Install Dataplicity</h3>
                                <ol className="list-decimal list-inside space-y-2 mt-2 text-sm text-slate-600 dark:text-slate-400">
                                    <li>Go to <a href="https://app.dataplicity.com/" target="_blank" rel="noopener noreferrer" className="text-[--color-primary-600] font-semibold hover:underline">Dataplicity.com</a> and sign in.</li>
                                    <li>Click 'Add New Device' and copy the full command they provide.</li>
                                    <li>Paste the entire command into the box below and click 'Install'.</li>
                                </ol>
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="install-command" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Dataplicity Install Command</label>
                                <textarea id="install-command" value={command} onChange={e => setCommand(e.target.value)} disabled={isWorking} placeholder="curl -s https://www.dataplicity.com/install.py | sudo DATAPLICITY_REG_TOKEN=... python3" className="w-full h-24 p-2 font-mono text-sm bg-slate-100 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-600 rounded-md resize-y focus:ring-2 focus:ring-[--color-primary-500] focus:outline-none" />
                            </div>
                            <div className="flex justify-end">
                                <button onClick={handleInstall} disabled={isWorking || !command.trim()} className="px-6 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-bold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
                                    Install
                                </button>
                            </div>
                             <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                                <SudoInstructionBox />
                             </div>
                             <div className="flex justify-end">
                                <button onClick={fetchData} className="text-sm text-[--color-primary-600] hover:underline">Refresh Status</button>
                             </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
