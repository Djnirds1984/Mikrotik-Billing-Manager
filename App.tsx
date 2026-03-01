
import React, { useState, useMemo, useEffect, useCallback, Suspense } from 'react';
import { Sidebar } from './components/Sidebar.tsx';
import { TopBar } from './components/TopBar.tsx';
import { Loader } from './components/Loader.tsx';
import { AuthLayout } from './components/AuthLayout.tsx';
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

const Dashboard = React.lazy(() => import('./components/Dashboard.tsx').then(m => ({ default: m.Dashboard })));
const Scripting = React.lazy(() => import('./components/Scripting.tsx').then(m => ({ default: m.Scripting })));
const Routers = React.lazy(() => import('./components/Routers.tsx').then(m => ({ default: m.Routers })));
const Updater = React.lazy(() => import('./components/Updater.tsx').then(m => ({ default: m.Updater })));
const Pppoe = React.lazy(() => import('./components/Pppoe.tsx').then(m => ({ default: m.Pppoe })));
const Billing = React.lazy(() => import('./components/Billing.tsx').then(m => ({ default: m.Billing })));
const Remote = React.lazy(() => import('./components/Remote.tsx').then(m => ({ default: m.Remote })));
const Hotspot = React.lazy(() => import('./components/Hotspot.tsx').then(m => ({ default: m.Hotspot })));
const Help = React.lazy(() => import('./components/Help.tsx').then(m => ({ default: m.Help })));
const SystemSettings = React.lazy(() => import('./components/SystemSettings.tsx').then(m => ({ default: m.SystemSettings })));
const SalesReport = React.lazy(() => import('./components/SalesReport.tsx').then(m => ({ default: m.SalesReport })));
const Network = React.lazy(() => import('./components/Network.tsx').then(m => ({ default: m.Network })));
const Inventory = React.lazy(() => import('./components/Inventory.tsx').then(m => ({ default: m.Inventory })));
const Company = React.lazy(() => import('./components/Company.tsx').then(m => ({ default: m.Company })));
const Terminal = React.lazy(() => import('./components/Terminal.tsx').then(m => ({ default: m.Terminal })));
const Login = React.lazy(() => import('./components/Login.tsx').then(m => ({ default: m.Login })));
const Register = React.lazy(() => import('./components/Register.tsx').then(m => ({ default: m.Register })));
const ForgotPassword = React.lazy(() => import('./components/ForgotPassword.tsx').then(m => ({ default: m.ForgotPassword })));
const Logs = React.lazy(() => import('./components/Logs.tsx').then(m => ({ default: m.Logs })));
const PanelRoles = React.lazy(() => import('./components/PanelRoles.tsx').then(m => ({ default: m.PanelRoles })));
const MikrotikFiles = React.lazy(() => import('./components/MikrotikFiles.tsx').then(m => ({ default: m.MikrotikFiles })));
const License = React.lazy(() => import('./components/License.tsx').then(m => ({ default: m.License })));
const SuperAdmin = React.lazy(() => import('./components/SuperAdmin.tsx').then(m => ({ default: m.SuperAdmin })));
const UnlicensedComponent = React.lazy(() => import('./components/UnlicensedComponent.tsx').then(m => ({ default: m.UnlicensedComponent })));
const DhcpPortal = React.lazy(() => import('./components/DhcpPortal.tsx').then(m => ({ default: m.DhcpPortal })));
const ClientPortal = React.lazy(() => import('./components/ClientPortal.tsx').then(m => ({ default: m.ClientPortal })));
const ClientPortalUsers = React.lazy(() => import('./components/ClientPortalUsers.tsx').then(m => ({ default: m.ClientPortalUsers })));
const CaptivePortalPage = React.lazy(() => import('./components/CaptivePortalPage.tsx').then(m => ({ default: m.CaptivePortalPage })));
const NotificationsPage = React.lazy(() => import('./components/NotificationsPage.tsx').then(m => ({ default: m.NotificationsPage })));
const Payroll = React.lazy(() => import('./components/Payroll.tsx').then(m => ({ default: m.Payroll })));
const CaptiveChatAdmin = React.lazy(() => import('./components/CaptiveChatAdmin.tsx').then(m => ({ default: m.CaptiveChatAdmin })));
const LandingPage = React.lazy(() => import('./components/LandingPage.tsx').then(m => ({ default: m.LandingPage })));
const ApplicationForm = React.lazy(() => import('./components/ApplicationForm.tsx').then(m => ({ default: m.ApplicationForm })));


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
  
  const { hasPermission } = useAuth();
  const { routers, addRouter, updateRouter, deleteRouter, isLoading: isLoadingRouters } = useRouters();
  const { sales, addSale, deleteSale, clearSales } = useSalesData(
    selectedRouterId,
    currentView === 'sales' || currentView === 'dhcp-portal' || currentView === 'pppoe'
  );
  const { items, addItem, updateItem, deleteItem } = useInventoryData(currentView === 'inventory');
  const { expenses, addExpense, updateExpense, deleteExpense } = useExpensesData(currentView === 'inventory');
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

  // OPTIMIZATION: Only block UI loading for critical data. 
  // Sales, Inventory, Expenses, and Payroll can load in the background without blocking the dashboard.
  const appIsLoading = isLoadingRouters || isLoadingCompany || isLoadingLocalization;

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
        'scripting', 'terminal', 'network', 'pppoe', 'billing', 'sales',
        'inventory', 'payroll', 'hotspot', 'mikrotik_files', 'remote', 'logs', 'dhcp-portal', 'client_portal_users'
    ];

    if (!licenseStatus?.licensed && licensedViews.includes(currentView)) {
        return (
            <Suspense fallback={<div className="flex flex-col items-center justify-center h-full"><Loader /></div>}>
                <UnlicensedComponent setCurrentView={setCurrentView} />
            </Suspense>
        );
    }

    const permName = `view:sidebar:${currentView}`;
    if (!hasPermission(permName)) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                <div className="text-3xl font-semibold text-slate-700 dark:text-slate-200 mb-2">Access Denied</div>
                <p className="text-slate-500 dark:text-slate-400">Wala kang permission para buksan ang page na ito.</p>
            </div>
        );
    }

    return (
        <Suspense
            fallback={
                <div className="flex flex-col items-center justify-center h-full">
                    <Loader />
                    <p className="mt-4 text-[--color-primary-400]">{t('app.loading_data')}</p>
                </div>
            }
        >
            {(() => {
                switch (currentView) {
                  case 'dashboard':
                    return <Dashboard selectedRouter={selectedRouter} />;
                  case 'application_form':
                    return <ApplicationForm />;
                  case 'notifications':
                    return <NotificationsPage setCurrentView={setCurrentView} />;
                  case 'captive_chat':
                    return <CaptiveChatAdmin />;
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
                      return (
                        <Inventory 
                            items={items} 
                            addItem={addItem} 
                            updateItem={updateItem} 
                            deleteItem={deleteItem}
                            expenses={expenses}
                            addExpense={addExpense}
                            updateExpense={updateExpense}
                            deleteExpense={deleteExpense}
                        />
                      );
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
                  case 'client_portal_users':
                    return <ClientPortalUsers />;
                  case 'license':
                      return <License onLicenseChange={onLicenseChange} licenseStatus={licenseStatus} />;
                  case 'super_admin':
                      return <SuperAdmin />;
                  default:
                    return <Dashboard selectedRouter={selectedRouter} />;
                }
            })()}
        </Suspense>
    );
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
             {renderView()}
          </div>
        </div>
      </main>
      <Suspense fallback={null}>
        <Help currentView={currentView} selectedRouter={selectedRouter} />
      </Suspense>
    </div>
  );
};

const AppRouter: React.FC = () => {
    const { user, isLoading, hasUsers } = useAuth();
    const [authView, setAuthView] = useState<'login' | 'register' | 'forgot'>('login');
    const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
    const [isLicenseLoading, setIsLicenseLoading] = useState(true);
    let licenseCheckInterval = React.useRef<number | null>(null);

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
            console.log('DEBUG: License status updated', data);
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
                console.log('DEBUG: No users found, showing Register');
            } else {
                setAuthView('login');
                console.log('DEBUG: Users exist, showing Login');
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

    const path = window.location.pathname;
    if (path.startsWith('/captive')) {
        return (
            <ThemeProvider>
                <LocalizationProvider>
                    <Suspense fallback={<div className="flex h-screen w-screen items-center justify-center"><Loader /></div>}>
                        <CaptivePortalPage />
                    </Suspense>
                </LocalizationProvider>
            </ThemeProvider>
        );
    }

    if (path.startsWith('/client_portal')) {
        return (
            <ThemeProvider>
                <LocalizationProvider>
                    <Suspense fallback={<div className="flex h-screen w-screen items-center justify-center"><Loader /></div>}>
                        <ClientPortal selectedRouter={null} />
                    </Suspense>
                </LocalizationProvider>
            </ThemeProvider>
        );
    }

    if (!user) {
        if (path === '/' || path === '/home') {
            return (
                <ThemeProvider>
                    <LocalizationProvider>
                        <Suspense fallback={<div className="flex h-screen w-screen items-center justify-center"><Loader /></div>}>
                            <LandingPage />
                        </Suspense>
                    </LocalizationProvider>
                </ThemeProvider>
            );
        }
        return (
            <ThemeProvider>
                 <LocalizationProvider>
                    <Suspense fallback={<div className="flex h-screen w-screen items-center justify-center"><Loader /></div>}>
                        <AuthLayout>
                            {path === '/register' ? (
                                <Register />
                            ) : !hasUsers ? (
                                <Register />
                            ) : authView === 'login' ? (
                                <Login onSwitchToForgotPassword={() => setAuthView('forgot')} />
                            ) : (
                                <ForgotPassword onSwitchToLogin={() => setAuthView('login')} />
                            )}
                        </AuthLayout>
                    </Suspense>
                 </LocalizationProvider>
            </ThemeProvider>
        );
    }
    
    if (isLicenseLoading) {
        return <div className="flex h-screen w-screen items-center justify-center"><Loader /></div>;
    }

    console.log('DEBUG: Authenticated user. License status:', licenseStatus);
    
    console.log('DEBUG: Rendering AppContent (dashboard should be default)');
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
