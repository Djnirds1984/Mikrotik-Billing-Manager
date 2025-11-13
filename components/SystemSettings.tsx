import React, { useEffect, useState } from 'react';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { getPanelSettings, savePanelSettings } from '../services/databaseService.ts';
import type { PanelSettings } from '../types.ts';
import { 
  CircleStackIcon, 
  ChipIcon, 
  BellIcon, 
  TelegramIcon,
  CogIcon,
  ServerIcon
} from '../constants.tsx';

interface SystemSettingsProps {
  licenseStatus: string;
}

const SettingsCard: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
  <div className="bg-white rounded-lg shadow-md p-6 mb-6">
    <div className="flex items-center mb-4">
      <div className="text-blue-600 mr-3">{icon}</div>
      <h2 className="text-xl font-semibold text-gray-800">{title}</h2>
    </div>
    {children}
  </div>
);

const TelegramManager: React.FC = () => {
  const { t } = useLocalization();
  const [settings, setSettings] = useState<PanelSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState('');
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const s = await getPanelSettings();
        setSettings({
          ...s,
          telegramSettings: s.telegramSettings || {
            enabled: false,
            botToken: '',
            chatId: '',
            enableClientDueDate: true,
            enableClientDisconnected: true,
            enableInterfaceDisconnected: true,
            enablePanelOffline: true,
            enablePanelOnline: true,
            enableUserPaid: true,
          }
        });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const updateTelegramField = (field: string, value: any) => {
    setSettings(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        telegramSettings: {
          ...prev.telegramSettings,
          [field]: value
        }
      };
    });
  };

  const handleSave = async () => {
    if (!settings?.telegramSettings) return;
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        telegramSettings: settings.telegramSettings
      };
      const res = await savePanelSettings(payload);
      alert(res.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!settings?.telegramSettings?.botToken || !settings?.telegramSettings?.chatId) {
      alert('Please configure bot token and chat ID first');
      return;
    }
    setIsTesting(true);
    setError(null);
    try {
      const response = await fetch('/api/telegram/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          botToken: settings.telegramSettings.botToken,
          chatId: settings.telegramSettings.chatId,
          message: testMessage || 'Test message from Mikrotik Billing Manager'
        })
      });
      const result = await response.json();
      if (result.success) {
        alert('Test message sent successfully!');
      } else {
        alert('Failed to send test message: ' + result.error);
      }
    } catch (e) {
      setError('Failed to send test message: ' + (e as Error).message);
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) return <div className="text-gray-500">Loading...</div>;
  if (error) return <div className="text-red-500">Error: {error}</div>;

  const telegramSettings = settings?.telegramSettings;

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={telegramSettings?.enabled || false}
            onChange={(e) => updateTelegramField('enabled', e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-700">Enable Telegram Notifications</span>
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Bot Token
          </label>
          <input
            type="password"
            value={telegramSettings?.botToken || ''}
            onChange={(e) => updateTelegramField('botToken', e.target.value)}
            placeholder="Enter your Telegram bot token"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={!telegramSettings?.enabled}
          />
          <p className="text-xs text-gray-500 mt-1">
            Get your bot token from @BotFather
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Chat ID
          </label>
          <input
            type="text"
            value={telegramSettings?.chatId || ''}
            onChange={(e) => updateTelegramField('chatId', e.target.value)}
            placeholder="Enter your chat ID"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={!telegramSettings?.enabled}
          />
          <p className="text-xs text-gray-500 mt-1">
            Get your chat ID from @userinfobot
          </p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Notification Events
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={telegramSettings?.enableClientDueDate || false}
              onChange={(e) => updateTelegramField('enableClientDueDate', e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              disabled={!telegramSettings?.enabled}
            />
            <span className="text-sm text-gray-700">Client Due Date</span>
          </label>

          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={telegramSettings?.enableClientDisconnected || false}
              onChange={(e) => updateTelegramField('enableClientDisconnected', e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              disabled={!telegramSettings?.enabled}
            />
            <span className="text-sm text-gray-700">Client Disconnected</span>
          </label>

          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={telegramSettings?.enableInterfaceDisconnected || false}
              onChange={(e) => updateTelegramField('enableInterfaceDisconnected', e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              disabled={!telegramSettings?.enabled}
            />
            <span className="text-sm text-gray-700">Interface Disconnected</span>
          </label>

          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={telegramSettings?.enablePanelOffline || false}
              onChange={(e) => updateTelegramField('enablePanelOffline', e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              disabled={!telegramSettings?.enabled}
            />
            <span className="text-sm text-gray-700">Panel Offline</span>
          </label>

          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={telegramSettings?.enablePanelOnline || false}
              onChange={(e) => updateTelegramField('enablePanelOnline', e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              disabled={!telegramSettings?.enabled}
            />
            <span className="text-sm text-gray-700">Panel Online</span>
          </label>

          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={telegramSettings?.enableUserPaid || false}
              onChange={(e) => updateTelegramField('enableUserPaid', e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              disabled={!telegramSettings?.enabled}
            />
            <span className="text-sm text-gray-700">User Payment</span>
          </label>
        </div>
      </div>

      <div className="flex space-x-3">
        <button
          onClick={handleSave}
          disabled={isSaving || !telegramSettings?.enabled}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
        
        <div className="flex space-x-2">
          <input
            type="text"
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            placeholder="Test message (optional)"
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={!telegramSettings?.enabled}
          />
          <button
            onClick={handleTest}
            disabled={isTesting || !telegramSettings?.enabled || !telegramSettings?.botToken || !telegramSettings?.chatId}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {isTesting ? 'Testing...' : 'Test'}
          </button>
        </div>
      </div>
    </div>
  );
};

export const SystemSettings: React.FC<SystemSettingsProps> = ({ licenseStatus }) => {
  const { t } = useLocalization();
  const [settings, setSettings] = useState<PanelSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await getPanelSettings();
        setSettings(s);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const handleCreateBackup = async () => {
    if (!settings) return;
    setIsCreating(true);
    setError(null);
    try {
      const response = await fetch('/api/backup/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          backupName: `backup-${new Date().toISOString().split('T')[0]}`,
          includeDatabase: true,
          includeFiles: true,
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to create backup');
      }
      
      const result = await response.json();
      alert('Backup created successfully!');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsCreating(false);
    }
  };

  if (isLoading) return <div className="p-6">{t('loading')}...</div>;
  if (error) return <div className="p-6 text-red-500">Error: {error}</div>;

  return (
    <div className="p-6 space-y-6">
      {licenseStatus !== 'valid' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <div className="flex items-center">
            <div className="text-red-400 mr-3">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h3 className="text-red-800 font-medium">Panel Unlicensed</h3>
              <p className="text-red-600 text-sm">
                Please activate your panel on the License page to ensure all features work correctly.
              </p>
            </div>
          </div>
        </div>
      )}

      <SettingsCard title="Database Settings" icon={<CircleStackIcon className="w-6 h-6" />}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Database Engine
            </label>
            <select
              value={settings?.databaseEngine || 'sqlite'}
              onChange={(e) => setSettings({ ...settings!, databaseEngine: e.target.value as 'sqlite' | 'mariadb' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="sqlite">SQLite</option>
              <option value="mariadb">MariaDB</option>
            </select>
          </div>
          
          {settings?.databaseEngine === 'mariadb' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Host
                </label>
                <input
                  type="text"
                  value={settings?.dbHost || ''}
                  onChange={(e) => setSettings({ ...settings!, dbHost: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="localhost"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Port
                </label>
                <input
                  type="number"
                  value={settings?.dbPort || 3306}
                  onChange={(e) => setSettings({ ...settings!, dbPort: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Username
                </label>
                <input
                  type="text"
                  value={settings?.dbUser || ''}
                  onChange={(e) => setSettings({ ...settings!, dbUser: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={settings?.dbPassword || ''}
                  onChange={(e) => setSettings({ ...settings!, dbPassword: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Database Name
                </label>
                <input
                  type="text"
                  value={settings?.dbName || ''}
                  onChange={(e) => setSettings({ ...settings!, dbName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}
        </div>
      </SettingsCard>

      <SettingsCard title="System Resources" icon={<ServerIcon className="w-6 h-6" />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="text-sm font-medium text-gray-700 mb-2">CPU Usage</h3>
            <div className="text-2xl font-bold text-gray-900">{settings?.systemInfo?.cpuUsage || 'N/A'}%</div>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Memory Usage</h3>
            <div className="text-2xl font-bold text-gray-900">{settings?.systemInfo?.memoryUsage || 'N/A'}%</div>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Disk Usage</h3>
            <div className="text-2xl font-bold text-gray-900">{settings?.systemInfo?.diskUsage || 'N/A'}%</div>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Uptime</h3>
            <div className="text-2xl font-bold text-gray-900">{settings?.systemInfo?.uptime || 'N/A'}</div>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Backup & Restore" icon={<CogIcon className="w-6 h-6" />}>
        <div className="space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-center">
              <div className="text-yellow-400 mr-3">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-yellow-800 font-medium">Backup Recommendation</h3>
                <p className="text-yellow-600 text-sm">
                  Regular backups are recommended to protect your data. Create a backup before making major changes.
                </p>
              </div>
            </div>
          </div>
          
          <div className="flex space-x-4">
            <button
              onClick={handleCreateBackup}
              disabled={isCreating}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isCreating ? 'Creating...' : 'Backup Now'}
            </button>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="AI Settings" icon={<ChipIcon className="w-6 h-6" />}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              AI Provider
            </label>
            <select
              value={settings?.aiProvider || 'openai'}
              onChange={(e) => setSettings({ ...settings!, aiProvider: e.target.value as 'openai' | 'anthropic' | 'gemini' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Google Gemini</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              API Key
            </label>
            <input
              type="password"
              value={settings?.aiApiKey || ''}
              onChange={(e) => setSettings({ ...settings!, aiApiKey: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your AI API key"
            />
          </div>
          
          <div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings?.aiEnabled || false}
                onChange={(e) => setSettings({ ...settings!, aiEnabled: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Enable AI Features</span>
            </label>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Telegram Manager" icon={<TelegramIcon className="w-6 h-6" />}>
        <TelegramManager />
      </SettingsCard>

      <SettingsCard title="Notification Settings" icon={<BellIcon className="w-6 h-6" />}>
        <div className="space-y-4">
          <div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings?.emailNotifications || false}
                onChange={(e) => setSettings({ ...settings!, emailNotifications: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Enable Email Notifications</span>
            </label>
          </div>
          
          <div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings?.smsNotifications || false}
                onChange={(e) => setSettings({ ...settings!, smsNotifications: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Enable SMS Notifications</span>
            </label>
          </div>
          
          <div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings?.pushNotifications || false}
                onChange={(e) => setSettings({ ...settings!, pushNotifications: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Enable Push Notifications</span>
            </label>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Advanced Settings" icon={<CogIcon className="w-6 h-6" />}>
        <div className="space-y-4">
          <div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings?.debugMode || false}
                onChange={(e) => setSettings({ ...settings!, debugMode: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Enable Debug Mode</span>
            </label>
          </div>
          
          <div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings?.autoUpdates || false}
                onChange={(e) => setSettings({ ...settings!, autoUpdates: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Enable Auto Updates</span>
            </label>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Log Level
            </label>
            <select
              value={settings?.logLevel || 'info'}
              onChange={(e) => setSettings({ ...settings!, logLevel: e.target.value as 'error' | 'warn' | 'info' | 'debug' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="error">Error</option>
              <option value="warn">Warning</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
          </div>
        </div>
      </SettingsCard>

      <div className="flex justify-end space-x-4">
        <button
          onClick={async () => {
            if (!settings) return;
            try {
              const payload: Partial<PanelSettings> = {
                databaseEngine: settings.databaseEngine,
                dbHost: settings.dbHost,
                dbPort: settings.dbPort,
                dbUser: settings.dbUser,
                dbPassword: settings.dbPassword,
                dbName: settings.dbName,
                aiProvider: settings.aiProvider,
                aiApiKey: settings.aiApiKey,
                aiEnabled: settings.aiEnabled,
                emailNotifications: settings.emailNotifications,
                smsNotifications: settings.smsNotifications,
                pushNotifications: settings.pushNotifications,
                debugMode: settings.debugMode,
                autoUpdates: settings.autoUpdates,
                logLevel: settings.logLevel,
                telegramSettings: settings.telegramSettings,
              };
              const res = await savePanelSettings(payload);
              alert(res.message);
            } catch (e) {
              alert((e as Error).message);
            }
          }}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Save All Settings
        </button>
      </div>
    </div>
  );
};