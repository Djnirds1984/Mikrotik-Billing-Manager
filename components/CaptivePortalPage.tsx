import React from 'react';
import { MikroTikLogoIcon } from '../constants.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';

export const CaptivePortalPage: React.FC = () => {
    // We can use hooks here because the component is wrapped in providers in App.tsx
    useTheme();

    return (
        <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col justify-center items-center py-12 px-4">
            <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
                <MikroTikLogoIcon className="mx-auto h-16 w-auto text-[--color-primary-500]" />
            </div>
            <div className="mt-8 bg-white dark:bg-slate-800 py-8 px-4 shadow-lg sm:rounded-lg sm:px-10 border border-slate-200 dark:border-slate-700 w-full max-w-lg">
                <h1 className="text-center text-3xl font-extrabold text-[--color-primary-600] dark:text-[--color-primary-400]">
                    Activation Required
                </h1>
                <p className="mt-4 text-center text-slate-600 dark:text-slate-300">
                    Your device is connected to the network, but you do not have internet access yet.
                </p>
                <p className="mt-2 text-center text-slate-600 dark:text-slate-300">
                    Please contact the network administrator to activate your service.
                </p>
            </div>
        </div>
    );
};