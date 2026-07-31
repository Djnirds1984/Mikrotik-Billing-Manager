import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Admin APK configuration.
 *
 * NOTE: Capacitor CLI 7.x has no --config flag and only loads
 * `capacitor.config.ts` from the project root, so this file is NOT read by
 * `npx cap ...` commands. It is the source of truth for the values manually
 * mirrored into android-admin/app/src/main/assets/capacitor.config.json
 * (the file the native runtime actually reads). Keep both in sync — see the
 * sync steps documented in android-admin/ADMIN_SYNC_STEPS.md.
 */
const config: CapacitorConfig = {
  appId: 'com.mikrotikbilling.admin',
  appName: 'ISP Billing Admin',
  webDir: 'mobile-app-admin',
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
    // Only honored if this file were the active capacitor.config.ts;
    // documents where the admin native project lives.
    path: 'android-admin',
    allowMixedContent: true
  },
  server: {
    // Keep all navigation (including the remote tunnel domain redirect)
    // inside the WebView instead of opening the system browser
    allowNavigation: ['*']
  }
};

export default config;
