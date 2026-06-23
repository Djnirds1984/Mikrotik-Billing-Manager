import React, { useState, useEffect } from 'react';
import type { WanSettings, NetworkStatus, AvailableInterface } from '../types.ts';
import { getWanSettings, saveWanSettings, applyWanSettings, getNetworkStatus, getAvailableInterfaces } from '../services/networkService.ts';

export const WanSettingsPanel: React.FC = () => {
  const [settings, setSettings] = useState<Partial<WanSettings>>({
    connectionType: 'dhcp',
    wanInterface: 'eth0',
    staticIp: '',
    staticGateway: '',
    staticDns: '',
    pppoeUsername: '',
    pppoePassword: ''
  });
  
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus | null>(null);
  const [availableInterfaces, setAvailableInterfaces] = useState<AvailableInterface[]>([]);
  const [defaultInterface, setDefaultInterface] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);

  useEffect(() => {
    loadSettings();
    loadNetworkStatus();
    loadInterfaces();
  }, []);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      const data = await getWanSettings();
      setSettings({
        connectionType: data.connectionType || 'dhcp',
        wanInterface: data.wanInterface || 'eth0',
        staticIp: data.staticIp || '',
        staticGateway: data.staticGateway || '',
        staticDns: data.staticDns || '',
        pppoeUsername: data.pppoeUsername || '',
        pppoePassword: data.pppoePassword || ''
      });
    } catch (err) {
      setError('Failed to load WAN settings: ' + (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const loadNetworkStatus = async () => {
    try {
      const status = await getNetworkStatus();
      setNetworkStatus(status);
    } catch (err) {
      console.error('Failed to load network status:', err);
    }
  };

  const loadInterfaces = async () => {
    try {
      const data = await getAvailableInterfaces();
      setAvailableInterfaces(data.interfaces);
      setDefaultInterface(data.defaultInterface);
      // Auto-select the default interface if no valid interface is set
      if (data.defaultInterface && data.interfaces.length > 0) {
        const hasDefault = data.interfaces.some(i => i.name === data.defaultInterface);
        if (hasDefault && (!settings.wanInterface || settings.wanInterface === 'eth0')) {
          setSettings(prev => ({ ...prev, wanInterface: data.defaultInterface! }));
        }
      }
    } catch (err) {
      console.error('Failed to load available interfaces:', err);
    }
  };

  const validateSettings = (): string | null => {
    if (!settings.connectionType || !['dhcp', 'static', 'pppoe'].includes(settings.connectionType)) {
      return 'Invalid connection type';
    }

    if (settings.connectionType === 'static') {
      // Validate CIDR notation
      const cidrRegex = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/;
      if (!settings.staticIp || !cidrRegex.test(settings.staticIp)) {
        return 'Invalid IP address format. Use CIDR notation (e.g., 10.0.0.5/24)';
      }

      // Validate gateway
      const ipRegex = /^\d{1,3}(\.\d{1,3}){3}$/;
      if (!settings.staticGateway || !ipRegex.test(settings.staticGateway)) {
        return 'Invalid gateway IP address';
      }

      // Validate DNS
      const dnsServers = settings.staticDns?.split(',').map(d => d.trim()) || [];
      for (const dns of dnsServers) {
        if (!ipRegex.test(dns)) {
          return `Invalid DNS server: ${dns}`;
        }
      }
    }

    if (settings.connectionType === 'pppoe') {
      if (!settings.pppoeUsername || settings.pppoeUsername.trim().length === 0) {
        return 'PPPoE username is required';
      }
      if (!settings.pppoePassword || settings.pppoePassword.trim().length === 0) {
        return 'PPPoE password is required';
      }
    }

    // Validate interface name
    const interfaceRegex = /^[a-zA-Z0-9-]+$/;
    if (!settings.wanInterface || !interfaceRegex.test(settings.wanInterface)) {
      return 'Invalid interface name';
    }

    return null;
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(null);

    const validationError = validateSettings();
    if (validationError) {
      setError(validationError);
      return;
    }

    // Show warning dialog
    const confirm = window.confirm(
      '⚠️ WARNING: Changing WAN settings may disconnect your session!\n\n' +
      'If the new configuration is incorrect, you may lose access to the panel.\n\n' +
      'Are you sure you want to continue?'
    );

    if (!confirm) return;

    try {
      setIsSaving(true);
      const result = await saveWanSettings(settings);
      setSuccess(result.message);
      loadNetworkStatus();
    } catch (err) {
      setError('Failed to save WAN settings: ' + (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleApply = async () => {
    setError(null);
    setSuccess(null);

    const confirm = window.confirm(
      '⚠️ WARNING: Re-applying WAN settings may disconnect your session!\n\n' +
      'Are you sure you want to continue?'
    );

    if (!confirm) return;

    try {
      setIsSaving(true);
      const result = await applyWanSettings();
      setSuccess(result.message);
      loadNetworkStatus();
    } catch (err) {
      setError('Failed to apply WAN settings: ' + (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (field: string, value: string) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  if (isLoading) {
    return <div className="text-center py-4 text-slate-600 dark:text-slate-400">Loading WAN settings...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Status Messages */}
      {error && (
        <div className="p-3 rounded-md bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 rounded-md bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400">
          {success}
        </div>
      )}

      {/* Connection Type */}
      <div>
        <label htmlFor="connectionType" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          WAN Connection Type
        </label>
        <select
          id="connectionType"
          value={settings.connectionType}
          onChange={(e) => handleChange('connectionType', e.target.value)}
          className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
        >
          <option value="dhcp">DHCP Client</option>
          <option value="static">Static IP</option>
          <option value="pppoe">PPPoE Client</option>
        </select>
      </div>

      {/* WAN Interface */}
      <div>
        <label htmlFor="wanInterface" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          WAN Physical Interface
        </label>
        {availableInterfaces.length > 0 ? (
          <div className="mt-1 space-y-2">
            <select
              id="wanInterface"
              value={showManualInput ? '__manual__' : settings.wanInterface}
              onChange={(e) => {
                if (e.target.value === '__manual__') {
                  setShowManualInput(true);
                } else {
                  setShowManualInput(false);
                  handleChange('wanInterface', e.target.value);
                }
              }}
              className="block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
            >
              {availableInterfaces.map(iface => (
                <option key={iface.name} value={iface.name}>
                  {iface.name} {iface.name === defaultInterface ? '(Active / Default Route)' : ''} — {iface.state.toUpperCase()} {iface.mac ? `(${iface.mac})` : ''}
                </option>
              ))}
              <option value="__manual__">Enter manually...</option>
            </select>
            {showManualInput && (
              <input
                type="text"
                value={settings.wanInterface}
                onChange={(e) => handleChange('wanInterface', e.target.value)}
                className="block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                placeholder="e.g. eth0"
              />
            )}
          </div>
        ) : (
          <input
            type="text"
            id="wanInterface"
            value={settings.wanInterface}
            onChange={(e) => handleChange('wanInterface', e.target.value)}
            className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
            placeholder="eth0"
          />
        )}
        {availableInterfaces.length === 0 && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Could not detect interfaces automatically. Enter the interface name manually.
          </p>
        )}
      </div>

      {/* Static IP Fields */}
      {settings.connectionType === 'static' && (
        <div className="space-y-4 pl-4 border-l-2 border-blue-500">
          <div>
            <label htmlFor="staticIp" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              IP Address with CIDR
            </label>
            <input
              type="text"
              id="staticIp"
              value={settings.staticIp}
              onChange={(e) => handleChange('staticIp', e.target.value)}
              className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
              placeholder="10.0.0.5/24"
            />
          </div>

          <div>
            <label htmlFor="staticGateway" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Gateway IP
            </label>
            <input
              type="text"
              id="staticGateway"
              value={settings.staticGateway}
              onChange={(e) => handleChange('staticGateway', e.target.value)}
              className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
              placeholder="10.0.0.1"
            />
          </div>

          <div>
            <label htmlFor="staticDns" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              DNS Servers (comma-separated)
            </label>
            <input
              type="text"
              id="staticDns"
              value={settings.staticDns}
              onChange={(e) => handleChange('staticDns', e.target.value)}
              className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
              placeholder="8.8.8.8,1.1.1.1"
            />
          </div>
        </div>
      )}

      {/* PPPoE Fields */}
      {settings.connectionType === 'pppoe' && (
        <div className="space-y-4 pl-4 border-l-2 border-blue-500">
          <div>
            <label htmlFor="pppoeUsername" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              PPPoE Username
            </label>
            <input
              type="text"
              id="pppoeUsername"
              value={settings.pppoeUsername}
              onChange={(e) => handleChange('pppoeUsername', e.target.value)}
              className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
              placeholder="username@isp.com"
            />
          </div>

          <div>
            <label htmlFor="pppoePassword" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              PPPoE Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                id="pppoePassword"
                value={settings.pppoePassword}
                onChange={(e) => handleChange('pppoePassword', e.target.value)}
                className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white pr-10"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Network Status */}
      {networkStatus && (
        <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-md">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Current Network Status</h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-slate-500 dark:text-slate-400">Interface:</span>
              <span className="ml-2 text-slate-900 dark:text-white">{networkStatus.wanInterface}</span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">IP Address:</span>
              <span className="ml-2 text-slate-900 dark:text-white">{networkStatus.ipAddress}</span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Gateway:</span>
              <span className="ml-2 text-slate-900 dark:text-white">{networkStatus.gateway}</span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Status:</span>
              <span className={`ml-2 ${networkStatus.isOnline ? 'text-green-600' : 'text-red-600'}`}>
                {networkStatus.isOnline ? 'Online' : 'Offline'}
              </span>
            </div>
            {networkStatus.dnsServers.length > 0 && (
              <div className="col-span-2">
                <span className="text-slate-500 dark:text-slate-400">DNS:</span>
                <span className="ml-2 text-slate-900 dark:text-white">{networkStatus.dnsServers.join(', ')}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg disabled:opacity-50 transition-colors"
        >
          {isSaving ? 'Saving...' : 'Save WAN Configuration'}
        </button>
        <button
          onClick={handleApply}
          disabled={isSaving}
          className="px-6 py-2 bg-slate-600 hover:bg-slate-500 text-white font-semibold rounded-lg disabled:opacity-50 transition-colors"
        >
          Re-apply Settings
        </button>
        <button
          onClick={loadNetworkStatus}
          className="px-6 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-900 dark:text-white font-semibold rounded-lg transition-colors"
        >
          Refresh Status
        </button>
      </div>
    </div>
  );
};
