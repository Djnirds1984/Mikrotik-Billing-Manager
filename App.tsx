import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar.tsx';
import { TopBar } from './components/TopBar.tsx';
import { Dashboard } from './components/Dashboard.tsx';
import { Scripting } from './components/Scripting.tsx';
import { Routers } from './components/Routers.tsx';
import { Updater } from './components/Updater.tsx';
import { Pppoe } from './components/Pppoe.tsx';
import { Billing } from './components/Billing.tsx';
import { Remote } from './components/Remote.tsx';
import { Hotspot } from './components/Hotspot.tsx';
import { Help } from './components/Help.tsx';
import { SystemSettings } from './components/SystemSettings.tsx';
import { DatabaseSettings } from './components/DatabaseSettings.tsx';
import { SalesReport } from './components/SalesReport.tsx';
import { Network } from './components/Network.tsx';
import { Inventory } from './components/Inventory.tsx';
import { Company } from './components/Company.tsx';
import { Terminal } from './components/Terminal.tsx';
import { Loader } from './components/Loader.tsx';
import { Login } from './components/Login.tsx';
import { Register } from './components/Register.tsx';
import { ForgotPassword } from './components/ForgotPassword.tsx';
import { AuthLayout } from './components/AuthLayout.tsx';
import { Logs } from './components/Logs.tsx';
import { PanelRoles } from './components/PanelRoles.tsx';
import { MikrotikFiles } from './components/MikrotikFiles.tsx';
import { License } from './components/License.tsx';
import { SuperAdmin } from './components/SuperAdmin.tsx';
import { UnlicensedComponent } from './components/UnlicensedComponent.tsx';
import { DhcpPortal } from './components/DhcpPortal.tsx';
import { CaptivePortalPage } from './components/CaptivePortalPage.tsx';
import { NotificationsPage } from './components/NotificationsPage.tsx';
import { ClientPortal } from './components/ClientPortal.tsx';
import { Payroll } from './components/Payroll.tsx';
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
import type { View, LicenseStatus } from './types.ts';
import { getAuthHeader } from './services/databaseService.ts';


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
  const { sales, addSale, deleteSale, clearSales, isLoading: isLoadingSales } = useSalesData(selectedRouterId);
  const { items, addItem, updateItem, deleteItem, isLoading: isLoadingInventory } = useInventoryData();
  const { expenses, addExpense, updateExpense, deleteExpense, isLoading: isLoadingExpenses } = useExpensesData();
  const payrollData = usePayrollData();
  const { settings: companySettings, updateSettings: updateCompanySettings, isLoading: isLoadingCompany } = useCompanySettings();
  const { t, isLoading: isLoadingLocalization } = useLocalization();


  const appIsLoading = isLoadingRouters || isLoadingSales || isLoadingInventory || isLoadingCompany || isLoadingLocalization || isLoadingExpenses || payrollData.isLoading;

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
          return <SystemSettings licenseStatus={licenseStatus} />;
      case 'database':
          return <DatabaseSettings />;
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
      case 'client_portal':
          return <ClientPortal selectedRouter={selectedRouter} />;
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
             {renderView()}
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

    // This renders a dedicated, unauthenticated page for captive portal clients
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
    
    // Initial license check and polling
    useEffect(() => {
        if (user) {
            setIsLicenseLoading(true);
            checkLicense();
            
            if (licenseCheckInterval.current) {
                clearInterval(licenseCheckInterval.current);
            }
            licenseCheckInterval.current = window.setInterval(checkLicense, 5000); // Poll every 5 seconds
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
        if (isLoading) {
             return <div className="flex h-screen w-screen items-center justify-center"><Loader /></div>;
        }
        if (!hasUsers) {
             return <AuthLayout><Register /></AuthLayout>;
        }
        if (authView === 'login') {
            return <AuthLayout><Login onSwitchToForgotPassword={() => setAuthView('forgot')} /></AuthLayout>;
        }
        if (authView === 'forgot') {
            return <AuthLayout><ForgotPassword onSwitchToLogin={() => setAuthView('login')} /></AuthLayout>;
        }
    }

    if (user) {
        if (isLicenseLoading) {
            return <div className="flex h-screen w-screen items-center justify-center"><Loader /></div>;
        }
        return <AppContent licenseStatus={licenseStatus} onLicenseChange={handleLicenseChange} />;
    }

    return <AuthLayout><Login onSwitchToForgotPassword={() => setAuthView('forgot')} /></AuthLayout>;
};

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <LocalizationProvider>
          <NotificationProvider>
            <AppRouter />
          </NotificationProvider>
      </LocalizationProvider>
    </ThemeProvider>
  );
};

export default App;
