import React, { useEffect, useRef } from 'react';
import { useNotifications } from '../contexts/NotificationContext.tsx';
import type { View, Notification } from '../types.ts';
import { BellIcon, TrashIcon } from '../constants.tsx';
import { useRouters } from '../hooks/useRouters.ts';
import { getPanelSettings, savePanelSettings } from '../services/databaseService.ts';
import {
    generatePppoeNotifications,
    generateDhcpPortalNotifications,
    generateNetworkNotifications,
} from '../services/notificationGenerators.ts';

interface NotificationsPageProps {
    setCurrentView: (view: View) => void;
}

export const NotificationsPage: React.FC<NotificationsPageProps> = ({ setCurrentView }) => {
    const { notifications, unreadCount, markAllAsRead, clearNotifications, markAsRead } = useNotifications();
    const { routers } = useRouters();
    const [panelSettings, setPanelSettings] = React.useState<import('../types.ts').PanelSettings | undefined>(undefined);
    const [notifSettings, setNotifSettings] = React.useState<import('../types.ts').PanelSettings['notificationSettings'] | undefined>(undefined);
    const [editSettings, setEditSettings] = React.useState<import('../types.ts').PanelSettings['notificationSettings'] | undefined>(undefined);
    const [saving, setSaving] = React.useState(false);
    const generatingRef = useRef(false);

    const handleNotificationClick = (notification: Notification) => {
        if (notification.is_read === 0) {
            markAsRead(notification.id);
        }
        if (notification.link_to) {
            setCurrentView(notification.link_to);
        }
    };

    // Load notification settings
    useEffect(() => {
        (async () => {
            try {
                const settings = await getPanelSettings();
                setPanelSettings(settings);
                setNotifSettings(settings.notificationSettings);
                setEditSettings(settings.notificationSettings || {});
            } catch (e) {
                console.warn('Failed to load panel settings:', e);
            }
        })();
    }, []);

    const handleSaveSettings = async () => {
        if (!editSettings) return;
        setSaving(true);
        try {
            const current = await getPanelSettings();
            const newSettings = {
                ...current,
                notificationSettings: { ...(current.notificationSettings || {}), ...editSettings },
            };
            await savePanelSettings(newSettings);
            setNotifSettings(editSettings);
            alert('Notification settings saved');
        } catch (e) {
            alert(`Failed to save: ${(e as Error).message}`);
        } finally {
            setSaving(false);
        }
    };

    // Auto-generate notifications for PPPoE/DHCP expirations, network issues, and billed events
    useEffect(() => {
        const runGenerators = async () => {
            if (generatingRef.current) return;
            generatingRef.current = true;
            try {
                if (routers && routers.length > 0) {
                    const ns = notifSettings || {};
                    if (ns.enablePppoe !== false) {
                        await generatePppoeNotifications(routers, notifications, ns, panelSettings);
                    }
                    if (ns.enableDhcpPortal !== false) {
                        await generateDhcpPortalNotifications(routers, notifications, ns, panelSettings);
                    }
                    if (ns.enableNetwork !== false) {
                        await generateNetworkNotifications(routers, notifications, ns, panelSettings);
                    }
                    if (ns.enableBilled) {
                        const { generateBilledNotifications } = await import('../services/notificationGenerators.ts');
                        await generateBilledNotifications(routers, notifications, ns, panelSettings);
                    }
                }
            } catch (e) {
                console.error('Notification generators failed:', e);
            } finally {
                generatingRef.current = false;
            }
        };

        // Run once on mount and then on a schedule
        runGenerators();
        const intervalSeconds = notifSettings?.generatorIntervalSeconds ?? 30;
        const interval = setInterval(runGenerators, intervalSeconds * 1000);
        return () => clearInterval(interval);
    }, [routers, notifications, notifSettings]);

    return (
        <div className="max-w-4xl mx-auto">
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md mb-6">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
                    <BellIcon className="w-6 h-6" />
                    <h3 className="text-lg font-semibold text-[--color-primary-500] dark:text-[--color-primary-400]">Notification Settings</h3>
                </div>
                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="flex items-center justify-between p-4 bg-slate-100 dark:bg-slate-700/50 rounded-lg">
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Enable PPPoE notifications</span>
                            <input type="checkbox" checked={(editSettings?.enablePppoe ?? true)} onChange={e => setEditSettings(s => ({ ...(s || {}), enablePppoe: e.target.checked }))} />
                        </label>
                        <label className="flex items-center justify-between p-4 bg-slate-100 dark:bg-slate-700/50 rounded-lg">
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Enable DHCP Portal notifications</span>
                            <input type="checkbox" checked={(editSettings?.enableDhcpPortal ?? true)} onChange={e => setEditSettings(s => ({ ...(s || {}), enableDhcpPortal: e.target.checked }))} />
                        </label>
                        <label className="flex items-center justify-between p-4 bg-slate-100 dark:bg-slate-700/50 rounded-lg">
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Enable Network notifications</span>
                            <input type="checkbox" checked={(editSettings?.enableNetwork ?? true)} onChange={e => setEditSettings(s => ({ ...(s || {}), enableNetwork: e.target.checked }))} />
                        </label>
                        <label className="flex items-center justify-between p-4 bg-slate-100 dark:bg-slate-700/50 rounded-lg">
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Enable Billed notifications</span>
                            <input type="checkbox" checked={(editSettings?.enableBilled ?? false)} onChange={e => setEditSettings(s => ({ ...(s || {}), enableBilled: e.target.checked }))} />
                        </label>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">DHCP near-expiry hours</label>
                            <input type="number" min={1} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" value={(editSettings?.dhcpNearExpiryHours ?? 24)} onChange={e => setEditSettings(s => ({ ...(s || {}), dhcpNearExpiryHours: Number(e.target.value) }))} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Generator interval (seconds)</label>
                            <input type="number" min={5} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" value={(editSettings?.generatorIntervalSeconds ?? 30)} onChange={e => setEditSettings(s => ({ ...(s || {}), generatorIntervalSeconds: Number(e.target.value) }))} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Debounce minutes</label>
                            <input type="number" min={1} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" value={(editSettings?.debounceMinutes ?? 15)} onChange={e => setEditSettings(s => ({ ...(s || {}), debounceMinutes: Number(e.target.value) }))} />
                        </div>
                    </div>
                    <div className="flex justify-end pt-4 border-t border-slate-200 dark:border-slate-700">
                        <button onClick={handleSaveSettings} disabled={saving} className="px-4 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-semibold rounded-lg disabled:opacity-50">
                            {saving ? 'Saving...' : 'Save Notification Settings'}
                        </button>
                    </div>
                </div>
            </div>
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-3">
                    <BellIcon className="w-8 h-8"/> Notifications
                </h2>
                <div className="flex items-center gap-2 self-end sm:self-center">
                    <button onClick={markAllAsRead} disabled={unreadCount === 0} className="px-4 py-2 text-sm text-slate-700 dark:text-slate-200 bg-slate-200 dark:bg-slate-700 rounded-lg font-semibold disabled:opacity-50">
                        Mark all as read
                    </button>
                    <button onClick={clearNotifications} disabled={notifications.length === 0} className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg font-semibold flex items-center gap-2 disabled:opacity-50">
                        <TrashIcon className="w-5 h-5" /> Clear All
                    </button>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
                <ul className="divide-y divide-slate-200 dark:divide-slate-700">
                    {notifications.length > 0 ? (
                        notifications.map(notification => (
                            <li 
                                key={notification.id}
                                className={`p-4 flex items-start gap-4 transition-colors ${notification.link_to ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50' : ''}`}
                                onClick={() => handleNotificationClick(notification)}
                            >
                                <div className={`mt-1 flex-shrink-0 w-2.5 h-2.5 rounded-full ${notification.is_read === 0 ? 'bg-sky-500' : 'bg-transparent'}`}></div>
                                <div className="flex-grow">
                                    <p className={`text-sm ${notification.is_read === 0 ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400'}`}>
                                        {notification.message}
                                    </p>
                                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                                        {new Date(notification.timestamp).toLocaleString()}
                                    </p>
                                </div>
                            </li>
                        ))
                    ) : (
                        <li className="p-8 text-center text-slate-500 dark:text-slate-400">
                            You have no notifications.
                        </li>
                    )}
                </ul>
            </div>
        </div>
    );
};
