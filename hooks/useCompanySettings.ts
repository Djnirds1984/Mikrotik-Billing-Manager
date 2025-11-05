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
        setIsLoading(true);
        setError(null);
        try {
            // FIX: Use a direct fetch call for this public resource to avoid
            // the authenticated dbApi which can cause a reload loop on 401 errors
            // when an expired token is present on the login page.
            const response = await fetch('/api/db/company-settings');
            if (!response.ok) {
                throw new Error('Failed to fetch company settings.');
            }
            const data = await response.json();
            setSettings(s => ({...s, ...data}));
        } catch (err) {
            setError((err as Error).message);
            console.error("Failed to fetch company settings from DB", err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSettings();
    }, [fetchSettings]);

    const updateSettings = async (updatedSettings: CompanySettings) => {
        try {
            // Saving settings still uses the protected dbApi endpoint.
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