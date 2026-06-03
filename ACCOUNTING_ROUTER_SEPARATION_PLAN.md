# Accounting Page - Router-Based Separation & All Routers Summary

## Current State
- Accounting page receives `selectedRouter` prop from App.tsx
- Sales data is already filtered by `selectedRouter?.id` (line 29)
- Expenses are GLOBAL (not router-specific)
- PisoWiFi Income stays AS-IS (global, no changes)
- Cash flow analysis uses `allSales` (all routers combined) mixed with global expenses
- 4 existing tabs: Financial Overview, Expenses, PisoWiFi Income, Sales Revenue

## Problems to Solve
1. Expenses are not separated by router (all mixed together)
2. No way to see totals for a specific router
3. No aggregated view showing all routers combined with totals
4. When switching routers, only sales change - expenses stay the same
5. **PisoWiFi Income stays GLOBAL** - not mentioned for changes

## Implementation Plan

### Task 1: Update Types and Data Structure
**File: `types.ts`**
- Add `routerId` field to `ExpenseRecord` interface (optional, nullable for backward compatibility)
- **DO NOT** modify `PisowifiIncomeRecord` - stays as-is

**File: `proxy/server.js`**
- Alter `expenses` table: `ALTER TABLE expenses ADD COLUMN routerId TEXT`
- **DO NOT** modify `pisowifi_income` table
- Update expense INSERT statements to include `routerId` when provided

### Task 2: Update Data Hooks to Filter by Router
**File: `hooks/useExpensesData.ts`**
- Add `routerId` parameter to hook signature: `export const useExpensesData = (routerId: string | null = null)`
- Filter expenses by `routerId` in `fetchExpenses` function: `/expenses?routerId=${routerId}`
- Pass `routerId` when adding expenses

**File: `hooks/usePisowifiIncomeData.ts`**
- **NO CHANGES** - stays as-is, no router filtering

**File: `hooks/usePisowifiResellersData.ts`**
- **NO CHANGES** - stays as-is

### Task 3: Update Accounting Component
**File: `components/Accounting.tsx`**

**Step 1: Update data fetching**
```typescript
// Line 26: Pass selectedRouter?.id to expenses hook ONLY
const { expenses, addExpense, ... } = useExpensesData(selectedRouter?.id);
// Line 27-28: Keep PisoWiFi hooks as-is (no router parameter)
const { records: pisowifiRecords, ... } = usePisowifiIncomeData();
const { resellers: pisowifiResellers, ... } = usePisowifiResellersData();
```

**Step 2: Update financialSummary**
- Current line 58-71: uses `sales`, `pisowifiRecords`, `expenses`
- Sales and expenses are now filtered by router, PisoWiFi stays global
- Summary correctly reflects selected router

**Step 3: Update cashFlowAnalysis**
- Line 87-178: Filter `allSales` by `selectedRouter?.id` when router is selected
- Filter expenses by period (already router-filtered via hook)
- **Keep PisoWiFi records global** (no router filter)
- When `selectedRouter` is null, show all routers combined

**Step 4: Add new "All Routers Summary" tab**
```typescript
// Line 13: Update tab type
type AccountingTab = 'overview' | 'expenses' | 'pisowifi' | 'sales' | 'all-routers-summary';

// Line 193: Add new tab button
<TabButton label="All Routers Summary" icon={<ChartBarIcon className="w-5 h-5" />} isActive={activeTab === 'all-routers-summary'} onClick={() => setActiveTab('all-routers-summary')} />
```

### Task 4: Create All Routers Summary Component
**File: `components/Accounting.tsx` (add new component at end)**

```typescript
const AllRoutersSummary: React.FC<{
    allSales: SaleRecord[];
    allExpenses: ExpenseRecord[];
    allPisowifiRecords: PisowifiIncomeRecord[];
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
                            {routerBreakdown.map((router, idx) => (
                                <tr key={idx} className="border-b hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <td className="px-4 py-3 font-medium">{router.routerName}</td>
                                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(router.pppoeSales)}</td>
                                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(router.dhcpSales)}</td>
                                    <td className="px-4 py-3 text-right font-mono font-bold text-green-600">{formatCurrency(router.totalIncome)}</td>
                                    <td className="px-4 py-3 text-center">{router.transactionCount}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
```

### Task 5: Add Tab Rendering
**File: `components/Accounting.tsx` (line 232-239)**

Add new tab content rendering:
```typescript
{activeTab === 'all-routers-summary' && (
    <AllRoutersSummary 
        allSales={allSales}
        allExpenses={expenses}
        allPisowifiRecords={pisowifiRecords}
        clientInvoices={clientInvoices}
        formatCurrency={formatCurrency}
    />
)}
```

### Task 6: Update loadAllFinancialData to Fetch Global Data
**File: `components/Accounting.tsx` (line 40-55)**

Keep `loadAllFinancialData` fetching ALL data (no router filter) for the summary page:
```typescript
const loadAllFinancialData = async () => {
    try {
        setIsLoadingAllSales(true);
        const [salesData, invoicesData, allExpensesData] = await Promise.all([
            dbApi.get<SaleRecord[]>('/sales'),
            dbApi.get<any[]>('/client-invoices'),
            dbApi.get<ExpenseRecord[]>('/expenses')
        ]);
        setAllSales(salesData || []);
        setClientInvoices(invoicesData || []);
        setAllExpensesGlobal(allExpensesData || []);
    } catch (err) {
        console.error('Failed to load financial data:', err);
    } finally {
        setIsLoadingAllSales(false);
    }
};
```

### Task 7: Database Migration Script
**File: `proxy/server.js` (in database initialization section)**

Add migration to add `routerId` column to expenses table only:
```javascript
// Check and add routerId to expenses table
try {
    await db.run("ALTER TABLE expenses ADD COLUMN routerId TEXT");
    console.log('[Migration] Added routerId to expenses table');
} catch (e) {
    // Column already exists
}

// DO NOT modify pisowifi_income table
```

## Summary of Changes

### Files Modified:
1. `types.ts` - Add `routerId` to ExpenseRecord ONLY
2. `proxy/server.js` - Database migration for expenses table, update expense INSERT queries
3. `hooks/useExpensesData.ts` - Add routerId parameter and filtering
4. `components/Accounting.tsx` - Restructure:
   - Pass routerId to useExpensesData hook ONLY
   - Keep PisoWiFi hooks unchanged
   - Add "All Routers Summary" tab
   - Create AllRoutersSummary component
   - Update cashFlowAnalysis to respect router selection for sales and expenses only

### Files UNCHANGED:
1. `hooks/usePisowifiIncomeData.ts` - No router filtering
2. `hooks/usePisowifiResellersData.ts` - No router filtering
3. `components/PisoWifiIncomeManager.tsx` - No changes

### New Features:
1. Router-specific accounting data (sales and expenses only)
2. New "All Routers Summary" sub-page showing:
   - Grand totals across all routers (PPPoE + DHCP + PisoWiFi + Expenses)
   - Per-router revenue breakdown (PPPoE + DHCP only)
   - Net profit calculation
   - Transaction counts
3. When switching routers: sales and expenses update, PisoWiFi stays global

### Backward Compatibility:
- `routerId` field in expenses is nullable - existing records work without router assignment
- Global expense records (routerId = null) show in all router views
- Can gradually assign routerId to new expenses
- PisoWiFi Income completely untouched

## Testing Checklist
- [ ] Switch routers and verify expenses filter correctly
- [ ] Switch routers and verify sales filter correctly (already works)
- [ ] Switch routers and verify PisoWiFi income STAYS the same (global)
- [ ] Click "All Routers Summary" tab and verify grand totals
- [ ] Verify per-router breakdown shows correct sales data
- [ ] Create new expense with router selected - verify it's assigned to router
- [ ] Create new PisoWiFi income - verify NO router assignment (global)
- [ ] Test with no router selected (should show all data or prompt to select)
