import React from 'react';
import { useNotifications } from '../contexts/NotificationContext.tsx';
import type { View, Notification } from '../types.ts';
import { BellIcon, TrashIcon } from '../constants.tsx';

interface NotificationsPageProps {
    setCurrentView: (view: View) => void;
}

export const NotificationsPage: React.FC<NotificationsPageProps> = ({ setCurrentView }) => {
    const { notifications, unreadCount, markAllAsRead, clearNotifications, markAsRead } = useNotifications();

    const handleNotificationClick = (notification: Notification) => {
        if (notification.is_read === 0) {
            markAsRead(notification.id);
        }
        if (notification.link_to) {
            setCurrentView(notification.link_to);
        }
    };

    return (
        <div className="max-w-4xl mx-auto">
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
