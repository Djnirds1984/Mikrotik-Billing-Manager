import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { HotspotVoucherBatch, HotspotVoucher, HotspotPlan } from '../../types/hotspot.ts';
import { getVoucherBatches, generateVoucherBatch, deleteVoucherBatch, getVouchers, getHotspotPlans } from '../../services/hotspotControllerService.ts';
import { Loader } from '../Loader.tsx';

interface Props {
    routerId: string;
}

type View = 'batches' | 'vouchers';

export const HotspotVoucherManager: React.FC<Props> = ({ routerId }) => {
    const [view, setView] = useState<View>('batches');
    const [batches, setBatches] = useState<HotspotVoucherBatch[]>([]);
    const [vouchers, setVouchers] = useState<HotspotVoucher[]>([]);
    const [plans, setPlans] = useState<HotspotPlan[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Generate form
    const [selectedPlanId, setSelectedPlanId] = useState('');
    const [quantity, setQuantity] = useState(10);
    const [isGenerating, setIsGenerating] = useState(false);

    // Filter
    const [statusFilter, setStatusFilter] = useState<string>('');
    const [batchFilter, setBatchFilter] = useState<string>('');

    const printRef = useRef<HTMLDivElement>(null);

    const fetchBatches = useCallback(async () => {
        if (!routerId) return;
        try {
            const data = await getVoucherBatches(routerId);
            setBatches(data);
        } catch (err) { setError((err as Error).message); }
    }, [routerId]);

    const fetchVouchers = useCallback(async () => {
        if (!routerId) return;
        try {
            const data = await getVouchers({ routerId, status: statusFilter || undefined, batchId: batchFilter || undefined });
            setVouchers(data);
        } catch (err) { setError((err as Error).message); }
    }, [routerId, statusFilter, batchFilter]);

    const fetchPlans = useCallback(async () => {
        try {
            const data = await getHotspotPlans(routerId);
            setPlans(data);
            if (data.length > 0 && !selectedPlanId) setSelectedPlanId(data[0].id);
        } catch (err) { /* ignore */ }
    }, [routerId, selectedPlanId]);

    useEffect(() => {
        setIsLoading(true);
        Promise.all([fetchBatches(), fetchVouchers(), fetchPlans()]).finally(() => setIsLoading(false));
    }, [view, fetchBatches, fetchVouchers, fetchPlans]);

    const handleGenerate = async () => {
        if (!selectedPlanId || quantity < 1) return;
        setIsGenerating(true);
        try {
            await generateVoucherBatch({ routerId, planId: selectedPlanId, count: quantity });
            await fetchBatches();
            await fetchVouchers();
        } catch (err) {
            alert(`Error: ${(err as Error).message}`);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDeleteBatch = async (id: string) => {
        if (!window.confirm('Delete this batch and all unused vouchers?')) return;
        try {
            await deleteVoucherBatch(id);
            await fetchBatches();
            await fetchVouchers();
        } catch (err) {
            alert(`Error: ${(err as Error).message}`);
        }
    };

    const handlePrint = () => {
        if (!printRef.current) return;
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;
        printWindow.document.write(`<html><head><title>Vouchers</title><style>
            body{font-family:monospace;padding:20px}
            .card{border:1px solid #333;padding:10px;margin:5px;display:inline-block;width:140px;text-align:center}
            .code{font-size:18px;font-weight:bold;letter-spacing:2px}
            .plan{font-size:10px;color:#666}
        </style></head><body>${printRef.current.innerHTML}</body></html>`);
        printWindow.document.close();
        printWindow.print();
    };

    const formatDuration = (s: number) => {
        if (s >= 86400) return `${Math.floor(s / 86400)}d`;
        if (s >= 3600) return `${Math.floor(s / 3600)}h`;
        return `${Math.floor(s / 60)}min`;
    };

    if (isLoading) return <div className="flex justify-center p-8"><Loader /></div>;

    return (
        <div className="space-y-4">
            {/* View Toggle */}
            <div className="flex gap-2">
                <button onClick={() => setView('batches')} className={`px-4 py-2 rounded-lg text-sm font-semibold ${view === 'batches' ? 'bg-[--color-primary-600] text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'}`}>
                    Batches ({batches.length})
                </button>
                <button onClick={() => setView('vouchers')} className={`px-4 py-2 rounded-lg text-sm font-semibold ${view === 'vouchers' ? 'bg-[--color-primary-600] text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'}`}>
                    Vouchers ({vouchers.length})
                </button>
            </div>

            {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-600 dark:text-red-400">{error}</div>}

            {view === 'batches' && (
                <>
                    {/* Generate Form */}
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                        <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-3">Generate New Batch</h4>
                        <div className="flex flex-wrap gap-3 items-end">
                            <div>
                                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Plan</label>
                                <select value={selectedPlanId} onChange={e => setSelectedPlanId(e.target.value)}
                                    className="mt-1 bg-slate-100 dark:bg-slate-700 rounded-md p-2 text-slate-900 dark:text-white">
                                    {plans.map(p => <option key={p.id} value={p.id}>{p.name} ({formatDuration(p.durationSeconds)})</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Quantity</label>
                                <input type="number" value={quantity} onChange={e => setQuantity(Number(e.target.value))} min={1} max={500}
                                    className="mt-1 w-24 bg-slate-100 dark:bg-slate-700 rounded-md p-2 text-slate-900 dark:text-white" />
                            </div>
                            <button onClick={handleGenerate} disabled={isGenerating || plans.length === 0}
                                className="bg-[--color-primary-600] text-white font-bold py-2 px-4 rounded-lg disabled:opacity-50 hover:bg-[--color-primary-500]">
                                {isGenerating ? 'Generating...' : 'Generate'}
                            </button>
                        </div>
                    </div>

                    {/* Batch Table */}
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                                    <tr>
                                        <th className="px-4 py-3">Batch Name</th>
                                        <th className="px-4 py-3">Price</th>
                                        <th className="px-4 py-3">Duration</th>
                                        <th className="px-4 py-3">Remaining/Total</th>
                                        <th className="px-4 py-3">Created</th>
                                        <th className="px-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {batches.map(b => (
                                        <tr key={b.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                            <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-200">{b.batchName}</td>
                                            <td className="px-4 py-3 font-mono text-green-600 dark:text-green-400">{b.price.toFixed(2)}</td>
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDuration(b.durationSeconds)}</td>
                                            <td className="px-4 py-3">
                                                <span className="font-mono">{b.remainingCount ?? '?'}/{b.totalCount}</span>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-slate-500">{new Date(b.createdAt).toLocaleDateString()}</td>
                                            <td className="px-4 py-3 text-right space-x-2">
                                                <button onClick={() => { setBatchFilter(b.id); setView('vouchers'); }}
                                                    className="text-[--color-primary-600] hover:text-[--color-primary-400] text-xs font-medium">View</button>
                                                <button onClick={() => handleDeleteBatch(b.id)}
                                                    className="text-red-600 hover:text-red-400 text-xs font-medium">Delete</button>
                                            </td>
                                        </tr>
                                    ))}
                                    {batches.length === 0 && (
                                        <tr><td colSpan={6} className="text-center py-8 text-slate-500">No batches yet.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {view === 'vouchers' && (
                <>
                    {/* Filters */}
                    <div className="flex gap-3 flex-wrap">
                        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); }}
                            className="bg-slate-100 dark:bg-slate-700 rounded-md p-2 text-sm text-slate-900 dark:text-white">
                            <option value="">All Status</option>
                            <option value="available">Available</option>
                            <option value="active">Active</option>
                            <option value="used">Used</option>
                            <option value="expired">Expired</option>
                        </select>
                        <select value={batchFilter} onChange={e => setBatchFilter(e.target.value)}
                            className="bg-slate-100 dark:bg-slate-700 rounded-md p-2 text-sm text-slate-900 dark:text-white">
                            <option value="">All Batches</option>
                            {batches.map(b => <option key={b.id} value={b.id}>{b.batchName}</option>)}
                        </select>
                        <button onClick={handlePrint} className="bg-slate-600 text-white text-sm py-2 px-4 rounded-lg hover:bg-slate-500">Print Available</button>
                    </div>

                    {/* Hidden print area */}
                    <div ref={printRef} className="hidden print:block">
                        {vouchers.filter(v => v.status === 'available').map(v => (
                            <div key={v.id} className="card">
                                <div className="code">{v.code}</div>
                                <div className="plan">{formatDuration(v.durationSeconds)} - {v.price.toFixed(2)}</div>
                            </div>
                        ))}
                    </div>

                    {/* Voucher Table */}
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                                    <tr>
                                        <th className="px-4 py-3">Code</th>
                                        <th className="px-4 py-3">Status</th>
                                        <th className="px-4 py-3">Duration</th>
                                        <th className="px-4 py-3">MAC</th>
                                        <th className="px-4 py-3">Activated</th>
                                        <th className="px-4 py-3">Sold Via</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {vouchers.map(v => (
                                        <tr key={v.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                            <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-slate-200 tracking-wider">{v.code}</td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                                                    v.status === 'available' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400' :
                                                    v.status === 'active' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400' :
                                                    v.status === 'used' ? 'bg-slate-200 dark:bg-slate-600/50 text-slate-600 dark:text-slate-400' :
                                                    'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400'
                                                }`}>{v.status}</span>
                                            </td>
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDuration(v.durationSeconds)}</td>
                                            <td className="px-4 py-3 font-mono text-xs text-slate-500">{v.macAddress || '-'}</td>
                                            <td className="px-4 py-3 text-xs text-slate-500">{v.activatedAt ? new Date(v.activatedAt).toLocaleString() : '-'}</td>
                                            <td className="px-4 py-3 text-xs text-slate-500">{v.soldVia}</td>
                                        </tr>
                                    ))}
                                    {vouchers.length === 0 && (
                                        <tr><td colSpan={6} className="text-center py-8 text-slate-500">No vouchers found.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
