import React, { useState, useEffect } from 'react';
import type { PppSecret, BillingPlanWithId, SaleRecord, CompanySettings, PppProfile } from '../types.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { PrintableReceipt } from './PrintableReceipt.tsx';

interface PaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    secret: PppSecret | null;
    plans: BillingPlanWithId[];
    profiles: PppProfile[];
    onSave: (data: {
        sale: Omit<SaleRecord, 'id' | 'date' | 'routerName'>;
        payment: { plan: BillingPlanWithId, nonPaymentProfile: string, discountDays: number, paymentDate: string };
    }) => Promise<boolean>; // Return true on success, false on failure
    companySettings: CompanySettings;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({ isOpen, onClose, secret, plans, profiles, onSave, companySettings }) => {
    const { t, formatCurrency } = useLocalization();
    const [selectedPlanId, setSelectedPlanId] = useState('');
    const [nonPaymentProfile, setNonPaymentProfile] = useState('');
    const [discountDays, setDiscountDays] = useState('0');
    const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
    const [receiptData, setReceiptData] = useState<SaleRecord | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (isOpen) {
            // Reset state when modal opens
            setReceiptData(null);
            setDiscountDays('0');
            setPaymentDate(new Date().toISOString().split('T')[0]);
            setIsSubmitting(false);

            if (plans.length > 0) {
                setSelectedPlanId(plans[0].id);
            }
            if (profiles.length > 0) {
                // Try to find a sensible default 'non-payment' profile
                const defaultNonPayment = profiles.find(p => p.name.toLowerCase().includes('cut') || p.name.toLowerCase().includes('disable'))?.name || profiles[0].name;
                setNonPaymentProfile(defaultNonPayment);
            }
        }
    }, [isOpen, plans, profiles]);

    useEffect(() => {
        if (receiptData) {
            const timer = setTimeout(() => window.print(), 100);
            return () => clearTimeout(timer);
        }
    }, [receiptData]);

    useEffect(() => {
        const handleAfterPrint = () => {
            if (receiptData) {
                setReceiptData(null);
                onClose();
            }
        };
        window.addEventListener('afterprint', handleAfterPrint);
        return () => window.removeEventListener('afterprint', handleAfterPrint);
    }, [receiptData, onClose]);

    if (!isOpen || !secret) return null;

    const selectedPlan = plans.find(p => p.id === selectedPlanId);
    const planPrice = selectedPlan?.price || 0;
    
    let daysInCycle = 30; // Default to Monthly
    if (selectedPlan?.cycle === 'Yearly') daysInCycle = 365;
    else if (selectedPlan?.cycle === 'Quarterly') daysInCycle = 90;
    
    const pricePerDay = daysInCycle > 0 ? planPrice / daysInCycle : 0;
    const discountDaysValue = parseInt(discountDays, 10) || 0;
    const discountAmount = pricePerDay * discountDaysValue;
    const finalAmount = Math.max(0, planPrice - discountAmount);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedPlan) {
            alert('Please select a billing plan.');
            return;
        }
        
        setIsSubmitting(true);
        
        const saleData = {
            clientName: secret.customer?.fullName || secret.name,
            planName: selectedPlan.name,
            planPrice: selectedPlan.price,
            discountAmount: discountAmount,
            finalAmount: finalAmount,
            currency: selectedPlan.currency,
            clientAddress: secret.customer?.address,
            clientContact: secret.customer?.contactNumber,
            clientEmail: secret.customer?.email,
        };
        
        const paymentData = {
            plan: selectedPlan,
            nonPaymentProfile,
            discountDays: discountDaysValue,
            paymentDate,
        };

        const success = await onSave({ sale: saleData, payment: paymentData });
        
        if (success) {
            const fullSaleRecord: SaleRecord = {
                ...saleData,
                id: `temp_${Date.now()}`,
                date: new Date().toISOString(),
                routerName: '',
            };
            setReceiptData(fullSaleRecord);
        } else {
            setIsSubmitting(false); // Only stop loading if it failed, otherwise printing handles it
        }
    };

    return (
        <>
            <div className={receiptData ? 'printable-area' : 'hidden'}>
                <PrintableReceipt sale={receiptData} companySettings={companySettings} />
            </div>
            <div className={`fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 ${receiptData ? 'hidden' : ''}`}>
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg border border-slate-200 dark:border-slate-700">
                    <form onSubmit={handleSubmit}>
                        <div className="p-6">
                            <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400] mb-1">Process Payment</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">For user: {secret.customer?.fullName || secret.name}</p>

                            <div className="space-y-4">
                                <div>
                                    <label htmlFor="plan" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Billing Plan</label>
                                    <select id="plan" value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white">
                                        {plans.map(plan => (
                                            <option key={plan.id} value={plan.id}>
                                                {plan.name} ({formatCurrency(plan.price)})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label htmlFor="nonPaymentProfile" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Non-Payment Profile</label>
                                     <select id="nonPaymentProfile" value={nonPaymentProfile} onChange={(e) => setNonPaymentProfile(e.target.value)} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white">
                                        {profiles.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                                    </select>
                                    <p className="text-xs text-slate-500 mt-1">Profile to apply on due date.</p>
                                </div>
                                <div>
                                    <label htmlFor="paymentDate" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Payment Date</label>
                                    <input type="date" id="paymentDate" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                                </div>
                                <div>
                                    <label htmlFor="discountDays" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Discount for Downtime (Days)</label>
                                    <input type="number" id="discountDays" value={discountDays} onChange={(e) => setDiscountDays(e.target.value)} min="0" step="1" className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                                </div>
                                <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                                    <div className="flex justify-between text-sm text-slate-500 dark:text-slate-400">
                                        <span>Subtotal</span>
                                        <span>{formatCurrency(planPrice)}</span>
                                    </div>
                                    <div className="flex justify-between text-sm text-slate-500 dark:text-slate-400">
                                        <span>Discount</span>
                                        <span>- {formatCurrency(discountAmount)}</span>
                                    </div>
                                    <div className="flex justify-between text-lg font-bold text-slate-900 dark:text-white mt-2">
                                        <span>TOTAL</span>
                                        <span>{formatCurrency(finalAmount)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                            <button type="button" onClick={onClose} disabled={isSubmitting} className="px-4 py-2 text-sm font-medium rounded-md text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600">Cancel</button>
                            <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-[--color-primary-600] hover:bg-[--color-primary-500] disabled:opacity-50">
                                {isSubmitting ? 'Processing...' : 'Process Payment & Print'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </>
    );
};