import React, { useState, useEffect } from 'react';
import { dbApi } from '../services/databaseService.ts';

interface FacebookClient {
  id: string;
  accountNumber: string;
  username: string;
  fullName: string;
  facebook_psid: string;
  planName: string;
  planPrice: number;
  dueDate: string;
  planType: string;
  routerId: string;
  contactNumber?: string;
  email?: string;
  address?: string;
}

const FacebookClients: React.FC = () => {
  const [clients, setClients] = useState<FacebookClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [bulkSending, setBulkSending] = useState(false);
  const [filter, setFilter] = useState<'all' | 'overdue' | 'due-today' | 'due-soon' | 'upcoming'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRouter, setSelectedRouter] = useState<string>('');
  const [routers, setRouters] = useState<{id: string, name: string}[]>([]);

  useEffect(() => {
    loadRouters();
    loadClients();
  }, [selectedRouter]);

  const loadRouters = async () => {
    try {
      const response = await dbApi.get<any[]>('/api/routers');
      setRouters(response || []);
    } catch (err) {
      console.error('Failed to load routers:', err);
    }
  };

  const loadClients = async () => {
    try {
      setLoading(true);
      const params = selectedRouter ? `?routerId=${selectedRouter}` : '';
      const response = await dbApi.get<any[]>(`/api/facebook/clients${params}`);
      setClients(response || []);
    } catch (err) {
      console.error('Failed to load Facebook clients:', err);
    } finally {
      setLoading(false);
    }
  };

  const sendReminder = async (clientId: string) => {
    try {
      setSendingReminder(clientId);
      await dbApi.post(`/api/facebook/clients/${clientId}/remind`, {});
      alert('✅ Payment reminder sent successfully!');
    } catch (err: any) {
      console.error('Failed to send reminder:', err);
      alert('❌ Failed to send reminder: ' + (err.message || 'Unknown error'));
    } finally {
      setSendingReminder(null);
    }
  };

  const sendBulkReminders = async () => {
    if (!confirm('Send payment reminders to all clients due within 3 days?')) return;
    
    try {
      setBulkSending(true);
      const response = await dbApi.post('/api/facebook/clients/remind-bulk', {
        daysBefore: 3,
        routerId: selectedRouter || undefined
      });
      
      alert(`✅ Reminders sent!\n\nTotal: ${(response as any).total}\nSent: ${(response as any).sent}\nFailed: ${(response as any).failed}`);
    } catch (err: any) {
      console.error('Failed to send bulk reminders:', err);
      alert('❌ Failed to send bulk reminders: ' + (err.message || 'Unknown error'));
    } finally {
      setBulkSending(false);
    }
  };

  const getDaysUntilDue = (dueDate: string): number => {
    const now = new Date();
    const due = new Date(dueDate);
    return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  };

  const getDueStatus = (dueDate: string): { label: string; color: string; bg: string } => {
    const days = getDaysUntilDue(dueDate);
    if (days < 0) return { label: `${Math.abs(days)}d Overdue`, color: 'text-red-700 dark:text-red-300', bg: 'bg-red-100 dark:bg-red-900/30' };
    if (days === 0) return { label: 'Due Today', color: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-100 dark:bg-orange-900/30' };
    if (days === 1) return { label: 'Due Tomorrow', color: 'text-yellow-700 dark:text-yellow-300', bg: 'bg-yellow-100 dark:bg-yellow-900/30' };
    if (days <= 3) return { label: `${days}d Left`, color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-100 dark:bg-blue-900/30' };
    return { label: `${days}d`, color: 'text-green-700 dark:text-green-300', bg: 'bg-green-100 dark:bg-green-900/30' };
  };

  const filteredClients = clients.filter(client => {
    // Search filter
    const matchesSearch = searchTerm === '' || 
      client.accountNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      client.fullName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      client.username?.toLowerCase().includes(searchTerm.toLowerCase());

    // Status filter
    const days = getDaysUntilDue(client.dueDate);
    let matchesFilter = true;
    if (filter === 'overdue') matchesFilter = days < 0;
    else if (filter === 'due-today') matchesFilter = days === 0;
    else if (filter === 'due-soon') matchesFilter = days >= 1 && days <= 3;
    else if (filter === 'upcoming') matchesFilter = days > 3;

    return matchesSearch && matchesFilter;
  });

  const stats = {
    total: clients.length,
    overdue: clients.filter(c => getDaysUntilDue(c.dueDate) < 0).length,
    dueToday: clients.filter(c => getDaysUntilDue(c.dueDate) === 0).length,
    dueSoon: clients.filter(c => { const d = getDaysUntilDue(c.dueDate); return d >= 1 && d <= 3; }).length,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Facebook Bot Clients</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Manage clients registered via Facebook Messenger
          </p>
        </div>
        <button
          onClick={sendBulkReminders}
          disabled={bulkSending || clients.length === 0}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          {bulkSending ? (
            <>
              <span className="animate-spin">⏳</span>
              Sending...
            </>
          ) : (
            <>
              📢 Send Bulk Reminders
            </>
          )}
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
          <div className="text-sm text-slate-600 dark:text-slate-400">Total Clients</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{stats.total}</div>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 border border-red-200 dark:border-red-800">
          <div className="text-sm text-red-600 dark:text-red-400">Overdue</div>
          <div className="text-2xl font-bold text-red-700 dark:text-red-300 mt-1">{stats.overdue}</div>
        </div>
        <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4 border border-orange-200 dark:border-orange-800">
          <div className="text-sm text-orange-600 dark:text-orange-400">Due Today</div>
          <div className="text-2xl font-bold text-orange-700 dark:text-orange-300 mt-1">{stats.dueToday}</div>
        </div>
        <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4 border border-yellow-200 dark:border-yellow-800">
          <div className="text-sm text-yellow-600 dark:text-yellow-400">Due in 1-3 Days</div>
          <div className="text-2xl font-bold text-yellow-700 dark:text-yellow-300 mt-1">{stats.dueSoon}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search by account number, name, or username..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white placeholder-slate-400"
          />
        </div>
        <div className="flex gap-2">
          {(['all', 'overdue', 'due-today', 'due-soon', 'upcoming'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              {f === 'all' ? 'All' : f === 'overdue' ? 'Overdue' : f === 'due-today' ? 'Today' : f === 'due-soon' ? '1-3 Days' : 'Upcoming'}
            </button>
          ))}
        </div>
        {routers.length > 0 && (
          <select
            value={selectedRouter}
            onChange={(e) => setSelectedRouter(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white"
          >
            <option value="">All Routers</option>
            {routers.map((router) => (
              <option key={router.id} value={router.id}>
                {router.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Clients Table */}
      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin text-4xl">⏳</div>
          <p className="text-slate-600 dark:text-slate-400 mt-4">Loading clients...</p>
        </div>
      ) : filteredClients.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="text-6xl mb-4">📱</div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">No Facebook clients found</h3>
          <p className="text-slate-600 dark:text-slate-400 mt-2">
            Clients will appear here after they register via Facebook Messenger
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Account</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Plan</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Due Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {filteredClients.map((client) => {
                  const days = getDaysUntilDue(client.dueDate);
                  const status = getDueStatus(client.dueDate);
                  
                  return (
                    <tr key={client.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-mono text-sm font-semibold text-slate-900 dark:text-white">
                          {client.accountNumber}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {client.username}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-slate-900 dark:text-white">
                          {client.fullName || 'N/A'}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1">
                          <span className="text-blue-600">📘</span>
                          <span className="font-mono">{client.facebook_psid.substring(0, 12)}...</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-slate-900 dark:text-white">{client.planName || 'N/A'}</div>
                        <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                          ₱{(client.planPrice || 0).toFixed(2)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-slate-900 dark:text-white">{client.dueDate}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {days < 0 ? `${Math.abs(days)} days overdue` : days === 0 ? 'Due today' : `In ${days} days`}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${status.bg} ${status.color}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => sendReminder(client.id)}
                          disabled={sendingReminder === client.id}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white text-sm font-medium rounded transition-colors flex items-center gap-1 mx-auto"
                        >
                          {sendingReminder === client.id ? (
                            <>
                              <span className="animate-spin">⏳</span>
                              Sending...
                            </>
                          ) : (
                            <>
                              📩 Send Reminder
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Auto-Reminder Info */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="text-2xl">ℹ️</div>
          <div>
            <h3 className="font-semibold text-blue-900 dark:text-blue-200">Automatic Payment Reminders</h3>
            <p className="text-sm text-blue-800 dark:text-blue-300 mt-1">
              The system automatically sends payment reminders to Facebook clients <strong>3 days before their due date</strong>.
              Reminders run daily at <strong>9:00 AM</strong>.
            </p>
            <ul className="text-xs text-blue-700 dark:text-blue-400 mt-2 space-y-1">
              <li>• Overdue clients receive urgent notices</li>
              <li>• Clients due today get same-day reminders</li>
              <li>• Clients due in 1-3 days get advance notices</li>
              <li>• Manual reminders can be sent anytime using the button above</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FacebookClients;
