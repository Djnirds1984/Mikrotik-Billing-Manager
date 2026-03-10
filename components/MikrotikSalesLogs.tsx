import React, { useState, useEffect } from 'react';
import { mikrotikSalesService, MikrotikSalesLog } from '../services/mikrotikSalesService';
import { CurrencyDollarIcon, ArrowPathIcon } from '../constants.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';

interface MikrotikSalesLogsProps {
    routerId?: string;
    licenseId?: string;
}

const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

export const MikrotikSalesLogs: React.FC<MikrotikSalesLogsProps> = ({ routerId, licenseId }) => {
    const { hasPermission } = useAuth();
    const { formatCurrency } = useLocalization();
    const [salesLogs, setSalesLogs] = useState<MikrotikSalesLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchSalesLogs = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const logs = await mikrotikSalesService.getSalesLogs(routerId, licenseId);
            setSalesLogs(logs);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch sales logs');
            console.error('Error fetching mikrotik sales logs:', err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchSalesLogs();
    }, [routerId, licenseId]);

    const totalAmount = salesLogs.reduce((sum, log) => sum + (log.amount || 0), 0);

    if (isLoading) {
        return (
            <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    <span className="ml-2 text-slate-600 dark:text-slate-400">Loading sales logs...</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
                <div className="text-red-600 dark:text-red-400 mb-4">{error}</div>
                <button
                    onClick={fetchSalesLogs}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    Retry
                </button>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center">
                    <CurrencyDollarIcon className="w-5 h-5 mr-2" />
                    Mikrotik Sales Logs
                </h3>
                <div className="flex items-center gap-4">
                    <div className="text-sm text-slate-600 dark:text-slate-400">
                        Total: <span className="font-semibold text-slate-900 dark:text-white">{formatCurrency(totalAmount)}</span>
                    </div>
                    <button
                        onClick={fetchSalesLogs}
                        className="p-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md"
                        title="Refresh"
                    >
                        <ArrowPathIcon className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {salesLogs.length === 0 ? (
                <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                    <CurrencyDollarIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No sales logs found</p>
                    <p className="text-sm mt-2">Sales will appear here when synced from your local records</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                        <thead className="bg-slate-50 dark:bg-slate-700/50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                    Date
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                    Amount
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                    Currency
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                    Type
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                    License ID
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                    Router ID
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-slate-800 divide-y divide-slate-200 dark:divide-slate-700">
                            {salesLogs.map((log) => (
                                <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-slate-100">
                                        {formatDate(log.created_at || '')}
                                    </td>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-slate-100">
                                        {formatCurrency(log.amount)}
                                    </td>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-400">
                                        {log.currency}
                                    </td>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-400">
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                            {log.transaction_type}
                                        </span>
                                    </td>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-400 font-mono text-xs">
                                        {log.license_id?.substring(0, 8)}...
                                    </td>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-400 font-mono text-xs">
                                        {log.router_id?.substring(0, 8)}...
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};