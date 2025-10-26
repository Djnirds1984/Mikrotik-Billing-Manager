import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getPiTunnelStatus, streamUninstallPiTunnel, streamInstallPiTunnel, streamCreatePiTunnel } from '../services/piTunnelService.ts';
import type { PiTunnelStatus } from '../types.ts';
import { Loader } from './Loader.tsx';
import { CheckCircleIcon, TrashIcon } from '../constants.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { CodeBlock } from './CodeBlock.tsx';

const LogViewer: React.FC<{ logs: {text: string, isError?: boolean}[] }> = ({ logs }) => {
    const logContainerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div ref={logContainerRef} className="bg-slate-100 dark:bg-slate-900 text-xs font-mono text-slate-700 dark:text-slate-300 p-4 rounded-md h-64 overflow-y-auto border border-slate-200 dark:border-slate-600">
            {logs.map((log, index) => (
                <pre key={index} className={`whitespace-pre-wrap break-words ${log.isError ? 'text-red-500' : ''}`}>{log.text}</pre>
            ))}
        </div>
    );
};

const SudoInstructionBox: React.FC = () => {
    const visudoCommand = `sudo visudo`;
    const lineToAdd = `<your_username> ALL=(ALL) NOPASSWD: /usr/bin/python3, /usr/local/bin/pitunnel, /bin/systemctl`;

    return (
        <div className="mt-4 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700/50 text-amber-900 dark:text-amber-200">
            <h4 className="font-bold">Sudo Permission Needed</h4>
            <div className="text-xs space-y-1 mt-2">
                <p>For this feature to work, the panel user needs passwordless sudo access for the installer script. SSH into your host machine and run <code className="font-bold">{visudoCommand}</code>. Add this line at the bottom, replacing <code className="font-bold">{'<your_username>'}</code>:</p>
                <CodeBlock script={lineToAdd} />
                 <p className="text-xs pt-2">Note: The path to `python3` might differ. You can find it by running `which python3` on your server.</p>
            </div>
        </div>
    );
};

const CreateTunnelModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (params: { port: string; name: string; protocol: string }) => void;
    isLoading: boolean;
}> = ({ isOpen, onClose, onSave, isLoading }) => {
    const [port, setPort] = useState('80');
    const [name, setName] = useState('');
    const [protocol, setProtocol] = useState('http');

    useEffect(() => {
        if (isOpen) {
            setPort('80');
            setName('');
            setProtocol('http');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({ port, name, protocol });
    };
    
    const generatedCommand = `pitunnel --port=${port} ${name ? `--name=${name.replace(/[^a-zA-Z0-9-]/g, '')}` : ''} ${protocol !== 'tcp' ? `--${protocol}` : ''}`.trim();

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg border border-slate-200 dark:border-slate-700">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400] mb-4">Create Custom Tunnel</h3>
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Local Port Number</label>
                                    <input type="number" value={port} onChange={e => setPort(e.target.value)} required min="1" className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Tunnel Name <span className="text-xs">(Optional)</span></label>
                                    <input type="text" value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Protocol of your Server</label>
                                <select value={protocol} onChange={e => setProtocol(e.target.value)} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">
                                    <option value="http">HTTP</option>
                                    <option value="https">HTTPS</option>
                                    <option value="ssh">SSH</option>
                                    <option value="vnc">VNC</option>
                                    <option value="tcp">Other (TCP)</option>
                                </select>
                            </div>
                            <div className="pt-2">
                                <p className="text-xs text-slate-500">This will run the following command:</p>
                                <div className="mt-1 p-2 bg-slate-100 dark:bg-slate-900 rounded-md text-sm font-mono text-slate-800 dark:text-slate-200">
                                    {generatedCommand}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-4">
                        <button type="button" onClick={onClose} disabled={isLoading}>Cancel</button>
                        <button type="submit" disabled={isLoading || !port} className="px-4 py-2 bg-green-600 text-white rounded-md disabled:opacity-50">
                            {isLoading ? 'Creating...' : 'Create Tunnel'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export const PiTunnel: React.FC = () => {
    const { t } = useLocalization();
    const [status, setStatus] = useState<'loading' | 'not_installed' | 'installed' | 'uninstalling' | 'installing' | 'error'>('loading');
    const [data, setData] = useState<PiTunnelStatus | null>(null);
    const [logs, setLogs] = useState<{text: string, isError?: boolean}[]>([]);
    const [command, setCommand] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    const fetchData = useCallback(async () => {
        setStatus('loading');
        setLogs([]);
        setErrorMessage('');
        try {
            const result = await getPiTunnelStatus();
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

    const handleStreamAction = (action: 'install' | 'uninstall') => {
        if (action === 'install' && !command.trim()) {
            setErrorMessage("Please paste the installation command from PiTunnel.com.");
            return;
        }
        
        setStatus(action === 'install' ? 'installing' : 'uninstalling');
        setLogs([]);
        setErrorMessage('');
        
        const streamFn = action === 'install' 
            ? (callbacks) => streamInstallPiTunnel(command, callbacks) 
            : streamUninstallPiTunnel;
        
        streamFn({
            onMessage: (data: any) => {
                if (data.log) setLogs(prev => [...prev, { text: data.log.trim(), isError: !!data.isError }]);
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

     const handleCreateTunnel = (params: { port: string; name: string; protocol: string }) => {
        setStatus('installing'); // Reuse 'installing' state for a generic "working with logs" view
        setLogs([]);
        setErrorMessage('');
        
        streamCreatePiTunnel(params, {
            onMessage: (data: any) => {
                if (data.log) setLogs(prev => [...prev, { text: data.log.trim(), isError: !!data.isError }]);
                if (data.status === 'error') {
                    setStatus('error');
                    setErrorMessage(data.message || 'An unknown error occurred.');
                }
            },
            onClose: () => {
                if (status !== 'error') {
                    alert('Tunnel creation process finished. Check logs for details.');
                    setTimeout(fetchData, 1000); // Refresh status
                }
                setIsCreateModalOpen(false);
            },
            onError: (err: Error) => {
                setStatus('error');
                setErrorMessage(`Connection to server failed: ${err.message}`);
                setIsCreateModalOpen(false);
            }
        });
    };

    const isWorking = ['loading', 'uninstalling', 'installing'].includes(status);

    return (
        <div className="space-y-6">
            <CreateTunnelModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                onSave={handleCreateTunnel}
                isLoading={isWorking && status === 'installing'}
            />
            <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-200">{t('pitunnel.title')}</h3>
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
                        <h3 className="text-xl font-bold text-green-800 dark:text-green-300">PI TUNNEL IS INSTALLED</h3>
                         <p className="text-sm mt-2">Status: {data.active ? t('pitunnel.status_active') : t('pitunnel.status_inactive')}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-sky-50 dark:bg-sky-900/50 border border-sky-200 dark:border-sky-700 text-sky-800 dark:text-sky-300">
                        <p className="font-semibold">Next Step:</p>
                        <p className="text-sm">Manage your tunnel and get your public URL from your <a href={data.url || 'https://pitunnel.com/dashboard'} target="_blank" rel="noopener noreferrer" className="underline hover:text-sky-600 dark:hover:text-sky-200">Pi Tunnel dashboard</a>.</p>
                    </div>
                    <div className="pt-4 border-t border-slate-200 dark:border-slate-700 flex flex-wrap gap-4">
                        <button onClick={() => setIsCreateModalOpen(true)} disabled={isWorking} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg flex items-center justify-center gap-2">
                            Create Custom Tunnel
                        </button>
                        <button onClick={() => handleStreamAction('uninstall')} disabled={isWorking} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg flex items-center justify-center gap-2">
                            <TrashIcon className="w-5 h-5"/>
                            {t('pitunnel.uninstall')}
                        </button>
                    </div>
                </div>
            )}
            
            {status === 'not_installed' && !isWorking && (
                 <div className="space-y-6">
                    <div>
                        <h4 className="font-semibold text-lg text-slate-800 dark:text-slate-200">{t('pitunnel.step1_title')}</h4>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('pitunnel.step1_desc')}</p>
                    </div>
                    <div className="space-y-2">
                        <label htmlFor="install-command" className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t('pitunnel.install_command')}</label>
                        <textarea id="install-command" value={command} onChange={e => setCommand(e.target.value)} disabled={isWorking} placeholder={t('pitunnel.install_placeholder')} className="w-full h-24 p-2 font-mono text-sm bg-slate-100 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-600 rounded-md resize-y focus:ring-2 focus:ring-[--color-primary-500] focus:outline-none" />
                    </div>
                    <div className="flex justify-end">
                        <button onClick={() => handleStreamAction('install')} disabled={isWorking || !command.trim()} className="px-6 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-bold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
                            {t('pitunnel.install')}
                        </button>
                    </div>
                    <SudoInstructionBox />
                     <div className="flex justify-end">
                        <button onClick={fetchData} className="text-sm text-[--color-primary-600] hover:underline">Refresh Status</button>
                     </div>
                </div>
            )}
        </div>
    );
};
