
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader } from './Loader.tsx';
import { getAuthHeader } from '../services/databaseService.ts';
import { CodeBlock } from './CodeBlock.tsx';
import { LockClosedIcon, TrashIcon } from '../constants.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';

// --- Full Backup & Restore Component ---
const FullBackupManager: React.FC = () => {
    const [backups, setBackups] = useState<string[]>([]);
    const [status, setStatus] = useState<'idle' | 'fetching' | 'backing_up' | 'restoring' | 'uploading' | 'deleting' | 'error'>('idle');
    const [logs, setLogs] = useState<{ text: string, isError?: boolean }[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [fileToRestore, setFileToRestore] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const isWorking = status !== 'idle' && status !== 'error';

    const fetchBackups = useCallback(async () => {
        setStatus('fetching');
        setError(null);
        try {
            const res = await fetch('/api/superadmin/list-full-backups', { headers: getAuthHeader() });
            if (!res.ok) throw new Error('Failed to fetch backup list.');
            const data = await res.json();
            setBackups(data);
            setStatus('idle');
        } catch (err) {
            setError((err as Error).message);
            setStatus('error');
        }
    }, []);

    useEffect(() => {
        fetchBackups();
    }, [fetchBackups]);
    
    const handleStream = async (url: string, onMessage: (data: any) => void) => {
        try {
            const response = await fetch(url, { headers: getAuthHeader() });

            if (response.status === 401) {
                onMessage({ status: 'error', message: 'Authentication error. Please log in again.' });
                return;
            }

            if (!response.ok || !response.body) {
                throw new Error(`Failed to connect to stream: ${response.statusText}`);
            }

            const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    onMessage({ status: 'finished' });
                    break;
                }

                buffer += value;
                const parts = buffer.split('\n\n');
                buffer = parts.pop() || ''; // Keep the last, possibly incomplete, part

                for (const part of parts) {
                    if (part.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(part.substring(6));
                            onMessage(data);
                        } catch (e) {
                            console.error("Failed to parse SSE message:", e);
                        }
                    }
                }
            }
        } catch (err) {
            onMessage({ status: 'error', message: (err as Error).message });
        }
    };

    const handleCreateBackup = () => {
        setStatus('backing_up');
        setLogs([]);
        setError(null);
        handleStream('/api/superadmin/create-full-backup', (data) => {
            if (data.log) setLogs(prev => [...prev, { text: data.log, isError: data.isError }]);
            if (data.status === 'success') {
                setStatus('idle');
                fetchBackups();
                alert('Backup created successfully!');
            }
            if (data.status === 'error') {
                setError(data.message);
                setStatus('error');
            }
        });
    };

    const handleDeleteBackup = async (filename: string) => {
        if (!window.confirm(`Are you sure you want to delete backup "${filename}"?`)) return;
        setStatus('deleting');
        setError(null);
        try {
            const res = await fetch('/api/superadmin/delete-full-backup', {
                method: 'POST',
                headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ backupFile: filename })
            });
            if (!res.ok) throw new Error(await res.json().then(d => d.message));
            await fetchBackups();
        } catch (err) {
            setError((err as Error).message);
            setStatus('error');
        }
    };

    const handleRestore = async () => {
        if (!fileToRestore) return;
        if (!window.confirm("Restoring will overwrite the entire panel application, including the database. This cannot be undone. Are you sure?")) return;
        
        setStatus('uploading');
        setLogs([]);
        setError(null);
        try {
            setLogs(prev => [...prev, { text: 'Uploading backup file to server...' }]);
            const uploadRes = await fetch('/api/superadmin/upload-backup', {
                method: 'POST',
                headers: { ...getAuthHeader(), 'Content-Type': 'application/octet-stream' },
                body: fileToRestore
            });
            const uploadData = await uploadRes.json();
            if (!uploadRes.ok) throw new Error(uploadData.message);
            
            setStatus('restoring');
            const restoreFile = uploadData.filename;
            setLogs(prev => [...prev, { text: 'Upload complete. Starting restore process...' }]);

            handleStream(`/api/superadmin/restore-from-backup?file=${encodeURIComponent(restoreFile)}`, (data) => {
                if (data.log) setLogs(prev => [...prev, { text: data.log, isError: data.isError }]);
                if (data.status === 'restarting') {
                    alert('Restore complete! The panel is restarting. This page will reload in a few seconds...');
                    setTimeout(() => window.location.reload(), 8000);
                }
                if (data.status === 'error') {
                    setError(data.message);
                    setStatus('error');
                }
            });

        } catch (err) {
            setError((err as Error).message);
            setStatus('error');
        } finally {
            setFileToRestore(null);
            if(fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const LogViewer: React.FC<{ logs: { text: string, isError?: boolean }[] }> = ({ logs }) => (
        <div className="bg-slate-900 text-slate-300 font-mono text-xs p-4 rounded-md h-64 overflow-y-auto">
            {logs.map((log, index) => <pre key={index} className={`whitespace-pre-wrap break-words ${log.isError ? 'text-red-400' : ''}`}>{log.text}</pre>)}
        </div>
    );

    return (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Full Panel Backup & Restore</h2>
            <p className="text-sm text-slate-500 mt-1">Create an encrypted backup of the entire panel, or restore from a previous one.</p>
            
            {(isWorking || logs.length > 0 || error) && (
                <div className="mt-6">
                    <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-2 capitalize">{status.replace('_', ' ')}...</h3>
                    {error && <p className="text-red-500 bg-red-100 dark:bg-red-900/30 p-3 rounded-md">{error}</p>}
                    {logs.length > 0 && <LogViewer logs={logs} />}
                </div>
            )}

            {/* FIX: The conditional rendering logic was causing a TypeScript type error and hiding UI elements incorrectly.
    The `!isWorking` block is split to allow the "Available Backups" section to render its loading state
    independently, fixing the type conflict and improving user experience during data fetching. */}
            {!isWorking && (
                <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
                    <button onClick={handleCreateBackup} disabled={isWorking} className="w-full sm:w-auto px-6 py-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg disabled:opacity-50">
                        Create Full Panel Backup (.mk)
                    </button>
                </div>
            )}
                
            <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
                    <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-2">Available Backups</h3>
                    {status === 'fetching' ? <div className="flex justify-center"><Loader /></div> : backups.length > 0 ? (
                    <ul className="space-y-2 max-h-60 overflow-y-auto pr-2">
                        {backups.map(file => (
                            <li key={file} className="bg-slate-100 dark:bg-slate-700/50 p-2 rounded-md flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                                <span className="font-mono text-sm break-all">{file}</span>
                                <div className="flex gap-2 self-end sm:self-center flex-shrink-0">
                                    <a href={`/download-backup/${file}`} className="px-3 py-1 text-xs bg-green-600 text-white rounded-md">Download</a>
                                    <button onClick={() => handleDeleteBackup(file)} disabled={isWorking} className="px-3 py-1 text-xs bg-red-600 text-white rounded-md">Delete</button>
                                </div>
                            </li>
                        ))}
                    </ul>
                    ) : <p className="text-sm text-slate-500">No backups found.</p>}
            </div>
            
            {!isWorking && (
                 <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
                     <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Restore from Backup</h3>
                     <p className="text-sm text-yellow-600 dark:text-yellow-400 my-2">Warning: Restoring will overwrite all current panel files and data.</p>
                     <div className="flex items-center gap-4">
                        <input ref={fileInputRef} type="file" accept=".mk" onChange={e => setFileToRestore(e.target.files?.[0] || null)} className="flex-grow text-sm text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-slate-200 dark:file:bg-slate-600" />
                        <button onClick={handleRestore} disabled={!fileToRestore || isWorking} className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg font-semibold disabled:opacity-50">
                            Upload & Restore
                        </button>
                     </div>
                 </div>
            )}
        </div>
    );
};

export const SuperAdmin: React.FC = () => {
    const [deviceId, setDeviceId] = useState('');
    const [days, setDays] = useState(365);
    const [generatedKey, setGeneratedKey] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const { logout } = useAuth();
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isPasswordSaving, setIsPasswordSaving] = useState(false);
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

    const handleGenerate = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        setGeneratedKey('');
        try {
            const res = await fetch('/api/license/generate', {
                method: 'POST',
                headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceId, days }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || 'Failed to generate key');
            }
            setGeneratedKey(data.licenseKey);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordError(null);
        setPasswordSuccess(null);

        if (newPassword !== confirmPassword) {
            setPasswordError('Passwords do not match.');
            return;
        }
        if (newPassword.length < 6) {
            setPasswordError('Password must be at least 6 characters long.');
            return;
        }

        setIsPasswordSaving(true);
        try {
            const res = await fetch('/api/auth/change-superadmin-password', {
                method: 'POST',
                headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ newPassword }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || 'Failed to update password.');
            }
            setPasswordSuccess('Password updated! You will be logged out shortly.');
            setTimeout(() => {
                logout();
            }, 2000);
        } catch (err) {
            setPasswordError((err as Error).message);
        } finally {
            setIsPasswordSaving(false);
        }
    };


    return (
        <div className="max-w-2xl mx-auto space-y-8">
            <FullBackupManager />

            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">License Key Generator</h2>
                <p className="text-sm text-slate-500 mt-1">This tool is for developers to generate license keys for users.</p>

                {error && <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-md">{error}</div>}

                <form onSubmit={handleGenerate} className="mt-6 space-y-4">
                    <div>
                        <label htmlFor="deviceId" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Device ID</label>
                        <input
                            id="deviceId"
                            type="text"
                            value={deviceId}
                            onChange={e => setDeviceId(e.target.value)}
                            required
                            className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white font-mono"
                            placeholder="Paste the user's Device ID here"
                        />
                    </div>
                     <div>
                        <label htmlFor="days" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Validity (Days)</label>
                        <input
                            id="days"
                            type="number"
                            value={days}
                            onChange={e => setDays(parseInt(e.target.value, 10))}
                            required
                            min="1"
                            className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                        />
                    </div>
                     <div className="flex justify-end">
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="px-6 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-semibold rounded-lg disabled:opacity-50 flex items-center gap-2"
                        >
                            {isLoading && <Loader />}
                            {isLoading ? 'Generating...' : 'Generate License Key'}
                        </button>
                    </div>
                </form>

                {generatedKey && (
                    <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
                         <h3 className="text-lg font-semibold">Generated License Key</h3>
                         <div className="mt-2 h-48 bg-slate-50 dark:bg-slate-900 rounded-lg p-2 border border-slate-200 dark:border-slate-600">
                            <CodeBlock script={generatedKey} />
                         </div>
                    </div>
                )}
            </div>
            
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-3">
                    <LockClosedIcon className="w-6 h-6" />
                    Change Superadmin Password
                </h2>

                {passwordError && <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-md">{passwordError}</div>}
                {passwordSuccess && <div className="mt-4 p-3 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-md">{passwordSuccess}</div>}

                <form onSubmit={handlePasswordChange} className="mt-6 space-y-4">
                    <div>
                        <label htmlFor="newPassword" className="block text-sm font-medium text-slate-700 dark:text-slate-300">New Password</label>
                        <input
                            id="newPassword"
                            type="password"
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                            required
                            className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                        />
                    </div>
                     <div>
                        <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Confirm New Password</label>
                        <input
                            id="confirmPassword"
                            type="password"
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            required
                            className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                        />
                    </div>
                     <div className="flex justify-end">
                        <button
                            type="submit"
                            disabled={isPasswordSaving}
                            className="px-6 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-semibold rounded-lg disabled:opacity-50 flex items-center gap-2"
                        >
                            {isPasswordSaving && <Loader />}
                            {isPasswordSaving ? 'Saving...' : 'Save Password'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
