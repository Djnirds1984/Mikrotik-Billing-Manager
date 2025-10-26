import React, { useState, useMemo, useEffect } from 'react';
import type { SaleRecord, CompanySettings } from '../types.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { PrintableReceipt } from './PrintableReceipt.tsx';
import { CurrencyDollarIcon, PrinterIcon, TrashIcon } from '../constants.tsx';

export const SalesReport: React.FC<{
    salesData: SaleRecord[];
    deleteSale: (id: string) => void;
    clearSales: () => void;
    companySettings: CompanySettings;
}> = ({ salesData, deleteSale, clearSales, companySettings }) => {
    const { formatCurrency } = useLocalization();
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [receiptToPrint, setReceiptToPrint] = useState<SaleRecord | null>(null);

    const filteredSales = useMemo(() => {
        if (!startDate && !endDate) return salesData;
        return salesData.filter(sale => {
            const saleDate = new Date(sale.date);
            const start = startDate ? new Date(startDate) : null;
            const end = endDate ? new Date(endDate) : null;
            if (start && saleDate < start) return false;
            if (end) {
                // Include the whole end day
                end.setHours(23, 59, 59, 999);
                if (saleDate > end) return false;
            }
            return true;
        });
    }, [salesData, startDate, endDate]);

    const totals = useMemo(() => {
        return filteredSales.reduce((acc, sale) => {
            acc.totalSales += sale.finalAmount;
            acc.totalDiscount += sale.discountAmount;
            return acc;
        }, { totalSales: 0, totalDiscount: 0 });
    }, [filteredSales]);

    useEffect(() => {
        if (receiptToPrint) {
            const timer = setTimeout(() => window.print(), 100);
            return () => clearTimeout(timer);
        }
    }, [receiptToPrint]);

    useEffect(() => {
        const handleAfterPrint = () => {
            if (receiptToPrint) {
                setReceiptToPrint(null);
            }
        };
        window.addEventListener('afterprint', handleAfterPrint);
        return () => window.removeEventListener('afterprint', handleAfterPrint);
    }, [receiptToPrint]);

    return (
        <div className="space-y-6">
            <div className={receiptToPrint ? 'printable-area' : 'hidden'}>
                <PrintableReceipt sale={receiptToPrint} companySettings={companySettings} />
            </div>

            <div className={receiptToPrint ? 'hidden' : ''}>
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <CurrencyDollarIcon className="w-6 h-6" /> Sales Report
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
                    <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border">
                        <p className="text-sm text-slate-500">Total Sales</p>
                        <p className="text-2xl font-bold text-green-600">{formatCurrency(totals.totalSales)}</p>
                    </div>
                     <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border">
                        <p className="text-sm text-slate-500">Total Discount</p>
                        <p className="text-2xl font-bold text-yellow-600">{formatCurrency(totals.totalDiscount)}</p>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border mt-6 flex items-center gap-4">
                    <label>From:</label><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                    <label>To:</label><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                    <button onClick={() => { setStartDate(''); setEndDate(''); }} className="text-sm text-sky-600">Reset</button>
                    <div className="flex-grow text-right">
                        <button onClick={clearSales} className="bg-red-600 text-white px-3 py-2 text-sm rounded-lg">Clear All Sales</button>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 border rounded-lg shadow-md overflow-hidden mt-6">
                    <table className="w-full text-sm">
                        <thead><tr className="border-b">
                            <th className="p-4 text-left">Date</th>
                            <th className="p-4 text-left">Client</th>
                            <th className="p-4 text-left">Plan</th>
                            <th className="p-4 text-right">Amount</th>
                            <th className="p-4 text-center">Actions</th>
                        </tr></thead>
                        <tbody>
                            {filteredSales.map(sale => (
                                <tr key={sale.id} className="border-b last:border-0">
                                    <td className="p-4">{new Date(sale.date).toLocaleString()}</td>
                                    <td className="p-4">{sale.clientName}</td>
                                    <td className="p-4">{sale.planName}</td>
                                    <td className="p-4 text-right font-semibold">{formatCurrency(sale.finalAmount)}</td>
                                    <td className="p-4 text-center">
                                        <button onClick={() => setReceiptToPrint(sale)} className="p-1 mx-1"><PrinterIcon className="w-5 h-5"/></button>
                                        <button onClick={() => deleteSale(sale.id)} className="p-1 mx-1"><TrashIcon className="w-5 h-5 text-red-500"/></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
