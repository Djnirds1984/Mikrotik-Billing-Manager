
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Notification } from '../types.ts';
import { dbApi } from '../services/databaseService.ts';
import { useAuth } from './AuthContext.tsx';

interface NotificationContextType {
    notifications: Notification[];
    unreadCount: number;
    markAsRead: (id: string) => Promise<void>;
    markAllAsRead: () => Promise<void>;
    clearNotifications: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const [notifications, setNotifications] = useState<Notification[]>([]);

    const fetchNotifications = useCallback(async () => {
        if (!user) {
            setNotifications([]);
            return;
        }
        try {
            const data = await dbApi.get<Notification[]>('/notifications');
            // newest first
            data.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            setNotifications(data);
        } catch (error) {
            console.error("Failed to fetch notifications:", error);
        }
    }, [user]);

    useEffect(() => {
        if (user) {
            fetchNotifications();
            const interval = setInterval(fetchNotifications, 15000); // Poll every 15 seconds
            return () => clearInterval(interval);
        } else {
            setNotifications([]);
        }
    }, [user, fetchNotifications]);

    const unreadCount = notifications.filter(n => n.is_read === 0).length;

    const markAsRead = async (id: string) => {
        try {
            // Optimistically update UI
            setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
            await dbApi.patch(`/notifications/${id}`, { is_read: 1 });
        } catch (error) {
            console.error("Failed to mark notification as read:", error);
            // Revert on error
            fetchNotifications(); 
        }
    };

    const markAllAsRead = async () => {
        if (unreadCount === 0) return;
        try {
            // Optimistic UI update
            setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
            
            // In a real app, this would be a single backend call.
            const unreadIds = notifications.filter(n => n.is_read === 0).map(n => n.id);
            await Promise.all(unreadIds.map(id => dbApi.patch(`/notifications/${id}`, { is_read: 1 })));
        } catch (error) {
            console.error("Failed to mark all as read:", error);
            fetchNotifications(); // Revert on error
        }
    };
    
    const clearNotifications = async () => {
        if (notifications.length === 0 || !window.confirm("Are you sure you want to clear all notifications? This cannot be undone.")) return;
        // FIX: Moved `originalNotifications` declaration outside of the try block so it is accessible in the catch block for reverting the state on error.
        const originalNotifications = [...notifications];
        try {
            setNotifications([]); // Optimistic UI update
            await dbApi.post('/notifications/clear-all', {}); // Using generic endpoint
        } catch (error) {
            console.error("Failed to clear notifications:", error);
            setNotifications(originalNotifications); // Revert on error
        }
    };


    const value = {
        notifications,
        unreadCount,
        markAsRead,
        markAllAsRead,
        clearNotifications,
    };

    return (
        <NotificationContext.Provider value={value}>
            {children}
        </NotificationContext.Provider>
    );
};

export const useNotifications = () => {
    const context = useContext(NotificationContext);
    if (context === undefined) {
        throw new Error('useNotifications must be used within a NotificationProvider');
    }
    return context;
};
