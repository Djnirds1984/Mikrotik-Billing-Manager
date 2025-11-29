import React, { useEffect, useState } from 'react';
import type { RouterConfigWithId } from '../types.ts';

export const ClientPortal: React.FC<{ selectedRouter: RouterConfigWithId | null }> = ({ selectedRouter }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [view, setView] = useState<'login' | 'dashboard'>('login');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<any | null>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [clientInfo, setClientInfo] = useState<any>(null);

  // We don't need to fetch routers for login anymore as username is unique
  
  const handleLogin = async () => {
    if (!username || !password) { setFeedback('Please fill username and password'); return; }
    setError(null); setFeedback(null); setStatus(null);
    try {
      const res = await fetch('/api/public/client-portal/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Login failed'); return; }
      
      setClientInfo(data);
      setFeedback('Login successful');
      
      // Fetch Status using the returned routerId and pppoeUsername
      // We need router name for the existing API? The existing API /api/public/ppp/status takes routerId AND routerName?
      // Let's check the existing API in ClientPortal.tsx (previous read)
      // "fetch(`/api/public/ppp/status?routerId=${...}&routerName=${...}&username=${...}`)"
      // If I don't have routerName, I might need to fetch it or just send ID if backend supports it.
      // The backend for ppp/status likely uses routerId to find the router. routerName might be redundant or used for logging.
      // I'll try sending just routerId or fetch router info.
      
      // Actually, let's fetch routers to get the name if needed, or hope backend handles it.
      // But wait, I can just fetch the status.
      
      fetchStatus(data);
      setView('dashboard');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const fetchStatus = async (user: any) => {
    try {
        // We might need to get the router name if the API strictly requires it.
        // But let's try to find the router from a public list first if needed.
        // Or just pass a dummy name if backend ignores it (backend usually uses ID).
        
        // Let's quickly fetch routers to find the name
        const rRes = await fetch('/api/public/routers');
        const routers = await rRes.json();
        const rName = Array.isArray(routers) ? routers.find((r: any) => r.id === user.routerId)?.name : 'Unknown';

        const res = await fetch(`/api/public/ppp/status?routerId=${encodeURIComponent(user.routerId)}&routerName=${encodeURIComponent(rName || '')}&username=${encodeURIComponent(user.pppoeUsername)}`);
        const data = await res.json();
        if (res.ok) setStatus(data);

        const payRes = await fetch(`/api/public/client/payments?routerId=${encodeURIComponent(user.routerId)}&routerName=${encodeURIComponent(rName || '')}&username=${encodeURIComponent(user.pppoeUsername)}`);
        const payData = await payRes.json();
        setPayments(Array.isArray(payData) ? payData : []);
    } catch (e) {
        console.error("Failed to load status", e);
    }
  }

  if (view === 'dashboard') {
    const planName = status?.profile || 'Unknown';
    const planPrice = payments[0]?.planPrice ?? payments[0]?.finalAmount ?? null;
    const isActive = !!status?.active;
    const overallStatus = isActive ? 'Active' : 'Expired';
    const lastPayment = payments[0] || null;
    const expires = status?.comment || (lastPayment?.newExpiry || lastPayment?.date);
    
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-6">
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-4 rounded shadow">
            <h1 className="text-2xl font-semibold text-slate-800 dark:text-white">Welcome, {clientInfo?.username}!</h1>
            <button onClick={() => { setView('login'); setClientInfo(null); setUsername(''); setPassword(''); }} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">Logout</button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded shadow-sm">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 font-semibold text-slate-800 dark:text-white">Account Status</div>
                <div className="p-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <div><span className="font-medium text-slate-800 dark:text-slate-200">PPPoE Account:</span> {clientInfo?.pppoeUsername}</div>
                <div><span className="font-medium text-slate-800 dark:text-slate-200">Current Plan:</span> {planName}{planPrice ? ` (₱${Number(planPrice).toFixed(2)}/mo)` : ''}</div>
                <div><span className="font-medium text-slate-800 dark:text-slate-200">Overall Status:</span> <span className={`px-2 py-1 rounded text-xs font-bold ${isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-yellow-100 text-yellow-700'}`}>{overallStatus}</span></div>
                <div><span className="font-medium text-slate-800 dark:text-slate-200">Subscription Expires:</span> {expires || 'Unknown'}</div>
                <div className="pt-4">
                    <button className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium transition-colors">Pay Now / Renew Subscription</button>
                </div>
                </div>
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded shadow-sm">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 font-semibold text-slate-800 dark:text-white">Payment History</div>
                <div className="p-4">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-slate-600 dark:text-slate-300">
                    <thead className="text-xs text-slate-700 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-700/50">
                        <tr>
                        <th className="px-4 py-2">Date</th>
                        <th className="px-4 py-2">Amount</th>
                        <th className="px-4 py-2">Cycle</th>
                        <th className="px-4 py-2">Expiry</th>
                        </tr>
                    </thead>
                    <tbody>
                        {payments.map((p, i) => (
                        <tr key={i} className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                            <td className="px-4 py-2">{p.date ? new Date(p.date).toLocaleDateString() : '—'}</td>
                            <td className="px-4 py-2">₱{Number(p.finalAmount ?? p.planPrice ?? 0).toFixed(2)}</td>
                            <td className="px-4 py-2">{p.months ?? p.cycle ?? '1'} mo</td>
                            <td className="px-4 py-2">{p.newExpiry || '—'}</td>
                        </tr>
                        ))}
                        {payments.length === 0 && (
                        <tr>
                            <td colSpan={4} className="px-4 py-6 text-center text-slate-500">No payments found.</td>
                        </tr>
                        )}
                    </tbody>
                    </table>
                </div>
                </div>
            </div>
            </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-900 p-4">
        <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-lg shadow-lg p-8 space-y-6">
            <div className="text-center">
                <h2 className="text-3xl font-bold text-slate-800 dark:text-white">Client Portal</h2>
                <p className="text-slate-500 mt-2">Login to view your account status</p>
            </div>
            
            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Username</label>
                    <input 
                        value={username} 
                        onChange={e => setUsername(e.target.value)} 
                        className="mt-1 w-full px-4 py-2 border rounded-md dark:bg-slate-700 dark:border-slate-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" 
                        placeholder="Enter your username"
                        onKeyDown={e => e.key === 'Enter' && handleLogin()}
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Password</label>
                    <input 
                        type="password" 
                        value={password} 
                        onChange={e => setPassword(e.target.value)} 
                        className="mt-1 w-full px-4 py-2 border rounded-md dark:bg-slate-700 dark:border-slate-600 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" 
                        placeholder="Enter your password"
                        onKeyDown={e => e.key === 'Enter' && handleLogin()}
                    />
                </div>
            </div>

            <button 
                onClick={handleLogin} 
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md transition-colors shadow-md"
            >
                Login
            </button>

            {feedback && <div className="text-sm text-center text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 p-2 rounded">{feedback}</div>}
            {error && <div className="text-sm text-center text-red-600 bg-red-50 dark:bg-red-900/20 p-2 rounded">{error}</div>}
        </div>
    </div>
  );
};
