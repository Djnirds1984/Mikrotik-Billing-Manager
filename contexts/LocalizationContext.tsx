import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getPanelSettings } from '../services/databaseService.ts';
import type { PanelSettings } from '../types.ts';
import { useAuth } from './AuthContext.tsx';

interface LocalizationContextType {
    language: PanelSettings['language'];
    currency: PanelSettings['currency'];
    setLanguage: (lang: PanelSettings['language']) => Promise<void>;
    setCurrency: (curr: PanelSettings['currency']) => void;
    t: (key: string, replacements?: Record<string, string>) => string;
    formatCurrency: (amount: number) => string;
    isLoading: boolean;
}

const LocalizationContext = createContext<LocalizationContextType | undefined>(undefined);

export const LocalizationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Get auth state to prevent premature API calls
    const { user, isLoading: isAuthLoading } = useAuth();
    
    const [settings, setSettings] = useState<PanelSettings>({ language: 'en', currency: 'USD' });
    const [translations, setTranslations] = useState<Record<string, any>>({});
    const [isLoading, setIsLoading] = useState(true);

    const fetchTranslations = useCallback(async (lang: PanelSettings['language']) => {
        try {
            const response = await fetch(`/locales/${lang}.json`);
            if (!response.ok) throw new Error('Translation file not found');
            const data = await response.json();
            setTranslations(data);
        } catch (error) {
            console.error(`Could not load translations for ${lang}:`, error);
            // Fallback to English if the desired language fails
            if (lang !== 'en') {
                await fetchTranslations('en');
            }
        }
    }, []);

    useEffect(() => {
        const loadInitialSettings = async () => {
            setIsLoading(true);

            // Wait until authentication is resolved
            if (isAuthLoading) {
                // If auth is still loading, do nothing yet. This effect will re-run when it's done.
                // The isLoading state remains true, which is correct.
                return;
            }

            // If no user is logged in after auth check, use defaults
            if (!user) {
                setSettings({ language: 'en', currency: 'USD' });
                await fetchTranslations('en');
                setIsLoading(false);
                return;
            }
            
            // User is logged in, now we can safely fetch their settings
            try {
                const savedSettings = await getPanelSettings() as PanelSettings;
                const finalSettings = { language: 'en', currency: 'USD', ...savedSettings };
                setSettings(finalSettings);
                await fetchTranslations(finalSettings.language);
            } catch (error) {
                console.error("Failed to load panel settings, using defaults:", error);
                await fetchTranslations('en'); // Fallback
            } finally {
                setIsLoading(false);
            }
        };
        loadInitialSettings();
    }, [fetchTranslations, user, isAuthLoading]);

    const handleSetLanguage = async (lang: PanelSettings['language']) => {
        setSettings(s => ({ ...s, language: lang }));
        await fetchTranslations(lang);
        // The saving logic is handled in SystemSettings.tsx, this just updates the context state.
    };

    const handleSetCurrency = (curr: PanelSettings['currency']) => {
        setSettings(s => ({ ...s, currency: curr }));
        // The saving logic is handled in SystemSettings.tsx.
    };
    
    const t = (key: string, replacements?: Record<string, string>): string => {
        const keys = key.split('.');
        let result = translations;
        for (const k of keys) {
            result = result?.[k];
            if (result === undefined) return key;
        }
        
        let strResult = String(result);

        if (replacements) {
            Object.keys(replacements).forEach(rKey => {
                strResult = strResult.replace(`{{${rKey}}}`, replacements[rKey]);
            });
        }
        
        return strResult;
    };

    const formatCurrency = (amount: number): string => {
        const lang = settings.language === 'fil' ? 'en-PH' : 'en-US';
        return new Intl.NumberFormat(lang, {
            style: 'currency',
            currency: settings.currency,
        }).format(amount);
    };

    const value = {
        language: settings.language,
        currency: settings.currency,
        setLanguage: handleSetLanguage,
        setCurrency: handleSetCurrency,
        t,
        formatCurrency,
        isLoading
    };

    return (
        <LocalizationContext.Provider value={value}>
            {children}
        </LocalizationContext.Provider>
    );
};

export const useLocalization = () => {
    const context = useContext(LocalizationContext);
    if (context === undefined) {
        throw new Error('useLocalization must be used within a LocalizationProvider');
    }
    return context;
};