import React, { useState, useEffect, useCallback } from 'react';
import type { RouterConfigWithId, Interface } from '../types.ts';
import { getInterfaces, runDhcpCaptivePortalSetup } from '../services/mikrotikService.ts';
import { Loader } from './Loader.tsx';
import { ServerIcon, CogIcon, ExclamationTriangleIcon, CheckCircleIcon } from '../constants.tsx';

export const DhcpCaptivePortalInstaller: React.FC<{ selectedRouter: RouterConfigWithId }> = ({ selectedRouter }) => {
    const [panelIp, setPanelIp] = useState('');
    const [lanInterface, setLanInterface] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isInstalling, setIsInstalling] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    useEffect(() => {
        const fetchRequiredData = async () => {
            if (!selectedRouter) return;
            setIsLoading(true);
            setError(null);
            setSuccessMessage(null);
            try {
                // Auto-detect panel IP
                setPanelIp(window.location.hostname);

                // Fetch interfaces to find a default LAN bridge
                const interfaces = await getInterfaces(selectedRouter);
                const bridge = interfaces.find(i => i.name === 'bridge' || i.name.toLowerCase().includes('lan'));
                if (bridge) {
                    setLanInterface(bridge.name);
                } else if (interfaces.length > 0) {
                    setLanInterface(interfaces[0].name); // fallback
                }
            } catch (err) {
                setError(`Failed to load initial configuration data from the router: ${(err as Error).message}`);
            } finally {
                setIsLoading(false);
            }
        };

        fetchRequiredData();
    }, [selectedRouter]);

    const handleInstall = async () => {
        if (!window.confirm("This will add multiple scripts and firewall rules to your router. It's recommended for a basic configuration. Are you sure you want to proceed?")) {
            return;
        }

        setIsInstalling(true);
        setError(null);
        setSuccessMessage(null);
        try {
            const result = await runDhcpCaptivePortalSetup(selectedRouter, { panelIp, lanInterface });
            setSuccessMessage(result.message);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsInstalling(false);
        }
    };

    if (isLoading) {
        return <div className="flex justify-center p-8"><Loader /></div>;
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center gap-4">
                <ServerIcon className="w-10 h-10 text-[--color-primary-500]" />
                <div>
                    <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">DHCP Captive Portal Installer</h2>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                        This tool will install the necessary Address Lists, DHCP Server scripts, and Firewall rules on your MikroTik router to enable a MAC-based captive portal system.
                    </p>
                </div>
            </div>

            <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700/50 text-amber-900 dark:text-amber-200 flex items-start gap-3">
                <ExclamationTriangleIcon className="w-6 h-6 text-amber-500 flex-shrink-0 mt-1" />
                <div>
                    <h4 className="font-bold">Warning</h4>
                    <p className="text-sm text-amber-800 dark:text-amber-300">
                        This is a powerful tool that will add multiple rules to your router. It is designed for a router with a basic configuration. Run on a production router with caution. It assumes a DHCP server is already running.
                    </p>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
                    <CogIcon className="w-6 h-6 text-[--color-primary-500]" />
                    <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">System Configuration</h3>
                </div>
                <div className="p-6 space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Portal Server IP Address</label>
                        <div className="mt-1 p-3 bg-slate-100 dark:bg-slate-700 rounded-md font-mono text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-600">
                            {panelIp || 'Detecting...'}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">The IP address of the server hosting this panel (e.g., your Orange Pi). The panel will try to auto-detect this.</p>
                    </div>
                     <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Primary LAN Interface</label>
                        <div className="mt-1 p-3 bg-slate-100 dark:bg-slate-700 rounded-md font-mono text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-600">
                            {lanInterface || 'Detecting...'}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">The name of the main LAN bridge where your DHCP server is running.</p>
                    </div>

                    {error && <div className="p-3 my-4 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-md text-sm">{error}</div>}
                    {successMessage && <div className="p-3 my-4 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-md text-sm flex items-center gap-2"><CheckCircleIcon className="w-5 h-5" />{successMessage}</div>}

                    <div className="flex justify-center pt-4">
                        <button 
                            onClick={handleInstall} 
                            disabled={isInstalling || !panelIp || !lanInterface}
                            className="w-full sm:w-auto px-8 py-3 bg-[--color-primary-600] hover:bg-[--color-primary-700] text-white font-bold rounded-lg flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                        >
                            {isInstalling ? <Loader /> : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>}
                            {isInstalling ? 'Installing...' : 'Install Portal System Components'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
