import React, { useState, useEffect } from 'react';
import type { PppSecret, BillingPlanWithId, CompanySettings } from '../types';
import { initializeXenditService, getXenditService, isXenditConfigured } from '../services/xenditService';
import { Loader } from './Loader';

interface XenditPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  client: PppSecret;
  plan: BillingPlanWithId;
  companySettings: CompanySettings;
  onPaymentSuccess: (invoiceId: string) => void;
}

export const XenditPaymentModal: React.FC<XenditPaymentModalProps> = ({
  isOpen,
  onClose,
  client,
  plan,
  companySettings,
  onPaymentSuccess,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoiceUrl, setInvoiceUrl] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      createXenditInvoice();
    } else {
      // Reset state when modal closes
      setInvoiceUrl(null);
      setInvoiceId(null);
      setError(null);
    }
  }, [isOpen]);

  const createXenditInvoice = async () => {
    if (!isXenditConfigured(companySettings)) {
      setError('Xendit payment gateway is not configured. Please contact support.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Initialize Xendit service
      initializeXenditService({
        secretKey: companySettings.xenditSecretKey!,
        publicKey: companySettings.xenditPublicKey,
        webhookToken: companySettings.xenditWebhookToken,
      });

      const xenditService = getXenditService();
      
      // Create invoice
      const invoice = await xenditService.createBillingInvoice(
        client,
        plan,
        companySettings
      );

      setInvoiceUrl(invoice.invoice_url);
      setInvoiceId(invoice.id);

      // Start polling for payment status
      startPaymentPolling(invoice.id);
    } catch (err) {
      console.error('Failed to create Xendit invoice:', err);
      setError(err instanceof Error ? err.message : 'Failed to create payment invoice');
    } finally {
      setIsLoading(false);
    }
  };

  const startPaymentPolling = (invoiceId: string) => {
    // Poll every 5 seconds for payment status
    const interval = setInterval(async () => {
      try {
        const xenditService = getXenditService();
        const invoice = await xenditService.getInvoice(invoiceId);
        
        if (invoice.status === 'PAID' || invoice.status === 'SETTLED') {
          clearInterval(interval);
          onPaymentSuccess(invoiceId);
          onClose();
        } else if (invoice.status === 'EXPIRED') {
          clearInterval(interval);
          setError('Payment has expired. Please try again.');
        }
      } catch (err) {
        console.error('Error polling payment status:', err);
      }
    }, 5000);

    // Stop polling when modal closes
    return () => clearInterval(interval);
  };

  const handleOpenPaymentPage = () => {
    if (invoiceUrl) {
      // Open Xendit payment page in new tab
      window.open(invoiceUrl, '_blank', 'width=800,height=600');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Online Payment
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:text-gray-300 dark:hover:text-gray-100"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {isLoading && (
            <div className="text-center py-8">
              <Loader />
              <p className="mt-4 text-gray-600 dark:text-gray-300">
                Creating payment invoice...
              </p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                </div>
              </div>
            </div>
          )}

          {!isLoading && !error && invoiceUrl && (
            <div className="text-center">
              <div className="mb-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  Payment Details
                </h3>
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-gray-600 dark:text-gray-300">Client:</span>
                    <span className="font-medium">{client.name}</span>
                  </div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-gray-600 dark:text-gray-300">Plan:</span>
                    <span className="font-medium">{plan.name}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600 dark:text-gray-300">Amount:</span>
                    <span className="font-bold text-lg">
                      {plan.currency} {plan.price.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-gray-600 dark:text-gray-300 mb-4">
                Click the button below to proceed with payment. You will be redirected to our secure payment partner.
              </p>

              <button
                onClick={handleOpenPaymentPage}
                className="w-full bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-medium py-3 px-4 rounded-lg transition-colors"
              >
                Proceed to Payment
              </button>

              <p className="text-xs text-gray-500 dark:text-gray-400 mt-4">
                Powered by Xendit - Secure Payment Processing
              </p>
            </div>
          )}

          {!isLoading && !error && !invoiceUrl && (
            <div className="text-center py-8">
              <p className="text-gray-600 dark:text-gray-300">
                Preparing payment gateway...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};