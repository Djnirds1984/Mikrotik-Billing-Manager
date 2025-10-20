import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ZeroTierNetwork, ZeroTierInfo } from '../types.ts';
import { getZeroTierStatus, joinZeroTierNetwork, leaveZeroTierNetwork, setZeroTierNetworkSetting } from '../services/zeroTierPanelService.ts';
import { Loader } from './Loader.tsx';
import { TrashIcon, ZeroTierIcon, ExclamationTriangleIcon, CheckCircleIcon } from '../constants.tsx';
import { CodeBlock } from './CodeBlock.tsx';
import { SudoInstructionBox } from './SudoInstructionBox.tsx';

// --- Local Components ---
const LogViewer: React.FC<{ logs: string[] }> = ({ logs }) => {
    const logContainerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div ref={logContainerRef} className="bg-slate-100 dark:bg-slate-900 text-xs font-mono text-slate-700 dark:text-slate-300 p-4 rounded-md h-64 overflow-y-auto border border-slate-200 dark:border-slate-600">
            {logs.map((log, index) => (
                <pre key={index} className="whitespace-pre-wrap break-words">{log}</pre>
            ))}
        </div>
    );
};

const AddNetworkModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (networkId: string) => void;
    isLoading: boolean;
}> = ({ isOpen, onClose, onSave, isLoading }) => {
    const [networkId, setNetworkId] = useState('');

    useEffect(() => {
        if (isOpen) setNetworkId('');
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(networkId);
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg border border-slate-200 dark:border-slate-700">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400] mb-4">Join ZeroTier Network</h3>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="networkId" className="block text-sm font-medium text-slate-700 dark:text-slate-300">16-digit Network ID</label>
                                <input
                                    type="text"
                                    name="networkId"
                                    id="networkId"
                                    value={networkId}
                                    onChange={(e) => setNetworkId(e.target.value)}
                                    required
                                    pattern="^[0-9a-fA-F]{16}$"
                                    title="Please enter a 16-character hexadecimal Network ID"
                                    className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white font-mono tracking-wider focus:outline-none focus:ring-[--color-primary-500]"
                                    placeholder="e.g., 8056c2e21c000001"
                                />
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                        <button type="button" onClick={onClose} disabled={isLoading} className="px-4 py-2 text-sm font-medium rounded-md text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 disabled:opacity-50">Cancel</button>
                        <button type="submit" disabled={isLoading || !networkId.match(/^[0-9a-fA-F]{16}$/)} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-[--color-primary-600] hover:bg-[--color-primary-500] disabled:opacity-50 disabled:cursor-not-allowed">
                            {isLoading ? 'Joining...' : 'Join Network'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const ToggleSwitch: React.FC<{ checked: boolean; onChange: () => void; disabled?: boolean; }> = ({ checked, onChange, disabled }) => (
    <label className="relative inline-flex items-center cursor-pointer">
        <input
            type="checkbox"
            checked={checked}
            onChange={onChange}
            disabled={disabled}
            className="sr-only peer"
        />
        <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 rounded-full peer peer-focus:ring-2 peer-focus:ring-[--color-primary-500] peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[--color-primary-600] disabled:opacity-50"></div>
    </label>
);


// --- Main Component ---
export const ZeroTier: React.FC = () => {
    const [status, setStatus] = useState<'loading' | 'ready' | 'not_installed' | 'service_down' | 'error' | 'installing' | 'install_success' | 'sudo_error'>('loading');
    const [data, setData] = useState<{ info: ZeroTierInfo; networks: ZeroTierNetwork[] } | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string>('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [installLogs, setInstallLogs] = useState<string[]>([]);


    const fetchData = useCallback(async () => {
        setStatus('loading');
        setInstallLogs([]); // Clear logs on fetch
        try {
            const result = await getZeroTierStatus();
            setData(result);
            setStatus('ready');
        } catch (err) {
            const error = err as any;
            console.error("Failed to fetch ZeroTier status:", error);
            if (error?.data?.code === 'SUDO_PASSWORD_REQUIRED') {
                setStatus('sudo_error');
            } else if (error?.data?.code === 'ZEROTIER_NOT_INSTALLED') {
                setStatus('not_installed');
            } else if (error?.data?.code === 'ZEROTIER_SERVICE_DOWN') {
                setStatus('service_down');
            } else {
                setStatus('error');
                setErrorMessage(error.message || 'An unknown error occurred.');
            }
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleInstall = () => {
        setStatus('installing');
        setInstallLogs([]);
        const eventSource = new EventSource('/api/zt/install');

        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.log) {
                setInstallLogs(prev => [...prev, data.log.trim()]);
            }
            if (data.status === 'success') {
                 setStatus('install_success');
            }
            if (data.status === 'error') {
                setStatus('error');
                setErrorMessage(data.message || "Installation failed. Check the logs.");
            }
            if (data.status === 'finished') {
                eventSource.close();
            }
        };
        eventSource.onerror = () => {
            setStatus('error');
            setErrorMessage('Connection to the server was lost during installation.');
            eventSource.close();
        };
    };

    const handleJoin = async (networkId: string) => {
        setIsSubmitting(true);
        try {
            await joinZeroTierNetwork(networkId);
            setIsModalOpen(false);
            setTimeout(fetchData, 1000);
        } catch (err) {
            alert(`Error joining network: ${(err as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleLeave = async (nwid: string) => {
        if (!window.confirm(`Are you sure you want to leave network ${nwid}?`)) return;
        setIsSubmitting(true);
        try {
            await leaveZeroTierNetwork(nwid);
            await fetchData();
        } catch (err) {
            alert(`Error leaving network: ${(err as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleToggle = async (nwid: string, setting: 'allowManaged' | 'allowGlobal' | 'allowDefault', value: boolean) => {
        setData(prev => {
            if (!prev) return null;
            return {
                ...prev,
                networks: prev.networks.map(n => n.nwid === nwid ? { ...n, [setting]: value } : n)
            };
        });
        try {
            await setZeroTierNetworkSetting(nwid, setting, value);
        } catch (err) {
            alert(`Error updating setting: ${(err as Error).message}`);
            fetchData();
        }
    };

    const getStatusChip = (status: string) => {
        switch (status) {
            case 'OK': return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400">OK</span>;
            case 'ACCESS_DENIED': return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400">Access Denied</span>;
            case 'NOT_FOUND': return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400">Not Found</span>;
            case 'REQUESTING_CONFIGURATION': return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-400">Configuring...</span>;
            default: return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-slate-200 dark:bg-slate-600/50 text-slate-600 dark:text-slate-400">{status}</span>;
        }
    };
    
    // --- RENDER LOGIC ---

    if (status === 'loading') {
        return (
            <div className="flex flex-col items-center justify-center h-64">
                <Loader />
                <p className="mt-4 text-[--color-primary-500] dark:text-[--color-primary-400]">Fetching ZeroTier status from panel host...</p>
            </div>
        );
    }

    if (status === 'sudo_error') {
        return (
            <div className="bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700/50 rounded-lg p-8 max-w-3xl mx-auto">
                <div className="text-center">
                    <ExclamationTriangleIcon className="w-16 h-16 text-amber-500 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Sudo Permission Error</h2>
                    <p className="mt-2 text-slate-500 dark:text-slate-400">The panel requires passwordless `sudo` access to manage ZeroTier but was prompted for a password.</p>
                </div>
                
                <div className="my-6">
                    <SudoInstructionBox />
                </div>
                
                <div className="mt-6 text-center">
                    <button onClick={fetchData} className="px-5 py-2.5 bg-[--color-primary-600] hover:bg-[--color-primary-500] rounded-lg font-semibold text-white">
                        Re-check Status
                    </button>
                </div>
            </div>
        );
    }

    if (status === 'not_installed' || status === 'installing' || status === 'install_success') {
        return (
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-8 max-w-3xl mx-auto">
                <div className="text-center">
                    <ZeroTierIcon className="w-16 h-16 text-[--color-primary-500] mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">ZeroTier One Not Found</h2>
                    <p className="mt-2 text-slate-500 dark:text-slate-400">The `zerotier-cli` command was not found on this system. Please install it to continue.</p>
                </div>
                
                {status === 'installing' && (
                    <div className="mt-6">
                        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-2">Installation in Progress...</h3>
                        <LogViewer logs={installLogs} />
                    </div>
                )}
                
                {status === 'install_success' && (
                     <div className="mt-6 p-4 rounded-lg bg-green-50 dark:bg-green-900/50 border border-green-200 dark:border-green-700 text-center">
                        <CheckCircleIcon className="w-12 h-12 text-green-500 dark:text-green-400 mx-auto mb-2" />
                        <h3 className="text-lg font-semibold text-green-800 dark:text-green-300">Installation Successful!</h3>
                        <p className="text-green-700/80 dark:text-green-400/80 text-sm">You can now re-check the status to manage ZeroTier.</p>
                    </div>
                )}
                
                {status !== 'installing' && (
                    <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-4 pt-6 border-t border-slate-200 dark:border-slate-700">
                        <button onClick={handleInstall} className="px-5 py-2.5 bg-[--color-primary-600] hover:bg-[--color-primary-500] rounded-lg font-semibold text-white w-full sm:w-auto">
                           Install Automatically
                        </button>
                        <button onClick={fetchData} className="px-5 py-2.5 bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500 text-slate-800 dark:text-white rounded-lg font-semibold w-full sm:w-auto">
                           Re-check Status
                        </button>
                    </div>
                )}
                <div className="mt-6">
                    <SudoInstructionBox />
                </div>
            </div>
        );
    }
    
    if (status === 'service_down') {
        return (
            <div className="bg-white dark:bg-slate-800 border border-yellow-300 dark:border-yellow-700/50 rounded-lg p-8 max-w-3xl mx-auto text-center">
                <ExclamationTriangleIcon className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
                <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">ZeroTier Service Unavailable</h2>
                <p className="mt-2 text-slate-500 dark:text-slate-400">We found ZeroTier, but couldn't connect to its service. It may be stopped or malfunctioning.</p>
                
                <div className="text-left my-6 bg-slate-50 dark:bg-slate-900/50 p-6 rounded-lg">
                    <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-2">How to Fix</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Run the following commands in your server's terminal to start and enable the service:</p>
                    <div className="bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                        <CodeBlock script={`sudo systemctl start zerotier-one.service\nsudo systemctl enable zerotier-one.service`} />
                    </div>
                </div>
                
                <button onClick={fetchData} className="px-5 py-2.5 bg-[--color-primary-600] hover:bg-[--color-primary-500] rounded-lg font-semibold text-white">
                    Re-check Status
                </button>
            </div>
        );
    }
    
    if (status === 'error' || !data) {
        return (
            <div className="flex flex-col items-center justify-center h-64 bg-white dark:bg-slate-800 rounded-lg border border-red-300 dark:border-red-700 p-6 text-center">
                <ExclamationTriangleIcon className="w-12 h-12 text-red-500 mb-4" />
                <p className="text-xl font-semibold text-red-600 dark:text-red-400">Failed to load ZeroTier data.</p>
                <p className="mt-2 text-slate-500 dark:text-slate-400 text-sm">{errorMessage || 'Could not parse data from the server.'}</p>
                <button onClick={fetchData} className="mt-6 px-4 py-2 bg-red-100 dark:bg-red-600/50 text-red-700 dark:text-red-200 hover:bg-red-200 dark:hover:bg-red-500/50 rounded-lg font-semibold">
                    Try Again
                </button>
            </div>
        );
    }

    return (
        <div>
            <AddNetworkModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleJoin}
                isLoading={isSubmitting}
            />
             <div className="max-w-7xl mx-auto space-y-8">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                    <div>
                        <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">ZeroTier Panel Management</h2>
                        <p className="text-slate-500 dark:text-slate-400 mt-1">Manage the ZeroTier service running on this panel's host.</p>
                    </div>
                    <button onClick={() => setIsModalOpen(true)} className="bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-bold py-2 px-4 rounded-lg self-start sm:self-center">
                        Join Network
                    </button>
                </div>
                
                <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900/50">
                    <SudoInstructionBox />
                </div>

                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div className="font-mono"><span className="text-slate-500 dark:text-slate-400">Node ID:</span> <span className="text-[--color-primary-600] dark:text-[--color-primary-300]">{data.info.address}</span></div>
                    <div><span className="text-slate-500 dark:text-slate-400">Version:</span> <span className="text-slate-800 dark:text-slate-200">{data.info.version}</span></div>
                    <div><span className="text-slate-500 dark:text-slate-400">Online:</span> <span className={data.info.online ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{data.info.online ? 'Yes' : 'No'}</span></div>
                    <div><span className="text-slate-500 dark:text-slate-400">Port Mapping:</span> <span className="text-slate-800 dark:text-slate-200">{data.info.config.settings.portMappingEnabled ? 'Enabled' : 'Disabled'}</span></div>
                </div>

                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                                <tr>
                                    <th scope="col" className="px-4 py-3">Network</th>
                                    <th scope="col" className="px-4 py-3">Status</th>
                                    <th scope="col" className="px-4 py-3">Assigned IPs</th>
                                    <th scope="col" className="px-4 py-3 text-center">Allow Managed</th>
                                    <th scope="col" className="px-4 py-3 text-center">Allow Global</th>
                                    <th scope="col" className="px-4 py-3 text-center">Allow Default</th>
                                    <th scope="col" className="px-4 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.networks.length > 0 ? data.networks.map(net => (
                                    <tr key={net.nwid} className="border-b border-slate-200 dark:border-slate-700 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                        <td className="px-4 py-4">
                                            <p className="font-semibold text-slate-800 dark:text-slate-200">{net.name || <span className="text-slate-500 italic">No Name</span>}</p>
                                            <p className="font-mono text-cyan-600 dark:text-cyan-400 text-xs">{net.nwid}</p>
                                        </td>
                                        <td className="px-4 py-4">{getStatusChip(net.status)}</td>
                                        <td className="px-4 py-4 font-mono text-slate-600 dark:text-slate-300 text-xs">
                                            {net.assignedAddresses.map(ip => <div key={ip}>{ip}</div>)}
                                        </td>
                                        <td className="px-4 py-4 text-center"><ToggleSwitch checked={net.allowManaged} onChange={() => handleToggle(net.nwid, 'allowManaged', !net.allowManaged)} /></td>
                                        <td className="px-4 py-4 text-center"><ToggleSwitch checked={net.allowGlobal} onChange={() => handleToggle(net.nwid, 'allowGlobal', !net.allowGlobal)} /></td>
                                        <td className="px-4 py-4 text-center"><ToggleSwitch checked={net.allowDefault} onChange={() => handleToggle(net.nwid, 'allowDefault', !net.allowDefault)} /></td>
                                        <td className="px-4 py-4 text-right">
                                            <button onClick={() => handleLeave(net.nwid)} disabled={isSubmitting} className="p-2 text-slate-500 dark:text-slate-400 hover:text-red-500 rounded-md disabled:opacity-50" title="Leave Network">
                                                <TrashIcon className="h-5 w-5" />
                                            </button>
                                        </td>
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan={7} className="text-center py-8 text-slate-500">
                                            Not joined to any ZeroTier networks.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};