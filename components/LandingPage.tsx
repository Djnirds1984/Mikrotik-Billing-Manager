import React, { useEffect, useState } from 'react';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { useCompanySettings } from '../hooks/useCompanySettings.ts';
import { getPanelSettings } from '../services/databaseService.ts';
import type { PanelSettings, LandingPageConfig } from '../types.ts';

export const LandingPage: React.FC = () => {
  const { t } = useLocalization();
  const { settings: companySettings } = useCompanySettings();
  const [panelSettings, setPanelSettings] = useState<PanelSettings | null>(null);
  const cfg: LandingPageConfig = panelSettings?.landingPageConfig || {};
  const goto = (path: string) => { window.location.href = path; };
  useEffect(() => { (async () => { try { const s = await getPanelSettings(); setPanelSettings(s); } catch {} })(); }, []);
  useEffect(() => { const title = cfg.webTitle || companySettings.companyName || 'ISP Panel'; if (title) document.title = title; }, [cfg.webTitle, companySettings.companyName]);
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
            {(cfg.pages && cfg.pages.length > 0 ? cfg.pages : [
              { id: 'features', label: 'Features' },
              { id: 'plans', label: 'Plans' },
              { id: 'contact', label: 'Contact' },
            ]).map(p => (
              <button key={p.id} onClick={() => goto(`#${p.id}`)} className="hover:text-[--color-primary-500]">{p.label}</button>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <button onClick={() => goto('/login')} className="px-4 py-2 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">
              Admin Login
            </button>
            <button onClick={() => goto('/client_portal')} className="px-4 py-2 rounded-md bg-[--color-primary-500] text-white hover:opacity-90">
              Client Portal
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
              <button onClick={() => goto('#plans')} className="px-6 py-3 rounded-md bg-[--color-primary-500] text-white hover:opacity-90">View Plans</button>
            </div>
            <p className="mt-3 text-xs text-slate-500">Have an account? <span className="underline cursor-pointer" onClick={() => goto('/login')}>Login</span></p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-white dark:bg-slate-900">
            <div className="aspect-[16/10] rounded-lg bg-gradient-to-br from-[--color-primary-300] to-[--color-primary-600] opacity-90 grid place-content-center text-white text-lg font-semibold">
              {cfg.webTitle || companySettings.companyName || 'ISP Products'}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-md border border-slate-200 dark:border-slate-800 p-3">
                <div className="font-semibold">Prepaid</div>
                <div className="text-slate-500 text-xs">Voucher‑based internet</div>
                <div className="mt-2 text-[--color-primary-500] font-bold">₱50 / day</div>
              </div>
              <div className="rounded-md border border-slate-200 dark:border-slate-800 p-3">
                <div className="font-semibold">Basic</div>
                <div className="text-slate-500 text-xs">10 Mbps Home</div>
                <div className="mt-2 text-[--color-primary-500] font-bold">₱799 / mo</div>
              </div>
              <div className="rounded-md border border-slate-200 dark:border-slate-800 p-3">
                <div className="font-semibold">Pro</div>
                <div className="text-slate-500 text-xs">30 Mbps Business</div>
                <div className="mt-2 text-[--color-primary-500] font-bold">₱1,999 / mo</div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="bg-slate-50 dark:bg-slate-950/40 border-y border-slate-200 dark:border-slate-800">
          <div className="mx-auto max-w-7xl px-6 py-14 grid md:grid-cols-3 gap-6">
            {(cfg.features && cfg.features.length > 0 ? cfg.features : [
              { title: 'Billing & Receipts', description: 'Auto‑invoice, printable receipts, and payment tracking.' },
              { title: 'Network Automation', description: 'PPPoE, DHCP portal, queues, and firewall templates.' },
              { title: 'Client Portal', description: 'Clients can check status, invoices, and chat.' },
            ]).map((f, i) => (
              <div key={`feat-${i}`} className="p-6 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="text-[--color-primary-500] font-semibold">{f.title}</div>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{f.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="plans" className="mx-auto max-w-7xl px-6 py-16">
          <h2 className="text-2xl font-bold">Sample Plans</h2>
          <p className="text-slate-600 dark:text-slate-300 text-sm mt-1">Customize these in the admin panel.</p>
          <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {(cfg.plans && cfg.plans.length > 0 ? cfg.plans : [
              { name: 'Starter', speedText: '5 Mbps', priceText: '₱499 / mo', ctaLabel: 'Inquire' },
              { name: 'Home 10', speedText: '10 Mbps', priceText: '₱799 / mo', ctaLabel: 'Inquire' },
              { name: 'Home 20', speedText: '20 Mbps', priceText: '₱1,099 / mo', ctaLabel: 'Inquire' },
            ]).map(p => (
              <div key={p.name} className="p-6 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="font-semibold">{p.name}</div>
                {p.speedText && <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{p.speedText}</div>}
                <div className="mt-2 text-[--color-primary-500] font-bold">{p.priceText}</div>
                <button className="mt-4 w-full px-4 py-2 rounded-md bg-[--color-primary-500] text-white hover:opacity-90">{p.ctaLabel || 'Inquire'}</button>
              </div>
            ))}
          </div>
        </section>
        {(cfg.pages || []).filter(p => !['features','plans','contact'].includes(p.id)).map(p => (
          <section key={`sec-${p.id}`} id={p.id} className="mx-auto max-w-7xl px-6 py-16">
            <h2 className="text-2xl font-bold">{p.label}</h2>
            <p className="text-slate-600 dark:text-slate-300 text-sm mt-1">Customize this section content.</p>
          </section>
        ))}
      </main>

      <footer id="contact" className="border-t border-slate-200 dark:border-slate-800">
        <div className="mx-auto max-w-7xl px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-sm text-slate-600 dark:text-slate-400">© {new Date().getFullYear()} {cfg.webTitle || companySettings.companyName || 'ISP Panel'}</div>
          <div className="flex items-center gap-4 text-sm">
            <a href="mailto:support@ajcvendosystem.com" className="hover:text-[--color-primary-500]">Email</a>
            <a href="#" className="hover:text-[--color-primary-500]">Facebook</a>
            <a href="#" className="hover:text-[--color-primary-500]">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
};
