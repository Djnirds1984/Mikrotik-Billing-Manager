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
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);

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

  const handleBroadcast = async () => {
    if (!broadcastMessage.trim()) {
      alert('Please enter a message');
      return;
    }

    if (!confirm(`Send this announcement to ALL ${clients.length} Facebook-linked clients?`)) {
      return;
    }

    setBroadcasting(true);
    try {
      const response = await fetch('/api/facebook/clients/broadcast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        },
        body: JSON.stringify({ message: broadcastMessage })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      alert(`Broadcast sent!\n\nTotal: ${result.total}\nSent: ${result.sent}\nFailed: ${result.failed}`);
      setBroadcastMessage('');
      setShowBroadcast(false);
    } catch (error: any) {
      alert(`Failed to send broadcast: ${error.message}`);
    } finally {
      setBroadcasting(false);
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
        <div className="flex gap-2">
          <button
            onClick={() => setShowBroadcast(true)}
            disabled={clients.length === 0}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-400 text-white rounded-lg font-medium transition-colors"
          >
            📣 Send Announcement
          </button>
          <button
            onClick={handleBulkReminders}
            disabled={clients.length === 0}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded-lg font-medium transition-colors"
          >
            📢 Send Bulk Reminders
          </button>
        </div>
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase whitespace-nowrap">Account</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase whitespace-nowrap">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase whitespace-nowrap">Plan</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase whitespace-nowrap">Due Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase whitespace-nowrap">Status</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {clients.map((client) => (
                  <tr key={client.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    <td className="px-4 py-3">
                      <div className="font-mono text-sm font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                        {client.accountNumber || 'N/A'}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 whitespace-nowrap">
                        {client.username || 'N/A'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-slate-900 dark:text-white whitespace-nowrap">
                        {client.fullName || 'N/A'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-slate-900 dark:text-white whitespace-nowrap">
                        {client.planName || 'N/A'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-slate-900 dark:text-white whitespace-nowrap">
                        {client.dueDate || 'N/A'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${getStatusClass(client.dueDate)}`}>
                        {getDaysText(client.dueDate)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <button
                        onClick={() => handleSendReminder(client)}
                        disabled={sendingId === client.id}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white text-sm font-medium rounded transition-colors whitespace-nowrap"
                      >
                        {sendingId === client.id ? '⏳ Sending...' : '📩 Send Reminder'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

      {/* Broadcast Modal */}
      {showBroadcast && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">📣 Send Announcement to All Clients</h2>
                <button
                  onClick={() => setShowBroadcast(false)}
                  className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  ✕
                </button>
              </div>

              <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4 mb-4">
                <p className="text-sm text-purple-900 dark:text-purple-200">
                  <strong>Recipients:</strong> {clients.length} Facebook-linked clients
                </p>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Message Template
                </label>
                <textarea
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                  rows={8}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="Enter your announcement message...

Available placeholders:
{name} - Customer's full name
{account} - Account number

Example:
🔧 NETWORK MAINTENANCE NOTICE

Dear {name},

We will be performing scheduled maintenance on your account {account} on [DATE] from [TIME] to [TIME].

Service may be temporarily interrupted during this period.

Thank you for your patience."
                />
              </div>

              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 mb-4">
                <p className="text-sm text-yellow-900 dark:text-yellow-200">
                  <strong>💡 Tip:</strong> Use <code className="bg-yellow-100 dark:bg-yellow-900/40 px-1 rounded">{'{name}'}</code> and <code className="bg-yellow-100 dark:bg-yellow-900/40 px-1 rounded">{'{account}'}</code> to personalize the message for each client.
                </p>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowBroadcast(false)}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBroadcast}
                  disabled={broadcasting || !broadcastMessage.trim()}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-400 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  {broadcasting ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      Sending...
                    </>
                  ) : (
                    <>
                      📣 Send to All {clients.length} Clients
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
