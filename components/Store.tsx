import React, { useState, useEffect, useRef } from 'react';
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
  billingType?: 'prepaid' | 'postpaid';
  routerId: string;
}

interface CustomerInfo {
  fullName: string;
  username: string;
  routerId: string;
  accountNumber: string;
  routerName: string;
  contactNumber: string;
  billingType?: 'prepaid' | 'postpaid';
}

export const Store: React.FC = () => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [filter, setFilter] = useState<'all' | 'pppoe' | 'dhcp'>('all');
  const [customerBillingType, setCustomerBillingType] = useState<'prepaid' | 'postpaid' | null>(null);
  const [storeSettings, setStoreSettings] = useState<{
    storeEnabled: boolean;
    storeBannerText: string;
    paymentMethods: { paymongo: boolean; manualGcash: boolean };
    gcashNumber: string;
    gcashAccountName: string;
    currency: string;
    storeTheme: 'modern' | 'dark-premium' | 'colorful' | 'minimal';
  } | null>(null);

  // Purchase modal state
  const [accountInput, setAccountInput] = useState('');
  const [lookupMode, setLookupMode] = useState<'accountNumber' | 'username'>('accountNumber');
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'paymongo' | 'manual' | null>(null);
  const [gcashRef, setGcashRef] = useState('');
  const [processing, setProcessing] = useState(false);
  const loadPlansRef = useRef(0);

  // Load store settings
  useEffect(() => {
    fetch('/api/public/store-settings')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setStoreSettings(data); })
      .catch(() => {});
  }, []);

  // Load all plans on mount and when filter or customerBillingType changes
  useEffect(() => {
    loadPlans();
  }, [filter, customerBillingType]);

  // Check for expired session token to pre-fill account
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionToken = params.get('session');
    if (sessionToken) {
      verifySessionToken(sessionToken);
    }
  }, []);

  const verifySessionToken = async (token: string) => {
    try {
      const resp = await fetch('/api/public/expired/verify-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      if (resp.ok) {
        const data = await resp.json();
        // Pre-fill account from session
        if (data.accountNumber) {
          setAccountInput(data.accountNumber);
          setLookupMode('accountNumber');
          // Auto-lookup
          handleLookup('accountNumber', data.accountNumber);
        } else if (data.pppoeUsername) {
          setAccountInput(data.pppoeUsername);
          setLookupMode('username');
          handleLookup('username', data.pppoeUsername);
        }
      }
    } catch (e) {
      console.error('Session verification error:', e);
    } finally {
      window.history.replaceState({}, '', '/store');
    }
  };

  const loadPlans = async (billingType?: string) => {
    const requestId = ++loadPlansRef.current;
    try {
      setLoading(true);
      const effectiveBillingType = billingType || customerBillingType;
      const params = new URLSearchParams({ type: filter });
      if (effectiveBillingType) params.set('billingType', effectiveBillingType);
      const response = await fetch(`/api/public/store/plans?${params.toString()}`);
      // Only update state if this is still the latest request
      if (requestId !== loadPlansRef.current) return;
      if (response.ok) {
        const data = await response.json();
        setPlans(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      if (requestId !== loadPlansRef.current) return;
      console.error('Failed to load plans:', error);
    } finally {
      if (requestId === loadPlansRef.current) setLoading(false);
    }
  };

  const handleLookup = async (mode?: string, value?: string) => {
    const effectiveMode = mode || lookupMode;
    const effectiveValue = value !== undefined ? value : accountInput;
    
    if (!effectiveValue.trim()) {
      setLookupError('Please enter an account number or username');
      return;
    }

    setLookingUp(true);
    setLookupError('');
    setCustomerInfo(null);

    try {
      const param = effectiveMode === 'accountNumber' 
        ? `accountNumber=${encodeURIComponent(effectiveValue)}`
        : `username=${encodeURIComponent(effectiveValue)}`;
      
      const resp = await fetch(`/api/public/store/lookup-account?${param}`);
      const data = await resp.json();

      if (data.found) {
        const bt = (data.billingType || 'prepaid') as 'prepaid' | 'postpaid';
        setCustomerInfo({
          fullName: data.fullName,
          username: data.username,
          routerId: data.routerId,
          accountNumber: data.accountNumber,
          routerName: data.routerName,
          contactNumber: data.contactNumber,
          billingType: bt
        });
        setCustomerBillingType(bt);
        setLookupError('');
        // Reload plans filtered by customer's billing type
        loadPlans(bt);
      } else {
        setLookupError('Account not found. Please check your account number or PPPoE username.');
      }
    } catch (e) {
      setLookupError('Lookup failed. Please try again.');
    } finally {
      setLookingUp(false);
    }
  };

  const handleAutoDetect = async () => {
    setLookingUp(true);
    setLookupError('');
    try {
      // Use IP auto-detection via the expired lookup endpoint
      const resp = await fetch('/api/public/expired/lookup?auto=true');
      if (resp.ok) {
        const data = await resp.json();
        if (data.accountNumber || data.username) {
          const bt = (data.planType || data.billingType || 'prepaid') as 'prepaid' | 'postpaid';
          setCustomerInfo({
            fullName: data.fullName || data.username,
            username: data.pppoeUsername || data.username,
            routerId: data.routerId,
            accountNumber: data.accountNumber || '',
            routerName: data.routerName || '',
            contactNumber: data.contactNumber || '',
            billingType: bt
          });
          setAccountInput(data.accountNumber || data.pppoeUsername || data.username);
          setCustomerBillingType(bt);
          loadPlans(bt);
        } else {
          setLookupError('Could not detect your account from the network. Please enter your account number manually.');
        }
      } else {
        setLookupError('Auto-detection is not available. Please enter your account number manually.');
      }
    } catch (e) {
      setLookupError('Auto-detection failed. Please enter your account number manually.');
    } finally {
      setLookingUp(false);
    }
  };

  const handlePurchase = async () => {
    if (!selectedPlan || !customerInfo || !paymentMethod) return;

    setProcessing(true);
    try {
      const response = await fetch('/api/public/store/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: selectedPlan.id,
          planType: selectedPlan.planType,
          paymentMethod,
          accountNumber: customerInfo.accountNumber || undefined,
          pppoeUsername: customerInfo.username || undefined,
          routerId: customerInfo.routerId,
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
        closeModal();
      }
    } catch (error) {
      alert('Purchase failed. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const closeModal = () => {
    setSelectedPlan(null);
    setAccountInput('');
    setCustomerInfo(null);
    setLookupError('');
    setPaymentMethod(null);
    setGcashRef('');
    setLookupMode('accountNumber');
    setCustomerBillingType(null);
  };

  const getCurrency = (_planCurrency?: string) => {
    // Always use the system settings currency as the source of truth
    return storeSettings?.currency || 'PHP';
  };

  const formatPrice = (price: number, currency?: string) => {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: getCurrency(currency)
    }).format(price);
  };

  // Theme configurations
  const themeConfigs = {
    modern: {
      bg: 'bg-slate-50 dark:bg-slate-900',
      cardBg: 'bg-white dark:bg-slate-800',
      headerBg: 'bg-white dark:bg-slate-800',
      primaryBtn: 'bg-blue-600 hover:bg-blue-700',
      secondaryBtn: 'bg-blue-600 text-white',
      accentText: 'text-blue-600 dark:text-blue-400',
      borderColor: 'border-blue-500',
      badge: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
      filterActive: 'bg-blue-600 text-white',
      filterInactive: 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700',
      planCardBorder: 'border-transparent hover:border-blue-500',
      modalBg: 'bg-white dark:bg-slate-800',
      inputBg: 'bg-white dark:bg-slate-700',
    },
    'dark-premium': {
      bg: 'bg-slate-950 dark:bg-black',
      cardBg: 'bg-slate-900 dark:bg-slate-950',
      headerBg: 'bg-slate-900 dark:bg-slate-950',
      primaryBtn: 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700',
      secondaryBtn: 'bg-gradient-to-r from-purple-600 to-pink-600 text-white',
      accentText: 'text-purple-400 dark:text-purple-300',
      borderColor: 'border-purple-500',
      badge: 'bg-purple-900/30 text-purple-300 dark:text-purple-200',
      filterActive: 'bg-gradient-to-r from-purple-600 to-pink-600 text-white',
      filterInactive: 'bg-slate-900 dark:bg-slate-950 text-slate-300 hover:bg-slate-800 dark:hover:bg-slate-900',
      planCardBorder: 'border-purple-500/20 hover:border-purple-500',
      modalBg: 'bg-slate-900 dark:bg-slate-950',
      inputBg: 'bg-slate-800 dark:bg-slate-900',
    },
    colorful: {
      bg: 'bg-gradient-to-br from-yellow-50 via-pink-50 to-cyan-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900',
      cardBg: 'bg-white dark:bg-slate-800',
      headerBg: 'bg-white dark:bg-slate-800',
      primaryBtn: 'bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600',
      secondaryBtn: 'bg-gradient-to-r from-pink-500 to-rose-500 text-white',
      accentText: 'text-green-600 dark:text-green-400',
      borderColor: 'border-green-500',
      badge: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
      filterActive: 'bg-gradient-to-r from-green-500 to-emerald-500 text-white',
      filterInactive: 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700',
      planCardBorder: 'border-transparent hover:border-green-500',
      modalBg: 'bg-white dark:bg-slate-800',
      inputBg: 'bg-white dark:bg-slate-700',
    },
    minimal: {
      bg: 'bg-white dark:bg-slate-900',
      cardBg: 'bg-white dark:bg-slate-900',
      headerBg: 'bg-white dark:bg-slate-900',
      primaryBtn: 'bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-100',
      secondaryBtn: 'bg-slate-900 dark:bg-white text-white dark:text-slate-900',
      accentText: 'text-slate-900 dark:text-white',
      borderColor: 'border-slate-900 dark:border-white',
      badge: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
      filterActive: 'bg-slate-900 dark:bg-white text-white dark:text-slate-900',
      filterInactive: 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800',
      planCardBorder: 'border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500',
      modalBg: 'bg-white dark:bg-slate-900',
      inputBg: 'bg-white dark:bg-slate-900',
    },
  };

  const currentTheme = storeSettings?.storeTheme || 'modern';
  const theme = themeConfigs[currentTheme];

  return (
    <div className={`min-h-screen ${theme.bg} p-6`}>
      {/* Store Disabled Banner */}
      {storeSettings && !storeSettings.storeEnabled && (
        <div className="max-w-7xl mx-auto mb-6">
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-6 text-center">
            <p className="text-xl font-semibold text-amber-800 dark:text-amber-200">Store is currently unavailable</p>
            <p className="text-amber-600 dark:text-amber-300 mt-2">Our store is temporarily under maintenance. Please contact your service provider for assistance.</p>
          </div>
        </div>
      )}

      {/* Store Banner */}
      {storeSettings?.storeBannerText && (
        <div className="max-w-7xl mx-auto mb-6">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-4">
            <p className="text-blue-800 dark:text-blue-200 font-medium text-center">{storeSettings.storeBannerText}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="max-w-7xl mx-auto mb-8">
        <div className={`${theme.headerBg} rounded-xl shadow-lg p-6`}>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Customer Store</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">Browse and purchase internet plans</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'all'
                ? theme.filterActive
                : theme.filterInactive
            }`}
          >
            All Plans
          </button>
          <button
            onClick={() => setFilter('pppoe')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'pppoe'
                ? theme.filterActive
                : theme.filterInactive
            }`}
          >
            PPPoE Plans
          </button>
          <button
            onClick={() => setFilter('dhcp')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              filter === 'dhcp'
                ? theme.filterActive
                : theme.filterInactive
            }`}
          >
            DHCP Plans
          </button>
        </div>
      </div>

      {/* Plans Grid */}
      <div className="max-w-7xl mx-auto">
        {/* Billing Type Indicator */}
        {customerBillingType && (
          <div className="mb-4 flex items-center justify-center gap-2">
            <span className={`text-sm font-bold px-3 py-1 rounded-full ${
              customerBillingType === 'postpaid' 
                ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' 
                : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
            }`}>
              Showing {customerBillingType === 'postpaid' ? 'Postpaid' : 'Prepaid'} Plans
            </span>
          </div>
        )}
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
                className={`${theme.cardBg} rounded-xl shadow-lg border-2 ${theme.planCardBorder} transition-all overflow-hidden`}
              >
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">{plan.name}</h3>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${theme.badge}`}>
                      {plan.planType.toUpperCase()}
                    </span>
                  </div>

                  <div className="mb-4">
                    <span className={`text-3xl font-bold ${theme.accentText}`}>
                      {formatPrice(plan.price, plan.currency)}
                    </span>
                    <span className="text-slate-600 dark:text-slate-400 ml-2">
                      / {plan.cycle_days || 30} days
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
                      setCustomerInfo(null);
                      setAccountInput('');
                      setLookupError('');
                    }}
                    className={`w-full px-4 py-3 ${theme.primaryBtn} text-white font-semibold rounded-lg transition-colors`}
                  >
                    Purchase Plan
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Purchase Modal */}
      {selectedPlan && (
        <div className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4`}>
          <div className={`${theme.modalBg} rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto`}>
            {/* Modal Header */}
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Complete Purchase</h2>
              <button
                onClick={closeModal}
                className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 text-xl"
              >
                ✕
              </button>
            </div>

            {/* Plan Summary */}
            <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <p className="font-semibold text-slate-900 dark:text-white">{selectedPlan.name}</p>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-2">
                {formatPrice(selectedPlan.price, selectedPlan.currency)}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                {selectedPlan.cycle_days || 30} days
              </p>
            </div>

            {/* Step 1: Account Lookup */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">
                Step 1: Identify Your Account
              </h3>

              {customerInfo ? (
                <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold text-green-800 dark:text-green-200">Account Found</p>
                      <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                        <span className="font-medium">Name:</span> {customerInfo.fullName}
                      </p>
                      <p className="text-sm text-green-700 dark:text-green-300">
                        <span className="font-medium">Username:</span> {customerInfo.username}
                      </p>
                      {customerInfo.accountNumber && (
                        <p className="text-sm text-green-700 dark:text-green-300">
                          <span className="font-medium">Account #:</span> {customerInfo.accountNumber}
                        </p>
                      )}
                      {customerInfo.routerName && (
                        <p className="text-sm text-green-700 dark:text-green-300">
                          <span className="font-medium">Router:</span> {customerInfo.routerName}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => { setCustomerInfo(null); setAccountInput(''); }}
                      className="text-sm text-green-600 dark:text-green-400 hover:underline"
                    >
                      Change
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Lookup mode toggle */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setLookupMode('accountNumber'); setAccountInput(''); setLookupError(''); }}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        lookupMode === 'accountNumber'
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      Account Number
                    </button>
                    <button
                      onClick={() => { setLookupMode('username'); setAccountInput(''); setLookupError(''); }}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        lookupMode === 'username'
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      PPPoE Username
                    </button>
                  </div>

                  {/* Input field */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={accountInput}
                      onChange={(e) => setAccountInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
                      className="flex-1 px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                      placeholder={lookupMode === 'accountNumber' ? 'Enter your account number' : 'Enter your PPPoE username'}
                    />
                    <button
                      onClick={() => handleLookup()}
                      disabled={lookingUp}
                      className="px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-medium rounded-lg transition-colors whitespace-nowrap"
                    >
                      {lookingUp ? '...' : 'Find'}
                    </button>
                  </div>

                  {/* Auto-detect button */}
                  <button
                    onClick={handleAutoDetect}
                    disabled={lookingUp}
                    className="w-full px-4 py-2.5 border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg transition-colors text-sm font-medium"
                  >
                    Auto-detect my account from network
                  </button>

                  {/* Error message */}
                  {lookupError && (
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                      <p className="text-red-700 dark:text-red-300 text-sm">{lookupError}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Step 2: Payment Method (only shown after account found) */}
            {customerInfo && (
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">
                  Step 2: Select Payment Method
                </h3>
                <div className="space-y-3">
                  {(!storeSettings || storeSettings.paymentMethods.paymongo) && (
                    <button
                      onClick={() => setPaymentMethod('paymongo')}
                      className={`w-full p-4 border-2 rounded-lg text-left transition-all ${
                        paymentMethod === 'paymongo'
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-slate-200 dark:border-slate-600 hover:border-blue-300'
                      }`}
                    >
                      <div className="font-semibold text-slate-900 dark:text-white">Online Payment</div>
                      <div className="text-sm text-slate-600 dark:text-slate-400">Card, GCash, Maya via PayMongo</div>
                    </button>
                  )}

                  {(!storeSettings || storeSettings.paymentMethods.manualGcash) && (
                    <button
                      onClick={() => setPaymentMethod('manual')}
                      className={`w-full p-4 border-2 rounded-lg text-left transition-all ${
                        paymentMethod === 'manual'
                          ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                          : 'border-slate-200 dark:border-slate-600 hover:border-green-300'
                      }`}
                    >
                      <div className="font-semibold text-slate-900 dark:text-white">Manual GCash</div>
                      <div className="text-sm text-slate-600 dark:text-slate-400">Send to GCash, wait for admin approval</div>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Manual GCash Details */}
            {paymentMethod === 'manual' && customerInfo && (
              <div className="mb-6">
                {storeSettings?.gcashNumber && (
                  <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg">
                    <p className="text-sm font-semibold text-green-800 dark:text-green-200">Send payment to:</p>
                    <p className="text-lg font-bold text-green-900 dark:text-green-100">{storeSettings.gcashNumber}</p>
                    {storeSettings.gcashAccountName && (
                      <p className="text-sm text-green-700 dark:text-green-300">Account: {storeSettings.gcashAccountName}</p>
                    )}
                  </div>
                )}
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

            {/* Submit Button */}
            {customerInfo && paymentMethod && (
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
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Store;
