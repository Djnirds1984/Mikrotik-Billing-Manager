import React from 'react';
import type { RouterConfigWithId } from '../types.ts';

export const PanelHotspot: React.FC<{ selectedRouter: RouterConfigWithId | null }> = ({ selectedRouter }) => {
    return (
        <div className="p-6 bg-slate-50 dark:bg-slate-800 rounded-lg">
            <h2 className="text-2xl font-bold">Panel Hotspot</h2>
            <p className="mt-2 text-slate-600 dark:text-slate-400">
                This feature is under construction. It will manage voucher-based hotspot access through the panel.
            </p>
        </div>
    );
};
