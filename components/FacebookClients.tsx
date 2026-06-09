import React, { useState, useEffect } from 'react';
import { Loader } from './Loader.tsx';

interface FacebookClient {
  id: string;
  accountNumber: string;
  username: string;
  fullName: string;
  facebook_psid: string;
  planName: string;
  dueDate: string;
  planType: string;
  routerId: string;
  contactNumber?: string;
  email?: string;
  address?: string;
}

export const FacebookClients: React.FC = () => {
  const [clients, setClients] = useState<FacebookClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    loadClients();
  }, []);

  const loadClients = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/facebook/clients', {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('[Facebook Clients] Loaded clients:', data);
      setClients(Array.isArray(data) ? data : []);
    } catch (error: any) {
      console.error('Failed to load clients:', error);
      setClients([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSendReminder = async (client: FacebookClient) => {
    setSendingId(client.id);
    try {
      const response = await fetch(`/api/facebook/clients/${client.id}/remind`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        },
        body: JSON.stringify({})
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      alert(`Payment reminder sent to ${client.accountNumber}`);
    } catch (error: any) {
      alert(`Failed to send reminder: ${error.message}`);
    } finally {
      setSendingId(null);
    }
  };

  const handleBulkReminders = async () => {
    if (!confirm('Send payment reminders to all clients due within 3 days?')) {
      return;
    }

    try {
      const response = await fetch('/api/facebook/clients/remind-bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        },
        body: JSON.stringify({ daysBefore: 3 })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      alert(`Reminders sent successfully! Sent: ${result.sent || 0}, Failed: ${result.failed || 0}`);
      loadClients();
    } catch (error: any) {
      alert(`Failed to send bulk reminders: ${error.message}`);
    }
  };

  const getDaysText = (dueDate: string): string => {
    if (!dueDate) {
      return 'No date';
    }
    const now = new Date();
    const due = new Date(dueDate);
    const diffTime = due.getTime() - now.getTime();
    const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (days < 0) {
      return `${Math.abs(days)} days overdue`;
    }
    if (days === 0) {
      return 'Due today';
    }
    if (days === 1) {
      return 'Due tomorrow';
    }
    return `In ${days} days`;
  };

  const getStatusClass = (dueDate: string): string => {
    if (!dueDate) {
      return 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300';
    }
    const now = new Date();
    const due = new Date(dueDate);
    const diffTime = due.getTime() - now.getTime();
    const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (days < 0) {
      return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
    }
    if (days === 0) {
      return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300';
    }
    if (days <= 3) {
      return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300';
    }
    return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300';
  };

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Loader />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Facebook Bot Clients</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Manage clients registered via Facebook Messenger
          </p>
        </div>
        <button
          onClick={handleBulkReminders}
          disabled={clients.length === 0}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded-lg font-medium transition-colors"
        >
          📢 Send Bulk Reminders
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
          <div className="text-sm text-slate-600 dark:text-slate-400">Total Clients</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{clients.length}</div>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 border border-red-200 dark:border-red-800">
          <div className="text-sm text-red-600 dark:text-red-400">Overdue</div>
          <div className="text-2xl font-bold text-red-700 dark:text-red-300 mt-1">
            {clients.filter(c => {
              if (!c.dueDate) return false;
              const days = Math.ceil((new Date(c.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              return days < 0;
            }).length}
          </div>
        </div>
        <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4 border border-orange-200 dark:border-orange-800">
          <div className="text-sm text-orange-600 dark:text-orange-400">Due Today</div>
          <div className="text-2xl font-bold text-orange-700 dark:text-orange-300 mt-1">
            {clients.filter(c => {
              if (!c.dueDate) return false;
              const days = Math.ceil((new Date(c.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              return days === 0;
            }).length}
          </div>
        </div>
        <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4 border border-yellow-200 dark:border-yellow-800">
          <div className="text-sm text-yellow-600 dark:text-yellow-400">Due in 1-3 Days</div>
          <div className="text-2xl font-bold text-yellow-700 dark:text-yellow-300 mt-1">
            {clients.filter(c => {
              if (!c.dueDate) return false;
              const days = Math.ceil((new Date(c.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              return days >= 1 && days <= 3;
            }).length}
          </div>
        </div>
      </div>

      {/* Table */}
      {clients.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="text-6xl mb-4">📱</div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">No Facebook clients found</h3>
          <p className="text-slate-600 dark:text-slate-400 mt-2">
            Clients will appear here after they register via Facebook Messenger
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase">Account</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase">Customer</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase">Plan</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase">Due Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase">Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {clients.map((client) => (
                <tr key={client.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <td className="px-4 py-3">
                    <div className="font-mono text-sm font-semibold text-slate-900 dark:text-white">
                      {client.accountNumber || 'N/A'}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {client.username || 'N/A'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-slate-900 dark:text-white">
                      {client.fullName || 'N/A'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-slate-900 dark:text-white">
                      {client.planName || 'N/A'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-slate-900 dark:text-white">
                      {client.dueDate || 'N/A'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${getStatusClass(client.dueDate)}`}>
                      {getDaysText(client.dueDate)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleSendReminder(client)}
                      disabled={sendingId === client.id}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white text-sm font-medium rounded transition-colors"
                    >
                      {sendingId === client.id ? '⏳ Sending...' : '📩 Send Reminder'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Info */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <h3 className="font-semibold text-blue-900 dark:text-blue-200">ℹ️ Automatic Payment Reminders</h3>
        <p className="text-sm text-blue-800 dark:text-blue-300 mt-2">
          The system automatically sends payment reminders to Facebook clients <strong>3 days before their due date</strong>.
          Reminders run daily at <strong>9:00 AM</strong>.
        </p>
      </div>
    </div>
  );
};
