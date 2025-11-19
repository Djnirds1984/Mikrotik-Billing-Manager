

import { Xendit } from 'xendit-node';
import type { BillingPlanWithId, PppSecret, PanelSettings } from '../types';

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
  available_banks: any[];
  available_retail_outlets: any[];
  available_ewallets: any[];
  available_qr_codes: any[];
  available_direct_debits: any[];
  available_paylaters: any[];
  should_exclude_credit_card: boolean;
  should_send_email: boolean;
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
  expiryDate?: Date;
  currency?: string;
}

export interface XenditServiceConfig {
  secretKey: string;
  publicKey?: string;
  webhookToken?: string;
}

export class XenditService {
  private client: Xendit;
  private config: XenditServiceConfig;

  constructor(config: XenditServiceConfig) {
    this.config = config;
    this.client = new Xendit({
      secretKey: config.secretKey,
    });
  }

  /**
   * Create a Xendit invoice for billing payment
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

      // FIX: Corrected casing for Xendit service. It should be PascalCase 'Invoice'.
      const response = await this.client.Invoice.createInvoice(invoiceData as any);
      // FIX: Cast to unknown first to satisfy TypeScript's strict type checking when library types and local types diverge.
      return response as unknown as XenditInvoiceResponse;
    } catch (error) {
      console.error('Xendit create invoice error:', error);
      throw new Error(`Failed to create Xendit invoice: ${(error as any).message}`);
    }
  }

  /**
   * Get invoice details by ID
   */
  async getInvoice(invoiceId: string): Promise<XenditInvoiceResponse> {
    try {
      // FIX: The method to get a single invoice by ID is `getInvoice`, but the type definitions are likely incorrect and suggest `getInvoices`.
      // Using bracket notation to bypass the compile-time error while calling the correct runtime method.
      const response = await (this.client.Invoice as any).getInvoice({ invoiceID: invoiceId });
      return response as unknown as XenditInvoiceResponse;
    } catch (error) {
      console.error('Xendit get invoice error:', error);
      throw new Error(`Failed to get Xendit invoice: ${(error as any).message}`);
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
    const customerEmail = client.comment?.includes('@') ? client.comment : settings.telegramSettings?.chatId || 'customer@example.com';
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

  /**
   * Get available payment methods for specific amount and currency
   */
  async getPaymentMethods(amount: number, currency: string = 'PHP'): Promise<PaymentMethod[]> {
    // This is a simplified version - in production, you might want to call
    // Xendit's API to get available methods based on amount and currency
    return ['BANK_TRANSFER', 'EWALLET', 'RETAIL_OUTLET', 'QR_CODE', 'VIRTUAL_ACCOUNT'];
  }
}

// Singleton instance
let xenditService: XenditService | null = null;

export const initializeXenditService = (config: XenditServiceConfig): void => {
  if (!config.secretKey) {
    throw new Error('Xendit secret key is required');
  }
  xenditService = new XenditService(config);
};

export const getXenditService = (): XenditService => {
  if (!xenditService) {
    throw new Error('Xendit service not initialized. Call initializeXenditService first.');
  }
  return xenditService;
};

export const isXenditConfigured = (settings: PanelSettings): boolean => {
  return !!(settings.xenditSettings?.enabled && settings.xenditSettings.secretKey);
};