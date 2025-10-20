import React, { useState, useEffect } from 'react';
import { Loader } from './Loader.tsx';
import { KeyIcon, CheckCircleIcon, ExclamationTriangleIcon, TrashIcon } from '../constants.tsx';
import type { LicenseStatus } from '../types.ts';
import { getAuthHeader } from '../services/databaseService.ts';

interface LicenseProps {
    onLicenseChange: () => void;
    licenseStatus: LicenseStatus | null;
}

export const License: React.FC<LicenseProps> = ({ onLicenseChange, licenseStatus }) => {
    const [newLicenseKey, setNewLicenseKey] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [message, setMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null);

    const deviceId = licenseStatus?.deviceId;

    const handleActivate = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setMessage(null);
        try {
            const res = await fetch('/api/license/activate', {
                method: 'POST',
                headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ licenseKey: newLicenseKey }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || `Activation failed with status: ${res.status}`);
            }
            
            setMessage({ type: 'success', text: 'License activated successfully! Reloading panel...' });
            setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
            setMessage({ type: 'error', text: (err as Error).message });
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleRevoke = async () => {
        if (!window.confirm('Are you sure you want to permanently revoke this license? The panel will become unlicensed.')) return;
        setIsSubmitting(true);
        setMessage(null);
        try {
            const res = await fetch('/api/license/revoke', {
                method: 'POST',
                headers: getAuthHeader(),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            
            setMessage({ type: 'success', text: 'License revoked. Reloading...' });
            setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
            setMessage({ type: 'error', text: (err as Error).message });
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const copyToClipboard = (text: string | undefined) => {
        if (!text) return;
        navigator.clipboard.writeText(text);
        alert('Copied to clipboard!');
    };

    if (licenseStatus?.licensed) {
        return (
            <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-4">
                <div className="w-full max-w-2xl bg-white dark:bg-slate-800 p-8 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700">
                    <div className="text-center">
                        <CheckCircleIcon className="w-16 h-16 text-green-500 mx-auto mb-4" />
                        <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Application Licensed</h2>
                        <p className="mt-2 text-slate-500 dark:text-slate-400">
                           This panel is activated. Expires on: {new Date(licenseStatus.expires || '').toLocaleDateString()}
                        </p>
                    </div>

                    <div className="my-6 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Your Device ID</label>
                            <input type="text" readOnly value={licenseStatus.deviceId} className="w-full p-3 font-mono text-sm bg-slate-100 dark:bg-slate-700 border rounded-md" />
                        </div>
                         <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Active License Key</label>
                            <div className="flex items-center gap-2">
                                <textarea readOnly value={licenseStatus.licenseKey} className="flex-grow p-3 font-mono text-xs bg-slate-100 dark:bg-slate-700 border rounded-md resize-none" rows={3} />
                                <button onClick={() => copyToClipboard(licenseStatus.licenseKey)} className="px-4 py-2 bg-slate-200 dark:bg-slate-600 rounded-md hover:bg-slate-300 dark:hover:bg-slate-500 self-start">Copy</button>
                            </div>
                        </div>
                    </div>
                    
                    {message && (
                        <div className={`my-4 text-sm p-3 rounded-md ${message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {message.text}
                        </div>
                    )}
                    
                    <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-700">
                         <button onClick={handleRevoke} disabled={isSubmitting} className="w-full flex justify-center items-center gap-2 py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50">
                            {isSubmitting ? <Loader /> : <TrashIcon className="w-5 h-5" />}
                            Revoke License
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-white dark:bg-slate-800 p-8 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700">
                <div className="text-center">
                    <ExclamationTriangleIcon className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
                    <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Application is Unlicensed</h2>
                    <p className="mt-2 text-slate-500 dark:text-slate-400">
                        Please provide your Device ID to the administrator to receive a license key.
                    </p>
                </div>
                
                {!deviceId && !licenseStatus?.error && <div className="flex justify-center my-8"><Loader /></div>}
                
                {licenseStatus?.error && (
                    <div className="my-4 text-sm p-3 rounded-md bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border border-red-300 dark:border-red-700">
                        <p className="font-bold">Server Error:</p>
                        <p>{licenseStatus.error}</p>
                    </div>
                )}

                {deviceId && (
                    <div className="my-8">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Your Device ID</label>
                        <div className="flex items-center gap-2">
                            <input type="text" readOnly value={deviceId} className="flex-grow p-3 font-mono text-sm bg-slate-100 dark:bg-slate-700 border rounded-md" />
                            <button onClick={() => copyToClipboard(deviceId)} className="px-4 py-2 bg-slate-200 dark:bg-slate-600 rounded-md hover:bg-slate-300 dark:hover:bg-slate-500">Copy</button>
                        </div>
                    </div>
                )}
                
                {message && (
                    <div className={`my-4 text-sm p-3 rounded-md ${message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {message.text}
                    </div>
                )}
                
                <form onSubmit={handleActivate} className="space-y-4">
                     <div>
                        <label htmlFor="licenseKey" className="block text-sm font-medium text-slate-700 dark:text-slate-300">License Key</label>
                        <textarea
                            id="licenseKey"
                            value={newLicenseKey}
                            onChange={(e) => setNewLicenseKey(e.target.value)}
                            required
                            rows={4}
                            className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-[--color-primary-500] focus:border-[--color-primary-500] font-mono text-xs"
                            placeholder="Paste the license key provided by the administrator here."
                        />
                    </div>
                     <div>
                        <button
                            type="submit"
                            disabled={isSubmitting || !deviceId}
                            className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-[--color-primary-600] hover:bg-[--color-primary-700] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[--color-primary-500] disabled:opacity-50"
                        >
                            {isSubmitting ? <Loader /> : 'Validate & Activate'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};