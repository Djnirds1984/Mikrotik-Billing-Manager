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
  const [invoices, setInvoices] = useState<any[]>([]);
  const [clientInfo, setClientInfo] = useState<any>(null);
  const [invoiceToView, setInvoiceToView] = useState<any | null>(null);
  const [invoiceToPrint, setInvoiceToPrint] = useState<any | null>(null);
  const [panelSettings, setPanelSettings] = useState<any | null>(null);
  const [tickets, setTickets] = useState<any[]>([]);
  const [ticketCategory, setTicketCategory] = useState('no_internet');
  const [ticketDescription, setTicketDescription] = useState('');
  const [isSubmittingTicket, setIsSubmittingTicket] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [ticketFeedback, setTicketFeedback] = useState<string | null>(null);
  const [paymentReceipt, setPaymentReceipt] = useState<{ user: string; amount: string; invoice: string; date: string; base?: string; fee?: string; method?: string } | null>(null);
  const [paymongoConfig, setPaymongoConfig] = useState<{ enabled: boolean; passFeesToCustomer: boolean }>({ enabled: false, passFeesToCustomer: false });
  const [xenditConfig, setXenditConfig] = useState<{ enabled: boolean; passFeesToCustomer: boolean; paymentMethods: string[] }>({ enabled: false, passFeesToCustomer: false, paymentMethods: [] });
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'gcash' | 'paymaya' | 'grab_pay' | 'qrph' | 'card'>('gcash');
  const [billingPlans, setBillingPlans] = useState<any[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedGateway, setSelectedGateway] = useState<'paymongo' | 'xendit'>('paymongo');
  useEffect(() => {
    try { localStorage.setItem('suppressReload', '1'); } catch {}
    return () => { try { localStorage.removeItem('suppressReload'); } catch {} };
  }, []);

  // Restore client session on mount (so user stays logged in after PayMongo redirect)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('clientPortalSession');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.pppoeUsername) {
          setClientInfo(parsed);
          setView('dashboard');
          // Refresh live status/payments/tickets so the UI is up to date after the redirect
          fetchStatus(parsed);
          fetchClientTickets(parsed.pppoeUsername || parsed.username);
        }
      }
    } catch (e) {
      console.warn('Failed to restore client session', e);
    }
  }, []);

  // Detect ?payment=success in the URL after PayMongo redirect and render a receipt
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('payment') === 'success') {
        const user = params.get('user') || '';
        const amount = params.get('amount') || '0';
        const invoice = params.get('invoice') || `INV-${Date.now()}`;
        const base = params.get('base') || undefined;
        const fee = params.get('fee') || undefined;
        const method = params.get('method') || undefined;
        setPaymentReceipt({
          user,
          amount,
          invoice,
          date: new Date().toLocaleString(),
          base,
          fee,
          method,
        });
        // Clean the URL so refresh won't re-trigger the modal
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
      }
    } catch (e) {
      console.warn('Failed to parse payment URL params', e);
    }
  }, []);

  // Fetch public PayMongo config (enabled + passFeesToCustomer flag)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/public/paymongo-config');
        if (res.ok) {
          const data = await res.json();
          setPaymongoConfig({
            enabled: !!data.enabled,
            passFeesToCustomer: !!data.passFeesToCustomer,
          });
        }
      } catch (e) {
        console.warn('Failed to load PayMongo config', e);
      }
    })();
  }, []);

  // Fetch public Xendit config
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/public/xendit-config');
        if (res.ok) {
          const data = await res.json();
          setXenditConfig({
            enabled: !!data.enabled,
            passFeesToCustomer: !!data.passFeesToCustomer,
            paymentMethods: data.paymentMethods || [],
          });
        }
      } catch (e) {
        console.warn('Failed to load Xendit config', e);
      }
    })();
  }, []);

  // Auto-select default gateway: prefer PayMongo, fallback to Xendit
  useEffect(() => {
    if (paymongoConfig.enabled) {
      setSelectedGateway('paymongo');
    } else if (xenditConfig.enabled) {
      setSelectedGateway('xendit');
    }
  }, [paymongoConfig.enabled, xenditConfig.enabled]);

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
      try { sessionStorage.setItem('clientPortalSession', JSON.stringify(data)); } catch {}
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
      fetchClientTickets(data.pppoeUsername || data.username);
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
        
        const invRes = await fetch(`/api/public/client/invoices?routerId=${encodeURIComponent(user.routerId)}&username=${encodeURIComponent(user.pppoeUsername)}`);
        const invData = await invRes.json();
        setInvoices(Array.isArray(invData) ? invData : []);

        // Fetch available billing plans for this router
        const plansRes = await fetch(`/api/public/store/plans?routerId=${encodeURIComponent(user.routerId)}&type=pppoe`);
        if (plansRes.ok) {
          const plansData = await plansRes.json();
          setBillingPlans(Array.isArray(plansData) ? plansData : []);
          // Auto-select the user's current plan if it matches
          const currentPlanName = data?.planName || data?.profile || '';
          const matchingPlan = plansData.find((p: any) => p.name === currentPlanName);
          if (matchingPlan) {
            setSelectedPlanId(matchingPlan.id);
          } else if (plansData.length > 0 && !selectedPlanId) {
            setSelectedPlanId(plansData[0].id);
          }
        }
    } catch (e) {
        console.error("Failed to load status", e);
    }
  }

  const fetchClientTickets = async (uname: string) => {
    try {
      const res = await fetch(`/api/public/client-portal/tickets?username=${encodeURIComponent(uname)}`);
      if (res.ok) {
        const data = await res.json();
        setTickets(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error("Failed to load tickets", e);
    }
  };

  const handleSubmitTicket = async () => {
    if (!ticketCategory) return;
    setIsSubmittingTicket(true);
    setTicketFeedback(null);
    try {
      const res = await fetch('/api/public/client-portal/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: clientInfo?.pppoeUsername || clientInfo?.username,
          client_user_id: clientInfo?.id,
          client_type: 'pppoe',
          category: ticketCategory,
          description: ticketDescription,
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setTicketFeedback('Ticket submitted successfully!');
      setTicketDescription('');
      setTicketCategory('no_internet');
      fetchClientTickets(clientInfo?.pppoeUsername || clientInfo?.username);
    } catch (e) {
      setTicketFeedback(`Error: ${(e as Error).message}`);
    } finally {
      setIsSubmittingTicket(false);
    }
  };
  
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/public/landing-page');
        const data = await res.json();
        const company = data?.company || {};
        setPanelSettings({ companyName: company.companyName || '', logoBase64: company.logoBase64 || '' });
      } catch {
        setPanelSettings(null);
      }
    })();
  }, []);
  
  const handlePrintInvoice = () => {
    if (!invoiceToView) return;
    setInvoiceToPrint(invoiceToView);
    setTimeout(() => {
      window.print();
      setInvoiceToPrint(null);
    }, 150);
  };

  const handlePayNow = async () => {
    const selectedPlan = billingPlans.find(p => p.id === selectedPlanId);
    const currentPlanName = selectedPlan?.name || status?.planName || status?.profile || 'Unknown';
    const currentPlanPrice = selectedPlan?.price ?? status?.planPrice ?? payments[0]?.planPrice ?? payments[0]?.finalAmount ?? null;
    if (!clientInfo?.pppoeUsername || !currentPlanPrice) {
      setError('Unable to initiate payment. Plan price not found.');
      return;
    }
    setIsPaying(true);
    setError(null);
    try {
      // Use Xendit if selected and enabled, otherwise fallback to PayMongo
      const useXendit = selectedGateway === 'xendit' && xenditConfig.enabled;

      if (useXendit) {
        const res = await fetch('/api/payments/create-xendit-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pppoe_username: clientInfo.pppoeUsername,
            plan_name: currentPlanName,
            amount: Number(currentPlanPrice),
            duration_days: selectedPlan?.cycle_days || 30,
            router_id: clientInfo.routerId || '',
            planType: 'pppoe',
            planId: selectedPlan?.id || '',
            paymentMethod: selectedPaymentMethod,
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error || 'Failed to create Xendit checkout');
        if (data.checkout_url) {
          window.location.href = data.checkout_url;
        } else {
          throw new Error('No checkout URL returned from Xendit');
        }
      } else {
        const res = await fetch('/api/payments/create-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: Number(currentPlanPrice),
            description: `${currentPlanName} Subscription Payment`,
            pppoeUsername: clientInfo.pppoeUsername,
            planName: currentPlanName,
            paymentMethod: selectedPaymentMethod,
            successUrl: `${window.location.origin}/client_portal?payment=success`,
            cancelUrl: `${window.location.origin}/client_portal?payment=cancelled`
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to create PayMongo checkout session');
        if (data.checkout_url) {
          window.location.href = data.checkout_url;
        } else {
          throw new Error('No checkout URL returned');
        }
      }
    } catch (e) {
      console.error('Payment initiation failed:', e);
      setError(`Payment error: ${(e as Error).message}`);
    } finally {
      setIsPaying(false);
    }
  };

  // Reusable receipt overlay shown after successful PayMongo redirect
  const paymentReceiptOverlay = paymentReceipt && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-500 to-green-600 px-6 py-5 text-white text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-white/20 flex items-center justify-center mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold">Payment Successful</h2>
          <p className="text-sm opacity-90 mt-1">Your renewal is being processed</p>
        </div>
        <div className="p-6 space-y-4 text-slate-700 dark:text-slate-200">
          <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
            <span className="text-slate-500 dark:text-slate-400">Invoice No.</span>
            <span className="font-semibold">{paymentReceipt.invoice}</span>
          </div>
          <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
            <span className="text-slate-500 dark:text-slate-400">PPPoE User</span>
            <span className="font-semibold">{paymentReceipt.user}</span>
          </div>
          <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
            <span className="text-slate-500 dark:text-slate-400">Amount Paid</span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400 text-lg">
              ₱{Number(paymentReceipt.amount).toFixed(2)}
            </span>
          </div>
          {paymentReceipt.base && paymentReceipt.fee && (
            <div className="text-xs bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-700 rounded p-2 space-y-1">
              <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Plan Amount:</span><span>₱{Number(paymentReceipt.base).toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Convenience Fee{paymentReceipt.method ? ` (${paymentReceipt.method.toUpperCase()})` : ''}:</span><span>₱{Number(paymentReceipt.fee).toFixed(2)}</span></div>
              <div className="flex justify-between font-semibold pt-1 border-t border-slate-200 dark:border-slate-600"><span>Total Charged:</span><span className="text-emerald-600 dark:text-emerald-400">₱{Number(paymentReceipt.amount).toFixed(2)}</span></div>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">Date</span>
            <span className="font-semibold">{paymentReceipt.date}</span>
          </div>
          <p className="text-xs text-center text-slate-500 dark:text-slate-400 pt-2">
            Your subscription will be reactivated shortly. Please allow a few minutes for the system to apply your renewal.
          </p>
          <button
            onClick={() => setPaymentReceipt(null)}
            className="w-full mt-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  if (view === 'dashboard') {
    const selectedPlan = billingPlans.find(p => p.id === selectedPlanId);
    const planName = selectedPlan?.name || status?.planName || status?.profile || 'Unknown';
    const planPrice = selectedPlan?.price ?? status?.planPrice ?? payments[0]?.planPrice ?? payments[0]?.finalAmount ?? null;
    const activeGatewayConfig = selectedGateway === 'xendit' && xenditConfig.enabled ? xenditConfig : paymongoConfig;

    // Determine subscription status by profile + due date, NOT by whether
    // the PPPoE session is currently connected. A user who is temporarily
    // offline but has a valid subscription should still show "Active".
    const isNonPaymentProfile = (status?.profile || '').toLowerCase() === 'non-payment';
    const dueDateStr = status?.comment || '';
    // Compare due date to current date in UTC so timezone offsets don't
    // make a future due date appear expired.
    const isPastDue = dueDateStr
      ? new Date(dueDateStr + (dueDateStr.includes('T') ? '' : 'T23:59:59Z')).getTime() < Date.now()
      : false;
    const overallStatus = isNonPaymentProfile || isPastDue ? 'Expired' : 'Active';
    const isConnected = !!status?.active;
    const lastPayment = payments[0] || null;
    const expires = status?.comment || (lastPayment?.newExpiry || lastPayment?.date);
    
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-6">
        {paymentReceiptOverlay}
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-4 rounded shadow">
            <h1 className="text-2xl font-semibold text-slate-800 dark:text-white">
                Welcome, {clientInfo?.username}!
                <span className="ml-3 text-sm font-normal text-slate-600 dark:text-slate-300">Account Number: {clientInfo?.accountNumber || '—'}</span>
            </h1>
            <button onClick={() => { try { sessionStorage.removeItem('clientPortalSession'); } catch {}; setView('login'); setClientInfo(null); setUsername(''); setPassword(''); }} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">Logout</button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded shadow-sm">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 font-semibold text-slate-800 dark:text-white">Account Status</div>
                <div className="p-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <div><span className="font-medium text-slate-800 dark:text-slate-200">PPPoE Account:</span> {clientInfo?.pppoeUsername}</div>
                <div><span className="font-medium text-slate-800 dark:text-slate-200">Account Number:</span> {clientInfo?.accountNumber || '—'}</div>
                <div><span className="font-medium text-slate-800 dark:text-slate-200">Current Plan:</span> {planName}{planPrice != null ? ` (₱${Number(planPrice).toFixed(2)}${selectedPlan?.cycle === 'Quarterly' ? '/qtr' : selectedPlan?.cycle === 'Yearly' ? '/yr' : '/mo'})` : ''}</div>
                <div><span className="font-medium text-slate-800 dark:text-slate-200">Overall Status:</span> <span className={`px-2 py-1 rounded text-xs font-bold ${overallStatus === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-yellow-100 text-yellow-700'}`}>{overallStatus}</span></div>
                <div><span className="font-medium text-slate-800 dark:text-slate-200">Connection:</span> <span className={`px-2 py-1 rounded text-xs font-bold ${isConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{isConnected ? 'Online' : 'Offline'}</span></div>
                <div><span className="font-medium text-slate-800 dark:text-slate-200">Subscription Expires:</span> {expires || 'Unknown'}</div>
                
                {/* Available Billing Plans */}
                {billingPlans.length > 0 && (
                  <div className="pt-3">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Select Plan to Pay</label>
                    <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto">
                      {billingPlans.map(plan => (
                        <button
                          key={plan.id}
                          onClick={() => setSelectedPlanId(plan.id)}
                          className={`flex items-center justify-between px-3 py-2 rounded-lg border text-left text-sm transition-all ${
                            selectedPlanId === plan.id
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-500'
                              : 'border-slate-200 dark:border-slate-600 hover:border-blue-300 dark:hover:border-blue-500'
                          }`}
                        >
                          <div>
                            <div className="font-medium text-slate-800 dark:text-slate-200">{plan.name}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {plan.cycle || 'Monthly'} • {plan.billingType || 'prepaid'}
                              {plan.pppoeProfile ? ` • Profile: ${plan.pppoeProfile}` : ''}
                            </div>
                          </div>
                          <div className="text-right shrink-0 ml-3">
                            <div className="font-bold text-slate-800 dark:text-slate-200">₱{Number(plan.price || 0).toFixed(2)}</div>
                            {selectedPlanId === plan.id && (
                              <svg className="w-4 h-4 text-blue-500 ml-auto mt-0.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Payment Gateway Selector */}
                {(paymongoConfig.enabled || xenditConfig.enabled) && (
                  <div className="pt-3">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Payment Gateway</label>
                    <div className="flex gap-2">
                      {paymongoConfig.enabled && (
                        <button
                          onClick={() => setSelectedGateway('paymongo')}
                          className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                            selectedGateway === 'paymongo'
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500'
                              : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-blue-300'
                          }`}
                        >
                          PayMongo
                        </button>
                      )}
                      {xenditConfig.enabled && (
                        <button
                          onClick={() => setSelectedGateway('xendit')}
                          className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                            selectedGateway === 'xendit'
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500'
                              : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-blue-300'
                          }`}
                        >
                          Xendit
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="pt-4">
                    <button
                      onClick={handlePayNow}
                      disabled={isPaying}
                      className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white rounded font-medium transition-colors"
                    >
                      {isPaying ? 'Redirecting to payment...' : `Pay Now${selectedPlan ? ` — ₱${Number(selectedPlan.price).toFixed(2)}` : planPrice != null ? ` — ₱${Number(planPrice).toFixed(2)}` : ''}`}
                    </button>
                    {activeGatewayConfig.passFeesToCustomer && planPrice && (() => {
                      const base = Number(planPrice);
                      const isXendit = selectedGateway === 'xendit' && xenditConfig.enabled;
                      const computeTotal = (m: string) => {
                        if (isXendit) {
                          if (m === 'card') return (base + 15) / (1 - 0.035);
                          if (m === 'qrph') return base / (1 - 0.020);
                          if (['gcash', 'maya'].includes(m)) return base / (1 - 0.025);
                          return base / (1 - 0.029);
                        }
                        // PayMongo
                        if (m === 'card') return (base + 15) / (1 - 0.035);
                        if (m === 'qrph') return base / (1 - 0.020);
                        return base / (1 - 0.029);
                      };
                      const total = Math.round(computeTotal(selectedPaymentMethod) * 100) / 100;
                      const fee = Math.round((total - base) * 100) / 100;
                      return (
                        <div className="mt-3 space-y-2">
                          <div className="text-xs p-2 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
                            ⚠️ A small convenience fee will be added to your total bill by the payment gateway.
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Choose Payment Method</label>
                            <select
                              value={selectedPaymentMethod}
                              onChange={e => setSelectedPaymentMethod(e.target.value as any)}
                              className="w-full px-2 py-1.5 text-sm border rounded-md dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                            >
                              <option value="gcash">GCash ({isXendit ? '2.5%' : '2.9%'})</option>
                              <option value="paymaya">Maya ({isXendit ? '2.5%' : '2.9%'})</option>
                              {selectedGateway === 'paymongo' && <option value="grab_pay">GrabPay (2.9%)</option>}
                              <option value="qrph">QRPh (2.0%)</option>
                              <option value="card">Credit/Debit Card (3.5% + ₱15)</option>
                            </select>
                          </div>
                          <div className="text-xs bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-700 rounded p-2 space-y-1">
                            <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Plan Amount:</span><span>₱{base.toFixed(2)}</span></div>
                            <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Convenience Fee:</span><span>₱{fee.toFixed(2)}</span></div>
                            <div className="flex justify-between font-semibold pt-1 border-t border-slate-200 dark:border-slate-600"><span>Total to Pay:</span><span className="text-emerald-600 dark:text-emerald-400">₱{total.toFixed(2)}</span></div>
                          </div>
                        </div>
                      );
                    })()}
                </div>
                </div>
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded shadow-sm">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 font-semibold text-slate-800 dark:text-white">Invoices (Auto)</div>
                <div className="p-4">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-slate-600 dark:text-slate-300">
                    <thead className="text-xs text-slate-700 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-700/50">
                        <tr>
                        <th className="px-4 py-2">Issued</th>
                        <th className="px-4 py-2">Due</th>
                        <th className="px-4 py-2">Plan</th>
                        <th className="px-4 py-2">Amount</th>
                        <th className="px-4 py-2">Status</th>
                        <th className="px-4 py-2">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {invoices.map((inv, i) => (
                        <tr key={i} className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                            <td className="px-4 py-2">{inv.issueDate ? new Date(inv.issueDate).toLocaleString() : '—'}</td>
                            <td className="px-4 py-2">{inv.dueDateTime ? new Date(inv.dueDateTime).toLocaleString() : '—'}</td>
                            <td className="px-4 py-2">{inv.planName || '—'}</td>
                            <td className="px-4 py-2">₱{Number(inv.amount || 0).toFixed(2)}</td>
                            <td className="px-4 py-2">{inv.status || 'PENDING'}</td>
                            <td className="px-4 py-2">
                              <button onClick={() => setInvoiceToView(inv)} className="px-3 py-1 bg-slate-600 hover:bg-slate-700 text-white rounded-md">View</button>
                            </td>
                        </tr>
                        ))}
                        {invoices.length === 0 && (
                        <tr>
                            <td colSpan={6} className="px-4 py-6 text-center text-slate-500">No invoices.</td>
                        </tr>
                        )}
                    </tbody>
                    </table>
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
                        <th className="px-4 py-2">Account Number</th>
                        <th className="px-4 py-2">Amount</th>
                        <th className="px-4 py-2">Cycle</th>
                        <th className="px-4 py-2">Expiry</th>
                        </tr>
                    </thead>
                    <tbody>
                        {payments.map((p, i) => (
                        <tr key={i} className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                            <td className="px-4 py-2">{p.date ? new Date(p.date).toLocaleDateString() : '—'}</td>
                            <td className="px-4 py-2">{clientInfo?.accountNumber || '—'}</td>
                            <td className="px-4 py-2">₱{Number(p.finalAmount ?? p.planPrice ?? 0).toFixed(2)}</td>
                            <td className="px-4 py-2">{p.months ?? p.cycle ?? '1'} mo</td>
                            <td className="px-4 py-2">{p.newExpiry || '—'}</td>
                        </tr>
                        ))}
                        {payments.length === 0 && (
                        <tr>
                            <td colSpan={5} className="px-4 py-6 text-center text-slate-500">No payments found.</td>
                        </tr>
                        )}
                    </tbody>
                    </table>
                </div>
                </div>
            </div>
            </div>
            
            {/* Report an Issue / Repair Tickets Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded shadow-sm">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 font-semibold text-slate-800 dark:text-white">Report an Issue</div>
                <div className="p-4 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Issue Type</label>
                    <select value={ticketCategory} onChange={e => setTicketCategory(e.target.value)} className="w-full px-3 py-2 border rounded-md dark:bg-slate-700 dark:border-slate-600 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                      <option value="no_internet">No Internet</option>
                      <option value="slow_connection">Slow Connection</option>
                      <option value="intermittent">Intermittent Connection</option>
                      <option value="line_issue">Line / Cable Issue</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description</label>
                    <textarea value={ticketDescription} onChange={e => setTicketDescription(e.target.value)} rows={3} className="w-full px-3 py-2 border rounded-md dark:bg-slate-700 dark:border-slate-600 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Describe your issue..." />
                  </div>
                  <button onClick={handleSubmitTicket} disabled={isSubmittingTicket} className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-medium transition-colors disabled:opacity-50">
                    {isSubmittingTicket ? 'Submitting...' : 'Submit Repair Ticket'}
                  </button>
                  {ticketFeedback && (
                    <div className={`text-sm text-center p-2 rounded ${ticketFeedback.startsWith('Error') ? 'text-red-600 bg-red-50 dark:bg-red-900/20' : 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20'}`}>{ticketFeedback}</div>
                  )}
                </div>
              </div>
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded shadow-sm">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 font-semibold text-slate-800 dark:text-white">My Tickets</div>
                <div className="p-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-slate-600 dark:text-slate-300">
                      <thead className="text-xs text-slate-700 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-700/50">
                        <tr>
                          <th className="px-3 py-2">Date</th>
                          <th className="px-3 py-2">Issue</th>
                          <th className="px-3 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tickets.map((t, i) => (
                          <tr key={i} className="border-b border-slate-100 dark:border-slate-700">
                            <td className="px-3 py-2 text-xs">{t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}</td>
                            <td className="px-3 py-2">{
                              t.category === 'no_internet' ? 'No Internet' :
                              t.category === 'slow_connection' ? 'Slow Connection' :
                              t.category === 'intermittent' ? 'Intermittent' :
                              t.category === 'line_issue' ? 'Line Issue' : 'Other'
                            }</td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                                t.status === 'open' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400' :
                                t.status === 'in_progress' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400' :
                                t.status === 'resolved' ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400' :
                                'bg-slate-200 text-slate-600 dark:bg-slate-600/50 dark:text-slate-400'
                              }`}>{t.status === 'in_progress' ? 'In Progress' : t.status?.charAt(0).toUpperCase() + t.status?.slice(1)}</span>
                            </td>
                          </tr>
                        ))}
                        {tickets.length === 0 && (
                          <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-500">No tickets submitted.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {invoiceToView && (
              <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 no-print">
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg w-full max-w-2xl">
                  <div className="px-6 py-4 border-b dark:border-slate-700 flex justify-between items-center">
                    <h3 className="text-lg font-semibold">Invoice</h3>
                    <div className="flex items-center gap-2">
                      {String(invoiceToView.status).toUpperCase() === 'PAID' && (
                        <button onClick={handlePrintInvoice} className="px-3 py-1 bg-sky-600 hover:bg-sky-700 text-white rounded-md">Print Invoice</button>
                      )}
                      <button onClick={() => setInvoiceToView(null)} className="px-3 py-1 bg-slate-200 dark:bg-slate-700 rounded-md">Close</button>
                    </div>
                  </div>
                  <div className="p-6 space-y-4">
                    <div className="flex justify-between items-start">
                      <div className="w-2/3">
                        <div className="text-2xl font-bold">{panelSettings?.companyName || 'Your Company'}</div>
                        {panelSettings?.address && <div className="text-sm">{panelSettings.address}</div>}
                        {panelSettings?.contactNumber && <div className="text-sm">{panelSettings.contactNumber}</div>}
                        {panelSettings?.email && <div className="text-sm">{panelSettings.email}</div>}
                      </div>
                      {panelSettings?.logoBase64 && (
                        <div className="w-1/3 flex justify-end">
                          <img src={panelSettings.logoBase64} alt="" className="h-12 w-auto object-contain" />
                        </div>
                      )}
                    </div>
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-semibold">Billed To</div>
                        <div>{invoiceToView.username}</div>
                        {clientInfo?.accountNumber && <div className="text-sm">Account: {clientInfo.accountNumber}</div>}
                      </div>
                      <div className="text-right">
                        <div className="font-semibold">INVOICE</div>
                        <div>Issued: {invoiceToView.issueDate ? new Date(invoiceToView.issueDate).toLocaleString() : '—'}</div>
                        <div>Due: {invoiceToView.dueDateTime ? new Date(invoiceToView.dueDateTime).toLocaleString() : '—'}</div>
                        <div className={`inline-block mt-1 px-2 py-1 rounded text-xs font-bold ${String(invoiceToView.status).toUpperCase() === 'PAID' ? 'bg-emerald-100 text-emerald-700' : 'bg-yellow-100 text-yellow-700'}`}>{String(invoiceToView.status || 'PENDING').toUpperCase()}</div>
                      </div>
                    </div>
                    <div className="border rounded">
                      <div className="grid grid-cols-2 text-sm">
                        <div className="p-3 border-r">Plan</div>
                        <div className="p-3">{invoiceToView.planName || '—'}</div>
                        <div className="p-3 border-r">Amount</div>
                        <div className="p-3">₱{Number(invoiceToView.amount || 0).toFixed(2)}</div>
                        <div className="p-3 border-r">Currency</div>
                        <div className="p-3">{invoiceToView.currency || 'PHP'}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className={invoiceToPrint ? 'printable-area' : 'hidden'}>
              {invoiceToPrint && panelSettings && (
                <div className="p-8 font-sans text-black bg-white">
                  <header className="flex justify-between items-start pb-4 border-b-2 border-black">
                    <div className="w-2/3">
                      <div className="text-3xl font-bold">{panelSettings.companyName || 'Your Company'}</div>
                      {panelSettings.address && <div className="text-sm">{panelSettings.address}</div>}
                      {panelSettings.contactNumber && <div className="text-sm">{panelSettings.contactNumber}</div>}
                      {panelSettings.email && <div className="text-sm">{panelSettings.email}</div>}
                    </div>
                    {panelSettings.logoBase64 && (
                      <div className="w-1/3 flex justify-end">
                        <img src={panelSettings.logoBase64} alt="" className="h-16 w-auto object-contain" />
                      </div>
                    )}
                  </header>
                  <section className="my-6">
                    <div className="flex justify-between">
                      <div>
                        <div className="font-bold">BILLED TO:</div>
                        <div>{invoiceToPrint.username}</div>
                        {clientInfo?.accountNumber && <div className="text-sm">Account: {clientInfo.accountNumber}</div>}
                      </div>
                      <div className="text-right">
                        <div className="font-bold">INVOICE</div>
                        <div>Issued: {invoiceToPrint.issueDate ? new Date(invoiceToPrint.issueDate).toLocaleDateString() : '—'}</div>
                        <div>Due: {invoiceToPrint.dueDateTime ? new Date(invoiceToPrint.dueDateTime).toLocaleDateString() : '—'}</div>
                        <div>Status: {String(invoiceToPrint.status || 'PENDING').toUpperCase()}</div>
                      </div>
                    </div>
                  </section>
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-200">
                      <tr>
                        <th className="p-2 border border-black">DESCRIPTION</th>
                        <th className="p-2 border border-black text-right">AMOUNT</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="p-2 border border-black">
                          <div className="font-semibold">{invoiceToPrint.planName || 'Subscription'}</div>
                          <div className="text-xs text-gray-600">Internet Plan Subscription</div>
                        </td>
                        <td className="p-2 border border-black text-right">₱{Number(invoiceToPrint.amount || 0).toFixed(2)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <section className="my-6 flex justify-end">
                    <div className="w-1/2">
                      <div className="flex justify-between font-bold text-xl mt-2 pt-2 border-t-2 border-black">
                        <span>TOTAL:</span>
                        <span>₱{Number(invoiceToPrint.amount || 0).toFixed(2)}</span>
                      </div>
                    </div>
                  </section>
                  <footer className="mt-8 pt-4 border-t-2 border-dashed border-black text-center">
                    <div className="font-bold">Thank you!</div>
                    <div className="text-xs mt-2">This is an invoice document.</div>
                  </footer>
                </div>
              )}
            </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-900 p-4">
        {paymentReceiptOverlay}
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
