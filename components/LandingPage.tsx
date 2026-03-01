import React, { useEffect, useLayoutEffect, useState } from 'react';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import type { PanelSettings, LandingPageConfig, CompanySettings } from '../types.ts';

export const LandingPage: React.FC = () => {
  const { t } = useLocalization();
  const [companySettings, setCompanySettings] = useState<CompanySettings>({ companyName: '', address: '', contactNumber: '', email: '', logoBase64: '' });
  const initialConfig = (() => { try { return JSON.parse(localStorage.getItem('lp_config') || 'null'); } catch { return null; } })();
  const [panelSettings, setPanelSettings] = useState<PanelSettings | null>(initialConfig ? ({ landingPageConfig: initialConfig } as PanelSettings) : null);
  const cfg: LandingPageConfig = panelSettings?.landingPageConfig || {};
  const [isReady, setIsReady] = useState<boolean>(!!initialConfig);
  useLayoutEffect(() => {
    const theme = cfg.theme || {};
    const root = document.documentElement;
    if (theme.primary500) root.style.setProperty('--color-primary-500', theme.primary500);
    if (theme.primary600) root.style.setProperty('--color-primary-600', theme.primary600);
    if (theme.primary700) root.style.setProperty('--color-primary-700', theme.primary700);
    if (theme.background) root.style.setProperty('--lp-background', theme.background);
    if (panelSettings && (cfg.templateId || Object.keys(cfg).length > 0)) {
      setIsReady(true);
    }
  }, [cfg.theme]);
  const [selectedPlan, setSelectedPlan] = useState<string>('');
  const [inqName, setInqName] = useState<string>('');
  const [inqEmail, setInqEmail] = useState<string>('');
  const [inqPhone, setInqPhone] = useState<string>('');
  const [inqMessage, setInqMessage] = useState<string>('');
  const [inqStatus, setInqStatus] = useState<string>('');
  const goto = (path: string) => { window.location.href = path; };
  useEffect(() => { (async () => { try { const res = await fetch(`/api/public/landing-page?v=${Date.now()}`, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, cache: 'no-store' }); if (res.ok) { const data = await res.json(); localStorage.setItem('lp_config', JSON.stringify(data.config)); setCompanySettings(data.company as CompanySettings); setPanelSettings({ landingPageConfig: data.config } as PanelSettings); } } catch { /* ignore */ } finally { setIsReady(true); } })(); }, []);
  useEffect(() => { const title = cfg.webTitle || companySettings.companyName || 'ISP Panel'; if (title) document.title = title; }, [cfg.webTitle, companySettings.companyName]);
  const scrollTo = (id: string) => { const el = document.querySelector(id); if (el) el.scrollIntoView({ behavior: 'smooth' }); };
  const [chatOpen, setChatOpen] = useState<boolean>(false);
  const [chatStep, setChatStep] = useState<'prefill'|'chat'>('prefill');
  const [chatChannel, setChatChannel] = useState<'inquiry'|'complaint'>('inquiry');
  const [chatName, setChatName] = useState<string>('');
  const [chatAddress, setChatAddress] = useState<string>('');
  const [chatAccount, setChatAccount] = useState<string>('');
  const [chatHistory, setChatHistory] = useState<{ role: 'user'|'model'; content: string }[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [chatLoading, setChatLoading] = useState<boolean>(false);
  const [chatError, setChatError] = useState<string>('');
  useEffect(() => { if (chatOpen) { setChatStep('prefill'); setChatHistory([]); setChatInput(''); setChatError(''); } }, [chatOpen]);
  useEffect(() => {
    let timer: number | null = null;
    const loadThread = async () => {
      try {
        const resp = await fetch('/api/captive-thread');
        if (!resp.ok) return;
        const data = await resp.json();
        const msgs = (data as any[])
          .filter(n => String(n.message || '').toLowerCase().indexOf('chat started') !== 0)
          .map(n => ({ role: n.type === 'admin-reply' ? 'model' : 'user', content: String(n.message || '') }));
        if (msgs.length > 0) setChatHistory(msgs);
      } catch {}
    };
    if (chatOpen && chatStep === 'chat') {
      loadThread();
      timer = window.setInterval(loadThread, 5000);
    }
    return () => { if (timer) window.clearInterval(timer); };
  }, [chatOpen, chatStep]);
  const startChat = async () => {
    setChatError('');
    if (!chatName.trim() || !chatAddress.trim() || !chatAccount.trim()) { setChatError('Please fill Name, Address, and Account before chatting.'); return; }
    try {
      const resp = await fetch('/api/public/chat-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: chatName.trim(), address: chatAddress.trim(), account: chatAccount.trim(), channel: chatChannel })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ message: 'Unable to initialize chat.' }));
        setChatError(err.message || 'Unable to initialize chat.');
        return;
      }
      setChatStep('chat');
      setChatHistory([{ role: 'model', content: chatChannel === 'complaint' ? 'Submit your complaint here. The admin will respond.' : 'Send your inquiry here. The admin will respond.' }]);
    } catch {
      setChatError('An error occurred while starting chat.');
    }
  };
  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput.trim();
    const newHistory = [...chatHistory, { role: 'user', content: msg }];
    setChatHistory(newHistory);
    setChatInput('');
    setChatLoading(true);
    try {
      const resp = await fetch('/api/captive-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, name: chatName, address: chatAddress, account: chatAccount, channel: chatChannel })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.message || 'Failed to send message.');
      setChatHistory([...newHistory, { role: 'model', content: 'Your message has been sent to the admin.' }]);
    } catch (e) {
      setChatHistory([...newHistory, { role: 'model', content: `Error sending message: ${(e as Error).message}` }]);
    } finally {
      setChatLoading(false);
    }
  };
  const submitInquiry = async () => {
    setInqStatus('Submitting...');
    try {
      const res = await fetch('/api/public/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: inqName, email: inqEmail, phone: inqPhone, message: inqMessage, planName: selectedPlan }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed' }));
        setInqStatus(err.message || 'Failed to submit.');
        return;
      }
      const data = await res.json();
      setInqStatus('Inquiry submitted. Thank you!');
      setInqName(''); setInqEmail(''); setInqPhone(''); setInqMessage('');
    } catch {
      setInqStatus('An error occurred while submitting.');
    }
  };
  if (!isReady) {
    return (
      <div className="min-h-screen bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="h-6 w-40 bg-slate-200 dark:bg-slate-800 rounded-md animate-pulse"></div>
          <div className="mt-6 h-8 w-3/4 bg-slate-200 dark:bg-slate-800 rounded-md animate-pulse"></div>
          <div className="mt-3 h-4 w-1/2 bg-slate-200 dark:bg-slate-800 rounded-md animate-pulse"></div>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen text-slate-900 dark:text-slate-100" style={{ background: (cfg.theme?.background || 'white') }}>
      <header className="sticky top-0 z-30 border-b border-slate-200/60 dark:border-slate-800/60 bg-white/70 dark:bg-slate-900/70 backdrop-blur">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {companySettings.logoBase64 ? (
              <img src={companySettings.logoBase64} alt="Logo" className="h-9 w-9 rounded-lg object-contain" />
            ) : (
              <div className="h-9 w-9 rounded-lg bg-[--color-primary-500] text-white grid place-content-center font-bold">ISP</div>
            )}
            <span className="font-semibold">{cfg.webTitle || companySettings.companyName || 'ISP Panel'}</span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            {(cfg.pages || []).map(p => (
              <button key={p.id} onClick={() => goto(`#${p.id}`)} className="hover:text-[--color-primary-500]">{p.label}</button>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <button onClick={() => goto('/login')} className="px-4 py-2 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">
              {cfg.navAdminLabel || 'Admin Login'}
            </button>
            <button onClick={() => goto('/client_portal')} className="px-4 py-2 rounded-md bg-[--color-primary-500] text-white hover:opacity-90">
              {cfg.navClientPortalLabel || 'Client Portal'}
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-7xl px-6 py-16 md:py-24 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-sm font-medium text-[--color-primary-500] tracking-wide uppercase">{cfg.heroBadge || 'All‑in‑One ISP Suite'}</p>
            <h1 className="mt-3 text-4xl md:text-5xl font-bold leading-tight">
              {cfg.heroTitle || 'Mikrotik Billing & Network Management'}
            </h1>
            <p className="mt-4 text-slate-600 dark:text-slate-300">
              {cfg.heroSubtitle || 'Automate PPPoE, DHCP captive portal, billing, receipts, and client notifications. Built for small to mid‑size ISPs using MikroTik.'}
            </p>
            <div className="mt-6 flex items-center gap-3">
              <button onClick={() => goto('#plans')} className="px-6 py-3 rounded-md bg-[--color-primary-500] text-white hover:opacity-90">{cfg.heroCtaLabel || 'View Plans'}</button>
            </div>
            <p className="mt-3 text-xs text-slate-500">{cfg.heroLoginPrompt || 'Have an account?'} <span className="underline cursor-pointer" onClick={() => goto('/login')}>{cfg.heroLoginLabel || 'Login'}</span></p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-white dark:bg-slate-900">
            {cfg.adImageBase64 ? (
              <img
                src={cfg.adImageBase64}
                alt={cfg.adImageAlt || (cfg.webTitle || companySettings.companyName || 'Advertising')}
                className="aspect-[16/10] w-full object-cover rounded-lg"
              />
            ) : (
              <div className="aspect-[16/10] rounded-lg bg-gradient-to-br from-[--color-primary-300] to-[--color-primary-600] opacity-90 grid place-content-center text-white text-lg font-semibold">
                {cfg.webTitle || companySettings.companyName || 'ISP Products'}
              </div>
            )}
            {(cfg.productCards && cfg.productCards.length > 0) && (
              <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                {cfg.productCards.map((c, i) => (
                  <div key={`card-${i}`} className="rounded-md border border-slate-200 dark:border-slate-800 p-3">
                    <div className="font-semibold">{c.title}</div>
                    {c.subtitle && <div className="text-slate-500 text-xs">{c.subtitle}</div>}
                    {c.priceText && <div className="mt-2 text-[--color-primary-500] font-bold">{c.priceText}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {(cfg.features && cfg.features.length > 0) && (
          <section id="features" className="bg-slate-50 dark:bg-slate-950/40 border-y border-slate-200 dark:border-slate-800">
            <div className="mx-auto max-w-7xl px-6 py-14 grid md:grid-cols-3 gap-6">
              {cfg.features.map((f, i) => (
                <div key={`feat-${i}`} className="p-6 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <div className="text-[--color-primary-500] font-semibold">{f.title}</div>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{f.description}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {(Array.isArray(cfg.plans) && cfg.plans.length > 0) && (
          <section id="plans" className="mx-auto max-w-7xl px-6 py-16">
            <h2 className="text-2xl font-bold">{cfg.plansTitle || 'Plans'}</h2>
            <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {cfg.plans.map(p => (
                <div key={p.name} className="p-6 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <div className="font-semibold">{p.name}</div>
                  {p.speedText && <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{p.speedText}</div>}
                  <div className="mt-2 text-[--color-primary-500] font-bold">{p.priceText}</div>
                  <button className="mt-4 w-full px-4 py-2 rounded-md bg-[--color-primary-500] text-white hover:opacity-90" onClick={() => { setSelectedPlan(p.name); scrollTo('#inquire'); }}>{p.ctaLabel || 'Inquire'}</button>
                </div>
              ))}
            </div>
          </section>
        )}
        {(cfg.pages || []).filter(p => !['features','plans','contact'].includes(p.id)).map(p => (
          <section key={`sec-${p.id}`} id={p.id} className="mx-auto max-w-7xl px-6 py-16">
            <h2 className="text-2xl font-bold">{p.label}</h2>
            <p className="text-slate-600 dark:text-slate-300 text-sm mt-1">Customize this section content.</p>
          </section>
        ))}
        <section id="inquire" className="mx-auto max-w-7xl px-6 py-16">
          <h2 className="text-2xl font-bold">Inquiry Form</h2>
          <div className="mt-4 grid md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <input className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="Name" value={inqName} onChange={e => setInqName(e.target.value)} />
              <input className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="Email" value={inqEmail} onChange={e => setInqEmail(e.target.value)} />
              <input className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="Phone" value={inqPhone} onChange={e => setInqPhone(e.target.value)} />
              <select className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" value={selectedPlan} onChange={e => setSelectedPlan(e.target.value)}>
                <option value="">Plan</option>
                {(cfg.plans || []).map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </div>
            <div className="space-y-3">
              <textarea className="w-full h-[180px] px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="Message" value={inqMessage} onChange={e => setInqMessage(e.target.value)} />
              <div className="flex items-center gap-3">
                <button onClick={submitInquiry} className="px-4 py-2 rounded-md bg-[--color-primary-500] text-white hover:opacity-90">Submit</button>
                <span className="text-sm text-slate-600 dark:text-slate-300">{inqStatus}</span>
              </div>
            </div>
          </div>
        </section>
        <section id="contact" className="mx-auto max-w-7xl px-6 py-16">
          <h2 className="text-2xl font-bold">{cfg.contactTitle || 'Contact'}</h2>
          <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-6 text-sm">
            {(cfg.contactEmail || companySettings.email) && (
              <div className="p-6 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="font-semibold">Email</div>
                <a className="mt-1 block text-[--color-primary-500]" href={`mailto:${cfg.contactEmail || companySettings.email}`}>{cfg.contactEmail || companySettings.email}</a>
              </div>
            )}
            {cfg.contactPhone && (
              <div className="p-6 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="font-semibold">Phone</div>
                <a className="mt-1 block text-[--color-primary-500]" href={`tel:${cfg.contactPhone}`}>{cfg.contactPhone}</a>
              </div>
            )}
            {(cfg.contactAddress) && (
              <div className="p-6 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="font-semibold">Address</div>
                <div className="mt-1 text-slate-600 dark:text-slate-300">{cfg.contactAddress}</div>
              </div>
            )}
            {cfg.contactFacebookUrl && (
              <div className="p-6 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="font-semibold">Facebook</div>
                <a className="mt-1 block text-[--color-primary-500]" href={cfg.contactFacebookUrl} target="_blank" rel="noreferrer">{cfg.contactFacebookUrl}</a>
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-800">
        <div className="mx-auto max-w-7xl px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-sm text-slate-600 dark:text-slate-400">© {new Date().getFullYear()} {cfg.webTitle || companySettings.companyName || 'ISP Panel'}</div>
          <div className="flex items-center gap-4 text-sm">
            {(cfg.footerLinks || []).map((l, i) => (
              <a key={`fl-${i}`} href={l.href} className="hover:text-[--color-primary-500]">{l.label}</a>
            ))}
          </div>
        </div>
      </footer>
      
      <button
        onClick={() => setChatOpen(true)}
        className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white rounded-full p-3 sm:p-4 shadow-lg z-40 transition-transform hover:scale-110"
      >
        Chat
      </button>
      {chatOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg h-[70vh] border border-slate-200 dark:border-slate-700 flex flex-col">
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button onClick={() => setChatChannel('inquiry')} className={`px-3 py-1 rounded-md text-sm ${chatChannel === 'inquiry' ? 'bg-[--color-primary-600] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200'}`}>Inquiry</button>
                <button onClick={() => setChatChannel('complaint')} className={`px-3 py-1 rounded-md text-sm ${chatChannel === 'complaint' ? 'bg-[--color-primary-600] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200'}`}>Complaints</button>
              </div>
              <button onClick={() => setChatOpen(false)} className="p-1 text-slate-400 hover:text-slate-800 dark:hover:text-white text-2xl leading-none">&times;</button>
            </div>
            {chatStep === 'prefill' ? (
              <div className="p-4 space-y-3">
                <div className="text-sm text-slate-600 dark:text-slate-300">Please enter your details before starting the chat.</div>
                <input className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="Name" value={chatName} onChange={e => setChatName(e.target.value)} />
                <input className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="Address" value={chatAddress} onChange={e => setChatAddress(e.target.value)} />
                <input className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="Account Name or Number" value={chatAccount} onChange={e => setChatAccount(e.target.value)} />
                {chatError && <div className="text-sm text-red-600 dark:text-red-300">{chatError}</div>}
                <div className="flex items-center justify-end">
                  <button onClick={startChat} className="px-4 py-2 rounded-md bg-[--color-primary-600] text-white hover:bg-[--color-primary-700]">Start Chat</button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col">
                <div className="flex-1 p-4 overflow-y-auto flex flex-col space-y-3">
                  {chatHistory.map((msg, i) => (
                    <div key={`msg-${i}`} className={`w-full flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} items-start`}>
                      <div className={`inline-block max-w-[80%] px-3 py-2 rounded-2xl shadow-sm ${msg.role === 'user' ? 'bg-[--color-primary-600] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200'}`}>
                        <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  ))}
                  {chatLoading && <div className="w-full flex justify-start"><div className="px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-700">...</div></div>}
                </div>
                <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Type your message..."
                    className="flex-1 p-2 bg-slate-100 dark:bg-slate-700 rounded-md border border-slate-200 dark:border-slate-600"
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                  />
                  <button
                    onClick={sendChat}
                    disabled={!chatInput.trim() || chatLoading}
                    className="px-4 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-700] text-white rounded-md disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
