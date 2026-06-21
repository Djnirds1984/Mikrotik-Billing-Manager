import React, { useState, useEffect } from 'react';
import { Loader } from './Loader.tsx';

interface Plan {
  id: string;
  name: string;
  price: number;
  cycle?: string;
  cycle_days?: number;
  pppoeProfile?: string;
  description?: string;
  currency: string;
  planType: 'pppoe' | 'dhcp';
  routerId: string;
}

interface Customer {
  id: string;
  username: string;
  fullName: string;
  accountNumber: string;
  routerId: string;
  dueDate?: string;
  planName?: string;
}

export const Store: React.FC = () => {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'paymongo' | 'manual' | null>(null);
  const [processing, setProcessing] = useState(false);
  const [gcashRef, setGcashRef] = useState('');
  const [filter, setFilter] = useState<'all' | 'pppoe' | 'dhcp'>('all');
  const [autoLoginLoading, setAutoLoginLoading] = useState(true);

  // Restore session on mount (supports both regular session and auto-login from expired portal)
  useEffect(() => {
    const restoreSession = async () => {
      try {
        // Check for auto-login token from expired portal redirect
        const params = new URLSearchParams(window.location.search);
        const sessionToken = params.get('session');

        if (sessionToken) {
          // Auto-login from expired portal - verify token
          setAutoLoginLoading(true);
          const resp = await fetch('/api/public/expired/verify-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: sessionToken })
          });

          if (resp.ok) {
            const customerData = await resp.json();
            // Map to Customer interface
            const customer: Customer = {
              id: customerData.id,
              username: customerData.pppoeUsername || customerData.username,
              fullName: customerData.fullName || customerData.username,
              accountNumber: customerData.accountNumber,
              routerId: customerData.routerId,
            };
            setCustomer(customer);
            sessionStorage.setItem('storeSession', JSON.stringify(customer));
            // Clean up URL
            window.history.replaceState({}, '', '/store');
            setAutoLoginLoading(false);
            return;
          } else {
            // Token invalid/expired - clean URL and show login
            window.history.replaceState({}, '', '/store');
          }
        }

        // Restore regular saved session
        const savedSession = sessionStorage.getItem('storeSession');
        if (savedSession) {
          try {
            const sessionData = JSON.parse(savedSession);
            setCustomer(sessionData);
          } catch (e) {
            console.error('Failed to restore session:', e);
          }
        }
      } catch (e) {
        console.error('Session restore error:', e);
      } finally {
        setAutoLoginLoading(false);
      }
    };

    restoreSession();
  }, []);

  useEffect(() => {
    if (customer) {
      // After login, load plans for customer's router
      loadPlans(customer.routerId);
    } else {
      // Before login, load all plans (for browsing)
      loadPlans();
    }
  }, [filter, customer]);

  const loadPlans = async (routerId?: string) => {
    try {
      setLoading(true);
      const url = routerId 
        ? `/api/public/store/plans?type=${filter}&routerId=${routerId}`
        : `/api/public/store/plans?type=${filter}`;
      
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setPlans(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Failed to load plans:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!loginForm.username || !loginForm.password) {
      setLoginError('Please enter username and password');
      return;
    }

    setLoginError('');
    try {
      const response = await fetch('/api/public/client-portal/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });

      const data = await response.json();

      if (!response.ok) {
        setLoginError(data.message || 'Login failed');
        return;
      }

      setCustomer(data);
      sessionStorage.setItem('storeSession', JSON.stringify(data));
      
      // Reload plans for this customer's router
      loadPlans(data.routerId);
    } catch (error) {
      setLoginError('Login failed. Please try again.');
    }
  };

  const handleLogout = () => {
    setCustomer(null);
    setSelectedPlan(null);
    setPaymentMethod(null);
    sessionStorage.removeItem('storeSession');
  };

  const handlePurchase = async () => {
    if (!selectedPlan || !customer || !paymentMethod) return;

    setProcessing(true);
    try {
      const response = await fetch('/api/public/store/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: selectedPlan.id,
          planType: selectedPlan.planType,
          paymentMethod,
          customerUsername: customer.username,
          routerId: customer.routerId,
          gcashReference: paymentMethod === 'manual' ? gcashRef : undefined
        })
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.message || 'Purchase failed');
        return;
      }

      if (paymentMethod === 'paymongo' && data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else if (paymentMethod === 'manual') {
        alert(`Payment submitted! Reference: ${data.paymentId}\n\nPlease wait for admin approval.`);
        setSelectedPlan(null);
        setPaymentMethod(null);
        setGcashRef('');
      }
    } catch (error) {
      alert('Purchase failed. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const formatPrice = (price: number, currency: string) => {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: currency || 'PHP'
    }).format(price);
  };

  // Login Screen
  if (autoLoginLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-6">
        <div className="text-center">
          <Loader />
          <p className="mt-4 text-slate-600 dark:text-slate-400">Verifying your session...</p>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-8">
          <div className="text-center mb-8">
            <div className="text-6xl mb-4">🛒</div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Customer Store</h1>
            <p className="text-slate-600 dark:text-slate-400 mt-2">Login to browse and purchase plans</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Username
              </label>
              <input
                type="text"
                value={loginForm.username}
                onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                placeholder="Enter your username"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Password
              </label>
              <input
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                placeholder="Enter your password"
              />
            </div>

            {loginError && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-red-700 dark:text-red-300 text-sm">{loginError}</p>
              </div>
            )}

            <button
              onClick={handleLogin}
              className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
            >
              Login to Store
            </button>
          </div>

          <div className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
            <p>Don't have an account? Contact your service provider.</p>
          </div>
        </div>
      </div>
    );
  }

  // Store Main Screen
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-6">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-8">
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">🛒 Customer Store</h1>
            <p className="text-slate-600 dark:text-slate-400 mt-1">
              Welcome, <span className="font-semibold">{customer.fullName || customer.username}</span>!
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Account: {customer.accountNumber}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            All Plans
          </button>
          <button
            onClick={() => setFilter('pppoe')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'pppoe'
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            PPPoE Plans
          </button>
          <button
            onClick={() => setFilter('dhcp')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'dhcp'
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            DHCP Plans
          </button>
        </div>
      </div>

      {/* Plans Grid */}
      <div className="max-w-7xl mx-auto">
        {loading ? (
          <div className="flex justify-center p-12">
            <Loader />
          </div>
        ) : plans.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-xl">
            <div className="text-6xl mb-4">📦</div>
            <h3 className="text-xl font-semibold text-slate-900 dark:text-white">No plans available</h3>
            <p className="text-slate-600 dark:text-slate-400 mt-2">Check back later for available plans.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className="bg-white dark:bg-slate-800 rounded-xl shadow-lg border-2 border-transparent hover:border-blue-500 transition-all overflow-hidden"
              >
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">{plan.name}</h3>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      plan.planType === 'pppoe'
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                        : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                    }`}>
                      {plan.planType.toUpperCase()}
                    </span>
                  </div>

                  <div className="mb-4">
                    <span className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                      {formatPrice(plan.price, plan.currency)}
                    </span>
                    <span className="text-slate-600 dark:text-slate-400 ml-2">
                      / {plan.planType === 'pppoe' ? plan.cycle : `${plan.cycle_days} days`}
                    </span>
                  </div>

                  {plan.description && (
                    <p className="text-slate-600 dark:text-slate-400 mb-4 text-sm">{plan.description}</p>
                  )}

                  {plan.pppoeProfile && (
                    <div className="mb-4 p-3 bg-slate-50 dark:bg-slate-700 rounded-lg">
                      <p className="text-sm text-slate-700 dark:text-slate-300">
                        <span className="font-semibold">Profile:</span> {plan.pppoeProfile}
                      </p>
                    </div>
                  )}

                  <button
                    onClick={() => {
                      setSelectedPlan(plan);
                      setPaymentMethod(null);
                    }}
                    className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
                  >
                    Purchase Plan
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Payment Modal */}
      {selectedPlan && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Complete Purchase</h2>
              <button
                onClick={() => {
                  setSelectedPlan(null);
                  setPaymentMethod(null);
                  setGcashRef('');
                }}
                className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <p className="font-semibold text-slate-900 dark:text-white">{selectedPlan.name}</p>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-2">
                {formatPrice(selectedPlan.price, selectedPlan.currency)}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                {selectedPlan.planType === 'pppoe' ? selectedPlan.cycle : `${selectedPlan.cycle_days} days`}
              </p>
            </div>

            <div className="space-y-3 mb-6">
              <p className="font-medium text-slate-700 dark:text-slate-300">Select Payment Method:</p>
              
              <button
                onClick={() => setPaymentMethod('paymongo')}
                className={`w-full p-4 border-2 rounded-lg text-left transition-all ${
                  paymentMethod === 'paymongo'
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-slate-200 dark:border-slate-600 hover:border-blue-300'
                }`}
              >
                <div className="font-semibold text-slate-900 dark:text-white">💳 Online Payment</div>
                <div className="text-sm text-slate-600 dark:text-slate-400">PayMongo (Card, GCash, Maya)</div>
              </button>

              <button
                onClick={() => setPaymentMethod('manual')}
                className={`w-full p-4 border-2 rounded-lg text-left transition-all ${
                  paymentMethod === 'manual'
                    ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                    : 'border-slate-200 dark:border-slate-600 hover:border-green-300'
                }`}
              >
                <div className="font-semibold text-slate-900 dark:text-white">📱 Manual GCash</div>
                <div className="text-sm text-slate-600 dark:text-slate-400">Send to GCash, wait for approval</div>
              </button>
            </div>

            {paymentMethod === 'manual' && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  GCash Reference Number
                </label>
                <input
                  type="text"
                  value={gcashRef}
                  onChange={(e) => setGcashRef(e.target.value)}
                  className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                  placeholder="Enter your GCash reference number"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  You'll find this in your GCash transaction receipt
                </p>
              </div>
            )}

            <button
              onClick={handlePurchase}
              disabled={processing || (paymentMethod === 'manual' && !gcashRef)}
              className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold rounded-lg transition-colors"
            >
              {processing ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin">⏳</span>
                  Processing...
                </span>
              ) : (
                `Pay ${formatPrice(selectedPlan.price, selectedPlan.currency)}`
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Store;
