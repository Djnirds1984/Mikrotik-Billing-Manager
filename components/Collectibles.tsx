import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { RouterConfigWithId, PppSecret } from '../types.ts';
import { getPppSecrets } from '../services/mikrotikService.ts';
import { Loader } from './Loader.tsx';
import { RouterIcon } from '../constants.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';

// ─── Types ───────────────────────────────────────────────────────────────────
interface CollectorAssignment {
  id: string;
  router_id: string;
  customer_id: string;
  customer_name: string;
  customer_username: string;
  customer_account_number: string;
  address: string;
  plan_name: string;
  assigned_collector_id: string;
  assigned_collector_name: string;
  status: string;
  notes: string;
  assigned_at: string;
  updated_at: string | null;
}

interface Collector {
  id: string;
  username: string;
}

interface DashboardSummary {
  totalCollected: number;
  todayCollected: number;
  weekCollected: number;
  monthCollected: number;
  totalTransactions: number;
  totalCollectors: number;
}

interface CollectorStat {
  id: string;
  username: string;
  totalCollected: number;
  totalTransactions: number;
  monthCollected?: number;
  lastCollectionDate?: string | null;
}

interface CollectionRecord {
  id: string;
  date: string;
  processedBy: string;
  clientName: string;
  finalAmount: number;
  payment_method?: string;
  planName: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('authToken')}`,
});

const formatCurrency = (amount: number) =>
  `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

const formatPaymentMethod = (method?: string): string => {
    if (!method) return 'Manual';
    const legacyLabels: Record<string, string> = {
        'manual': 'Manual',
        'manual_gcash': 'Manual GCash',
        'paymongo': 'PayMongo',
        'invoice': 'Invoice',
    };
    return legacyLabels[method.toLowerCase()] || method;
};

const parseComment = (comment?: string): any => {
    try {
        return JSON.parse(comment || '{}');
    } catch {
        return {};
    }
};

// ─── Main Component ──────────────────────────────────────────────────────────
export const Collectibles = ({ selectedRouter }: { selectedRouter: RouterConfigWithId | null }) => {
  const [activeTab, setActiveTab] = useState<'monitoring' | 'dashboard'>('monitoring');
  const [collectors, setCollectors] = useState<Collector[]>([]);

  // ── Dashboard state ──
  const [summary, setSummary] = useState<DashboardSummary>({
    totalCollected: 0, todayCollected: 0, weekCollected: 0,
    monthCollected: 0, totalTransactions: 0, totalCollectors: 0,
  });
  const [collectorStats, setCollectorStats] = useState<CollectorStat[]>([]);
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [collPage, setCollPage] = useState(1);
  const [collTotal, setCollTotal] = useState(0);
  const [dashCollector, setDashCollector] = useState('');
  const [dashDateFrom, setDashDateFrom] = useState('');
  const [dashDateTo, setDashDateTo] = useState('');
  const [dashLoading, setDashLoading] = useState(false);

  // ── Fetch collectors (shared by monitoring + dashboard) ──
  const fetchCollectors = useCallback(async () => {
    try {
      const res = await fetch('/api/collector-dashboard/collectors', { headers: authHeaders() });
      if (res.ok) { const data = await res.json(); setCollectors(Array.isArray(data) ? data : []); }
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { fetchCollectors(); }, [fetchCollectors]);

  // ── Dashboard fetch ──
  const fetchDashboard = useCallback(async () => {
    if (!selectedRouter) return;
    setDashLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('router_id', selectedRouter.id);
      const res = await fetch(`/api/collector-dashboard/summary?${params}`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary || { totalCollected: 0, todayCollected: 0, weekCollected: 0, monthCollected: 0, totalTransactions: 0, totalCollectors: 0 });
        setCollectorStats(Array.isArray(data.collectorStats) ? data.collectorStats : []);
      }
    } catch (e) { console.error(e); }
    setDashLoading(false);
  }, [selectedRouter]);

  const fetchCollections = useCallback(async () => {
    if (!selectedRouter) return;
    try {
      const params = new URLSearchParams();
      params.set('router_id', selectedRouter.id);
      if (dashCollector) params.set('collector_name', dashCollector);
      if (dashDateFrom) params.set('date_from', dashDateFrom);
      if (dashDateTo) params.set('date_to', dashDateTo);
      params.set('page', String(collPage));
      params.set('limit', '50');
      const res = await fetch(`/api/collector-dashboard/collections?${params}`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setCollections(Array.isArray(data.collections) ? data.collections : Array.isArray(data) ? data : []);
        setCollTotal(data.total || 0);
      }
    } catch (e) { console.error(e); }
  }, [selectedRouter, dashCollector, dashDateFrom, dashDateTo, collPage]);

  useEffect(() => {
    if (activeTab === 'dashboard') { fetchDashboard(); fetchCollections(); }
  }, [activeTab, fetchDashboard, fetchCollections]);

  if (!selectedRouter) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
        <RouterIcon className="w-16 h-16 text-slate-400 dark:text-slate-600 mb-4" />
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">Collectibles</h2>
        <p className="mt-2 text-slate-500 dark:text-slate-400">Please select a router to view collectibles.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        <button
          onClick={() => setActiveTab('monitoring')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition ${activeTab === 'monitoring' ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 border border-b-0 border-slate-200 dark:border-slate-700 -mb-px' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
        >
          Payment Monitoring
        </button>
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition ${activeTab === 'dashboard' ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 border border-b-0 border-slate-200 dark:border-slate-700 -mb-px' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
        >
          Collections Dashboard
        </button>
      </div>

      {activeTab === 'monitoring' ? (
        <PaymentMonitoringTab selectedRouter={selectedRouter} collectors={collectors} />
      ) : (
        <DashboardTab
          summary={summary}
          collectorStats={collectorStats}
          collections={collections}
          collPage={collPage}
          setCollPage={setCollPage}
          collTotal={collTotal}
          collectors={collectors}
          dashCollector={dashCollector}
          setDashCollector={setDashCollector}
          dashDateFrom={dashDateFrom}
          setDashDateFrom={setDashDateFrom}
          dashDateTo={dashDateTo}
          setDashDateTo={setDashDateTo}
          loading={dashLoading}
        />
      )}
    </div>
  );
};

// ─── Payment Monitoring Tab (cloned from Pppoe.tsx PaymentMonitoring) ────────
const PaymentMonitoringTab: React.FC<{
  selectedRouter: RouterConfigWithId;
  collectors: Collector[];
}> = ({ selectedRouter, collectors }) => {
    const { user } = useAuth();
    const isCollector = user?.role?.name?.toLowerCase() === 'collector';
    const canAssign = !isCollector;

    const [secrets, setSecrets] = useState<PppSecret[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'paid' | 'unpaid'>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [isExporting, setIsExporting] = useState(false);
    const [assignments, setAssignments] = useState<CollectorAssignment[]>([]);
    const [assignTarget, setAssignTarget] = useState<PppSecret | null>(null);

    useEffect(() => {
        fetchSecrets();
    }, [selectedRouter]);

    const fetchSecrets = async () => {
        try {
            setIsLoading(true);
            const data = await getPppSecrets(selectedRouter);
            setSecrets(data || []);
        } catch (err) {
            setError('Failed to fetch PPPoE users');
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchAssignments = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            params.set('router_id', selectedRouter.id);
            params.set('status', 'Active');
            const res = await fetch(`/api/collector-assignments?${params}`, { headers: authHeaders() });
            if (res.ok) {
                const data = await res.json();
                setAssignments(Array.isArray(data) ? data : []);
            }
        } catch (e) { console.error(e); }
    }, [selectedRouter]);

    useEffect(() => { fetchAssignments(); }, [fetchAssignments]);

    // Map latest Active assignment per PPPoE username (list is ordered assigned_at DESC)
    const assignmentsByUsername = useMemo(() => {
        const map = new Map<string, CollectorAssignment>();
        for (const a of assignments) {
            if (a.customer_username && !map.has(a.customer_username)) {
                map.set(a.customer_username, a);
            }
        }
        return map;
    }, [assignments]);

    const parseDueDate = (comment: string) => {
        try {
            const c = JSON.parse(comment || '{}');
            return c.dueDateTime || c.dueDate || null;
        } catch {
            return null;
        }
    };

    const exportToCSV = () => {
        try {
            setIsExporting(true);
            
            // Prepare CSV data
            const headers = ['Username', 'Profile', 'Due Date', 'Payment Status', 'Days Remaining', 'Plan Name', 'Plan Type', 'Collector', 'Comment'];
            const rows = filteredSecrets.map(secret => {
                const paymentInfo = getCurrentMonthPayment(secret);
                const status = getPaymentStatus(secret);
                const assignment = assignmentsByUsername.get(secret.name);
                
                let planName = '';
                let planType = '';
                try {
                    const c = JSON.parse(secret.comment || '{}');
                    planName = c.planName || c.plan || '';
                    planType = c.planType || '';
                } catch {}
                
                return [
                    secret.name,
                    secret.profile,
                    paymentInfo?.dueDate ? paymentInfo.dueDate.toISOString().split('T')[0] : 'N/A',
                    status === 'paid' ? 'Paid' : status === 'unpaid' ? 'Unpaid' : 'Unknown',
                    paymentInfo ? (paymentInfo.isExpired ? `Expired ${Math.abs(paymentInfo.daysRemaining)} days ago` : `${paymentInfo.daysRemaining} days`) : 'N/A',
                    planName,
                    planType,
                    assignment?.assigned_collector_name || 'Unassigned',
                    secret.comment || ''
                ];
            });
            
            // Build CSV content
            const csvContent = [
                headers.join(','),
                ...rows.map(row => row.map(cell => {
                    // Escape quotes and wrap in quotes if contains comma
                    const cellStr = String(cell).replace(/"/g, '""');
                    return cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n') 
                        ? `"${cellStr}"` 
                        : cellStr;
                })).join(',')
            ].join('\n');
            
            // Add UTF-8 BOM for Excel compatibility
            const BOM = '\uFEFF';
            const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
            
            // Create download link
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            
            // Generate filename with date and filter
            const now = new Date();
            const dateStr = now.toISOString().split('T')[0];
            const filterSuffix = filter === 'all' ? 'all' : filter;
            link.setAttribute('download', `collectibles_payment_${filterSuffix}_${dateStr}.csv`);
            
            // Trigger download
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
        } catch (err) {
            console.error('Export to CSV failed:', err);
            setError('Failed to export CSV');
        } finally {
            setIsExporting(false);
        }
    };

    const getPaymentStatus = (secret: PppSecret) => {
        const dueDate = parseDueDate(secret.comment);
        if (!dueDate) return 'unknown';
        
        const now = new Date();
        const due = new Date(dueDate);
        
        // Check if paid for current month (due date is in the future)
        if (due > now) return 'paid';
        return 'unpaid';
    };

    const getCurrentMonthPayment = (secret: PppSecret) => {
        const dueDate = parseDueDate(secret.comment);
        if (!dueDate) return null;
        
        const due = new Date(dueDate);
        const now = new Date();
        
        return {
            dueDate: due,
            isCurrentMonth: due.getMonth() === now.getMonth() && due.getFullYear() === now.getFullYear(),
            daysRemaining: Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
            isExpired: due < now
        };
    };

    // Active secrets, scoped to own assignments for collector-role users
    const baseSecrets = useMemo(() => {
        let active = secrets.filter(s => !s.disabled || s.disabled === 'false');
        if (isCollector && user) {
            active = active.filter(s => assignmentsByUsername.get(s.name)?.assigned_collector_id === user.id);
        }
        return active;
    }, [secrets, isCollector, user, assignmentsByUsername]);

    const filteredSecrets = useMemo(() => {
        let filtered = baseSecrets;
        
        // Apply payment filter
        if (filter !== 'all') {
            filtered = filtered.filter(s => getPaymentStatus(s) === filter);
        }
        
        // Apply search filter
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filtered = filtered.filter(s => 
                s.name.toLowerCase().includes(term) || 
                s.profile.toLowerCase().includes(term) ||
                (s.comment && s.comment.toLowerCase().includes(term))
            );
        }
        
        return filtered;
    }, [baseSecrets, filter, searchTerm]);

    const stats = useMemo(() => {
        const paid = baseSecrets.filter(s => getPaymentStatus(s) === 'paid').length;
        const unpaid = baseSecrets.filter(s => getPaymentStatus(s) === 'unpaid').length;
        const unknown = baseSecrets.filter(s => getPaymentStatus(s) === 'unknown').length;
        
        return { total: baseSecrets.length, paid, unpaid, unknown };
    }, [baseSecrets]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader />
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <p className="text-red-600 dark:text-red-400">{error}</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                    <div className="text-sm text-slate-500 dark:text-slate-400">Total Users</div>
                    <div className="text-2xl font-bold text-slate-800 dark:text-slate-200 mt-1">{stats.total}</div>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                    <div className="text-sm text-green-600 dark:text-green-400">Paid This Month</div>
                    <div className="text-2xl font-bold text-green-700 dark:text-green-300 mt-1">{stats.paid}</div>
                </div>
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                    <div className="text-sm text-red-600 dark:text-red-400">Unpaid This Month</div>
                    <div className="text-2xl font-bold text-red-700 dark:text-red-300 mt-1">{stats.unpaid}</div>
                </div>
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                    <div className="text-sm text-yellow-600 dark:text-yellow-400">No Due Date</div>
                    <div className="text-2xl font-bold text-yellow-700 dark:text-yellow-300 mt-1">{stats.unknown}</div>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                <div className="flex flex-col md:flex-row gap-4">
                    <div className="flex-1">
                        <input
                            type="text"
                            placeholder="Search by username, profile, or comment..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        <button
                            onClick={() => setFilter('all')}
                            className={`px-4 py-2 rounded-md font-medium transition-colors ${
                                filter === 'all'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                            }`}
                        >
                            All ({stats.total})
                        </button>
                        <button
                            onClick={() => setFilter('paid')}
                            className={`px-4 py-2 rounded-md font-medium transition-colors ${
                                filter === 'paid'
                                    ? 'bg-green-600 text-white'
                                    : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                            }`}
                        >
                            Paid ({stats.paid})
                        </button>
                        <button
                            onClick={() => setFilter('unpaid')}
                            className={`px-4 py-2 rounded-md font-medium transition-colors ${
                                filter === 'unpaid'
                                    ? 'bg-red-600 text-white'
                                    : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                            }`}
                        >
                            Unpaid ({stats.unpaid})
                        </button>
                        <button
                            onClick={exportToCSV}
                            disabled={isExporting || filteredSecrets.length === 0}
                            className="px-4 py-2 rounded-md font-medium transition-colors bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {isExporting ? (
                                <>
                                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Exporting...
                                </>
                            ) : (
                                <>
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    Export CSV
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Users Table */}
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Username</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Profile</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Due Date</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Days Left</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Collector</th>
                                {canAssign && (
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Actions</th>
                                )}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {filteredSecrets.length === 0 ? (
                                <tr>
                                    <td colSpan={canAssign ? 7 : 6} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400">
                                        No users found
                                    </td>
                                </tr>
                            ) : (
                                filteredSecrets.map((secret) => {
                                    const paymentInfo = getCurrentMonthPayment(secret);
                                    const status = getPaymentStatus(secret);
                                    const assignment = assignmentsByUsername.get(secret.name);
                                    
                                    return (
                                        <tr key={secret.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{secret.name}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm text-slate-600 dark:text-slate-400">{secret.profile}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm text-slate-600 dark:text-slate-400">
                                                    {paymentInfo?.dueDate ? paymentInfo.dueDate.toLocaleDateString() : 'N/A'}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                                                    status === 'paid'
                                                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                                        : status === 'unpaid'
                                                        ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                                        : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                                                }`}>
                                                    {status === 'paid' ? 'Paid' : status === 'unpaid' ? 'Unpaid' : 'Unknown'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className={`text-sm font-medium ${
                                                    paymentInfo?.isExpired
                                                        ? 'text-red-600 dark:text-red-400'
                                                        : paymentInfo && paymentInfo.daysRemaining <= 5
                                                        ? 'text-orange-600 dark:text-orange-400'
                                                        : 'text-slate-600 dark:text-slate-400'
                                                }`}>
                                                    {paymentInfo ? (
                                                        paymentInfo.isExpired
                                                            ? `Expired ${Math.abs(paymentInfo.daysRemaining)} days ago`
                                                            : `${paymentInfo.daysRemaining} days`
                                                    ) : 'N/A'}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                {assignment ? (
                                                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{assignment.assigned_collector_name}</span>
                                                ) : (
                                                    <span className="text-sm text-slate-400 dark:text-slate-500 italic">Unassigned</span>
                                                )}
                                            </td>
                                            {canAssign && (
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                                    <button
                                                        onClick={() => setAssignTarget(secret)}
                                                        className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                                                    >
                                                        {assignment ? 'Reassign' : 'Assign'}
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Assign Collector Modal */}
            {assignTarget && (
                <AssignCollectorModal
                    secret={assignTarget}
                    assignment={assignmentsByUsername.get(assignTarget.name) || null}
                    collectors={collectors}
                    selectedRouter={selectedRouter}
                    onClose={() => setAssignTarget(null)}
                    onSaved={() => { setAssignTarget(null); fetchAssignments(); }}
                />
            )}
        </div>
    );
};

// ─── Assign Collector Modal ──────────────────────────────────────────────────
const AssignCollectorModal: React.FC<{
  secret: PppSecret;
  assignment: CollectorAssignment | null;
  collectors: Collector[];
  selectedRouter: RouterConfigWithId;
  onClose: () => void;
  onSaved: () => void;
}> = ({ secret, assignment, collectors, selectedRouter, onClose, onSaved }) => {
  const [collectorId, setCollectorId] = useState(assignment?.assigned_collector_id || '');
  const [notes, setNotes] = useState(assignment?.notes || '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!collectorId) { alert('Please select a collector'); return; }
    const collector = collectors.find(c => c.id === collectorId);
    setSaving(true);
    try {
      if (assignment) {
        // Reassign existing Active assignment
        const res = await fetch(`/api/collector-assignments/${assignment.id}`, {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify({
            assigned_collector_id: collectorId,
            assigned_collector_name: collector?.username || '',
            notes,
          }),
        });
        if (!res.ok) throw new Error('Failed to reassign collector');
      } else {
        // New assignment — row data comes from the PPP secret comment JSON
        const c = parseComment(secret.comment);
        const body = {
          router_id: selectedRouter.id,
          customer_id: c.customerId || '',
          customer_name: c.customerName || c.fullName || secret.name,
          customer_username: secret.name,
          customer_account_number: c.accountNumber || '',
          address: c.address || '',
          plan_name: c.planName || c.plan || secret.profile,
          assigned_collector_id: collectorId,
          assigned_collector_name: collector?.username || '',
          notes,
        };
        const res = await fetch('/api/collector-assignments', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
        if (!res.ok) throw new Error('Failed to assign collector');
      }
      onSaved();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500';
  const labelCls = 'block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-white">{assignment ? 'Reassign' : 'Assign'} Collector</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl">&times;</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3 space-y-1 text-sm">
            <p className="font-medium text-slate-800 dark:text-slate-200">{secret.name}</p>
            <p className="text-xs text-slate-500">Profile: {secret.profile}</p>
            {assignment && (
              <p className="text-xs text-slate-500">Currently assigned to: <span className="font-medium text-slate-700 dark:text-slate-300">{assignment.assigned_collector_name}</span></p>
            )}
          </div>
          <div>
            <label className={labelCls}>Select Collector *</label>
            <select className={inputCls} value={collectorId} onChange={e => setCollectorId(e.target.value)}>
              <option value="">Select Collector</option>
              {collectors.map(c => <option key={c.id} value={c.id}>{c.username}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <textarea rows={2} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." />
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-slate-200 dark:border-slate-700">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">{saving ? 'Saving...' : assignment ? 'Reassign Collector' : 'Assign Collector'}</button>
        </div>
      </div>
    </div>
  );
};

// ─── Dashboard Tab ───────────────────────────────────────────────────────────
const DashboardTab: React.FC<{
  summary: DashboardSummary;
  collectorStats: CollectorStat[];
  collections: CollectionRecord[];
  collPage: number; setCollPage: (v: number) => void;
  collTotal: number;
  collectors: Collector[];
  dashCollector: string; setDashCollector: (v: string) => void;
  dashDateFrom: string; setDashDateFrom: (v: string) => void;
  dashDateTo: string; setDashDateTo: (v: string) => void;
  loading: boolean;
}> = ({ summary, collectorStats, collections, collPage, setCollPage, collTotal, collectors, dashCollector, setDashCollector, dashDateFrom, setDashDateFrom, dashDateTo, setDashDateTo, loading }) => {
  const totalPages = Math.max(1, Math.ceil(collTotal / 50));
  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total Collected', value: formatCurrency(summary.totalCollected) },
          { label: 'Collected Today', value: formatCurrency(summary.todayCollected) },
          { label: 'This Week', value: formatCurrency(summary.weekCollected) },
          { label: 'This Month', value: formatCurrency(summary.monthCollected) },
          { label: 'Transactions', value: summary.totalTransactions },
          { label: 'Collectors', value: summary.totalCollectors },
        ].map(c => (
          <div key={c.label} className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">{c.label}</p>
            <p className="text-lg font-bold text-slate-800 dark:text-slate-200">{c.value}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-500">Loading dashboard...</div>
      ) : (
        <>
          {/* Collector Performance Table */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Collector Performance</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400 uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Collector</th>
                    <th className="px-4 py-3 text-right">Total Collected</th>
                    <th className="px-4 py-3 text-center">Transactions</th>
                    <th className="px-4 py-3 text-right">This Month</th>
                    <th className="px-4 py-3 text-left">Last Collection</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {collectorStats.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-6 text-slate-500">No collector data yet.</td></tr>
                  ) : collectorStats.map(cs => (
                    <tr key={cs.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">{cs.username}</td>
                      <td className="px-4 py-3 text-right font-mono text-green-600 dark:text-green-400">{formatCurrency(cs.totalCollected)}</td>
                      <td className="px-4 py-3 text-center text-slate-600 dark:text-slate-400">{cs.totalTransactions}</td>
                      <td className="px-4 py-3 text-right font-mono text-sky-600 dark:text-sky-400">{formatCurrency(cs.monthCollected || 0)}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{formatDate(cs.lastCollectionDate || null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Collections History */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Collections History</h3>
              <div className="flex-1" />
              <select className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" value={dashCollector} onChange={e => { setDashCollector(e.target.value); setCollPage(1); }}>
                <option value="">All Collectors</option>
                {collectors.map(c => <option key={c.id} value={c.username}>{c.username}</option>)}
              </select>
              <input type="date" className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" value={dashDateFrom} onChange={e => { setDashDateFrom(e.target.value); setCollPage(1); }} />
              <input type="date" className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" value={dashDateTo} onChange={e => { setDashDateTo(e.target.value); setCollPage(1); }} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400 uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Collector</th>
                    <th className="px-4 py-3 text-left">Customer</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-left">Method</th>
                    <th className="px-4 py-3 text-left">Plan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {collections.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-6 text-slate-500">No collections found.</td></tr>
                  ) : collections.map((c, i) => (
                    <tr key={c.id || i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300 font-mono">{formatDate(c.date)}</td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{c.processedBy}</td>
                      <td className="px-4 py-3 text-slate-800 dark:text-slate-200">{c.clientName || '—'}</td>
                      <td className="px-4 py-3 text-right font-mono text-green-600 dark:text-green-400 font-medium">{formatCurrency(c.finalAmount)}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{formatPaymentMethod(c.payment_method)}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{c.planName || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs text-slate-500">
                <span>Page {collPage} of {totalPages} ({collTotal} records)</span>
                <div className="flex gap-1">
                  <button disabled={collPage <= 1} onClick={() => setCollPage(collPage - 1)} className="px-3 py-1 rounded border border-slate-300 dark:border-slate-600 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-700">Prev</button>
                  <button disabled={collPage >= totalPages} onClick={() => setCollPage(collPage + 1)} className="px-3 py-1 rounded border border-slate-300 dark:border-slate-600 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-700">Next</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default Collectibles;
