import React, { useEffect, useState } from 'react';
import type { RouterConfigWithId } from '../types.ts';

// Password hashing handled server-side

export const ClientPortal: React.FC<{ selectedRouter: RouterConfigWithId | null }> = ({ selectedRouter }) => {
  const [routers, setRouters] = useState<{id: string, name: string}[]>([]);
  const [routerId, setRouterId] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [view, setView] = useState<'login' | 'dashboard'>('login');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<any | null>(null);
  const [payments, setPayments] = useState<any[]>([]);

  useEffect(() => {
    const loadRouters = async () => {
      try {
        const res = await fetch('/api/public/routers');
        const data = await res.json();
        setRouters(Array.isArray(data) ? data : []);
        setRouterId(selectedRouter?.id || data[0]?.id || null);
      } catch (e) { setError('Failed to load routers'); }
    };
    loadRouters();
  }, [selectedRouter]);

  const handleRegister = async () => {
    if (!routerId || !username || !password) { setFeedback('Please fill router, username, and password'); return; }
    setError(null); setFeedback(null);
    try {
      const resp = await fetch('/api/public/client-portal/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routerId, username, password })
      });
      const data = await resp.json();
      if (!resp.ok) { setError(data.message || 'Registration failed'); return; }
      setFeedback('Account registered. You can now log in.');
      setMode('login');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleLogin = async () => {
    if (!routerId || !username || !password) { setFeedback('Please fill router, username, and password'); return; }
    setError(null); setFeedback(null); setStatus(null);
    try {
      const routerName = routers.find(r => r.id === routerId)?.name || '';
      const res = await fetch(`/api/public/ppp/status?routerId=${encodeURIComponent(routerId)}&routerName=${encodeURIComponent(routerName)}&username=${encodeURIComponent(username)}`);
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Failed to query status'); return; }
      setFeedback('Login successful');
      setStatus(data);
      const payRes = await fetch(`/api/public/client/payments?routerId=${encodeURIComponent(routerId)}&routerName=${encodeURIComponent(routerName)}&username=${encodeURIComponent(username)}`);
      const payData = await payRes.json();
      setPayments(Array.isArray(payData) ? payData : []);
      setView('dashboard');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (view === 'dashboard') {
    const planName = status?.profile || 'Unknown';
    const planPrice = payments[0]?.planPrice ?? payments[0]?.finalAmount ?? null;
    const isActive = !!status?.active;
    const overallStatus = isActive ? 'Active' : 'Expired';
    const lastPayment = payments[0] || null;
    const expires = status?.comment || (lastPayment?.newExpiry || lastPayment?.date);
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-semibold">Welcome, {username}!</h1>
          <a href="/portal" className="px-4 py-2 bg-red-600 text-white rounded">Logout</a>
        </div>
        <hr />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border rounded shadow-sm">
            <div className="px-4 py-3 border-b font-semibold">Account Status</div>
            <div className="p-4 space-y-2 text-sm">
              <div><span className="font-medium">Username:</span> {username}</div>
              <div><span className="font-medium">Account Type:</span> PPPoE</div>
              <div><span className="font-medium">Current Plan:</span> {planName}{planPrice ? ` (₱${Number(planPrice).toFixed(2)}/mo)` : ''}</div>
              <div><span className="font-medium">Overall Status:</span> <span className={`px-2 py-1 rounded ${isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-yellow-100 text-yellow-700'}`}>{overallStatus}</span></div>
              <div><span className="font-medium">Subscription Expires:</span> {expires || 'Unknown'}</div>
              <div className="pt-2">
                <button className="px-4 py-2 bg-emerald-600 text-white rounded">Pay Now / Renew Subscription</button>
              </div>
            </div>
          </div>
          <div className="border rounded shadow-sm">
            <div className="px-4 py-3 border-b font-semibold">Your Payment History</div>
            <div className="p-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2">Date</th>
                    <th className="py-2">Amount</th>
                    <th className="py-2">Months</th>
                    <th className="py-2">New Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p, i) => (
                    <tr key={i} className={i % 2 ? 'bg-slate-50' : ''}>
                      <td className="py-2">{p.date || '—'}</td>
                      <td className="py-2">₱{Number(p.finalAmount ?? p.planPrice ?? 0).toFixed(2)}</td>
                      <td className="py-2">{p.months ?? p.cycle ?? '1'}</td>
                      <td className="py-2">{p.newExpiry || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <hr />
        <div>
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">My Repair Tickets</h2>
            <button className="px-4 py-2 bg-sky-600 text-white rounded">Report New Issue</button>
          </div>
          <div className="text-sm text-slate-600 mt-2">No tickets found.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="flex gap-2">
        <button onClick={() => setMode('login')} className={`px-4 py-2 rounded ${mode==='login'?'bg-sky-600 text-white':'bg-slate-200'}`}>Login</button>
        <button onClick={() => setMode('register')} className={`px-4 py-2 rounded ${mode==='register'?'bg-sky-600 text-white':'bg-slate-200'}`}>Register</button>
      </div>
      <div className="grid grid-cols-1 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">Router</label>
          <select value={routerId || ''} onChange={e => setRouterId(e.target.value)} className="w-full px-3 py-2 border rounded">
            {routers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">PPPoE Username</label>
          <input value={username} onChange={e => setUsername(e.target.value)} className="w-full px-3 py-2 border rounded" placeholder="e.g. client123" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-3 py-2 border rounded" />
        </div>
      </div>
      <div className="flex gap-3">
        {mode==='login' ? (
          <button onClick={handleLogin} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded">Login</button>
        ) : (
          <button onClick={handleRegister} className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded">Register</button>
        )}
      </div>
      {feedback && <div className="text-sm text-green-600">{feedback}</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {status && (
        <div className="mt-6 bg-white dark:bg-slate-800 border p-4 rounded">
          <h4 className="font-semibold mb-2">Account Status</h4>
          <ul className="text-sm space-y-1">
            <li>Exists: {String(status.exists)}</li>
            <li>Active: {String(status.active)}</li>
            <li>Profile: {status.profile || 'N/A'}</li>
            <li>Disabled: {status.disabled || 'N/A'}</li>
            <li>Comment: {status.comment || 'N/A'}</li>
            <li>Last Logged Out: {status.lastLoggedOut || 'N/A'}</li>
          </ul>
        </div>
      )}
    </div>
  );
};
