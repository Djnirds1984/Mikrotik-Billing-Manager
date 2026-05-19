
import type { PppSecret, BillingPlanWithId, PanelSettings } from '../types';
import { getAuthHeader } from './databaseService.ts';

export interface PayMongoCheckoutResponse {
  checkout_url: string;
  session_id: string;
  amount: number;
  description: string;
}

export interface PayMongoServiceConfig {
  publicKey: string;
  secretKey: string;
  webhookSecret: string;
}

export class PayMongoService {
  constructor() {
    // Service is stateless; keys are handled by the backend
  }

  /**
   * Create a PayMongo checkout session via backend proxy
   */
  async createCheckoutSession(
    client: PppSecret,
    plan: BillingPlanWithId,
    companySettings: PanelSettings
  ): Promise<PayMongoCheckoutResponse> {
    try {
      const description = `${plan.name} - ${plan.description || 'Internet Service'}`;

      const response = await fetch('/api/payments/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader()
        },
        body: JSON.stringify({
          amount: plan.price,
          description: description,
          pppoeUsername: client.name,
          planName: plan.name,
          successUrl: `${window.location.origin}/payment/success`,
          cancelUrl: `${window.location.origin}/payment/failed`
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Backend failed to create checkout session');
      }

      return await response.json();
    } catch (error) {
      console.error('PayMongo create checkout error:', error);
      throw error;
    }
  }
}

// Singleton instance
let paymongoService: PayMongoService | null = null;

export const initializePayMongoService = (config?: PayMongoServiceConfig): void => {
  paymongoService = new PayMongoService();
};

export const getPayMongoService = (): PayMongoService => {
  if (!paymongoService) {
    paymongoService = new PayMongoService();
  }
  return paymongoService;
};

export const isPayMongoConfigured = (settings: PanelSettings): boolean => {
  return !!(settings.paymongoSettings?.enabled && settings.paymongoSettings.secretKey);
};
