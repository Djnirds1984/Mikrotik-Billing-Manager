import React, { useState, useEffect, useCallback } from 'react';
import type { HotspotSession } from '../../types/hotspot.ts';
import { getSessions, kickSession, extendSession } from '../../services/hotspotControllerService.ts';
import { Loader } from '../Loader.tsx';

interface Props {
    routerId: string;
}

function formatDuration(seconds: number): string {
    if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${seconds}s`;
}

function getRemainingSeconds(expiresAt: string): number {
    return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

export const HotspotSessionMonitor: React.FC<Props> = ({ routerId }) => {
    const [sessions, setSessions] = useState<HotspotSession[]>([]);
    const [allSessions, setAllSessions] = useState<HotspotSession[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showAll, setShowAll] = useState(false);
    const [extendingId, setExtendingId] = useState<string | null>(null);

    const fetchSessions = useCallback(async () => {
        if (!routerId) return;
        try {
            const data = await getSessions({ routerId });
            setAllSessions(data);
            setSessions(data.filter(s => s.status === 'active'));
        } catch { /* ignore */ }
        finally { setIsLoading(false); }
    }, [routerId]);

    useEffect(() => {
        fetchSessions();
        const interval = setInterval(fetchSessions, 5000);
        return () => clearInterval(interval);
    }, [fetchSessions]);

    const handleKick = async (id: string) => {
        if (!window.confirm('Kick this session?')) return;
        try {
            await kickSession(id);
            await fetchSessions();
        } catch (err) {
            alert(`Error: ${(err as Error).message}`);
        }
    };

    const handleExtend = async (id: string, seconds: number) => {
        try {
            await extendSession(id, seconds);
            setExtendingId(null);
            await fetchSessions();
        } catch (err) {
            alert(`Error: ${(err as Error).message}`);
        }
    };

    // Revenue summary
    const activeSessions = allSessions.filter(s => s.status === 'active');
    const totalRevenue = allSessions.filter(s => s.status !== 'kicked').reduce((sum, s) => sum + (s.amountPaid || 0), 0);
    const coinslotRevenue = allSessions.filter(s => s.paymentMethod === 'coinslot' && s.status !== 'kicked').reduce((sum, s) => sum + (s.amountPaid || 0), 0);
    const voucherRevenue = allSessions.filter(s => s.paymentMethod === 'voucher' && s.status !== 'kicked').reduce((sum, s) => sum + (s.amountPaid || 0), 0);

    if (isLoading) return <div className="flex justify-center p-8"><Loader /></div>;

    const displaySessions = showAll ? allSessions : sessions;

    return (
        <div className="space-y-4">
            {/* Revenue Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Active Sessions</p>
                    <p className="text-2xl font-bold text-[--color-primary-600] dark:text-[--color-primary-400]">{activeSessions.length}</p>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Total Revenue</p>
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">{totalRevenue.toFixed(2)}</p>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Coinslot</p>
                    <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{coinslotRevenue.toFixed(2)}</p>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Vouchers</p>
                    <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{voucherRevenue.toFixed(2)}</p>
                </div>
            </div>

            {/* Toggle */}
            <div className="flex gap-2">
                <button onClick={() => setShowAll(false)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${!showAll ? 'bg-[--color-primary-600] text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                    Active ({sessions.length})
                </button>
                <button onClick={() => setShowAll(true)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${showAll ? 'bg-[--color-primary-600] text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                    All ({allSessions.length})
                </button>
            </div>

            {/* Sessions Table */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                            <tr>
                                <th className="px-4 py-3">MAC Address</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Payment</th>
                                <th className="px-4 py-3">Amount</th>
                                <th className="px-4 py-3">Remaining</th>
                                <th className="px-4 py-3">Started</th>
                                <th className="px-4 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {displaySessions.length > 0 ? displaySessions.map(session => {
                                const remaining = getRemainingSeconds(session.expiresAt);
                                return (
                                    <tr key={session.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                        <td className="px-4 py-3 font-mono text-sm text-slate-900 dark:text-slate-200">{session.macAddress}</td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                                                session.status === 'active' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400' :
                                                session.status === 'expired' ? 'bg-slate-200 dark:bg-slate-600/50 text-slate-600 dark:text-slate-400' :
                                                'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400'
                                            }`}>{session.status}</span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                                                session.paymentMethod === 'coinslot' ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400' :
                                                session.paymentMethod === 'voucher' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400' :
                                                'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400'
                                            }`}>{session.paymentMethod}</span>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-green-600 dark:text-green-400">{session.amountPaid.toFixed(2)}</td>
                                        <td className="px-4 py-3 font-mono text-sm">
                                            {session.status === 'active' ? (
                                                <span className={remaining < 300 ? 'text-red-600 dark:text-red-400 font-bold' : 'text-slate-700 dark:text-slate-300'}>
                                                    {formatDuration(remaining)}
                                                </span>
                                            ) : '-'}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-slate-500">{new Date(session.startedAt).toLocaleString()}</td>
                                        <td className="px-4 py-3 text-right">
                                            {session.status === 'active' && (
                                                <div className="flex items-center justify-end gap-1">
                                                    {extendingId === session.id ? (
                                                        <>
                                                            <button onClick={() => handleExtend(session.id, 1800)} className="text-xs bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 px-2 py-1 rounded">+30m</button>
                                                            <button onClick={() => handleExtend(session.id, 3600)} className="text-xs bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 px-2 py-1 rounded">+1h</button>
                                                            <button onClick={() => setExtendingId(null)} className="text-xs text-slate-500 px-1">x</button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button onClick={() => setExtendingId(session.id)} className="text-xs text-blue-600 dark:text-blue-400 font-medium hover:underline">Extend</button>
                                                            <button onClick={() => handleKick(session.id)} className="text-xs text-red-600 dark:text-red-400 font-medium hover:underline ml-2">Kick</button>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            }) : (
                                <tr><td colSpan={7} className="text-center py-8 text-slate-500">No sessions found.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
