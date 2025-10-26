import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createDatabaseBackup, listDatabaseBackups, deleteDatabaseBackup } from '../services/panelService.ts';
import { getAuthHeader } from '../services/databaseService.ts';
import { Loader } from './Loader.tsx';
import { CircleStackIcon, ArrowPathIcon, TrashIcon, CloudArrowUpIcon } from '../constants.tsx';

// A generic settings card component
const SettingsCard: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode; }> = ({ title, icon, children }) => (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
            {icon}
            <h3 className="text-lg font-semibold text-[--color-primary-500] dark:text-[--color-primary-400]">{title}</h3>
        </div>
        <div className="p-6">
            {children}
        </div>
    </div>
);

// LogViewer component for streaming feedback
const LogViewer: React.FC<{ logs: string[] }> = ({ logs }) => {
    const logContainerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div ref={logContainerRef} className="bg-slate-900 text-slate-300 font-mono text-xs p-4 rounded-md h-48 overflow-y-auto">
            {logs.map((log, i) => <pre key={i} className="whitespace-pre-wrap">{log}</pre>)}
        </div>
    );
};

export const DatabaseManager: React.FC = () => {
    const [backups, setBackups] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isActioning, setIsActioning] = useState<string | null>(null); // 'create', 'delete-filename', 'restore-filename', 'upload-filename'
    const [restoreLogs, setRestoreLogs] = useState<string[]>([]);
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchBackups = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await listDatabaseBackups();
            setBackups(data.filter(f => f.endsWith('.sqlite')));
        } catch (error) {
            console.error("Failed to list backups:", error);
            alert(`Error: ${(error as Error).message}`);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchBackups();
    }, [fetchBackups]);

    const handleCreateBackup = async () => {
        setIsActioning('create');
        try {
            const result = await createDatabaseBackup();
            alert(result.message);
            await fetchBackups();
        } catch (error) {
            alert(`Failed to create backup: ${(error as Error).message}`);
        } finally {
            setIsActioning(null);
        }
    };

    const handleDeleteBackup = async (filename: string) => {
        if (!window.confirm(`Are you sure you want to permanently delete backup "${filename}"?`)) return;
        setIsActioning(`delete-${filename}`);
        try {
            await deleteDatabaseBackup(filename);
            await fetchBackups();
        } catch (error) {
            alert(`Failed to delete backup: ${(error as Error).message}`);
        } finally {
            setIsActioning(null);
        }
    };

    const handleRestore = (filename: string) => {
        if (!window.confirm(`Are you sure you want to restore from "${filename}"? This will overwrite all current panel data.`)) return;
        
        setIsActioning(`restore-${filename}`);
        setRestoreLogs([]);

        const eventSource = new EventSource(`/api/restore-backup?backupFile=${encodeURIComponent(filename)}`);

        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.log) setRestoreLogs(prev => [...prev, data.log]);
            if (data.status === 'restarting') {
                alert('Restore successful! The panel is restarting. This page will reload in a few seconds.');
                setTimeout(() => window.location.reload(), 8000);
                eventSource.close();
            }
            if (data.status === 'error') {
                alert(`Restore failed: ${data.message}`);
                setIsActioning(null);
                eventSource.close();
            }
        };

        eventSource.onerror = () => {
            alert('Connection lost during restore process.');
            setIsActioning(null);
            eventSource.close();
        };
    };

    const handleDownload = (filename: string) => {
        const a = document.createElement('a');
        a.href = `/download-backup/${filename}`;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setUploadFile(e.target.files[0]);
        } else {
            setUploadFile(null);
        }
    };

    const handleUploadRestore = () => {
        if (!uploadFile) {
            alert("Please select a database file (.sqlite) to upload.");
            return;
        }
        if (!window.confirm(`Are you sure you want to restore from "${uploadFile.name}"? THIS WILL OVERWRITE ALL CURRENT PANEL DATA and restart the panel.`)) return;

        setIsActioning(`upload-${uploadFile.name}`);
        setRestoreLogs([]);

        const reader = new FileReader();
        reader.onload = (event) => {
            const fileContent = event.target?.result;
            if (!fileContent) {
                alert('Could not read the selected file.');
                setIsActioning(null);
                return;
            }

            fetch('/api/upload-restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream', ...getAuthHeader() },
                body: fileContent
            })
            .then(response => {
                if (!response.body) throw new Error("Streaming response not supported.");
                if (!response.ok) {
                    return response.text().then(text => { throw new Error(text || `Upload failed with status ${response.status}`); });
                }
                const streamReader = response.body.pipeThrough(new TextDecoderStream()).getReader();
                
                const readStream = () => {
                    streamReader.read().then(({ done, value }) => {
                        if (done) {
                            return; // The 'restarting' message handles the final state
                        }
                        const data = JSON.parse(value.replace('data: ', ''));
                        if (data.log) setRestoreLogs(prev => [...prev, data.log]);
                        
                        if (data.status === 'restarting') {
                             alert('Restore successful! The panel is restarting. This page will reload in a few seconds.');
                             setTimeout(() => window.location.reload(), 8000);
                        } else if (data.status === 'error') {
                            alert(`Restore failed: ${data.message}`);
                            setIsActioning(null);
                        }
                        
                        readStream();
                    }).catch(err => {
                        console.error('Stream read error:', err);
                        alert(`An error occurred during restore: ${err.message}`);
                        setIsActioning(null);
                    });
                };
                readStream();
            })
            .catch(err => {
                alert(`Upload failed: ${err.message}`);
                setIsActioning(null);
            });
        };
        reader.onerror = () => {
            alert('Error reading file.');
            setIsActioning(null);
        };
        reader.readAsArrayBuffer(uploadFile);
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Database Management</h2>

            <SettingsCard title="Upload & Restore Backup" icon={<CloudArrowUpIcon className="w-6 h-6" />}>
                <div className="space-y-4">
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Upload a previously downloaded `.sqlite` backup file to restore the panel to a previous state.
                        This is a destructive action and will overwrite all current data.
                    </p>
                    <div className="flex flex-col sm:flex-row items-center gap-4">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".sqlite"
                            onChange={handleFileChange}
                            className="block w-full text-sm text-slate-500 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-[--color-primary-600] file:text-white hover:file:bg-[--color-primary-500] disabled:opacity-50"
                            disabled={!!isActioning}
                        />
                        <button
                            onClick={handleUploadRestore}
                            disabled={!uploadFile || !!isActioning}
                            className="w-full sm:w-auto px-6 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            Upload & Restore
                        </button>
                    </div>
                </div>
            </SettingsCard>

            <SettingsCard title="Local Backups" icon={<CircleStackIcon className="w-6 h-6" />}>
                <div className="space-y-4">
                    <button onClick={handleCreateBackup} disabled={!!isActioning} className="w-full px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2">
                        {isActioning === 'create' ? <Loader /> : <CircleStackIcon className="w-5 h-5" />}
                        {isActioning === 'create' ? 'Backing up...' : 'Create New Backup'}
                    </button>
                    <div className="pt-4">
                        <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Available Backups</h4>
                        {isLoading ? <div className="flex justify-center"><Loader/></div> :
                         backups.length > 0 ? (
                            <ul className="space-y-2 max-h-60 overflow-y-auto pr-2">
                                {backups.map(backup => (
                                    <li key={backup} className="bg-slate-100 dark:bg-slate-700/50 p-3 rounded-md flex justify-between items-center">
                                        <span className="font-mono text-sm text-slate-800 dark:text-slate-300 truncate mr-4">{backup}</span>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <button onClick={() => handleRestore(backup)} disabled={!!isActioning} className="p-2 text-slate-500 hover:text-sky-500 disabled:opacity-50" title="Restore"><ArrowPathIcon className="h-5 w-5"/></button>
                                            <button onClick={() => handleDownload(backup)} className="p-2 text-slate-500 hover:text-green-500" title="Download"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg></button>
                                            <button onClick={() => handleDeleteBackup(backup)} disabled={!!isActioning} className="p-2 text-slate-500 hover:text-red-500 disabled:opacity-50" title="Delete">
                                                {isActioning === `delete-${backup}` ? <Loader/> : <TrashIcon className="h-5 w-5"/>}
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                         ) : (
                            <p className="text-slate-500 dark:text-slate-400 text-center py-4">No database backups found.</p>
                         )
                        }
                    </div>
                </div>
            </SettingsCard>
            
            {isActioning && (isActioning.startsWith('restore-') || isActioning.startsWith('upload-')) && (
                <div className="mt-4">
                    <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Restoring...</h4>
                    <LogViewer logs={restoreLogs} />
                </div>
            )}
        </div>
    );
};