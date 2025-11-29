import React, { useMemo } from 'react';
import { MikroTikLogoIcon, BellIcon, EthernetIcon, EditIcon, RouterIcon, VlanIcon, UpdateIcon, SignalIcon, UsersIcon, WifiIcon, CogIcon, CurrencyDollarIcon, ShareIcon, ArchiveBoxIcon, BuildingOffice2Icon, ShieldCheckIcon, CodeBracketIcon, KeyIcon, LockClosedIcon, ServerIcon, CalculatorIcon, CloudIcon } from '../constants.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import type { View, CompanySettings, LicenseStatus } from '../types.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useNotifications } from '../contexts/NotificationContext.tsx';

interface SidebarProps {
  currentView: View;
  setCurrentView: (view: View) => void;
  companySettings: CompanySettings;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  licenseStatus: LicenseStatus | null;
}

const NavItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
  badge?: number;
}> = ({ icon, label, isActive, onClick, disabled, badge }) => {
  return (
    <li>
      <button
        onClick={disabled ? undefined : onClick}
        className={`flex items-center w-full p-3 text-base rounded-lg transition duration-150 group ${
          isActive
            ? 'bg-[--color-primary-500]/10 text-[--color-primary-600] dark:text-[--color-primary-300] font-semibold'
            : disabled
            ? 'text-slate-400 dark:text-slate-600 cursor-not-allowed bg-slate-100 dark:bg-slate-800'
            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700/50'
        }`}
        disabled={disabled}
      >
        {icon}
        <span className="flex-1 ml-3 text-left whitespace-nowrap">{label}</span>
        {badge > 0 && (
            <span className="inline-flex items-center justify-center px-2 py-0.5 ml-3 text-xs font-medium text-white bg-red-500 rounded-full">
                {badge > 9 ? '9+' : badge}
            </span>
        )}
      </button>
    </li>
  );
};

const CloseIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
);

const TerminalIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);


export const Sidebar: React.FC<SidebarProps> = ({ currentView, setCurrentView, companySettings, isOpen, setIsOpen, licenseStatus }) => {
  const { user } = useAuth();
  const { t } = useLocalization();
  const { unreadCount } = useNotifications();
  
  const navItems = useMemo(() => [
    { id: 'dashboard', label: t('sidebar.dashboard'), icon: <EthernetIcon className="w-6 h-6" /> },
    { id: 'notifications', label: t('sidebar.notifications'), icon: <BellIcon className="w-6 h-6" />, badge: unreadCount },
    { id: 'scripting', label: t('sidebar.ai_scripting'), icon: <EditIcon className="w-6 h-6" /> },
    { id: 'terminal', label: t('sidebar.terminal'), icon: <TerminalIcon className="w-6 h-6" /> },
    { id: 'routers', label: t('sidebar.routers'), icon: <RouterIcon className="w-6 h-6" /> },
    { id: 'network', label: t('sidebar.network'), icon: <ShareIcon className="w-6 h-6" /> },
    { id: 'dhcp-portal', label: t('sidebar.dhcp-portal'), icon: <ServerIcon className="w-6 h-6" /> },
    { id: 'pppoe', label: t('sidebar.pppoe'), icon: <UsersIcon className="w-6 h-6" /> },
    { id: 'billing', label: t('sidebar.billing_plans'), icon: <SignalIcon className="w-6 h-6" /> },
    { id: 'sales', label: t('sidebar.sales_report'), icon: <CurrencyDollarIcon className="w-6 h-6" /> },
    { id: 'inventory', label: t('sidebar.inventory'), icon: <ArchiveBoxIcon className="w-6 h-6" /> },
    { id: 'payroll', label: t('sidebar.payroll'), icon: <CalculatorIcon className="w-6 h-6" /> },
    { id: 'hotspot', label: t('sidebar.hotspot'), icon: <WifiIcon className="w-6 h-6" /> },
    { id: 'remote', label: t('sidebar.remote'), icon: <CloudIcon className="w-6 h-6" /> },
    { id: 'mikrotik_files', label: t('sidebar.mikrotik_files'), icon: <ArchiveBoxIcon className="w-6 h-6" /> },
    { id: 'company', label: t('sidebar.company'), icon: <BuildingOffice2Icon className="w-6 h-6" /> },
    { id: 'system', label: t('sidebar.system_settings'), icon: <CogIcon className="w-6 h-6" /> },
    { id: 'panel_roles', label: t('sidebar.panel_roles'), icon: <KeyIcon className="w-6 h-6" /> },
    { id: 'client_portal_users', label: t('sidebar.client_portal_users'), icon: <ShieldCheckIcon className="w-6 h-6" /> },
    { id: 'updater', label: t('sidebar.updater'), icon: <UpdateIcon className="w-6 h-6" /> },
    { id: 'logs', label: t('sidebar.logs'), icon: <CodeBracketIcon className="w-6 h-6" /> },
    { id: 'license', label: t('sidebar.license'), icon: <KeyIcon className="w-6 h-6" /> },
    { id: 'super_admin', label: t('sidebar.super_admin'), icon: <LockClosedIcon className="w-6 h-6" /> },
  ], [t, unreadCount]);

  const filteredNavItems = useMemo(() => {
    if (!user) return [];
    const isAdmin = user.role.name.toLowerCase() === 'administrator';
    const isSuperadmin = user.role.name.toLowerCase() === 'superadmin';

    return navItems.filter(item => {
      if (item.id === 'super_admin' && !isSuperadmin) {
        return false;
      }
      if (item.id === 'panel_roles' && !isAdmin && !isSuperadmin) {
        return false;
      }
      return true;
    });
  }, [navItems, user]);

  const licensedViews: View[] = [
      'dashboard', 'scripting', 'terminal', 'network', 'pppoe', 'billing', 'sales',
      'inventory', 'payroll', 'hotspot', 'mikrotik_files', 'remote', 'logs', 'dhcp-portal'
  ];

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 w-64 h-screen bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-transform duration-300 ease-in-out lg:sticky lg:translate-x-0 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
      aria-label="Sidebar"
    >
      <div className="flex items-center justify-between h-16 border-b border-slate-200 dark:border-slate-800 px-4">
          <div className="flex items-center min-w-0">
              {companySettings.logoBase64 ? (
                <img src={companySettings.logoBase64} alt="Company Logo" className="h-10 w-auto object-contain flex-shrink-0" />
              ) : (
                 <MikroTikLogoIcon className="w-8 h-8 text-[--color-primary-500] flex-shrink-0" />
              )}
              <span className="self-center ml-3 text-xl font-semibold whitespace-nowrap text-slate-900 dark:text-white truncate">
                {companySettings.companyName || 'MikroTik UI'}
              </span>
          </div>
          <button onClick={() => setIsOpen(false)} className="lg:hidden text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white p-1" aria-label="Close sidebar">
              <CloseIcon className="w-6 h-6" />
          </button>
      </div>
      <div className="h-[calc(100vh-4rem)] px-3 py-4 overflow-y-auto flex flex-col justify-between">
        <ul className="space-y-2">
          {filteredNavItems.map((item) => (
            <NavItem
              key={item.id}
              label={item.label}
              icon={item.icon}
              isActive={currentView === item.id}
              onClick={() => setCurrentView(item.id as View)}
              disabled={!licenseStatus?.licensed && licensedViews.includes(item.id as View)}
              badge={item.badge || 0}
            />
          ))}
        </ul>
        <div className="text-center text-xs text-slate-400 dark:text-slate-600 mt-4">
            v1.6.0
        </div>
      </div>
    </aside>
  );
};