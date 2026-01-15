
import type { BillingPlanWithId, PppSecret, PanelSettings } from '../types';
import { getAuthHeader } from './databaseService.ts';

// Xendit Invoice API Response Type
export interface XenditInvoiceResponse {
  id: string;
  external_id: string;
  user_id: string;
  status: 'PENDING' | 'PAID' | 'SETTLED' | 'EXPIRED';
  merchant_name: string;
  merchant_profile_picture_url: string;
  amount: number;
  payer_email: string;
  description: string;
  expiry_date: string;
  invoice_url: string;
  created: string;
  updated: string;
  currency: string;
}

// Xendit Payment Method Types
export type PaymentMethod = 'BANK_TRANSFER' | 'EWALLET' | 'RETAIL_OUTLET' | 'QR_CODE' | 'VIRTUAL_ACCOUNT';

export interface CreateInvoiceParams {
  externalId: string;
  amount: number;
  description: string;
  customerEmail: string;
  customerName: string;
  paymentMethods?: PaymentMethod[];
  successRedirectUrl?: string;
  failureRedirectUrl?: string;
  currency?: string;
}

export interface XenditServiceConfig {
  secretKey: string;
  publicKey?: string;
  webhookToken?: string;
}

export class XenditService {
  
  constructor() {
      // No config needed in frontend anymore
  }

  /**
   * Create a Xendit invoice via backend proxy
   */
  async createInvoice(params: CreateInvoiceParams): Promise<XenditInvoiceResponse> {
    try {
      const invoiceData = {
        externalID: params.externalId,
        amount: params.amount,
        description: params.description,
        customer: {
          email: params.customerEmail,
          given_names: params.customerName,
        },
        customer_email: params.customerEmail,
        invoice_duration: 86400, // 24 hours in seconds
        success_redirect_url: params.successRedirectUrl || `${window.location.origin}/payment/success`,
        failure_redirect_url: params.failureRedirectUrl || `${window.location.origin}/payment/failed`,
        currency: params.currency || 'PHP',
        payment_methods: params.paymentMethods || ['BANK_TRANSFER', 'EWALLET', 'RETAIL_OUTLET'],
      };

      const response = await fetch('/api/xendit/invoice', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              ...getAuthHeader()
          },
          body: JSON.stringify(invoiceData)
      });

      if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Backend failed to create invoice');
      }

      return await response.json();
    } catch (error) {
      console.error('Xendit create invoice error:', error);
      throw error;
    }
  }

  /**
   * Get invoice details by ID via backend proxy
   */
  async getInvoice(invoiceId: string): Promise<XenditInvoiceResponse> {
    try {
      const response = await fetch(`/api/xendit/invoice/${invoiceId}`, {
          headers: getAuthHeader()
      });

      if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Backend failed to fetch invoice');
      }

      return await response.json();
    } catch (error) {
      console.error('Xendit get invoice error:', error);
      throw error;
    }
  }

  /**
   * Create billing invoice for PPPoE client
   */
  async createBillingInvoice(
    client: PppSecret,
    plan: BillingPlanWithId,
    settings: PanelSettings
  ): Promise<XenditInvoiceResponse> {
    const externalId = `billing-${client.name}-${Date.now()}`;
    const description = `${plan.name} - ${plan.description || 'Internet Service'}`;
    // Use client comment if email-like, else fallback settings or dummy
    const customerEmail = (client.comment && client.comment.includes('@')) ? client.comment : (settings.telegramSettings?.chatId ? `user_${settings.telegramSettings.chatId}@example.com` : 'customer@example.com');
    const customerName = client.name;

    return this.createInvoice({
      externalId,
      amount: plan.price,
      description,
      customerEmail,
      customerName,
      currency: plan.currency,
      paymentMethods: ['BANK_TRANSFER', 'EWALLET', 'RETAIL_OUTLET', 'QR_CODE'],
    });
  }
}

// Singleton instance
let xenditService: XenditService | null = null;

// Config is now optional/unused but kept for signature compatibility if needed by other calls, 
// but logically we just init the service class.
export const initializeXenditService = (config?: XenditServiceConfig): void => {
  xenditService = new XenditService();
};

export const getXenditService = (): XenditService => {
  if (!xenditService) {
    xenditService = new XenditService();
  }
  return xenditService;
};

export const isXenditConfigured = (settings: PanelSettings): boolean => {
  // We still check if the user *thinks* it's configured via settings object passed from UI
  return !!(settings.xenditSettings?.enabled && settings.xenditSettings.secretKey);
};
