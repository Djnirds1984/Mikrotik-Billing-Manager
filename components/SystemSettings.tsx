
import React, { useState, useEffect } from 'react';
import type { PanelSettings, TelegramSettings, PayMongoSettings, FacebookMessengerSettings } from '../types.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { initializeAiClient } from '../services/geminiService.ts';
import { getPanelSettings, savePanelSettings, getAuthHeader, factoryReset } from '../services/databaseService.ts';
import { Loader } from './Loader.tsx';
import { KeyIcon, CogIcon } from '../constants.tsx';
import { WanSettingsPanel } from './WanSettingsPanel.tsx';

// --- Icon Components (kept local to this file) ---
const SunIcon: React.FC<{ className?: string }> = ({ className }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" /></svg>;
const MoonIcon: React.FC<{ className?: string }> = ({ className }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" /></svg>;
const ComputerDesktopIcon: React.FC<{ className?: string }> = ({ className }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z" /></svg>;
const MessageIcon: React.FC<{ className?: string }> = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.76 9.76 0 01-2.53-.405m-3.038-5.858a2.25 2.25 0 00-3.75-3.75C3.302 4.03 7.056 2.25 12 2.25c4.97 0 9 3.694 9 8.25z" /></svg>);
const PayMongoIcon: React.FC<{ className?: string }> = ({ className }) => (<svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" /></svg>);

const FacebookIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 2C6.477 2 2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.879V14.89h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.989C18.343 21.129 22 16.99 22 12c0-5.523-4.477-10-10-10z" />
    </svg>
);

const TabButton: React.FC<{
    label: string;
    icon: React.ReactNode;
    isActive: boolean;
    onClick: () => void;
}> = ({ label, icon, isActive, onClick }) => (
    <button
        onClick={onClick}
        className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors duration-200 focus:outline-none ${
            isActive
                ? 'border-[--color-primary-500] text-[--color-primary-500] dark:text-[--color-primary-400]'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
        }`}
    >
        {icon}
        <span className="hidden sm:inline">{label}</span>
    </button>
);

const ThemeSwitcher: React.FC = () => {
    const { theme, setTheme } = useTheme();
    const options = [
        { value: 'light', label: 'Light', icon: <SunIcon className="w-5 h-5" /> },
        { value: 'dark', label: 'Dark', icon: <MoonIcon className="w-5 h-5" /> },
        { value: 'system', label: 'System', icon: <ComputerDesktopIcon className="w-5 h-5" /> },
    ];
    return (
        <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Theme</label>
            <div className="mt-1 grid grid-cols-3 gap-2 rounded-lg bg-slate-100 dark:bg-slate-700 p-1">
                {options.map(option => (
                    <button
                        key={option.value}
                        onClick={() => setTheme(option.value as any)}
                        className={`flex items-center justify-center gap-2 w-full rounded-md py-2 px-3 text-sm font-medium transition-colors ${
                            theme === option.value
                                ? 'bg-white dark:bg-slate-900 text-[--color-primary-600] shadow-sm'
                                : 'text-slate-600 dark:text-slate-300 hover:bg-white/50 dark:hover:bg-slate-900/50'
                        }`}
                    >
                        {option.icon}
                        {option.label}
                    </button>
                ))}
            </div>
        </div>
    );
};

const TextInput: React.FC<{ label: string; name: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; type?: string; placeholder?: string; info?: string }> = ({ label, name, value, onChange, type = "text", placeholder, info }) => (
    <div>
        <label htmlFor={name} className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
        <input type={type} name={name} id={name} value={value || ''} onChange={onChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" placeholder={placeholder} />
        {info && <p className="mt-1 text-xs text-slate-500">{info}</p>}
    </div>
);

const Toggle: React.FC<{ label: string; checked: boolean; onChange: (checked: boolean) => void; info?: string }> = ({ label, checked, onChange, info }) => (
    <div>
        <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
            <div className="relative inline-flex items-center">
                <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only peer" />
                <div className="w-11 h-6 bg-slate-200 dark:bg-slate-600 rounded-full peer peer-focus:ring-2 peer-focus:ring-[--color-primary-500] peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[--color-primary-600]"></div>
            </div>
        </label>
        {info && <p className="mt-1 text-xs text-slate-500">{info}</p>}
    </div>
);

const SettingsSection: React.FC<{ title: string; children: React.ReactNode; }> = ({ title, children }) => (
    <div className="space-y-6">
        <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">{title}</h3>
        {children}
    </div>
);

const PanelTab: React.FC<{ settings: PanelSettings, setSettings: React.Dispatch<React.SetStateAction<PanelSettings>> }> = ({ settings, setSettings }) => {
    const [currentPassword, setCurrentPassword] = React.useState('');
    const [newPassword, setNewPassword] = React.useState('');
    const [confirmPassword, setConfirmPassword] = React.useState('');
    const [isSavingPassword, setIsSavingPassword] = React.useState(false);
    const [passwordError, setPasswordError] = React.useState<string | null>(null);
    const [passwordSuccess, setPasswordSuccess] = React.useState<string | null>(null);
    const [isResetting, setIsResetting] = React.useState(false);
    const { logout } = useAuth();

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
        setIsSavingPassword(true);
        try {
            const res = await fetch('/api/auth/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                body: JSON.stringify({ currentPassword, newPassword })
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || 'Failed to update password.');
            }
            setPasswordSuccess('Password updated. Logging out...');
            setTimeout(() => {
                logout();
            }, 1500);
        } catch (err) {
            setPasswordError((err as Error).message);
        } finally {
            setIsSavingPassword(false);
        }
    };

    const handleFactoryReset = async () => {
        // Triple confirmation for safety
        const firstConfirm = window.confirm(
            '⚠️ WARNING: FACTORY RESET\n\n' +
            'This will DELETE ALL DATA including:\n' +
            '• All user accounts\n' +
            '• All customers\n' +
            '• All routers\n' +
            '• All sales records\n' +
            '• All settings\n' +
            '• All uploaded files\n\n' +
            '✓ GOOD NEWS: Your system license is stored in the cloud and will be automatically restored after reset.\n\n' +
            'This action CANNOT be undone!\n\n' +
            'Are you sure you want to continue?'
        );
        
        if (!firstConfirm) return;
        
        const secondConfirm = window.confirm(
            'FINAL WARNING\n\n' +
            'You are about to perform a FACTORY RESET.\n' +
            'The system will restart and return to the first-time setup page.\n' +
            'Your license will be automatically restored from the cloud.\n\n' +
            'Click OK to proceed, or Cancel to abort.'
        );
        
        if (!secondConfirm) return;
        
        const thirdConfirm = window.prompt(
            'Type "RESET" in the box below to confirm factory reset:'
        );
        
        if (thirdConfirm !== 'RESET') {
            alert('Factory reset cancelled. Type "RESET" exactly to confirm.');
            return;
        }
        
        setIsResetting(true);
        try {
            const result = await factoryReset();
            if (result.success) {
                alert('Factory reset completed! The system is restarting...\n\nYour license will be automatically restored from the cloud when the system restarts.');
                // Clear local storage and redirect to registration
                localStorage.clear();
                sessionStorage.clear();
                // Wait a moment for server to restart, then reload
                setTimeout(() => {
                    window.location.href = '/register';
                }, 2000);
            } else {
                alert('Factory reset failed: ' + result.message);
            }
        } catch (err) {
            alert('Factory reset error: ' + (err as Error).message);
        } finally {
            setIsResetting(false);
        }
    };

    return (
        <>
            <SettingsSection title="Panel Appearance">
                <ThemeSwitcher />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="language" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Language</label>
                        <select id="language" value={settings.language} onChange={e => setSettings(s => ({...s, language: e.target.value as PanelSettings['language']}))} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white">
                            <option value="en">English</option>
                            <option value="fil">Filipino</option>
                            <option value="es">Español (Spanish)</option>
                            <option value="pt">Português (Portuguese)</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="currency" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Currency</label>
                        <select id="currency" value={settings.currency} onChange={e => setSettings(s => ({...s, currency: e.target.value as PanelSettings['currency']}))} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white">
                            <option value="USD">USD ($)</option>
                            <option value="PHP">PHP (₱)</option>
                            <option value="EUR">EUR (€)</option>
                            <option value="BRL">BRL (R$)</option>
                        </select>
                    </div>
                </div>
            </SettingsSection>

            <SettingsSection title="Admin Password">
                {passwordError && <div className="p-3 mb-4 rounded-md bg-red-100 text-red-800">{passwordError}</div>}
                {passwordSuccess && <div className="p-3 mb-4 rounded-md bg-green-100 text-green-800">{passwordSuccess}</div>}
                <form onSubmit={handlePasswordChange} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Current Password</label>
                        <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">New Password</label>
                        <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Confirm New Password</label>
                        <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" required />
                    </div>
                    <div className="flex justify-end">
                        <button type="submit" disabled={isSavingPassword} className="px-6 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-semibold rounded-lg disabled:opacity-50">
                            {isSavingPassword ? 'Saving...' : 'Save Password'}
                        </button>
                    </div>
                </form>
            </SettingsSection>

            <SettingsSection title="Factory Reset">
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                        <svg className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                        </svg>
                        <div className="flex-1">
                            <h4 className="text-sm font-semibold text-red-800 dark:text-red-300 mb-2">Danger Zone</h4>
                            <p className="text-sm text-red-700 dark:text-red-400 mb-4">
                                Factory reset will permanently delete ALL data and return the system to its initial state. 
                                This includes all user accounts, customers, routers, sales records, settings, and uploaded files.
                                <strong className="block mt-1">This action cannot be undone!</strong>
                            </p>
                            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-4">
                                <p className="text-sm text-blue-700 dark:text-blue-400">
                                    <strong>ℹ️ License Recovery:</strong> Your system license is safely stored in the cloud. 
                                    After factory reset, your license will be automatically restored when you access the system again.
                                </p>
                            </div>
                            <button
                                onClick={handleFactoryReset}
                                disabled={isResetting}
                                className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg disabled:opacity-50 flex items-center gap-2"
                            >
                                {isResetting && <Loader />}
                                {isResetting ? 'Resetting...' : '⚠️ Factory Reset'}
                            </button>
                        </div>
                    </div>
                </div>
            </SettingsSection>
        </>
    );
};

const AiTab: React.FC<{ settings: PanelSettings, setSettings: React.Dispatch<React.SetStateAction<PanelSettings>> }> = ({ settings, setSettings }) => (
    <SettingsSection title="AI Settings">
        <TextInput 
            label="Google Gemini API Key" 
            name="geminiApiKey" 
            type="password"
            value={settings.geminiApiKey || ''}
            onChange={e => setSettings(s => ({ ...s, geminiApiKey: e.target.value }))}
            info="Your key is stored securely in the panel's database."
        />
    </SettingsSection>
);

const TelegramTab: React.FC<{ settings: PanelSettings, setSettings: React.Dispatch<React.SetStateAction<PanelSettings>>, onTest: (token: string, id: string) => void, isTesting: boolean }> = ({ settings, setSettings, onTest, isTesting }) => {
    const telegram = settings.telegramSettings || {} as TelegramSettings;
    const update = (field: keyof TelegramSettings, value: any) => {
        setSettings(s => ({ ...s, telegramSettings: { ...s.telegramSettings, [field]: value } as TelegramSettings }));
    };

    return (
        <SettingsSection title="Telegram Notifications">
            <Toggle label="Enable Telegram Notifications" checked={telegram.enabled || false} onChange={c => update('enabled', c)} />
            <div className={`space-y-4 ${!telegram.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
                <TextInput label="Bot Token" name="botToken" value={telegram.botToken || ''} onChange={e => update('botToken', e.target.value)} type="password" />
                <TextInput label="Chat ID" name="chatId" value={telegram.chatId || ''} onChange={e => update('chatId', e.target.value)} />
                <button onClick={() => onTest(telegram.botToken, telegram.chatId)} disabled={isTesting || !telegram.botToken || !telegram.chatId} className="px-4 py-2 bg-sky-600 text-white rounded-md disabled:opacity-50">
                    {isTesting ? 'Sending...' : 'Send Test Message'}
                </button>
                <div className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
                    <h4 className="font-semibold">Event Triggers</h4>
                    <Toggle label="Client Due Date" checked={telegram.enableClientDueDate || false} onChange={c => update('enableClientDueDate', c)} info="Notify when a client's subscription is about to expire or has expired." />
                    <Toggle label="Client Disconnected" checked={telegram.enableClientDisconnected || false} onChange={c => update('enableClientDisconnected', c)} info="Notify when a user is disabled/disconnected due to expiry." />
                    <Toggle label="Interface Disconnected" checked={telegram.enableInterfaceDisconnected || false} onChange={c => update('enableInterfaceDisconnected', c)} info="Notify when a monitored WAN interface goes down." />
                    <Toggle label="User Paid" checked={telegram.enableUserPaid || false} onChange={c => update('enableUserPaid', c)} info="Notify when a payment is processed through the panel." />
                </div>
            </div>
        </SettingsSection>
    );
};

const PayMongoTab: React.FC<{ settings: PanelSettings, setSettings: React.Dispatch<React.SetStateAction<PanelSettings>> }> = ({ settings, setSettings }) => {
    const paymongo = settings.paymongoSettings || {} as PayMongoSettings;
    const update = (field: keyof PayMongoSettings, value: any) => {
        setSettings(s => ({ ...s, paymongoSettings: { ...s.paymongoSettings, [field]: value } as PayMongoSettings }));
    };

    // Webhook diagnostics state
    const [webhookStatus, setWebhookStatus] = useState<{
        configured: boolean;
        webhooks: Array<{ id: string; url: string; events: string[]; status: string; createdAt: string | null }>;
        expectedUrl: string;
        webhookSecretStored: boolean;
        message: string;
    } | null>(null);
    const [isCheckingStatus, setIsCheckingStatus] = useState(false);
    const [isReregistering, setIsReregistering] = useState(false);
    const [isTestingWebhook, setIsTestingWebhook] = useState(false);
    const [isDisablingWebhook, setIsDisablingWebhook] = useState<string | null>(null);
    const [webhookToast, setWebhookToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const showWebhookToast = (type: 'success' | 'error', message: string) => {
        setWebhookToast({ type, message });
        setTimeout(() => setWebhookToast(null), 5000);
    };

    const handleCheckStatus = async () => {
        setIsCheckingStatus(true);
        try {
            const res = await fetch('/api/paymongo-webhook-status', {
                headers: { ...getAuthHeader() }
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to fetch webhook status.');
            setWebhookStatus(data);
        } catch (err) {
            showWebhookToast('error', `Status check failed: ${(err as Error).message}`);
        } finally {
            setIsCheckingStatus(false);
        }
    };

    const handleReregister = async () => {
        if (!confirm('This will re-register your PayMongo webhook. Any existing webhook with a different URL will be replaced. Continue?')) return;
        setIsReregistering(true);
        try {
            const res = await fetch('/api/paymongo-webhook-reregister', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeader() }
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || 'Re-registration failed.');
            showWebhookToast('success', data.message || 'Webhook re-registered successfully.');
            // Refresh status after re-register
            await handleCheckStatus();
        } catch (err) {
            showWebhookToast('error', `Re-register failed: ${(err as Error).message}`);
        } finally {
            setIsReregistering(false);
        }
    };

    const handleTestWebhook = async () => {
        setIsTestingWebhook(true);
        try {
            const res = await fetch('/api/paymongo-webhook-ping');
            if (res.ok) {
                const data = await res.json();
                if (data.status === 'ok') {
                    showWebhookToast('success', 'Endpoint reachable — PayMongo can send events to this server.');
                } else {
                    showWebhookToast('error', `Endpoint not reachable: unexpected response.`);
                }
            } else {
                showWebhookToast('error', `Endpoint not reachable: HTTP ${res.status}.`);
            }
        } catch (err) {
            showWebhookToast('error', `Endpoint not reachable: ${(err as Error).message}`);
        } finally {
            setIsTestingWebhook(false);
        }
    };

    const handleDisableWebhook = async (webhookId: string) => {
        if (!confirm('Disable this webhook? It will no longer receive PayMongo events.')) return;
        setIsDisablingWebhook(webhookId);
        try {
            const res = await fetch('/api/paymongo-webhook-disable', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                body: JSON.stringify({ webhookId })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || 'Disable failed.');
            showWebhookToast('success', data.message || 'Webhook disabled successfully.');
            await handleCheckStatus();
        } catch (err) {
            showWebhookToast('error', `Disable failed: ${(err as Error).message}`);
        } finally {
            setIsDisablingWebhook(null);
        }
    };

    const getHealthColor = () => {
        if (!webhookStatus || !webhookStatus.configured) return 'gray';
        if (webhookStatus.webhooks.length === 0) return 'red';
        const wh = webhookStatus.webhooks[0];
        const urlMatches = wh.url === webhookStatus.expectedUrl;
        const hasEvents = wh.events && wh.events.length > 0;
        const isEnabled = wh.status === 'enabled';
        if (urlMatches && hasEvents && isEnabled) return 'green';
        if (wh.url || hasEvents) return 'yellow';
        return 'red';
    };

    const healthColor = getHealthColor();

    return (
        <SettingsSection title="PayMongo Payment Gateway">
            {/* Test Mode Warning */}
            {(paymongo.publicKey?.includes('_test_') || paymongo.secretKey?.includes('_test_')) && (
                <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border-2 border-red-500 rounded-lg">
                    <div className="flex items-start gap-3">
                        <span className="text-2xl">⚠️</span>
                        <div>
                            <h4 className="font-bold text-red-800 dark:text-red-300 text-lg">TEST MODE DETECTED</h4>
                            <p className="text-sm text-red-700 dark:text-red-400 mt-1">
                                You are using <strong>TEST API KEYS</strong>. All payments will be <strong>SIMULATED</strong> and no real money will be processed.
                            </p>
                            <p className="text-sm text-red-700 dark:text-red-400 mt-2">
                                To accept <strong>REAL PAYMENTS</strong>, you must use <strong>LIVE API KEYS</strong> from your PayMongo dashboard:
                            </p>
                            <ul className="text-xs text-red-600 dark:text-red-500 mt-2 list-disc list-inside space-y-1">
                                <li>Live Public Key starts with: <code className="bg-red-100 dark:bg-red-900 px-2 rounded">pk_live_...</code></li>
                                <li>Live Secret Key starts with: <code className="bg-red-100 dark:bg-red-900 px-2 rounded">sk_live_...</code></li>
                            </ul>
                            <p className="text-xs text-red-600 dark:text-red-500 mt-2 font-semibold">
                                🚨 DANGER: Test mode shows "SIMULATED PAYMENT" banner to customers and cannot process real transactions!
                            </p>
                        </div>
                    </div>
                </div>
            )}
            
            <Toggle label="Enable PayMongo Payments" checked={paymongo.enabled || false} onChange={c => update('enabled', c)} />
            <div className={`space-y-4 ${!paymongo.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
                <TextInput label="Public Key" name="publicKey" value={paymongo.publicKey || ''} onChange={e => update('publicKey', e.target.value)} type="password" />
                <TextInput label="Secret Key" name="secretKey" value={paymongo.secretKey || ''} onChange={e => update('secretKey', e.target.value)} type="password" />
                <TextInput label="Webhook Secret" name="webhookSecret" value={paymongo.webhookSecret || ''} onChange={e => update('webhookSecret', e.target.value)} type="password" />
                <TextInput label="Webhook URL" name="webhookUrl" value={paymongo.webhookUrl || ''} onChange={e => update('webhookUrl', e.target.value)} placeholder="https://yourdomain.com/api/paymongo-webhook" />
                <p className="text-xs text-slate-500 dark:text-slate-400 -mt-2">Full URL where PayMongo will send payment events (e.g., https://yourdomain.com/api/paymongo-webhook)</p>
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                    <Toggle
                        label="Pass Convenience Fee to Customer"
                        checked={paymongo.passFeesToCustomer || false}
                        onChange={c => update('passFeesToCustomer', c)}
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        When ON: customers pay an extra convenience fee so you receive 100% of the plan price.
                        When OFF: you absorb the PayMongo gateway fee from the plan price.
                    </p>
                </div>

                {/* Payment Methods Selection */}
                <div className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
                    <h4 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">Available Payment Methods</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 -mt-2">Select which payment methods to offer customers</p>
                    
                    <div className="grid grid-cols-2 gap-3">
                        {[
                            { id: 'qrph', label: 'QRPH (QR Code)', icon: '📱' },
                            { id: 'gcash', label: 'GCash', icon: '💙' },
                            { id: 'paymaya', label: 'PayMaya', icon: '💜' },
                            { id: 'grab_pay', label: 'GrabPay', icon: '💚' },
                            { id: 'card', label: 'Credit/Debit Card', icon: '💳' },
                            { id: 'dob', label: 'DOB (Bank Transfer)', icon: '🏦' },
                            { id: 'brankas', label: 'Brankas (Online Banking)', icon: '🏛️' },
                            { id: 'seven_eleven', label: '7-Eleven (Cash)', icon: '🏪' },
                            { id: 'rd_pawnshop', label: 'RD Pawnshop', icon: '🏪' },
                            { id: 'countryside', label: 'Countryside Bank', icon: '🏦' },
                        ].map(method => {
                            const methods = paymongo.paymentMethods || ['qrph'];
                            const isChecked = methods.includes(method.id);
                            return (
                                <label
                                    key={method.id}
                                    className="flex items-center gap-2 p-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors"
                                >
                                    <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={(e) => {
                                            const currentMethods = paymongo.paymentMethods || ['qrph'];
                                            const newMethods = e.target.checked
                                                ? [...currentMethods, method.id]
                                                : currentMethods.filter(m => m !== method.id);
                                            update('paymentMethods', newMethods);
                                        }}
                                        className="w-4 h-4 text-sky-600 rounded focus:ring-sky-500"
                                    />
                                    <span className="text-lg">{method.icon}</span>
                                    <span className="text-sm text-slate-700 dark:text-slate-300">{method.label}</span>
                                </label>
                            );
                        })}
                    </div>
                    
                    {(paymongo.paymentMethods || ['qrph']).length === 0 && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                            ⚠️ At least one payment method must be selected
                        </p>
                    )}
                </div>

                {/* Webhook Diagnostics Section */}
                <div className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-4">
                    <h4 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        Webhook Diagnostics
                        {webhookStatus && (
                            <span className={`inline-block w-3 h-3 rounded-full ${
                                healthColor === 'green' ? 'bg-green-500' :
                                healthColor === 'yellow' ? 'bg-yellow-500' :
                                healthColor === 'red' ? 'bg-red-500' :
                                'bg-slate-400'
                            }`} title={`Health: ${healthColor}`} />
                        )}
                    </h4>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={handleCheckStatus}
                            disabled={isCheckingStatus || !paymongo.secretKey}
                            className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isCheckingStatus ? 'Checking...' : 'Check Status'}
                        </button>
                        <button
                            onClick={handleReregister}
                            disabled={isReregistering || !paymongo.secretKey}
                            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isReregistering ? 'Registering...' : 'Re-register Webhook'}
                        </button>
                        <button
                            onClick={handleTestWebhook}
                            disabled={isTestingWebhook}
                            className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isTestingWebhook ? 'Testing...' : 'Test Webhook'}
                        </button>
                    </div>

                    {/* Toast Notification */}
                    {webhookToast && (
                        <div className={`p-3 rounded-md text-sm ${
                            webhookToast.type === 'success'
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
                                : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
                        }`}>
                            {webhookToast.message}
                        </div>
                    )}

                    {/* Webhook Status Display */}
                    {webhookStatus && (
                        <div className="space-y-3">
                            {!webhookStatus.configured ? (
                                <div className="p-3 rounded-md bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 text-sm">
                                    {webhookStatus.message}
                                </div>
                            ) : webhookStatus.webhooks.length === 0 ? (
                                <div className="p-3 rounded-md bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 text-sm">
                                    No webhooks registered. Click "Re-register Webhook" to create one.
                                </div>
                            ) : (
                                webhookStatus.webhooks.map((wh, idx) => {
                                    const urlMatches = wh.url === webhookStatus.expectedUrl;
                                    const isEnabled = wh.status === 'enabled';
                                    const isDisabled = wh.status === 'disabled';
                                    const isLocalUrl = /localhost|127\.0\.0\.1/.test(wh.url);
                                    return (
                                        <div key={wh.id || idx} className={`border rounded-lg p-4 space-y-2 ${
                                            isDisabled
                                                ? 'border-slate-200 dark:border-slate-700 opacity-50'
                                                : 'border-slate-200 dark:border-slate-700'
                                        }`}>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${
                                                        isEnabled ? 'bg-green-500' : 'bg-slate-400'
                                                    }`} />
                                                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                                        Webhook {idx + 1} — {isEnabled ? 'Enabled' : <span className="text-slate-500 dark:text-slate-400">Disabled</span>}
                                                    </span>
                                                </div>
                                                {!isDisabled && !urlMatches && (
                                                    <button
                                                        onClick={() => handleDisableWebhook(wh.id)}
                                                        disabled={isDisablingWebhook === wh.id}
                                                        className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {isDisablingWebhook === wh.id ? 'Disabling...' : 'Disable'}
                                                    </button>
                                                )}
                                            </div>
                                            {isLocalUrl && isEnabled && (
                                                <div className="flex items-center gap-1.5 p-2 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs">
                                                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                                                    <span><strong>Warning:</strong> This webhook URL uses localhost/127.0.0.1 — PayMongo cannot reach local addresses. Use a public domain or tunnel (e.g., Cloudflare Tunnel, ngrok).</span>
                                                </div>
                                            )}
                                            <div className="grid grid-cols-1 gap-2 text-sm">
                                                <div>
                                                    <span className="text-slate-500 dark:text-slate-400">URL: </span>
                                                    <span className={`font-mono text-xs break-all ${
                                                        urlMatches ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
                                                    }`}>
                                                        {wh.url || '(empty)'}
                                                    </span>
                                                    {!urlMatches && (
                                                        <span className="ml-2 text-xs text-red-600 dark:text-red-400 font-medium">(URL mismatch)</span>
                                                    )}
                                                </div>
                                                <div>
                                                    <span className="text-slate-500 dark:text-slate-400">Events: </span>
                                                    <span className="font-mono text-xs">
                                                        {wh.events.length > 0 ? wh.events.join(', ') : '(none)'}
                                                    </span>
                                                </div>
                                                <div>
                                                    <span className="text-slate-500 dark:text-slate-400">Created: </span>
                                                    <span className="text-xs">{wh.createdAt ? new Date(wh.createdAt).toLocaleString() : 'Unknown'}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}

                            {/* Expected URL */}
                            {webhookStatus.configured && (
                                <div className="text-sm">
                                    <span className="text-slate-500 dark:text-slate-400">Expected URL: </span>
                                    <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{webhookStatus.expectedUrl}</span>
                                </div>
                            )}

                            {/* Webhook Secret Status */}
                            <div className="text-sm flex items-center gap-2">
                                <span className={`inline-block w-2.5 h-2.5 rounded-full ${
                                    webhookStatus.webhookSecretStored ? 'bg-green-500' : 'bg-red-500'
                                }`} />
                                <span className="text-slate-500 dark:text-slate-400">Webhook Secret: </span>
                                <span className={webhookStatus.webhookSecretStored ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
                                    {webhookStatus.webhookSecretStored ? 'Stored locally' : 'Not stored — enter it in the Webhook Secret field above'}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Hint when no status checked yet */}
                    {!webhookStatus && paymongo.enabled && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            {!paymongo.webhookUrl
                                ? 'Set the Webhook URL above, then click "Check Status" to verify your PayMongo webhook configuration.'
                                : 'Click "Check Status" to verify your PayMongo webhook configuration.'
                            }
                        </p>
                    )}
                </div>
            </div>
        </SettingsSection>
    );
};

const FacebookMessengerTab: React.FC<{ settings: PanelSettings, setSettings: React.Dispatch<React.SetStateAction<PanelSettings>> }> = ({ settings, setSettings }) => {
    const facebook = settings.facebookSettings || {} as FacebookMessengerSettings;
    const update = (field: keyof FacebookMessengerSettings, value: any) => {
        setSettings(s => ({ ...s, facebookSettings: { ...s.facebookSettings, [field]: value } as FacebookMessengerSettings }));
    };

    const [isTesting, setIsTesting] = useState(false);
    const [testMessage, setTestMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [isValidating, setIsValidating] = useState(false);

    const handleGenerateToken = () => {
        const randomToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        update('verifyToken', randomToken);
    };

    const handleTestConnection = async () => {
        if (!facebook.pageAccessToken) {
            setTestMessage({ type: 'error', text: 'Please enter a Page Access Token first.' });
            return;
        }

        setIsTesting(true);
        setTestMessage(null);
        try {
            const res = await fetch('/api/facebook-test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                body: JSON.stringify({
                    pageAccessToken: facebook.pageAccessToken,
                    recipientId: facebook.pageId || ''
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.message || 'Test failed');
            }
            setTestMessage({ type: 'success', text: data.message });
        } catch (err) {
            setTestMessage({ type: 'error', text: `Test failed: ${(err as Error).message}` });
        } finally {
            setIsTesting(false);
        }
    };

    const callbackUrl = `${window.location.origin}/api/facebook-webhook`;

    const handleCopyUrl = async () => {
        try {
            await navigator.clipboard.writeText(callbackUrl);
            setTestMessage({ type: 'success', text: 'Callback URL copied to clipboard!' });
            setTimeout(() => setTestMessage(null), 3000);
        } catch (err) {
            setTestMessage({ type: 'error', text: 'Failed to copy URL' });
        }
    };

    const handleValidateConfig = async () => {
        setIsValidating(true);
        setTestMessage(null);
        try {
            const res = await fetch('/api/facebook-validate', {
                headers: { ...getAuthHeader() }
            });
            const data = await res.json();
            
            if (data.valid) {
                setTestMessage({ type: 'success', text: '✅ Configuration looks good! All required fields are set.' });
            } else {
                const issuesText = data.issues.join('\n');
                const warningsText = data.warnings.length > 0 ? '\n\nWarnings:\n' + data.warnings.join('\n') : '';
                setTestMessage({ type: 'error', text: `❌ Issues found:\n${issuesText}${warningsText}` });
            }
        } catch (err) {
            setTestMessage({ type: 'error', text: `Validation failed: ${(err as Error).message}` });
        } finally {
            setIsValidating(false);
        }
    };

    return (
        <SettingsSection title="Facebook Messenger Bot">
            <Toggle label="Enable Facebook Messenger" checked={facebook.enabled || false} onChange={c => update('enabled', c)} />
            <div className={`space-y-4 ${!facebook.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
                
                {/* Callback URL (Read-Only with Copy) */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Callback URL</label>
                    <div className="mt-1 flex gap-2">
                        <input
                            type="text"
                            readOnly
                            value={callbackUrl}
                            className="flex-1 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white cursor-not-allowed"
                        />
                        <button
                            onClick={handleCopyUrl}
                            className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-md text-sm font-medium whitespace-nowrap"
                        >
                            Copy
                        </button>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Use this URL when configuring your Facebook App Webhook</p>
                </div>

                {/* Verify Token with Generate Button */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Verify Token</label>
                    <div className="mt-1 flex gap-2">
                        <input
                            type="text"
                            value={facebook.verifyToken || ''}
                            onChange={e => update('verifyToken', e.target.value)}
                            className="flex-1 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                            placeholder="Enter or generate a verification token"
                        />
                        <button
                            onClick={handleGenerateToken}
                            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-sm font-medium whitespace-nowrap"
                        >
                            Generate
                        </button>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">This token must match what you enter in Facebook's webhook configuration</p>
                </div>

                {/* Router ID - IMPORTANT for multi-router isolation */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                        Router ID <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={facebook.routerId || ''}
                        onChange={e => update('routerId', e.target.value)}
                        className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                        placeholder="router_xxxxxxxxxx_xxxxxxx (from Routers page)"
                    />
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400 font-semibold">
                        ⚠️ CRITICAL: This isolates Facebook Bot to YOUR router only. Customers from other routers won't be accessible.
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Find this in the Routers page → Copy the ID of this router
                    </p>
                </div>

                {/* Facebook Page ID */}
                <TextInput 
                    label="Facebook Page ID" 
                    name="pageId" 
                    value={facebook.pageId || ''} 
                    onChange={e => update('pageId', e.target.value)} 
                    placeholder="Your Facebook Page ID"
                    info="Find this in your Facebook Page settings"
                />

                {/* Page Access Token */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Page Access Token</label>
                    <textarea
                        value={facebook.pageAccessToken || ''}
                        onChange={e => update('pageAccessToken', e.target.value)}
                        className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                        placeholder="EAAG... (long token from Facebook developers)"
                        rows={3}
                    />
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Generate this from Facebook Developers Console with pages_messaging permission</p>
                </div>

                {/* Test Connection Button */}
                <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                    <div className="flex gap-3">
                        <button 
                            onClick={handleValidateConfig} 
                            disabled={isValidating}
                            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isValidating ? 'Validating...' : 'Validate Configuration'}
                        </button>
                        <button 
                            onClick={handleTestConnection} 
                            disabled={isTesting || !facebook.pageAccessToken} 
                            className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isTesting ? 'Validating...' : 'Validate Token'}
                        </button>
                    </div>
                    
                    {/* Test Result Message */}
                    {testMessage && (
                        <div className={`mt-3 p-3 rounded-md text-sm whitespace-pre-line ${
                            testMessage.type === 'success'
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
                                : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
                        }`}>
                            {testMessage.text}
                        </div>
                    )}
                </div>
            </div>
        </SettingsSection>
    );
};

const GlobeIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 2c2.21 0 4.21.896 5.656 2.344A8 8 0 0112 20a8 8 0 01-5.656-13.656A7.976 7.976 0 0112 4zm0 2c-1.657 0-3 3.134-3 6s1.343 6 3 6 3-3.134 3-6-1.343-6-3-6zm-8 6c0-.69.111-1.353.316-1.972A9.964 9.964 0 004 12c0 .69.111 1.353.316 1.972A9.964 9.964 0 004 12zm16 0c0-.69-.111-1.353-.316-1.972.205.619.316 1.282.316 1.972 0 .69-.111 1.353-.316 1.972.205-.619.316-1.282.316-1.972z"/>
    </svg>
);

const LandingPageTab: React.FC<{ settings: PanelSettings, setSettings: React.Dispatch<React.SetStateAction<PanelSettings>> }> = ({ settings, setSettings }) => {
    const cfg = settings.landingPageConfig || {};
    const templates = [
        {
            id: 'classic',
            name: 'Classic',
            theme: { primary500: '#f97316', primary600: '#ea580c', primary700: '#c2410c', accent: '#0ea5e9', background: '#ffffff' },
            config: {
                webTitle: 'ISP Panel',
                heroBadge: 'Reliable Internet',
                heroTitle: 'Fast and Affordable Plans',
                heroSubtitle: 'Connect your home or business today',
                heroCtaLabel: 'Get Started',
                heroLoginPrompt: 'Already a customer?',
                heroLoginLabel: 'Client Portal',
                navAdminLabel: 'Admin Login',
                navClientPortalLabel: 'Client Portal',
                pages: [{ id: 'features', label: 'Features' }, { id: 'plans', label: 'Plans' }, { id: 'contact', label: 'Contact' }],
                features: [{ title: 'Stable Connection', description: 'Consistent speeds with low latency.' }, { title: '24/7 Support', description: 'We are here when you need us.' }],
                plansTitle: 'Popular Plans',
                plans: [{ name: 'Basic', speedText: '50 Mbps', priceText: '₱999', ctaLabel: 'Inquire' }, { name: 'Premium', speedText: '150 Mbps', priceText: '₱1,499', ctaLabel: 'Inquire' }],
                productCards: [],
                footerLinks: [{ label: 'Email', href: 'mailto:' }],
                contactTitle: 'Contact Us',
                contactEmail: '',
                contactPhone: '',
                contactAddress: '',
                contactFacebookUrl: ''
            }
        },
        {
            id: 'modern',
            name: 'Modern',
            theme: { primary500: '#6366f1', primary600: '#4f46e5', primary700: '#4338ca', accent: '#22d3ee', background: '#ffffff' },
            config: {
                webTitle: 'Modern ISP',
                heroBadge: 'Fiber Ready',
                heroTitle: 'Experience Next-Gen Internet',
                heroSubtitle: 'Ultra-fast fiber plans',
                heroCtaLabel: 'View Plans',
                heroLoginPrompt: 'Manage your account',
                heroLoginLabel: 'Login',
                navAdminLabel: 'Admin Login',
                navClientPortalLabel: 'Client Portal',
                pages: [{ id: 'plans', label: 'Plans' }, { id: 'contact', label: 'Contact' }],
                features: [{ title: 'Unlimited Data', description: 'No data caps.' }, { title: 'Fiber Backbone', description: 'High reliability.' }],
                plansTitle: 'Fiber Plans',
                plans: [{ name: 'Fiber 100', speedText: '100 Mbps', priceText: '₱1,299', ctaLabel: 'Inquire' }, { name: 'Fiber 300', speedText: '300 Mbps', priceText: '₱2,499', ctaLabel: 'Inquire' }],
                productCards: [],
                footerLinks: [{ label: 'Support', href: '#' }],
                contactTitle: 'Get Support',
                contactEmail: '',
                contactPhone: '',
                contactAddress: '',
                contactFacebookUrl: ''
            }
        },
        {
            id: 'business',
            name: 'Business',
            theme: { primary500: '#10b981', primary600: '#059669', primary700: '#047857', accent: '#f59e0b', background: '#ffffff' },
            config: {
                webTitle: 'Business Connectivity',
                heroBadge: 'SME Solutions',
                heroTitle: 'Scale With Reliable Internet',
                heroSubtitle: 'Flexible plans for growing teams',
                heroCtaLabel: 'Contact Sales',
                heroLoginPrompt: 'Existing clients',
                heroLoginLabel: 'Portal',
                navAdminLabel: 'Admin Login',
                navClientPortalLabel: 'Client Portal',
                pages: [{ id: 'features', label: 'Features' }, { id: 'plans', label: 'Plans' }],
                features: [{ title: 'SLA', description: 'Uptime guarantees.' }, { title: 'Priority Support', description: 'Dedicated support line.' }],
                plansTitle: 'Business Plans',
                plans: [{ name: 'SME 50', speedText: '50 Mbps', priceText: '₱2,999', ctaLabel: 'Inquire' }, { name: 'Enterprise 200', speedText: '200 Mbps', priceText: '₱9,999', ctaLabel: 'Inquire' }],
                productCards: [],
                footerLinks: [{ label: 'Facebook', href: '#' }],
                contactTitle: 'Talk To Us',
                contactEmail: '',
                contactPhone: '',
                contactAddress: '',
                contactFacebookUrl: ''
            }
        },
        {
            id: 'minimal',
            name: 'Minimal',
            theme: { primary500: '#0ea5e9', primary600: '#0284c7', primary700: '#0369a1', accent: '#14b8a6', background: '#ffffff' },
            config: {
                webTitle: 'Simple ISP',
                heroBadge: 'Simple & Fast',
                heroTitle: 'Internet Made Easy',
                heroSubtitle: 'No-frills plans',
                heroCtaLabel: 'Inquire',
                heroLoginPrompt: 'Account',
                heroLoginLabel: 'Login',
                navAdminLabel: 'Admin',
                navClientPortalLabel: 'Portal',
                pages: [{ id: 'plans', label: 'Plans' }],
                features: [{ title: 'Straightforward', description: 'Clear pricing.' }],
                plansTitle: 'Plans',
                plans: [{ name: 'Home 30', speedText: '30 Mbps', priceText: '₱799', ctaLabel: 'Inquire' }],
                productCards: [],
                footerLinks: [{ label: 'Email', href: 'mailto:' }],
                contactTitle: 'Contact',
                contactEmail: '',
                contactPhone: '',
                contactAddress: '',
                contactFacebookUrl: ''
            }
        },
        {
            id: 'dark',
            name: 'Dark',
            theme: { primary500: '#f59e0b', primary600: '#d97706', primary700: '#b45309', accent: '#22c55e', background: '#0f172a' },
            config: {
                webTitle: 'Dark ISP',
                heroBadge: 'Performance',
                heroTitle: 'Powerful Connectivity',
                heroSubtitle: 'Built for performance users',
                heroCtaLabel: 'Start',
                heroLoginPrompt: 'Have an account?',
                heroLoginLabel: 'Login',
                navAdminLabel: 'Admin',
                navClientPortalLabel: 'Portal',
                pages: [{ id: 'features', label: 'Features' }, { id: 'plans', label: 'Plans' }, { id: 'contact', label: 'Contact' }],
                features: [{ title: 'Low Latency', description: 'Optimized routes.' }],
                plansTitle: 'Performance Plans',
                plans: [{ name: 'Pro 200', speedText: '200 Mbps', priceText: '₱3,499', ctaLabel: 'Inquire' }],
                productCards: [],
                footerLinks: [{ label: 'Email', href: 'mailto:' }],
                contactTitle: 'Reach Us',
                contactEmail: '',
                contactPhone: '',
                contactAddress: '',
                contactFacebookUrl: ''
            }
        }
    ];
    const markCustom = () => {
        if (cfg.templateId && cfg.templateId !== 'custom') {
            setSettings(s => ({
                ...s,
                landingPageConfig: {
                    ...(s.landingPageConfig || {}),
                    templateId: 'custom',
                    templateName: (cfg.templateName ? cfg.templateName : '') || `Custom`
                }
            }));
        }
    };
    const updateCfg = (key: keyof NonNullable<PanelSettings['landingPageConfig']>, value: any) => {
        markCustom();
        setSettings(s => ({ ...s, landingPageConfig: { ...(s.landingPageConfig || {}), [key]: value } }));
    };
    const updateArrayItem = <T extends any[]>(key: keyof NonNullable<PanelSettings['landingPageConfig']>, index: number, field: string, value: any) => {
        const arr = ((cfg as any)[key] as T) || ([] as unknown as T);
        const next = arr.map((it: any, i: number) => i === index ? { ...it, [field]: value } : it);
        markCustom();
        updateCfg(key, next);
    };
    const addArrayItem = (key: keyof NonNullable<PanelSettings['landingPageConfig']>, item: any) => {
        const arr = ((cfg as any)[key] as any[]) || [];
        markCustom();
        updateCfg(key, [...arr, item]);
    };
    const removeArrayItem = (key: keyof NonNullable<PanelSettings['landingPageConfig']>, index: number) => {
        const arr = ((cfg as any)[key] as any[]) || [];
        markCustom();
        updateCfg(key, arr.filter((_, i) => i !== index));
    };

    return (
        <div className="space-y-8">
            <SettingsSection title="Template & Theme">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Template</label>
                        <select
                            value={cfg.templateId || ''}
                            onChange={(e) => {
                                const selected = templates.find(t => t.id === e.target.value);
                                if (selected) {
                                    setSettings(s => ({
                                        ...s,
                                        landingPageConfig: {
                                            ...selected.config,
                                            templateId: selected.id,
                                            templateName: selected.name,
                                            theme: selected.theme
                                        }
                                    }));
                                }
                            }}
                            className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                        >
                            <option value="">Select</option>
                            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            <option value="custom">Custom</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Template Name</label>
                        <input
                            type="text"
                            value={cfg.templateName || ''}
                            onChange={(e) => setSettings(s => ({ ...s, landingPageConfig: { ...(s.landingPageConfig || {}), templateName: e.target.value, templateId: 'custom' } }))}
                            className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                            placeholder="Custom Template Name"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Primary Color</label>
                        <input
                            type="color"
                            value={cfg.theme?.primary600 || '#ea580c'}
                            onChange={(e) => updateCfg('theme', { ...(cfg.theme || {}), primary600: e.target.value })}
                            className="mt-1 h-10 w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md"
                        />
                    </div>
                </div>
            </SettingsSection>
            <SettingsSection title="Landing Page Basics">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <TextInput label="Web Title" name="webTitle" value={cfg.webTitle || ''} onChange={e => updateCfg('webTitle', e.target.value)} />
                    <TextInput label="Hero Badge" name="heroBadge" value={cfg.heroBadge || ''} onChange={e => updateCfg('heroBadge', e.target.value)} />
                    <TextInput label="Hero Title" name="heroTitle" value={cfg.heroTitle || ''} onChange={e => updateCfg('heroTitle', e.target.value)} />
                    <TextInput label="Hero Subtitle" name="heroSubtitle" value={cfg.heroSubtitle || ''} onChange={e => updateCfg('heroSubtitle', e.target.value)} />
                </div>
            </SettingsSection>

            <SettingsSection title="Buttons & Labels">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <TextInput label="Hero Primary Button" name="heroCtaLabel" value={cfg.heroCtaLabel || ''} onChange={e => updateCfg('heroCtaLabel', e.target.value)} />
                    <TextInput label="Login Prompt Text" name="heroLoginPrompt" value={cfg.heroLoginPrompt || ''} onChange={e => updateCfg('heroLoginPrompt', e.target.value)} />
                    <TextInput label="Login Link Label" name="heroLoginLabel" value={cfg.heroLoginLabel || ''} onChange={e => updateCfg('heroLoginLabel', e.target.value)} />
                    <TextInput label="Admin Login Button" name="navAdminLabel" value={cfg.navAdminLabel || ''} onChange={e => updateCfg('navAdminLabel', e.target.value)} />
                    <TextInput label="Client Portal Button" name="navClientPortalLabel" value={cfg.navClientPortalLabel || ''} onChange={e => updateCfg('navClientPortalLabel', e.target.value)} />
                </div>
            </SettingsSection>

            <SettingsSection title="Navigation Pages">
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {(cfg.pages || []).map((p: any, idx: number) => (
                            <div key={`page-${idx}`} className="space-y-2 border border-slate-200 dark:border-slate-700 rounded-md p-3">
                                <TextInput label="Label" name={`page_label_${idx}`} value={p.label || ''} onChange={e => updateArrayItem('pages', idx, 'label', e.target.value)} />
                                <TextInput label="Section ID" name={`page_id_${idx}`} value={p.id || ''} onChange={e => updateArrayItem('pages', idx, 'id', e.target.value)} />
                                <button onClick={() => removeArrayItem('pages', idx)} className="px-3 py-2 bg-red-600 text-white rounded-md">Remove</button>
                            </div>
                        ))}
                    </div>
                    <button onClick={() => addArrayItem('pages', { id: 'custom', label: 'Custom' })} className="px-4 py-2 bg-slate-700 text-white rounded-md">Add Page</button>
                </div>
            </SettingsSection>

            <SettingsSection title="Product Cards">
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {(cfg.productCards || []).map((c: any, idx: number) => (
                            <div key={`card-${idx}`} className="space-y-2 border border-slate-200 dark:border-slate-700 rounded-md p-3">
                                <TextInput label="Title" name={`card_title_${idx}`} value={c.title || ''} onChange={e => updateArrayItem('productCards', idx, 'title', e.target.value)} />
                                <TextInput label="Subtitle" name={`card_sub_${idx}`} value={c.subtitle || ''} onChange={e => updateArrayItem('productCards', idx, 'subtitle', e.target.value)} />
                                <TextInput label="Price Text" name={`card_price_${idx}`} value={c.priceText || ''} onChange={e => updateArrayItem('productCards', idx, 'priceText', e.target.value)} />
                                <button onClick={() => removeArrayItem('productCards', idx)} className="px-3 py-2 bg-red-600 text-white rounded-md">Remove</button>
                            </div>
                        ))}
                    </div>
                    <button onClick={() => addArrayItem('productCards', { title: 'New', subtitle: '', priceText: '' })} className="px-4 py-2 bg-slate-700 text-white rounded-md">Add Card</button>
                </div>
            </SettingsSection>

            <SettingsSection title="Features">
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {(cfg.features || []).map((f: any, idx: number) => (
                            <div key={`feat-${idx}`} className="space-y-2 border border-slate-200 dark:border-slate-700 rounded-md p-3">
                                <TextInput label="Title" name={`feat_title_${idx}`} value={f.title || ''} onChange={e => updateArrayItem('features', idx, 'title', e.target.value)} />
                                <TextInput label="Description" name={`feat_desc_${idx}`} value={f.description || ''} onChange={e => updateArrayItem('features', idx, 'description', e.target.value)} />
                                <button onClick={() => removeArrayItem('features', idx)} className="px-3 py-2 bg-red-600 text-white rounded-md">Remove</button>
                            </div>
                        ))}
                    </div>
                    <button onClick={() => addArrayItem('features', { title: 'New Feature', description: '' })} className="px-4 py-2 bg-slate-700 text-white rounded-md">Add Feature</button>
                </div>
            </SettingsSection>

            <SettingsSection title="Plans">
                <div className="space-y-4">
                    <TextInput label="Section Title" name="plansTitle" value={cfg.plansTitle || ''} onChange={e => updateCfg('plansTitle', e.target.value)} />
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {(cfg.plans || []).map((p: any, idx: number) => (
                            <div key={`plan-${idx}`} className="space-y-2 border border-slate-200 dark:border-slate-700 rounded-md p-3">
                                <TextInput label="Name" name={`plan_name_${idx}`} value={p.name || ''} onChange={e => updateArrayItem('plans', idx, 'name', e.target.value)} />
                                <TextInput label="Speed Text" name={`plan_speed_${idx}`} value={p.speedText || ''} onChange={e => updateArrayItem('plans', idx, 'speedText', e.target.value)} />
                                <TextInput label="Price Text" name={`plan_price_${idx}`} value={p.priceText || ''} onChange={e => updateArrayItem('plans', idx, 'priceText', e.target.value)} />
                                <TextInput label="CTA Label" name={`plan_cta_${idx}`} value={p.ctaLabel || ''} onChange={e => updateArrayItem('plans', idx, 'ctaLabel', e.target.value)} />
                                <button onClick={() => removeArrayItem('plans', idx)} className="px-3 py-2 bg-red-600 text-white rounded-md">Remove</button>
                            </div>
                        ))}
                    </div>
                    <button onClick={() => addArrayItem('plans', { name: 'New Plan', speedText: '', priceText: '', ctaLabel: 'Inquire' })} className="px-4 py-2 bg-slate-700 text-white rounded-md">Add Plan</button>
                </div>
            </SettingsSection>

            <SettingsSection title="Contact">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <TextInput label="Section Title" name="contactTitle" value={cfg.contactTitle || ''} onChange={e => updateCfg('contactTitle', e.target.value)} />
                    <TextInput label="Email" name="contactEmail" value={cfg.contactEmail || ''} onChange={e => updateCfg('contactEmail', e.target.value)} />
                    <TextInput label="Phone" name="contactPhone" value={cfg.contactPhone || ''} onChange={e => updateCfg('contactPhone', e.target.value)} />
                    <TextInput label="Address" name="contactAddress" value={cfg.contactAddress || ''} onChange={e => updateCfg('contactAddress', e.target.value)} />
                    <TextInput label="Facebook URL" name="contactFacebookUrl" value={cfg.contactFacebookUrl || ''} onChange={e => updateCfg('contactFacebookUrl', e.target.value)} />
                </div>
            </SettingsSection>

            <SettingsSection title="Footer Links">
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {(cfg.footerLinks || []).map((l: any, idx: number) => (
                            <div key={`link-${idx}`} className="space-y-2 border border-slate-200 dark:border-slate-700 rounded-md p-3">
                                <TextInput label="Label" name={`link_label_${idx}`} value={l.label || ''} onChange={e => updateArrayItem('footerLinks', idx, 'label', e.target.value)} />
                                <TextInput label="Href" name={`link_href_${idx}`} value={l.href || ''} onChange={e => updateArrayItem('footerLinks', idx, 'href', e.target.value)} />
                                <button onClick={() => removeArrayItem('footerLinks', idx)} className="px-3 py-2 bg-red-600 text-white rounded-md">Remove</button>
                            </div>
                        ))}
                    </div>
                    <button onClick={() => addArrayItem('footerLinks', { label: 'Email', href: 'mailto:' })} className="px-4 py-2 bg-slate-700 text-white rounded-md">Add Link</button>
                </div>
            </SettingsSection>
            
            <SettingsSection title="Advertising Image">
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Image URL</label>
                            <input 
                                type="url"
                                placeholder="https://example.com/banner.jpg"
                                className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                                onChange={(e) => updateCfg('adImageLink', e.target.value)}
                                value={cfg.adImageLink || ''}
                            />
                            <div className="mt-2 flex gap-2">
                                <button
                                    className="px-4 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-700] text-white rounded-md"
                                    onClick={async () => {
                                        const url = cfg.adImageLink || '';
                                        if (!url) { alert('Please enter an image URL first.'); return; }
                                        try {
                                            const resp = await fetch('/api/landing/ad-image-download', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                                                body: JSON.stringify({ url })
                                            });
                                            const data = await resp.json();
                                            if (!resp.ok) throw new Error(data.message || 'Failed to download image.');
                                            updateCfg('adImageBase64', data.adImageBase64);
                                            alert('Image downloaded and saved.');
                                        } catch (e) {
                                            alert((e as Error).message);
                                        }
                                    }}
                                >
                                    Download & Save
                                </button>
                                <button
                                    className="px-4 py-2 bg-slate-700 text-white rounded-md"
                                    onClick={() => { updateCfg('adImageBase64', ''); }}
                                >
                                    Clear Image
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Alt Text</label>
                            <input 
                                type="text"
                                className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                                value={cfg.adImageAlt || ''}
                                onChange={(e) => updateCfg('adImageAlt', e.target.value)}
                                placeholder="Promotion banner"
                            />
                        </div>
                    </div>
                    <div className="mt-4">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Preview</label>
                        {cfg.adImageBase64 ? (
                            <img src={cfg.adImageBase64} alt={cfg.adImageAlt || 'Advertising Image'} className="w-full max-w-xl rounded-lg border border-slate-200 dark:border-slate-700" />
                        ) : (
                            <div className="w-full max-w-xl h-40 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 grid place-content-center text-slate-500">
                                No image selected
                            </div>
                        )}
                    </div>
                </div>
            </SettingsSection>
        </div>
    );
};

type Tab = 'panel' | 'ai' | 'telegram' | 'paymongo' | 'facebook' | 'landing-page' | 'wan';

export const SystemSettings: React.FC = () => {
    const [activeTab, setActiveTab] = useState<Tab>('panel');
    const [settings, setSettings] = useState<PanelSettings>({} as PanelSettings);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const { setLanguage, setCurrency } = useLocalization();

    useEffect(() => {
        const load = async () => {
            setIsLoading(true);
            try {
                const data = await getPanelSettings();
                setSettings(data);
            } catch (err) {
                setError((err as Error).message);
            } finally {
                setIsLoading(false);
            }
        };
        load();
    }, []);
    
    const handleSave = async () => {
        setIsSaving(true);
        setError(null);
        try {
            await savePanelSettings(settings);
            if (settings.language) await setLanguage(settings.language);
            if (settings.currency) setCurrency(settings.currency);
            initializeAiClient(settings.geminiApiKey);
            alert('Settings saved successfully!');
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleTestTelegram = async (botToken: string, chatId: string) => {
        setIsTesting(true);
        try {
            const res = await fetch('/api/telegram/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
                body: JSON.stringify({ botToken, chatId })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            alert(data.message);
        } catch (err) {
            alert(`Test failed: ${(err as Error).message}`);
        } finally {
            setIsTesting(false);
        }
    };
    
    const tabs = [
        { id: 'panel', label: 'Panel', icon: <CogIcon className="w-5 h-5" /> },
        { id: 'ai', label: 'AI', icon: <KeyIcon className="w-5 h-5" /> },
        { id: 'telegram', label: 'Telegram', icon: <MessageIcon className="w-5 h-5" /> },
        { id: 'paymongo', label: 'PayMongo', icon: <PayMongoIcon className="w-5 h-5" /> },
        { id: 'facebook', label: 'Messenger', icon: <FacebookIcon className="w-5 h-5" /> },
        { id: 'landing-page', label: 'Landing Page', icon: <GlobeIcon className="w-5 h-5" /> },
        { id: 'wan', label: 'WAN Settings', icon: <svg className="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg> },
    ];
    
    const renderContent = () => {
        if (isLoading) return <div className="flex justify-center p-8"><Loader /></div>;
        if (error) return <p className="text-red-500">{error}</p>;

        switch (activeTab) {
            case 'panel': return <PanelTab settings={settings} setSettings={setSettings} />;
            case 'ai': return <AiTab settings={settings} setSettings={setSettings} />;
            case 'telegram': return <TelegramTab settings={settings} setSettings={setSettings} onTest={handleTestTelegram} isTesting={isTesting} />;
            case 'paymongo': return <PayMongoTab settings={settings} setSettings={setSettings} />;
            case 'facebook': return <FacebookMessengerTab settings={settings} setSettings={setSettings} />;
            case 'landing-page': return <LandingPageTab settings={settings} setSettings={setSettings} />;
            case 'wan': return <SettingsSection title="System WAN Configuration"><WanSettingsPanel /></SettingsSection>;
            default: return null;
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <div className="border-b border-slate-200 dark:border-slate-700">
                <nav className="flex space-x-2 -mb-px overflow-x-auto" aria-label="Tabs">
                    {tabs.map(tab => (
                        <TabButton 
                            key={tab.id}
                            label={tab.label}
                            icon={tab.icon}
                            isActive={activeTab === tab.id}
                            onClick={() => setActiveTab(tab.id as Tab)}
                        />
                    ))}
                </nav>
            </div>
            
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
                <div className="p-6">
                    {renderContent()}
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-4 flex justify-end rounded-b-lg">
                    <button onClick={handleSave} disabled={isSaving} className="px-6 py-2 font-semibold bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white rounded-lg disabled:opacity-50 flex items-center gap-2">
                        {isSaving && <Loader />}
                        {isSaving ? 'Saving...' : 'Save All Settings'}
                    </button>
                </div>
            </div>
        </div>
    );
};
