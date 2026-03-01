
import React, { useState, useEffect } from 'react';
import type { PanelSettings, TelegramSettings, XenditSettings } from '../types.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { initializeAiClient } from '../services/geminiService.ts';
import { getPanelSettings, savePanelSettings, getAuthHeader } from '../services/databaseService.ts';
import { Loader } from './Loader.tsx';
import { KeyIcon, CogIcon } from '../constants.tsx';

// --- Icon Components (kept local to this file) ---
const SunIcon: React.FC<{ className?: string }> = ({ className }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" /></svg>;
const MoonIcon: React.FC<{ className?: string }> = ({ className }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" /></svg>;
const ComputerDesktopIcon: React.FC<{ className?: string }> = ({ className }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z" /></svg>;
const MessageIcon: React.FC<{ className?: string }> = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.76 9.76 0 01-2.53-.405m-3.038-5.858a2.25 2.25 0 00-3.75-3.75C3.302 4.03 7.056 2.25 12 2.25c4.97 0 9 3.694 9 8.25z" /></svg>);
const XenditIcon: React.FC<{ className?: string }> = ({ className }) => (<svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12.35 12.63l-2.48 2.48a.5.5 0 01-.71 0l-2.48-2.48a.5.5 0 010-.71l2.48-2.48a.5.5 0 01.71 0l2.48 2.48a.5.5 0 010 .71z" /><path fillRule="evenodd" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 5.36a.5.5 0 00-.71 0l-2.48 2.48a.5.5 0 000 .71l2.48 2.48a.5.5 0 00.71 0l2.48-2.48a.5.5 0 000-.71L16.64 5.36zm-1.07 7.06a.5.5 0 01.71 0l2.48 2.48a.5.5 0 010 .71l-2.48 2.48a.5.5 0 01-.71 0l-2.48-2.48a.5.5 0 010-.71l2.48-2.48zM5.36 7.36a.5.5 0 01.71 0l2.48 2.48a.5.5 0 010 .71l-2.48 2.48a.5.5 0 01-.71 0L2.88 10.55a.5.5 0 010-.71l2.48-2.48z" clipRule="evenodd" /></svg>);

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

const XenditTab: React.FC<{ settings: PanelSettings, setSettings: React.Dispatch<React.SetStateAction<PanelSettings>> }> = ({ settings, setSettings }) => {
    const xendit = settings.xenditSettings || {} as XenditSettings;
    const update = (field: keyof XenditSettings, value: any) => {
        setSettings(s => ({ ...s, xenditSettings: { ...s.xenditSettings, [field]: value } as XenditSettings }));
    };

    return (
        <SettingsSection title="Xendit Payment Gateway">
            <Toggle label="Enable Xendit Payments" checked={xendit.enabled || false} onChange={c => update('enabled', c)} />
            <div className={`space-y-4 ${!xendit.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
                <TextInput label="Secret Key" name="secretKey" value={xendit.secretKey || ''} onChange={e => update('secretKey', e.target.value)} type="password" />
                <TextInput label="Public Key" name="publicKey" value={xendit.publicKey || ''} onChange={e => update('publicKey', e.target.value)} type="password" />
                <TextInput label="Webhook Token" name="webhookToken" value={xendit.webhookToken || ''} onChange={e => update('webhookToken', e.target.value)} type="password" />
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

type Tab = 'panel' | 'ai' | 'telegram' | 'xendit' | 'landing-page';

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
        { id: 'xendit', label: 'Xendit', icon: <XenditIcon className="w-5 h-5" /> },
        { id: 'landing-page', label: 'Landing Page', icon: <GlobeIcon className="w-5 h-5" /> },
    ];
    
    const renderContent = () => {
        if (isLoading) return <div className="flex justify-center p-8"><Loader /></div>;
        if (error) return <p className="text-red-500">{error}</p>;

        switch (activeTab) {
            case 'panel': return <PanelTab settings={settings} setSettings={setSettings} />;
            case 'ai': return <AiTab settings={settings} setSettings={setSettings} />;
            case 'telegram': return <TelegramTab settings={settings} setSettings={setSettings} onTest={handleTestTelegram} isTesting={isTesting} />;
            case 'xendit': return <XenditTab settings={settings} setSettings={setSettings} />;
            case 'landing-page': return <LandingPageTab settings={settings} setSettings={setSettings} />;
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
