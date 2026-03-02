import React, { useEffect, useState } from 'react';
import { dbApi, getAuthHeader } from '../services/databaseService.ts';
import type { View } from '../types.ts';
import { Loader } from './Loader.tsx';
import { CurrencyDollarIcon, EyeIcon } from '../constants.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';

interface PaymentRequest {
  id: string;
  routerId: string;
  usernameLabel: string;
  accountNumber?: string;
  planName: string;
  planId?: string;
  amount?: number;
  currency?: string;
  ip?: string;
  macAddress?: string;
  imagePath?: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  createdAt: string;
}

export const PaymentRequests: React.FC<{ setCurrentView?: (v: View) => void }> = () => {
  const [items, setItems] = useState<PaymentRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<PaymentRequest | null>(null);
  const { t } = useLocalization();
  const { token } = useAuth();

  const loadItems = async () => {
    setIsLoading(true);
    try {
      const rows = await dbApi.get('/payment-requests');
      setItems(Array.isArray(rows) ? rows.sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt))) : []);
    } catch {
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadItems(); }, []);

  const accept = async (id: string) => {
    try {
      const resp = await fetch(`/api/admin/payment-requests/${encodeURIComponent(id)}/accept`, { method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' } });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.message || 'Failed to accept');
      await loadItems();
      alert('Payment accepted and account renewed.');
      setSelected(null);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const decline = async (id: string) => {
    try {
      const resp = await fetch(`/api/admin/payment-requests/${encodeURIComponent(id)}/decline`, { method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' } });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.message || 'Failed to decline');
      await loadItems();
      alert('Payment request declined.');
      setSelected(null);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <CurrencyDollarIcon className="w-6 h-6" />
            <h3 className="text-lg font-semibold">Payment Requests</h3>
          </div>
          <button onClick={loadItems} className="px-3 py-1 text-sm bg-sky-600 hover:bg-sky-700 text-white rounded-md">Refresh</button>
        </div>
        <div className="p-4">
          {isLoading ? (
            <div className="flex justify-center"><Loader /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length > 0 ? items.map(item => (
                    <tr key={item.id} className="border-b border-slate-100 dark:border-slate-700">
                      <td className="px-4 py-2">{new Date(item.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-2">
                        <div className="font-semibold">{item.usernameLabel}</div>
                        {item.accountNumber && <div className="text-xs text-slate-500">Acct: {item.accountNumber}</div>}
                      </td>
                      <td className="px-4 py-2">{item.planName}</td>
                      <td className="px-4 py-2 text-right">{(item.currency || 'PHP')} {Number(item.amount || 0).toFixed(2)}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${item.status === 'ACCEPTED' ? 'bg-emerald-100 text-emerald-700' : item.status === 'DECLINED' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>{item.status}</span>
                      </td>
                      <td className="px-4 py-2 text-center space-x-2">
                        <button onClick={() => setSelected(item)} className="px-3 py-1 text-sm bg-slate-600 text-white rounded-md font-semibold hover:bg-slate-700">
                          <EyeIcon className="w-4 h-4 inline mr-1" /> View
                        </button>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-slate-500">No payment requests.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg w-full max-w-2xl">
            <div className="px-6 py-4 border-b dark:border-slate-700 flex justify-between items-center">
              <h3 className="text-lg font-semibold">Receipt</h3>
              <button onClick={() => setSelected(null)} className="px-3 py-1 bg-slate-200 dark:bg-slate-700 rounded-md">Close</button>
            </div>
            <div className="p-6 space-y-4">
              {selected.imagePath ? (
                <img src={selected.imagePath} alt="Receipt" className="w-full max-h-[60vh] object-contain border rounded" />
              ) : (
                <div className="text-center text-slate-500">No image uploaded.</div>
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => decline(selected.id)} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md">Decline</button>
                <button onClick={() => accept(selected.id)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md">Accept</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
