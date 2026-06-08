import React, { useState, useEffect } from 'react';
import { CurrencyDollarIcon } from '../constants.tsx';
import { Loader } from './Loader.tsx';

interface ManualPayment {
    id: string;
    customer_account_number: string;
    customer_username: string;
    customer_full_name: string;
    customer_facebook_psid: string;
    customer_router_id: string;
    plan_name: string;
    plan_price: number;
    gcash_reference_number: string;
    customer_mobile_number: string;
    customer_name_on_gcash: string;
    status: 'pending' | 'approved' | 'rejected';
    admin_notes: string;
    approved_by: string;
    approved_at: string;
    rejected_at: string;
    created_at: string;
    updated_at: string;
}

export const ManualPayments: React.FC = () => {
    const [payments, setPayments] = useState<ManualPayment[]>([]);
    const [filter, setFilter] = useState<string>('pending');
    const [selectedPayment, setSelectedPayment] = useState<ManualPayment | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [adminNotes, setAdminNotes] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [pendingCount, setPendingCount] = useState(0);

    const fetchPayments = async () => {
        try {
            setIsLoading(true);
            const response = await fetch(`/api/manual-payments${filter ? `?status=${filter}` : ''}`);
            if (!response.ok) throw new Error('Failed to fetch payments');
            const data = await response.json();
            setPayments(data);
            
            // Fetch pending count for badge
            const pendingResponse = await fetch('/api/manual-payments?status=pending');
            if (pendingResponse.ok) {
                const pendingData = await pendingResponse.json();
                setPendingCount(pendingData.length);
            }
        } catch (err) {
            console.error('Error fetching payments:', err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchPayments();
        // Refresh every 30 seconds
        const interval = setInterval(fetchPayments, 30000);
        return () => clearInterval(interval);
    }, [filter]);

    const handleApprove = async () => {
        if (!selectedPayment) return;
        
        try {
            const response = await fetch(`/api/manual-payments/${selectedPayment.id}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ admin_notes: adminNotes })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message);
            }
            
            alert('Payment approved successfully!');
            setShowModal(false);
            setSelectedPayment(null);
            setAdminNotes('');
            fetchPayments();
        } catch (err) {
            alert(`Error: ${(err as Error).message}`);
        }
    };

    const handleReject = async () => {
        if (!selectedPayment) return;
        
        try {
            const response = await fetch(`/api/manual-payments/${selectedPayment.id}/reject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ admin_notes: adminNotes })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message);
            }
            
            alert('Payment rejected.');
            setShowModal(false);
            setSelectedPayment(null);
            setAdminNotes('');
            fetchPayments();
        } catch (err) {
            alert(`Error: ${(err as Error).message}`);
        }
    };

    const openDetailModal = (payment: ManualPayment) => {
        setSelectedPayment(payment);
        setAdminNotes(payment.admin_notes || '');
        setShowModal(true);
    };

    const formatDate = (dateStr: string) => {
        if (!dateStr) return 'N/A';
        const date = new Date(dateStr);
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getStatusBadge = (status: string) => {
        const badges = {
            pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300',
            approved: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
            rejected: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300'
        };
        return badges[status as keyof typeof badges] || '';
    };

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
                <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <CurrencyDollarIcon className="w-8 h-8 text-[--color-primary-500] dark:text-[--color-primary-400]" />
                        <div>
                            <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">Manual GCash Payments</h2>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Verify and approve manual GCash payment requests</p>
                        </div>
                    </div>
                    {pendingCount > 0 && (
                        <div className="px-4 py-2 bg-red-500 text-white rounded-lg font-semibold">
                            {pendingCount} Pending
                        </div>
                    )}
                </div>

                {/* Filter Tabs */}
                <div className="px-6 pt-4 flex gap-2">
                    {['all', 'pending', 'approved', 'rejected'].map((f) => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-4 py-2 rounded-lg font-medium transition ${
                                filter === f
                                    ? 'bg-[--color-primary-500] text-white'
                                    : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                            }`}
                        >
                            {f.charAt(0).toUpperCase() + f.slice(1)}
                            {f === 'pending' && pendingCount > 0 && (
                                <span className="ml-2 px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">
                                    {pendingCount}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Table */}
                <div className="p-6">
                    {isLoading ? (
                        <div className="flex justify-center py-12">
                            <Loader />
                        </div>
                    ) : payments.length === 0 ? (
                        <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                            No payment requests found.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-slate-200 dark:border-slate-700">
                                        <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Request #</th>
                                        <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Customer</th>
                                        <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Account #</th>
                                        <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Plan</th>
                                        <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Amount</th>
                                        <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-300">GCash Ref #</th>
                                        <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Mobile #</th>
                                        <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Status</th>
                                        <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Created</th>
                                        <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {payments.map((payment) => (
                                        <tr key={payment.id} className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                            <td className="py-3 px-4 text-sm font-mono text-slate-600 dark:text-slate-400">
                                                {payment.id.split('_')[2].toUpperCase()}
                                            </td>
                                            <td className="py-3 px-4 text-sm">
                                                <div className="font-medium text-slate-800 dark:text-slate-200">{payment.customer_full_name || 'N/A'}</div>
                                                <div className="text-xs text-slate-500">{payment.customer_name_on_gcash}</div>
                                            </td>
                                            <td className="py-3 px-4 text-sm text-slate-600 dark:text-slate-400">{payment.customer_account_number}</td>
                                            <td className="py-3 px-4 text-sm text-slate-600 dark:text-slate-400">{payment.plan_name}</td>
                                            <td className="py-3 px-4 text-sm font-semibold text-slate-800 dark:text-slate-200">₱{payment.plan_price.toFixed(2)}</td>
                                            <td className="py-3 px-4 text-sm font-mono text-blue-600 dark:text-blue-400">{payment.gcash_reference_number}</td>
                                            <td className="py-3 px-4 text-sm text-slate-600 dark:text-slate-400">{payment.customer_mobile_number}</td>
                                            <td className="py-3 px-4">
                                                <span className={`px-3 py-1 text-xs font-semibold rounded-full ${getStatusBadge(payment.status)}`}>
                                                    {payment.status.toUpperCase()}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-sm text-slate-600 dark:text-slate-400">{formatDate(payment.created_at)}</td>
                                            <td className="py-3 px-4">
                                                <button
                                                    onClick={() => openDetailModal(payment)}
                                                    className="px-3 py-1 bg-[--color-primary-500] text-white text-sm rounded hover:bg-[--color-primary-600] transition"
                                                >
                                                    View Details
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* Detail Modal */}
            {showModal && selectedPayment && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">Payment Request Details</h3>
                        </div>
                        
                        <div className="p-6 space-y-4">
                            {/* Payment Info */}
                            <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg">
                                <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-3">💰 Payment Information</h4>
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div>
                                        <span className="text-slate-500">Request #:</span>
                                        <div className="font-mono font-semibold">{selectedPayment.id.split('_')[2].toUpperCase()}</div>
                                    </div>
                                    <div>
                                        <span className="text-slate-500">Status:</span>
                                        <div><span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadge(selectedPayment.status)}`}>{selectedPayment.status.toUpperCase()}</span></div>
                                    </div>
                                    <div>
                                        <span className="text-slate-500">Amount:</span>
                                        <div className="font-semibold text-lg">₱{selectedPayment.plan_price.toFixed(2)}</div>
                                    </div>
                                    <div>
                                        <span className="text-slate-500">Plan:</span>
                                        <div>{selectedPayment.plan_name}</div>
                                    </div>
                                </div>
                            </div>

                            {/* Customer Info */}
                            <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-lg">
                                <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-3">👤 Customer Information</h4>
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div>
                                        <span className="text-slate-500">Name:</span>
                                        <div className="font-semibold">{selectedPayment.customer_full_name || 'N/A'}</div>
                                    </div>
                                    <div>
                                        <span className="text-slate-500">Account #:</span>
                                        <div>{selectedPayment.customer_account_number}</div>
                                    </div>
                                    <div>
                                        <span className="text-slate-500">Username:</span>
                                        <div>{selectedPayment.customer_username || 'N/A'}</div>
                                    </div>
                                </div>
                            </div>

                            {/* GCash Details */}
                            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border-2 border-blue-300 dark:border-blue-700">
                                <h4 className="font-semibold text-blue-800 dark:text-blue-300 mb-3">📱 GCash Payment Details</h4>
                                <div className="space-y-3 text-sm">
                                    <div>
                                        <span className="text-blue-600 dark:text-blue-400 font-semibold">GCash Reference Number:</span>
                                        <div className="text-2xl font-mono font-bold text-blue-800 dark:text-blue-200 mt-1">{selectedPayment.gcash_reference_number}</div>
                                    </div>
                                    <div>
                                        <span className="text-blue-600 dark:text-blue-400">Customer Mobile #:</span>
                                        <div className="font-semibold">{selectedPayment.customer_mobile_number}</div>
                                    </div>
                                    <div>
                                        <span className="text-blue-600 dark:text-blue-400">Name on GCash:</span>
                                        <div className="font-semibold">{selectedPayment.customer_name_on_gcash}</div>
                                    </div>
                                </div>
                            </div>

                            {/* Timestamps */}
                            <div className="text-xs text-slate-500 space-y-1">
                                <div>Created: {formatDate(selectedPayment.created_at)}</div>
                                {selectedPayment.approved_at && <div>Approved: {formatDate(selectedPayment.approved_at)}</div>}
                                {selectedPayment.rejected_at && <div>Rejected: {formatDate(selectedPayment.rejected_at)}</div>}
                            </div>

                            {/* Admin Notes */}
                            {selectedPayment.status === 'pending' && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Admin Notes (Optional)</label>
                                    <textarea
                                        value={adminNotes}
                                        onChange={(e) => setAdminNotes(e.target.value)}
                                        rows={3}
                                        className="w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                                        placeholder="Add notes about this payment..."
                                    />
                                </div>
                            )}
                        </div>

                        {/* Actions */}
                        {selectedPayment.status === 'pending' && (
                            <div className="p-6 border-t border-slate-200 dark:border-slate-700 flex gap-3 justify-end">
                                <button
                                    onClick={() => { setShowModal(false); setSelectedPayment(null); }}
                                    className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleReject}
                                    className="px-6 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition font-semibold"
                                >
                                    ❌ Reject Payment
                                </button>
                                <button
                                    onClick={handleApprove}
                                    className="px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition font-semibold"
                                >
                                    ✅ Approve & Activate
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
