import React, { useState } from 'react';
import { Loader } from './Loader.tsx';
import { getAuthHeader } from '../services/databaseService.ts';
import { CodeBlock } from './CodeBlock.tsx';

export const SuperAdmin: React.FC = () => {
    const [deviceId, setDeviceId] = useState('');
    const [days, setDays] = useState(365);
    const [generatedKey, setGeneratedKey] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
        </div>
    );
};
