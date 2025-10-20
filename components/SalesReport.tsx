import React, { useState, useMemo, useEffect } from 'react';
import type { SaleRecord, CompanySettings } from '../types.ts';
import { CurrencyDollarIcon, TrashIcon, PrinterIcon } from '../constants.tsx';
import { PrintableReceipt } from './PrintableReceipt.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';

interface SalesReportProps {
    salesData: SaleRecord[];
    deleteSale: (saleId: string) => void;
    clearSales: () => void;
    companySettings: CompanySettings;
}

const StatCard: React.FC<{ title: string, value: string | number, icon: React.ReactNode }> = ({ title, value, icon }) => (
    <div className="bg-white dark:bg-slate-800 p-4 rounded-lg flex items-center gap-4 border border-slate-200 dark:border-slate-700">
        <div className="p-3 bg-slate-100 dark:bg-slate-700/50 rounded-lg">{icon}</div>
        <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">{title}</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
        </div>
    </div>
);

export const SalesReport: React.FC<SalesReportProps> = ({ salesData, deleteSale, clearSales, companySettings }) => {
    const { hasPermission } = useAuth();
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [receiptToPrint, setReceiptToPrint] = useState<SaleRecord | null>(null);

    const filteredSales = useMemo(() => {
        return salesData.filter(sale => {
            if (!startDate && !endDate) return true;
            const saleDate = new Date(sale.date);
            const start = startDate ? new Date(startDate) : null;
            const end = endDate ? new Date(endDate) : null;
            if (start) start.setHours(0, 0, 0, 0);
            if (end) end.setHours(23, 59, 59, 999);

            if (start && saleDate < start) return false;
            if (end && saleDate > end) return false;
            return true;
        });
    }, [salesData, startDate, endDate]);

    const summary = useMemo(() => {
        return filteredSales.reduce((acc, sale) => {
            acc.totalSales += sale.planPrice;
            acc.totalDiscounts += sale.discountAmount;
            acc.netRevenue += sale.finalAmount;
            acc.transactions++;
            return acc;
        }, { totalSales: 0, totalDiscounts: 0, netRevenue: 0, transactions: 0 });
    }, [filteredSales]);

    const handleClear = () => {
        if (window.confirm("Are you sure you want to delete ALL sales records? This action cannot be undone.")) {
            clearSales();
        }
    };

    const handlePrintReport = () => {
        window.print();
    };

    const handlePrintReceipt = (sale: SaleRecord) => {
        setReceiptToPrint(sale);
    };

    useEffect(() => {
        if (receiptToPrint) {
            const timer = setTimeout(() => window.print(), 100);
            return () => clearTimeout(timer);
        }
    }, [receiptToPrint]);

    useEffect(() => {
        const handleAfterPrint = () => {
            setReceiptToPrint(null);
        };
        window.addEventListener('afterprint', handleAfterPrint);
        return () => window.removeEventListener('afterprint', handleAfterPrint);
    }, []);

    const formatCurrency = (amount: number) => {
        // Find a currency from the sales data, default to USD
        const currency = salesData[0]?.currency || 'USD';
        return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
    };

    return (
        <>
            <div className={receiptToPrint ? 'printable-area' : 'hidden'}>
                <PrintableReceipt sale={receiptToPrint} companySettings={companySettings} />
            </div>
            
            <div className={!receiptToPrint ? 'printable-area' : 'hidden'}>
                <div className="max-w-7xl mx-auto space-y-6">
                    <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 no-print">
                         <div>
                            <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Sales Report</h2>
                            <p className="text-slate-500 dark:text-slate-400 mt-1">Review all processed payments and financial summaries.</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={handlePrintReport} className="px-4 py-2 text-sm text-white bg-sky-600 hover:bg-sky-500 rounded-lg font-semibold flex items-center gap-2">
                                <PrinterIcon className="w-5 h-5" /> Print Report
                            </button>
                             {hasPermission('sales_report:delete') && (
                                <button onClick={handleClear} className="px-4 py-2 text-sm text-white bg-red-700 hover:bg-red-800 dark:bg-red-800 dark:hover:bg-red-700 rounded-lg font-semibold flex items-center gap-2">
                                    <TrashIcon className="w-5 h-5" /> Clear All
                                </button>
                             )}
                        </div>
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard title="Net Revenue" value={formatCurrency(summary.netRevenue)} icon={<CurrencyDollarIcon className="w-6 h-6 text-green-500 dark:text-green-400" />} />
                        <StatCard title="Total Sales" value={formatCurrency(summary.totalSales)} icon={<CurrencyDollarIcon className="w-6 h-6 text-sky-500 dark:text-sky-400" />} />
                        <StatCard title="Total Discounts" value={formatCurrency(summary.totalDiscounts)} icon={<CurrencyDollarIcon className="w-6 h-6 text-yellow-500 dark:text-yellow-400" />} />
                        <StatCard title="Transactions" value={summary.transactions} icon={<span className="text-2xl text-slate-500 dark:text-slate-400">#</span>} />
                    </div>
                    
                     {/* Filters and Table */}
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
                        <div className="p-4 flex flex-col md:flex-row gap-4 border-b border-slate-200 dark:border-slate-700 no-print">
                            <div>
                                <label htmlFor="startDate" className="block text-xs font-medium text-slate-500 dark:text-slate-400">Start Date</label>
                                <input type="date" name="startDate" id="startDate" value={startDate} onChange={e => setStartDate(e.target.value)} className="mt-1 bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md text-sm text-slate-900 dark:text-white" />
                            </div>
                             <div>
                                <label htmlFor="endDate" className="block text-xs font-medium text-slate-500 dark:text-slate-400">End Date</label>
                                <input type="date" name="endDate" id="endDate" value={endDate} onChange={e => setEndDate(e.target.value)} className="mt-1 bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md text-sm text-slate-900 dark:text-white" />
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                                    <tr>
                                        <th className="px-4 py-3">Date</th>
                                        <th className="px-4 py-3">Client</th>
                                        <th className="px-4 py-3">Plan</th>
                                        <th className="px-4 py-3">Router</th>
                                        <th className="px-4 py-3 text-right">Plan Price</th>
                                        <th className="px-4 py-3 text-right">Discount</th>
                                        <th className="px-4 py-3 text-right">Final Amount</th>
                                        <th className="px-4 py-3 text-center no-print">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredSales.length > 0 ? filteredSales.map(sale => (
                                        <tr key={sale.id} className="border-b border-slate-200 dark:border-slate-700 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                            <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">{new Date(sale.date).toLocaleDateString()}</td>
                                            <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-200">{sale.clientName}</td>
                                            <td className="px-4 py-3">{sale.planName}</td>
                                            <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{sale.routerName}</td>
                                            <td className="px-4 py-3 text-right font-mono text-sky-600 dark:text-sky-400">{formatCurrency(sale.planPrice)}</td>
                                            <td className="px-4 py-3 text-right font-mono text-yellow-600 dark:text-yellow-400">{formatCurrency(sale.discountAmount)}</td>
                                            <td className="px-4 py-3 text-right font-mono text-green-600 dark:text-green-400 font-bold">{formatCurrency(sale.finalAmount)}</td>
                                            <td className="px-4 py-3 text-center no-print">
                                                <button onClick={() => handlePrintReceipt(sale)} className="p-2 text-slate-500 dark:text-slate-400 hover:text-sky-500 dark:hover:text-sky-400 rounded-md" title="Print Receipt">
                                                    <PrinterIcon className="h-5 w-5" />
                                                </button>
                                                {hasPermission('sales_report:delete') && (
                                                    <button onClick={() => deleteSale(sale.id)} className="p-2 text-slate-500 dark:text-slate-400 hover:text-red-500 rounded-md" title="Delete Record">
                                                        <TrashIcon className="h-5 w-5" />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    )) : (
                                        <tr>
                                            <td colSpan={8} className="text-center py-8 text-slate-500">
                                                No sales records found for the selected period.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}