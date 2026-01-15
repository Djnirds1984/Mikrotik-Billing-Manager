import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getNgrokStatus, saveNgrokSettings, controlNgrokService, streamInstallNgrok, streamUninstallNgrok } from '../services/ngrokService.ts';
import type { NgrokStatus } from '../types.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { Loader } from './Loader.tsx';
import { CodeBlock } from './CodeBlock.tsx';

const LogViewer: React.FC<{ logs: { text: string, isError?: boolean }[] }> = ({ logs }) => {
    const logContainerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div ref={logContainerRef} className="bg-slate-100 dark:bg-slate-900 text-xs font-mono text-slate-700 dark:text-slate-300 p-4 rounded-md h-48 overflow-y-auto border border-slate-200 dark:border-slate-600">
            {logs.map((log, index) => (
                <pre key={index} className={`whitespace-pre-wrap break-words ${log.isError ? 'text-red-500' : ''}`}>{log.text}</pre>
            ))}
        </div>
    );
};

const SudoInstructionBox: React.FC = () => {
    const visudoCommand = `sudo visudo`;
    const lineToAdd = `<your_username> ALL=(ALL) NOPASSWD: /bin/systemctl, /usr/bin/curl, /usr/bin/tar, /bin/mv, /bin/chmod, /bin/rm`;

    return (
        <div className="mt-4 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700/50 text-amber-900 dark:text-amber-200">
            <h4 className="font-bold">Sudo Permission Needed</h4>
            <div className="text-xs space-y-1 mt-2">
                <p>For this feature to work, the panel user needs passwordless sudo access. SSH into your Orange Pi and run <code className="font-bold">{visudoCommand}</code>. Add this line at the bottom, replacing <code className="font-bold">{'<your_username>'}</code>:</p>
                <CodeBlock script={lineToAdd} />
            </div>
        </div>
    );
};


export const NgrokManager: React.FC = () => {
    const { t } = useLocalization();
    const [status, setStatus] = useState<NgrokStatus | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isActioning, setIsActioning] = useState(false);
    const [error, setError] = useState('');
    const [logs, setLogs] = useState<{ text: string, isError?: boolean }[]>([]);
    
    const [authtoken, setAuthtoken] = useState('');
    const [proto, setProto] = useState('http');
    const [port, setPort] = useState(80);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const result = await getNgrokStatus();
            setStatus(result);
            if (result.config) {
                setAuthtoken(result.config.authtoken || '');
                setProto(result.config.proto || 'http');
                setPort(result.config.port || 80);
            }
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleSave = async () => {
        setIsActioning(true);
        setError('');
        try {
            await saveNgrokSettings({ authtoken, proto, port });
            alert('Settings saved successfully.');
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsActioning(false);
        }
    };

    const handleStreamAction = (action: 'install' | 'uninstall') => {
        setIsActioning(true);
        setError('');
        setLogs([]);
        const streamFn = action === 'install' ? streamInstallNgrok : streamUninstallNgrok;
        
        streamFn({
            onMessage: (data) => {
                if(data.log) setLogs(prev => [...prev, { text: data.log, isError: data.isError }]);
                if(data.status === 'error') setError(data.log);
            },
            onClose: () => {
                setIsActioning(false);
                fetchData(); // Refresh status after action
            },
            onError: (err) => {
                setError(err.message);
                setIsActioning(false);
            }
        });
    };

    const handleServiceControl = async (action: 'stop' | 'restart') => {
        setIsActioning(true);
        setError('');
        try {
            await controlNgrokService(action);
            await fetchData();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsActioning(false);
        }
    }

    if (isLoading) return <div className="flex justify-center"><Loader /></div>;
    
    return (
        <div className="space-y-6">
            {error && <div className="p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-md text-sm">{error}</div>}
            
            <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700">
                <h4 className="font-bold text-lg text-slate-800 dark:text-slate-200">{t('ngrok.step1_title')}</h4>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('ngrok.step1_desc')}</p>
                <div className="mt-4 space-y-4">
                    <div>
                        <label className="block text-sm font-medium">{t('ngrok.authtoken')}</label>
                        <input type="password" value={authtoken} onChange={e => setAuthtoken(e.target.value)} className="mt-1 w-full p-2 bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md"/>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium">{t('ngrok.protocol')}</label>
                            <select value={proto} onChange={e => setProto(e.target.value)} className="mt-1 w-full p-2 bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md">
                                <option value="http">{t('ngrok.http')}</option>
                                <option value="tcp">{t('ngrok.tcp')}</option>
                            </select>
                        </div>
                        <div>
                             <label className="block text-sm font-medium">{t('ngrok.local_port')}</label>
                             <input type="number" value={port} onChange={e => setPort(parseInt(e.target.value, 10))} className="mt-1 w-full p-2 bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md"/>
                        </div>
                    </div>
                    <div className="flex justify-end">
                        <button onClick={handleSave} disabled={isActioning} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50">{t('ngrok.save_settings')}</button>
                    </div>
                </div>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700">
                 <h4 className="font-bold text-lg text-slate-800 dark:text-slate-200">{t('ngrok.step2_title')}</h4>
                 <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('ngrok.step2_desc')}</p>
                 <div className="mt-4 space-y-3">
                    <div className="flex items-center gap-4">
                        <span className="font-semibold">{t('ngrok.current_status')}:</span>
                        {!status ? <Loader /> : status.installed ? (
                            <span className={`px-2 py-1 text-xs font-bold rounded-full ${status.active ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                {status.active ? t('ngrok.status_active') : t('ngrok.status_inactive')}
                            </span>
                        ) : (
                            <span className="px-2 py-1 text-xs font-bold rounded-full bg-slate-200 text-slate-600">{t('ngrok.status_not_installed')}</span>
                        )}
                    </div>
                    {status?.active && status.url && (
                        <div className="flex items-center gap-4">
                            <span className="font-semibold">{t('ngrok.public_url')}:</span>
                            <a href={status.url} target="_blank" rel="noopener noreferrer" className="text-cyan-500 hover:underline font-mono">{status.url}</a>
                        </div>
                    )}
                 </div>
                 <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 flex flex-wrap gap-2">
                    <button onClick={() => handleStreamAction('install')} disabled={isActioning} className="px-3 py-2 text-sm text-white bg-green-600 hover:bg-green-700 rounded-md disabled:opacity-50">{t('ngrok.reinstall')}</button>
                    <button onClick={() => handleServiceControl('stop')} disabled={isActioning || !status?.active} className="px-3 py-2 text-sm text-black bg-yellow-400 hover:bg-yellow-500 rounded-md disabled:opacity-50">{t('ngrok.stop')}</button>
                    <button onClick={() => handleServiceControl('restart')} disabled={isActioning || !status?.installed} className="px-3 py-2 text-sm text-white bg-blue-500 hover:bg-blue-600 rounded-md disabled:opacity-50">{t('ngrok.restart')}</button>
                    <button onClick={() => handleStreamAction('uninstall')} disabled={isActioning || !status?.installed} className="px-3 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50">{t('ngrok.uninstall')}</button>
                 </div>
            </div>
            
             {isActioning && <LogViewer logs={logs} />}

             <SudoInstructionBox />
        </div>
    );
};
