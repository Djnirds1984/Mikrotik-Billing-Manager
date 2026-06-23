/**
 * Xendit Payment Gateway Service
 * Handles Xendit payment integration for the billing system
 */

import type { PanelSettings } from '../types';

let xenditServiceInstance: any = null;

/**
 * Initialize the Xendit service
 */
export const initializeXenditService = () => {
    xenditServiceInstance = {
        initialized: true,
        timestamp: new Date().toISOString()
    };
    console.log('[Xendit] Service initialized');
    return xenditServiceInstance;
};

/**
 * Get the Xendit service instance
 */
export const getXenditService = () => {
    if (!xenditServiceInstance) {
        initializeXenditService();
    }
    return xenditServiceInstance;
};

/**
 * Check if Xendit is properly configured and enabled
 */
export const isXenditConfigured = (settings: PanelSettings): boolean => {
    return !!(settings.xenditSettings?.enabled && settings.xenditSettings.secretKey);
};

/**
 * Get Xendit public configuration (safe for client-side)
 */
export const getXenditPublicConfig = (settings: PanelSettings) => {
    if (!isXenditConfigured(settings)) {
        return { enabled: false, passFeesToCustomer: false, paymentMethods: [] };
    }
    return {
        enabled: true,
        passFeesToCustomer: settings.xenditSettings?.passFeesToCustomer || false,
        paymentMethods: settings.xenditSettings?.paymentMethods || []
    };
};
