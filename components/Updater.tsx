import React, { useState, useEffect, useCallback } from 'react';
import { 
    getCurrentVersion, listBackups, deleteBackup, 
    streamUpdateStatus, streamUpdateApp, streamRollbackApp 
} from '../services/updaterService.ts';
import { UpdateIcon, CloudArrowUpIcon, CheckCircleIcon, ExclamationTriangleIcon, TrashIcon } from '../constants.tsx';
import { Loader } from './Loader.tsx';
// FIX: Import shared types from types.ts to resolve type errors.
import type { VersionInfo, NewVersionInfo } from '../types.ts';

type UpdateStatus = 'idle' | 'checking' | 'uptodate' | 'available' | 'diverged' | 'ahead' | 'error' | 'updating' | 'restarting' | 'rollingback';
type StatusInfo = {
    status: UpdateStatus;
    message: string;
};
// FIX: Removed local type definitions, now imported from types.ts.
type LogEntry = {
    text: string;
    isError?: boolean;
};

const LogViewer: React.FC<{ logs: LogEntry[] }> = ({ logs }) => {
    const logContainerRef = React.useRef<HTMLDivElement>(null);
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

const VersionInfoDisplay: React.FC<{ title: string; info: VersionInfo }> = ({ title, info }) => (
    <div>
        <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">{title}</h3>
        <div className="bg-slate-100 dark:bg-slate-900/50 p-4 rounded-lg">
            <p className="text-lg font-semibold text-[--color-primary-500] dark:text-[--color-primary-400]">{info.title} <span className="text-xs font-mono text-slate-500 ml-2">{info.hash}</span></p>
            {info.description && <p className="mt-2 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{info.description}</p>}
        </div>
    </div>
);

const ChangelogDisplay: React.FC<{ info: NewVersionInfo }> = ({ info }) => (
    <div>
        <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">New Version Available: <span className="text-cyan-500 dark:text-cyan-400">{info.title}</span></h3>
        <div className="bg-slate-100 dark:bg-slate-900/50 p-4 rounded-lg space-y-4">
            {info.description && <p className="text-sm text-slate-600 dark:text-slate-300 italic">{info.description}</p>}
            <div>
                <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Changelog:</h4>
                <pre className="text-xs font-mono bg-slate-200 dark:bg-slate-800 p-3 rounded-md text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{info.changelog}</pre>
            </div>
        </div>
    </div>
);


export const Updater: React.FC = () => {
    const [statusInfo, setStatusInfo] = useState<StatusInfo>({ status: 'idle', message: 'Check for the latest version of the panel.' });
    const [backups, setBackups] = useState<string[]>([]);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [currentVersionInfo, setCurrentVersionInfo] = useState<VersionInfo | null>(null);
    const [newVersionInfo, setNewVersionInfo] = useState<NewVersionInfo | null>(null);
    const [isLoadingCurrentVersion, setIsLoadingCurrentVersion] = useState(true);
    const [isDeleting, setIsDeleting] = useState<string | null>(null);


    const fetchBackups = useCallback(async () => {
        try {
            const data = await listBackups();
            setBackups(data.filter(file => file.endsWith('.tar.gz')));
        } catch (error) {
            console.error(error);
             setStatusInfo({ status: 'error', message: `Failed to fetch backups: ${(error as Error).message}` });
        }
    }, []);

    useEffect(() => {
        const fetchCurrentVersion = async () => {
            setIsLoadingCurrentVersion(true);
            try {
                const data = await getCurrentVersion();
                setCurrentVersionInfo(data);
            } catch (error) {
                console.error(error);
                setStatusInfo({ status: 'error', message: (error as Error).message });
            } finally {
                setIsLoadingCurrentVersion(false);
            }
        };

        fetchCurrentVersion();
        fetchBackups();
    }, [fetchBackups]);

    const handleCheckForUpdates = () => {
        setLogs([]);
        setNewVersionInfo(null);
        setStatusInfo({ status: 'checking', message: 'Connecting to repository...' });

        streamUpdateStatus({
            onMessage: (data) => {
                 if (data.log) {
                    setLogs(prev => [...prev, { text: data.log.trim(), isError: data.isError }]);
                }
                
                if (data.newVersionInfo) {
                    setNewVersionInfo(data.newVersionInfo);
                }

                if (data.status && data.status !== 'finished') {
                    setStatusInfo(prev => ({...prev, ...data}));
                }
            },
            onClose: () => {
                setStatusInfo(prev => {
                    if (prev.status === 'checking') {
                         return { status: 'error', message: 'Failed to determine update status. Check logs for details.' };
                    }
                    return prev;
                });
            },
            onError: (err) => {
                setStatusInfo({ status: 'error', message: `Connection to server failed. Could not check for updates. ${err.message}` });
            }
        });
    };
    
    const handleUpdate = () => {
        setStatusInfo(prev => ({ ...prev, status: 'updating', message: 'Starting update process...' }));
        setLogs([]);

        streamUpdateApp({
            onMessage: (data) => {
                if (data.log) {
                    setLogs(prev => [...prev, { text: data.log.trim(), isError: data.isError }]);
                }
                if (data.status === 'restarting') {
                    setStatusInfo({ status: 'restarting', message: 'Update complete! The server is restarting. This page will reload in a few seconds...' });
                    setTimeout(() => window.location.reload(), 8000);
                }
                 if (data.status === 'error') {
                    setStatusInfo({ status: 'error', message: data.message });
                }
            },
            onError: (err) => {
                 setStatusInfo({ status: 'error', message: `Lost connection to the server during the update process. ${err.message}` });
            }
        });
    };
    
    const handleRollback = (backupFile: string) => {
        if (!window.confirm(`Are you sure you want to restore the backup "${backupFile}"? This will overwrite the current application files.`)) return;

        setStatusInfo({ status: 'rollingback', message: `Restoring from ${backupFile}...` });
        setLogs([]);
        
        streamRollbackApp(backupFile, {
             onMessage: (data) => {
                if(data.log) {
                    setLogs(prev => [...prev, { text: data.log.trim(), isError: data.isError }]);
                }
                if(data.status === 'restarting') {
                    setStatusInfo({ status: 'restarting', message: 'Rollback complete! Server is restarting...' });
                    setTimeout(() => window.location.reload(), 8000);
                }
                 if(data.status === 'error') {
                     setStatusInfo({ status: 'error', message: data.message });
                 }
             },
             onError: (err) => {
                 setStatusInfo({ status: 'error', message: `Lost connection during rollback. ${err.message}` });
             }
        });
    };

    const handleDeleteBackup = async (backupFile: string) => {
        if (!window.confirm(`Are you sure you want to PERMANENTLY delete the backup "${backupFile}"? This cannot be undone.`)) return;

        setIsDeleting(backupFile);
        try {
            await deleteBackup(backupFile);
            await fetchBackups(); // Refresh the list
        } catch (error) {
            alert(`Error: ${(error as Error).message}`);
        } finally {
            setIsDeleting(null);
        }
    };


    const renderStatusInfo = () => {
        const { status, message } = statusInfo;
        switch (status) {
            case 'checking': return <div className="flex items-center gap-3"><Loader /><p>{message}</p></div>;
            case 'uptodate': return <div className="flex items-center gap-3 text-green-600 dark:text-green-400"><CheckCircleIcon className="w-8 h-8" /><p>{message}</p></div>;
            case 'available': return <div className="flex items-center gap-3 text-cyan-600 dark:text-cyan-400"><CloudArrowUpIcon className="w-8 h-8" /><p>{message}</p></div>;
            case 'error': return <div className="text-left flex items-start gap-3 text-red-600 dark:text-red-400"><ExclamationTriangleIcon className="w-8 h-8 flex-shrink-0" /><p>{message}</p></div>;
            case 'restarting': return <div className="flex items-center gap-3 text-[--color-primary-500] dark:text-[--color-primary-400]"><Loader /><p>{message}</p></div>;
            case 'ahead': return <div className="flex items-center gap-3 text-blue-600 dark:text-blue-400"><CloudArrowUpIcon className="w-8 h-8 rotate-180" /><p>{message}</p></div>;
            case 'diverged': return <div className="text-left flex items-start gap-3 text-orange-600 dark:text-orange-400"><ExclamationTriangleIcon className="w-8 h-8 flex-shrink-0" /><p>{message}</p></div>;
            default: return <div className="flex items-center gap-3 text-slate-500"><UpdateIcon className="w-8 h-8" /><p>{message}</p></div>;
        }
    };
    
    const isWorking = ['checking', 'updating', 'restarting', 'rollingback'].includes(statusInfo.status) || !!isDeleting;

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-8">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">Panel Updater</h2>
                <div className="bg-slate-100 dark:bg-slate-900/50 p-6 rounded-lg min-h-[100px] flex items-center justify-center text-slate-700 dark:text-slate-200">
                    {renderStatusInfo()}
                </div>
                 <div className="mt-6 flex justify-end space-x-4">
                    <button onClick={handleCheckForUpdates} disabled={isWorking} className="px-4 py-2 bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500 text-slate-800 dark:text-white rounded-lg font-semibold disabled:opacity-50">
                        Check for Updates
                    </button>
                    {statusInfo.status === 'available' && (
                        <button onClick={handleUpdate} disabled={isWorking} className="px-4 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white rounded-lg font-semibold disabled:opacity-50">
                            Install Update
                        </button>
                    )}
                </div>
            </div>
            
            {(isWorking || logs.length > 0) && (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-8">
                     <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-4 capitalize">{statusInfo.status} Log</h3>
                     <LogViewer logs={logs} />
                </div>
            )}

            { (isLoadingCurrentVersion && statusInfo.status === 'idle') && <div className="flex justify-center"><Loader /></div> }

            { !isWorking && newVersionInfo && (
                <ChangelogDisplay info={newVersionInfo} />
            )}

            { !isWorking && !newVersionInfo && currentVersionInfo && (
                <VersionInfoDisplay title="Current Version" info={currentVersionInfo} />
            )}
            
             <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-8">
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-4">Application Backups</h3>
                 {backups.length > 0 ? (
                    <ul className="space-y-2">
                        {backups.map(backup => (
                            <li key={backup} className="bg-slate-100 dark:bg-slate-700/50 p-3 rounded-md flex justify-between items-center">
                                <span className="font-mono text-sm text-slate-800 dark:text-slate-300">{backup}</span>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => handleRollback(backup)} disabled={isWorking} className="px-3 py-1 text-sm bg-sky-600 hover:bg-sky-500 text-white rounded-md font-semibold disabled:opacity-50">
                                        Restore
                                    </button>
                                    <button onClick={() => handleDeleteBackup(backup)} disabled={isWorking} className="p-2 text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 rounded-md disabled:opacity-50" title="Delete Backup">
                                        {isDeleting === backup ? <Loader /> : <TrashIcon className="h-4 w-4" />}
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                 ) : (
                    <p className="text-slate-500 dark:text-slate-500 text-center py-4">No application backups found. A backup is automatically created before an update.</p>
                 )}
            </div>
        </div>
    );
};