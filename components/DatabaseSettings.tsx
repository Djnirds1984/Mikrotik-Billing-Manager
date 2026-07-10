


import React, { useEffect, useState } from 'react';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { CircleStackIcon } from '../constants.tsx';
// FIX: Import missing functions for MariaDB operations.
import { getPanelSettings, savePanelSettings, initMariaDb, migrateSqliteToMariaDb, getAutoBackupSettings, saveAutoBackupSettings, runAutoBackup } from '../services/databaseService.ts';
import type { PanelSettings } from '../types.ts';
import type { AutoBackupSettings } from '../services/databaseService.ts';

export const DatabaseSettings: React.FC = () => {
  const { t } = useLocalization();
  const [settings, setSettings] = useState<PanelSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationMsg, setMigrationMsg] = useState<string | null>(null);
  const [autoBackup, setAutoBackup] = useState<AutoBackupSettings>({ enabled: false, intervalHours: 24, maxBackups: 10, lastBackup: null });
  const [isSavingBackup, setIsSavingBackup] = useState(false);
  const [isRunningBackup, setIsRunningBackup] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [backupList, setBackupList] = useState<string[]>([]);
  const [isRestoring, setIsRestoring] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await getPanelSettings();
        setSettings({
          ...s,
          databaseEngine: s.databaseEngine || 'sqlite',
        });
        const abs = await getAutoBackupSettings();
        setAutoBackup(abs);
        // Load backup list
        const listRes = await fetch('/api/list-backups', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        if (listRes.ok) {
          const list = await listRes.json();
          setBackupList(list);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const updateField = (key: keyof PanelSettings, value: any) => {
    setSettings(prev => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSave = async () => {
    if (!settings) return;
    setIsSaving(true);
    setError(null);
    try {
      const payload: Partial<PanelSettings> = {
        databaseEngine: settings.databaseEngine,
        dbHost: settings.dbHost,
        dbPort: settings.dbPort,
        dbUser: settings.dbUser,
        dbPassword: settings.dbPassword,
        dbName: settings.dbName,
      };
      const res = await savePanelSettings(payload);
      alert(res.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleMigrate = async () => {
    if (!settings) return;
    setIsMigrating(true);
    setError(null);
    setMigrationMsg(null);
    try {
      if (settings.databaseEngine !== 'mariadb') {
        setMigrationMsg('Migration is available when MariaDB is selected.');
        return;
      }
      const initRes = await initMariaDb();
      const migRes = await migrateSqliteToMariaDb();
      setMigrationMsg(`${initRes.message} \n${migRes.message}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsMigrating(false);
    }
  };

  const handleSaveAutoBackup = async () => {
    setIsSavingBackup(true);
    setBackupMsg(null);
    try {
      const res = await saveAutoBackupSettings({
        enabled: autoBackup.enabled,
        intervalHours: autoBackup.intervalHours,
        maxBackups: autoBackup.maxBackups
      });
      setAutoBackup(res.settings);
      setBackupMsg(res.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsSavingBackup(false);
    }
  };

  const handleRunBackupNow = async () => {
    setIsRunningBackup(true);
    setBackupMsg(null);
    try {
      const res = await runAutoBackup();
      setBackupMsg(res.message);
      // Refresh to get updated lastBackup
      const abs = await getAutoBackupSettings();
      setAutoBackup(abs);
      // Refresh backup list
      const listRes = await fetch('/api/list-backups', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
      });
      if (listRes.ok) {
        const list = await listRes.json();
        setBackupList(list);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsRunningBackup(false);
    }
  };

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.db')) {
      setError('Only .db backup files are allowed.');
      return;
    }

    const confirmed = confirm(
      `WARNING: This will replace your current database with "${file.name}".\n\nA safety backup of your current database will be created before restoring.\n\nAre you sure you want to continue?`
    );
    if (!confirmed) {
      e.target.value = '';
      return;
    }

    setIsRestoring(true);
    setBackupMsg(null);
    setError(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Strip the data:application/octet-stream;base64, prefix
          const base64Only = result.split(',')[1];
          resolve(base64Only);
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/restore-backup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        },
        body: JSON.stringify({ base64Data: base64, filename: file.name })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setBackupMsg(data.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsRestoring(false);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRestoreExisting = async (filename: string) => {
    const confirmed = confirm(
      `WARNING: This will replace your current database with "${filename}".\n\nA safety backup of your current database will be created before restoring.\n\nAre you sure you want to continue?`
    );
    if (!confirmed) return;

    setIsRestoring(true);
    setBackupMsg(null);
    setError(null);
    try {
      const res = await fetch('/api/restore-backup-from-file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        },
        body: JSON.stringify({ backupFile: filename })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setBackupMsg(data.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsRestoring(false);
    }
  };

  if (isLoading) {
    return <div className="text-slate-600 dark:text-slate-300">{t('app.loading_data')}</div>;
  }

  if (error) {
    return <div className="text-red-600">{error}</div>;
  }

  return (
    <div className="max-w-3xl w-full mx-auto">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
          <CircleStackIcon className="w-6 h-6 text-[--color-primary-500] dark:text-[--color-primary-400]" />
          <h3 className="text-lg font-semibold text-[--color-primary-500] dark:text-[--color-primary-400]">{t('titles.database')}</h3>
        </div>
        <div className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Database Engine</label>
            <div className="flex items-center gap-4">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="dbEngine"
                  checked={settings?.databaseEngine === 'sqlite'}
                  onChange={() => updateField('databaseEngine', 'sqlite')}
                />
                <span>SQLite (default)</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="dbEngine"
                  checked={settings?.databaseEngine === 'mariadb'}
                  onChange={() => updateField('databaseEngine', 'mariadb')}
                />
                <span>MariaDB</span>
              </label>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              MariaDB requires server support and credentials. If switching engines, ensure the backend is configured accordingly.
            </p>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Host</label>
                <input
                  type="text"
                  className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-2"
                  value={settings?.dbHost || ''}
                  onChange={(e) => updateField('dbHost', e.target.value)}
                  disabled={settings?.databaseEngine !== 'mariadb'}
                  placeholder="localhost"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Port</label>
                <input
                  type="number"
                  className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-2"
                  value={settings?.dbPort ?? 3306}
                  onChange={(e) => updateField('dbPort', Number(e.target.value))}
                  disabled={settings?.databaseEngine !== 'mariadb'}
                  placeholder="3306"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">User</label>
                <input
                  type="text"
                  className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-2"
                  value={settings?.dbUser || ''}
                  onChange={(e) => updateField('dbUser', e.target.value)}
                  disabled={settings?.databaseEngine !== 'mariadb'}
                  placeholder="db_user"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Password</label>
                <input
                  type="password"
                  className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-2"
                  value={settings?.dbPassword || ''}
                  onChange={(e) => updateField('dbPassword', e.target.value)}
                  disabled={settings?.databaseEngine !== 'mariadb'}
                  placeholder="••••••••"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Database Name</label>
                <input
                  type="text"
                  className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-2"
                  value={settings?.dbName || ''}
                  onChange={(e) => updateField('dbName', e.target.value)}
                  disabled={settings?.databaseEngine !== 'mariadb'}
                  placeholder="panel_db"
                />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              These settings are stored securely in the panel's configuration database.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 rounded-md bg-[--color-primary-600] hover:bg-[--color-primary-700] text-white font-semibold disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : t('common.save')}
            </button>
            <button
              onClick={handleMigrate}
              disabled={isMigrating || settings?.databaseEngine !== 'mariadb'}
              className="px-4 py-2 rounded-md bg-slate-600 hover:bg-slate-700 text-white font-semibold disabled:opacity-50"
            >
              {isMigrating ? 'Migrating…' : 'Run Migration'}
            </button>
          </div>
          {migrationMsg && (
            <p className="text-xs text-slate-500 mt-2 whitespace-pre-wrap">{migrationMsg}</p>
          )}

          {/* Auto Backup Section */}
          <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
            <h4 className="text-md font-semibold text-slate-700 dark:text-slate-300 mb-4">Auto Backup Database</h4>
            
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoBackup.enabled}
                    onChange={(e) => setAutoBackup(prev => ({ ...prev, enabled: e.target.checked }))}
                    className="w-4 h-4"
                  />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Enable Auto Backup</span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Interval (hours)</label>
                  <input
                    type="number"
                    min="1"
                    className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-2"
                    value={autoBackup.intervalHours}
                    onChange={(e) => setAutoBackup(prev => ({ ...prev, intervalHours: parseInt(e.target.value) || 1 }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Max Backups to Keep</label>
                  <input
                    type="number"
                    min="1"
                    className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-2"
                    value={autoBackup.maxBackups}
                    onChange={(e) => setAutoBackup(prev => ({ ...prev, maxBackups: parseInt(e.target.value) || 1 }))}
                  />
                </div>
              </div>

              {autoBackup.lastBackup && (
                <p className="text-xs text-slate-500">
                  Last backup: {new Date(autoBackup.lastBackup).toLocaleString()}
                </p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleSaveAutoBackup}
                  disabled={isSavingBackup}
                  className="px-4 py-2 rounded-md bg-[--color-primary-600] hover:bg-[--color-primary-700] text-white font-semibold disabled:opacity-50"
                >
                  {isSavingBackup ? 'Saving…' : 'Save Auto Backup Settings'}
                </button>
                <button
                  onClick={handleRunBackupNow}
                  disabled={isRunningBackup}
                  className="px-4 py-2 rounded-md bg-green-600 hover:bg-green-700 text-white font-semibold disabled:opacity-50"
                >
                  {isRunningBackup ? 'Backing up…' : 'Backup Now'}
                </button>
              </div>

              {backupMsg && (
                <p className="text-xs text-green-600 dark:text-green-400">{backupMsg}</p>
              )}
            </div>
          </div>

          {/* Backup List Section */}
          <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-md font-semibold text-slate-700 dark:text-slate-300">Backup Files</h4>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".db"
                  onChange={handleRestore}
                  className="hidden"
                  id="restore-file-input"
                />
                <label
                  htmlFor="restore-file-input"
                  className="px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded cursor-pointer font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {isRestoring ? 'Restoring…' : 'Restore from Backup'}
                </label>
              </div>
            </div>
            
            {backupList.length === 0 ? (
              <p className="text-sm text-slate-500">No backups found.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {backupList.map((file) => (
                  <div key={file} className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-900 rounded">
                    <span className="text-sm text-slate-700 dark:text-slate-300 truncate mr-2">{file}</span>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => handleRestoreExisting(file)}
                        disabled={isRestoring}
                        className="px-3 py-1 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded whitespace-nowrap disabled:opacity-50"
                      >
                        Restore
                      </button>
                      <a
                        href={`/download-backup/${file}?token=${localStorage.getItem('authToken')}`}
                        className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded whitespace-nowrap"
                      >
                        Download
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};