import React from 'react';
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
}

const FacebookClients: React.FC = () => {
  const [clients, setClients] = React.useState<FacebookClient[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    loadClients();
  }, []);

  const loadClients = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await dbApi.get<FacebookClient[]>('/api/facebook/clients');
      setClients(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load clients');
      setClients([]);
    } finally {
      setLoading(false);
    }
  };

  const sendReminder = async (client: FacebookClient) => {
    try {
      await dbApi.post(`/api/facebook/clients/${client.id}/remind`, {});
      alert(`Reminder sent to ${client.accountNumber}`);
    } catch (err: any) {
      alert('Failed: ' + (err.message || 'Unknown error'));
    }
  };

  const getDaysUntilDue = (dueDate: string) => {
    if (!dueDate) return 'N/A';
    const now = new Date();
    const due = new Date(dueDate);
    if (isNaN(due.getTime())) return 'N/A';
    const days = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (days < 0) return `${Math.abs(days)} days overdue`;
    if (days === 0) return 'Due today';
    return `In ${days} days`;
  };

  const getStatusColor = (dueDate: string) => {
    if (!dueDate) return 'bg-slate-100 text-slate-700';
    const now = new Date();
    const due = new Date(dueDate);
    if (isNaN(due.getTime())) return 'bg-slate-100 text-slate-700';
    const days = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (days < 0) return 'bg-red-100 text-red-700';
    if (days === 0) return 'bg-orange-100 text-orange-700';
    if (days <= 3) return 'bg-yellow-100 text-yellow-700';
    return 'bg-green-100 text-green-700';
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Facebook Bot Clients</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Manage clients registered via Facebook Messenger
        </p>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-700 dark:text-red-300">{error}</p>
          <button onClick={loadClients} className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">
            Retry
          </button>
        </div>
      )}

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
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase">Plan</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase">Due Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase">Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {clients.map((client) => (
                <tr key={client.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <td className="px-4 py-3">
                    <div className="font-mono text-sm font-semibold text-slate-900 dark:text-white">
                      {client.accountNumber || 'N/A'}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
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
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      ₱{(client.planPrice || 0).toFixed(2)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-slate-900 dark:text-white">
                      {client.dueDate || 'N/A'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${getStatusColor(client.dueDate)}`}>
                      {getDaysUntilDue(client.dueDate)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => sendReminder(client)}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-colors"
                    >
                      📩 Send Reminder
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <h3 className="font-semibold text-blue-900 dark:text-blue-200">ℹ️ Automatic Payment Reminders</h3>
        <p className="text-sm text-blue-800 dark:text-blue-300 mt-2">
          The system automatically sends payment reminders to Facebook clients <strong>3 days before their due date</strong>.
          Reminders run daily at <strong>9:00 AM</strong>.
        </p>
      </div>
    </div>
  );
};

export default FacebookClients;
