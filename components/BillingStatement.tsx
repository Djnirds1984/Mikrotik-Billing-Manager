import React, { useState, useEffect, useMemo } from 'react';
import type { Customer, CompanySettings } from '../types.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { birHtmlLine } from './BirInfo.tsx';

// Simple inline icons
const XMarkIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
);
const PlusIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
);

// --- Billing Statement Modal (Unpaid Monthly Dues) ---
interface BillingStatementRow {
    month: string; // YYYY-MM
    label: string; // e.g. "January 2026"
    amount: number;
    status: 'UNPAID' | 'OVERDUE';
}

interface BillingStatementProps {
    isOpen: boolean;
    onClose: () => void;
    customer: Customer | null;
    routerId: string;
    companySettings: CompanySettings;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const monthLabel = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    if (!y || !m || m < 1 || m > 12) return ym;
    return `${MONTH_NAMES[m - 1]} ${y}`;
};

const ymKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

const nextMonth = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m, 1); // m is 1-based here; Date month is 0-based so passing m gives the next month
    return ymKey(d);
};

const escapeHtml = (s: any) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const BillingStatement: React.FC<BillingStatementProps> = ({ isOpen, onClose, customer, routerId, companySettings }) => {
    const { formatCurrency } = useLocalization();
    const [isLoading, setIsLoading] = useState(false);
    const [rows, setRows] = useState<BillingStatementRow[]>([]);
    const [autoRows, setAutoRows] = useState<BillingStatementRow[]>([]);
    const [docName, setDocName] = useState('');
    const [docAddress, setDocAddress] = useState('');
    const [docContact, setDocContact] = useState('');
    const [docAccountNumber, setDocAccountNumber] = useState('');
    const [docPlan, setDocPlan] = useState('');
    const [docDueDate, setDocDueDate] = useState('');
    const [docRemarks, setDocRemarks] = useState('');
    const [addMonth, setAddMonth] = useState(ymKey(new Date()));

    // Auto-compute unpaid months from payment history
    const computeAutoRows = (payments: any[]): BillingStatementRow[] => {
        const now = new Date();
        const currentYm = ymKey(now);
        const paidMonths = new Set<string>(
            payments
                .map((p: any) => (p.coveredMonth ? String(p.coveredMonth).slice(0, 7) : ''))
                .filter(Boolean)
        );
        // Monthly rate = latest payment's plan price
        const sortedPayments = [...payments].sort((a: any, b: any) =>
            new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
        );
        const monthlyRate = Number(sortedPayments[0]?.planPrice || sortedPayments[0]?.finalAmount || 0);
        const paidSorted = Array.from(paidMonths).sort();
        let startYm: string;
        if (paidSorted.length > 0) {
            // First unpaid month after the last paid covered month
            startYm = nextMonth(paidSorted[paidSorted.length - 1]);
        } else {
            // Never paid: start from customer due month (or current month)
            const due = customer?.dueDate ? new Date(customer.dueDate) : now;
            startYm = isNaN(due.getTime()) ? currentYm : ymKey(new Date(due.getFullYear(), due.getMonth(), 1));
        }
        if (isNaN(new Date(startYm + '-01').getTime())) startYm = currentYm;
        const result: BillingStatementRow[] = [];
        let ym = startYm;
        let guard = 0;
        while (ym <= currentYm && guard < 36) {
            if (!paidMonths.has(ym)) {
                result.push({
                    month: ym,
                    label: monthLabel(ym),
                    amount: monthlyRate,
                    status: ym < currentYm ? 'OVERDUE' : 'UNPAID',
                });
            }
            ym = nextMonth(ym);
            guard++;
        }
        return result;
    };

    useEffect(() => {
        if (!isOpen || !customer) return;
        setDocName(customer.fullName || customer.username || '');
        setDocAddress(customer.address || '');
        setDocContact(customer.contactNumber || '');
        setDocAccountNumber(customer.accountNumber || '');
        setDocPlan(customer.planName || '');
        setDocRemarks('');
        const d = new Date();
        d.setDate(d.getDate() + 15);
        setDocDueDate(d.toISOString().split('T')[0]);

        const fetchStatement = async () => {
            setIsLoading(true);
            try {
                const username = customer.username || '';
                const payRes = await fetch(`/api/public/client/payments?routerId=${routerId}&username=${encodeURIComponent(username)}`);
                const payData = await payRes.json();
                const payments = Array.isArray(payData) ? payData : [];
                const auto = computeAutoRows(payments);
                setAutoRows(auto);
                setRows(auto);
            } catch (err) {
                console.error('Failed to load billing statement data:', err);
                setAutoRows([]);
                setRows([]);
            } finally {
                setIsLoading(false);
            }
        };
        fetchStatement();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, customer, routerId]);

    const totalDue = useMemo(() => rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0), [rows]);

    const handleAddMonth = () => {
        if (!addMonth) return;
        if (rows.some(r => r.month === addMonth)) {
            alert('That month is already in the statement.');
            return;
        }
        const currentYm = ymKey(new Date());
        setRows(prev => [...prev, {
            month: addMonth,
            label: monthLabel(addMonth),
            amount: autoRows.find(r => r.month === addMonth)?.amount ?? autoRows[0]?.amount ?? 0,
            status: addMonth < currentYm ? 'OVERDUE' : 'UNPAID',
        }].sort((a, b) => a.month.localeCompare(b.month)));
    };

    const handleRemoveRow = (month: string) => setRows(prev => prev.filter(r => r.month !== month));

    const handleRowChange = (month: string, patch: Partial<BillingStatementRow>) =>
        setRows(prev => prev.map(r => (r.month === month ? { ...r, ...patch } : r)));

    const handleResetAuto = () => setRows(autoRows);

    const handlePrint = () => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;
        const companyName = companySettings?.companyName || '';
        const logo = companySettings?.logoBase64 || '';
        const rowsHtml = rows.map(r => `
            <tr>
                <td>${escapeHtml(r.label)}</td>
                <td class="text-right">${formatCurrency(Number(r.amount) || 0)}</td>
                <td class="text-center status-${r.status.toLowerCase()}">${escapeHtml(r.status)}</td>
            </tr>`).join('');
        const infoGrid = `
                <div class="info-grid">
                    <div><div class="info-label">Customer Name:</div><div class="info-value">${escapeHtml(docName)}</div></div>
                    <div><div class="info-label">Account Number:</div><div class="info-value">${escapeHtml(docAccountNumber || '—')}</div></div>
                    <div><div class="info-label">Address:</div><div class="info-value">${escapeHtml(docAddress || '—')}</div></div>
                    <div><div class="info-label">Contact Number:</div><div class="info-value">${escapeHtml(docContact || '—')}</div></div>
                    <div><div class="info-label">Plan / Service:</div><div class="info-value">${escapeHtml(docPlan || '—')}</div></div>
                    <div><div class="info-label">Months Unpaid:</div><div class="info-value">${rows.length}</div></div>
                </div>`;
        const tableHtml = `
                <table>
                    <thead>
                        <tr>
                            <th>Billing Month</th>
                            <th class="text-right">Amount</th>
                            <th class="text-center">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml || '<tr><td colspan="3" class="text-center">No unpaid months</td></tr>'}
                        <tr class="total-row">
                            <td>TOTAL AMOUNT DUE</td>
                            <td class="text-right">${formatCurrency(totalDue)}</td>
                            <td></td>
                        </tr>
                    </tbody>
                </table>`;
        const remarksHtml = docRemarks ? `<div class="remarks"><strong>Remarks:</strong><div class="remarks-box">${escapeHtml(docRemarks)}</div></div>` : '';
        const headerHtml = `
                <div class="header">
                    ${logo ? `<img src="${escapeHtml(logo)}" alt="logo" style="max-height:70px;margin-bottom:6px;" /><br/>` : ''}
                    <div class="company-name">${escapeHtml(companyName)}</div>
                    <div class="company-info">
                        ${companySettings?.address ? escapeHtml(companySettings.address) + '<br/>' : ''}
                        ${companySettings?.contactNumber ? 'Contact: ' + escapeHtml(companySettings.contactNumber) : ''}
                        ${companySettings?.email ? (companySettings?.contactNumber ? ' &bull; ' : '') + 'Email: ' + escapeHtml(companySettings.email) : ''}
                    </div>
                    ${birHtmlLine(companySettings) ? `<div class="company-info" style="margin-top:2px;">${birHtmlLine(companySettings)}</div>` : ''}
                </div>`;
        const footerHtml = `
                <div class="footer">
                    <p>Please settle your outstanding balance on or before the due date to avoid service interruption.</p>
                    <div class="sig">
                        <div class="sig-line">Prepared By</div>
                        <div class="sig-line">Received By</div>
                    </div>
                    <div class="gen-note">This is a computer-generated billing statement.</div>
                </div>`;
        const styles = `
            body { font-family: Arial, sans-serif; padding: 40px; color: #333; }
            .header { text-align: center; border-bottom: 3px double #333; padding-bottom: 12px; margin-bottom: 24px; }
            .company-name { font-size: 26px; font-weight: bold; letter-spacing: 1px; margin: 0; }
            .company-info { font-size: 12px; color: #555; margin-top: 4px; }
            h1 { font-size: 18px; text-align: center; margin: 0 0 4px 0; }
            .subtitle { color: #666; font-size: 12px; text-align: center; margin-bottom: 24px; }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
            .info-label { color: #666; font-size: 12px; margin-bottom: 2px; }
            .info-value { font-size: 15px; font-weight: bold; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
            th { text-align: left; padding: 8px; border-bottom: 2px solid #333; font-weight: bold; background: #f3f3f3; }
            td { padding: 8px; border-bottom: 1px solid #ddd; }
            .text-right { text-align: right; }
            .text-center { text-align: center; }
            .total-row td { border-top: 2px solid #333; font-weight: bold; font-size: 16px; padding-top: 12px; }
            .status-overdue { color: #b91c1c; font-weight: bold; }
            .status-unpaid { color: #b45309; font-weight: bold; }
            .remarks { margin-bottom: 24px; font-size: 13px; }
            .remarks-box { border: 1px solid #ccc; padding: 10px; min-height: 40px; }
            .footer { margin-top: 48px; font-size: 12px; color: #555; }
            .sig { margin-top: 48px; display: flex; justify-content: space-between; }
            .sig-line { border-top: 1px solid #333; width: 220px; text-align: center; padding-top: 4px; }
            .gen-note { margin-top: 32px; text-align: center; font-size: 11px; color: #999; }
            @media print { body { padding: 20px; } }`;
        const subtitleHtml = `<div class="subtitle">Statement Date: ${new Date().toLocaleDateString()}${docDueDate ? ' &nbsp;&bull;&nbsp; Payment Due Date: ' + escapeHtml(new Date(docDueDate + 'T00:00:00').toLocaleDateString()) : ''}</div>`;
        const html = `
            <html>
            <head><title>Billing Statement - ${escapeHtml(docName)}</title><style>${styles}</style></head>
            <body>
                ${headerHtml}
                <h1>BILLING STATEMENT OF UNPAID MONTHLY DUES</h1>
                ${subtitleHtml}
                ${infoGrid}
                ${tableHtml}
                ${remarksHtml}
                ${footerHtml}
            </body>
            </html>`;
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => printWindow.print(), 250);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-3xl w-full flex flex-col max-h-[92vh]">
                {/* Modal Header */}
                <div className="flex justify-between items-center px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
                    <div>
                        <h3 className="text-xl font-bold text-slate-800 dark:text-white">Billing Statement</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Unpaid monthly dues for {customer?.fullName || customer?.username} — editable before printing</p>
                    </div>
                    <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700">
                        <XMarkIcon className="w-5 h-5" />
                    </button>
                </div>

                {/* Modal Body */}
                <div className="overflow-y-auto px-6 py-4 space-y-5 flex-1">
                    {isLoading ? (
                        <div className="text-center py-10 text-slate-500">Loading payment history...</div>
                    ) : (
                        <>
                            {/* Editable client info */}
                            <div>
                                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Client Information (editable)</h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Customer Name</label>
                                        <input type="text" value={docName} onChange={e => setDocName(e.target.value)}
                                            className="w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-white text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Account Number</label>
                                        <input type="text" value={docAccountNumber} onChange={e => setDocAccountNumber(e.target.value)}
                                            className="w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-white text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Address</label>
                                        <input type="text" value={docAddress} onChange={e => setDocAddress(e.target.value)}
                                            className="w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-white text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Contact Number</label>
                                        <input type="text" value={docContact} onChange={e => setDocContact(e.target.value)}
                                            className="w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-white text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Plan / Service</label>
                                        <input type="text" value={docPlan} onChange={e => setDocPlan(e.target.value)}
                                            className="w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-white text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Payment Due Date</label>
                                        <input type="date" value={docDueDate} onChange={e => setDocDueDate(e.target.value)}
                                            className="w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-white text-sm" />
                                    </div>
                                </div>
                            </div>
                            {/* Editable unpaid months */}
                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Unpaid Months</h4>
                                    <button onClick={handleResetAuto}
                                        className="text-xs px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">
                                        Reset to Auto-Computed
                                    </button>
                                </div>
                                <div className="border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead className="text-xs text-slate-500 uppercase bg-slate-50 dark:bg-slate-900/50">
                                            <tr>
                                                <th className="px-3 py-2 text-left">Billing Month</th>
                                                <th className="px-3 py-2 text-right">Amount</th>
                                                <th className="px-3 py-2 text-center">Status</th>
                                                <th className="px-3 py-2 w-10"></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rows.map(r => (
                                                <tr key={r.month} className="border-t border-slate-200 dark:border-slate-700">
                                                    <td className="px-3 py-1.5 text-slate-800 dark:text-white">{r.label}</td>
                                                    <td className="px-3 py-1.5 text-right">
                                                        <input type="number" min="0" step="0.01" value={r.amount}
                                                            onChange={e => handleRowChange(r.month, { amount: Number(e.target.value) })}
                                                            className="w-28 p-1 text-right rounded bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-white" />
                                                    </td>
                                                    <td className="px-3 py-1.5 text-center">
                                                        <select value={r.status}
                                                            onChange={e => handleRowChange(r.month, { status: e.target.value as BillingStatementRow['status'] })}
                                                            className="p-1 rounded bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-white">
                                                            <option value="UNPAID">UNPAID</option>
                                                            <option value="OVERDUE">OVERDUE</option>
                                                        </select>
                                                    </td>
                                                    <td className="px-3 py-1.5 text-center">
                                                        <button onClick={() => handleRemoveRow(r.month)}
                                                            className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded" title="Remove month">
                                                            <XMarkIcon className="w-4 h-4" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {rows.length === 0 && (
                                                <tr className="border-t border-slate-200 dark:border-slate-700">
                                                    <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                                                        No unpaid months detected. Add months manually below if needed.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                        <tfoot className="border-t-2 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50">
                                            <tr>
                                                <td className="px-3 py-2 font-bold text-slate-800 dark:text-white">TOTAL AMOUNT DUE</td>
                                                <td className="px-3 py-2 text-right font-bold text-red-600 dark:text-red-400">{formatCurrency(totalDue)}</td>
                                                <td colSpan={2}></td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                                {/* Add month row */}
                                <div className="flex items-center gap-2 mt-2">
                                    <PlusIcon className="w-4 h-4 text-slate-500" />
                                    <select value={addMonth} onChange={e => setAddMonth(e.target.value)}
                                        className="p-1.5 rounded-md bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-white text-sm">
                                        {Array.from({ length: 36 }, (_, i) => {
                                            const d = new Date();
                                            d.setMonth(d.getMonth() - i);
                                            const ym = ymKey(d);
                                            return <option key={ym} value={ym}>{monthLabel(ym)}</option>;
                                        })}
                                    </select>
                                    <button onClick={handleAddMonth}
                                        className="px-3 py-1.5 text-sm rounded-md bg-sky-600 text-white hover:bg-sky-700">
                                        Add Month
                                    </button>
                                </div>
                            </div>

                            {/* Remarks */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Remarks (optional)</label>
                                <textarea value={docRemarks} onChange={e => setDocRemarks(e.target.value)} rows={2}
                                    className="w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-white text-sm"
                                    placeholder="e.g. Please process payment through the accounting office." />
                            </div>
                        </>
                    )}
                </div>
                {/* Modal Footer */}
                <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3 flex-shrink-0 bg-slate-50 dark:bg-slate-900/50 rounded-b-xl">
                    <button onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600">
                        Close
                    </button>
                    <button onClick={handlePrint} disabled={isLoading}
                        className="px-4 py-2 text-sm font-medium text-white bg-sky-600 rounded-md hover:bg-sky-700 disabled:opacity-50">
                        Print / Save as PDF
                    </button>
                </div>
            </div>
        </div>
    );
};

