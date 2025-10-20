import React from 'react';
import { MikroTikLogoIcon } from '../constants.tsx';

export const AuthLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return (
        <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col justify-center items-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
                <MikroTikLogoIcon className="mx-auto h-16 w-auto text-[--color-primary-500]" />
                <h1 className="mt-4 text-3xl font-extrabold text-slate-900 dark:text-slate-100">
                    MikroTik Orange Pi Manager
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
