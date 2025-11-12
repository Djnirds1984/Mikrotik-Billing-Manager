import React, { useEffect, useState } from 'react';
import { getPanelSettings, savePanelSettings } from '../services/databaseService.ts';
import type { PanelSettings } from '../types.ts';

export const SystemSettings: React.FC = () => {
  const [settings, setSettings] = useState<PanelSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await getPanelSettings();
        setSettings(s);
      } catch (e) {
        setError('Failed to load settings');
      }
    })();
  }, []);

  const ns = settings?.notificationSettings || {};

  const updateNs = (patch: Partial<NonNullable<PanelSettings['notificationSettings']>>) => {
    setSettings(prev => {
      if (!prev) return prev;
      return { ...prev, notificationSettings: { ...prev.notificationSettings, ...patch } };
    });
  };

  const handleSave = async () => {
    if (!settings) return;
    setIsSaving(true);
    setError(null);
    try {
      await savePanelSettings(settings);
      alert('Settings saved');
    } catch (e) {
      setError('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-6">System Settings</h2>
      {error && (
        <div className="p-3 mb-4 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-600 rounded-md text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}
      {!settings ? (
        <div className="p-6 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">Loading...</div>
      ) : (
        <div className="space-y-8">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-4">Notification Generators</h3>
            <div className="space-y-4">
              <label className="flex items-center justify-between">
                <span className="text-slate-700 dark:text-slate-300">Enable PPPoE notifications</span>
                <input type="checkbox" checked={ns.enablePppoe !== false} onChange={(e) => updateNs({ enablePppoe: e.target.checked })} />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-slate-700 dark:text-slate-300">Enable DHCP portal notifications</span>
                <input type="checkbox" checked={ns.enableDhcpPortal !== false} onChange={(e) => updateNs({ enableDhcpPortal: e.target.checked })} />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-slate-700 dark:text-slate-300">Enable Network route notifications</span>
                <input type="checkbox" checked={ns.enableNetwork !== false} onChange={(e) => updateNs({ enableNetwork: e.target.checked })} />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-slate-700 dark:text-slate-300">Enable billed notifications</span>
                <input type="checkbox" checked={!!ns.enableBilled} onChange={(e) => updateNs({ enableBilled: e.target.checked })} />
              </label>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-4">Notification Tuning</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex flex-col">
                <span className="text-slate-700 dark:text-slate-300 mb-1">DHCP near-expiry threshold (hours)</span>
                <input type="number" min={1} className="bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" value={ns.dhcpNearExpiryHours ?? 24} onChange={(e) => updateNs({ dhcpNearExpiryHours: parseInt(e.target.value, 10) || 24 })} />
              </label>
              <label className="flex flex-col">
                <span className="text-slate-700 dark:text-slate-300 mb-1">Generator interval (seconds)</span>
                <input type="number" min={5} className="bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" value={ns.generatorIntervalSeconds ?? 30} onChange={(e) => updateNs({ generatorIntervalSeconds: parseInt(e.target.value, 10) || 30 })} />
              </label>
              <label className="flex flex-col">
                <span className="text-slate-700 dark:text-slate-300 mb-1">Debounce window (minutes)</span>
                <input type="number" min={1} className="bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" value={ns.debounceMinutes ?? 15} onChange={(e) => updateNs({ debounceMinutes: parseInt(e.target.value, 10) || 15 })} />
              </label>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={handleSave} disabled={isSaving} className="bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-bold py-2 px-4 rounded-lg disabled:opacity-50">
              {isSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

