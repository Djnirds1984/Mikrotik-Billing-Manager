import { useState, useEffect, useCallback } from 'react';
import type { CompanySettings } from '../types.ts';
import { dbApi } from '../services/databaseService.ts';

const defaultSettings: CompanySettings = {
    companyName: '',
    address: '',
    contactNumber: '',
    email: '',
    logoBase64: '',
};

export const useCompanySettings = () => {
    const [settings, setSettings] = useState<CompanySettings>(defaultSettings);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchSettings = useCallback(async () => {
        setIsLoading(false);
        setError(null);
        try {
            const data = await dbApi.get<CompanySettings>('/company-settings');
            setSettings(s => ({...s, ...data}));
            try {
                const cache = { timestamp: Date.now(), data };
                localStorage.setItem('companySettingsCache', JSON.stringify(cache));
            } catch {}
        } catch (err) {
            setError((err as Error).message);
            console.error("Failed to fetch company settings from DB", err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        try {
            const raw = localStorage.getItem('companySettingsCache');
            if (raw) {
                const parsed = JSON.parse(raw);
                const ttlMs = 10 * 60 * 1000;
                if (parsed && parsed.data && Date.now() - parsed.timestamp < ttlMs) {
                    setSettings(s => ({...s, ...parsed.data}));
                    setIsLoading(false);
                }
            }
        } catch {}
        fetchSettings();
    }, [fetchSettings]);

    const updateSettings = async (updatedSettings: CompanySettings) => {
        try {
            await dbApi.post('/company-settings', updatedSettings);
            await fetchSettings(); // Re-fetch to confirm changes
        } catch (err) {
            console.error("Failed to update company settings:", err);
            // Optionally, re-throw or handle error in UI
            throw err;
        }
    };

    return { settings, updateSettings, isLoading, error };
};
