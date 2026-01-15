import React, { useState, useMemo } from 'react';
import type { HotspotHost } from '../types.ts';
import { ChipIcon } from '../constants.tsx';

// A single host item in the list
const HostItem: React.FC<{ host: HotspotHost; onSelect: () => void; }> = ({ host, onSelect }) => {
    return (
        <li className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
            <div className="flex items-center gap-4">
                <ChipIcon className="h-8 w-8 text-[--color-primary-500] dark:text-[--color-primary-400]" />
                <div>
                    <p className="font-semibold text-slate-900 dark:text-slate-100 font-mono">{host.address}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 font-mono">{host.macAddress}</p>
                    {host.comment && <p className="text-xs text-slate-400 italic mt-1">Comment: {host.comment}</p>}
                </div>
            </div>
            <div className="flex items-center space-x-2">
                <button 
                    onClick={onSelect} 
                    className="px-4 py-2 text-sm bg-sky-600 hover:bg-sky-500 text-white rounded-md font-semibold"
                >
                    Settings
                </button>
            </div>
        </li>
    );
};

// This component receives the list of hosts as a prop. It does not fetch its own data.
export const NodeMcuManager: React.FC<{ hosts: HotspotHost[] | null }> = ({ hosts }) => {
    const [selectedHost, setSelectedHost] = useState<HotspotHost | null>(null);

    const nodeMcuHosts = useMemo(() => {
        if (!hosts) return [];
        const keywords = ['vendo', 'vendo1', 'pisowifi'];
        return hosts.filter(host => {
            if (!host.comment) return false;
            const lowerCaseComment = host.comment.toLowerCase();
            return keywords.some(keyword => lowerCaseComment.includes(keyword));
        });
    }, [hosts]);

    // Iframe view when a host is selected
    if (selectedHost) {
        return (
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md flex flex-col h-[75vh] min-h-[600px]">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center flex-shrink-0">
                    <div>
                        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                            Vendo Settings
                        </h3>
                        <p className="text-sm font-mono text-cyan-500">{selectedHost.address}</p>
                    </div>
                    <button 
                        onClick={() => setSelectedHost(null)}
                        className="px-4 py-2 bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500 text-slate-800 dark:text-white rounded-lg font-semibold"
                    >
                        &larr; Back to List
                    </button>
                </div>
                <div className="flex-grow p-4">
                    <iframe
                        src={`http://${selectedHost.address}/admin#`}
                        title={`Settings for ${selectedHost.address}`}
                        className="w-full h-full border-2 border-slate-300 dark:border-slate-600 rounded-md"
                        sandbox="allow-forms allow-scripts allow-same-origin"
                    />
                </div>
                <div className="p-2 border-t border-slate-200 dark:border-slate-700 text-center text-xs text-slate-400">
                    You are viewing the device's web panel directly. All actions inside this frame are performed on the device.
                </div>
            </div>
        );
    }
    
    // List view of all available hosts
    return (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
             <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                    <ChipIcon className="w-6 h-6 text-[--color-primary-500]"/> 
                    Detected NodeMCU Vendo Machines
                </h3>
                <p className="text-sm text-slate-500 mt-1">This list is filtered from Hotspot hosts to show devices with a comment containing 'vendo', 'vendo1', or 'pisowifi'.</p>
            </div>
             <ul role="list" className="divide-y divide-slate-200 dark:divide-slate-700">
                {nodeMcuHosts.length > 0 ? (
                    nodeMcuHosts.map(host => (
                        <HostItem key={host.id} host={host} onSelect={() => setSelectedHost(host)} />
                    ))
                ) : (
                    <li className="p-6 text-center text-slate-500">
                        No Vendo machines detected among the active Hotspot hosts with a matching comment.
                    </li>
                )}
            </ul>
        </div>
    );
};