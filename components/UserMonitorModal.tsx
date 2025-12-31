import React, { useState, useEffect, useRef } from 'react';
import { UsersIcon, XMarkIcon, SignalIcon } from '../constants.tsx';
import { TrafficChart } from './chart.tsx';
import { getPppActiveConnections, getInterfaceStats } from '../services/mikrotikService.ts';
import type { PppSecret, RouterConfigWithId, PppActiveConnection, TrafficHistoryPoint } from '../types.ts';

// Helper function
const formatBits = (bits: number): string => {
    if (typeof bits !== 'number' || !isFinite(bits) || isNaN(bits) || bits < 0) return '0 bps';
    if (bits < 1000) return `${bits.toFixed(0)} bps`;
    const k = 1000;
    const sizes = ['Kbps', 'Mbps', 'Gbps', 'Tbps'];
    const i = Math.floor(Math.log(bits) / Math.log(k));
    return `${(bits / Math.pow(k, i)).toFixed(2)} ${sizes[i - 1] || 'Kbps'}`;
};

interface UserMonitorModalProps {
    isOpen: boolean;
    onClose: () => void;
    user: PppSecret | null;
    selectedRouter: RouterConfigWithId;
}

export const UserMonitorModal: React.FC<UserMonitorModalProps> = ({ isOpen, onClose, user, selectedRouter }) => {
    const [trafficHistory, setTrafficHistory] = useState<TrafficHistoryPoint[]>([]);
    const [currentRate, setCurrentRate] = useState({ rx: 0, tx: 0 });
    const [activeConnection, setActiveConnection] = useState<PppActiveConnection | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const lastBytesRef = useRef<{ rx: number; tx: number; time: number } | null>(null);
    
    // Reset state when user changes or modal opens
    useEffect(() => {
        if (isOpen && user) {
            setTrafficHistory([]);
            setCurrentRate({ rx: 0, tx: 0 });
            setActiveConnection(null);
            setIsLoading(true);
            lastBytesRef.current = null;
        }
    }, [isOpen, user]);

    useEffect(() => {
        if (!isOpen || !user) return;

        let isMounted = true;
        const fetchData = async () => {
            try {
                // 1. Get Active Connection for Uptime
                const activeConns = await getPppActiveConnections(selectedRouter);
                const active = activeConns.find(c => c.name === user.name);
                
                if (isMounted) {
                    setActiveConnection(active || null);
                    if (!active) setIsLoading(false); // If not active, stop loading
                }

                if (active) {
                    // 2. Get Interface Stats for Traffic
                    const stats = await getInterfaceStats(selectedRouter);
                    // Filter for the specific interface. 
                    // Note: Mikrotik PPPoE interfaces usually have the name `<pppoe-user>` or just `user`
                    const userInterface = stats.find((iface: any) => iface.name === `<pppoe-${user.name}>`) || stats.find((iface: any) => iface.name === user.name);

                    if (userInterface && isMounted) {
                        const now = Date.now();
                        const bytesRx = Number(userInterface['rx-byte'] ?? userInterface['bytes-in'] ?? userInterface['rx-bytes'] ?? 0);
                        const bytesTx = Number(userInterface['tx-byte'] ?? userInterface['bytes-out'] ?? userInterface['tx-bytes'] ?? 0);

                        let rxBps = 0;
                        let txBps = 0;

                        if (lastBytesRef.current) {
                            const timeDiff = (now - lastBytesRef.current.time) / 1000;
                            if (timeDiff > 0) {
                                rxBps = (bytesRx - lastBytesRef.current.rx) * 8 / timeDiff;
                                txBps = (bytesTx - lastBytesRef.current.tx) * 8 / timeDiff;
                            }
                        }

                        lastBytesRef.current = { rx: bytesRx, tx: bytesTx, time: now };
                        
                        // Avoid spikes on first poll
                        if (rxBps >= 0 && txBps >= 0) {
                             setCurrentRate({ rx: rxBps, tx: txBps });
                             
                             setTrafficHistory(prev => {
                                 const newPoint = {
                                     name: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                                     rx: rxBps,
                                     tx: txBps
                                 };
                                 const newHistory = [...prev, newPoint];
                                 return newHistory.slice(-60); // Keep last 60 points
                             });
                        }
                        setIsLoading(false);
                    }
                }
            } catch (err) {
                console.error("Monitor error:", err);
                if (isMounted) setIsLoading(false);
            }
        };

        fetchData(); // Initial call
        const interval = setInterval(fetchData, 1000); // Poll every second for smooth graph

        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [isOpen, user, selectedRouter]);

    if (!isOpen || !user) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <UsersIcon className="w-6 h-6 text-primary-500" />
                            {user.name}
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Live Connection Monitor</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors">
                        <XMarkIcon className="w-6 h-6 text-slate-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1">
                    {isLoading && !activeConnection ? (
                        <div className="flex flex-col items-center justify-center h-64 gap-4">
                            <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
                            <p className="text-slate-500 animate-pulse">Connecting to router...</p>
                        </div>
                    ) : !activeConnection ? (
                         <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
                            <div className="w-16 h-16 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center text-slate-400">
                                <SignalIcon className="w-8 h-8" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-700 dark:text-slate-300">User is Offline</h3>
                                <p className="text-slate-500">No active connection found for this user.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Stats Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-xl border border-slate-100 dark:border-slate-600">
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Uptime</p>
                                    <p className="text-2xl font-mono font-bold text-slate-800 dark:text-white">{activeConnection.uptime || '00:00:00'}</p>
                                </div>
                                <div className="bg-emerald-50 dark:bg-emerald-900/10 p-4 rounded-xl border border-emerald-100 dark:border-emerald-900/30">
                                    <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">Download Speed</p>
                                    <p className="text-2xl font-mono font-bold text-emerald-700 dark:text-emerald-300">{formatBits(currentRate.rx)}</p>
                                </div>
                                <div className="bg-sky-50 dark:bg-sky-900/10 p-4 rounded-xl border border-sky-100 dark:border-sky-900/30">
                                    <p className="text-xs font-bold text-sky-600 dark:text-sky-400 uppercase tracking-wider mb-1">Upload Speed</p>
                                    <p className="text-2xl font-mono font-bold text-sky-700 dark:text-sky-300">{formatBits(currentRate.tx)}</p>
                                </div>
                            </div>

                            {/* Chart */}
                            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 h-[350px]">
                                <TrafficChart data={trafficHistory} height={320} />
                            </div>
                            
                            {/* Connection Details */}
                            <div className="bg-slate-50 dark:bg-slate-700/30 rounded-xl p-4 text-sm text-slate-600 dark:text-slate-300 flex justify-between">
                                <span>IP Address: <span className="font-mono font-bold">{activeConnection.address}</span></span>
                                <span>Caller ID: <span className="font-mono font-bold">{activeConnection['caller-id']}</span></span>
                                <span>Service: <span className="font-mono font-bold">{activeConnection.service}</span></span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
