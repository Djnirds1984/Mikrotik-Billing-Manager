import React, { useState, useEffect } from 'react';
import { useLocalization } from '../contexts/LocalizationContext.tsx';

interface LedgerEntry {
    id: string;
    routerId: string;
    username: string;
    accountNumber?: string;
    month: string; // YYYY-MM
    status: 'paid' | 'unpaid' | 'credit';
    planName?: string;
    planPrice?: number;
    paidAmount?: number;
    saleId?: string;
    paymentDate?: string;
    createdAt?: string;
}

interface BillingLedgerModalProps {
    isOpen: boolean;
    onClose: () => void;
    routerId: string;
    username: string;
    fullName?: string;
    onPayMonth?: (month: string, entry: LedgerEntry) => void;
}

const formatMonthLabel = (monthStr: string): string => {
    const [year, month] = monthStr.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

const isOverdue = (monthStr: string): boolean => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return monthStr < currentMonth;
};

const isCurrentMonth = (monthStr: string): boolean => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return monthStr === currentMonth;
};

export const BillingLedgerModal: React.FC<BillingLedgerModalProps> = ({
    isOpen,
    onClose,
    routerId,
    username,
    fullName,
    onPayMonth
}) => {
    const { formatCurrency } = useLocalization();
    const [entries, setEntries] = useState<LedgerEntry[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen && routerId && username) {
            fetchLedger();
        }
    }, [isOpen, routerId, username]);

    const fetchLedger = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/billing-ledger/${encodeURIComponent(routerId)}/${encodeURIComponent(username)}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
            });
            if (!res.ok) throw new Error('Failed to fetch billing ledger');
            const data = await res.json();
            setEntries(data);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen) return null;

    const paidMonths = entries.filter(e => e.status === 'paid');
    const unpaidMonths = entries.filter(e => e.status === 'unpaid');
    const creditMonths = entries.filter(e => e.status === 'credit');
    const totalUnpaid = unpaidMonths.reduce((sum, e) => sum + (e.planPrice || 0), 0);
    const totalCredit = creditMonths.reduce((sum, e) => sum + (e.paidAmount || 0), 0);

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-3xl border border-slate-200 dark:border-slate-700 flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between flex-shrink-0">
                    <div>
                        <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400]">Billing Ledger</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            {fullName || username} <span className="font-mono text-xs">({username})</span>
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
                        <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Summary Cards */}
                <div className="p-4 grid grid-cols-3 gap-3 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-green-600 dark:text-green-400">{paidMonths.length}</div>
                        <div className="text-xs text-green-700 dark:text-green-300 font-medium">Months Paid</div>
                    </div>
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-red-600 dark:text-red-400">{unpaidMonths.length}</div>
                        <div className="text-xs text-red-700 dark:text-red-300 font-medium">Unpaid ({formatCurrency(totalUnpaid)})</div>
                    </div>
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{creditMonths.length}</div>
                        <div className="text-xs text-blue-700 dark:text-blue-300 font-medium">Credit Balance ({formatCurrency(totalCredit)})</div>
                    </div>
                </div>

                {/* Table */}
                <div className="p-4 overflow-y-auto flex-1">
                    {error && (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-700 dark:text-red-300">
                            {error}
                        </div>
                    )}
                    {isLoading ? (
                        <div className="text-center py-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[--color-primary-500] mx-auto"></div>
                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Loading billing history...</p>
                        </div>
                    ) : entries.length === 0 ? (
                        <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                            No billing records found.
                        </div>
                    ) : (
                        <table className="w-full text-sm text-left text-slate-600 dark:text-slate-300">
                            <thead className="text-xs text-slate-700 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-700/50 sticky top-0">
                                <tr>
                                    <th className="px-4 py-3 rounded-tl-lg">Month</th>
                                    <th className="px-4 py-3">Plan</th>
                                    <th className="px-4 py-3">Amount</th>
                                    <th className="px-4 py-3">Status</th>
                                    <th className="px-4 py-3">Paid Date</th>
                                    <th className="px-4 py-3 rounded-tr-lg">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map((entry) => {
                                    const overdue = entry.status === 'unpaid' && isOverdue(entry.month);
                                    const current = isCurrentMonth(entry.month);
                                    return (
                                        <tr key={entry.id} className={`border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30 ${overdue ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}>
                                            <td className="px-4 py-3 font-medium">
                                                <div>{formatMonthLabel(entry.month)}</div>
                                                {overdue && <span className="text-xs text-red-500 font-semibold">OVERDUE</span>}
                                                {current && entry.status === 'unpaid' && <span className="text-xs text-yellow-600 dark:text-yellow-400 font-semibold">CURRENT</span>}
                                                {entry.status === 'credit' && <span className="text-xs text-blue-500 font-semibold">CREDIT</span>}
                                            </td>
                                            <td className="px-4 py-3">{entry.planName || '-'}</td>
                                            <td className="px-4 py-3 font-mono">
                                                {entry.status === 'paid'
                                                    ? formatCurrency(entry.paidAmount || entry.planPrice || 0)
                                                    : formatCurrency(entry.planPrice || 0)
                                                }
                                            </td>
                                            <td className="px-4 py-3">
                                                {entry.status === 'paid' && (
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300">
                                                        Paid
                                                    </span>
                                                )}
                                                {entry.status === 'unpaid' && (
                                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${overdue ? 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300'}`}>
                                                        {overdue ? 'Unpaid' : 'Pending'}
                                                    </span>
                                                )}
                                                {entry.status === 'credit' && (
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300">
                                                        Credit
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-xs">
                                                {entry.paymentDate ? new Date(entry.paymentDate).toLocaleDateString() : '-'}
                                            </td>
                                            <td className="px-4 py-3">
                                                {entry.status === 'unpaid' && onPayMonth && (
                                                    <button
                                                        onClick={() => onPayMonth(entry.month, entry)}
                                                        className="px-3 py-1 text-xs bg-green-600 text-white rounded-md font-semibold hover:bg-green-700 transition-colors"
                                                    >
                                                        Pay
                                                    </button>
                                                )}
                                                {entry.status === 'credit' && (
                                                    <span className="text-xs text-blue-500 italic">Applied</span>
                                                )}
                                                {entry.status === 'paid' && (
                                                    <span className="text-xs text-green-500 italic">Complete</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center flex-shrink-0 bg-slate-50 dark:bg-slate-900/50 rounded-b-lg">
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                        {entries.length} month{entries.length !== 1 ? 's' : ''} total
                        {unpaidMonths.length > 0 && (
                            <span className="text-red-500 ml-2">| Balance Due: {formatCurrency(totalUnpaid)}</span>
                        )}
                        {creditMonths.length > 0 && (
                            <span className="text-blue-500 ml-2">| Credit: {formatCurrency(totalCredit)}</span>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium rounded-md text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};
