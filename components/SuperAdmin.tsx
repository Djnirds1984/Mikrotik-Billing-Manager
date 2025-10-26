import React, { useState } from 'react';
import { Loader } from './Loader.tsx';
import { getAuthHeader } from '../services/databaseService.ts';
import { CodeBlock } from './CodeBlock.tsx';
import { LockClosedIcon } from '../constants.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';

export const SuperAdmin: React.FC = () => {
    const [deviceId, setDeviceId] = useState('');
    const [days, setDays] = useState(365);
    const [generatedKey, setGeneratedKey] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const { logout } = useAuth();
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isPasswordSaving, setIsPasswordSaving] = useState(false);
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

    const handleGenerate = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        setGeneratedKey('');
        try {
            const res = await fetch('/api/license/generate', {
                method: 'POST',
                headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceId, days }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || 'Failed to generate key');
            }
            setGeneratedKey(data.licenseKey);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordError(null);
        setPasswordSuccess(null);

        if (newPassword !== confirmPassword) {
            setPasswordError('Passwords do not match.');
            return;
        }
        if (newPassword.length < 6) {
            setPasswordError('Password must be at least 6 characters long.');
            return;
        }

        setIsPasswordSaving(true);
        try {
            const res = await fetch('/api/auth/change-superadmin-password', {
                method: 'POST',
                headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ newPassword }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || 'Failed to update password.');
            }
            setPasswordSuccess('Password updated! You will be logged out shortly.');
            setTimeout(() => {
                logout();
            }, 2000);
        } catch (err) {
            setPasswordError((err as Error).message);
        } finally {
            setIsPasswordSaving(false);
        }
    };


    return (
        <div className="max-w-2xl mx-auto space-y-8">
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">License Key Generator</h2>
                <p className="text-sm text-slate-500 mt-1">This tool is for developers to generate license keys for users.</p>

                {error && <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-md">{error}</div>}

                <form onSubmit={handleGenerate} className="mt-6 space-y-4">
                    <div>
                        <label htmlFor="deviceId" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Device ID</label>
                        <input
                            id="deviceId"
                            type="text"
                            value={deviceId}
                            onChange={e => setDeviceId(e.target.value)}
                            required
                            className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white font-mono"
                            placeholder="Paste the user's Device ID here"
                        />
                    </div>
                     <div>
                        <label htmlFor="days" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Validity (Days)</label>
                        <input
                            id="days"
                            type="number"
                            value={days}
                            onChange={e => setDays(parseInt(e.target.value, 10))}
                            required
                            min="1"
                            className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                        />
                    </div>
                     <div className="flex justify-end">
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="px-6 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-semibold rounded-lg disabled:opacity-50 flex items-center gap-2"
                        >
                            {isLoading && <Loader />}
                            {isLoading ? 'Generating...' : 'Generate License Key'}
                        </button>
                    </div>
                </form>

                {generatedKey && (
                    <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
                         <h3 className="text-lg font-semibold">Generated License Key</h3>
                         <div className="mt-2 h-48 bg-slate-50 dark:bg-slate-900 rounded-lg p-2 border border-slate-200 dark:border-slate-600">
                            <CodeBlock script={generatedKey} />
                         </div>
                    </div>
                )}
            </div>
            
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-3">
                    <LockClosedIcon className="w-6 h-6" />
                    Change Superadmin Password
                </h2>

                {passwordError && <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-md">{passwordError}</div>}
                {passwordSuccess && <div className="mt-4 p-3 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-md">{passwordSuccess}</div>}

                <form onSubmit={handlePasswordChange} className="mt-6 space-y-4">
                    <div>
                        <label htmlFor="newPassword" className="block text-sm font-medium text-slate-700 dark:text-slate-300">New Password</label>
                        <input
                            id="newPassword"
                            type="password"
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                            required
                            className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                        />
                    </div>
                     <div>
                        <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Confirm New Password</label>
                        <input
                            id="confirmPassword"
                            type="password"
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            required
                            className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                        />
                    </div>
                     <div className="flex justify-end">
                        <button
                            type="submit"
                            disabled={isPasswordSaving}
                            className="px-6 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-semibold rounded-lg disabled:opacity-50 flex items-center gap-2"
                        >
                            {isPasswordSaving && <Loader />}
                            {isPasswordSaving ? 'Saving...' : 'Save Password'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};