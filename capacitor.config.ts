import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mikrotikbilling.customer',
  appName: 'ISP Billing',
  webDir: 'mobile-app',
  plugins: {
    CapacitorHttp: {
      // Native HTTP so the setup page can validate domains without CORS
      enabled: true
    },
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#1e293b',
      showSpinner: true,
      spinnerColor: '#3b82f6'
    },
    StatusBar: {
      style: 'dark'
    }
  },
  android: {
    allowMixedContent: true
  },
  server: {
    // Keep all navigation (including the remote tunnel domain redirect)
    // inside the WebView instead of opening the system browser
    allowNavigation: ['*']
  }
};

export default config;
