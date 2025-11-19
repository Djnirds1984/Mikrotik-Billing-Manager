

import React, { useEffect, useState } from 'react';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { CircleStackIcon } from '../constants.tsx';
// FIX: Import missing functions for MariaDB operations.
import { getPanelSettings, savePanelSettings, initMariaDb, migrateSqliteToMariaDb } from '../services/databaseService.ts';
import type { PanelSettings } from '../types.ts';

export const DatabaseSettings: React.FC = () => {
  const { t } = useLocalization();
  const [settings, setSettings] = useState<PanelSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationMsg, setMigrationMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await getPanelSettings();
        setSettings({
          ...s,
          databaseEngine: s.databaseEngine || 'sqlite',
        });
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
        </div>
      </div>
    </div>
  );
};