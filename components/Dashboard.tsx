
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { RouterConfigWithId, SystemInfo, Interface, TrafficHistoryPoint, PanelHostStatus } from '../types.ts';
import { getSystemInfo, getInterfaceStats, getPppActiveConnections, toggleInterfaceStatus } from '../services/mikrotikService.ts';
import { getPanelHostStatus } from '../services/panelService.ts';
import { Loader } from './Loader.tsx';
import { TrafficChart } from './chart.tsx';
import { RouterIcon, ExclamationTriangleIcon, UsersIcon, ChipIcon, SignalIcon, ShareIcon, PlusIcon, XMarkIcon } from '../constants.tsx';
import { AIFixer } from './AIFixer.tsx';

// --- CONSTANTS ---
const MAX_HISTORY_POINTS = 60;
const POLL_INTERVAL_MS = 1000;

// --- UTILITY ---
const formatBits = (bits: number): string => {
    if (typeof bits !== 'number' || !isFinite(bits) || isNaN(bits) || bits < 0) return '0 bps';
    if (bits < 1000) return `${bits.toFixed(0)} bps`;
    const k = 1000;
    const sizes = ['Kbps', 'Mbps', 'Gbps', 'Tbps'];
    const i = Math.floor(Math.log(bits) / Math.log(k));
    return `${(bits / Math.pow(k, i)).toFixed(2)} ${sizes[i - 1] || 'Kbps'}`;
};

// --- COMPONENTS ---

const StatCard: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({ title, children, className }) => (
    <div className={`bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm ${className}`}>
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-4">{title}</h3>
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
    <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2">
        <div className={`${colorClass} h-2 rounded-full transition-all duration-500`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}></div>
    </div>
);

const TrafficCard: React.FC<{ 
    interfaceName: string | null; 
    allInterfaces: string[]; 
    onSelect: (name: string) => void;
    onRemove: () => void;
    onToggleStatus: (name: string, currentStatus: boolean) => void;
    isDisabled: boolean;
    data: TrafficHistoryPoint[];
    currentRx: number;
    currentTx: number;
}> = ({ interfaceName, allInterfaces, onSelect, onRemove, onToggleStatus, isDisabled, data, currentRx, currentTx }) => {
    if (!interfaceName) return <div className="h-full bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse"></div>;

    return (
        <div className={`bg-white dark:bg-slate-800 rounded-xl border ${isDisabled ? 'border-red-200 dark:border-red-900/50' : 'border-slate-200 dark:border-slate-700'} shadow-sm overflow-hidden flex flex-col h-full relative group transition-colors duration-300`}>
            {/* Header */}
            <div className={`relative p-4 border-b ${isDisabled ? 'border-red-100 dark:border-red-900/30 bg-red-50/50 dark:bg-red-900/10' : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50'} flex flex-col sm:flex-row justify-between items-center gap-4 transition-colors duration-300`}>
                <div className="flex items-center gap-3 z-10">
                    <div className={`p-2 rounded-lg ${isDisabled ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'}`}>
                        <SignalIcon className="w-5 h-5" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1 ${isDisabled ? 'text-red-500' : 'text-emerald-500'}`}>
                                <span className={`w-2 h-2 rounded-full ${isDisabled ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'}`}></span> {isDisabled ? 'Disabled' : 'Live'}
                            </span>
                        </div>
                        <select 
                            value={interfaceName} 
                            onChange={(e) => onSelect(e.target.value)}
                            className="mt-1 bg-transparent font-bold text-slate-800 dark:text-slate-100 text-base focus:outline-none cursor-pointer hover:text-blue-600 transition-colors pr-8 max-w-[140px] truncate"
                        >
                            {allInterfaces.map(iface => (
                                <option key={iface} value={iface}>{iface}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className={`flex gap-4 sm:absolute sm:right-10 sm:top-1/2 sm:-translate-y-1/2 text-center pointer-events-none transition-opacity duration-300 ${isDisabled ? 'opacity-50 grayscale' : 'opacity-100'}`}>
                    <div className="flex flex-col items-center">
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold mb-0.5">Download</p>
                        <p className="text-sm font-mono font-bold text-emerald-600 dark:text-emerald-400">{formatBits(currentRx)}</p>
                    </div>
                    <div className="flex flex-col items-center">
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold mb-0.5">Upload</p>
                        <p className="text-sm font-mono font-bold text-sky-600 dark:text-sky-400">{formatBits(currentTx)}</p>
                    </div>
                </div>

                <div className="absolute top-2 right-2 flex flex-col gap-4 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                        onClick={onRemove}
                        className="p-1 text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 transition-colors"
                        title="Remove Graph"
                    >
                        <XMarkIcon className="w-5 h-5" />
                    </button>
                    <button 
                        onClick={() => onToggleStatus(interfaceName, isDisabled)}
                        className={`p-1 transition-colors ${isDisabled ? 'text-emerald-500 hover:text-emerald-600' : 'text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400'}`}
                        title={isDisabled ? "Enable Interface" : "Disable Interface"}
                    >
                         <div className={`w-8 h-4 rounded-full p-0.5 flex items-center transition-colors ${isDisabled ? 'bg-slate-300 dark:bg-slate-600 justify-start' : 'bg-emerald-500 justify-end'}`}>
                            <div className="w-3 h-3 rounded-full bg-white shadow-sm"></div>
                        </div>
                    </button>
                </div>
            </div>

            {/* Chart Area */}
            <div className={`flex-grow p-4 min-h-[250px] transition-opacity duration-300 ${isDisabled ? 'opacity-25 grayscale pointer-events-none' : 'opacity-100'}`}>
                <TrafficChart data={data} height={250} />
            </div>
            {isDisabled && (
                <div className="absolute inset-0 top-[80px] flex items-center justify-center pointer-events-none">
                    <div className="bg-slate-900/50 text-white px-4 py-2 rounded-lg font-bold backdrop-blur-sm">
                        INTERFACE DISABLED
                    </div>
                </div>
            )}
        </div>
    );
};

export const Dashboard: React.FC<{ selectedRouter: RouterConfigWithId | null }> = ({ selectedRouter }) => {
    // --- STATE ---
    const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
    const [pppoeCount, setPppoeCount] = useState<number>(0);
    
    // Interface Names List
    const [availableInterfaces, setAvailableInterfaces] = useState<string[]>([]);
    const [interfaceDetails, setInterfaceDetails] = useState<Interface[]>([]); // Full interface details for status
    
    // Traffic Data: Map<InterfaceName, HistoryArray>
    const [trafficHistory, setTrafficHistory] = useState<Record<string, TrafficHistoryPoint[]>>({});
    
    // Realtime Rates: Map<InterfaceName, {rx: number, tx: number}>
    const [currentRates, setCurrentRates] = useState<Record<string, {rx: number, tx: number}>>({});

    // Selected Interfaces for Charts
    const [activeCharts, setActiveCharts] = useState<string[]>([]);

    // Host States
    const [hostStatus, setHostStatus] = useState<PanelHostStatus | null>(null);

    // General States
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<{ message: string; details?: any } | null>(null);
    const [showFixer, setShowFixer] = useState(false);

    // --- REFS ---
    // We use refs to store the previous byte counts to calculate rates without triggering re-renders
    const lastBytesRef = useRef<Record<string, { rx: number; tx: number; time: number }>>({});
    const isInitialLoad = useRef(true);

    // --- DATA FETCHING ---

    // 1. Fetch Host Status (Separate Interval)
    useEffect(() => {
        const fetchHost = async () => {
            try {
                const data = await getPanelHostStatus();
                setHostStatus(data);
            } catch (e) { console.warn("Host stats failed", e); }
        };
        fetchHost();
        const interval = setInterval(fetchHost, 5000);
        return () => clearInterval(interval);
    }, []);

    // 2. Fetch Router System Info & Interfaces (Main Logic)
    const fetchRouterData = useCallback(async () => {
        if (!selectedRouter) return;

        try {
            const [info, interfacesData, pppoeActive] = await Promise.all([
                getSystemInfo(selectedRouter),
                getInterfaceStats(selectedRouter),
                getPppActiveConnections(selectedRouter).catch(() => []),
            ]);

            setSystemInfo(info);
            setPppoeCount(Array.isArray(pppoeActive) ? pppoeActive.length : 0);

            // Process Interfaces
            if (Array.isArray(interfacesData)) {
                const now = Date.now();
                const interfaceNames = interfacesData.map((i: any) => i.name);
                
                // Store full details for status checking (disabled/running state)
                setInterfaceDetails(interfacesData);

                // Update available interfaces list if changed (deep compare approximation)
                setAvailableInterfaces(prev => {
                    if (prev.length !== interfaceNames.length || !prev.every((val, index) => val === interfaceNames[index])) {
                        return interfaceNames;
                    }
                    return prev;
                });

                // Calculate Rates
                const newRates: Record<string, {rx: number, tx: number}> = {};

                interfacesData.forEach((iface: any) => {
                    const name = iface.name;
                    const bytesRx = Number(iface['rx-byte'] ?? iface['bytes-in'] ?? iface['rx-bytes'] ?? 0);
                    const bytesTx = Number(iface['tx-byte'] ?? iface['bytes-out'] ?? iface['tx-bytes'] ?? 0);

                    const lastData = lastBytesRef.current[name];
                    let rxBps = 0;
                    let txBps = 0;

                    if (lastData) {
                        const timeDiff = (now - lastData.time) / 1000; // Seconds
                        if (timeDiff > 0) {
                            let diffRx = bytesRx - lastData.rx;
                            let diffTx = bytesTx - lastData.tx;

                            // Handle Counter Reset/Overflow or Reboot
                            if (diffRx < 0) diffRx = bytesRx; 
                            if (diffTx < 0) diffTx = bytesTx;

                            // Calculate Bits per Second
                            rxBps = (diffRx * 8) / timeDiff;
                            txBps = (diffTx * 8) / timeDiff;
                        }
                    }

                    // Update Ref
                    lastBytesRef.current[name] = { rx: bytesRx, tx: bytesTx, time: now };
                    newRates[name] = { rx: rxBps, tx: txBps };
                });

                setCurrentRates(newRates);

                // Update History
                setTrafficHistory(prevHistory => {
                    const nextHistory = { ...prevHistory };
                    const timeLabel = new Date().toLocaleTimeString([], { hour12: false });

                    interfaceNames.forEach(name => {
                        const point: TrafficHistoryPoint = {
                            name: timeLabel,
                            rx: newRates[name]?.rx || 0,
                            tx: newRates[name]?.tx || 0
                        };

                        const existing = nextHistory[name] || [];
                        const newArr = [...existing, point];
                        if (newArr.length > MAX_HISTORY_POINTS) newArr.shift(); // Keep window size
                        nextHistory[name] = newArr;
                    });
                    return nextHistory;
                });
            }

            if (isInitialLoad.current) {
                setIsLoading(false);
                isInitialLoad.current = false;
            }
            setError(null);

        } catch (err: any) {
            console.error("Dashboard Error:", err);
            setError({ message: err.message || "Failed to fetch router data", details: err });
            setIsLoading(false);
        }
    }, [selectedRouter]);

    // --- EFFECTS ---

    useEffect(() => {
        // Reset state when router changes
        setIsLoading(true);
        setSystemInfo(null);
        setAvailableInterfaces([]);
        setTrafficHistory({});
        setCurrentRates({});
        lastBytesRef.current = {};
        isInitialLoad.current = true;
        setError(null);

        // Load persisted charts for this router
        if (selectedRouter?.id) {
            try {
                const savedCharts = localStorage.getItem(`dashboard_charts_${selectedRouter.id}`);
                if (savedCharts) {
                    setActiveCharts(JSON.parse(savedCharts));
                } else {
                    setActiveCharts([]); // Reset if no save, will trigger auto-select
                }
            } catch (e) {
                console.warn("Failed to load chart prefs", e);
                setActiveCharts([]);
            }
        }

        if (selectedRouter) {
            fetchRouterData(); // Initial fetch
            const interval = setInterval(fetchRouterData, POLL_INTERVAL_MS);
            return () => clearInterval(interval);
        } else {
            setIsLoading(false);
        }
    }, [selectedRouter, fetchRouterData]);

    // Save active charts when they change
    useEffect(() => {
        if (selectedRouter?.id && activeCharts.length > 0) {
            localStorage.setItem(`dashboard_charts_${selectedRouter.id}`, JSON.stringify(activeCharts));
        } else if (selectedRouter?.id && activeCharts.length === 0 && availableInterfaces.length > 0) {
            // Only clear if we actually have interfaces but chose to have 0 charts (manual clear)
            // If availableInterfaces is empty, it might be initial load, so don't wipe storage yet
             localStorage.setItem(`dashboard_charts_${selectedRouter.id}`, JSON.stringify([]));
        }
    }, [activeCharts, selectedRouter?.id, availableInterfaces.length]);

    // Auto-select defaults for charts if not set
    useEffect(() => {
        if (availableInterfaces.length > 0 && activeCharts.length === 0) {
            const wan = availableInterfaces.find(i => i.toLowerCase().includes('wan') || i.includes('ether1')) || availableInterfaces[0];
            const lan = availableInterfaces.find(i => (i.toLowerCase().includes('lan') || i.includes('bridge')) && i !== wan) || availableInterfaces[1] || availableInterfaces[0];
            
            // Default to showing 2 charts if possible, otherwise just 1
            if (wan && lan && wan !== lan) {
                setActiveCharts([wan, lan]);
            } else {
                setActiveCharts([wan]);
            }
        }
    }, [availableInterfaces, activeCharts.length]);


    // --- ACTIONS ---
    const addNewChart = () => {
        if (availableInterfaces.length === 0) return;
        // Try to find an interface not currently shown
        const unusedInterface = availableInterfaces.find(iface => !activeCharts.includes(iface));
        if (unusedInterface) {
            setActiveCharts([...activeCharts, unusedInterface]);
        } else {
            // Duplicate allowed if all are shown, just pick the first one
            setActiveCharts([...activeCharts, availableInterfaces[0]]);
        }
    };

    const removeChart = (index: number) => {
        const newCharts = [...activeCharts];
        newCharts.splice(index, 1);
        setActiveCharts(newCharts);
    };

    const updateChartInterface = (index: number, newInterface: string) => {
        const newCharts = [...activeCharts];
        newCharts[index] = newInterface;
        setActiveCharts(newCharts);
    };

    const handleToggleInterface = async (interfaceName: string, currentStatus: boolean) => {
        if (!selectedRouter) return;
        
        // Optimistic update (optional, but might be tricky with polling. Let's just wait for poll or refresh)
        // Actually, we should probably set a loading state for that card, but for now let's just fire the request
        
        try {
            await toggleInterfaceStatus(selectedRouter, interfaceName, !currentStatus);
            // Force a refresh of data
            fetchRouterData();
        } catch (err) {
            console.error("Failed to toggle interface:", err);
            // Optionally show a toast or error
        }
    };

    // --- RENDER ---

    if (!selectedRouter) {
        return (
            <div className="space-y-8">
                 <StatCard title="Panel Host Status">
                     {!hostStatus ? <div className="flex items-center justify-center h-24"><Loader /></div> : (
                     <>
                        <StatItem label="CPU Usage" value={`${(hostStatus.cpuUsage || 0).toFixed(1)}%`}><ProgressBar percent={hostStatus.cpuUsage || 0} colorClass="bg-green-500" /></StatItem>
                        <StatItem label="RAM Usage" value={`${(hostStatus.memory?.percent || 0).toFixed(1)}%`} subtext={`(${hostStatus.memory?.used}/${hostStatus.memory?.total})`}><ProgressBar percent={hostStatus.memory?.percent || 0} colorClass="bg-sky-500" /></StatItem>
                        <StatItem label="Disk Usage" value={`${(hostStatus.disk?.percent || 0).toFixed(1)}%`} subtext={`(${hostStatus.disk?.used}/${hostStatus.disk?.total})`}><ProgressBar percent={hostStatus.disk?.percent || 0} colorClass="bg-amber-500" /></StatItem>
                     </>
                     )}
                 </StatCard>
                 <div className="flex flex-col items-center justify-center h-64 text-center">
                    <RouterIcon className="w-24 h-24 text-slate-300 dark:text-slate-700 mb-4" />
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">No Router Selected</h2>
                    <p className="mt-2 text-slate-500 dark:text-slate-400">Please select a router from the top bar to view live telemetry.</p>
                </div>
            </div>
        );
    }

    if (error) {
        const errorMessage = error.message;
        return (
             <div>
                <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700/50 text-red-700 dark:text-red-300 p-8 rounded-xl text-center">
                    <ExclamationTriangleIcon className="w-16 h-16 mx-auto mb-4 text-red-500 dark:text-red-400" />
                    <h3 className="text-xl font-bold">Connection Error</h3>
                    <p className="mt-2 text-lg">{errorMessage}</p>
                    <div className="flex justify-center gap-4 mt-6">
                        <button onClick={() => fetchRouterData()} className="px-6 py-2 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 font-semibold">
                           Retry Connection
                        </button>
                        <button onClick={() => setShowFixer(!showFixer)} className="px-6 py-2 bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 rounded-lg hover:bg-sky-200 dark:hover:bg-sky-800 font-semibold">
                            {showFixer ? 'Hide AI Fixer' : 'Launch AI Fixer'}
                        </button>
                    </div>
                </div>
                {showFixer && <AIFixer errorMessage={errorMessage} routerName={selectedRouter.name} />}
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* TOP: STATUS CARDS */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <StatCard title="Panel Host Status">
                    {!hostStatus ? <div className="flex items-center justify-center h-24"><Loader /></div> : (
                    <>
                        <StatItem label="CPU Usage" value={`${(hostStatus.cpuUsage || 0).toFixed(1)}%`}><ProgressBar percent={hostStatus.cpuUsage || 0} colorClass="bg-green-500" /></StatItem>
                        <StatItem label="RAM Usage" value={`${(hostStatus.memory?.percent || 0).toFixed(1)}%`} subtext={`(${hostStatus.memory?.used}/${hostStatus.memory?.total})`}><ProgressBar percent={hostStatus.memory?.percent || 0} colorClass="bg-sky-500" /></StatItem>
                        <StatItem label="Disk Usage" value={`${(hostStatus.disk?.percent || 0).toFixed(1)}%`} subtext={`(${hostStatus.disk?.used}/${hostStatus.disk?.total})`}><ProgressBar percent={hostStatus.disk?.percent || 0} colorClass="bg-amber-500" /></StatItem>
                    </>
                    )}
                </StatCard>
                <StatCard title={`Router Status: ${selectedRouter.name}`}>
                    {systemInfo ? (
                        <div className="grid grid-cols-2 gap-4">
                            <StatItem label="Board Name" value={systemInfo.boardName} icon={<ChipIcon className="w-5 h-5 text-slate-400"/>} />
                            <StatItem label="OS Version" value={systemInfo.version} />
                            <StatItem label="CPU Load" value={`${systemInfo.cpuLoad}%`}><ProgressBar percent={systemInfo.cpuLoad} colorClass="bg-emerald-500" /></StatItem>
                            <StatItem label="Memory" value={`${systemInfo.memoryUsage}%`} subtext={`of ${systemInfo.totalMemory}`}><ProgressBar percent={systemInfo.memoryUsage} colorClass="bg-blue-500" /></StatItem>
                            <div className="col-span-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                                <StatItem label="Uptime" value={systemInfo.uptime} icon={<ShareIcon className="w-5 h-5 text-slate-400"/>} />
                                <StatItem label="Active PPPoE" value={pppoeCount} icon={<UsersIcon className="w-5 h-5 text-slate-400"/>} />
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full"><Loader /></div>
                    )}
                </StatCard>
            </div>
            
            {/* BOTTOM: TRAFFIC TELEMETRY */}
            <div className="relative">
                <div className="flex items-center gap-4 mb-4">
                    <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        <SignalIcon className="w-6 h-6 text-sky-500" /> Live Traffic Telemetry
                    </h2>
                    <button 
                        onClick={addNewChart}
                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors text-sm font-semibold border border-blue-200 dark:border-blue-700/50"
                        title="Add New Traffic Graph"
                    >
                        <PlusIcon className="w-4 h-4" />
                        <span>Add Graph</span>
                    </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-20">
                    {activeCharts.map((iface, index) => {
                        const ifaceDetail = interfaceDetails.find(i => i.name === iface);
                        const isDisabled = ifaceDetail ? (ifaceDetail.disabled === true || ifaceDetail.disabled === 'true') : false;
                        
                        return (
                            <TrafficCard 
                                key={`${iface}-${index}`}
                                interfaceName={iface}
                                allInterfaces={availableInterfaces}
                                onSelect={(newName) => updateChartInterface(index, newName)}
                                onRemove={() => removeChart(index)}
                                onToggleStatus={handleToggleInterface}
                                isDisabled={isDisabled}
                                data={iface ? (trafficHistory[iface] || []) : []}
                                currentRx={iface ? (currentRates[iface]?.rx || 0) : 0}
                                currentTx={iface ? (currentRates[iface]?.tx || 0) : 0}
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
