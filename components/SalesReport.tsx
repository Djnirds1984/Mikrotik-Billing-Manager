import React, { useState, useMemo, useEffect } from 'react';
import type { SaleRecord, CompanySettings } from '../types.ts';
import { CurrencyDollarIcon, TrashIcon, PrinterIcon, ArrowPathIcon } from '../constants.tsx';
import { PrintableReceipt } from './PrintableReceipt.tsx';
import { PrintableThermalReceipt } from './PrintableThermalReceipt.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { dbApi } from '../services/databaseService.ts';
import { getAuthHeader } from '../services/databaseService.ts';
import type { PanelSettings } from '../types.ts';
import { mikrotikSalesService } from '../services/mikrotikSalesService.ts';
import { MikrotikSalesLogs } from './MikrotikSalesLogs.tsx';

interface SalesReportProps {
    salesData: SaleRecord[];
    deleteSale: (saleId: string) => void;
    clearSales: () => void;
    companySettings: CompanySettings;
    selectedRouter?: any;
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

export const SalesReport: React.FC<SalesReportProps> = ({ salesData, deleteSale, clearSales, companySettings, selectedRouter }) => {
    const { hasPermission } = useAuth();
    const { formatCurrency } = useLocalization();
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [receiptToPrint, setReceiptToPrint] = useState<SaleRecord | null>(null);
    const [receiptPrintMode, setReceiptPrintMode] = useState<'normal' | 'thermal'>('normal');
    const [invoices, setInvoices] = useState<any[]>([]);
    const [invLoading, setInvLoading] = useState<boolean>(false);
    const [isAddOpen, setIsAddOpen] = useState<boolean>(false);
    const [routers, setRouters] = useState<any[]>([]);
    const [addSource, setAddSource] = useState<'pppoe' | 'dhcp'>('pppoe');
    const [addRouterId, setAddRouterId] = useState<string>('');
    const [clients, setClients] = useState<any[]>([]);
    const [selectedClientId, setSelectedClientId] = useState<string>('');
    const [invoiceToView, setInvoiceToView] = useState<any | null>(null);
    const [invoiceToPrint, setInvoiceToPrint] = useState<any | null>(null);
    const [invoiceToEdit, setInvoiceToEdit] = useState<any | null>(null);
    const [isEditOpen, setIsEditOpen] = useState<boolean>(false);
    const [panelSettings, setPanelSettings] = useState<PanelSettings | null>(null);
    const [isSyncing, setIsSyncing] = useState<string | null>(null);

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

    const loadInvoices = async () => {
        setInvLoading(true);
        try {
            const rows = await dbApi.get('/client-invoices');
            setInvoices(Array.isArray(rows) ? rows : []);
        } catch (e) {
            setInvoices([]);
        } finally {
            setInvLoading(false);
        }
    };
    const loadRouters = async () => {
        try { const rows = await dbApi.get('/routers'); setRouters(Array.isArray(rows) ? rows : []); }
        catch { setRouters([]); }
    };
    const loadClientsForRouter = async (routerId: string, source: 'pppoe' | 'dhcp') => {
        try {
            if (source === 'pppoe') {
                const res = await fetch('/api/client-portal/users', { headers: getAuthHeader() });
                const data = await res.json();
                const list = Array.isArray(data) ? data.filter((u: any) => u.router_id === routerId) : [];
                setClients(list.map((u: any) => ({ id: u.id, label: `${u.username} (${u.pppoe_username})`, username: u.username, pppoe_username: u.pppoe_username, account_number: u.account_number })));
            } else {
                const rows = await dbApi.get(`/dhcp_clients?routerId=${routerId}`);
                const list = Array.isArray(rows) ? rows : [];
                setClients(list.map((c: any) => ({ id: c.id || c.macAddress, label: `${c.customerInfo || c.hostName || c.macAddress}`, macAddress: c.macAddress, hostName: c.hostName, customerInfo: c.customerInfo })));
            }
        } catch { setClients([]); }
    };
    const issueInvoice = async () => {
        if (!addRouterId || !selectedClientId) return;
        try {
            let payload: any = { routerId: addRouterId, source: addSource, status: 'PENDING', issueDate: new Date().toISOString() };
            if (addSource === 'pppoe') {
                const client = clients.find(c => c.id === selectedClientId);
                const uname = client?.pppoe_username || client?.username;
                payload.username = uname;
                payload.accountNumber = client?.account_number || null;
                // Fetch secret to get plan/due
                const encName = encodeURIComponent(String(uname));
                const res = await fetch(`/mt-api/${addRouterId}/ppp/secret?name=${encName}`, { headers: getAuthHeader() });
                const data = await res.json();
                const secret = Array.isArray(data) && data.length > 0 ? data[0] : null;
                let planName = ''; let planId = ''; let dueDateTime = null as string | null;
                if (secret) {
                    try {
                        const c = JSON.parse(String(secret.comment || '{}'));
                        planName = c.planName || c.plan || '';
                        planId = c.planId || '';
                        if (c.dueDateTime) dueDateTime = new Date(c.dueDateTime).toISOString();
                        else if (c.dueDate) dueDateTime = new Date(`${c.dueDate}T23:59:59`).toISOString();
                    } catch {}
                }
                // Lookup plan price
                let amount = 0; let currency = 'PHP';
                if (planId) {
                    const p = await dbApi.get<any[]>(`/billing-plans?routerId=${addRouterId}`);
                    const found = Array.isArray(p) ? p.find(pl => pl.id === planId) : null;
                    if (found) { amount = found.price || 0; currency = found.currency || 'PHP'; planName = found.name || planName; }
                } else if (planName) {
                    const p = await dbApi.get<any[]>(`/billing-plans?routerId=${addRouterId}`);
                    const found = Array.isArray(p) ? p.find(pl => String(pl.name).toLowerCase() === String(planName).toLowerCase()) : null;
                    if (found) { amount = found.price || 0; currency = found.currency || 'PHP'; planName = found.name || planName; }
                }
                payload.planName = planName;
                payload.planId = planId || null;
                payload.amount = amount;
                payload.currency = currency;
                payload.dueDateTime = dueDateTime;
            } else {
                const client = clients.find(c => c.id === selectedClientId);
                const label = client?.customerInfo || client?.hostName || client?.macAddress;
                payload.username = String(label || '').toLowerCase();
                payload.planName = '';
                payload.amount = 0;
                payload.currency = 'PHP';
                payload.dueDateTime = null;
            }
            await dbApi.post('/client-invoices', payload);
            setIsAddOpen(false);
            setSelectedClientId('');
            await loadInvoices();
            alert('Invoice created.');
        } catch (e) {
            alert((e as Error).message);
        }
    };
    const markInvoice = async (id: string, status: 'PAID' | 'PENDING') => {
        try {
            await dbApi.patch(`/client-invoices/${id}`, { status });
            await loadInvoices();
            alert(`Invoice marked as ${status}.`);
        } catch (e) {
            alert((e as Error).message);
        }
    };
    const openEditInvoice = (inv: any) => {
        setInvoiceToEdit({ ...inv });
        setIsEditOpen(true);
    };
    const saveEditInvoice = async () => {
        if (!invoiceToEdit?.id) return;
        try {
            const payload: any = {
                planName: invoiceToEdit.planName || '',
                amount: Number(invoiceToEdit.amount || 0),
                currency: invoiceToEdit.currency || 'PHP',
                status: String(invoiceToEdit.status || 'PENDING').toUpperCase() === 'PAID' ? 'PAID' : 'PENDING',
            };
            if (invoiceToEdit.dueDateTime) {
                const dt = new Date(invoiceToEdit.dueDateTime);
                payload.dueDateTime = dt.toISOString();
            }
            await dbApi.patch(`/client-invoices/${invoiceToEdit.id}`, payload);
            setIsEditOpen(false);
            setInvoiceToEdit(null);
            await loadInvoices();
            alert('Invoice updated.');
        } catch (e) {
            alert((e as Error).message);
        }
    };
    const deleteInvoice = async (id: string) => {
        if (!id) return;
        if (!window.confirm('Delete this invoice?')) return;
        try {
            await dbApi.delete(`/client-invoices/${id}`);
            await loadInvoices();
        } catch (e) {
            alert((e as Error).message);
        }
    };

    const handleClear = () => {
        if (window.confirm("Are you sure you want to delete ALL sales records? This action cannot be undone.")) {
            clearSales();
        }
    };
    const handlePrintInvoice = () => {
        if (!invoiceToView) return;
        setInvoiceToPrint(invoiceToView);
        setTimeout(() => {
            window.print();
            setInvoiceToPrint(null);
        }, 150);
    };

    const handlePrintReport = () => {
        window.print();
    };

    const handlePrintReceipt = (sale: SaleRecord, mode: 'normal' | 'thermal') => {
        setReceiptPrintMode(mode);
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
    useEffect(() => { loadInvoices(); loadRouters(); }, []);
    useEffect(() => {
        if (addRouterId) loadClientsForRouter(addRouterId, addSource);
    }, [addRouterId, addSource]);
    useEffect(() => {
        dbApi.get<PanelSettings>('/panel-settings').then(setPanelSettings).catch(() => setPanelSettings(null));
    }, []);

    const handleSyncToMikrotik = async (saleId: string) => {
        setIsSyncing(saleId);
        try {
            const result = await mikrotikSalesService.syncSaleToMikrotik(saleId);
            if (result.success) {
                alert('Sale synced to Mikrotik successfully!');
            } else {
                alert('Failed to sync sale: ' + result.message);
            }
        } catch (error) {
            console.error('Error syncing sale to mikrotik:', error);
            alert('Error syncing sale to Mikrotik: ' + (error as Error).message);
        } finally {
            setIsSyncing(null);
        }
    };

    return (
        <>
            <div className={receiptToPrint ? 'printable-area' : 'hidden'}>
                {receiptPrintMode === 'thermal' ? (
                    <PrintableThermalReceipt sale={receiptToPrint} companySettings={companySettings} />
                ) : (
                    <PrintableReceipt sale={receiptToPrint} companySettings={companySettings} />
                )}
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
                            <button onClick={() => setIsAddOpen(true)} className="px-4 py-2 text-sm text-white bg-green-600 hover:bg-green-500 rounded-lg font-semibold">
                                Add Invoice
                            </button>
                             {hasPermission('sales_report:delete') && (
                                <button onClick={handleClear} className="px-4 py-2 text-sm text-white bg-red-700 hover:bg-red-800 dark:bg-red-800 dark:hover:bg-red-700 rounded-lg font-semibold flex items-center gap-2">
                                    <TrashIcon className="w-5 h-5" /> Clear All
                                </button>
                             )}
                        </div>
                    </div>
                    
                    {isAddOpen && (
                        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg w-full max-w-lg">
                                <div className="px-4 py-3 border-b dark:border-slate-700">
                                    <h3 className="text-lg font-semibold">Add Invoice</h3>
                                </div>
                                <div className="p-4 space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium">Source</label>
                                        <select value={addSource} onChange={e => setAddSource(e.target.value as 'pppoe'|'dhcp')} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">
                                            <option value="pppoe">PPPoE</option>
                                            <option value="dhcp">DHCP Portal</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium">Router</label>
                                        <select value={addRouterId} onChange={e => setAddRouterId(e.target.value)} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">
                                            <option value="">Select Router</option>
                                            {routers.map(r => <option key={r.id} value={r.id}>{r.name || r.id}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium">Client</label>
                                        <select value={selectedClientId} onChange={e => setSelectedClientId(e.target.value)} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">
                                            <option value="">Select Client</option>
                                            {clients.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div className="px-4 py-3 border-t dark:border-slate-700 flex justify-end gap-2">
                                    <button onClick={() => setIsAddOpen(false)} className="px-4 py-2 bg-slate-200 dark:bg-slate-700 rounded-md">Cancel</button>
                                    <button onClick={issueInvoice} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md">Create</button>
                                </div>
                            </div>
                        </div>
                    )}
                    {isEditOpen && invoiceToEdit && (
                        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg w-full max-w-lg">
                                <div className="px-4 py-3 border-b dark:border-slate-700">
                                    <h3 className="text-lg font-semibold">Edit Invoice</h3>
                                </div>
                                <div className="p-4 space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium">Plan Name</label>
                                        <input value={invoiceToEdit.planName || ''} onChange={e => setInvoiceToEdit({ ...invoiceToEdit, planName: e.target.value })} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                        <label className="block text-sm font-medium">Amount</label>
                                            <input type="number" value={invoiceToEdit.amount ?? ''} onChange={e => setInvoiceToEdit({ ...invoiceToEdit, amount: e.target.value === '' ? null : Number(e.target.value) })} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium">Currency</label>
                                            <input value={invoiceToEdit.currency || 'PHP'} onChange={e => setInvoiceToEdit({ ...invoiceToEdit, currency: e.target.value })} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium">Due Date</label>
                                        <input type="datetime-local" value={invoiceToEdit.dueDateTime ? new Date(invoiceToEdit.dueDateTime).toISOString().slice(0,16) : ''} onChange={e => {
                                            const v = e.target.value;
                                            setInvoiceToEdit({ ...invoiceToEdit, dueDateTime: v ? new Date(v).toISOString() : null });
                                        }} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium">Status</label>
                                        <select value={String(invoiceToEdit.status || 'PENDING').toUpperCase()} onChange={e => setInvoiceToEdit({ ...invoiceToEdit, status: e.target.value })} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">
                                            <option value="PENDING">PENDING</option>
                                            <option value="PAID">PAID</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="px-4 py-3 border-t dark:border-slate-700 flex justify-end gap-2">
                                    <button onClick={() => { setIsEditOpen(false); setInvoiceToEdit(null); }} className="px-4 py-2 bg-slate-200 dark:bg-slate-700 rounded-md">Cancel</button>
                                    <button onClick={saveEditInvoice} className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-md">Save</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard title="Net Revenue" value={formatCurrency(summary.netRevenue)} icon={<CurrencyDollarIcon className="w-6 h-6 text-green-500 dark:text-green-400" />} />
                        <StatCard title="Total Sales" value={formatCurrency(summary.totalSales)} icon={<CurrencyDollarIcon className="w-6 h-6 text-sky-500 dark:text-sky-400" />} />
                        <StatCard title="Total Discounts" value={formatCurrency(summary.totalDiscounts)} icon={<CurrencyDollarIcon className="w-6 h-6 text-yellow-500 dark:text-yellow-400" />} />
                        <StatCard title="Transactions" value={summary.transactions} icon={<span className="text-2xl text-slate-500 dark:text-slate-400">#</span>} />
                    </div>
                    
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
                        <div className="p-4 flex justify-between items-center border-b border-slate-200 dark:border-slate-700 no-print">
                            <div>
                                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">Invoices</h3>
                                <p className="text-slate-500 dark:text-slate-400 mt-1">Mark as Paid or Pending. Paid invoices are added to Sales.</p>
                            </div>
                            <button onClick={loadInvoices} className="px-4 py-2 text-sm text-white bg-sky-600 hover:bg-sky-500 rounded-lg font-semibold">Refresh</button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                                    <tr>
                                        <th className="px-4 py-3">Issued</th>
                                        <th className="px-4 py-3">Due</th>
                                        <th className="px-4 py-3">Client</th>
                                        <th className="px-4 py-3">Plan</th>
                                        <th className="px-4 py-3 text-right">Amount</th>
                                        <th className="px-4 py-3">Status</th>
                                        <th className="px-4 py-3 text-center no-print">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {invLoading ? (
                                        <tr><td colSpan={7} className="text-center py-6 text-slate-500">Loading...</td></tr>
                                    ) : invoices.length > 0 ? invoices.map(inv => (
                                        <tr key={inv.id} className="border-b border-slate-200 dark:border-slate-700 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                            <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">{inv.issueDate ? new Date(inv.issueDate).toLocaleString() : '—'}</td>
                                            <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">{inv.dueDateTime ? new Date(inv.dueDateTime).toLocaleString() : '—'}</td>
                                            <td className="px-4 py-3">{inv.username}</td>
                                            <td className="px-4 py-3">{inv.planName || '—'}</td>
                                            <td className="px-4 py-3 text-right font-mono text-green-600 dark:text-green-400">{formatCurrency(inv.amount || 0)}</td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-1 rounded text-xs font-bold ${String(inv.status).toUpperCase() === 'PAID' ? 'bg-emerald-100 text-emerald-700' : 'bg-yellow-100 text-yellow-700'}`}>{String(inv.status || 'PENDING').toUpperCase()}</span>
                                            </td>
                                            <td className="px-4 py-3 text-center no-print space-x-2">
                                                <button type="button" onClick={() => setInvoiceToView(inv)} className="px-3 py-1 text-sm bg-slate-600 text-white rounded-md font-semibold hover:bg-slate-700">View</button>
                                                <button type="button" onClick={() => openEditInvoice(inv)} className="px-3 py-1 text-sm bg-sky-600 text-white rounded-md font-semibold hover:bg-sky-700">Edit</button>
                                                <button type="button" onClick={() => markInvoice(inv.id, 'PAID')} className="px-3 py-1 text-sm bg-green-600 text-white rounded-md font-semibold hover:bg-green-700">Mark Paid</button>
                                                <button type="button" onClick={() => markInvoice(inv.id, 'PENDING')} className="px-3 py-1 text-sm bg-yellow-500 text-white rounded-md font-semibold hover:bg-yellow-600">Mark Pending</button>
                                                <button type="button" onClick={() => deleteInvoice(inv.id)} className="px-3 py-1 text-sm bg-red-600 text-white rounded-md font-semibold hover:bg-red-700">Delete</button>
                                            </td>
                                        </tr>
                                    )) : (
                                        <tr><td colSpan={7} className="text-center py-8 text-slate-500">No invoices found.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
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
                                                <button onClick={() => handlePrintReceipt(sale, 'normal')} className="p-2 text-slate-500 dark:text-slate-400 hover:text-sky-500 dark:hover:text-sky-400 rounded-md" title="Print Acknowledgement Receipt (Normal)">
                                                    <PrinterIcon className="h-5 w-5" />
                                                </button>
                                                <button onClick={() => handlePrintReceipt(sale, 'thermal')} className="p-2 text-slate-500 dark:text-slate-400 hover:text-emerald-500 dark:hover:text-emerald-400 rounded-md" title="Print Acknowledgement Receipt (Thermal)">
                                                    <PrinterIcon className="h-5 w-5" />
                                                </button>
                                                <button 
                                                    onClick={() => handleSyncToMikrotik(sale.id)} 
                                                    className="p-2 text-slate-500 dark:text-slate-400 hover:text-purple-500 dark:hover:text-purple-400 rounded-md" 
                                                    title="Sync to Mikrotik"
                                                    disabled={isSyncing === sale.id}
                                                >
                                                    {isSyncing === sale.id ? (
                                                        <div className="animate-spin h-5 w-5 border-2 border-purple-500 border-t-transparent rounded-full"></div>
                                                    ) : (
                                                        <ArrowPathIcon className="h-5 w-5" />
                                                    )}
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
                                            <td colSpan={9} className="text-center py-8 text-slate-500">
                                                No sales records found for the selected period.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    
                    {invoiceToView && (
                        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 no-print">
                            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg w-full max-w-2xl">
                                <div className="px-6 py-4 border-b dark:border-slate-700 flex justify-between items-center">
                                    <h3 className="text-lg font-semibold">Invoice</h3>
                                    <div className="flex items-center gap-2">
                                        {String(invoiceToView.status).toUpperCase() === 'PAID' && (
                                            <button onClick={handlePrintInvoice} className="px-3 py-1 bg-sky-600 hover:bg-sky-700 text-white rounded-md">Print Invoice</button>
                                        )}
                                        <button onClick={() => setInvoiceToView(null)} className="px-3 py-1 bg-slate-200 dark:bg-slate-700 rounded-md">Close</button>
                                    </div>
                                </div>
                                <div className="p-6 space-y-4">
                                    <div className="flex justify-between items-start">
                                        <div className="w-2/3">
                                            <div className="text-2xl font-bold">{panelSettings?.companyName || 'Your Company'}</div>
                                            {panelSettings?.address && <div className="text-sm">{panelSettings.address}</div>}
                                            {panelSettings?.contactNumber && <div className="text-sm">{panelSettings.contactNumber}</div>}
                                            {panelSettings?.email && <div className="text-sm">{panelSettings.email}</div>}
                                        </div>
                                        {panelSettings?.logoBase64 && (
                                            <div className="w-1/3 flex justify-end">
                                                <img src={panelSettings.logoBase64} alt="" className="h-12 w-auto object-contain" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="font-semibold">Billed To</div>
                                            <div>{invoiceToView.username}</div>
                                            {invoiceToView.accountNumber && <div className="text-sm">Account: {invoiceToView.accountNumber}</div>}
                                        </div>
                                        <div className="text-right">
                                            <div className="font-semibold">INVOICE</div>
                                            <div>Issued: {invoiceToView.issueDate ? new Date(invoiceToView.issueDate).toLocaleString() : '—'}</div>
                                            <div>Due: {invoiceToView.dueDateTime ? new Date(invoiceToView.dueDateTime).toLocaleString() : '—'}</div>
                                            <div className={`inline-block mt-1 px-2 py-1 rounded text-xs font-bold ${String(invoiceToView.status).toUpperCase() === 'PAID' ? 'bg-emerald-100 text-emerald-700' : 'bg-yellow-100 text-yellow-700'}`}>{String(invoiceToView.status || 'PENDING').toUpperCase()}</div>
                                        </div>
                                    </div>
                                    <div className="border rounded">
                                        <div className="grid grid-cols-2 text-sm">
                                            <div className="p-3 border-r">Plan</div>
                                            <div className="p-3">{invoiceToView.planName || '—'}</div>
                                            <div className="p-3 border-r">Amount</div>
                                            <div className="p-3">{formatCurrency(invoiceToView.amount || 0)}</div>
                                            <div className="p-3 border-r">Currency</div>
                                            <div className="p-3">{invoiceToView.currency || 'PHP'}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    <div className={invoiceToPrint ? 'printable-area' : 'hidden'}>
                        {invoiceToPrint && panelSettings && (
                            <div className="p-8 font-sans text-black bg-white">
                                <header className="flex justify-between items-start pb-4 border-b-2 border-black">
                                    <div className="w-2/3">
                                        <div className="text-3xl font-bold">{panelSettings.companyName || 'Your Company'}</div>
                                        {panelSettings.address && <div className="text-sm">{panelSettings.address}</div>}
                                        {panelSettings.contactNumber && <div className="text-sm">{panelSettings.contactNumber}</div>}
                                        {panelSettings.email && <div className="text-sm">{panelSettings.email}</div>}
                                    </div>
                                    {panelSettings.logoBase64 && (
                                        <div className="w-1/3 flex justify-end">
                                            <img src={panelSettings.logoBase64} alt="" className="h-16 w-auto object-contain" />
                                        </div>
                                    )}
                                </header>
                                <section className="my-6">
                                    <div className="flex justify-between">
                                        <div>
                                            <div className="font-bold">BILLED TO:</div>
                                            <div>{invoiceToPrint.username}</div>
                                            {invoiceToPrint.accountNumber && <div className="text-sm">Account: {invoiceToPrint.accountNumber}</div>}
                                        </div>
                                        <div className="text-right">
                                            <div className="font-bold">INVOICE</div>
                                            <div>Issued: {invoiceToPrint.issueDate ? new Date(invoiceToPrint.issueDate).toLocaleDateString() : '—'}</div>
                                            <div>Due: {invoiceToPrint.dueDateTime ? new Date(invoiceToPrint.dueDateTime).toLocaleDateString() : '—'}</div>
                                            <div>Status: {String(invoiceToPrint.status || 'PENDING').toUpperCase()}</div>
                                        </div>
                                    </div>
                                </section>
                                <table className="w-full text-left border-collapse">
                                    <thead className="bg-gray-200">
                                        <tr>
                                            <th className="p-2 border border-black">DESCRIPTION</th>
                                            <th className="p-2 border border-black text-right">AMOUNT</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td className="p-2 border border-black">
                                                <div className="font-semibold">{invoiceToPrint.planName || 'Subscription'}</div>
                                                <div className="text-xs text-gray-600">Internet Plan Subscription</div>
                                            </td>
                                            <td className="p-2 border border-black text-right">{formatCurrency(invoiceToPrint.amount || 0)}</td>
                                        </tr>
                                    </tbody>
                                </table>
                                <section className="my-6 flex justify-end">
                                    <div className="w-1/2">
                                        <div className="flex justify-between font-bold text-xl mt-2 pt-2 border-t-2 border-black">
                                            <span>TOTAL:</span>
                                            <span>{formatCurrency(invoiceToPrint.amount || 0)}</span>
                                        </div>
                                    </div>
                                </section>
                                <footer className="mt-8 pt-4 border-t-2 border-dashed border-black text-center">
                                    <div className="font-bold">Thank you!</div>
                                    <div className="text-xs mt-2">This is an invoice document.</div>
                                </footer>
                            </div>
                        )}
                    </div>
                </div>
                
                {/* Mikrotik Sales Logs Section */}
                <div className="mt-8">
                    <MikrotikSalesLogs routerId={selectedRouter?.id} />
                </div>
            </div>
        </>
    );
}
