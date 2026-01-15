
import React from 'react';
import type { View } from '../types.ts';
import { KeyIcon } from '../constants.tsx';

interface UnlicensedComponentProps {
    setCurrentView: (view: View) => void;
}

export const UnlicensedComponent: React.FC<UnlicensedComponentProps> = ({ setCurrentView }) => {
    return (
        <div className="flex flex-col items-center justify-center h-full text-center bg-white dark:bg-slate-800 rounded-lg border border-yellow-300 dark:border-yellow-700 p-8">
            <KeyIcon className="w-16 h-16 text-yellow-500 dark:text-yellow-400 mb-4" />
            <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">Feature Locked</h2>
            <p className="mt-2 max-w-md text-slate-500 dark:text-slate-400">
                This feature requires an active license. Please activate your panel to unlock all features.
            </p>
            <button
                onClick={() => setCurrentView('license')}
                className="mt-6 px-6 py-3 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-bold rounded-lg transition-colors"
            >
                Activate License
            </button>
        </div>
    );
};
