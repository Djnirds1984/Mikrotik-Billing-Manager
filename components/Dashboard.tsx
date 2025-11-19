import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { RouterConfigWithId, SystemInfo, InterfaceWithHistory, TrafficHistoryPoint, Interface, PanelHostStatus } from '../types.ts';
import { getSystemInfo, getInterfaceStats, getPppActiveConnections } from '../services/mikrotikService.ts';
import { getPanelHostStatus } from '../services/panelService.ts';
import { Loader } from './Loader.tsx';
import { Chart } from './chart.tsx';
import { RouterIcon, ExclamationTriangleIcon, UsersIcon, ChipIcon } from '../constants.tsx';
import { AIFixer } from './AIFixer.tsx';

const StatCard: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({ title, children, className }) => (
    <div className={`bg-white dark:bg-slate-800/50 p-6 rounded-lg border border-slate-200/80 dark:border-slate-800 shadow-sm ${className}`}>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-4">{title}</h3>
        <div className="space-y-4">
            {children}
        </div>
    </div>
);

const StatItem: React.FC<{ label: string; value: string | number; subtext?: string; children?: React.ReactNode; icon?: React.ReactNode }> = ({ label, value, subtext, children, icon }) => (
    <div>
        <div className="flex justify-between items-center text-sm">
            <div className="flex items-center gap-2">
                 {icon}
                <span className="font-medium text-slate-600 dark:text-slate-300">{label}</span>
            </div>
            <span className="font-bold text-slate-900 dark:text-white">{value} {subtext && <span className="font-normal text-slate-500 dark:text-slate-400">{subtext}</span>}</span>
        </div>
        {children && <div className="mt-2">{children}</div>}
    </div>
);

const ProgressBar: React.FC<{ percent: number; colorClass: string }> = ({ percent, colorClass }) => (
    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
        <div className={`${colorClass} h-2 rounded-full`} style={{ width: `${percent}%` }}></div>
    </div>
);


const formatBps = (bps: number): string => {
    if (typeof bps !== 'number' || !isFinite(bps) || isNaN(bps)) return '0 bps';
    if (bps < 1000) return `${bps.toFixed(0)} bps`;
    if (bps < 1000 * 1000) return `${(bps / 1000).toFixed(2)} Kbps`;
    if (bps < 1000 * 1000 * 1000) return `${(bps / (1000 * 1000)).toFixed(2)} Mbps`;
    return `${(bps / (1000 * 1000 * 1000)).toFixed(2)} Gbps`;
};

// Polling interval for live interface updates (ms)
const MAX_HISTORY_POINTS = 30;
const POLL_INTERVAL_MS = 2000;

export const Dashboard: React.FC<{ selectedRouter: RouterConfigWithId | null }> = ({ selectedRouter }) => {
    // Router States
    const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
    const [interfaces, setInterfaces] = useState<InterfaceWithHistory[]>([]);
    const [pppoeCount, setPppoeCount] = useState<number>(0);
    const [selectedChartInterface1, setSelectedChartInterface1] = useState<string | null>(null);
    const [selectedChartInterface2, setSelectedChartInterface2] = useState<string | null>(null);


    // Host States
    const [hostStatus, setHostStatus] = useState<PanelHostStatus | null>(null);
    const [hostError, setHostError] = useState<string | null>(null);

    // General States
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<{ message: string; details?: any } | null>(null);
    const [showFixer, setShowFixer] = useState(false);

    const intervalRef = useRef<number | null>(null);
    const previousInterfacesRef = useRef<{ timestamp: number; interfaces: Interface[] } | null>(null);

    // --- Data Fetching ---

    const fetchHostData = useCallback(async () => {
        try {
            const data = await getPanelHostStatus();
            setHostStatus(data);
            if (hostError) setHostError(null);
        } catch (err) {
            setHostError('Could not load panel host status.');
        }
    }, [hostError]);

    useEffect(() => {
        fetchHostData();
        const interval = setInterval(fetchHostData, 5000);
        return () => clearInterval(interval);
    }, [fetchHostData]);


    const fetchRouterData = useCallback(async (isInitial = false) => {
        if (!selectedRouter) {
            if(isInitial) setIsLoading(false);
            setSystemInfo(null);
            setInterfaces([]);
            setPppoeCount(0);
            return;
        }

        if (isInitial) {
            setIsLoading(true);
            setError(null);
            setShowFixer(false);
            setInterfaces([]);
            setSelectedChartInterface1(null);
            setSelectedChartInterface2(null);
            setPppoeCount(0);
            previousInterfacesRef.current = null;
        }

        try {
            const [info, currentInterfacesData, pppoeActive] = await Promise.all([
                getSystemInfo(selectedRouter),
                getInterfaceStats(selectedRouter),
                getPppActiveConnections(selectedRouter).catch(() => []), 
            ]);
            setSystemInfo(info);
            setPppoeCount(Array.isArray(pppoeActive) ? pppoeActive.length : 0);
            
            const now = Date.now();
            setInterfaces(prevInterfaces => {
                const previousState = previousInterfacesRef.current;
                previousInterfacesRef.current = { timestamp: now, interfaces: currentInterfacesData };

                if (!Array.isArray(currentInterfacesData)) {
                    console.error("Received non-array data for interfaces:", currentInterfacesData);
                    return prevInterfaces;
                }

                const timeDiffSeconds = previousState ? (now - previousState.timestamp) / 1000 : 0;

                const newInterfaces = currentInterfacesData.map((iface: Interface) => {
                    const existingIface = prevInterfaces.find(p => p.name === iface.name);
                    const prevIfaceData = previousState?.interfaces.find(p => p.name === iface.name);

                    let rxRate = 0;
                    let txRate = 0;

                    if (prevIfaceData && timeDiffSeconds > 0.1) {
                        // Robust property access handling multiple possible API response formats
                        // Cast to 'any' to access potential dynamic properties safely
                        const i = iface as any;
                        const p = prevIfaceData as any;
                        
                        // Try different property names that RouterOS might return
                        const currRx = Number(i['rx-byte'] ?? i['bytes-in'] ?? i['rx-bytes'] ?? 0);
                        const prevRx = Number(p['rx-byte'] ?? p['bytes-in'] ?? p['rx-bytes'] ?? 0);
                        const currTx = Number(i['tx-byte'] ?? i['bytes-out'] ?? i['tx-bytes'] ?? 0);
                        const prevTx = Number(p['tx-byte'] ?? p['bytes-out'] ?? p['tx-bytes'] ?? 0);

                        let rxByteDiff = currRx - prevRx;
                        let txByteDiff = currTx - prevTx;

                        // Handle counter reset/overflow or bad data
                        if (rxByteDiff < 0) rxByteDiff = currRx;
                        if (txByteDiff < 0) txByteDiff = currTx;
                        
                        rxRate = Math.round((rxByteDiff * 8) / timeDiffSeconds);
                        txRate = Math.round((txByteDiff * 8) / timeDiffSeconds);
                        
                        // Sanity check to prevent NaN
                        if (isNaN(rxRate)) rxRate = 0;
                        if (isNaN(txRate)) txRate = 0;
                    }

                    

                    const newHistoryPoint: TrafficHistoryPoint = { name: new Date().toLocaleTimeString(), rx: rxRate, tx: txRate };
                    
                    let newHistory = existingIface ? [...existingIface.trafficHistory, newHistoryPoint] : [newHistoryPoint];
                    if (newHistory.length > MAX_HISTORY_POINTS) {
                        newHistory = newHistory.slice(newHistory.length - MAX_HISTORY_POINTS);
                    }

                    return { ...iface, rxRate, txRate, trafficHistory: newHistory };
                });
                return newInterfaces;
            });

            if (error) setError(null);
        } catch (err) {
            console.error("Dashboard fetch error:", err);
            setError({
                message: `Failed to fetch data from ${selectedRouter.name}. Check connection and credentials.`,
                details: err,
            });
        } finally {
            if (isInitial) setIsLoading(false);
        }
    }, [selectedRouter, error]);

    useEffect(() => {
        if (selectedRouter) {
            fetchRouterData(true);
            intervalRef.current = window.setInterval(() => fetchRouterData(false), POLL_INTERVAL_MS);
        } else {
            setIsLoading(false);
            setSystemInfo(null);
            setInterfaces([]);
        }

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [selectedRouter, fetchRouterData]);
    
    // --- Memos and Effects for UI ---
    
    const selectableInterfaces = useMemo(() => 
        interfaces.filter(i => i.type.startsWith('ether') || i.type === 'bridge' || i.type === 'vlan' || i.type === 'wlan'), 
        [interfaces]
    );
    const chartData1 = useMemo(() => interfaces.find(i => i.name === selectedChartInterface1), [interfaces, selectedChartInterface1]);
    const chartData2 = useMemo(() => interfaces.find(i => i.name === selectedChartInterface2), [interfaces, selectedChartInterface2]);

    useEffect(() => {
        if (selectableInterfaces.length > 0) {
            // Initialize selection only if null or if the previously selected interface no longer exists
            if (!selectedChartInterface1 || !selectableInterfaces.some(i => i.name === selectedChartInterface1)) {
                // Prefer WAN or Bridge if possible, otherwise first available
                const default1 = selectableInterfaces.find(i => i.name.toLowerCase().includes('wan') || i.name === 'ether1') || selectableInterfaces[0];
                setSelectedChartInterface1(default1.name);
            }
            if (!selectedChartInterface2 || !selectableInterfaces.some(i => i.name === selectedChartInterface2)) {
                // Prefer LAN or Bridge
                const default2 = selectableInterfaces.find(i => i.name.toLowerCase().includes('lan') || i.name.toLowerCase().includes('bridge') && i.name !== selectedChartInterface1) || selectableInterfaces[1] || selectableInterfaces[0];
                setSelectedChartInterface2(default2.name);
            }
        }
    }, [selectableInterfaces, selectedChartInterface1, selectedChartInterface2]);


    // --- Render Logic ---

    if (!selectedRouter) {
        return (
            <div className="space-y-8">
                 <StatCard title="Host Panel Status">
                     {hostError && <p className="text-yellow-600 dark:text-yellow-400 text-sm">{hostError}</p>}
                     {!hostStatus && !hostError && <div className="flex items-center justify-center h-24"><Loader /></div>}
                     {hostStatus && <>
                        <StatItem label="CPU Usage" value={`${(hostStatus.cpuUsage || 0).toFixed(1)}%`}><ProgressBar percent={hostStatus.cpuUsage || 0} colorClass="bg-green-500" /></StatItem>
                        <StatItem label="RAM Usage" value={`${(hostStatus.memory?.percent || 0).toFixed(1)}%`} subtext={`(${hostStatus.memory?.used || 0} / ${hostStatus.memory?.total || 0})`}><ProgressBar percent={hostStatus.memory?.percent || 0} colorClass="bg-sky-500" /></StatItem>
                        <StatItem label="SD Card Usage" value={`${(hostStatus.disk?.percent || 0).toFixed(1)}%`} subtext={`(${hostStatus.disk?.used || 0} / ${hostStatus.disk?.total || 0})`}><ProgressBar percent={hostStatus.disk?.percent || 0} colorClass="bg-amber-500" /></StatItem>
                     </>}
                 </StatCard>
                 <div className="flex flex-col items-center justify-center h-full text-center py-16">
                    <RouterIcon className="w-24 h-24 text-slate-300 dark:text-slate-700 mb-4" />
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">Welcome to the Dashboard</h2>
                    <p className="mt-2 text-slate-500 dark:text-slate-400">Please select a router from the top bar to view its status.</p>
                </div>
            </div>
        );
    }
    
    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-full">
                <Loader />
                <p className="mt-4 text-[--color-primary-500]">Connecting to {selectedRouter.name}...</p>
            </div>
        );
    }

    if (error) {
        const errorMessage = (error.details as Error)?.message || error.message;
        return (
             <div>
                <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700/50 text-red-700 dark:text-red-300 p-6 rounded-lg text-center">
                    <ExclamationTriangleIcon className="w-12 h-12 mx-auto mb-4 text-red-500 dark:text-red-400" />
                    <h3 className="text-lg font-bold">Connection Error</h3>
                    <p className="mt-2 text-sm">{errorMessage}</p>
                    <div className="flex justify-center gap-4 mt-4">
                        <button onClick={() => fetchRouterData(true)} className="px-4 py-2 text-sm bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-md hover:bg-slate-300 dark:hover:bg-slate-600">
                           Try Again
                        </button>
                        <button onClick={() => setShowFixer(!showFixer)} className="px-4 py-2 text-sm bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 rounded-md hover:bg-sky-200 dark:hover:bg-sky-800">
                            {showFixer ? 'Hide AI Fixer' : 'Try AI Fixer'}
                        </button>
                    </div>
                </div>
                {showFixer && <AIFixer errorMessage={errorMessage} routerName={selectedRouter.name} />}
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                 <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200 mb-4">System Overview</h2>
                 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                     <StatCard title="Host Panel Status">
                         {hostError && <p className="text-yellow-600 dark:text-yellow-400 text-sm">{hostError}</p>}
                         {!hostStatus && !hostError && <div className="flex items-center justify-center h-24"><Loader /></div>}
                         {hostStatus && <>
                            <StatItem label="CPU Usage" value={`${(hostStatus.cpuUsage || 0).toFixed(1)}%`}><ProgressBar percent={hostStatus.cpuUsage || 0} colorClass="bg-green-500" /></StatItem>
                            <StatItem label="RAM Usage" value={`${(hostStatus.memory?.percent || 0).toFixed(1)}%`} subtext={`(${hostStatus.memory?.used || 0}/${hostStatus.memory?.total || 0})`}><ProgressBar percent={hostStatus.memory?.percent || 0} colorClass="bg-sky-500" /></StatItem>
                            <StatItem label="SD Card" value={`${(hostStatus.disk?.percent || 0).toFixed(1)}%`} subtext={`(${hostStatus.disk?.used || 0}/${hostStatus.disk?.total || 0})`}><ProgressBar percent={hostStatus.disk?.percent || 0} colorClass="bg-amber-500" /></StatItem>
                         </>}
                     </StatCard>
                     <StatCard title={`Router: ${selectedRouter.name}`}>
                         {systemInfo ? <>
                             <StatItem label="Board Name" value={systemInfo.boardName} icon={<ChipIcon className="w-5 h-5 text-slate-400"/>} />
                             <StatItem label="Uptime" value={systemInfo.uptime} />
                             <StatItem label="CPU Load" value={`${systemInfo.cpuLoad}%`}><ProgressBar percent={systemInfo.cpuLoad} colorClass="bg-green-500" /></StatItem>
                             <StatItem label="Memory" value={`${systemInfo.memoryUsage}%`} subtext={`of ${systemInfo.totalMemory}`}><ProgressBar percent={systemInfo.memoryUsage} colorClass="bg-sky-500" /></StatItem>
                             <StatItem label="Active PPPoE" value={pppoeCount} icon={<UsersIcon className="w-5 h-5 text-slate-400" />} />
                         </> : <div className="flex items-center justify-center h-24"><Loader /></div>}
                     </StatCard>
                 </div>
            </div>
            
            {selectedRouter && selectableInterfaces.length > 0 && (
                 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {chartData1 && (
                        <div className="bg-white dark:bg-slate-800/50 p-6 rounded-lg border border-slate-200/80 dark:border-slate-800 shadow-sm">
                            <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-4">
                                <h4 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Live Interface Traffic 1</h4>
                                <select
                                    value={selectedChartInterface1 || ''}
                                    onChange={(e) => setSelectedChartInterface1(e.target.value)}
                                    className="mt-2 sm:mt-0 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                                    aria-label="Select interface 1 to view traffic"
                                >
                                    {selectableInterfaces.map(iface => (
                                        <option key={iface.name} value={iface.name}>{iface.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <div className="flex justify-between text-sm mb-2">
                                    <p>RX: <span className="font-semibold text-green-600 dark:text-green-400">{formatBps(chartData1.rxRate)}</span></p>
                                    <p>TX: <span className="font-semibold text-sky-600 dark:text-sky-400">{formatBps(chartData1.txRate)}</span></p>
                                </div>
                                <div className="h-64">
                                <Chart trafficHistory={chartData1.trafficHistory} />
                                </div>
                            </div>
                        </div>
                    )}
                     {chartData2 && (
                        <div className="bg-white dark:bg-slate-800/50 p-6 rounded-lg border border-slate-200/80 dark:border-slate-800 shadow-sm">
                            <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-4">
                                <h4 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Live Interface Traffic 2</h4>
                                <select
                                    value={selectedChartInterface2 || ''}
                                    onChange={(e) => setSelectedChartInterface2(e.target.value)}
                                    className="mt-2 sm:mt-0 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                                    aria-label="Select interface 2 to view traffic"
                                >
                                    {selectableInterfaces.map(iface => (
                                        <option key={iface.name} value={iface.name}>{iface.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <div className="flex justify-between text-sm mb-2">
                                    <p>RX: <span className="font-semibold text-green-600 dark:text-green-400">{formatBps(chartData2.rxRate)}</span></p>
                                    <p>TX: <span className="font-semibold text-sky-600 dark:text-sky-400">{formatBps(chartData2.txRate)}</span></p>
                                </div>
                                <div className="h-64">
                                <Chart trafficHistory={chartData2.trafficHistory} />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
