import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getCloudflareTunnelStatus, streamInstallCloudflareTunnel, streamUninstallCloudflareTunnel } from '../services/cloudflareTunnelService.ts';
import type { CloudflareTunnelStatus } from '../types.ts';
import { Loader } from './Loader.tsx';
import { CheckCircleIcon, TrashIcon } from '../constants.tsx';
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
    const lineToAdd = `<your_username> ALL=(ALL) NOPASSWD: /usr/local/bin/cloudflared, /bin/systemctl, /usr/bin/curl, /bin/mv, /bin/chmod, /bin/rm`;

    return (
        <div className="mt-4 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700/50 text-amber-900 dark:text-amber-200">
            <h4 className="font-bold">Sudo Permission Needed</h4>
            <div className="text-xs space-y-1 mt-2">
                <p>For this feature to work, the panel user needs passwordless sudo access for the installer script. SSH into your host machine and run <code className="font-bold">{visudoCommand}</code>. Add this line at the bottom, replacing <code className="font-bold">{'<your_username>'}</code>:</p>
                <CodeBlock script={lineToAdd} />
                 <p className="text-xs pt-2">Note: Make sure to replace {'<your_username>'} with your actual username.</p>
            </div>
        </div>
    );
};

export const CloudflareTunnel: React.FC = () => {
    const [status, setStatus] = useState<'loading' | 'not_installed' | 'installed' | 'installing' | 'uninstalling' | 'error'>('loading');
    const [data, setData] = useState<CloudflareTunnelStatus | null>(null);
    const [logs, setLogs] = useState<{text: string, isError?: boolean}[]>([]);
    const [errorMessage, setErrorMessage] = useState<string>('');
    const [token, setToken] = useState('');

    const fetchData = useCallback(async () => {
        setStatus('loading');
        setErrorMessage('');
        try {
            const tunnelData = await getCloudflareTunnelStatus();
            setData(tunnelData);
            setStatus(tunnelData.installed ? 'installed' : 'not_installed');
        } catch (err) {
            setErrorMessage((err as Error).message);
            setStatus('error');
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);
    
    const handleStreamAction = (action: 'install' | 'uninstall') => {
        if (action === 'install' && !token.trim()) {
            setErrorMessage("Please enter your Cloudflare tunnel token.");
            return;
        }
        
        setStatus(action === 'install' ? 'installing' : 'uninstalling');
        setLogs([]);
        setErrorMessage('');
        
        const streamFn = action === 'install' 
            ? (callbacks) => streamInstallCloudflareTunnel(token, callbacks) 
            : streamUninstallCloudflareTunnel;
        
        streamFn({
            onMessage: (data: any) => {
                if (data.log) setLogs(prev => [...prev, { text: data.log.trim(), isError: !!data.isError }]);
                if (data.status === 'error') {
                    setStatus('error');
                    setErrorMessage(data.message || 'An unknown error occurred.');
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
    };

    const isWorking = ['loading', 'uninstalling', 'installing'].includes(status);

    return (
        <div className="space-y-6">
            <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-200">Cloudflare Tunnel</h3>
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
                        <h3 className="text-xl font-bold text-green-800 dark:text-green-300">CLOUDFLARE TUNNEL IS INSTALLED</h3>
                         <p className="text-sm mt-2">Status: {data.active ? 'ACTIVE' : 'INACTIVE'}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-sky-50 dark:bg-sky-900/50 border border-sky-200 dark:border-sky-700 text-sky-800 dark:text-sky-300">
                        <p className="font-semibold">Next Step:</p>
                        <p className="text-sm">Manage your tunnel and get your public URL from your <a href={data.url || 'https://one.dash.cloudflare.com'} target="_blank" rel="noopener noreferrer" className="underline hover:text-sky-600 dark:hover:text-sky-200">Cloudflare dashboard</a>.</p>
                    </div>
                    <div className="pt-4 border-t border-slate-200 dark:border-slate-700 flex flex-wrap gap-4">
                        <button onClick={() => handleStreamAction('uninstall')} disabled={isWorking} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg flex items-center justify-center gap-2">
                            <TrashIcon className="w-5 h-5"/>
                            Uninstall
                        </button>
                    </div>
                </div>
            )}
            
            {status === 'not_installed' && !isWorking && (
                 <div className="space-y-6">
                    <div>
                        <h4 className="font-semibold text-lg text-slate-800 dark:text-slate-200">Step 1: Get Your Cloudflare Tunnel Token</h4>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Go to your <a href="https://one.dash.cloudflare.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-sky-600 dark:hover:text-sky-200">Cloudflare dashboard</a>, create a tunnel, and copy the token.</p>
                    </div>
                    <div className="space-y-2">
                        <label htmlFor="cloudflare-token" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Cloudflare Tunnel Token</label>
                        <input 
                            id="cloudflare-token"
                            type="text" 
                            value={token} 
                            onChange={e => setToken(e.target.value)} 
                            disabled={isWorking} 
                            placeholder="Enter your Cloudflare tunnel token" 
                            className="w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-[--color-primary-500] focus:outline-none" 
                        />
                    </div>
                    <div className="flex justify-end">
                        <button onClick={() => handleStreamAction('install')} disabled={isWorking || !token.trim()} className="px-6 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-bold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
                            Install
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