import React, { useEffect, useState } from 'react';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import type { PanelSettings, LandingPageConfig, CompanySettings } from '../types.ts';

export const LandingPage: React.FC = () => {
  const { t } = useLocalization();
  const [companySettings, setCompanySettings] = useState<CompanySettings>({ companyName: '', address: '', contactNumber: '', email: '', logoBase64: '' });
  const [panelSettings, setPanelSettings] = useState<PanelSettings | null>(null);
  const cfg: LandingPageConfig = panelSettings?.landingPageConfig || {};
  const [selectedPlan, setSelectedPlan] = useState<string>('');
  const [inqName, setInqName] = useState<string>('');
  const [inqEmail, setInqEmail] = useState<string>('');
  const [inqPhone, setInqPhone] = useState<string>('');
  const [inqMessage, setInqMessage] = useState<string>('');
  const [inqStatus, setInqStatus] = useState<string>('');
  const goto = (path: string) => { window.location.href = path; };
  useEffect(() => { (async () => { try { const res = await fetch(`/api/public/landing-page?v=${Date.now()}`, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, cache: 'no-store' }); if (res.ok) { const data = await res.json(); setCompanySettings(data.company as CompanySettings); setPanelSettings({ landingPageConfig: data.config } as PanelSettings); } } catch {} })(); }, []);
  useEffect(() => { const title = cfg.webTitle || companySettings.companyName || 'ISP Panel'; if (title) document.title = title; }, [cfg.webTitle, companySettings.companyName]);
  const scrollTo = (id: string) => { const el = document.querySelector(id); if (el) el.scrollIntoView({ behavior: 'smooth' }); };
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
      setInqStatus('Nai-submit na ang inquiry. Salamat!');
      setInqName(''); setInqEmail(''); setInqPhone(''); setInqMessage('');
    } catch {
      setInqStatus('Nagka-error sa pag-submit.');
    }
  };
  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
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
            <div className="aspect-[16/10] rounded-lg bg-gradient-to-br from-[--color-primary-300] to-[--color-primary-600] opacity-90 grid place-content-center text-white text-lg font-semibold">
              {cfg.webTitle || companySettings.companyName || 'ISP Products'}
            </div>
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
              <input className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="Pangalan" value={inqName} onChange={e => setInqName(e.target.value)} />
              <input className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="Email" value={inqEmail} onChange={e => setInqEmail(e.target.value)} />
              <input className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="Telepono" value={inqPhone} onChange={e => setInqPhone(e.target.value)} />
              <select className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" value={selectedPlan} onChange={e => setSelectedPlan(e.target.value)}>
                <option value="">Plan</option>
                {(cfg.plans || []).map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </div>
            <div className="space-y-3">
              <textarea className="w-full h-[180px] px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="Mensahe" value={inqMessage} onChange={e => setInqMessage(e.target.value)} />
              <div className="flex items-center gap-3">
                <button onClick={submitInquiry} className="px-4 py-2 rounded-md bg-[--color-primary-500] text-white hover:opacity-90">I-submit</button>
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
    </div>
  );
};
