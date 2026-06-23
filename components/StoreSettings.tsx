import React, { useState, useEffect } from 'react';
import type { StoreSettings, PanelSettings } from '../types.ts';
import { dbApi, getPanelSettings } from '../services/databaseService.ts';
import { Loader } from './Loader.tsx';
import { CodeBlock } from './CodeBlock.tsx';

const defaultSettings: StoreSettings = {
    portalRedirectUrl: '',
    nonPaymentPool: '172.16.44.0/24',
    portalServerIp: '',
    portalServerPort: 8080,
    walledGardenEnabled: false,
    autoSyncWorkerEnabled: false,
    customExpiredMessage: '',
    storeEnabled: true,
    paymentMethods: { paymongo: true, manualGcash: true, xendit: true },
    gcashNumber: '',
    gcashAccountName: '',
    storeBannerText: '',
    autoRestoreOnPayment: true
};

const TabButton: React.FC<{ label: string; icon: React.ReactNode; isActive: boolean; onClick: () => void }> = ({ label, icon, isActive, onClick }) => (
    <button
        onClick={onClick}
        className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors duration-200 focus:outline-none ${
            isActive
                ? 'border-[--color-primary-500] text-[--color-primary-500] dark:text-[--color-primary-400]'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
        }`}
    >
        {icon}
        <span>{label}</span>
    </button>
);

const TextInput: React.FC<{ label: string; value: string; onChange: (v: string) => void; placeholder?: string; info?: string; type?: string }> = ({ label, value, onChange, placeholder, info, type = 'text' }) => (
    <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{label}</label>
        <input type={type} value={value || ''} onChange={e => onChange(e.target.value)} className="block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white focus:ring-1 focus:ring-[--color-primary-500] focus:border-[--color-primary-500]" placeholder={placeholder} />
        {info && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{info}</p>}
    </div>
);

const NumberInput: React.FC<{ label: string; value: number; onChange: (v: number) => void; placeholder?: string; info?: string }> = ({ label, value, onChange, placeholder, info }) => (
    <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{label}</label>
        <input type="number" value={value || ''} onChange={e => onChange(parseInt(e.target.value) || 0)} className="block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white focus:ring-1 focus:ring-[--color-primary-500] focus:border-[--color-primary-500]" placeholder={placeholder} />
        {info && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{info}</p>}
    </div>
);

const Toggle: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void; info?: string }> = ({ label, checked, onChange, info }) => (
    <div className="flex items-start justify-between">
        <div className="flex-1 pr-4">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</p>
            {info && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{info}</p>}
        </div>
        <button
            type="button"
            onClick={() => onChange(!checked)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${checked ? 'bg-[--color-primary-600]' : 'bg-slate-300 dark:bg-slate-600'}`}
        >
            <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
    </div>
);

const generateMikrotikScript = (settings: StoreSettings): string => {
    const portalIp = settings.portalServerIp || '<PORTAL_IP>';
    const portalPort = settings.portalServerPort || '<PORTAL_PORT>';
    const pool = settings.nonPaymentPool || '172.16.44.0/24';

    return `# ============================================
# EXPIRED CLIENT WALLED GARDEN SETUP
# Non-payment IP pool: ${pool}
# Generated from Store Settings
# ============================================

# 1. Create address list for the portal/store server
/ip firewall address-list
add list=PORTAL_SERVER address=${portalIp} comment="Billing Portal Server"

# 2. Non-payment pool address list (expired clients get IPs from this range)
/ip firewall address-list
add list=NON_PAYMENT_POOL address=${pool} comment="Non-payment profile IP pool"

# 3. Mangle rule: mark expired client traffic going outside portal
/ip firewall mangle
add chain=prerouting \\
    src-address-list=NON_PAYMENT_POOL \\
    dst-address-list=!PORTAL_SERVER \\
    action=mark-connection \\
    new-connection-mark=expired_blocked \\
    passthrough=yes \\
    comment="Block expired clients except portal"

# 4. Filter rule: drop marked traffic (block internet, allow portal only)
/ip firewall filter
add chain=forward \\
    connection-mark=expired_blocked \\
    action=drop \\
    comment="Drop expired client traffic to non-portal destinations"

# 5. NAT redirect: force HTTP traffic from expired clients to portal
/ip firewall nat
add chain=dstnat \\
    protocol=tcp \\
    dst-port=80 \\
    src-address-list=NON_PAYMENT_POOL \\
    dst-address-list=!PORTAL_SERVER \\
    action=dst-nat \\
    to-addresses=${portalIp} \\
    to-ports=${portalPort} \\
    comment="Redirect expired HTTP to portal"

# 6. DNS redirect: redirect DNS to router so portal domain resolves
/ip firewall nat
add chain=dstnat \\
    protocol=udp \\
    dst-port=53 \\
    src-address-list=NON_PAYMENT_POOL \\
    action=redirect \\
    to-ports=53 \\
    comment="Redirect expired DNS to router"
`;
};

// Icons
const ShieldIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
);

const StoreIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
    </svg>
);

const CodeIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
    </svg>
);

export const StoreSettingsPage: React.FC = () => {
    const [settings, setSettings] = useState<StoreSettings>(defaultSettings);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<'portal' | 'store' | 'script'>('portal');
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [paymentProviders, setPaymentProviders] = useState({
        paymongoEnabled: false,
        xenditEnabled: false
    });

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            setLoading(true);
            const [data, panelSettings] = await Promise.all([
                dbApi.get<StoreSettings>('/store-settings'),
                getPanelSettings().catch(() => null as PanelSettings | null)
            ]);
            setSettings({
                ...defaultSettings,
                ...data,
                paymentMethods: { ...defaultSettings.paymentMethods, ...(data.paymentMethods || {}) }
            });
            if (panelSettings) {
                setPaymentProviders({
                    paymongoEnabled: !!panelSettings.paymongoSettings?.enabled,
                    xenditEnabled: !!panelSettings.xenditSettings?.enabled
                });
            }
        } catch (err) {
            console.error('Failed to load store settings:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            await dbApi.post('/store-settings', settings);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (err) {
            alert(`Failed to save settings: ${(err as Error).message}`);
        } finally {
            setSaving(false);
        }
    };

    const updateSetting = <K extends keyof StoreSettings>(key: K, value: StoreSettings[K]) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    if (loading) {
        return (
            <div className="flex justify-center p-12">
                <Loader />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Store Settings</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Configure the customer store, expired portal, and walled garden</p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className={`px-6 py-2.5 rounded-lg font-semibold text-sm transition-all shadow-sm ${
                        saveSuccess
                            ? 'bg-green-600 text-white'
                            : 'bg-[--color-primary-600] hover:bg-[--color-primary-700] text-white disabled:opacity-50'
                    }`}
                >
                    {saving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save Settings'}
                </button>
            </div>

            {/* Tabs */}
            <div className="border-b border-slate-200 dark:border-slate-700 mb-6">
                <div className="flex gap-1">
                    <TabButton label="Expired Portal" icon={<ShieldIcon className="w-5 h-5" />} isActive={activeTab === 'portal'} onClick={() => setActiveTab('portal')} />
                    <TabButton label="Store Config" icon={<StoreIcon className="w-5 h-5" />} isActive={activeTab === 'store'} onClick={() => setActiveTab('store')} />
                    <TabButton label="MikroTik Script" icon={<CodeIcon className="w-5 h-5" />} isActive={activeTab === 'script'} onClick={() => setActiveTab('script')} />
                </div>
            </div>

            {/* Tab Content */}
            {activeTab === 'portal' && (
                <div className="space-y-6">
                    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Portal Redirect Settings</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <TextInput
                                label="Portal Redirect URL"
                                value={settings.portalRedirectUrl}
                                onChange={v => updateSetting('portalRedirectUrl', v)}
                                placeholder="http://192.168.1.1:8080/expired"
                                info="Full URL where expired clients are redirected"
                            />
                            <TextInput
                                label="Non-Payment IP Pool"
                                value={settings.nonPaymentPool}
                                onChange={v => updateSetting('nonPaymentPool', v)}
                                placeholder="172.16.44.0/24"
                                info="Subnet assigned to the non-payment PPPoE profile"
                            />
                            <TextInput
                                label="Portal Server IP"
                                value={settings.portalServerIp}
                                onChange={v => updateSetting('portalServerIp', v)}
                                placeholder="192.168.1.1"
                                info="IP of this billing panel server"
                            />
                            <NumberInput
                                label="Portal Server Port"
                                value={settings.portalServerPort}
                                onChange={v => updateSetting('portalServerPort', v)}
                                placeholder="8080"
                                info="Port the captive portal runs on"
                            />
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Walled Garden & Worker</h3>
                        <div className="space-y-4">
                            <Toggle
                                label="Walled Garden Enabled"
                                checked={settings.walledGardenEnabled}
                                onChange={v => updateSetting('walledGardenEnabled', v)}
                                info="When enabled, expired clients can only access the portal/store"
                            />
                            <Toggle
                                label="Auto-Sync Worker Enabled"
                                checked={settings.autoSyncWorkerEnabled}
                                onChange={v => updateSetting('autoSyncWorkerEnabled', v)}
                                info="Automatically adds expired client IPs to MikroTik EXPIRED_CLIENTS address-list every 2 minutes"
                            />
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Custom Expired Message</h3>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Message shown on expired portal</label>
                            <textarea
                                value={settings.customExpiredMessage}
                                onChange={e => updateSetting('customExpiredMessage', e.target.value)}
                                rows={3}
                                className="block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white focus:ring-1 focus:ring-[--color-primary-500] focus:border-[--color-primary-500]"
                                placeholder="Your subscription has expired. Please renew to restore internet access."
                            />
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Leave empty to use the default message</p>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'store' && (
                <div className="space-y-6">
                    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Store General</h3>
                        <div className="space-y-4">
                            <Toggle
                                label="Store Enabled"
                                checked={settings.storeEnabled}
                                onChange={v => updateSetting('storeEnabled', v)}
                                info="Enable or disable the customer store. When disabled, the store page shows a maintenance message."
                            />
                            <Toggle
                                label="Auto-Restore on Payment"
                                checked={settings.autoRestoreOnPayment}
                                onChange={v => updateSetting('autoRestoreOnPayment', v)}
                                info="Automatically restore client internet access after payment is approved"
                            />
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Payment Methods</h3>
                        <div className="space-y-3">
                            {paymentProviders.paymongoEnabled && (
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={settings.paymentMethods.paymongo}
                                        onChange={e => updateSetting('paymentMethods', { ...settings.paymentMethods, paymongo: e.target.checked })}
                                        className="w-4 h-4 rounded border-slate-300 text-[--color-primary-600] focus:ring-[--color-primary-500]"
                                    />
                                    <div>
                                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">PayMongo (Online Payment)</span>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">Card, GCash, Maya via PayMongo checkout</p>
                                    </div>
                                </label>
                            )}
                            {paymentProviders.xenditEnabled && (
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={settings.paymentMethods.xendit}
                                        onChange={e => updateSetting('paymentMethods', { ...settings.paymentMethods, xendit: e.target.checked })}
                                        className="w-4 h-4 rounded border-slate-300 text-[--color-primary-600] focus:ring-[--color-primary-500]"
                                    />
                                    <div>
                                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Xendit (Online Payment)</span>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">Card, GCash, Maya via Xendit checkout</p>
                                    </div>
                                </label>
                            )}
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={settings.paymentMethods.manualGcash}
                                    onChange={e => updateSetting('paymentMethods', { ...settings.paymentMethods, manualGcash: e.target.checked })}
                                    className="w-4 h-4 rounded border-slate-300 text-[--color-primary-600] focus:ring-[--color-primary-500]"
                                />
                                <div>
                                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Manual GCash</span>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">Customer sends to GCash number and submits reference</p>
                                </div>
                            </label>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">GCash Manual Payment Details</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <TextInput
                                label="GCash Number"
                                value={settings.gcashNumber}
                                onChange={v => updateSetting('gcashNumber', v)}
                                placeholder="09171234567"
                                info="Number customers send manual payment to"
                            />
                            <TextInput
                                label="GCash Account Name"
                                value={settings.gcashAccountName}
                                onChange={v => updateSetting('gcashAccountName', v)}
                                placeholder="Juan Dela Cruz"
                                info="Account name shown to customers"
                            />
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Store Banner</h3>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Banner Text</label>
                            <textarea
                                value={settings.storeBannerText}
                                onChange={e => updateSetting('storeBannerText', e.target.value)}
                                rows={2}
                                className="block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white focus:ring-1 focus:ring-[--color-primary-500] focus:border-[--color-primary-500]"
                                placeholder="e.g. Holiday Promo: 10% off all plans this week!"
                            />
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Leave empty to hide the banner</p>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'script' && (
                <div className="space-y-6">
                    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">MikroTik Walled Garden Script</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                            Copy and paste this script into your MikroTik router's terminal. The script uses your configured portal IP ({settings.portalServerIp || 'not set'}), port ({settings.portalServerPort}), and non-payment pool ({settings.nonPaymentPool}).
                        </p>
                        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-4 max-h-[600px] overflow-auto">
                            <CodeBlock script={generateMikrotikScript(settings)} />
                        </div>
                    </div>

                    <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                        <h4 className="font-semibold text-amber-800 dark:text-amber-200 mb-2">Setup Instructions</h4>
                        <ol className="list-decimal list-inside space-y-1 text-sm text-amber-700 dark:text-amber-300">
                            <li>Copy the script above</li>
                            <li>Open your MikroTik router terminal (Winbox or SSH)</li>
                            <li>Paste the script and press Enter</li>
                            <li>Enable "Walled Garden" and "Auto-Sync Worker" in the Expired Portal tab</li>
                            <li>Configure your PPPoE non-payment profile to assign IPs from <strong>{settings.nonPaymentPool || '172.16.44.0/24'}</strong></li>
                            <li>Set the expired client's "Profile on Expiry" to the non-payment profile in PPPoE settings</li>
                        </ol>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StoreSettingsPage;
