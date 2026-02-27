import React from 'react';
import { useLocalization } from '../contexts/LocalizationContext.tsx';

export const LandingPage: React.FC = () => {
  const { t } = useLocalization();
  const goto = (path: string) => { window.location.href = path; };
  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-200/60 dark:border-slate-800/60 bg-white/70 dark:bg-slate-900/70 backdrop-blur">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-[--color-primary-500] text-white grid place-content-center font-bold">AJC</div>
            <span className="font-semibold">AJC Vendo System • ISP Panel</span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            <button onClick={() => goto('#features')} className="hover:text-[--color-primary-500]">Features</button>
            <button onClick={() => goto('#plans')} className="hover:text-[--color-primary-500]">Plans</button>
            <button onClick={() => goto('#contact')} className="hover:text-[--color-primary-500]">Contact</button>
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
            <p className="text-sm font-medium text-[--color-primary-500] tracking-wide uppercase">All‑in‑One ISP Suite</p>
            <h1 className="mt-3 text-4xl md:text-5xl font-bold leading-tight">
              Mikrotik Billing & Network Management
            </h1>
            <p className="mt-4 text-slate-600 dark:text-slate-300">
              Automate PPPoE, DHCP captive portal, billing, receipts, and client notifications. 
              Built for small to mid‑size ISPs using MikroTik.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <button onClick={() => goto('#plans')} className="px-6 py-3 rounded-md bg-[--color-primary-500] text-white hover:opacity-90">View Plans</button>
              <button onClick={() => goto('/register')} className="px-6 py-3 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">Create Admin</button>
            </div>
            <p className="mt-3 text-xs text-slate-500">Have an account? <span className="underline cursor-pointer" onClick={() => goto('/login')}>Login</span></p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-white dark:bg-slate-900">
            <div className="aspect-[16/10] rounded-lg bg-gradient-to-br from-[--color-primary-300] to-[--color-primary-600] opacity-90 grid place-content-center text-white text-lg font-semibold">
              ISP Products Preview
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
            <div className="p-6 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="text-[--color-primary-500] font-semibold">Billing & Receipts</div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Auto‑invoice, printable receipts, and payment tracking.</p>
            </div>
            <div className="p-6 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="text-[--color-primary-500] font-semibold">Network Automation</div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">PPPoE, DHCP portal, queues, and firewall templates.</p>
            </div>
            <div className="p-6 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="text-[--color-primary-500] font-semibold">Client Portal</div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Clients can check status, invoices, and chat.</p>
            </div>
          </div>
        </section>

        <section id="plans" className="mx-auto max-w-7xl px-6 py-16">
          <h2 className="text-2xl font-bold">Sample Plans</h2>
          <p className="text-slate-600 dark:text-slate-300 text-sm mt-1">Customize these in the admin panel.</p>
          <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { name: 'Starter', speed: '5 Mbps', price: '₱499 / mo' },
              { name: 'Home 10', speed: '10 Mbps', price: '₱799 / mo' },
              { name: 'Home 20', speed: '20 Mbps', price: '₱1,099 / mo' },
            ].map(p => (
              <div key={p.name} className="p-6 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="font-semibold">{p.name}</div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{p.speed}</div>
                <div className="mt-2 text-[--color-primary-500] font-bold">{p.price}</div>
                <button className="mt-4 w-full px-4 py-2 rounded-md bg-[--color-primary-500] text-white hover:opacity-90">Inquire</button>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer id="contact" className="border-t border-slate-200 dark:border-slate-800">
        <div className="mx-auto max-w-7xl px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-sm text-slate-600 dark:text-slate-400">© {new Date().getFullYear()} AJC Vendo System</div>
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

