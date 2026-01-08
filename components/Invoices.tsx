import React, { useState, useEffect } from 'react';
import type { Invoice, RouterConfigWithId } from '../types.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { EditIcon, TrashIcon, SignalIcon, RouterIcon } from '../constants.tsx';
import { Loader } from './Loader.tsx';

interface InvoicesProps {
  selectedRouter: RouterConfigWithId | null;
}

export const Invoices: React.FC<InvoicesProps> = ({ selectedRouter }) => {
    const { t, formatCurrency } = useLocalization();
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (selectedRouter) {
            loadInvoices();
        }
    }, [selectedRouter]);

    const loadInvoices = async () => {
        if (!selectedRouter) return;
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/db/invoices?routerId=${selectedRouter.id}`);
            if (!response.ok) throw new Error('Failed to load invoices');
            const data = await response.json();
            setInvoices(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setIsLoading(false);
        }
    };

    const generateInvoices = async () => {
        if (!selectedRouter) return;
        setIsLoading(true);
        try {
            const response = await fetch('/api/db/invoices/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ routerId: selectedRouter.id, daysAhead: 30 })
            });
            if (!response.ok) throw new Error('Failed to generate invoices');
            const result = await response.json();
            alert(result.message);
            loadInvoices();
        } catch (err) {
            alert('Error generating invoices: ' + (err instanceof Error ? err.message : 'Unknown error'));
        } finally {
            setIsLoading(false);
        }
    };

    const updateInvoiceStatus = async (invoiceId: string, status: Invoice['status']) => {
        try {
            const response = await fetch(`/api/db/invoices/${invoiceId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });
            if (!response.ok) throw new Error('Failed to update invoice');
            loadInvoices();
        } catch (err) {
            alert('Error updating invoice: ' + (err instanceof Error ? err.message : 'Unknown error'));
        }
    };

    const deleteInvoice = async (invoiceId: string) => {
        if (!confirm('Are you sure you want to delete this invoice?')) return;
        try {
            const response = await fetch(`/api/db/invoices/${invoiceId}`, {
                method: 'DELETE'
            });
            if (!response.ok) throw new Error('Failed to delete invoice');
            loadInvoices();
        } catch (err) {
            alert('Error deleting invoice: ' + (err instanceof Error ? err.message : 'Unknown error'));
        }
    };

    const getStatusColor = (status: Invoice['status']) => {
        switch (status) {
            case 'paid': return 'text-green-600 bg-green-100';
            case 'pending': return 'text-yellow-600 bg-yellow-100';
            case 'overdue': return 'text-red-600 bg-red-100';
            case 'cancelled': return 'text-gray-600 bg-gray-100';
            default: return 'text-gray-600 bg-gray-100';
        }
    };

    return (
        <div className="max-w-6xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Invoices</h2>
                <div className="flex gap-2">
                    <button
                        onClick={generateInvoices}
                        disabled={!selectedRouter || isLoading}
                        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-2 px-4 rounded-lg shadow-sm hover:shadow-md transition-all"
                    >
                        Generate Invoices
                    </button>
                    <button
                        onClick={loadInvoices}
                        disabled={!selectedRouter || isLoading}
                        className="bg-gray-600 hover:bg-gray-700 disabled:opacity-50 text-white font-bold py-2 px-4 rounded-lg shadow-sm hover:shadow-md transition-all"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {!selectedRouter ? (
                <div className="text-center p-8 bg-yellow-50 dark:bg-slate-800 rounded-lg border border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-300">
                    <p>Please select a router to view invoices</p>
                </div>
            ) : error ? (
                <div className="text-center p-8 bg-red-50 dark:bg-slate-800 rounded-lg border border-red-300 dark:border-red-700 text-red-800 dark:text-red-300">
                    <p>Error: {error}</p>
                </div>
            ) : isLoading ? (
                <div className="flex flex-col items-center justify-center h-64">
                    <Loader />
                    <p className="mt-4 text-slate-600 dark:text-slate-400">Loading invoices...</p>
                </div>
            ) : (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                            <thead className="bg-slate-50 dark:bg-slate-700">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase tracking-wider">Invoice #</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase tracking-wider">Customer</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase tracking-wider">Plan</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase tracking-wider">Amount</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase tracking-wider">Due Date</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase tracking-wider">Status</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
                                {invoices.map((invoice) => (
                                    <tr key={invoice.id} className="hover:bg-slate-50 dark:hover:bg-slate-700">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-slate-100">
                                            {invoice.invoiceNumber}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-slate-100">
                                            {invoice.customerName}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
                                            {invoice.planName}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-slate-100">
                                            {formatCurrency(invoice.finalAmount)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
                                            {new Date(invoice.dueDate).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(invoice.status)}`}>
                                                {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                                            {invoice.status === 'pending' && (
                                                <button
                                                    onClick={() => updateInvoiceStatus(invoice.id, 'paid')}
                                                    className="text-green-600 hover:text-green-900 dark:text-green-400 dark:hover:text-green-300"
                                                >
                                                    Mark Paid
                                                </button>
                                            )}
                                            <button
                                                onClick={() => deleteInvoice(invoice.id)}
                                                className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                                            >
                                                Delete
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {invoices.length === 0 && (
                        <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                            No invoices found. Click "Generate Invoices" to create invoices for upcoming due dates.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};