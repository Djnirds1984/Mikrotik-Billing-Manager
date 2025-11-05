import React, { useState, useEffect } from 'react';
import { MikroTikLogoIcon } from '../constants.tsx';
import type { CompanySettings } from '../types.ts';
import { dbApi } from '../services/databaseService.ts';

export const AuthLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [settings, setSettings] = useState<CompanySettings | null>(null);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                // This endpoint is now public for GET requests
                const data = await dbApi.get<CompanySettings>('/company-settings');
                setSettings(data);
            } catch (err) {
                console.error("Failed to fetch company settings for login page:", err);
            }
        };

        fetchSettings();
    }, []);

    return (
        <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col justify-center items-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
                {settings?.logoBase64 ? (
                     <img src={settings.logoBase64} alt="Company Logo" className="mx-auto h-20 w-auto object-contain" />
                ) : (
                    <MikroTikLogoIcon className="mx-auto h-16 w-auto text-[--color-primary-500]" />
                )}
                <h1 className="mt-4 text-3xl font-extrabold text-slate-900 dark:text-slate-100">
                    Mikrotik Billling Management by AJC
                </h1>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white dark:bg-slate-800 py-8 px-4 shadow-lg sm:rounded-lg sm:px-10 border border-slate-200 dark:border-slate-700">
                    {children}
                </div>
            </div>
        </div>
    );
};
