import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { RouterConfigWithId, Customer, BillingPlanWithId } from '../types.ts';
import { useCustomers } from '../hooks/useCustomers.ts';
import { useBillingPlans } from '../hooks/useBillingPlans.ts';
import { useCompanySettings } from '../hooks/useCompanySettings.ts';
import { Loader } from './Loader.tsx';
import { RouterIcon } from '../constants.tsx';

// ─── Types ───────────────────────────────────────────────────────────────────
type TemplateType = 'due_reminder' | 'payment_confirm' | 'disconnection' | 'custom';

interface SmsTemplate {
  id: string;
  name: string;
  type: TemplateType;
  body: string;
  routerId: string;
  createdAt: string;
}

interface SmsLogEntry {
  id: string;
  templateId: string | null;
  clientId: string | null;
  clientPhone: string;
  messageText: string;
  status: string;
  errorMessage: string | null;
  routerId: string;
  sentAt: string;
  createdAt: string;
}

interface SmsLogPayload {
  templateId: string | null;
  clientId: string | null;
  clientPhone: string;
  messageText: string;
  status: 'SENT' | 'FAILED';
  errorMessage: string | null;
  routerId: string;
  sentAt: string;
}

interface SendItem {
  customer: Customer;
  message: string;
  templateId: string | null;
}

interface SendProgress {
  current: number;
  total: number;
  currentName: string;
}

interface RunSummary {
  sent: number;
  failed: number;
  skipped: string[];
  cancelled: boolean;
}

const TEMPLATE_TYPE_LABELS: Record<TemplateType, string> = {
  due_reminder: 'Due Reminder',
  payment_confirm: 'Payment Confirmation',
  disconnection: 'Disconnection Notice',
  custom: 'Custom',
};

const PLACEHOLDERS = ['{clientName}', '{dueDate}', '{planName}', '{amount}', '{companyName}'];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('authToken')}`,
});

const getNativeSms = (): any => (window as any).Capacitor?.Plugins?.NativeSms;

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

const formatDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

// Days between today and the customer's due date (negative = overdue). null if no due date.
const daysUntilDue = (customer: Customer): number | null => {
  if (!customer.dueDate) return null;
  const due = new Date(customer.dueDate);
  if (isNaN(due.getTime())) return null;
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  return Math.round((dueDay.getTime() - startOfToday().getTime()) / (1000 * 60 * 60 * 24));
};

const personalizeMessage = (
  body: string,
  customer: Customer,
  plans: BillingPlanWithId[],
  companyName: string
): string => {
  const plan = plans.find(p => p.name === customer.planName);
  return body
    .replace(/\{clientName\}/g, customer.fullName || customer.username || '')
    .replace(/\{dueDate\}/g, customer.dueDate ? formatDate(customer.dueDate) : '')
    .replace(/\{planName\}/g, customer.planName || '')
    .replace(/\{amount\}/g, plan ? String(plan.price) : '')
    .replace(/\{companyName\}/g, companyName || '');
};

// ─── Status Badge ────────────────────────────────────────────────────────────
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const s = (status || '').toUpperCase();
  const cls =
    s === 'SENT'
      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
      : s === 'FAILED'
      ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
      : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
  return <span className={`px-2 py-1 text-xs font-semibold rounded-full ${cls}`}>{s || 'QUEUED'}</span>;
};

// ─── Main Component ──────────────────────────────────────────────────────────
export const SmsManager = ({ selectedRouter }: { selectedRouter: RouterConfigWithId | null }) => {
  const routerId = selectedRouter?.id || null;
  const [activeTab, setActiveTab] = useState<'reminders' | 'broadcast' | 'templates' | 'logs'>('reminders');

  const { customers, isLoading: isLoadingCustomers } = useCustomers(routerId);
  const { plans } = useBillingPlans(routerId);
  const { settings: companySettings } = useCompanySettings();
  const companyName = companySettings?.companyName || '';

  // ── Templates (shared by all tabs) ──
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  const fetchTemplates = useCallback(async () => {
    if (!routerId) { setTemplates([]); return; }
    setTemplatesLoading(true);
    try {
      const res = await fetch(`/api/sms/templates?routerId=${encodeURIComponent(routerId)}`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setTemplates(Array.isArray(data) ? data : []);
      }
    } catch (e) { console.error('Failed to fetch SMS templates:', e); }
    setTemplatesLoading(false);
  }, [routerId]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  // ── Native SMS availability ──
  const smsAvailable = useMemo(() => !!getNativeSms(), []);

  // ── Send engine ──
  const [progress, setProgress] = useState<SendProgress | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [logsRefreshKey, setLogsRefreshKey] = useState(0);
  const cancelRef = useRef(false);
  const isSending = progress !== null;

  const sendBatch = useCallback(async (items: SendItem[]) => {
    if (!routerId) return;
    const sms = getNativeSms();
    if (!sms) {
      alert('SMS sending is only available in the Admin mobile app.');
      return;
    }

    // Skip customers without a contact number and report them afterwards
    const skipped = items
      .filter(i => !i.customer.contactNumber)
      .map(i => i.customer.fullName || i.customer.username || 'Unknown');
    const sendable = items.filter(i => !!i.customer.contactNumber);

    if (sendable.length === 0) {
      alert(`No recipients with a contact number.${skipped.length ? ` Skipped: ${skipped.join(', ')}` : ''}`);
      return;
    }

    if (sendable.length > 25) {
      const ok = window.confirm(
        `You are about to send ${sendable.length} SMS messages. Android limits apps to roughly 30 SMS per 30 minutes; messages beyond that limit may be blocked or require manual confirmation. Continue?`
      );
      if (!ok) return;
    }

    // Permission check / request
    try {
      let perm = await sms.checkPermission();
      if (!perm?.granted) {
        perm = await sms.requestPermission();
      }
      if (!perm?.granted) {
        alert('SMS permission was denied. Please allow SMS permission in the app settings.');
        return;
      }
    } catch (e) {
      console.error('SMS permission check failed:', e);
      alert('Could not verify SMS permission.');
      return;
    }

    cancelRef.current = false;
    setSummary(null);
    const results: SmsLogPayload[] = [];
    let sentCount = 0;
    let failedCount = 0;
    let cancelled = false;

    // Keep the screen awake during the batch (best-effort, non-fatal)
    if (sms.setKeepScreenOn) {
      try { await sms.setKeepScreenOn({ enabled: true }); } catch { /* ignore */ }
    }

    try {
      for (let i = 0; i < sendable.length; i++) {
        if (cancelRef.current) { cancelled = true; break; }
        const item = sendable[i];
        const name = item.customer.fullName || item.customer.username || '';
        setProgress({ current: i + 1, total: sendable.length, currentName: name });

        let status: 'SENT' | 'FAILED' = 'FAILED';
        let errorMessage: string | null = null;
        try {
          const res = await sms.send({ phone: item.customer.contactNumber, message: item.message });
          if (res?.success) {
            status = 'SENT';
            sentCount++;
          } else {
            errorMessage = res?.error || 'Unknown send failure';
            failedCount++;
          }
        } catch (e: any) {
          errorMessage = e?.message || 'Send threw an exception';
          failedCount++;
        }

        results.push({
          templateId: item.templateId,
          clientId: item.customer.id || null,
          clientPhone: item.customer.contactNumber || '',
          messageText: item.message,
          status,
          errorMessage,
          routerId,
          sentAt: new Date().toISOString(),
        });

        // 2s spacing between sends (skip after the last one)
        if (i < sendable.length - 1 && !cancelRef.current) {
          await delay(2000);
        }
      }
    } finally {
      // Always release the wake flag, even on cancel or unexpected errors
      if (sms.setKeepScreenOn) {
        try { await sms.setKeepScreenOn({ enabled: false }); } catch { /* ignore */ }
      }
    }

    setProgress(null);

    // Persist the batch results, even on cancel
    if (results.length > 0) {
      try {
        const res = await fetch('/api/sms/logs', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(results),
        });
        if (!res.ok) console.error('Failed to save SMS logs:', res.statusText);
      } catch (e) { console.error('Failed to save SMS logs:', e); }
    }
    setLogsRefreshKey(k => k + 1);
    setSummary({ sent: sentCount, failed: failedCount, skipped, cancelled });
  }, [routerId]);

  if (!selectedRouter) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
        <RouterIcon className="w-16 h-16 text-slate-400 dark:text-slate-600 mb-4" />
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">SMS Management</h2>
        <p className="mt-2 text-slate-500 dark:text-slate-400">Please select a router to manage SMS.</p>
      </div>
    );
  }

  const tabs: { id: typeof activeTab; label: string }[] = [
    { id: 'reminders', label: 'Due Reminders' },
    { id: 'broadcast', label: 'Broadcast / Custom' },
    { id: 'templates', label: 'Templates' },
    { id: 'logs', label: 'Logs' },
  ];

  return (
    <div className="space-y-4">
      {/* Native availability notice */}
      {!smsAvailable && (
        <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-sm text-yellow-800 dark:text-yellow-300">
          SMS sending is only available in the Admin mobile app
        </div>
      )}

      {/* Last run summary */}
      {summary && (
        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-800 dark:text-blue-300 flex items-start justify-between gap-3">
          <div>
            <span className="font-semibold">{summary.cancelled ? 'Batch cancelled.' : 'Batch finished.'}</span>{' '}
            Sent: {summary.sent} · Failed: {summary.failed}
            {summary.skipped.length > 0 && (
              <span> · Skipped (no contact number): {summary.skipped.join(', ')}</span>
            )}
          </div>
          <button onClick={() => setSummary(null)} className="text-blue-500 hover:text-blue-700 dark:hover:text-blue-200 text-lg leading-none">&times;</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition whitespace-nowrap ${activeTab === tab.id ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 border border-b-0 border-slate-200 dark:border-slate-700 -mb-px' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'reminders' && (
        <RemindersTab
          customers={customers}
          isLoadingCustomers={isLoadingCustomers}
          templates={templates}
          plans={plans}
          companyName={companyName}
          smsAvailable={smsAvailable}
          isSending={isSending}
          onSend={sendBatch}
        />
      )}
      {activeTab === 'broadcast' && (
        <BroadcastTab
          customers={customers}
          isLoadingCustomers={isLoadingCustomers}
          templates={templates}
          plans={plans}
          companyName={companyName}
          smsAvailable={smsAvailable}
          isSending={isSending}
          onSend={sendBatch}
        />
      )}
      {activeTab === 'templates' && (
        <TemplatesTab
          templates={templates}
          loading={templatesLoading}
          routerId={selectedRouter.id}
          companyName={companyName}
          onChanged={fetchTemplates}
        />
      )}
      {activeTab === 'logs' && (
        <LogsTab routerId={selectedRouter.id} refreshKey={logsRefreshKey} />
      )}

      {/* Progress modal */}
      {progress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-semibold text-slate-800 dark:text-white">Sending SMS...</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Sending {progress.current} of {progress.total}
              {progress.currentName && <span className="block text-xs text-slate-500 dark:text-slate-400 mt-1">Current: {progress.currentName}</span>}
            </p>
            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3 overflow-hidden">
              <div
                className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                style={{ width: `${Math.round((progress.current / Math.max(1, progress.total)) * 100)}%` }}
              />
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => { cancelRef.current = true; }}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Message Preview Box ─────────────────────────────────────────────────────
const PreviewBox: React.FC<{ title: string; message: string }> = ({ title, message }) => (
  <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{title}</p>
    <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{message || '—'}</p>
    <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">{message.length} characters {message.length > 160 ? `(~${Math.ceil(message.length / 153)} SMS segments)` : '(1 SMS segment)'}</p>
  </div>
);

// ─── Due Reminders Tab ───────────────────────────────────────────────────────
type DueWindow = 'overdue' | 'due1_3' | 'due4_7' | 'all_upcoming';

const RemindersTab: React.FC<{
  customers: Customer[];
  isLoadingCustomers: boolean;
  templates: SmsTemplate[];
  plans: BillingPlanWithId[];
  companyName: string;
  smsAvailable: boolean;
  isSending: boolean;
  onSend: (items: SendItem[]) => void;
}> = ({ customers, isLoadingCustomers, templates, plans, companyName, smsAvailable, isSending, onSend }) => {
  const [dueWindow, setDueWindow] = useState<DueWindow>('overdue');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [templateId, setTemplateId] = useState('');

  // Default to the first due_reminder template once templates load
  useEffect(() => {
    if (!templateId && templates.length > 0) {
      const dueTpl = templates.find(t => t.type === 'due_reminder') || templates[0];
      setTemplateId(dueTpl.id);
    }
  }, [templates, templateId]);

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      const days = daysUntilDue(c);
      if (days === null) return false;
      switch (dueWindow) {
        case 'overdue': return days < 0;
        case 'due1_3': return days >= 0 && days <= 3;
        case 'due4_7': return days >= 4 && days <= 7;
        case 'all_upcoming': return days >= 0;
        default: return false;
      }
    });
  }, [customers, dueWindow]);

  // Prune selections no longer visible under the active filter
  useEffect(() => {
    setSelectedIds(prev => {
      const visible = new Set(filteredCustomers.map(c => c.id));
      const next = new Set([...prev].filter(id => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredCustomers]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const allSelected = filteredCustomers.length > 0 && filteredCustomers.every(c => selectedIds.has(c.id));
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(filteredCustomers.map(c => c.id)));
  };

  const selectedTemplate = templates.find(t => t.id === templateId) || null;
  const selectedCustomers = filteredCustomers.filter(c => selectedIds.has(c.id));
  const firstSelected = selectedCustomers[0] || null;

  const preview = selectedTemplate && firstSelected
    ? personalizeMessage(selectedTemplate.body, firstSelected, plans, companyName)
    : '';

  const handleSend = () => {
    if (!selectedTemplate || selectedCustomers.length === 0) return;
    onSend(selectedCustomers.map(c => ({
      customer: c,
      message: personalizeMessage(selectedTemplate.body, c, plans, companyName),
      templateId: selectedTemplate.id,
    })));
  };

  const windows: { id: DueWindow; label: string }[] = [
    { id: 'overdue', label: 'Overdue' },
    { id: 'due1_3', label: 'Due in 1–3 days' },
    { id: 'due4_7', label: 'Due in 4–7 days' },
    { id: 'all_upcoming', label: 'All upcoming' },
  ];

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-4">
        <div className="flex gap-2 flex-wrap">
          {windows.map(w => (
            <button
              key={w.id}
              onClick={() => setDueWindow(w.id)}
              className={`px-4 py-2 text-sm rounded-md font-medium transition-colors ${
                dueWindow === w.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col md:flex-row gap-4 md:items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Template</label>
            <select
              value={templateId}
              onChange={e => setTemplateId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select a template...</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({TEMPLATE_TYPE_LABELS[t.type] || t.type})</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleSend}
            disabled={!smsAvailable || isSending || selectedCustomers.length === 0 || !selectedTemplate}
            className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send Reminders ({selectedCustomers.length})
          </button>
        </div>
        {templates.length === 0 && (
          <p className="text-xs text-yellow-600 dark:text-yellow-400">No templates yet — create one in the Templates tab.</p>
        )}
        {preview && <PreviewBox title={`Preview for ${firstSelected?.fullName || firstSelected?.username}`} message={preview} />}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
        {isLoadingCustomers ? (
          <div className="flex items-center justify-center p-12"><Loader /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="rounded border-slate-300" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Contact</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Plan</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Due Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {filteredCustomers.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">No customers in this window</td></tr>
                ) : filteredCustomers.map(c => {
                  const days = daysUntilDue(c);
                  return (
                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelect(c.id)} className="rounded border-slate-300" />
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{c.fullName || c.username}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {c.contactNumber || <span className="text-red-500 dark:text-red-400 text-xs italic">No number</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{c.planName || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{formatDate(c.dueDate)}</td>
                      <td className="px-4 py-3">
                        <span className={`font-medium ${days !== null && days < 0 ? 'text-red-600 dark:text-red-400' : days !== null && days <= 3 ? 'text-orange-600 dark:text-orange-400' : 'text-slate-600 dark:text-slate-400'}`}>
                          {days === null ? '—' : days < 0 ? `${Math.abs(days)} overdue` : `${days} days`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Broadcast / Custom Tab ──────────────────────────────────────────────────
const BroadcastTab: React.FC<{
  customers: Customer[];
  isLoadingCustomers: boolean;
  templates: SmsTemplate[];
  plans: BillingPlanWithId[];
  companyName: string;
  smsAvailable: boolean;
  isSending: boolean;
  onSend: (items: SendItem[]) => void;
}> = ({ customers, isLoadingCustomers, templates, plans, companyName, smsAvailable, isSending, onSend }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'custom' | 'template'>('custom');
  const [freeText, setFreeText] = useState('');
  const [templateId, setTemplateId] = useState('');

  const filteredCustomers = useMemo(() => {
    if (!searchTerm.trim()) return customers;
    const q = searchTerm.toLowerCase();
    return customers.filter(c =>
      (c.fullName || '').toLowerCase().includes(q) ||
      (c.username || '').toLowerCase().includes(q) ||
      (c.contactNumber || '').toLowerCase().includes(q) ||
      (c.planName || '').toLowerCase().includes(q)
    );
  }, [customers, searchTerm]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const allVisibleSelected = filteredCustomers.length > 0 && filteredCustomers.every(c => selectedIds.has(c.id));
  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filteredCustomers.forEach(c => next.delete(c.id));
      } else {
        filteredCustomers.forEach(c => next.add(c.id));
      }
      return next;
    });
  };

  const paymentConfirmTpl = templates.find(t => t.type === 'payment_confirm') || null;
  const disconnectionTpl = templates.find(t => t.type === 'disconnection') || null;

  const pickTemplate = (tpl: SmsTemplate | null) => {
    if (!tpl) return;
    setMode('template');
    setTemplateId(tpl.id);
  };

  const selectedTemplate = templates.find(t => t.id === templateId) || null;
  const messageBody = mode === 'custom' ? freeText : (selectedTemplate?.body || '');
  const selectedCustomers = customers.filter(c => selectedIds.has(c.id));
  const firstSelected = selectedCustomers[0] || null;
  const preview = messageBody && firstSelected
    ? personalizeMessage(messageBody, firstSelected, plans, companyName)
    : '';

  const canSend = smsAvailable && !isSending && selectedCustomers.length > 0 && messageBody.trim().length > 0;

  const handleSend = () => {
    if (!canSend) return;
    onSend(selectedCustomers.map(c => ({
      customer: c,
      message: personalizeMessage(messageBody, c, plans, companyName),
      templateId: mode === 'template' ? (selectedTemplate?.id || null) : null,
    })));
  };

  return (
    <div className="space-y-4">
      {/* Message source */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-4">
        <div className="flex gap-2 flex-wrap items-center">
          <button
            onClick={() => setMode('custom')}
            className={`px-4 py-2 text-sm rounded-md font-medium transition-colors ${mode === 'custom' ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
          >
            Free Text
          </button>
          <button
            onClick={() => setMode('template')}
            className={`px-4 py-2 text-sm rounded-md font-medium transition-colors ${mode === 'template' ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
          >
            From Template
          </button>
          <div className="flex-1" />
          <button
            onClick={() => pickTemplate(paymentConfirmTpl)}
            disabled={!paymentConfirmTpl}
            title={paymentConfirmTpl ? paymentConfirmTpl.name : 'No Payment Confirmation template found'}
            className="px-3 py-2 text-xs rounded-md font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Payment Confirmation
          </button>
          <button
            onClick={() => pickTemplate(disconnectionTpl)}
            disabled={!disconnectionTpl}
            title={disconnectionTpl ? disconnectionTpl.name : 'No Disconnection Notice template found'}
            className="px-3 py-2 text-xs rounded-md font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Disconnection Notice
          </button>
        </div>

        {mode === 'custom' ? (
          <textarea
            rows={4}
            value={freeText}
            onChange={e => setFreeText(e.target.value)}
            placeholder={`Type your message... Placeholders: ${PLACEHOLDERS.join(' ')}`}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500"
          />
        ) : (
          <select
            value={templateId}
            onChange={e => setTemplateId(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select a template...</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.name} ({TEMPLATE_TYPE_LABELS[t.type] || t.type})</option>
            ))}
          </select>
        )}

        {preview && <PreviewBox title={`Preview for ${firstSelected?.fullName || firstSelected?.username}`} message={preview} />}

        <div className="flex justify-end">
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send to {selectedCustomers.length} recipient{selectedCustomers.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>

      {/* Recipient picker */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search customers by name, number, or plan..."
            className="w-full px-4 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        {isLoadingCustomers ? (
          <div className="flex items-center justify-center p-12"><Loader /></div>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} className="rounded border-slate-300" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Contact</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Plan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {filteredCustomers.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">No customers found</td></tr>
                ) : filteredCustomers.map(c => (
                  <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelect(c.id)} className="rounded border-slate-300" />
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{c.fullName || c.username}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {c.contactNumber || <span className="text-red-500 dark:text-red-400 text-xs italic">No number</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{c.planName || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Templates Tab ───────────────────────────────────────────────────────────
const SAMPLE_CUSTOMER = {
  clientName: 'Juan Dela Cruz',
  dueDate: formatDate(new Date().toISOString()),
  planName: 'Fiber 100Mbps',
  amount: '999',
};

const TemplatesTab: React.FC<{
  templates: SmsTemplate[];
  loading: boolean;
  routerId: string;
  companyName: string;
  onChanged: () => void;
}> = ({ templates, loading, routerId, companyName, onChanged }) => {
  const [editing, setEditing] = useState<SmsTemplate | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'due_reminder' as TemplateType, body: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', type: 'due_reminder', body: '' });
    setIsCreating(true);
    setError(null);
  };

  const openEdit = (tpl: SmsTemplate) => {
    setEditing(tpl);
    setForm({ name: tpl.name, type: tpl.type, body: tpl.body });
    setIsCreating(true);
    setError(null);
  };

  const closeForm = () => {
    setIsCreating(false);
    setEditing(null);
    setError(null);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.body.trim()) {
      setError('Name and message body are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = { name: form.name.trim(), type: form.type, body: form.body, routerId };
      const res = editing
        ? await fetch(`/api/sms/templates/${editing.id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload) })
        : await fetch('/api/sms/templates', { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(`Failed to save template (${res.status})`);
      closeForm();
      onChanged();
    } catch (e: any) {
      setError(e.message || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (tpl: SmsTemplate) => {
    if (!window.confirm(`Delete template "${tpl.name}"?`)) return;
    try {
      const res = await fetch(`/api/sms/templates/${tpl.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to delete template (${res.status})`);
      onChanged();
    } catch (e: any) {
      alert(e.message || 'Failed to delete template');
    }
  };

  const samplePreview = form.body
    .replace(/\{clientName\}/g, SAMPLE_CUSTOMER.clientName)
    .replace(/\{dueDate\}/g, SAMPLE_CUSTOMER.dueDate)
    .replace(/\{planName\}/g, SAMPLE_CUSTOMER.planName)
    .replace(/\{amount\}/g, SAMPLE_CUSTOMER.amount)
    .replace(/\{companyName\}/g, companyName || 'Your Company');

  const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500';
  const labelCls = 'block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">Manage reusable SMS message templates.</p>
        <button
          onClick={openCreate}
          className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + New Template
        </button>
      </div>

      {/* Create / Edit form */}
      {isCreating && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-4">
          <h3 className="text-base font-semibold text-slate-800 dark:text-white">{editing ? 'Edit Template' : 'New Template'}</h3>
          {error && (
            <div className="p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-600 dark:text-red-400">{error}</div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Name *</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} placeholder="e.g. Monthly Due Reminder" />
            </div>
            <div>
              <label className={labelCls}>Type *</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as TemplateType }))} className={inputCls}>
                {(Object.keys(TEMPLATE_TYPE_LABELS) as TemplateType[]).map(t => (
                  <option key={t} value={t}>{TEMPLATE_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Message Body *</label>
            <textarea rows={4} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} className={inputCls} placeholder="Hi {clientName}, your {planName} bill of {amount} is due on {dueDate}. - {companyName}" />
            <div className="flex gap-1 flex-wrap mt-2">
              {PLACEHOLDERS.map(ph => (
                <button
                  key={ph}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, body: f.body + ph }))}
                  className="px-2 py-1 text-xs font-mono rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
                >
                  {ph}
                </button>
              ))}
            </div>
          </div>
          {form.body && <PreviewBox title="Live preview (sample data)" message={samplePreview} />}
          <div className="flex justify-end gap-2">
            <button onClick={closeForm} className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
              {saving ? 'Saving...' : editing ? 'Update Template' : 'Create Template'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center p-12"><Loader /></div>
        ) : templates.length === 0 ? (
          <div className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">No templates yet. Create your first template.</div>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {templates.map(tpl => (
              <li key={tpl.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-900 dark:text-slate-100">{tpl.name}</span>
                      <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                        {TEMPLATE_TYPE_LABELS[tpl.type] || tpl.type}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 whitespace-pre-wrap">{tpl.body}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Created {formatDate(tpl.createdAt)}</p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => openEdit(tpl)} className="text-sm text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300">Edit</button>
                    <button onClick={() => handleDelete(tpl)} className="text-sm text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300">Delete</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

// ─── Logs Tab ────────────────────────────────────────────────────────────────
const LOGS_PAGE_SIZE = 25;

const LogsTab: React.FC<{ routerId: string; refreshKey: number }> = ({ routerId, refreshKey }) => {
  const [logs, setLogs] = useState<SmsLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('routerId', routerId);
      params.set('limit', String(LOGS_PAGE_SIZE));
      params.set('offset', String((page - 1) * LOGS_PAGE_SIZE));
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/sms/logs?${params}`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setLogs(Array.isArray(data.logs) ? data.logs : []);
        setTotal(data.total || 0);
      }
    } catch (e) { console.error('Failed to fetch SMS logs:', e); }
    setLoading(false);
  }, [routerId, page, statusFilter]);

  useEffect(() => { fetchLogs(); }, [fetchLogs, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / LOGS_PAGE_SIZE));

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">SMS Logs</h3>
        <div className="flex-1" />
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200"
        >
          <option value="">All Statuses</option>
          <option value="SENT">Sent</option>
          <option value="FAILED">Failed</option>
          <option value="QUEUED">Queued</option>
        </select>
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="px-3 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400 uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Sent At</th>
              <th className="px-4 py-3 text-left">Phone</th>
              <th className="px-4 py-3 text-left">Message</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {loading && logs.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8"><Loader /></td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-6 text-slate-500">No SMS logs found.</td></tr>
            ) : logs.map(log => (
              <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300 font-mono whitespace-nowrap">
                  {log.sentAt ? new Date(log.sentAt).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3 text-slate-700 dark:text-slate-300 whitespace-nowrap">{log.clientPhone || '—'}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400 max-w-md">
                  <span className="line-clamp-2" title={log.messageText}>{log.messageText}</span>
                </td>
                <td className="px-4 py-3"><StatusBadge status={log.status} /></td>
                <td className="px-4 py-3 text-xs text-red-500 dark:text-red-400 max-w-xs truncate" title={log.errorMessage || ''}>{log.errorMessage || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs text-slate-500">
          <span>Page {page} of {totalPages} ({total} records)</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1 rounded border border-slate-300 dark:border-slate-600 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-700">Prev</button>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="px-3 py-1 rounded border border-slate-300 dark:border-slate-600 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-700">Next</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SmsManager;
