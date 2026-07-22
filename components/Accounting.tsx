import React, { useState, useMemo } from 'react';
import { useExpensesData } from '../hooks/useExpensesData.ts';
import { usePisowifiIncomeData } from '../hooks/usePisowifiIncomeData.ts';
import { usePisowifiResellersData } from '../hooks/usePisowifiResellersData.ts';
import { useSalesData } from '../hooks/useSalesData.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { useCompanySettings } from '../hooks/useCompanySettings.ts';
import type { ExpenseRecord, SaleRecord, RouterConfigWithId } from '../types.ts';
import { CurrencyDollarIcon, PlusIcon, TrashIcon, EditIcon, ExclamationTriangleIcon, DownloadIcon } from '../constants.tsx';
import { dbApi } from '../services/databaseService.ts';
import { PisoWifiIncomeManager } from './PisoWifiIncomeManager.tsx';

type AccountingTab = 'overview' | 'expenses' | 'pisowifi' | 'sales' | 'all-routers-summary';

// CSV Export Utility — uniform 7-column structure with UTF-8 BOM for Excel
const padRow = (row: (string | number)[]): string => {
    while (row.length < 7) {
        row.push('');
    }
    return row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',');
};

const formatCsvNumber = (value: number): string => {
    return value.toFixed(2);
};

const generateAccountingCsv = (
    companyName: string,
    routerName: string,
    periodType: string,
    summary: { totalIncome: number; totalPisowifiIncome: number; totalExpenses: number; netProfit: number },
    cashFlowAnalysis: Array<{
        label: string;
        pppoeSales: number;
        dhcpSales: number;
        pwiIncome: number;
        totalIncome: number;
        expenses: number;
        netCashFlow: number;
    }>
): string => {
    const rows: string[][] = [];

    // Section 1: Header / Metadata (7-column padded)
    rows.push([companyName + ' - Accounting Report']);
    rows.push(['Router', routerName]);
    rows.push(['Period Type', periodType]);
    rows.push(['Date Generated', new Date().toLocaleDateString()]);
    rows.push([]); // Blank line

    // Section 2: Financial Overview Summary
    rows.push(['FINANCIAL OVERVIEW SUMMARY']);
    rows.push(['Total Sales Income', formatCsvNumber(summary.totalIncome)]);
    rows.push(['PisoWiFi Income', formatCsvNumber(summary.totalPisowifiIncome)]);
    rows.push(['Total Expenses', formatCsvNumber(summary.totalExpenses)]);
    rows.push(['Net Profit', formatCsvNumber(summary.netProfit)]);
    rows.push([]); // Blank line

    // Section 3: Cash Flow Trend
    rows.push(['CASH FLOW TREND (LAST 6 PERIODS)']);
    rows.push(['Period', 'PPPoE Sales', 'DHCP Sales', 'PisoWiFi Sales', 'Total Income', 'Expenses', 'Net Cash Flow']);

    let totalPppoe = 0, totalDhcp = 0, totalPwi = 0, totalIncome = 0, totalExpenses = 0, totalNet = 0;

    cashFlowAnalysis.forEach(period => {
        rows.push([
            period.label,
            formatCsvNumber(period.pppoeSales),
            formatCsvNumber(period.dhcpSales),
            formatCsvNumber(period.pwiIncome),
            formatCsvNumber(period.totalIncome),
            formatCsvNumber(period.expenses),
            formatCsvNumber(period.netCashFlow)
        ]);
        totalPppoe += period.pppoeSales;
        totalDhcp += period.dhcpSales;
        totalPwi += period.pwiIncome;
        totalIncome += period.totalIncome;
        totalExpenses += period.expenses;
        totalNet += period.netCashFlow;
    });

    // Total Row
    rows.push([
        'TOTAL',
        formatCsvNumber(totalPppoe),
        formatCsvNumber(totalDhcp),
        formatCsvNumber(totalPwi),
        formatCsvNumber(totalIncome),
        formatCsvNumber(totalExpenses),
        formatCsvNumber(totalNet)
    ]);

    // Prepend UTF-8 BOM and join with \r\n for Excel compatibility
    return '\uFEFF' + rows.map(padRow).join('\r\n');
};

const downloadCsv = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

interface AccountingProps {
    selectedRouter: RouterConfigWithId | null;
}

export const Accounting: React.FC<AccountingProps> = ({ selectedRouter }) => {
    const { t, formatCurrency } = useLocalization();
    const { settings } = useCompanySettings();
    const [activeTab, setActiveTab] = useState<AccountingTab>('overview');
    const [timeFilter, setTimeFilter] = useState<'daily' | 'weekly' | 'monthly'>('monthly');
    
    // Fetch data - expenses filtered by router, PisoWiFi stays global
    const { expenses, addExpense, updateExpense, deleteExpense, isLoading: isLoadingExpenses } = useExpensesData(selectedRouter?.id);
    const { records: pisowifiRecords, addRecord: addPisowifiRecord, updateRecord: updatePisowifiRecord, deleteRecord: deletePisowifiRecord, isLoading: isLoadingPisowifi } = usePisowifiIncomeData();
    const { resellers: pisowifiResellers, addReseller: addPisowifiReseller, updateReseller: updatePisowifiReseller, deleteReseller: deletePisowifiReseller } = usePisowifiResellersData();
    const { sales, deleteSale, isLoading: isLoadingSales } = useSalesData(selectedRouter?.id || null);
    
    // Fetch all sales from all routers for comprehensive view
    const [allSales, setAllSales] = useState<SaleRecord[]>([]);
    const [isLoadingAllSales, setIsLoadingAllSales] = useState(false);
    const [clientInvoices, setClientInvoices] = useState<any[]>([]);

    React.useEffect(() => {
        loadAllFinancialData();
    }, []);

    const loadAllFinancialData = async () => {
        try {
            setIsLoadingAllSales(true);
            // Load all sales records
            const salesData = await dbApi.get<SaleRecord[]>('/sales');
            setAllSales(salesData || []);
            
            // Load client invoices (DHCP portal payments)
            const invoicesData = await dbApi.get<any[]>('/client-invoices');
            setClientInvoices(invoicesData || []);
        } catch (err) {
            console.error('Failed to load financial data:', err);
        } finally {
            setIsLoadingAllSales(false);
        }
    };

    // Calculate financial summary
    const financialSummary = useMemo(() => {
        const totalIncome = sales.reduce((sum, sale) => sum + (sale.finalAmount || 0), 0);
        const totalPisowifiIncome = pisowifiRecords.reduce((sum, record) => sum + (record.netTotal || 0), 0);
        const totalExpenses = expenses.reduce((sum, expense) => sum + (expense.amount || 0), 0);
        const grossProfit = totalIncome + totalPisowifiIncome - totalExpenses;
        
        return {
            totalIncome,
            totalPisowifiIncome,
            totalExpenses,
            grossProfit,
            netProfit: grossProfit
        };
    }, [sales, pisowifiRecords, expenses]);

    // Helper function for period labels
    const getPeriodLabel = (date: Date, filter: 'daily' | 'weekly' | 'monthly') => {
        if (filter === 'daily') {
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } else if (filter === 'weekly') {
            const start = new Date(date);
            start.setDate(date.getDate() - date.getDay());
            return `Week of ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
        } else {
            return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        }
    };

    // Cash Flow Analysis by Time Period
    const cashFlowAnalysis = useMemo(() => {
        const now = new Date();
        const getPeriodStart = (date: Date) => {
            if (timeFilter === 'daily') {
                return new Date(date.getFullYear(), date.getMonth(), date.getDate());
            } else if (timeFilter === 'weekly') {
                const start = new Date(date);
                start.setDate(date.getDate() - date.getDay());
                start.setHours(0, 0, 0, 0);
                return start;
            } else {
                return new Date(date.getFullYear(), date.getMonth(), 1);
            }
        };

        const getPeriodEnd = (date: Date) => {
            if (timeFilter === 'daily') {
                const end = new Date(date);
                end.setHours(23, 59, 59, 999);
                return end;
            } else if (timeFilter === 'weekly') {
                const end = new Date(date);
                end.setDate(date.getDate() - date.getDay() + 6);
                end.setHours(23, 59, 59, 999);
                return end;
            } else {
                return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
            }
        };

        // Calculate periods (last 6 periods)
        const periods = [];
        for (let i = 5; i >= 0; i--) {
            const periodDate = new Date(now);
            if (timeFilter === 'daily') {
                periodDate.setDate(now.getDate() - i);
            } else if (timeFilter === 'weekly') {
                periodDate.setDate(now.getDate() - (i * 7));
            } else {
                periodDate.setMonth(now.getMonth() - i);
            }
            
            const periodStart = getPeriodStart(periodDate);
            const periodEnd = getPeriodEnd(periodDate);
            
            // PPPoE Sales for this period - filter by selected router
            const pppoeSales = allSales.filter(s => {
                // Filter by router if one is selected
                if (selectedRouter?.id && s.routerId !== selectedRouter.id) return false;
                const saleDate = new Date(s.date);
                return saleDate >= periodStart && saleDate <= periodEnd;
            }).reduce((sum, s) => sum + (s.finalAmount || 0), 0);

            // DHCP Portal Sales for this period - filter by selected router
            const dhcpSales = clientInvoices
                .filter(inv => {
                    // Filter by router if one is selected
                    if (selectedRouter?.id && inv.routerId !== selectedRouter.id) return false;
                    if (inv.status !== 'PAID') return false;
                    const paidDate = inv.paidAt || inv.updatedAt || inv.createdAt;
                    if (!paidDate) return false;
                    const invDate = new Date(paidDate);
                    return invDate >= periodStart && invDate <= periodEnd;
                })
                .reduce((sum, inv) => sum + (inv.totalAmount || inv.amount || 0), 0);

            // PisoWiFi Income for this period (stays global - not router-specific)
            const pwiIncome = pisowifiRecords.filter(r => {
                const recordDate = new Date(r.createdAt);
                return recordDate >= periodStart && recordDate <= periodEnd;
            }).reduce((sum, r) => sum + (r.netTotal || 0), 0);

            // Expenses for this period - already filtered by router via hook
            const periodExpenses = expenses.filter(e => {
                const expenseDate = new Date(e.date);
                return expenseDate >= periodStart && expenseDate <= periodEnd;
            }).reduce((sum, e) => sum + (e.amount || 0), 0);

            const totalIncome = pppoeSales + dhcpSales + pwiIncome;
            const netCashFlow = totalIncome - periodExpenses;

            periods.push({
                label: getPeriodLabel(periodDate, timeFilter),
                startDate: periodStart,
                endDate: periodEnd,
                pppoeSales,
                dhcpSales,
                pwiIncome,
                totalIncome,
                expenses: periodExpenses,
                netCashFlow
            });
        }

        return periods;
    }, [timeFilter, allSales, clientInvoices, pisowifiRecords, expenses, selectedRouter?.id]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Accounting & Expenses</h2>
            </div>

            {/* Tabs */}
            <div className="border-b border-slate-200 dark:border-slate-700">
                <nav className="flex space-x-2 overflow-x-auto pb-1">
                    <TabButton label="Financial Overview" icon={<CurrencyDollarIcon className="w-5 h-5" />} isActive={activeTab === 'overview'} onClick={() => setActiveTab('overview')} />
                    <TabButton label="Expenses" icon={<ExclamationTriangleIcon className="w-5 h-5" />} isActive={activeTab === 'expenses'} onClick={() => setActiveTab('expenses')} />
                    <TabButton label="PisoWiFi Income" icon={<CurrencyDollarIcon className="w-5 h-5" />} isActive={activeTab === 'pisowifi'} onClick={() => setActiveTab('pisowifi')} />
                    <TabButton label="Sales Revenue" icon={<CurrencyDollarIcon className="w-5 h-5" />} isActive={activeTab === 'sales'} onClick={() => setActiveTab('sales')} />
                    <TabButton label="All Routers Summary" icon={<CurrencyDollarIcon className="w-5 h-5" />} isActive={activeTab === 'all-routers-summary'} onClick={() => setActiveTab('all-routers-summary')} />
                </nav>
            </div>

            {/* Tab Content */}
            {activeTab === 'overview' && (
                <FinancialOverview 
                    summary={financialSummary}
                    formatCurrency={formatCurrency}
                    cashFlowAnalysis={cashFlowAnalysis}
                    timeFilter={timeFilter}
                    onTimeFilterChange={setTimeFilter}
                    isLoading={isLoadingAllSales}
                    routerName={selectedRouter?.name || 'All Routers'}
                    companyName={settings.companyName || 'Company'}
                />
            )}
            {activeTab === 'expenses' && (
                <ExpensesManager 
                    expenses={expenses}
                    onAdd={addExpense}
                    onUpdate={updateExpense}
                    onDelete={deleteExpense}
                    isLoading={isLoadingExpenses}
                    formatCurrency={formatCurrency}
                />
            )}
            {activeTab === 'pisowifi' && (
                <PisoWifiIncomeManager 
                    records={pisowifiRecords}
                    onAdd={addPisowifiRecord}
                    onUpdate={updatePisowifiRecord}
                    onDelete={deletePisowifiRecord}
                    isLoading={isLoadingPisowifi}
                    formatCurrency={formatCurrency}
                    resellers={pisowifiResellers}
                    onAddReseller={addPisowifiReseller}
                    onUpdateReseller={updatePisowifiReseller}
                    onDeleteReseller={deletePisowifiReseller}
                />
            )}
            {activeTab === 'sales' && (
                <SalesRevenueView 
                    sales={sales}
                    onDelete={deleteSale}
                    isLoading={isLoadingSales}
                    formatCurrency={formatCurrency}
                />
            )}
            {activeTab === 'all-routers-summary' && (
                <AllRoutersSummary 
                    allSales={allSales}
                    allExpenses={expenses}
                    allPisowifiRecords={pisowifiRecords}
                    clientInvoices={clientInvoices}
                    formatCurrency={formatCurrency}
                />
            )}
        </div>
    );
};

// Tab Button Component
const TabButton: React.FC<{ label: string, icon: React.ReactNode, isActive: boolean, onClick: () => void }> = ({ label, icon, isActive, onClick }) => (
    <button
        onClick={onClick}
        className={`flex items-center px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors duration-200 focus:outline-none ${
            isActive
                ? 'border-[--color-primary-500] text-[--color-primary-500] dark:text-[--color-primary-400]'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
        }`}
    >
        {icon}
        <span className="ml-2">{label}</span>
    </button>
);

// Financial Overview Component
const FinancialOverview: React.FC<{
    summary: { totalIncome: number; totalPisowifiIncome: number; totalExpenses: number; grossProfit: number; netProfit: number };
    formatCurrency: (amount: number) => string;
    cashFlowAnalysis: Array<{
        label: string;
        pppoeSales: number;
        dhcpSales: number;
        pwiIncome: number;
        totalIncome: number;
        expenses: number;
        netCashFlow: number;
    }>;
    timeFilter: 'daily' | 'weekly' | 'monthly';
    onTimeFilterChange: (filter: 'daily' | 'weekly' | 'monthly') => void;
    isLoading: boolean;
    routerName: string;
    companyName: string;
}> = ({ summary, formatCurrency, cashFlowAnalysis, timeFilter, onTimeFilterChange, isLoading, routerName, companyName }) => {
    if (isLoading) {
        return <div className="text-center p-12 text-slate-500">Loading cash flow data...</div>;
    }

    return (
        <div className="space-y-6">
            {/* Time Filter & Export */}
            <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">Cash Flow Dashboard</h3>
                <div className="flex gap-2">
                    {(['daily', 'weekly', 'monthly'] as const).map((filter) => (
                        <button
                            key={filter}
                            onClick={() => onTimeFilterChange(filter)}
                            className={`px-4 py-2 rounded-md font-medium transition-colors ${
                                timeFilter === filter
                                    ? 'bg-[--color-primary-600] text-white'
                                    : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                            }`}
                        >
                            {filter.charAt(0).toUpperCase() + filter.slice(1)}
                        </button>
                    ))}
                    <button
                        onClick={() => {
                            const periodLabel = timeFilter.charAt(0).toUpperCase() + timeFilter.slice(1);
                            const dateStr = new Date().toISOString().split('T')[0];
                            const safeRouterName = routerName.replace(/[^a-zA-Z0-9]/g, '_');
                            const filename = `Accounting_Report_${safeRouterName}_${periodLabel}_${dateStr}.csv`;
                            const csvContent = generateAccountingCsv(
                                companyName,
                                routerName,
                                periodLabel,
                                summary,
                                cashFlowAnalysis
                            );
                            downloadCsv(csvContent, filename);
                        }}
                        className="flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors bg-green-600 hover:bg-green-700 text-white shadow-sm"
                        title="Export to CSV"
                    >
                        <DownloadIcon className="w-4 h-4" />
                        Export CSV
                    </button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
                    <div className="text-sm text-slate-500 dark:text-slate-400 mb-2">Total Sales Income</div>
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">{formatCurrency(summary.totalIncome)}</div>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
                    <div className="text-sm text-slate-500 dark:text-slate-400 mb-2">PisoWiFi Income</div>
                    <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{formatCurrency(summary.totalPisowifiIncome)}</div>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
                    <div className="text-sm text-slate-500 dark:text-slate-400 mb-2">Total Expenses</div>
                    <div className="text-2xl font-bold text-red-600 dark:text-red-400">{formatCurrency(summary.totalExpenses)}</div>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
                    <div className="text-sm text-slate-500 dark:text-slate-400 mb-2">Net Profit</div>
                    <div className={`text-2xl font-bold ${summary.netProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {formatCurrency(summary.netProfit)}
                    </div>
                </div>
            </div>

            {/* Cash Flow Trend Table */}
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Cash Flow Trend (Last 6 Periods)</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Period</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">PPPoE Sales</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">DHCP Sales</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">PisoWiFi</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Total Income</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Expenses</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Net Cash Flow</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {cashFlowAnalysis.map((period, idx) => (
                                <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <td className="px-4 py-3 text-sm font-medium text-slate-900 dark:text-slate-100">
                                        {period.label}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-right text-green-600 dark:text-green-400">
                                        {formatCurrency(period.pppoeSales)}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-right text-blue-600 dark:text-blue-400">
                                        {formatCurrency(period.dhcpSales)}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-right text-purple-600 dark:text-purple-400">
                                        {formatCurrency(period.pwiIncome)}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-right font-semibold text-slate-900 dark:text-slate-100">
                                        {formatCurrency(period.totalIncome)}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-right text-red-600 dark:text-red-400">
                                        {formatCurrency(period.expenses)}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-right font-bold">
                                        <span className={period.netCashFlow >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                                            {formatCurrency(period.netCashFlow)}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Income Breakdown */}
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-4">Total Income Breakdown</h3>
                <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 bg-green-50 dark:bg-green-900/20 rounded">
                        <span className="text-slate-700 dark:text-slate-300">PPPoE Sales Revenue</span>
                        <span className="font-bold text-green-600 dark:text-green-400">{formatCurrency(summary.totalIncome)}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded">
                        <span className="text-slate-700 dark:text-slate-300">PisoWiFi Revenue</span>
                        <span className="font-bold text-blue-600 dark:text-blue-400">{formatCurrency(summary.totalPisowifiIncome)}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-purple-50 dark:bg-purple-900/20 rounded font-semibold">
                        <span className="text-slate-900 dark:text-slate-100">Total Income</span>
                        <span className="text-purple-600 dark:text-purple-400">{formatCurrency(summary.totalIncome + summary.totalPisowifiIncome)}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Expenses Manager Component
const ExpensesManager: React.FC<{
    expenses: ExpenseRecord[];
    onAdd: (expense: Omit<ExpenseRecord, 'id'>) => Promise<void>;
    onUpdate: (expense: ExpenseRecord) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    isLoading: boolean;
    formatCurrency: (amount: number) => string;
}> = ({ expenses, onAdd, onUpdate, onDelete, isLoading, formatCurrency }) => {
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingExpense, setEditingExpense] = useState<ExpenseRecord | null>(null);

    const handleSave = async (expenseData: any) => {
        if (editingExpense) {
            await onUpdate({ ...editingExpense, ...expenseData });
        } else {
            await onAdd(expenseData);
        }
        setIsFormOpen(false);
        setEditingExpense(null);
    };

    const handleEdit = (expense: ExpenseRecord) => {
        setEditingExpense(expense);
        setIsFormOpen(true);
    };

    const handleNew = () => {
        setEditingExpense(null);
        setIsFormOpen(true);
    };

    if (isLoading) {
        return <div className="text-center p-12 text-slate-500">Loading expenses...</div>;
    }

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">Expense Records</h3>
                <button
                    onClick={handleNew}
                    className="bg-[--color-primary-600] hover:bg-[--color-primary-700] text-white font-bold py-2 px-4 rounded-lg shadow-sm hover:shadow-md transition-all flex items-center gap-2"
                >
                    <PlusIcon className="w-5 h-5" />
                    Add Expense
                </button>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <table className="w-full">
                    <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Date</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Category</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Description</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Amount</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {expenses.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400">
                                    No expenses recorded yet
                                </td>
                            </tr>
                        ) : (
                            expenses.map((expense) => (
                                <tr key={expense.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-400">
                                        {new Date(expense.date).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-slate-100">
                                        {expense.category}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                                        {expense.description}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-red-600 dark:text-red-400">
                                        {formatCurrency(expense.amount)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                        <button onClick={() => handleEdit(expense)} className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 mr-3">
                                            <EditIcon className="w-5 h-5" />
                                        </button>
                                        <button onClick={() => onDelete(expense.id)} className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300">
                                            <TrashIcon className="w-5 h-5" />
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {isFormOpen && (
                <ExpenseFormModal
                    isOpen={isFormOpen}
                    onClose={() => { setIsFormOpen(false); setEditingExpense(null); }}
                    onSave={handleSave}
                    initialData={editingExpense}
                />
            )}
        </div>
    );
};

// Expense Form Modal
const ExpenseFormModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: any) => void;
    initialData: ExpenseRecord | null;
}> = ({ isOpen, onClose, onSave, initialData }) => {
    const [expense, setExpense] = useState({
        date: new Date().toISOString().split('T')[0],
        category: '',
        description: '',
        amount: 0
    });

    React.useEffect(() => {
        if (isOpen) {
            if (initialData) {
                setExpense({
                    date: initialData.date || new Date().toISOString().split('T')[0],
                    category: initialData.category || '',
                    description: initialData.description || '',
                    amount: initialData.amount || 0
                });
            } else {
                setExpense({
                    date: new Date().toISOString().split('T')[0],
                    category: '',
                    description: '',
                    amount: 0
                });
            }
        }
    }, [initialData, isOpen]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(expense);
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold mb-4">{initialData ? 'Edit Expense' : 'Add New Expense'}</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Date</label>
                                <input
                                    type="date"
                                    value={expense.date}
                                    onChange={(e) => setExpense({ ...expense, date: e.target.value })}
                                    required
                                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Category</label>
                                <input
                                    type="text"
                                    value={expense.category}
                                    onChange={(e) => setExpense({ ...expense, category: e.target.value })}
                                    required
                                    placeholder="e.g., Electricity, Rent, Internet"
                                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description</label>
                                <textarea
                                    value={expense.description}
                                    onChange={(e) => setExpense({ ...expense, description: e.target.value })}
                                    rows={3}
                                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Amount</label>
                                <input
                                    type="number"
                                    value={expense.amount}
                                    onChange={(e) => setExpense({ ...expense, amount: parseFloat(e.target.value) || 0 })}
                                    required
                                    step="0.01"
                                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                                />
                            </div>
                        </div>
                    </div>
                    <div className="p-6 border-t border-slate-200 dark:border-slate-700 flex justify-end space-x-3">
                        <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
                            Cancel
                        </button>
                        <button type="submit" className="px-4 py-2 bg-[--color-primary-600] text-white rounded-md hover:bg-[--color-primary-700]">
                            {initialData ? 'Update' : 'Add'} Expense
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// Sales Revenue View
const SalesRevenueView: React.FC<{
    sales: SaleRecord[];
    onDelete: (id: string) => Promise<void>;
    isLoading: boolean;
    formatCurrency: (amount: number) => string;
}> = ({ sales, onDelete, isLoading, formatCurrency }) => {
    if (isLoading) {
        return <div className="text-center p-12 text-slate-500">Loading sales records...</div>;
    }

    return (
        <div className="space-y-4">
            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">Sales Revenue</h3>

            <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <table className="w-full">
                    <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Date</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Client</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Plan</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">Amount</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {sales.length === 0 ? (
                            <tr>
                                <td colSpan={4} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400">
                                    No sales recorded yet
                                </td>
                            </tr>
                        ) : (
                            sales.map((sale) => (
                                <tr key={sale.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-400">
                                        {new Date(sale.date).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-slate-100">
                                        {sale.clientName}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-400">
                                        {sale.planName}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-green-600 dark:text-green-400">
                                        {formatCurrency(sale.finalAmount)}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// All Routers Summary Component
const StatCard: React.FC<{ title: string; value: string; icon: React.ReactNode }> = ({ title, value, icon }) => (
    <div className="bg-white dark:bg-slate-800 p-4 rounded-lg flex items-center gap-4 border border-slate-200 dark:border-slate-700">
        <div className="p-3 bg-slate-100 dark:bg-slate-700/50 rounded-lg">{icon}</div>
        <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">{title}</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
        </div>
    </div>
);

const AllRoutersSummary: React.FC<{
    allSales: SaleRecord[];
    allExpenses: ExpenseRecord[];
    allPisowifiRecords: any[];
    clientInvoices: any[];
    formatCurrency: (amount: number) => string;
}> = ({ allSales, allExpenses, allPisowifiRecords, clientInvoices, formatCurrency }) => {
    // Calculate per-router breakdown (sales only, expenses are global)
    const routerBreakdown = useMemo(() => {
        const breakdown = new Map<string, {
            routerName: string;
            pppoeSales: number;
            dhcpSales: number;
            totalIncome: number;
            transactionCount: number;
        }>();

        // Group PPPoE sales by router
        allSales.forEach(sale => {
            const routerId = sale.routerId || 'unknown';
            const routerName = sale.routerName || 'Unknown Router';
            if (!breakdown.has(routerId)) {
                breakdown.set(routerId, {
                    routerName,
                    pppoeSales: 0,
                    dhcpSales: 0,
                    totalIncome: 0,
                    transactionCount: 0
                });
            }
            const data = breakdown.get(routerId)!;
            data.pppoeSales += sale.finalAmount || 0;
            data.transactionCount++;
        });

        // Group DHCP invoices by router
        clientInvoices.filter(inv => inv.status === 'PAID').forEach(inv => {
            const routerId = inv.routerId || 'unknown';
            if (!breakdown.has(routerId)) {
                breakdown.set(routerId, {
                    routerName: inv.routerName || 'Unknown Router',
                    pppoeSales: 0, dhcpSales: 0, totalIncome: 0, transactionCount: 0
                });
            }
            breakdown.get(routerId)!.dhcpSales += inv.totalAmount || inv.amount || 0;
        });

        // Calculate totals for each router
        breakdown.forEach(data => {
            data.totalIncome = data.pppoeSales + data.dhcpSales;
        });

        return Array.from(breakdown.values()).sort((a, b) => b.totalIncome - a.totalIncome);
    }, [allSales, clientInvoices]);

    // Grand totals
    const grandTotals = useMemo(() => {
        const totalPPPoE = allSales.reduce((sum, s) => sum + (s.finalAmount || 0), 0);
        const totalDHCP = clientInvoices.filter(inv => inv.status === 'PAID')
            .reduce((sum, inv) => sum + (inv.totalAmount || inv.amount || 0), 0);
        const totalPisoWiFi = allPisowifiRecords.reduce((sum, r) => sum + (r.netTotal || 0), 0);
        const totalIncome = totalPPPoE + totalDHCP + totalPisoWiFi;
        const totalExpenses = allExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
        
        return {
            totalPPPoE,
            totalDHCP,
            totalPisoWiFi,
            totalIncome,
            totalExpenses,
            netProfit: totalIncome - totalExpenses,
            totalTransactions: allSales.length + clientInvoices.filter(inv => inv.status === 'PAID').length
        };
    }, [allSales, clientInvoices, allExpenses, allPisowifiRecords]);

    return (
        <div className="space-y-6">
            {/* Grand Total Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard title="Total PPPoE Sales" value={formatCurrency(grandTotals.totalPPPoE)} icon={<CurrencyDollarIcon className="w-6 h-6 text-sky-500" />} />
                <StatCard title="Total DHCP Revenue" value={formatCurrency(grandTotals.totalDHCP)} icon={<CurrencyDollarIcon className="w-6 h-6 text-emerald-500" />} />
                <StatCard title="Total PisoWiFi Income" value={formatCurrency(grandTotals.totalPisoWiFi)} icon={<CurrencyDollarIcon className="w-6 h-6 text-yellow-500" />} />
                <StatCard title="Total Expenses" value={formatCurrency(grandTotals.totalExpenses)} icon={<ExclamationTriangleIcon className="w-6 h-6 text-red-500" />} />
            </div>

            {/* Net Profit Card */}
            <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg p-6 text-white">
                <div className="flex justify-between items-center">
                    <div>
                        <p className="text-sm opacity-90">Net Profit (All Routers)</p>
                        <p className="text-3xl font-bold">{formatCurrency(grandTotals.netProfit)}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-sm opacity-90">Total Transactions</p>
                        <p className="text-2xl font-bold">{grandTotals.totalTransactions}</p>
                    </div>
                </div>
            </div>

            {/* Per-Router Breakdown Table */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md border border-slate-200 dark:border-slate-700">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-lg font-bold">Revenue by Router</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                            <tr>
                                <th className="px-4 py-3">Router</th>
                                <th className="px-4 py-3 text-right">PPPoE Sales</th>
                                <th className="px-4 py-3 text-right">DHCP Revenue</th>
                                <th className="px-4 py-3 text-right">Total Income</th>
                                <th className="px-4 py-3 text-center">Transactions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {routerBreakdown.length === 0 ? (
                                <tr><td colSpan={5} className="text-center py-8 text-slate-500">No sales data available</td></tr>
                            ) : (
                                routerBreakdown.map((router, idx) => (
                                    <tr key={idx} className="border-b hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                        <td className="px-4 py-3 font-medium">{router.routerName}</td>
                                        <td className="px-4 py-3 text-right font-mono">{formatCurrency(router.pppoeSales)}</td>
                                        <td className="px-4 py-3 text-right font-mono">{formatCurrency(router.dhcpSales)}</td>
                                        <td className="px-4 py-3 text-right font-mono font-bold text-green-600">{formatCurrency(router.totalIncome)}</td>
                                        <td className="px-4 py-3 text-center">{router.transactionCount}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
