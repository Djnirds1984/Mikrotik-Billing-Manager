
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar.tsx';
import { TopBar } from './components/TopBar.tsx';
import { Dashboard } from './components/Dashboard.tsx';
import { Help } from './components/Help.tsx';
import { Loader } from './components/Loader.tsx';
import { UnlicensedComponent } from './components/UnlicensedComponent.tsx';
import { CaptivePortalPage } from './components/CaptivePortalPage.tsx';

const Scripting = React.lazy(() => import('./components/Scripting.tsx').then(m => ({ default: m.Scripting })));
const Routers = React.lazy(() => import('./components/Routers.tsx').then(m => ({ default: m.Routers })));
const Updater = React.lazy(() => import('./components/Updater.tsx').then(m => ({ default: m.Updater })));
const Pppoe = React.lazy(() => import('./components/Pppoe.tsx').then(m => ({ default: m.Pppoe })));
const Billing = React.lazy(() => import('./components/Billing.tsx').then(m => ({ default: m.Billing })));
const Remote = React.lazy(() => import('./components/Remote.tsx').then(m => ({ default: m.Remote })));
const Hotspot = React.lazy(() => import('./components/Hotspot.tsx').then(m => ({ default: m.Hotspot })));
const SystemSettings = React.lazy(() => import('./components/SystemSettings.tsx').then(m => ({ default: m.SystemSettings })));
const SalesReport = React.lazy(() => import('./components/SalesReport.tsx').then(m => ({ default: m.SalesReport })));
const Network = React.lazy(() => import('./components/Network.tsx').then(m => ({ default: m.Network })));
const Inventory = React.lazy(() => import('./components/Inventory.tsx').then(m => ({ default: m.Inventory })));
const Company = React.lazy(() => import('./components/Company.tsx').then(m => ({ default: m.Company })));
const Terminal = React.lazy(() => import('./components/Terminal.tsx').then(m => ({ default: m.Terminal })));
const Login = React.lazy(() => import('./components/Login.tsx').then(m => ({ default: m.Login })));
const Register = React.lazy(() => import('./components/Register.tsx').then(m => ({ default: m.Register })));
const ForgotPassword = React.lazy(() => import('./components/ForgotPassword.tsx').then(m => ({ default: m.ForgotPassword })));
const AuthLayout = React.lazy(() => import('./components/AuthLayout.tsx').then(m => ({ default: m.AuthLayout })));
const Logs = React.lazy(() => import('./components/Logs.tsx').then(m => ({ default: m.Logs })));
const PanelRoles = React.lazy(() => import('./components/PanelRoles.tsx').then(m => ({ default: m.PanelRoles })));
const MikrotikFiles = React.lazy(() => import('./components/MikrotikFiles.tsx').then(m => ({ default: m.MikrotikFiles })));
const License = React.lazy(() => import('./components/License.tsx').then(m => ({ default: m.License })));
const SuperAdmin = React.lazy(() => import('./components/SuperAdmin.tsx').then(m => ({ default: m.SuperAdmin })));
const DhcpPortal = React.lazy(() => import('./components/DhcpPortal.tsx').then(m => ({ default: m.DhcpPortal })));
const NotificationsPage = React.lazy(() => import('./components/NotificationsPage.tsx').then(m => ({ default: m.NotificationsPage })));
const Payroll = React.lazy(() => import('./components/Payroll.tsx').then(m => ({ default: m.Payroll })));
import { useRouters } from './hooks/useRouters.ts';
import { useSalesData } from './hooks/useSalesData.ts';
import { useInventoryData } from './hooks/useInventoryData.ts';
import { useExpensesData } from './hooks/useExpensesData.ts';
import { useCompanySettings } from './hooks/useCompanySettings.ts';
import { usePayrollData } from './hooks/usePayrollData.ts';
import { LocalizationProvider, useLocalization } from './contexts/LocalizationContext.tsx';
import { ThemeProvider } from './contexts/ThemeContext.tsx';
import { NotificationProvider } from './contexts/NotificationContext.tsx';
import { useAuth } from './contexts/AuthContext.tsx';
import type { View, LicenseStatus, PanelSettings } from './types.ts';
import { getAuthHeader, getPanelSettings } from './services/databaseService.ts';
import { initializeAiClient } from './services/geminiService.ts';
import { initializeXenditService } from './services/xenditService.ts';


const useMediaQuery = (query: string): boolean => {
  const getMatches = (query: string): boolean => {
    if (typeof window !== 'undefined') {
      return window.matchMedia(query).matches;
    }
    return false;
  };

  const [matches, setMatches] = useState<boolean>(getMatches(query));

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const handleChange = () => setMatches(mediaQuery.matches);
    
    try {
        mediaQuery.addEventListener('change', handleChange);
    } catch (e) {
        mediaQuery.addListener(handleChange);
    }

    return () => {
       try {
            mediaQuery.removeEventListener('change', handleChange);
        } catch (e) {
            mediaQuery.removeListener(handleChange);
        }
    };
  }, [query]);

  return matches;
};

interface AppContentProps {
    licenseStatus: LicenseStatus | null;
    onLicenseChange: () => void;
}

const AppContent: React.FC<AppContentProps> = ({ licenseStatus, onLicenseChange }) => {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const isLargeScreen = useMediaQuery('(min-width: 1024px)');
  const [isSidebarOpen, setIsSidebarOpen] = useState(isLargeScreen);
  const [selectedRouterId, setSelectedRouterId] = useState<string | null>(null);
  
  const { routers, addRouter, updateRouter, deleteRouter, isLoading: isLoadingRouters } = useRouters();
  const { sales, addSale, deleteSale, clearSales, isLoading: isLoadingSales } = useSalesData(selectedRouterId, currentView === 'sales');
  const { items, addItem, updateItem, deleteItem, isLoading: isLoadingInventory } = useInventoryData(currentView === 'inventory');
  const { expenses, addExpense, updateExpense, deleteExpense, isLoading: isLoadingExpenses } = useExpensesData(currentView === 'inventory');
  const payrollData = usePayrollData(currentView === 'payroll');
  const { settings: companySettings, updateSettings: updateCompanySettings, isLoading: isLoadingCompany } = useCompanySettings();
  const { t, isLoading: isLoadingLocalization } = useLocalization();

  useEffect(() => {
    const initServices = async () => {
        try {
            const settings = await getPanelSettings() as PanelSettings;
            
            const aiKey = settings?.geminiApiKey || (window as any).process?.env?.API_KEY;
            initializeAiClient(aiKey);

            if (settings?.xenditSettings?.enabled && settings.xenditSettings.secretKey) {
                initializeXenditService({
                    secretKey: settings.xenditSettings.secretKey,
                    publicKey: settings.xenditSettings.publicKey,
                    webhookToken: settings.xenditSettings.webhookToken,
                });
                console.log("Xendit Service Initialized.");
            }

        } catch (error) {
            console.error("Could not load settings for service initialization:", error);
            initializeAiClient((window as any).process?.env?.API_KEY);
        }
    };
    initServices();
  }, []);

  const appIsLoading = isLoadingRouters || isLoadingSales || isLoadingInventory || isLoadingCompany || isLoadingLocalization || isLoadingExpenses || payrollData.isLoading;
  useEffect(() => { performance.mark('panel-init-start'); }, []);
  useEffect(() => { if (!appIsLoading) { performance.mark('panel-init-end'); try { performance.measure('panel-init', 'panel-init-start', 'panel-init-end'); const m = performance.getEntriesByName('panel-init'); const last = m[m.length - 1]; if (last) { localStorage.setItem('panelLoadTimeMs', String(Math.round(last.duration))); } } catch {} } }, [appIsLoading]);

  useEffect(() => {
    setIsSidebarOpen(isLargeScreen);
  }, [isLargeScreen]);

  useEffect(() => {
    if (!isLargeScreen) {
        setIsSidebarOpen(false);
    }
  }, [currentView, isLargeScreen]);

  useEffect(() => {
    if (!appIsLoading && routers.length > 0 && !selectedRouterId) {
        setSelectedRouterId(routers[0].id);
    }
  }, [appIsLoading, routers, selectedRouterId]);

  useEffect(() => {
    if (!selectedRouterId && routers.length > 0) {
      setSelectedRouterId(routers[0].id);
    }
    if (selectedRouterId && !routers.find(r => r.id === selectedRouterId)) {
        setSelectedRouterId(routers.length > 0 ? routers[0].id : null);
    }
  }, [routers, selectedRouterId]);

  const selectedRouter = useMemo(
    () => routers.find(r => r.id === selectedRouterId) || null,
    [routers, selectedRouterId]
  );

  const renderView = () => {
    if (appIsLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-full">
                <Loader />
                <p className="mt-4 text-[--color-primary-400]">{t('app.loading_data')}</p>
            </div>
        );
    }

    const licensedViews: View[] = [
        'dashboard', 'scripting', 'terminal', 'network', 'pppoe', 'billing', 'sales',
        'inventory', 'payroll', 'hotspot', 'mikrotik_files', 'remote', 'logs', 'dhcp-portal'
    ];

    if (!licenseStatus?.licensed && licensedViews.includes(currentView)) {
        return <UnlicensedComponent setCurrentView={setCurrentView} />;
    }

    switch (currentView) {
      case 'dashboard':
        return <Dashboard selectedRouter={selectedRouter} />;
      case 'notifications':
        return <NotificationsPage setCurrentView={setCurrentView} />;
      case 'scripting':
        return <Scripting />;
      case 'routers':
        return <Routers routers={routers} onAddRouter={addRouter} onUpdateRouter={updateRouter} onDeleteRouter={deleteRouter} />;
      case 'network':
          return <Network selectedRouter={selectedRouter} />;
      case 'terminal':
          return <Terminal selectedRouter={selectedRouter} />;
      case 'dhcp-portal':
          return <DhcpPortal selectedRouter={selectedRouter} addSale={addSale} />;
      case 'pppoe':
          return <Pppoe selectedRouter={selectedRouter} addSale={addSale} />;
      case 'billing':
          return <Billing selectedRouter={selectedRouter} />;
      case 'sales':
          return <SalesReport salesData={sales} deleteSale={deleteSale} clearSales={clearSales} companySettings={companySettings} />;
      case 'inventory':
          return <Inventory 
                    items={items} 
                    addItem={addItem} 
                    updateItem={updateItem} 
                    deleteItem={deleteItem}
                    expenses={expenses}
                    addExpense={addExpense}
                    updateExpense={updateExpense}
                    deleteExpense={deleteExpense}
                 />;
      case 'payroll':
          return <Payroll {...payrollData} />;
      case 'hotspot':
          return <Hotspot selectedRouter={selectedRouter} />;
      case 'remote':
          return <Remote />;
      case 'mikrotik_files':
          return <MikrotikFiles selectedRouter={selectedRouter} />;
      case 'company':
          return <Company settings={companySettings} onSave={updateCompanySettings} />;
      case 'system':
          return <SystemSettings />;
      case 'updater':
        return <Updater />;
      case 'logs':
        return <Logs selectedRouter={selectedRouter} />;
      case 'panel_roles':
        return <PanelRoles />;
      case 'license':
          return <License onLicenseChange={onLicenseChange} licenseStatus={licenseStatus} />;
      case 'super_admin':
          return <SuperAdmin />;
      default:
        return <Dashboard selectedRouter={selectedRouter} />;
    }
  };

  return (
    <div className="flex bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 min-h-screen">
      <Sidebar 
        currentView={currentView} 
        setCurrentView={setCurrentView} 
        companySettings={companySettings}
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
        licenseStatus={licenseStatus}
      />
      {isSidebarOpen && !isLargeScreen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        ></div>
      )}
      <main className="flex-1 flex flex-col min-w-0">
        <TopBar
          title={t(`titles.${currentView}`)}
          routers={routers}
          selectedRouter={selectedRouter}
          onSelectRouter={setSelectedRouterId}
          setCurrentView={setCurrentView}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        />
        <div className="p-4 sm:p-8 overflow-auto h-full flex flex-col">
          <div className="flex-grow">
             <React.Suspense fallback={<Loader />}>{renderView()}</React.Suspense>
          </div>
        </div>
      </main>
      <Help currentView={currentView} selectedRouter={selectedRouter} />
    </div>
  );
};

const AppRouter: React.FC = () => {
    const { user, isLoading, hasUsers } = useAuth();
    const [authView, setAuthView] = useState<'login' | 'register' | 'forgot'>('login');
    const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
    const [isLicenseLoading, setIsLicenseLoading] = useState(true);
    let licenseCheckInterval = React.useRef<number | null>(null);

    if (window.location.pathname.startsWith('/captive')) {
        return (
            <ThemeProvider>
                <LocalizationProvider>
                    <CaptivePortalPage />
                </LocalizationProvider>
            </ThemeProvider>
        );
    }

    const checkLicense = useCallback(async () => {
        try {
            const res = await fetch('/api/license/status', { headers: getAuthHeader() });
             if (!res.ok) {
                console.error('Failed to fetch license status:', res.statusText);
                setLicenseStatus(null);
                return;
            }
            const data: LicenseStatus = await res.json();
            setLicenseStatus(data);
        } catch (error) {
            console.error(error);
            setLicenseStatus(null); // Treat errors as unlicensed
        } finally {
            setIsLicenseLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!isLoading) {
            if (!hasUsers) {
                setAuthView('register');
            } else {
                setAuthView('login');
            }
        }
    }, [isLoading, hasUsers]);
    
    useEffect(() => {
        if (user) {
            setIsLicenseLoading(true);
            checkLicense();
            
            if (licenseCheckInterval.current) {
                clearInterval(licenseCheckInterval.current);
            }
            licenseCheckInterval.current = window.setInterval(checkLicense, 5000);
        } else if (!isLoading) {
            setIsLicenseLoading(false);
            setLicenseStatus(null);
             if (licenseCheckInterval.current) {
                clearInterval(licenseCheckInterval.current);
            }
        }

        return () => {
            if (licenseCheckInterval.current) {
                clearInterval(licenseCheckInterval.current);
            }
        };
    }, [user, isLoading, checkLicense]);

    const handleLicenseChange = () => {
        setIsLicenseLoading(true);
        checkLicense();
    };

    if (isLoading) {
        return <div className="flex h-screen w-screen items-center justify-center"><Loader /></div>;
    }

    if (!user) {
        return (
            <ThemeProvider>
                 <LocalizationProvider>
            <React.Suspense fallback={<Loader />}>
                <AuthLayout>
                    {!hasUsers ? (
                        <Register />
                    ) : authView === 'login' ? (
                        <Login onSwitchToForgotPassword={() => setAuthView('forgot')} />
                    ) : (
                        <ForgotPassword onSwitchToLogin={() => setAuthView('login')} />
                    )}
                </AuthLayout>
            </React.Suspense>
                 </LocalizationProvider>
            </ThemeProvider>
        );
    }
    
    if (isLicenseLoading) {
        return <div className="flex h-screen w-screen items-center justify-center"><Loader /></div>;
    }

    if (!licenseStatus?.licensed && user.role.name.toLowerCase() !== 'superadmin') {
         return (
             <ThemeProvider>
                <LocalizationProvider>
                    <React.Suspense fallback={<Loader />}>
                        <License onLicenseChange={handleLicenseChange} licenseStatus={licenseStatus} />
                    </React.Suspense>
                </LocalizationProvider>
            </ThemeProvider>
         );
    }
    
    return (
        <ThemeProvider>
            <LocalizationProvider>
                <NotificationProvider>
                    <AppContent licenseStatus={licenseStatus} onLicenseChange={handleLicenseChange} />
                </NotificationProvider>
            </LocalizationProvider>
        </ThemeProvider>
    );
};

export default AppRouter;
