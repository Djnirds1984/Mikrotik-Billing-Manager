import React, { useState, useEffect, useCallback } from 'react';
import type { RouterConfigWithId } from '../types.ts';
import { Loader } from './Loader.tsx';
import { 
    createMikrotikBackup, 
    getMikrotikBackups, 
    restoreMikrotikBackup, 
    deleteMikrotikBackup,
    downloadMikrotikBackup,
    getAutoBackupSettings,
    saveAutoBackupSettings
} from '../services/mikrotikService.ts';
import { CloudArrowDownIcon, ArrowPathIcon, TrashIcon, ClockIcon, CheckCircleIcon, ExclamationTriangleIcon } from '../constants.tsx';

interface BackupFile {
    id: string;
    name: string;
    size: number;
    createdAt: string;
    source: 'mikrotik' | 'panel';
    routerId?: string;
    routerName?: string;
}

interface AutoBackupSettings {
    enabled: boolean;
    intervalHours: number;
    maxBackups: number;
    lastBackup?: string;
}

export const MikrotikBackup: React.FC<{ selectedRouter: RouterConfigWithId | null }> = ({ selectedRouter }) => {
    const [backups, setBackups] = useState<BackupFile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [isRestoring, setIsRestoring] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    
    // Auto backup settings
    const [autoSettings, setAutoSettings] = useState<AutoBackupSettings>({
        enabled: false,
        intervalHours: 24,
        maxBackups: 7
    });
    const [isSavingSettings, setIsSavingSettings] = useState(false);
    const [showSettings, setShowSettings] = useState(false);

    const fetchBackups = useCallback(async () => {
        if (!selectedRouter) return;
        setIsLoading(true);
        setError(null);
        try {
            const data = await getMikrotikBackups(selectedRouter) as any;
            // Handle both array response and {backups, warning} response
            if (Array.isArray(data)) {
                setBackups(data);
            } else if (data && data.backups) {
                setBackups(data.backups);
                if (data.warning) {
                    console.warn('Backup list warning:', data.warning);
                }
            } else {
                setBackups([]);
            }
        } catch (err) {
            setError(`Failed to fetch backups: ${(err as Error).message}`);
            setBackups([]);
        } finally {
            setIsLoading(false);
        }
    }, [selectedRouter]);

    const fetchAutoSettings = useCallback(async () => {
        if (!selectedRouter) return;
        try {
            const settings = await getAutoBackupSettings(selectedRouter);
            if (settings) {
                setAutoSettings(settings);
            }
        } catch (err) {
            console.error('Failed to fetch auto backup settings:', err);
        }
    }, [selectedRouter]);

    useEffect(() => {
        fetchBackups();
        fetchAutoSettings();
    }, [fetchBackups, fetchAutoSettings]);

    // Auto-dismiss success/error messages after 8 seconds
    useEffect(() => {
        if (success || error) {
            const timer = setTimeout(() => {
                setSuccess(null);
                setError(null);
            }, 8000);
            return () => clearTimeout(timer);
        }
    }, [success, error]);

    const handleCreateBackup = async () => {
        if (!selectedRouter) return;
        if (!window.confirm('Create a new backup of the MikroTik router? This may take a few moments.')) return;
        
        setIsCreating(true);
        setError(null);
        setSuccess(null);
        try {
            const result = await createMikrotikBackup(selectedRouter);
            setSuccess(`Backup created successfully: ${result.fileName}`);
            fetchBackups();
        } catch (err) {
            setError(`Failed to create backup: ${(err as Error).message}`);
        } finally {
            setIsCreating(false);
        }
    };

    const handleRestore = async (backup: BackupFile) => {
        if (!selectedRouter) return;
        if (!window.confirm(`Are you sure you want to restore from "${backup.name}"? This will overwrite the current configuration and the router will reboot.`)) return;
        if (!window.confirm('FINAL WARNING: This action cannot be undone. All current settings will be lost. Continue?')) return;
        
        setIsRestoring(backup.id);
        setError(null);
        setSuccess(null);
        try {
            await restoreMikrotikBackup(selectedRouter, backup.name);
            setSuccess('Restore initiated. The router will reboot shortly.');
        } catch (err) {
            setError(`Failed to restore backup: ${(err as Error).message}`);
        } finally {
            setIsRestoring(null);
        }
    };

    const handleDelete = async (backup: BackupFile) => {
        if (!selectedRouter) return;
        if (!window.confirm(`Delete backup "${backup.name}"? This cannot be undone.`)) return;
        
        setIsDeleting(backup.id);
        setError(null);
        try {
            await deleteMikrotikBackup(selectedRouter, backup.name);
            setSuccess(`Backup "${backup.name}" deleted successfully.`);
            fetchBackups();
        } catch (err) {
            setError(`Failed to delete backup: ${(err as Error).message}`);
        } finally {
            setIsDeleting(null);
        }
    };

    const handleDownload = async (backup: BackupFile) => {
        if (!selectedRouter) return;
        try {
            await downloadMikrotikBackup(selectedRouter, backup.name);
        } catch (err) {
            setError(`Failed to download backup: ${(err as Error).message}`);
        }
    };

    const handleSaveAutoSettings = async () => {
        if (!selectedRouter) return;
        setIsSavingSettings(true);
        try {
            await saveAutoBackupSettings(selectedRouter, autoSettings);
            setSuccess('Auto backup settings saved successfully.');
            setShowSettings(false);
        } catch (err) {
            setError(`Failed to save settings: ${(err as Error).message}`);
        } finally {
            setIsSavingSettings(false);
        }
    };

    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatDate = (dateString: string): string => {
        const date = new Date(dateString);
        return date.toLocaleString();
    };

    if (!selectedRouter) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                <CloudArrowDownIcon className="w-16 h-16 text-slate-400 dark:text-slate-600 mb-4" />
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">MikroTik Backup Manager</h2>
                <p className="mt-2 text-slate-500 dark:text-slate-400">Please select a router to manage backups.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">MikroTik Backup Manager</h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Create, manage, and restore .backup files for your MikroTik router
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 flex items-center gap-2"
                    >
                        <ClockIcon className="w-5 h-5" />
                        Auto Backup Settings
                    </button>
                    <button
                        onClick={handleCreateBackup}
                        disabled={isCreating}
                        className="px-4 py-2 bg-[--color-primary-600] text-white rounded-lg hover:bg-[--color-primary-700] disabled:opacity-50 flex items-center gap-2"
                    >
                        {isCreating ? (
                            <>
                                <ArrowPathIcon className="w-5 h-5 animate-spin" />
                                Creating...
                            </>
                        ) : (
                            <>
                                <CloudArrowDownIcon className="w-5 h-5" />
                                Create Backup
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Auto Backup Settings Panel */}
            {showSettings && (
                <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
                    <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-4">Scheduled Auto Backup</h3>
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <input
                                type="checkbox"
                                id="autoBackupEnabled"
                                checked={autoSettings.enabled}
                                onChange={(e) => setAutoSettings({ ...autoSettings, enabled: e.target.checked })}
                                className="w-5 h-5 rounded border-slate-300 dark:border-slate-600"
                            />
                            <label htmlFor="autoBackupEnabled" className="text-slate-700 dark:text-slate-300 font-medium">
                                Enable Automatic Backups
                            </label>
                        </div>
                        
                        {autoSettings.enabled && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-8">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                        Backup Interval (hours)
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="168"
                                        value={autoSettings.intervalHours}
                                        onChange={(e) => setAutoSettings({ ...autoSettings, intervalHours: parseInt(e.target.value) || 24 })}
                                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                                    />
                                    <p className="text-xs text-slate-500 mt-1">How often to create backups automatically</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                        Max Backups to Keep
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="100"
                                        value={autoSettings.maxBackups}
                                        onChange={(e) => setAutoSettings({ ...autoSettings, maxBackups: parseInt(e.target.value) || 7 })}
                                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                                    />
                                    <p className="text-xs text-slate-500 mt-1">Older backups will be deleted automatically</p>
                                </div>
                            </div>
                        )}
                        
                        {autoSettings.lastBackup && (
                            <div className="pl-8 text-sm text-slate-600 dark:text-slate-400">
                                Last backup: {formatDate(autoSettings.lastBackup)}
                            </div>
                        )}
                        
                        <div className="flex gap-2 pt-2">
                            <button
                                onClick={handleSaveAutoSettings}
                                disabled={isSavingSettings}
                                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                            >
                                {isSavingSettings ? 'Saving...' : 'Save Settings'}
                            </button>
                            <button
                                onClick={() => setShowSettings(false)}
                                className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Status Messages */}
            {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3">
                    <ExclamationTriangleIcon className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-red-600 dark:text-red-400">{error}</p>
                </div>
            )}
            {success && (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 flex items-start gap-3">
                    <CheckCircleIcon className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                    <p className="text-green-600 dark:text-green-400">{success}</p>
                </div>
            )}

            {/* Backups List */}
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="p-4 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                    <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                        Available Backups ({backups.length})
                    </h3>
                    <button
                        onClick={fetchBackups}
                        disabled={isLoading}
                        className="px-3 py-1.5 text-sm bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 flex items-center gap-1"
                    >
                        <ArrowPathIcon className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>
                
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center p-8 gap-3">
                        <Loader />
                        <p className="text-sm text-slate-500 dark:text-slate-400">Loading backups... This may take a moment on larger routers.</p>
                    </div>
                ) : backups.length === 0 && !error ? (
                    <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                        <CloudArrowDownIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>No backups found.</p>
                        <p className="text-sm mt-1">Click "Create Backup" to create your first backup.</p>
                    </div>
                ) : backups.length === 0 && error ? (
                    <div className="p-8 text-center">
                        <ExclamationTriangleIcon className="w-12 h-12 mx-auto mb-3 text-red-400 opacity-50" />
                        <p className="text-red-500 dark:text-red-400 mb-3">Could not load backups.</p>
                        <button
                            onClick={fetchBackups}
                            className="px-4 py-2 text-sm bg-[--color-primary-600] text-white rounded-lg hover:bg-[--color-primary-700]"
                        >
                            Retry
                        </button>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400">
                                <tr>
                                    <th className="px-6 py-3 text-left">Filename</th>
                                    <th className="px-6 py-3 text-left">Size</th>
                                    <th className="px-6 py-3 text-left">Created</th>
                                    <th className="px-6 py-3 text-left">Source</th>
                                    <th className="px-6 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                                {backups.map((backup) => (
                                    <tr key={backup.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <CloudArrowDownIcon className="w-5 h-5 text-blue-500" />
                                                <span className="font-medium text-slate-800 dark:text-slate-200">
                                                    {backup.name}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-slate-600 dark:text-slate-400">
                                            {formatFileSize(backup.size)}
                                        </td>
                                        <td className="px-6 py-4 text-slate-600 dark:text-slate-400">
                                            {formatDate(backup.createdAt)}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                                                backup.source === 'mikrotik' 
                                                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' 
                                                    : 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
                                            }`}>
                                                {backup.source === 'mikrotik' ? 'MikroTik' : 'Panel'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex justify-end gap-2">
                                                <button
                                                    onClick={() => handleDownload(backup)}
                                                    className="px-3 py-1 text-xs bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded hover:bg-slate-300 dark:hover:bg-slate-600"
                                                    title="Download to local machine"
                                                >
                                                    Download
                                                </button>
                                                <button
                                                    onClick={() => handleRestore(backup)}
                                                    disabled={isRestoring === backup.id}
                                                    className="px-3 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
                                                    title="Restore this backup to the router"
                                                >
                                                    {isRestoring === backup.id ? 'Restoring...' : 'Restore'}
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(backup)}
                                                    disabled={isDeleting === backup.id}
                                                    className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                                                    title="Delete this backup"
                                                >
                                                    {isDeleting === backup.id ? 'Deleting...' : 'Delete'}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Info Box */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <h4 className="font-semibold text-blue-800 dark:text-blue-400 mb-2">About MikroTik Backups</h4>
                <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1 list-disc list-inside">
                    <li>Backups are full system backups (.backup files) that include all configuration, certificates, and data</li>
                    <li>Restoring a backup will overwrite the current configuration and reboot the router</li>
                    <li>Backups are stored on both the MikroTik device and the panel for redundancy</li>
                    <li>Auto backups run on the schedule you configure and automatically clean up old backups</li>
                    <li>Download backups to your local machine for off-site storage</li>
                </ul>
            </div>
        </div>
    );
};
