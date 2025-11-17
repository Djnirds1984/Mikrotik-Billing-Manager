import React, { useState, useEffect } from 'react';
import type { CompanySettings } from '../types.ts';
import { BuildingOffice2Icon } from '../constants.tsx';
import { Loader } from './Loader.tsx';

interface CompanyProps {
    settings: CompanySettings;
    onSave: (settings: CompanySettings) => Promise<void>;
}

export const Company: React.FC<CompanyProps> = ({ settings, onSave }) => {
    const [formState, setFormState] = useState<CompanySettings>({});
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

    useEffect(() => {
        setFormState(settings);
    }, [settings]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: value }));
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > 2 * 1024 * 1024) { // 2MB limit
                alert("File is too large. Please upload an image under 2MB.");
                return;
            }
            const reader = new FileReader();
            reader.onloadend = () => {
                setFormState(prev => ({ ...prev, logoBase64: reader.result as string }));
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setStatus(null);
        try {
            await onSave(formState);
            setStatus({ type: 'success', message: 'Company settings saved successfully!' });
        } catch (err) {
            setStatus({ type: 'error', message: `Failed to save: ${(err as Error).message}` });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
                    <BuildingOffice2Icon className="w-6 h-6 text-[--color-primary-500] dark:text-[--color-primary-400]" />
                    <h3 className="text-lg font-semibold text-[--color-primary-500] dark:text-[--color-primary-400]">Company Branding & Information</h3>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="p-6 space-y-6">
                        {/* Logo Section */}
                        <div className="flex flex-col sm:flex-row items-start gap-6">
                            <div className="flex-shrink-0">
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Company Logo</label>
                                <div className="w-48 h-24 bg-slate-100 dark:bg-slate-700 rounded-md flex items-center justify-center border border-slate-300 dark:border-slate-600">
                                    {formState.logoBase64 ? (
                                        <img src={formState.logoBase64} alt="Logo Preview" className="max-w-full max-h-full object-contain" />
                                    ) : (
                                        <span className="text-slate-500 text-xs">No Logo</span>
                                    )}
                                </div>
                            </div>
                            <div className="flex-grow">
                                <label htmlFor="logo-upload" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Upload Logo</label>
                                <input 
                                    id="logo-upload"
                                    type="file" 
                                    accept="image/png, image/jpeg, image/gif, image/svg+xml"
                                    onChange={handleFileChange}
                                    className="block w-full text-sm text-slate-500 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-[--color-primary-600] file:text-white hover:file:bg-[--color-primary-500]"
                                />
                                <p className="mt-1 text-xs text-slate-500">Recommended: PNG or SVG with transparent background. Max 2MB.</p>
                            </div>
                        </div>

                        {/* Text Fields */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-slate-200 dark:border-slate-700">
                             <div>
                                <label htmlFor="companyName" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Company Name</label>
                                <input type="text" name="companyName" id="companyName" value={formState.companyName || ''} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                            </div>
                            <div>
                                <label htmlFor="contactNumber" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Contact Number</label>
                                <input type="tel" name="contactNumber" id="contactNumber" value={formState.contactNumber || ''} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                            </div>
                        </div>
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Email Address</label>
                            <input type="email" name="email" id="email" value={formState.email || ''} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                        </div>
                        <div>
                            <label htmlFor="address" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Address</label>
                            <textarea name="address" id="address" value={formState.address || ''} onChange={handleChange} rows={3} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"></textarea>
                        </div>

                        {/* Xendit Payment Gateway Configuration */}
                        <div className="md:col-span-2 pt-6 border-t border-slate-200 dark:border-slate-700">
                            <h4 className="text-lg font-medium text-slate-900 dark:text-white mb-4">Xendit Payment Gateway</h4>
                            <div className="space-y-4">
                                <div className="flex items-center">
                                    <input
                                        type="checkbox"
                                        id="xenditEnabled"
                                        name="xenditEnabled"
                                        checked={formState.xenditEnabled || false}
                                        onChange={(e) => setFormState(prev => ({ ...prev, xenditEnabled: e.target.checked }))}
                                        className="h-4 w-4 text-[--color-primary-600] bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded focus:ring-[--color-primary-500]"
                                    />
                                    <label htmlFor="xenditEnabled" className="ml-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                                        Enable Xendit Payment Gateway
                                    </label>
                                </div>

                                {formState.xenditEnabled && (
                                    <>
                                        <div>
                                            <label htmlFor="xenditSecretKey" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                                                Xendit Secret API Key
                                                <span className="text-red-500 ml-1">*</span>
                                            </label>
                                            <input
                                                type="password"
                                                name="xenditSecretKey"
                                                id="xenditSecretKey"
                                                value={formState.xenditSecretKey || ''}
                                                onChange={handleChange}
                                                placeholder="xnd_development_..."
                                                className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                                            />
                                            <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">
                                                Your Xendit secret API key from the dashboard
                                            </p>
                                        </div>

                                        <div>
                                            <label htmlFor="xenditPublicKey" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                                                Xendit Public API Key
                                            </label>
                                            <input
                                                type="text"
                                                name="xenditPublicKey"
                                                id="xenditPublicKey"
                                                value={formState.xenditPublicKey || ''}
                                                onChange={handleChange}
                                                placeholder="xnd_public_..."
                                                className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                                            />
                                            <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">
                                                Your Xendit public API key (optional, for client-side operations)
                                            </p>
                                        </div>

                                        <div>
                                            <label htmlFor="xenditWebhookToken" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                                                Xendit Webhook Token
                                            </label>
                                            <input
                                                type="text"
                                                name="xenditWebhookToken"
                                                id="xenditWebhookToken"
                                                value={formState.xenditWebhookToken || ''}
                                                onChange={handleChange}
                                                placeholder="Your webhook verification token"
                                                className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                                            />
                                            <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">
                                                Token for verifying Xendit webhooks (recommended for security)
                                            </p>
                                        </div>

                                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                                            <h5 className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-2">Setup Instructions:</h5>
                                            <ol className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
                                                <li>1. Sign up at <a href="https://www.xendit.co" target="_blank" rel="noopener noreferrer" className="underline">xendit.co</a></li>
                                                <li>2. Get your API keys from the Xendit Dashboard</li>
                                                <li>3. Configure webhook URL: <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">{window.location.origin}/api/xendit/webhook</code></li>
                                                <li>4. Set webhook token for security verification</li>
                                            </ol>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                         
                        {status && (
                            <div className={`mt-4 text-sm p-3 rounded-md ${status.type === 'success' ? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300'}`}>
                                {status.message}
                            </div>
                        )}
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-4 flex justify-end rounded-b-lg">
                        <button type="submit" disabled={isLoading} className="px-6 py-2 font-semibold bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white rounded-lg disabled:opacity-50 flex items-center gap-2">
                            {isLoading && <Loader />}
                            {isLoading ? 'Saving...' : 'Save Settings'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
