
import React, { useState, useEffect, useCallback } from 'react';
import type { RouterConfigWithId, PanelSettings, PanelNtpStatus, LicenseStatus, TelegramSettings, XenditSettings } from '../types.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { initializeAiClient } from '../services/geminiService.ts';
import { rebootRouter, syncTimeToRouter } from '../services/mikrotikService.ts';
import { getPanelSettings, savePanelSettings, getAuthHeader } from '../services/databaseService.ts';
import { createDatabaseBackup, listDatabaseBackups, deleteDatabaseBackup, getPanelNtpStatus, togglePanelNtp } from '../services/panelService.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { Loader } from './Loader.tsx';
import { KeyIcon, CogIcon, PowerIcon, RouterIcon, CircleStackIcon, ArrowPathIcon, TrashIcon, UsersIcon, DataplicityIcon, ClockIcon } from '../constants.tsx';
import { SudoInstructionBox } from './SudoInstructionBox.tsx';

// --- Icon Components ---
const SunIcon: React.FC<{ className?: string }> = ({ className }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" /></svg>;
const MoonIcon: React.FC<{ className?: string }> = ({ className }) => <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" /></svg>;
const ComputerDesktopIcon: React.FC<{ className?: string }> = ({ className }) => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z" /></svg>;
const MessageIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.76 9.76 0 01-2.53-.405m-3.038-5.858a2.25 2.25 0 00-3.75-3.75C3.302 4.03 7.056 2.25 12 2.25c4.97 0 9 3.694 9 8.25z" />
    </svg>
);
const XenditIcon: React.FC<{ className?: string }> = ({ className }) => (
     <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.35 12.63l-2.48 2.48a.5.5 0 01-.71 0l-2.48-2.48a.5.5 0 010-.71l2.48-2.48a.5.5 0 01.71 0l2.48 2.48a.5.5 0 010 .71z" />
        <path fillRule="evenodd" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 5.36a.5.5 0 00-.71 0l-2.48 2.48a.5.5 0 000 .71l2.48 2.48a.5.5 0 00.71 0l2.48-2.48a.5.5 0 000-.71L16.64 5.36zm-1.07 7.06a.5.5 0 01.71 0l2.48 2.48a.5.5 0 010 .71l-2.48 2.48a.5.5 0 01-.71 0l-2.48-2.48a.5.5 0 010-.71l2.48-2.48zM5.36 7.36a.5.5 0 01.71 0l2.48 2.48a.5.5 0 010 .71l-2.48 2.48a.5.5 0 01-.71 0L2.88 10.55a.5.5 0 010-.71l2.48-2.48z" clipRule="evenodd" />
    </svg>
);


// Tab button component
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

// Generic form field components
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

// FIX: Define the missing ThemeSwitcher component.
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

// --- Sub-components for each tab ---

const PanelTab: React.FC<{ settings: PanelSettings, setSettings: React.Dispatch<React.SetStateAction<PanelSettings>> }> = ({ settings, setSettings }) => {
    const { language, currency, setLanguage, setCurrency } = useLocalization();

    return (
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
    );
};

const AiTab: React.FC<{ settings: PanelSettings, setSettings: React.Dispatch<React.SetStateAction<PanelSettings>> }> = ({ settings, setSettings }) => (
    <SettingsSection title="AI Settings">
        <TextInput 
            label="Google Gemini API Key" 
            name="geminiApiKey" 
            type="password"
            value={(settings as any).geminiApiKey || ''}
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
            <div className={`space-y-4 ${!telegram.enabled ? 'opacity-50' : ''}`}>
                <TextInput label="Bot Token" name="botToken" value={telegram.botToken || ''} onChange={e => update('botToken', e.target.value)} type="password" />
                <TextInput label="Chat ID" name="chatId" value={telegram.chatId || ''} onChange={e => update('chatId', e.target.value)} />
                <button onClick={() => onTest(telegram.botToken, telegram.chatId)} disabled={isTesting || !telegram.botToken || !telegram.chatId} className="px-4 py-2 bg-sky-600 text-white rounded-md disabled:opacity-50">
                    {isTesting ? 'Sending...' : 'Send Test Message'}
                </button>
                <div className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
                    <h4 className="font-semibold">Event Triggers</h4>
                    <Toggle label="Client Due Date" checked={telegram.enableClientDueDate || false} onChange={c => update('enableClientDueDate', c)} info="Notify when a client's subscription is about to expire or has expired." />
                    <Toggle label="Client Disconnected" checked={telegram.enableClientDisconnected || false} onChange={c => update('enableClientDisconnected', c)} info="Notify when a PPPoE user is disabled or disconnected due to expiry." />
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
            <div className={`space-y-4 ${!xendit.enabled ? 'opacity-50' : ''}`}>
                <TextInput label="Secret Key" name="secretKey" value={xendit.secretKey || ''} onChange={e => update('secretKey', e.target.value)} type="password" />
                <TextInput label="Public Key" name="publicKey" value={xendit.publicKey || ''} onChange={e => update('publicKey', e.target.value)} type="password" />
                <TextInput label="Webhook Token" name="webhookToken" value={xendit.webhookToken || ''} onChange={e => update('webhookToken', e.target.value)} type="password" />
            </div>
        </SettingsSection>
    );
};

interface SystemSettingsProps {
    selectedRouter: RouterConfigWithId | null;
    licenseStatus: LicenseStatus | null;
}

type Tab = 'panel' | 'ai' | 'telegram' | 'xendit' | 'database' | 'time' | 'power';

// --- Main Component ---
export const SystemSettings: React.FC<SystemSettingsProps> = ({ selectedRouter, licenseStatus }) => {
    const [activeTab, setActiveTab] = useState<Tab>('panel');
    const [settings, setSettings] = useState<PanelSettings>({} as PanelSettings);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
            // Re-initialize AI client if key changed
            initializeAiClient((settings as any).geminiApiKey);
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
        { id: 'database', label: 'Database', icon: <CircleStackIcon className="w-5 h-5" /> },
        { id: 'time', label: 'Time Sync', icon: <ClockIcon className="w-5 h-5" /> },
        { id: 'power', label: 'Power', icon: <PowerIcon className="w-5 h-5" /> },
    ];
    
    const renderContent = () => {
        if (isLoading) return <div className="flex justify-center p-8"><Loader /></div>;
        if (error) return <p className="text-red-500">{error}</p>;

        switch (activeTab) {
            case 'panel': return <PanelTab settings={settings} setSettings={setSettings} />;
            case 'ai': return <AiTab settings={settings} setSettings={setSettings} />;
            case 'telegram': return <TelegramTab settings={settings} setSettings={setSettings} onTest={handleTestTelegram} isTesting={isTesting} />;
            case 'xendit': return <XenditTab settings={settings} setSettings={setSettings} />;
            // Add other tabs here...
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
