import React, { useState, useEffect, useRef } from 'react';
import { MikroTikLogoIcon, QuestionMarkCircleIcon } from '../constants.tsx';
import type { ChatMessage } from '../types.ts';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { useCompanySettings } from '../hooks/useCompanySettings.ts';
import { Loader } from './Loader.tsx';

// A self-contained version of the Help component for the unauthenticated captive page
const CaptiveHelp: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [history, setHistory] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const [messageStatus, setMessageStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
    const [ip, setIp] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            const initialGreeting = `Hello! If you need help, you can send a message to the network administrator here.`;
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

            if (!response.ok) {
                throw new Error(data.message || 'Failed to send message.');
            }
            
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


export const CaptivePortalPage: React.FC = () => {
    // This hook ensures theme classes are applied to the root <html> element
    useTheme(); 
    const { settings: companySettings, isLoading } = useCompanySettings();
    const [status, setStatus] = useState<'unknown' | 'authorized' | 'expired'>('unknown');
    const [info, setInfo] = useState<{ ip?: string; macAddress?: string | null; hostName?: string | null; dueDateTime?: string | null; planName?: string | null; routerId?: string } | null>(null);
    const [clientInfo, setClientInfo] = useState<{ accountNumber?: string; label?: string } | null>(null);
    const [plans, setPlans] = useState<Array<{ id: string; name: string; price: number; cycle_days: number; currency: string }>>([]);
    const [isPayOpen, setIsPayOpen] = useState(false);
    const [selectedPlanId, setSelectedPlanId] = useState<string>('');
    const [imageBase64, setImageBase64] = useState<string>('');
    
    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const resp = await fetch('/mt-api/captive/info', { method: 'GET' });
                if (resp.ok) {
                    const data = await resp.json();
                    setStatus((data.status as any) || 'unknown');
                    setInfo({
                        ip: data.ip,
                        macAddress: data.macAddress ?? null,
                        hostName: data.hostName ?? null,
                        dueDateTime: data.dueDateTime ?? null,
                        planName: data.planName ?? null,
                        routerId: data.routerId
                    });
                } else {
                    setStatus('unknown');
                    setInfo(null);
                }
            } catch {
                setStatus('unknown');
                setInfo(null);
            }
        };
        fetchStatus();
    }, []);
    
    useEffect(() => {
        const loadClient = async () => {
            try {
                if (info?.routerId && info?.macAddress) {
                    const r = await fetch(`/api/public/dhcp-client/by-mac?routerId=${encodeURIComponent(info.routerId)}&mac=${encodeURIComponent(info.macAddress)}`);
                    const c = await r.json();
                    const label = c?.customerInfo || info.hostName || info.macAddress || '';
                    setClientInfo({ accountNumber: c?.accountNumber || '', label });
                }
            } catch {}
        };
        const loadPlans = async () => {
            try {
                if (info?.routerId) {
                    const r = await fetch(`/api/public/dhcp/plans?routerId=${encodeURIComponent(info.routerId)}`);
                    const list = await r.json();
                    setPlans(Array.isArray(list) ? list : []);
                }
            } catch {}
        };
        loadClient();
        loadPlans();
    }, [info?.routerId, info?.macAddress, info?.hostName]);
    
    const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => setImageBase64(String(reader.result || ''));
        reader.readAsDataURL(file);
    };
    const handleSubmitPayment = async () => {
        if (!info?.routerId || !clientInfo?.label || !selectedPlanId || !imageBase64) return;
        const plan = plans.find(p => p.id === selectedPlanId);
        if (!plan) return;
        try {
            const resp = await fetch('/api/public/payment-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    routerId: info.routerId,
                    usernameLabel: clientInfo.label,
                    accountNumber: clientInfo.accountNumber || '',
                    planName: plan.name,
                    planId: plan.id,
                    amount: plan.price,
                    currency: plan.currency || 'PHP',
                    ip: info.ip || '',
                    macAddress: info.macAddress || '',
                    imageBase64
                })
            });
            const data = await resp.json();
            if (!resp.ok) {
                alert(data.message || 'Failed to submit payment request');
                return;
            }
            setIsPayOpen(false);
            setImageBase64('');
            setSelectedPlanId('');
            alert('Payment request submitted. Please wait for admin approval.');
        } catch (e) {
            alert((e as Error).message);
        }
    };

    return (
        <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col justify-center items-center py-12 px-4">
            <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
                {isLoading ? <Loader /> : companySettings.logoBase64 ? (
                     <img src={companySettings.logoBase64} alt="Company Logo" className="mx-auto h-20 w-auto object-contain" />
                ) : (
                    <MikroTikLogoIcon className="mx-auto h-16 w-auto text-[--color-primary-500]" />
                )}
            </div>
            <div className="mt-8 bg-white dark:bg-slate-800 py-8 px-4 shadow-lg sm:rounded-lg sm:px-10 border border-slate-200 dark:border-slate-700 w-full max-w-lg">
                {status === 'expired' ? (
                    <>
                        <h1 className="text-center text-3xl font-extrabold text-red-600 dark:text-red-400">
                            Your account has expired
                        </h1>
                        <p className="mt-4 text-center text-slate-600 dark:text-slate-300">
                            Your device’s internet access is temporarily disabled because your subscription has expired.
                        </p>
                        <div className="mt-6 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-md p-4 text-sm">
                            {info?.planName && <p className="text-slate-700 dark:text-slate-300"><span className="font-semibold">Plan:</span> {info.planName}</p>}
                            {info?.dueDateTime && <p className="text-slate-700 dark:text-slate-300"><span className="font-semibold">Due Date:</span> {new Date(info.dueDateTime).toLocaleString()}</p>}
                            {info?.macAddress && <p className="text-slate-700 dark:text-slate-300"><span className="font-semibold">MAC:</span> {info.macAddress}</p>}
                            {info?.ip && <p className="text-slate-700 dark:text-slate-300"><span className="font-semibold">IP:</span> {info.ip}</p>}
                            {info?.hostName && <p className="text-slate-700 dark:text-slate-300"><span className="font-semibold">Device:</span> {info.hostName}</p>}
                        </div>
                        <p className="mt-4 text-center text-slate-600 dark:text-slate-300">
                            Contact the administrator for renewal and re-activation.
                        </p>
                        <div className="mt-6 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-md p-4 text-sm">
                            <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Contact Information</h3>
                            {companySettings.companyName && <p className="text-slate-700 dark:text-slate-300">{companySettings.companyName}</p>}
                            {companySettings.address && <p className="text-slate-700 dark:text-slate-300">{companySettings.address}</p>}
                            {companySettings.contactNumber && <p className="text-slate-700 dark:text-slate-300"><span className="font-semibold">Contact:</span> {companySettings.contactNumber}</p>}
                            {companySettings.email && <p className="text-slate-700 dark:text-slate-300"><span className="font-semibold">Email:</span> {companySettings.email}</p>}
                        </div>
                        <div className="mt-4 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-md p-4 text-sm">
                            <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Account</h3>
                            {clientInfo?.label && <p className="text-slate-700 dark:text-slate-300"><span className="font-semibold">Name:</span> {clientInfo.label}</p>}
                            {clientInfo?.accountNumber && <p className="text-slate-700 dark:text-slate-300"><span className="font-semibold">Account No.:</span> {clientInfo.accountNumber}</p>}
                            {info?.planName && <p className="text-slate-700 dark:text-slate-300"><span className="font-semibold">Current Plan:</span> {info.planName}</p>}
                            <div className="mt-3">
                                <button onClick={() => setIsPayOpen(true)} className="px-4 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white rounded-md">Pay</button>
                            </div>
                        </div>
                        <div className="mt-4 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-md p-4 text-sm">
                            <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Payment Instructions</h3>
                            <p className="text-slate-700 dark:text-slate-300">
                                Please pay using your preferred method (e.g., e-wallet or bank transfer) and provide your name and MAC address as reference.
                                After payment, contact us to re-activate your internet access.
                            </p>
                        </div>
                    </>
                ) : (
                    <>
                        <h1 className="text-center text-3xl font-extrabold text-[--color-primary-600] dark:text-[--color-primary-400]">
                            Activation Required
                        </h1>
                        <p className="mt-4 text-center text-slate-600 dark:text-slate-300">
                            Your device is connected to the network, but you do not have internet access yet.
                        </p>
                        <p className="mt-2 text-center text-slate-600 dark:text-slate-300">
                            Please contact the network administrator to activate your service.
                        </p>
                    </>
                )}
                 <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700 text-center">
                    <h2 className="font-semibold text-slate-800 dark:text-slate-200">Need help?</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Click the chat bubble in the corner to send a message to the administrator.</p>
                </div>
            </div>
             <footer className="mt-8 text-center text-sm text-slate-500 dark:text-slate-400">
                <p>Powered by {companySettings.companyName || 'Mikrotik Billling Management by AJC'}</p>
            </footer>

            <CaptiveHelp />
            
            {isPayOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg border border-slate-200 dark:border-slate-700">
                        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                            <h3 className="text-lg font-semibold">Payment Request</h3>
                            <button onClick={() => setIsPayOpen(false)} className="px-2 py-1 rounded bg-slate-200 dark:bg-slate-700">Close</button>
                        </div>
                        <div className="p-4 space-y-4">
                            <div>
                                <label className="block text-sm font-medium">Account Number</label>
                                <input type="text" value={clientInfo?.accountNumber || ''} readOnly className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium">Name</label>
                                <input type="text" value={clientInfo?.label || ''} readOnly className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium">Plan</label>
                                <select value={selectedPlanId} onChange={e => setSelectedPlanId(e.target.value)} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded">
                                    <option value="">Select Plan</option>
                                    {plans.map(p => (
                                        <option key={p.id} value={p.id}>{p.name} — {p.currency} {Number(p.price || 0).toFixed(2)}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium">Upload Receipt Image</label>
                                <input type="file" accept="image/*" onChange={handleImageChange} className="mt-1 w-full" />
                            </div>
                        </div>
                        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/50 flex justify-end gap-2 rounded-b-lg">
                            <button onClick={() => setIsPayOpen(false)} className="px-4 py-2 rounded bg-slate-200 dark:bg-slate-700">Cancel</button>
                            <button onClick={handleSubmitPayment} className="px-4 py-2 rounded bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white disabled:opacity-50" disabled={!selectedPlanId || !imageBase64}>Submit</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
