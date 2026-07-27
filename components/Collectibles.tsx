import React, { useState, useEffect, useCallback, useMemo } from 'react';

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
  created_at: string;
  updated_at: string | null;
}

interface Collector {
  id: string;
  username: string;
}

interface Customer {
  id: string;
  customerName?: string;
  username?: string;
  accountNumber?: string;
  address?: string;
  planName?: string;
  [key: string]: any;
}

interface ExpiringClient {
  id: string;
  username: string;
  routerId: string;
  fullName: string;
  address: string;
  contactNumber: string;
  accountNumber: string;
  planName: string;
  dueDate: string;
  routerName: string;
  clientType: 'pppoe' | 'dhcp';
  expirationStatus: 'Expired' | 'Expiring';
  assignmentId?: string;
  assigned_collector_id?: string;
  assigned_collector_name?: string;
  assignmentStatus?: string;
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
  paymentMethod: string;
  planName: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const STATUSES = ['Active', 'Completed', 'Revoked'];

const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('authToken')}`,
});

const formatCurrency = (amount: number) =>
  `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

const getStatusBadge = (status: string) => {
  const map: Record<string, string> = {
    Active: 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400',
    Completed: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400',
    Revoked: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400',
  };
  return map[status] || 'bg-slate-100 dark:bg-slate-600/30 text-slate-700 dark:text-slate-300';
};

// ─── Main Component ──────────────────────────────────────────────────────────
export const Collectibles = ({ selectedRouter }: { selectedRouter: string }) => {
  const [activeTab, setActiveTab] = useState<'assignments' | 'dashboard'>('assignments');

  // ── Assignments state ──
  const [assignments, setAssignments] = useState<CollectorAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCollector, setFilterCollector] = useState('');
  const [filterAddress, setFilterAddress] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [collectors, setCollectors] = useState<Collector[]>([]);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<CollectorAssignment | null>(null);
  const [showBatch, setShowBatch] = useState(false);
  const [assignmentsSubTab, setAssignmentsSubTab] = useState<'expiring' | 'all'>('expiring');

  // ── Expiring clients state ──
  const [expiringClients, setExpiringClients] = useState<ExpiringClient[]>([]);
  const [expLoading, setExpLoading] = useState(true);
  const [expSearch, setExpSearch] = useState('');
  const [expFilterStatus, setExpFilterStatus] = useState('');
  const [expFilterCollector, setExpFilterCollector] = useState('');
  const [expFilterAddress, setExpFilterAddress] = useState('');
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignTarget, setAssignTarget] = useState<ExpiringClient | null>(null);
  const [showBatchAssignModal, setShowBatchAssignModal] = useState(false);

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

  // ── Fetch collectors (shared) ──
  const fetchCollectors = useCallback(async () => {
    try {
      const res = await fetch('/api/collector-dashboard/collectors', { headers: authHeaders() });
      if (res.ok) { const data = await res.json(); setCollectors(Array.isArray(data) ? data : []); }
    } catch (e) { console.error(e); }
  }, []);

  // ── Fetch expiring clients ──
  const fetchExpiringClients = useCallback(async () => {
    setExpLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedRouter) params.append('router_id', selectedRouter);
      const res = await fetch(`/api/collectibles/expiring-clients?${params}`, { headers: authHeaders() });
      if (res.ok) { const data = await res.json(); setExpiringClients(Array.isArray(data) ? data : []); }
    } catch (err) { console.error(err); }
    setExpLoading(false);
  }, [selectedRouter]);

  // ── Fetch assignments ──
  const fetchAssignments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedRouter) params.set('router_id', selectedRouter);
      if (filterCollector) params.set('assigned_collector_id', filterCollector);
      if (filterStatus) params.set('status', filterStatus);
      if (filterAddress) params.set('address', filterAddress);
      if (search) params.set('search', search);
      const res = await fetch(`/api/collector-assignments?${params}`, { headers: authHeaders() });
      if (res.ok) setAssignments(await res.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [selectedRouter, filterCollector, filterStatus, filterAddress, search]);

  // ── Fetch addresses ──
  const fetchAddresses = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedRouter) params.set('router_id', selectedRouter);
      const res = await fetch(`/api/collector-assignments/addresses?${params}`, { headers: authHeaders() });
      if (res.ok) { const data = await res.json(); setAddresses(Array.isArray(data) ? data.map((r: any) => r.address || r) : []); }
    } catch (e) { console.error(e); }
  }, [selectedRouter]);

  useEffect(() => { fetchCollectors(); }, [fetchCollectors]);
  useEffect(() => { fetchExpiringClients(); }, [fetchExpiringClients]);
  useEffect(() => { fetchAssignments(); }, [fetchAssignments]);
  useEffect(() => { fetchAddresses(); }, [fetchAddresses]);

  // ── Dashboard fetch ──
  const fetchDashboard = useCallback(async () => {
    setDashLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedRouter) params.set('router_id', selectedRouter);
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
    try {
      const params = new URLSearchParams();
      if (selectedRouter) params.set('router_id', selectedRouter);
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

  // ── Expiring clients filtered list ──
  const filteredExpiringClients = useMemo(() => {
    let list = expiringClients;
    if (expSearch) {
      const q = expSearch.toLowerCase();
      list = list.filter(c => c.fullName?.toLowerCase().includes(q) || c.address?.toLowerCase().includes(q) || c.accountNumber?.toLowerCase().includes(q) || c.username?.toLowerCase().includes(q));
    }
    if (expFilterStatus === 'Expired') list = list.filter(c => c.expirationStatus === 'Expired');
    else if (expFilterStatus === 'Expiring') list = list.filter(c => c.expirationStatus === 'Expiring');
    else if (expFilterStatus === 'Assigned') list = list.filter(c => !!c.assignmentId);
    else if (expFilterStatus === 'Unassigned') list = list.filter(c => !c.assignmentId);
    if (expFilterCollector) list = list.filter(c => c.assigned_collector_id === expFilterCollector);
    if (expFilterAddress) list = list.filter(c => c.address === expFilterAddress);
    return list;
  }, [expiringClients, expSearch, expFilterStatus, expFilterCollector, expFilterAddress]);

  const expStats = useMemo(() => ({
    total: expiringClients.length,
    expired: expiringClients.filter(c => c.expirationStatus === 'Expired').length,
    expiring: expiringClients.filter(c => c.expirationStatus === 'Expiring').length,
    assigned: expiringClients.filter(c => !!c.assignmentId).length,
  }), [expiringClients]);

  // ── Assignment stats ──
  const stats = useMemo(() => ({
    total: assignments.length,
    active: assignments.filter(a => a.status === 'Active').length,
    completed: assignments.filter(a => a.status === 'Completed').length,
    revoked: assignments.filter(a => a.status === 'Revoked').length,
  }), [assignments]);

  // ── Checkbox helpers ──
  const toggleClient = (id: string) => {
    setSelectedClientIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAllFiltered = () => {
    if (selectedClientIds.size === filteredExpiringClients.length && filteredExpiringClients.length > 0) {
      setSelectedClientIds(new Set());
    } else {
      setSelectedClientIds(new Set(filteredExpiringClients.map(c => `${c.clientType}-${c.id}`)));
    }
  };
  const allFilteredSelected = filteredExpiringClients.length > 0 && selectedClientIds.size === filteredExpiringClients.length;

  // ── CRUD handlers ──
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this assignment?')) return;
    try {
      await fetch(`/api/collector-assignments/${id}`, { method: 'DELETE', headers: authHeaders() });
      fetchAssignments();
      fetchExpiringClients();
    } catch (e) { console.error(e); }
  };

  // ── Single assign from expiring list ──
  const handleSingleAssign = (client: ExpiringClient) => {
    setAssignTarget(client);
    setShowAssignModal(true);
  };

  // ── Batch assign from selected ──
  const handleBatchAssignSelected = () => {
    setShowBatchAssignModal(true);
  };

  // ── Render ──
  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        <button
          onClick={() => setActiveTab('assignments')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition ${activeTab === 'assignments' ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 border border-b-0 border-slate-200 dark:border-slate-700 -mb-px' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
        >
          Assignments
        </button>
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition ${activeTab === 'dashboard' ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 border border-b-0 border-slate-200 dark:border-slate-700 -mb-px' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
        >
          Collector Dashboard
        </button>
      </div>

      {activeTab === 'assignments' ? (
        <div className="space-y-4">
          {/* Sub-tabs */}
          <div className="flex gap-1">
            <button
              onClick={() => setAssignmentsSubTab('expiring')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${assignmentsSubTab === 'expiring' ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
            >
              Expiring Clients
            </button>
            <button
              onClick={() => setAssignmentsSubTab('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${assignmentsSubTab === 'all' ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
            >
              All Assignments
            </button>
          </div>

          {assignmentsSubTab === 'expiring' ? (
            <ExpiringClientsView
              clients={filteredExpiringClients}
              loading={expLoading}
              stats={expStats}
              search={expSearch}
              setSearch={setExpSearch}
              filterStatus={expFilterStatus}
              setFilterStatus={setExpFilterStatus}
              filterCollector={expFilterCollector}
              setFilterCollector={setExpFilterCollector}
              filterAddress={expFilterAddress}
              setFilterAddress={setFilterAddress}
              collectors={collectors}
              addresses={addresses}
              selectedClientIds={selectedClientIds}
              toggleClient={toggleClient}
              toggleAllFiltered={toggleAllFiltered}
              allFilteredSelected={allFilteredSelected}
              onAssign={handleSingleAssign}
              onBatchAssign={handleBatchAssignSelected}
              onRefresh={fetchExpiringClients}
            />
          ) : (
            <AssignmentsTab
              assignments={assignments}
              loading={loading}
              search={search}
              setSearch={setSearch}
              filterCollector={filterCollector}
              setFilterCollector={setFilterCollector}
              filterAddress={filterAddress}
              setFilterAddress={setFilterAddress}
              filterStatus={filterStatus}
              setFilterStatus={setFilterStatus}
              collectors={collectors}
              addresses={addresses}
              stats={stats}
              selectedRouter={selectedRouter}
              onNew={() => { setEditingAssignment(null); setShowForm(true); }}
              onEdit={(a) => { setEditingAssignment(a); setShowForm(true); }}
              onDelete={handleDelete}
              onBatch={() => setShowBatch(true)}
              fetchAssignments={fetchAssignments}
            />
          )}
        </div>
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

      {/* Create/Edit Assignment Modal */}
      {showForm && (
        <AssignmentFormModal
          assignment={editingAssignment}
          collectors={collectors}
          selectedRouter={selectedRouter}
          onClose={() => { setShowForm(false); setEditingAssignment(null); }}
          onSaved={() => { setShowForm(false); setEditingAssignment(null); fetchAssignments(); fetchExpiringClients(); }}
        />
      )}

      {/* Batch Assignment Modal (address-based) */}
      {showBatch && (
        <BatchAssignModal
          collectors={collectors}
          addressFilter={filterAddress}
          selectedRouter={selectedRouter}
          onClose={() => setShowBatch(false)}
          onSaved={() => { setShowBatch(false); fetchAssignments(); fetchExpiringClients(); }}
        />
      )}

      {/* Single Assign from Expiring Client */}
      {showAssignModal && assignTarget && (
        <ExpiringClientAssignModal
          client={assignTarget}
          collectors={collectors}
          selectedRouter={selectedRouter}
          onClose={() => { setShowAssignModal(false); setAssignTarget(null); }}
          onSaved={() => { setShowAssignModal(false); setAssignTarget(null); fetchExpiringClients(); fetchAssignments(); }}
        />
      )}

      {/* Batch Assign from selected expiring clients */}
      {showBatchAssignModal && (
        <BatchExpiringAssignModal
          selectedClients={filteredExpiringClients.filter(c => selectedClientIds.has(`${c.clientType}-${c.id}`))}
          collectors={collectors}
          selectedRouter={selectedRouter}
          onClose={() => setShowBatchAssignModal(false)}
          onSaved={() => { setShowBatchAssignModal(false); setSelectedClientIds(new Set()); fetchExpiringClients(); fetchAssignments(); }}
        />
      )}
    </div>
  );
};

// ─── Expiring Clients View ───────────────────────────────────────────────────
const ExpiringClientsView: React.FC<{
  clients: ExpiringClient[];
  loading: boolean;
  stats: { total: number; expired: number; expiring: number; assigned: number };
  search: string; setSearch: (v: string) => void;
  filterStatus: string; setFilterStatus: (v: string) => void;
  filterCollector: string; setFilterCollector: (v: string) => void;
  filterAddress: string; setFilterAddress: (v: string) => void;
  collectors: Collector[];
  addresses: string[];
  selectedClientIds: Set<string>;
  toggleClient: (id: string) => void;
  toggleAllFiltered: () => void;
  allFilteredSelected: boolean;
  onAssign: (client: ExpiringClient) => void;
  onBatchAssign: () => void;
  onRefresh: () => void;
}> = ({ clients, loading, stats, search, setSearch, filterStatus, setFilterStatus, filterCollector, setFilterCollector, filterAddress, setFilterAddress, collectors, addresses, selectedClientIds, toggleClient, toggleAllFiltered, allFilteredSelected, onAssign, onBatchAssign, onRefresh }) => {
  const inputCls = 'px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500';
  return (
    <div className="space-y-4">
      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Expiring', value: stats.total, color: 'text-slate-800 dark:text-slate-200' },
          { label: 'Expired', value: stats.expired, color: 'text-red-600 dark:text-red-400' },
          { label: 'Expiring Soon', value: stats.expiring, color: 'text-amber-600 dark:text-amber-400' },
          { label: 'Assigned', value: stats.assigned, color: 'text-green-600 dark:text-green-400' },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search name, address, account..."
          className={`${inputCls} w-64`}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className={inputCls} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="Expired">Expired</option>
          <option value="Expiring">Expiring</option>
          <option value="Assigned">Assigned</option>
          <option value="Unassigned">Unassigned</option>
        </select>
        <select className={inputCls} value={filterCollector} onChange={e => setFilterCollector(e.target.value)}>
          <option value="">All Collectors</option>
          {collectors.map(c => <option key={c.id} value={c.id}>{c.username}</option>)}
        </select>
        <select className={inputCls} value={filterAddress} onChange={e => setFilterAddress(e.target.value)}>
          <option value="">All Addresses</option>
          {addresses.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="flex-1" />
        {selectedClientIds.size > 0 && (
          <button onClick={onBatchAssign} className="flex items-center gap-1 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm font-medium">
            Assign Selected ({selectedClientIds.size})
          </button>
        )}
        <button onClick={onRefresh} className="flex items-center gap-1 px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 text-sm font-medium">
          ↻ Refresh
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-slate-500">Loading expiring clients...</div>
      ) : clients.length === 0 ? (
        <div className="text-center py-12 text-slate-500 dark:text-slate-400">No expiring or expired clients found for this month.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-3 py-3 text-center">
                  <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} className="rounded" />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Client Name</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Account #</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Address</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Plan</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Due Date</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Collector</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {clients.map(c => {
                const key = `${c.clientType}-${c.id}`;
                return (
                  <tr key={key} className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition ${selectedClientIds.has(key) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                    <td className="px-3 py-3 text-center">
                      <input type="checkbox" checked={selectedClientIds.has(key)} onChange={() => toggleClient(key)} className="rounded" />
                    </td>
                    <td className="px-4 py-3 text-slate-800 dark:text-slate-200 font-medium">{c.fullName || c.username || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.clientType === 'pppoe' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400' : 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400'}`}>
                        {c.clientType === 'pppoe' ? 'PPPoE' : 'DHCP'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs font-mono">{c.accountNumber || '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">{c.address || '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">{c.planName || '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs font-mono">{formatDate(c.dueDate)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.expirationStatus === 'Expired' ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400' : 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400'}`}>
                        {c.expirationStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300 text-xs">{c.assigned_collector_name || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => onAssign(c)} className="px-3 py-1 text-xs bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 rounded hover:bg-blue-200 font-medium">
                        {c.assignmentId ? 'Reassign' : 'Assign'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── Assignments Tab ─────────────────────────────────────────────────────────
const AssignmentsTab: React.FC<{
  assignments: CollectorAssignment[];
  loading: boolean;
  search: string; setSearch: (v: string) => void;
  filterCollector: string; setFilterCollector: (v: string) => void;
  filterAddress: string; setFilterAddress: (v: string) => void;
  filterStatus: string; setFilterStatus: (v: string) => void;
  collectors: Collector[];
  addresses: string[];
  stats: { total: number; active: number; completed: number; revoked: number };
  selectedRouter: string;
  onNew: () => void;
  onEdit: (a: CollectorAssignment) => void;
  onDelete: (id: string) => void;
  onBatch: () => void;
  fetchAssignments: () => void;
}> = ({ assignments, loading, search, setSearch, filterCollector, setFilterCollector, filterAddress, setFilterAddress, filterStatus, setFilterStatus, collectors, addresses, stats, onNew, onEdit, onDelete, onBatch }) => (
  <div className="space-y-4">
    {/* Stats cards */}
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {[
        { label: 'Total Assigned', value: stats.total, color: 'text-slate-800 dark:text-slate-200' },
        { label: 'Active', value: stats.active, color: 'text-green-600 dark:text-green-400' },
        { label: 'Completed', value: stats.completed, color: 'text-blue-600 dark:text-blue-400' },
        { label: 'Revoked', value: stats.revoked, color: 'text-red-600 dark:text-red-400' },
      ].map(s => (
        <div key={s.label} className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">{s.label}</p>
          <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
        </div>
      ))}
    </div>

    {/* Filter bar */}
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="text"
        placeholder="Search customer, address, username..."
        className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500 w-64"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <select className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" value={filterCollector} onChange={e => setFilterCollector(e.target.value)}>
        <option value="">All Collectors</option>
        {collectors.map(c => <option key={c.id} value={c.id}>{c.username}</option>)}
      </select>
      <select className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" value={filterAddress} onChange={e => setFilterAddress(e.target.value)}>
        <option value="">All Addresses</option>
        {addresses.map(a => <option key={a} value={a}>{a}</option>)}
      </select>
      <select className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
        <option value="">All Statuses</option>
        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <div className="flex-1" />
      {filterAddress && (
        <button onClick={onBatch} className="flex items-center gap-1 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm font-medium">
          Batch Assign
        </button>
      )}
      <button onClick={onNew} className="flex items-center gap-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium">
        + New Assignment
      </button>
    </div>

    {/* Table */}
    {loading ? (
      <div className="text-center py-12 text-slate-500">Loading assignments...</div>
    ) : assignments.length === 0 ? (
      <div className="text-center py-12 text-slate-500 dark:text-slate-400">No assignments found. Click "New Assignment" to create one.</div>
    ) : (
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Customer</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Account #</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Address</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Plan</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Collector</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Assigned</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {assignments.map(a => (
              <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                <td className="px-4 py-3 text-slate-800 dark:text-slate-200 font-medium">{a.customer_name}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs font-mono">{a.customer_account_number || '—'}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">{a.address || '—'}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">{a.plan_name || '—'}</td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{a.assigned_collector_name || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(a.status)}`}>{a.status}</span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{formatDate(a.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => onEdit(a)} title="Edit" className="px-2 py-1 text-xs bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 rounded hover:bg-amber-200">Edit</button>
                    <button onClick={() => onDelete(a.id)} title="Delete" className="px-2 py-1 text-xs bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400 rounded hover:bg-red-200">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

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
                      <td className="px-4 py-3 text-xs text-slate-500">{c.paymentMethod || '—'}</td>
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

// ─── Assignment Form Modal ───────────────────────────────────────────────────
const AssignmentFormModal: React.FC<{
  assignment: CollectorAssignment | null;
  collectors: Collector[];
  selectedRouter: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ assignment, collectors, selectedRouter, onClose, onSaved }) => {
  const [form, setForm] = useState(() => {
    if (assignment) {
      return {
        customer_id: assignment.customer_id || '',
        customer_name: assignment.customer_name,
        customer_username: assignment.customer_username,
        customer_account_number: assignment.customer_account_number,
        address: assignment.address,
        plan_name: assignment.plan_name,
        assigned_collector_id: assignment.assigned_collector_id,
        notes: assignment.notes || '',
        status: assignment.status,
      };
    }
    return {
      customer_id: '', customer_name: '', customer_username: '', customer_account_number: '',
      address: '', plan_name: '', assigned_collector_id: '', notes: '', status: 'Active',
    };
  });
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [custSearch, setCustSearch] = useState('');
  const [custLoading, setCustLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchCustomers = useCallback(async (q?: string) => {
    setCustLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedRouter) params.set('routerId', selectedRouter);
      if (q) params.set('search', q);
      const res = await fetch(`/api/db/customcustomers?${params}`, { headers: authHeaders() });
      if (res.ok) { const data = await res.json(); setCustomers(Array.isArray(data) ? data.slice(0, 50) : []); }
    } catch (e) { console.error(e); }
    setCustLoading(false);
  }, [selectedRouter]);

  useEffect(() => { if (!assignment) fetchCustomers(); }, [fetchCustomers, assignment]);

  const selectCustomer = (c: Customer) => {
    setForm(f => ({
      ...f,
      customer_id: c.id || '',
      customer_name: c.customerName || c.customer_name || '',
      customer_username: c.username || c.customer_username || '',
      customer_account_number: c.accountNumber || c.account_number || '',
      address: c.address || '',
      plan_name: c.planName || c.plan_name || f.plan_name,
    }));
    setCustSearch('');
  };

  const handleSubmit = async () => {
    if (!form.customer_name.trim()) { alert('Customer name is required'); return; }
    if (!form.assigned_collector_id) { alert('Please select a collector'); return; }
    setSaving(true);
    try {
      const collector = collectors.find(c => c.id === form.assigned_collector_id);
      const body: any = {
        router_id: selectedRouter,
        customer_id: form.customer_id,
        customer_name: form.customer_name,
        customer_username: form.customer_username,
        customer_account_number: form.customer_account_number,
        address: form.address,
        plan_name: form.plan_name,
        assigned_collector_id: form.assigned_collector_id,
        assigned_collector_name: collector?.username || '',
        notes: form.notes,
      };
      if (assignment) {
        body.status = form.status;
        const res = await fetch(`/api/collector-assignments/${assignment.id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
        if (!res.ok) throw new Error('Failed to update');
      } else {
        const res = await fetch('/api/collector-assignments', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
        if (!res.ok) throw new Error('Failed to create');
      }
      onSaved();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500';
  const labelCls = 'block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-white">{assignment ? 'Edit Assignment' : 'New Assignment'}</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl">&times;</button>
        </div>
        <div className="flex-1 overflow-auto p-5 space-y-4">
          {!assignment && (
            <div>
              <label className={labelCls}>Select Customer</label>
              <input className={inputCls} placeholder="Search customers..." value={custSearch} onChange={e => { setCustSearch(e.target.value); fetchCustomers(e.target.value); }} />
              {custLoading && <p className="text-xs text-slate-400 mt-1">Searching...</p>}
              {custSearch && customers.length > 0 && (
                <div className="mt-1 max-h-40 overflow-auto border border-slate-200 dark:border-slate-600 rounded-lg">
                  {customers.map((c, i) => (
                    <button key={c.id || i} type="button" onClick={() => selectCustomer(c)} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-700 last:border-b-0">
                      <span className="font-medium">{c.customerName || c.customer_name || c.username || 'Unknown'}</span>
                      <span className="text-xs text-slate-500 ml-2">{c.accountNumber || c.account_number || ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className={labelCls}>Customer Name *</label><input className={inputCls} value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} /></div>
            <div><label className={labelCls}>Username</label><input className={inputCls} value={form.customer_username} onChange={e => setForm({ ...form, customer_username: e.target.value })} /></div>
            <div><label className={labelCls}>Account Number</label><input className={inputCls} value={form.customer_account_number} onChange={e => setForm({ ...form, customer_account_number: e.target.value })} /></div>
            <div><label className={labelCls}>Address</label><input className={inputCls} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
            <div><label className={labelCls}>Plan</label><input className={inputCls} value={form.plan_name} onChange={e => setForm({ ...form, plan_name: e.target.value })} /></div>
            <div><label className={labelCls}>Assigned Collector *</label>
              <select className={inputCls} value={form.assigned_collector_id} onChange={e => setForm({ ...form, assigned_collector_id: e.target.value })}>
                <option value="">Select Collector</option>
                {collectors.map(c => <option key={c.id} value={c.id}>{c.username}</option>)}
              </select>
            </div>
            {assignment && (<div><label className={labelCls}>Status</label>
              <select className={inputCls} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>)}
          </div>
          <div><label className={labelCls}>Notes</label><textarea rows={3} className={inputCls} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-slate-200 dark:border-slate-700">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">{saving ? 'Saving...' : assignment ? 'Update Assignment' : 'Create Assignment'}</button>
        </div>
      </div>
    </div>
  );
};

// ─── Expiring Client Assign Modal (single) ───────────────────────────────────
const ExpiringClientAssignModal: React.FC<{
  client: ExpiringClient;
  collectors: Collector[];
  selectedRouter: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ client, collectors, selectedRouter, onClose, onSaved }) => {
  const [collectorId, setCollectorId] = useState(client.assigned_collector_id || '');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!collectorId) { alert('Please select a collector'); return; }
    const collector = collectors.find(c => c.id === collectorId);
    setSaving(true);
    try {
      const body = {
        router_id: client.routerId || selectedRouter,
        customer_id: client.id,
        customer_name: client.fullName || '',
        customer_username: client.username || '',
        customer_account_number: client.accountNumber || '',
        address: client.address || '',
        plan_name: client.planName || '',
        assigned_collector_id: collectorId,
        assigned_collector_name: collector?.username || '',
        notes,
      };
      const res = await fetch('/api/collector-assignments', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
      if (!res.ok) throw new Error('Failed to assign collector');
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
          <h3 className="text-lg font-semibold text-slate-800 dark:text-white">{client.assignmentId ? 'Reassign' : 'Assign'} Collector</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl">&times;</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3 space-y-1 text-sm">
            <p className="font-medium text-slate-800 dark:text-slate-200">{client.fullName || client.username}</p>
            <p className="text-xs text-slate-500">{client.accountNumber || '—'} &middot; {client.address || '—'}</p>
            <p className="text-xs text-slate-500">Due: {formatDate(client.dueDate)} &middot; <span className={client.expirationStatus === 'Expired' ? 'text-red-600 dark:text-red-400 font-medium' : 'text-amber-600 dark:text-amber-400 font-medium'}>{client.expirationStatus}</span></p>
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
          <button onClick={handleSubmit} disabled={saving} className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">{saving ? 'Assigning...' : 'Assign Collector'}</button>
        </div>
      </div>
    </div>
  );
};

// ─── Batch Expiring Assign Modal ─────────────────────────────────────────────
const BatchExpiringAssignModal: React.FC<{
  selectedClients: ExpiringClient[];
  collectors: Collector[];
  selectedRouter: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ selectedClients, collectors, selectedRouter, onClose, onSaved }) => {
  const [collectorId, setCollectorId] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!collectorId) { alert('Please select a collector'); return; }
    if (selectedClients.length === 0) { alert('No clients selected'); return; }
    const collector = collectors.find(c => c.id === collectorId);
    setSaving(true);
    try {
      // Create assignments one by one
      let success = 0;
      for (const client of selectedClients) {
        const body = {
          router_id: client.routerId || selectedRouter,
          customer_id: client.id,
          customer_name: client.fullName || '',
          customer_username: client.username || '',
          customer_account_number: client.accountNumber || '',
          address: client.address || '',
          plan_name: client.planName || '',
          assigned_collector_id: collectorId,
          assigned_collector_name: collector?.username || '',
          notes: '',
        };
        const res = await fetch('/api/collector-assignments', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
        if (res.ok) success++;
      }
      alert(`Assigned ${success} of ${selectedClients.length} clients.`);
      onSaved();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-white">Batch Assign ({selectedClients.length} clients)</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl">&times;</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="max-h-32 overflow-auto text-xs text-slate-600 dark:text-slate-400 space-y-1">
            {selectedClients.map(c => (
              <p key={`${c.clientType}-${c.id}`}>{c.fullName || c.username} — {formatDate(c.dueDate)}</p>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Select Collector *</label>
            <select
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500"
              value={collectorId}
              onChange={e => setCollectorId(e.target.value)}
            >
              <option value="">Select Collector</option>
              {collectors.map(c => <option key={c.id} value={c.id}>{c.username}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-slate-200 dark:border-slate-700">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="px-5 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 font-medium">{saving ? 'Assigning...' : `Assign ${selectedClients.length} Clients`}</button>
        </div>
      </div>
    </div>
  );
};

// ─── Batch Assign Modal (address-based, original) ────────────────────────────
const BatchAssignModal: React.FC<{
  collectors: Collector[];
  addressFilter: string;
  selectedRouter: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ collectors, addressFilter, selectedRouter, onClose, onSaved }) => {
  const [collectorId, setCollectorId] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!collectorId) { alert('Please select a collector'); return; }
    const collector = collectors.find(c => c.id === collectorId);
    setSaving(true);
    try {
      const res = await fetch('/api/collector-assignments/batch', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          collector_id: collectorId,
          collector_name: collector?.username || '',
          address_filter: addressFilter,
          router_id: selectedRouter,
        }),
      });
      if (!res.ok) throw new Error('Batch assignment failed');
      const data = await res.json();
      alert(`Batch assigned ${data.assigned || data.count || 0} customers.`);
      onSaved();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-white">Batch Assign</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl">&times;</button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Assign all customers at address <strong className="text-slate-800 dark:text-slate-200">{addressFilter}</strong> to a collector.
          </p>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Select Collector *</label>
            <select
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500"
              value={collectorId}
              onChange={e => setCollectorId(e.target.value)}
            >
              <option value="">Select Collector</option>
              {collectors.map(c => <option key={c.id} value={c.id}>{c.username}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-slate-200 dark:border-slate-700">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="px-5 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 font-medium">{saving ? 'Assigning...' : 'Batch Assign'}</button>
        </div>
      </div>
    </div>
  );
};

export default Collectibles;
