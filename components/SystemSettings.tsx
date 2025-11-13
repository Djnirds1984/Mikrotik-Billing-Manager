import React, { useState, useEffect, useCallback } from 'react';
import type { RouterConfigWithId, PanelSettings, PanelNtpStatus, LicenseStatus } from '../types.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { initializeAiClient } from '../services/geminiService.ts';
import { rebootRouter, syncTimeToRouter } from '../services/mikrotikService.ts';
import { getPanelSettings, savePanelSettings, getAuthHeader } from '../services/databaseService.ts';
import { createDatabaseBackup, listDatabaseBackups, deleteDatabaseBackup, getPanelNtpStatus, togglePanelNtp } from '../services/panelService.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { Loader } from './Loader.tsx';
// FIX: Import ClockIcon from constants
import { KeyIcon, CogIcon, PowerIcon, RouterIcon, CircleStackIcon, ArrowPathIcon, TrashIcon, UsersIcon, DataplicityIcon, ClockIcon } from '../constants.tsx';
import { SudoInstructionBox } from './SudoInstructionBox.tsx';

// --- Icon Components ---
const SunIcon: React.FC<{ className?: string }> = ({ className }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" /></svg>;
const MoonIcon: React.FC<{ className?: string }> = ({ className }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" /></svg>;
const ComputerDesktopIcon: React.FC<{ className?: string }> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z" /></svg>;
// FIX: Removed local ClockIcon definition as it will be imported from constants.tsx.


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

// --- Sub-components for System Settings ---
const ThemeSwitcher = () => {
    const { theme, setTheme } = useTheme();

    const themes = [
        { name: 'light', label: 'Light', icon: <SunIcon className="w-5 h-5" /> },
        { name: 'dark', label: 'Dark', icon: <MoonIcon className="w-5 h-5" /> },
        { name: 'system', label: 'System', icon: <ComputerDesktopIcon className="w-5 h-5" /> },
    ];

    return (
        <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Theme</label>
            <div className="flex items-center gap-2 rounded-lg bg-slate-100 dark:bg-slate-700 p-1">
                {themes.map(t => (
                    <button
                        key={t.name}
                        onClick={() => setTheme(t.name as 'light' | 'dark' | 'system')}
                        className={`w-full flex items-center justify-center gap-2 rounded-md py-2 px-3 text-sm font-medium transition-colors ${
                            theme === t.name
                                ? 'bg-white dark:bg-slate-900 text-[--color-primary-600] dark:text-[--color-primary-400] shadow-sm'
                                : 'text-slate-600 dark:text-slate-300 hover:bg-white/50 dark:hover:bg-slate-900/20'
                        }`}
                    >
                        {t.icon}
                        {t.label}
                    </button>
                ))}
            </div>
        </div>
    );
};

const TimeSyncManager: React.FC<{ selectedRouter: RouterConfigWithId | null }> = ({ selectedRouter }) => {
    // State for Panel NTP
    const [panelNtpStatus, setPanelNtpStatus] = useState<PanelNtpStatus | null>(null);
    const [isNtpLoading, setIsNtpLoading] = useState(true);
    const [isNtpSaving, setIsNtpSaving] = useState(false);
    const [ntpError, setNtpError] = useState<string | null>(null);
    
    // State for Router Sync
    const [isSyncing, setIsSyncing] = useState(false);
    
    // Fetch Panel NTP logic
    const fetchNtpData = useCallback(() => {
        setIsNtpLoading(true);
        setNtpError(null);
        getPanelNtpStatus()
            .then(setPanelNtpStatus)
            .catch(err => setNtpError(`Could not fetch panel NTP status: ${(err as Error).message}`))
            .finally(() => setIsNtpLoading(false));
    }, []);
    
    useEffect(() => { fetchNtpData() }, [fetchNtpData]);

    // handle toggle Panel NTP
    const handleTogglePanelNtp = async () => {
        if (panelNtpStatus === null) return;
        setIsNtpSaving(true);
        try {
            const result = await togglePanelNtp(!panelNtpStatus.enabled);
            alert(result.message);
            await fetchNtpData();
        } catch (err) {
            alert(`Failed to toggle panel NTP: ${(err as Error).message}`);
        } finally {
            setIsNtpSaving(false);
        }
    };

    // handle sync to router
    const handleSyncTimeToRouter = async () => {
        if (!selectedRouter) return;
        if (window.confirm(`Are you sure you want to set the time on "${selectedRouter.name}" to the panel's current time? This will set the router's system clock.`)) {
            setIsSyncing(true);
            try {
                const res = await syncTimeToRouter(selectedRouter);
                alert(res.message);
            } catch (err) {
                alert(`Failed to sync time: ${(err as Error).message}`);
            } finally {
                setIsSyncing(false);
            }
        }
    };

    return (
        <div className="space-y-6">
            {/* Panel Section */}
            <div>
                <h4 className="font-semibold text-lg text-slate-800 dark:text-slate-200 mb-2">Panel Host NTP</h4>
                {isNtpLoading ? <div className="flex justify-center"><Loader /></div> : ntpError ? <p className="text-red-500 text-sm mb-2">{ntpError}</p> :
                    <>
                        <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700">
                            <div>
                                <p className="font-medium text-slate-700 dark:text-slate-300">Automatic Time Sync (timedatectl)</p>
                                <p className="text-xs text-slate-500">Keep the panel server's time accurate.</p>
                            </div>
                            <button onClick={handleTogglePanelNtp} disabled={isNtpSaving || panelNtpStatus === null} className={`px-4 py-2 text-sm font-semibold rounded-lg w-28 text-white ${panelNtpStatus?.enabled ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'} disabled:opacity-50`}>
                                {isNtpSaving ? <Loader /> : panelNtpStatus?.enabled ? 'Disable' : 'Enable'}
                            </button>
                        </div>
                         <div className="mt-4">
                            <SudoInstructionBox />
                        </div>
                    </>
                }
            </div>
            
            {/* Router Section */}
            {selectedRouter && (
                <div className="pt-6 border-t border-slate-200 dark:border-slate-700">
                    <h4 className="font-semibold text-lg text-slate-800 dark:text-slate-200 mb-2">Router Time Sync</h4>
                    <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700">
                        <div>
                            <p className="font-medium text-slate-700 dark:text-slate-300">Sync Time to {selectedRouter.name}</p>
                            <p className="text-sm text-slate-500">Set the router's clock to match this panel's server time.</p>
                        </div>
                        <button onClick={handleSyncTimeToRouter} disabled={isSyncing} className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-lg flex items-center gap-2 disabled:opacity-50">
                            {isSyncing ? <Loader /> : <ClockIcon className="w-5 h-5" />}
                            {isSyncing ? 'Syncing...' : 'Sync Now'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};


const DatabaseManager: React.FC = () => {
    const [backups, setBackups] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isActioning, setIsActioning] = useState<string | null>(null); // 'create', 'delete-filename', 'restore-filename'
    const [restoreLogs, setRestoreLogs] = useState<string[]>([]);

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
                alert('Restore successful! The panel is restarting. The page will reload in a few seconds.');
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

    const handleDownload = async (filename: string) => {
        setIsActioning(`download-${filename}`);
        try {
            const res = await fetch(`/download-backup/${filename}`, {
                headers: getAuthHeader(),
            });

            if (!res.ok) {
                let errorMsg = `Download failed: ${res.statusText}`;
                try {
                    const data = await res.json();
                    errorMsg = data.message || errorMsg;
                } catch (e) {
                    // response is not json
                }
                throw new Error(errorMsg);
            }

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
        } catch (error) {
            alert(`Failed to download backup: ${(error as Error).message}`);
        } finally {
            setIsActioning(null);
        }
    };

    return (
        <div className="space-y-4">
            <button onClick={handleCreateBackup} disabled={!!isActioning} className="w-full px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2">
                {isActioning === 'create' ? <Loader /> : <CircleStackIcon className="w-5 h-5" />}
                {isActioning === 'create' ? 'Backing up...' : 'Backup Now'}
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
                                    <button onClick={() => handleDownload(backup)} disabled={!!isActioning} className="p-2 text-slate-500 hover:text-green-500 disabled:opacity-50" title="Download">
                                        {isActioning === `download-${backup}` ? <Loader/> : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>}
                                    </button>
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
            {isActioning?.startsWith('restore-') && (
                <div className="mt-4">
                    <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Restoring...</h4>
                    <div className="bg-slate-900 text-slate-300 font-mono text-xs p-4 rounded-md h-48 overflow-y-auto">
                        {restoreLogs.map((log, i) => <pre key={i} className="whitespace-pre-wrap">{log}</pre>)}
                    </div>
                </div>
            )}
        </div>
    );
};


interface SystemSettingsProps {
    selectedRouter: RouterConfigWithId | null;
    licenseStatus: LicenseStatus | null;
}

// --- Main Component ---
export const SystemSettings: React.FC<SystemSettingsProps> = ({ selectedRouter, licenseStatus }) => {
    const { language, currency, setLanguage, setCurrency } = useLocalization();
    const { logout } = useAuth();
    const [localSettings, setLocalSettings] = useState({ language, currency });
    const [isPanelSettingsSaving, setIsPanelSettingsSaving] = useState(false);
    
    const [apiKey, setApiKey] = useState('');
    const [isKeySaving, setIsKeySaving] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    
    useEffect(() => {
        setLocalSettings({ language, currency });
    }, [language, currency]);

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const settings = await getPanelSettings() as any;
                if (settings?.geminiApiKey) {
                    setApiKey(settings.geminiApiKey);
                }
            } catch (error) {
                console.error("Could not load API key:", error);
            }
        };
        loadSettings();
    }, []);

    const handleSavePanelSettings = async () => {
        setIsPanelSettingsSaving(true);
        try {
            // Fetch current settings to avoid overwriting other values (like API key)
            const currentSettings = await getPanelSettings();
            // FIX: Explicitly check that currentSettings is an object before spreading to prevent type errors.
            const newSettings = { ...(currentSettings && typeof currentSettings === 'object' ? currentSettings : {}), ...localSettings };

            // 1. Save the merged settings object in a single API call
            await savePanelSettings(newSettings);

            // 2. On success, update the context state
            if (localSettings.language !== language) {
                await setLanguage(localSettings.language);
            }
            if (localSettings.currency !== currency) {
                setCurrency(localSettings.currency);
            }
            
            alert('Panel settings saved!');
        } catch (err) {
            console.error("Failed to save panel settings:", err);
            alert(`Failed to save panel settings: ${(err as Error).message}`);
        } finally {
            setIsPanelSettingsSaving(false);
        }
    };

    const handleSaveApiKey = async () => {
        setIsKeySaving(true);
        try {
            const currentSettings = await getPanelSettings();
            // FIX: Explicitly check that currentSettings is an object before spreading to prevent type errors.
            const newSettings = { ...(currentSettings && typeof currentSettings === 'object' ? currentSettings : {}), geminiApiKey: apiKey };
            await savePanelSettings(newSettings);
            initializeAiClient(apiKey);
            alert('Gemini API Key saved successfully!');
        } catch (error) {
            alert(`Failed to save API Key: ${(error as Error).message}`);
        } finally {
            setIsKeySaving(false);
        }
    };

    const handleReboot = async () => {
        if (!selectedRouter) return;
        if (window.confirm(`Are you sure you want to reboot the router "${selectedRouter.name}"?`)) {
            try {
                const res = await rebootRouter(selectedRouter);
                alert(res.message);
            } catch (err) {
                alert(`Failed to send reboot command: ${(err as Error).message}`);
            }
        }
    };

    const handleResetCredentials = async () => {
        const confirmation = "Are you sure you want to reset all admin credentials? This will delete all user accounts and force a new administrator registration on the next page load. This action cannot be undone.";
        if (window.confirm(confirmation)) {
            setIsResetting(true);
            try {
                const response = await fetch('/api/auth/reset-all', {
                    method: 'POST',
                    headers: getAuthHeader(),
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.message || 'Failed to reset credentials.');
                }
                alert('All user credentials have been reset. You will now be logged out.');
                logout(); // This will clear local storage and reload the page
            } catch (err) {
                alert(`Error: ${(err as Error).message}`);
            } finally {
                setIsResetting(false);
            }
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8">
             {!licenseStatus?.licensed && (
                <div className="p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700/50 text-yellow-900 dark:text-yellow-200 flex items-center gap-3">
                    <KeyIcon className="w-6 h-6 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
                    <div>
                        <h4 className="font-bold">Panel Unlicensed</h4>
                        <p className="text-sm">Please activate your panel on the License page to ensure all features work correctly.</p>
                    </div>
                </div>
            )}
            <SettingsCard title="Panel Settings" icon={<CogIcon className="w-6 h-6" />}>
                <div className="space-y-6">
                    <ThemeSwitcher />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="language" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Language</label>
                            <select id="language" value={localSettings.language} onChange={e => setLocalSettings(s => ({...s, language: e.target.value as PanelSettings['language']}))} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white">
                                <option value="en">English</option>
                                <option value="fil">Filipino</option>
                                <option value="es">Español (Spanish)</option>
                                <option value="pt">Português (Portuguese)</option>
                            </select>
                        </div>
                        <div>
                            <label htmlFor="currency" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Currency</label>
                            <select id="currency" value={localSettings.currency} onChange={e => setLocalSettings(s => ({...s, currency: e.target.value as PanelSettings['currency']}))} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white">
                                <option value="USD">USD ($)</option>
                                <option value="PHP">PHP (₱)</option>
                                <option value="EUR">EUR (€)</option>
                                <option value="BRL">BRL (R$)</option>
                            </select>
                        </div>
                    </div>
                     <div className="flex justify-end pt-4 border-t border-slate-200 dark:border-slate-700">
                        <button onClick={handleSavePanelSettings} disabled={isPanelSettingsSaving} className="px-4 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-semibold rounded-lg disabled:opacity-50">
                            {isPanelSettingsSaving ? 'Saving...' : 'Save Panel Settings'}
                        </button>
                    </div>
                </div>
            </SettingsCard>
            
            <SettingsCard title="Database Management" icon={<CircleStackIcon className="w-6 h-6" />}>
                <DatabaseManager />
            </SettingsCard>
            
            <SettingsCard title="AI Settings" icon={<KeyIcon className="w-6 h-6" />}>
                <div className="space-y-2">
                    <label htmlFor="apiKey" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Google Gemini API Key</label>
                    <input type="password" name="apiKey" id="apiKey" value={apiKey} onChange={e => setApiKey(e.target.value)} className="block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                    <p className="text-xs text-slate-500">Your key is stored locally in the panel's database.</p>
                </div>
                <div className="flex justify-end mt-4">
                    <button onClick={handleSaveApiKey} disabled={isKeySaving} className="px-4 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-semibold rounded-lg disabled:opacity-50">
                        {isKeySaving ? 'Saving...' : 'Save API Key'}
                    </button>
                </div>
            </SettingsCard>

            <SettingsCard title="Time Synchronization" icon={<ClockIcon className="w-6 h-6" />}>
                <TimeSyncManager selectedRouter={selectedRouter} />
            </SettingsCard>

            <SettingsCard title="Account Reset" icon={<UsersIcon className="w-6 h-6" />}>
                <div className="space-y-4">
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                        This will delete all user accounts and security questions from the panel's database.
                        The panel will return to its initial setup state, prompting for a new administrator account to be created.
                        This is useful if you are selling or transferring ownership of this panel.
                    </p>
                    <div className="flex items-center justify-between p-4 bg-red-50 dark:bg-red-900/30 rounded-lg border border-red-200 dark:border-red-700">
                        <div>
                            <p className="font-semibold text-red-800 dark:text-red-300">Reset All Credentials</p>
                            <p className="text-sm text-red-600 dark:text-red-400">This action cannot be undone.</p>
                        </div>
                        <button onClick={handleResetCredentials} disabled={isResetting} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg flex items-center gap-2 disabled:opacity-50">
                            {isResetting && <Loader />}
                            {isResetting ? 'Resetting...' : 'Reset Now'}
                        </button>
                    </div>
                </div>
            </SettingsCard>

            {selectedRouter && (
                 <SettingsCard title={`Router Management (${selectedRouter.name})`} icon={<RouterIcon className="w-6 h-6" />}>
                    <div className="space-y-6">
                         <div className="pt-6 border-t border-slate-200 dark:border-slate-700">
                             <h4 className="font-semibold text-lg text-slate-800 dark:text-slate-200 mb-2">Power Actions</h4>
                            <div className="flex items-center justify-between p-4 bg-red-50 dark:bg-red-900/30 rounded-lg border border-red-200 dark:border-red-700">
                                <div>
                                    <p className="font-semibold text-red-800 dark:text-red-300">Reboot Router</p>
                                    <p className="text-sm text-red-600 dark:text-red-400">This will immediately restart the selected router.</p>
                                </div>
                                <button onClick={handleReboot} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg flex items-center gap-2">
                                    <PowerIcon className="w-5 h-5" />
                                    Reboot
                                </button>
                            </div>
                        </div>
                    </div>
                 </SettingsCard>
            )}
        </div>
    );
};
