import React from 'react';
import { Loader } from './Loader.tsx';
import { CheckCircleIcon, ExclamationTriangleIcon } from '../constants.tsx';
import type { LicenseStatus } from '../types.ts';

interface LicenseProps {
    onLicenseChange: () => void;
    licenseStatus: LicenseStatus | null;
}

export const License: React.FC<LicenseProps> = ({ onLicenseChange, licenseStatus }) => {
    if (!licenseStatus) {
        return <div className="flex justify-center my-8"><Loader /></div>;
    }

    const hasError = Boolean(licenseStatus.error) || !licenseStatus.licensed;

    return (
        <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-white dark:bg-slate-800 p-8 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700">
                <div className="text-center">
                    {hasError ? (
                        <ExclamationTriangleIcon className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
                    ) : (
                        <CheckCircleIcon className="w-16 h-16 text-green-500 mx-auto mb-4" />
                    )}
                    <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                        {hasError ? 'Panel Status Unavailable' : 'Local Mode'}
                    </h2>
                    <p className="mt-2 text-slate-500 dark:text-slate-400">
                        {hasError
                            ? (licenseStatus.error || licenseStatus.message || 'Unable to load the panel status. Please try again.')
                            : 'Online license activation and verification are disabled. No license key is required.'}
                    </p>
                </div>

                {!hasError && (
                    <div className="my-6 space-y-4">
                        <p className="text-sm text-slate-600 dark:text-slate-300">
                            Customer, billing, and sales records remain in the local database. Use Database Settings to manage backups.
                        </p>
                        {licenseStatus.deviceId && (
                            <div>
                                <label htmlFor="deviceId" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Your CPU Hardware ID</label>
                                <input id="deviceId" type="text" readOnly value={licenseStatus.deviceId} className="w-full p-3 font-mono text-sm bg-slate-100 dark:bg-slate-700 border rounded-md" />
                            </div>
                        )}
                        {licenseStatus.maxRouters && (
                            <p className="text-sm text-slate-600 dark:text-slate-300">Max Routers: {licenseStatus.maxRouters}</p>
                        )}
                    </div>
                )}

                {hasError && (
                    <button onClick={onLicenseChange} className="mt-6 w-full py-3 px-4 rounded-md text-sm font-medium text-white bg-[--color-primary-600] hover:bg-[--color-primary-700]">
                        Retry
                    </button>
                )}
            </div>
        </div>
    );
};
