import type { PanelSettings } from '../types';

export interface XenditCheckoutResponse {
    checkout_url: string;
    invoice_no: string;
    invoice_id: string;
}

export interface XenditServiceConfig {
    baseUrl: string;
}

class XenditService {
    private config: XenditServiceConfig;

    constructor(config: XenditServiceConfig) {
        this.config = config;
    }

    private getBaseUrl(): string {
        return this.config.baseUrl || '';
    }

    async createCheckoutSession(params: {
        pppoe_username: string;
        plan_name: string;
        amount: number;
        duration_days: number;
        router_id: string;
        planType?: string;
        planId?: string;
    }): Promise<XenditCheckoutResponse> {
        const response = await fetch(`${this.getBaseUrl()}/api/payments/create-xendit-checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(error.error || error.message || 'Failed to create Xendit checkout');
        }

        return response.json();
    }

    async getWebhookStatus(): Promise<any> {
        const response = await fetch(`${this.getBaseUrl()}/api/xendit-webhook-status`);
        if (!response.ok) throw new Error('Failed to get webhook status');
        return response.json();
    }

    async testWebhook(): Promise<any> {
        const response = await fetch(`${this.getBaseUrl()}/api/xendit-webhook-test`, { method: 'POST' });
        if (!response.ok) throw new Error('Failed to test webhook');
        return response.json();
    }

    async verifyConfig(): Promise<any> {
        const response = await fetch(`${this.getBaseUrl()}/api/xendit-verify-config`, { method: 'POST' });
        if (!response.ok) throw new Error('Failed to verify config');
        return response.json();
    }
}

let xenditServiceInstance: XenditService | null = null;

export const initializeXenditService = (config?: XenditServiceConfig): XenditService => {
    xenditServiceInstance = new XenditService(config || { baseUrl: '' });
    console.log('[Xendit] Service initialized');
    return xenditServiceInstance;
};

export const getXenditService = (): XenditService => {
    if (!xenditServiceInstance) {
        xenditServiceInstance = new XenditService({ baseUrl: '' });
    }
    return xenditServiceInstance;
};

export const isXenditConfigured = (settings: PanelSettings): boolean => {
    return !!(settings.xenditSettings?.enabled && settings.xenditSettings.secretKey);
};

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
