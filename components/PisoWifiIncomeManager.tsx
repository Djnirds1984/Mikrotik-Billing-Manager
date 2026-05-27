import React, { useState, useMemo } from 'react';
import type { PisowifiIncomeRecord, PisowifiReseller } from '../types.ts';
import { EditIcon, TrashIcon } from '../constants.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';

// Helper: Download as CSV
const downloadCSV = (data: any[], filename: string) => {
    if (data.length === 0) {
        alert("There is no data to export.");
        return;
    }
    const headers = Object.keys(data[0]);
    const csvRows = [
        headers.join(','),
        ...data.map(row => 
            headers.map(header => 
                JSON.stringify(row[header], (_, value) => value === null ? '' : value)
            ).join(',')
        )
    ];
    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

// PisoWiFi Income Form Modal
const PisowifiIncomeFormModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: any) => void;
    initialData: PisowifiIncomeRecord | null;
    resellers: PisowifiReseller[];
    defaultResellerId?: string;
}> = ({ isOpen, onClose, onSave, initialData, resellers, defaultResellerId }) => {
    const [form, setForm] = useState({
        resellerId: '',
        vendoLocation: '',
        percentage: '',
        grossSales: '',
        expenses: '',
    });

    const normalizedPercent = useMemo(() => {
        const raw = parseFloat(form.percentage);
        if (!Number.isFinite(raw) || raw <= 0) return 0;
        if (raw === 1) return 1;
        if (raw > 1) return raw;
        return raw * 100;
    }, [form.percentage]);

    const percentAmount = useMemo(() => {
        const gross = parseFloat(form.grossSales) || 0;
        return gross * (normalizedPercent / 100);
    }, [form.grossSales, normalizedPercent]);

    const computedNetTotal = useMemo(() => {
        const gross = parseFloat(form.grossSales) || 0;
        const exp = parseFloat(form.expenses) || 0;
        return gross - percentAmount - exp;
    }, [form.grossSales, form.expenses, percentAmount]);

    React.useEffect(() => {
        if (!isOpen) return;
        if (initialData) {
            const matchByName = initialData.resellerName
                ? resellers.find(r => r.name.toLowerCase() === String(initialData.resellerName).toLowerCase())
                : undefined;
            const resellerId = initialData.resellerId || matchByName?.id || '';
            const raw = Number(initialData.percentage) || 0;
            const percent = raw <= 0 ? 0 : raw === 1 ? 1 : raw > 1 ? raw : raw * 100;
            setForm({
                resellerId,
                vendoLocation: initialData.vendoLocation || '',
                percentage: percent ? String(percent) : '',
                grossSales: String(initialData.grossSales ?? ''),
                expenses: String(initialData.expenses ?? ''),
            });
        } else {
            setForm({ resellerId: defaultResellerId || '', vendoLocation: '', percentage: '', grossSales: '', expenses: '' });
        }
    }, [initialData, isOpen, defaultResellerId, resellers]);

    if (!isOpen) return null;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setForm(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const reseller = resellers.find(r => r.id === form.resellerId);
        if (!reseller) {
            alert("Please select a reseller.");
            return;
        }
        const dataToSave = {
            resellerId: reseller.id,
            resellerName: reseller.name,
            vendoLocation: form.vendoLocation.trim(),
            percentage: normalizedPercent,
            grossSales: parseFloat(form.grossSales) || 0,
            expenses: parseFloat(form.expenses) || 0,
            netTotal: computedNetTotal,
        };

        if (initialData) {
            onSave({ ...initialData, ...dataToSave });
        } else {
            onSave(dataToSave);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg border border-slate-200 dark:border-slate-700">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400] mb-4">{initialData ? 'Edit Pisowifi Income' : 'Add Pisowifi Income'}</h3>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="resellerId" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Reseller</label>
                                <select name="resellerId" id="resellerId" value={form.resellerId} onChange={handleChange} required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white">
                                    <option value="" disabled>Select reseller...</option>
                                    {resellers.map(r => (
                                        <option key={r.id} value={r.id}>{r.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="vendoLocation" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Vendo Location</label>
                                <input type="text" name="vendoLocation" id="vendoLocation" value={form.vendoLocation} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="percentage" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Percentage (%)</label>
                                    <input type="number" name="percentage" id="percentage" value={form.percentage} onChange={handleChange} step="0.01" className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                                </div>
                                <div>
                                    <label htmlFor="grossSales" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Gross Sales</label>
                                    <input type="number" name="grossSales" id="grossSales" value={form.grossSales} onChange={handleChange} step="0.01" className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="expenses" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Expenses</label>
                                    <input type="number" name="expenses" id="expenses" value={form.expenses} onChange={handleChange} step="0.01" className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Net Total</label>
                                    <div className="mt-1 block w-full bg-slate-200 dark:bg-slate-600 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white font-bold">
                                        {computedNetTotal.toFixed(2)}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
                        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-md text-white bg-[--color-primary-600] hover:bg-[--color-primary-500]">Save</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// PisoWiFi Reseller Form Modal
const PisowifiResellerFormModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: any) => void;
    initialData: PisowifiReseller | null;
}> = ({ isOpen, onClose, onSave, initialData }) => {
    const [form, setForm] = useState({ name: '', contactNumber: '', notes: '' });

    React.useEffect(() => {
        if (!isOpen) return;
        if (initialData) {
            setForm({
                name: initialData.name || '',
                contactNumber: initialData.contactNumber || '',
                notes: initialData.notes || '',
            });
        } else {
            setForm({ name: '', contactNumber: '', notes: '' });
        }
    }, [initialData, isOpen]);

    if (!isOpen) return null;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setForm(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const dataToSave = {
            name: form.name.trim(),
            contactNumber: form.contactNumber.trim() || undefined,
            notes: form.notes.trim() || undefined,
        };

        if (!dataToSave.name) {
            alert("Reseller name is required.");
            return;
        }

        if (initialData) onSave({ ...initialData, ...dataToSave });
        else onSave(dataToSave);
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg border border-slate-200 dark:border-slate-700">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400] mb-4">{initialData ? 'Edit Reseller' : 'Add Reseller'}</h3>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Reseller Name</label>
                                <input type="text" name="name" id="name" value={form.name} onChange={handleChange} required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                            </div>
                            <div>
                                <label htmlFor="contactNumber" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Contact Number (Optional)</label>
                                <input type="text" name="contactNumber" id="contactNumber" value={form.contactNumber} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                            </div>
                            <div>
                                <label htmlFor="notes" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Notes (Optional)</label>
                                <textarea name="notes" id="notes" value={form.notes} onChange={handleChange} rows={2} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"></textarea>
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
                        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-md text-white bg-[--color-primary-600] hover:bg-[--color-primary-500]">Save</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// Reseller Income History Modal
const ResellerIncomeHistoryModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    reseller: PisowifiReseller;
    records: PisowifiIncomeRecord[];
    onAddIncome: () => void;
    onEditIncome: (record: PisowifiIncomeRecord) => void;
    onDeleteIncome: (recordId: string) => void;
}> = ({ isOpen, onClose, reseller, records, onAddIncome, onEditIncome, onDeleteIncome }) => {
    const { formatCurrency } = useLocalization();

    const totals = useMemo(() => {
        return records.reduce(
            (acc, r) => {
                const gross = Number(r.grossSales) || 0;
                const exp = Number(r.expenses) || 0;
                const raw = Number(r.percentage) || 0;
                const percent = raw <= 0 ? 0 : raw === 1 ? 1 : raw > 1 ? raw : raw * 100;
                const pctAmount = gross * (percent / 100);
                const net = gross - pctAmount - exp;
                acc.gross += gross;
                acc.percent += pctAmount;
                acc.expenses += exp;
                acc.net += net;
                return acc;
            },
            { gross: 0, percent: 0, expenses: 0, net: 0 }
        );
    }, [records]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-5xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                        <div>
                            <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400]">{reseller.name}</h3>
                            <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                {reseller.contactNumber ? reseller.contactNumber : '—'}
                            </div>
                            {reseller.notes ? <div className="text-sm text-slate-600 dark:text-slate-300 mt-1">{reseller.notes}</div> : null}
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={() => downloadCSV(records.map(r => {
                                const gross = Number(r.grossSales) || 0;
                                const exp = Number(r.expenses) || 0;
                                const raw = Number(r.percentage) || 0;
                                const percent = raw <= 0 ? 0 : raw === 1 ? 1 : raw > 1 ? raw : raw * 100;
                                const pctAmount = gross * (percent / 100);
                                const net = gross - pctAmount - exp;
                                return {
                                    resellerName: reseller.name,
                                    vendoLocation: r.vendoLocation,
                                    percentage: percent,
                                    percentageAmount: pctAmount,
                                    grossSales: gross,
                                    expenses: exp,
                                    netTotal: net,
                                    createdAt: r.createdAt,
                                };
                            }), `${reseller.name}_income.csv`)} className="px-4 py-2 text-sm text-white bg-sky-600 hover:bg-sky-500 rounded-lg font-semibold">Export CSV</button>
                            <button onClick={onAddIncome} className="bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-bold py-2 px-4 rounded-lg">Add Income</button>
                        </div>
                    </div>
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                            <div className="text-xs text-slate-500 dark:text-slate-400">Gross</div>
                            <div className="text-lg font-bold">{formatCurrency(totals.gross)}</div>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                            <div className="text-xs text-slate-500 dark:text-slate-400">Percent Total</div>
                            <div className="text-lg font-bold">{formatCurrency(totals.percent)}</div>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                            <div className="text-xs text-slate-500 dark:text-slate-400">Expenses</div>
                            <div className="text-lg font-bold text-red-600 dark:text-red-400">{formatCurrency(totals.expenses)}</div>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                            <div className="text-xs text-slate-500 dark:text-slate-400">Net</div>
                            <div className="text-lg font-bold text-green-600 dark:text-green-400">{formatCurrency(totals.net)}</div>
                        </div>
                    </div>
                </div>

                <div className="p-6">
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                                    <tr>
                                        <th className="px-6 py-3">Vendo Location</th>
                                        <th className="px-6 py-3 text-right">Percentage</th>
                                        <th className="px-6 py-3 text-right">Percent Total</th>
                                        <th className="px-6 py-3 text-right">Gross Sales</th>
                                        <th className="px-6 py-3 text-right">Expenses</th>
                                        <th className="px-6 py-3 text-right">Net Total</th>
                                        <th className="px-6 py-3">Date</th>
                                        <th className="px-6 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {records.length > 0 ? records.map(r => {
                                        const gross = Number(r.grossSales) || 0;
                                        const exp = Number(r.expenses) || 0;
                                        const raw = Number(r.percentage) || 0;
                                        const percent = raw <= 0 ? 0 : raw === 1 ? 1 : raw > 1 ? raw : raw * 100;
                                        const pctAmount = gross * (percent / 100);
                                        const net = gross - pctAmount - exp;
                                        return (
                                            <tr key={r.id} className="border-b border-slate-200 dark:border-slate-700 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                                <td className="px-6 py-4">{r.vendoLocation || '—'}</td>
                                                <td className="px-6 py-4 text-right font-mono">{percent}%</td>
                                                <td className="px-6 py-4 text-right font-mono">{formatCurrency(pctAmount)}</td>
                                                <td className="px-6 py-4 text-right font-mono">{formatCurrency(gross)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-red-600 dark:text-red-400">{formatCurrency(exp)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-green-600 dark:text-green-400">{formatCurrency(net)}</td>
                                                <td className="px-6 py-4 text-slate-500 dark:text-slate-400">{new Date(r.createdAt).toLocaleString()}</td>
                                                <td className="px-6 py-4 text-right space-x-1">
                                                    <button onClick={() => onEditIncome(r)} className="p-2 text-slate-500 dark:text-slate-400 hover:text-[--color-primary-500] rounded-md"><EditIcon className="h-5 w-5" /></button>
                                                    <button onClick={() => onDeleteIncome(r.id)} className="p-2 text-slate-500 dark:text-slate-400 hover:text-red-500 rounded-md"><TrashIcon className="h-5 w-5" /></button>
                                                </td>
                                            </tr>
                                        );
                                    }) : (
                                        <tr><td colSpan={8} className="text-center py-8 text-slate-500">No income records for this reseller.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Main PisoWiFi Income Manager
export const PisoWifiIncomeManager: React.FC<{
    records: PisowifiIncomeRecord[];
    onAdd: (record: any) => Promise<void>;
    onUpdate: (record: any) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    isLoading: boolean;
    formatCurrency: (amount: number) => string;
    resellers: PisowifiReseller[];
    onAddReseller: (reseller: any) => Promise<void>;
    onUpdateReseller: (reseller: any) => Promise<void>;
    onDeleteReseller: (id: string) => Promise<void>;
}> = ({ records, onAdd, onUpdate, onDelete, isLoading, formatCurrency, resellers, onAddReseller, onUpdateReseller, onDeleteReseller }) => {
    const [isIncomeModalOpen, setIsIncomeModalOpen] = useState(false);
    const [editingIncome, setEditingIncome] = useState<PisowifiIncomeRecord | null>(null);
    const [incomeDefaultResellerId, setIncomeDefaultResellerId] = useState<string | undefined>(undefined);
    const [isResellerModalOpen, setIsResellerModalOpen] = useState(false);
    const [editingReseller, setEditingReseller] = useState<PisowifiReseller | null>(null);
    const [activeResellerId, setActiveResellerId] = useState<string | null>(null);

    const resellerById = useMemo(() => new Map(resellers.map(r => [r.id, r])), [resellers]);

    const recordsByResellerId = useMemo(() => {
        const map = new Map<string, PisowifiIncomeRecord[]>();
        for (const rec of records) {
            const directId = rec.resellerId && resellerById.has(rec.resellerId) ? rec.resellerId : undefined;
            const byName = !directId && rec.resellerName
                ? resellers.find(r => r.name.toLowerCase() === String(rec.resellerName).toLowerCase())?.id
                : undefined;
            const key = directId || byName;
            if (!key) continue;
            const list = map.get(key) || [];
            list.push(rec);
            map.set(key, list);
        }
        for (const [key, list] of map.entries()) {
            list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            map.set(key, list);
        }
        return map;
    }, [records, resellers, resellerById]);

    const resellerSummaries = useMemo(() => {
        return resellers.map(reseller => {
            const list = recordsByResellerId.get(reseller.id) || [];
            const totals = list.reduce(
                (acc, r) => {
                    const gross = Number(r.grossSales) || 0;
                    const exp = Number(r.expenses) || 0;
                    const raw = Number(r.percentage) || 0;
                    const percent = raw <= 0 ? 0 : raw === 1 ? 1 : raw > 1 ? raw : raw * 100;
                    const pctAmount = gross * (percent / 100);
                    const net = gross - pctAmount - exp;
                    acc.gross += gross;
                    acc.percent += pctAmount;
                    acc.expenses += exp;
                    acc.net += net;
                    return acc;
                },
                { gross: 0, percent: 0, expenses: 0, net: 0 }
            );
            const lastDate = list[0]?.createdAt ? new Date(list[0].createdAt).getTime() : 0;
            return { reseller, list, totals, lastDate };
        }).sort((a, b) => (b.lastDate || 0) - (a.lastDate || 0));
    }, [recordsByResellerId, resellers]);

    const handleSaveIncome = async (data: any) => {
        if ('id' in data) await onUpdate(data);
        else await onAdd(data);
        setIsIncomeModalOpen(false);
    };

    const handleDeleteIncome = async (recordId: string) => {
        if (window.confirm("Are you sure you want to delete this record?")) {
            await onDelete(recordId);
        }
    };

    const handleSaveReseller = async (data: any) => {
        if ('id' in data) await onUpdateReseller(data);
        else await onAddReseller(data);
        setIsResellerModalOpen(false);
    };

    const openAddIncome = (defaultId?: string) => {
        setEditingIncome(null);
        setIncomeDefaultResellerId(defaultId);
        setIsIncomeModalOpen(true);
    };

    const activeReseller = activeResellerId ? resellerById.get(activeResellerId) || null : null;
    const activeRecords = activeReseller ? (recordsByResellerId.get(activeReseller.id) || []) : [];

    if (isLoading) {
        return <div className="text-center p-12 text-slate-500">Loading PisoWiFi records...</div>;
    }

    return (
        <div>
            <PisowifiIncomeFormModal isOpen={isIncomeModalOpen} onClose={() => setIsIncomeModalOpen(false)} onSave={handleSaveIncome} initialData={editingIncome} resellers={resellers} defaultResellerId={incomeDefaultResellerId} />
            <PisowifiResellerFormModal isOpen={isResellerModalOpen} onClose={() => setIsResellerModalOpen(false)} onSave={handleSaveReseller} initialData={editingReseller} />
            {activeReseller ? (
                <ResellerIncomeHistoryModal
                    isOpen={true}
                    onClose={() => setActiveResellerId(null)}
                    reseller={activeReseller}
                    records={activeRecords}
                    onAddIncome={() => openAddIncome(activeReseller.id)}
                    onEditIncome={(r) => { setEditingIncome(r); setIncomeDefaultResellerId(activeReseller.id); setIsIncomeModalOpen(true); }}
                    onDeleteIncome={(id) => handleDeleteIncome(id)}
                />
            ) : null}

            <div className="flex justify-end gap-2 mb-6">
                <button onClick={() => { setEditingReseller(null); setIsResellerModalOpen(true); }} className="px-4 py-2 text-sm text-white bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold">Add Reseller</button>
                <button onClick={() => openAddIncome()} className="bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-bold py-2 px-4 rounded-lg">Add Income</button>
            </div>

            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                            <tr>
                                <th className="px-6 py-3">Reseller</th>
                                <th className="px-6 py-3 text-right">Records</th>
                                <th className="px-6 py-3 text-right">Gross</th>
                                <th className="px-6 py-3 text-right">Percent Total</th>
                                <th className="px-6 py-3 text-right">Expenses</th>
                                <th className="px-6 py-3 text-right">Net</th>
                                <th className="px-6 py-3">Last</th>
                                <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {resellerSummaries.length > 0 ? resellerSummaries.map(s => (
                                <tr key={s.reseller.id} className="border-b border-slate-200 dark:border-slate-700 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <td className="px-6 py-4">
                                        <button onClick={() => setActiveResellerId(s.reseller.id)} className="font-medium text-[--color-primary-600] dark:text-[--color-primary-400] hover:underline">{s.reseller.name}</button>
                                        {s.reseller.contactNumber ? <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{s.reseller.contactNumber}</div> : null}
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono">{s.list.length}</td>
                                    <td className="px-6 py-4 text-right font-mono">{formatCurrency(s.totals.gross)}</td>
                                    <td className="px-6 py-4 text-right font-mono">{formatCurrency(s.totals.percent)}</td>
                                    <td className="px-6 py-4 text-right font-mono text-red-600 dark:text-red-400">{formatCurrency(s.totals.expenses)}</td>
                                    <td className="px-6 py-4 text-right font-mono text-green-600 dark:text-green-400">{formatCurrency(s.totals.net)}</td>
                                    <td className="px-6 py-4 text-slate-500 dark:text-slate-400">{s.lastDate ? new Date(s.lastDate).toLocaleString() : '—'}</td>
                                    <td className="px-6 py-4 text-right space-x-1">
                                        <button onClick={() => setActiveResellerId(s.reseller.id)} className="px-3 py-1 text-xs rounded-md bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600">View</button>
                                        <button onClick={() => { setEditingReseller(s.reseller); setIsResellerModalOpen(true); }} className="p-2 text-slate-500 dark:text-slate-400 hover:text-[--color-primary-500] dark:hover:text-[--color-primary-400] rounded-md"><EditIcon className="h-5 w-5" /></button>
                                        <button onClick={() => {
                                            const hasRecords = (recordsByResellerId.get(s.reseller.id) || []).length > 0;
                                            const msg = hasRecords ? "This reseller has income records. Delete reseller anyway?" : "Delete this reseller?";
                                            if (window.confirm(msg)) onDeleteReseller(s.reseller.id);
                                        }} className="p-2 text-slate-500 dark:text-slate-400 hover:text-red-500 rounded-md"><TrashIcon className="h-5 w-5" /></button>
                                    </td>
                                </tr>
                            )) : (
                                <tr><td colSpan={8} className="text-center py-8 text-slate-500">No resellers yet.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
