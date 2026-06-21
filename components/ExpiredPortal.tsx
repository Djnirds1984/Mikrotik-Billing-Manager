import React, { useState, useEffect, useRef } from 'react';
import { MikroTikLogoIcon, QuestionMarkCircleIcon } from '../constants.tsx';
import type { ChatMessage } from '../types.ts';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { useCompanySettings } from '../hooks/useCompanySettings.ts';
import { Loader } from './Loader.tsx';
import { CodeBlock } from './CodeBlock.tsx';

// Self-contained help chat widget (same pattern as CaptivePortalPage)
const ExpiredHelp: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [history, setHistory] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const [messageStatus, setMessageStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
    const [ip, setIp] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            const initialGreeting = `Hello! If you need help renewing your subscription, send a message to the administrator here.`;
            setHistory([{ role: 'model', content: initialGreeting }]);
            setMessageStatus('idle');
            setInput('');
        }
    }, [isOpen]);

    useEffect(() => {
        chatContainerRef.current?.scrollTo(0, chatContainerRef.current.scrollHeight);
    }, [history]);

    useEffect(() => {
        let timer: number | null = null;
        const loadThread = async () => {
            try {
                const resp = await fetch('/api/captive-thread');
                if (!resp.ok) return;
                const data = await resp.json();
                const msgs: ChatMessage[] = data.map((n: any) => {
                    try {
                        const ctx = JSON.parse(n.context_json || '{}');
                        if (ctx.ip && !ip) setIp(ctx.ip);
                    } catch(_) {}
                    const role = n.type === 'admin-reply' ? 'model' : 'user';
                    return { role, content: n.message };
                });
                if (msgs.length > 0) setHistory(msgs);
            } catch {}
        };
        if (isOpen) {
            loadThread();
            timer = window.setInterval(loadThread, 5000);
        }
        return () => { if (timer) window.clearInterval(timer); };
    }, [isOpen, ip]);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;
        const userMessage = input;
        const newHistory: ChatMessage[] = [...history, { role: 'user', content: userMessage }];
        setHistory(newHistory);
        setInput('');
        setIsLoading(true);
        setMessageStatus('sending');

        try {
            const response = await fetch('/api/captive-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userMessage }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Failed to send message.');
            setHistory([...newHistory, { role: 'model', content: "Your message has been sent to the administrator. They will be notified." }]);
            setMessageStatus('sent');
        } catch (error) {
            setHistory([...newHistory, { role: 'model', content: `Sorry, there was an error sending your message: ${(error as Error).message}` }]);
            setMessageStatus('error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white rounded-full p-3 sm:p-4 shadow-lg z-40 transition-transform hover:scale-110"
                aria-label="Open Help"
            >
                <QuestionMarkCircleIcon className="w-6 h-6 sm:w-8 sm:h-8" />
            </button>
            {isOpen && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg h-[70vh] border border-slate-200 dark:border-slate-700 flex flex-col">
                        <header className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                            <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400]">Contact Administrator</h3>
                            <button onClick={() => setIsOpen(false)} className="p-1 text-slate-400 hover:text-slate-800 dark:hover:text-white text-2xl leading-none">&times;</button>
                        </header>
                        <div ref={chatContainerRef} className="flex-1 p-4 overflow-y-auto space-y-4">
                            {history.map((msg, index) => (
                                <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-md p-3 rounded-lg ${msg.role === 'user' ? 'bg-[--color-primary-600] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200'}`}>
                                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                                    </div>
                                </div>
                            ))}
                            {isLoading && <div className="flex justify-start"><div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-700"><Loader/></div></div>}
                        </div>
                        <footer className="p-4 border-t border-slate-200 dark:border-slate-700">
                            <div className="flex items-center gap-2">
                                <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="Type your message..."
                                    className="flex-1 p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md text-slate-900 dark:text-white resize-none"
                                    rows={1} disabled={isLoading || messageStatus === 'sent'} />
                                <button onClick={handleSend} disabled={isLoading || !input.trim() || messageStatus === 'sent'} className="px-4 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] rounded-md disabled:opacity-50 text-white">
                                    {isLoading ? '...' : 'Send'}
                                </button>
                            </div>
                        </footer>
                    </div>
                </div>
            )}
        </>
    );
};

interface CustomerInfo {
    fullName: string;
    accountNumber: string;
    planName: string;
    dueDate: string;
    routerId: string;
    username: string;
    clientType: 'pppoe' | 'dhcp';
    routerName?: string;
}

const MIKROTIK_SCRIPT = `# ============================================
# EXPIRED CLIENT WALLED GARDEN SETUP
# Run this script on your MikroTik router
# Non-payment IP pool: 172.16.44.0/24
# ============================================

# 1. Create address list for the portal/store server
/ip firewall address-list
add list=PORTAL_SERVER address=<PORTAL_IP> comment="Billing Portal Server"

# 2. Non-payment pool address list (expired clients get IPs from this range)
/ip firewall address-list
add list=NON_PAYMENT_POOL address=172.16.44.0/24 comment="Non-payment profile IP pool"

# 3. Mangle rule: mark expired client traffic going outside portal
/ip firewall mangle
add chain=prerouting \\
    src-address-list=NON_PAYMENT_POOL \\
    dst-address-list=!PORTAL_SERVER \\
    action=mark-connection \\
    new-connection-mark=expired_blocked \\
    passthrough=yes \\
    comment="Block expired clients except portal"

# 4. Filter rule: drop marked traffic (block internet, allow portal only)
/ip firewall filter
add chain=forward \\
    connection-mark=expired_blocked \\
    action=drop \\
    comment="Drop expired client traffic to non-portal destinations"

# 5. NAT redirect: force HTTP traffic from expired clients to portal
/ip firewall nat
add chain=dstnat \\
    protocol=tcp \\
    dst-port=80 \\
    src-address-list=NON_PAYMENT_POOL \\
    dst-address-list=!PORTAL_SERVER \\
    action=dst-nat \\
    to-addresses=<PORTAL_IP> \\
    to-ports=<PORTAL_PORT> \\
    comment="Redirect expired HTTP to portal"

# 6. DNS redirect: redirect DNS to router so portal domain resolves
/ip firewall nat
add chain=dstnat \\
    protocol=udp \\
    dst-port=53 \\
    src-address-list=NON_PAYMENT_POOL \\
    action=redirect \\
    to-ports=53 \\
    comment="Redirect expired DNS to router"

# NOTE: The billing system also dynamically manages an EXPIRED_CLIENTS
# address-list via API for per-client IP tracking. The NON_PAYMENT_POOL
# covers the entire subnet assigned to the non-payment PPPoE profile.
`;

export const ExpiredPortal: React.FC = () => {
    useTheme();
    const { settings: companySettings, isLoading: isLoadingCompany } = useCompanySettings();
    const [customer, setCustomer] = useState<CustomerInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isNavigating, setIsNavigating] = useState(false);
    const [showScript, setShowScript] = useState(false);
    const [customExpiredMessage, setCustomExpiredMessage] = useState('');

    useEffect(() => {
        // Load store settings for custom expired message
        fetch('/api/public/store-settings').then(r => r.ok ? r.json() : null).then(data => {
            if (data?.customExpiredMessage) setCustomExpiredMessage(data.customExpiredMessage);
        }).catch(() => {});

        const lookupCustomer = async () => {
            try {
                setLoading(true);
                const params = new URLSearchParams(window.location.search);
                const ip = params.get('ip') || '';
                const mac = params.get('mac') || '';

                if (!ip && !mac) {
                    setError('No client information provided. Please access this page through your network connection.');
                    setLoading(false);
                    return;
                }

                const queryParts = [];
                if (ip) queryParts.push(`ip=${encodeURIComponent(ip)}`);
                if (mac) queryParts.push(`mac=${encodeURIComponent(mac)}`);

                const resp = await fetch(`/api/public/expired/lookup?${queryParts.join('&')}`);
                const data = await resp.json();

                if (!resp.ok) {
                    setError(data.message || 'Failed to look up account information.');
                    setLoading(false);
                    return;
                }

                if (data.found && data.customer) {
                    setCustomer(data.customer);
                } else {
                    setError('We could not find your account. Please contact your service provider.');
                }
            } catch (err) {
                setError('An error occurred while looking up your account. Please try again.');
            } finally {
                setLoading(false);
            }
        };

        lookupCustomer();
    }, []);

    const handleGoToStore = async () => {
        if (!customer) return;
        setIsNavigating(true);
        try {
            const resp = await fetch('/api/public/expired/auto-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: customer.username,
                    routerId: customer.routerId,
                    accountNumber: customer.accountNumber
                })
            });
            const data = await resp.json();
            if (!resp.ok) {
                alert(data.message || 'Failed to create store session. Please try again.');
                setIsNavigating(false);
                return;
            }
            // Redirect to store with the session token
            window.location.href = `/store?session=${encodeURIComponent(data.token)}`;
        } catch (err) {
            alert('Failed to connect to store. Please try again.');
            setIsNavigating(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-red-50 via-orange-50 to-yellow-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-800 flex flex-col justify-center items-center py-12 px-4">
            {/* Company Logo */}
            <div className="sm:mx-auto sm:w-full sm:max-w-md text-center mb-8">
                {isLoadingCompany ? <Loader /> : companySettings.logoBase64 ? (
                    <img src={companySettings.logoBase64} alt="Company Logo" className="mx-auto h-20 w-auto object-contain" />
                ) : (
                    <MikroTikLogoIcon className="mx-auto h-16 w-auto text-[--color-primary-500]" />
                )}
                {companySettings.companyName && (
                    <p className="mt-2 text-lg font-semibold text-slate-700 dark:text-slate-300">{companySettings.companyName}</p>
                )}
            </div>

            {/* Main Card */}
            <div className="bg-white dark:bg-slate-800 py-8 px-6 shadow-2xl sm:rounded-2xl sm:px-10 border border-slate-200 dark:border-slate-700 w-full max-w-lg">

                {loading ? (
                    <div className="flex flex-col items-center py-8">
                        <Loader />
                        <p className="mt-4 text-slate-500 dark:text-slate-400">Looking up your account...</p>
                    </div>
                ) : error ? (
                    <>
                        <div className="text-center">
                            <div className="mx-auto w-16 h-16 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center mb-4">
                                <svg className="w-8 h-8 text-orange-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                                </svg>
                            </div>
                            <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Account Not Found</h1>
                            <p className="mt-3 text-slate-600 dark:text-slate-300">{error}</p>
                        </div>
                        <div className="mt-6 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg p-4 text-sm">
                            <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Contact Information</h3>
                            {companySettings.companyName && <p className="text-slate-700 dark:text-slate-300">{companySettings.companyName}</p>}
                            {companySettings.contactNumber && <p className="text-slate-700 dark:text-slate-300"><span className="font-semibold">Phone:</span> {companySettings.contactNumber}</p>}
                            {companySettings.email && <p className="text-slate-700 dark:text-slate-300"><span className="font-semibold">Email:</span> {companySettings.email}</p>}
                        </div>
                    </>
                ) : customer ? (
                    <>
                        {/* Expired Banner */}
                        <div className="text-center mb-6">
                            <div className="mx-auto w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4">
                                <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                                </svg>
                            </div>
                            <h1 className="text-2xl font-extrabold text-red-600 dark:text-red-400">Subscription Expired</h1>
                            <p className="mt-2 text-slate-600 dark:text-slate-300">{customExpiredMessage || 'Your internet service has been suspended due to an expired subscription.'}</p>
                        </div>

                        {/* Account Info */}
                        <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg p-4 mb-6 space-y-2">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-slate-500 dark:text-slate-400">Account Name</span>
                                <span className="font-semibold text-slate-900 dark:text-white">{customer.fullName || customer.username}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-slate-500 dark:text-slate-400">Account Number</span>
                                <span className="font-semibold text-slate-900 dark:text-white">{customer.accountNumber}</span>
                            </div>
                            {customer.planName && (
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-slate-500 dark:text-slate-400">Expired Plan</span>
                                    <span className="font-medium text-red-600 dark:text-red-400">{customer.planName}</span>
                                </div>
                            )}
                            {customer.dueDate && (
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-slate-500 dark:text-slate-400">Due Date</span>
                                    <span className="font-medium text-red-600 dark:text-red-400">{new Date(customer.dueDate).toLocaleDateString()}</span>
                                </div>
                            )}
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-slate-500 dark:text-slate-400">Connection Type</span>
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${customer.clientType === 'pppoe' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'}`}>
                                    {customer.clientType.toUpperCase()}
                                </span>
                            </div>
                        </div>

                        {/* Renew CTA */}
                        <div className="space-y-3">
                            <button
                                onClick={handleGoToStore}
                                disabled={isNavigating}
                                className="w-full px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-slate-400 disabled:to-slate-500 text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-[1.02] disabled:transform-none disabled:cursor-not-allowed flex items-center justify-center gap-3"
                            >
                                {isNavigating ? (
                                    <>
                                        <span className="animate-spin">⏳</span>
                                        <span>Connecting to Store...</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="text-2xl">🛒</span>
                                        <span>Renew Now - Visit Store</span>
                                    </>
                                )}
                            </button>
                            <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                                Browse available plans and pay to restore your internet connection instantly.
                            </p>
                        </div>

                        {/* Contact Info */}
                        <div className="mt-6 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg p-4 text-sm">
                            <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Need Help? Contact Us</h3>
                            {companySettings.companyName && <p className="text-slate-700 dark:text-slate-300">{companySettings.companyName}</p>}
                            {companySettings.address && <p className="text-slate-700 dark:text-slate-300">{companySettings.address}</p>}
                            {companySettings.contactNumber && <p className="text-slate-700 dark:text-slate-300"><span className="font-semibold">Phone:</span> {companySettings.contactNumber}</p>}
                            {companySettings.email && <p className="text-slate-700 dark:text-slate-300"><span className="font-semibold">Email:</span> {companySettings.email}</p>}
                        </div>

                        {/* Payment Instructions */}
                        <div className="mt-4 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-sm">
                            <h3 className="font-semibold text-blue-800 dark:text-blue-200 mb-2">How to Renew</h3>
                            <ol className="list-decimal list-inside space-y-1 text-blue-700 dark:text-blue-300">
                                <li>Click the <strong>"Renew Now"</strong> button above</li>
                                <li>Choose a plan that suits your needs</li>
                                <li>Pay via GCash, Maya, or Credit/Debit Card</li>
                                <li>Your connection will be restored automatically after payment is confirmed</li>
                            </ol>
                        </div>
                    </>
                ) : null}
            </div>

            {/* MikroTik Script Section - for admin reference */}
            <div className="mt-6 w-full max-w-lg">
                <button
                    onClick={() => setShowScript(!showScript)}
                    className="w-full text-left text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors flex items-center gap-2"
                >
                    <svg className={`w-4 h-4 transition-transform ${showScript ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                    {showScript ? 'Hide' : 'Show'} MikroTik Walled Garden Setup Script (Admin Reference)
                </button>
                {showScript && (
                    <div className="mt-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4 shadow-sm">
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                            Copy and paste this script into your MikroTik router's terminal. Replace <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">&lt;PORTAL_IP&gt;</code> and <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">&lt;PORTAL_PORT&gt;</code> with your actual portal server IP and port.
                        </p>
                        <CodeBlock script={MIKROTIK_SCRIPT} />
                    </div>
                )}
            </div>

            {/* Footer */}
            <footer className="mt-8 text-center text-sm text-slate-500 dark:text-slate-400">
                <p>Powered by {companySettings.companyName || 'Mikrotik Billing Management by AJC'}</p>
            </footer>

            <ExpiredHelp />
        </div>
    );
};

export default ExpiredPortal;
