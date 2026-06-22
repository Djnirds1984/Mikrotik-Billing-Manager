import { useState, useEffect, useCallback } from 'react';
import type { BillingSettings } from '../types.ts';
import { dbApi } from '../services/databaseService.ts';

const defaultSettings: BillingSettings = {
    nonPaymentProfile: '',
    defaultPlanId: '',
    gracePeriodDays: 3,
    expiryTime: '23:59',
};

export const useBillingSettings = () => {
    const [settings, setSettings] = useState<BillingSettings>(defaultSettings);
    const [isLoading, setIsLoading] = useState(true);

    const fetchSettings = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await dbApi.get<BillingSettings>('/billing-settings');
            setSettings({ ...defaultSettings, ...data });
        } catch (err) {
            console.error('Failed to fetch billing settings:', err);
            setSettings(defaultSettings);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSettings();
    }, [fetchSettings]);

    const saveSettings = async (newSettings: BillingSettings) => {
        try {
            await dbApi.post('/billing-settings', newSettings);
            setSettings(newSettings);
        } catch (err) {
            console.error('Failed to save billing settings:', err);
            throw err;
        }
    };

    return { settings, saveSettings, isLoading };
};
