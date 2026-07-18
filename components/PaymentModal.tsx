import React, { useState, useEffect } from 'react';
import type { PppSecret, BillingPlanWithId, SaleRecord, CompanySettings } from '../types.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { PrintableReceipt } from './PrintableReceipt.tsx';

interface UnpaidMonthEntry {
    month: string; // YYYY-MM
    planName?: string;
    planPrice?: number;
}

interface PaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    secret: PppSecret | null;
    plans: BillingPlanWithId[];
    nonPaymentProfile: string;
    onSave: (data: {
        sale: Omit<SaleRecord, 'id' | 'date' | 'routerName'>;
        payment: { plan: BillingPlanWithId, nonPaymentProfile: string, discountDays: number, paymentDate: string, coveredMonth?: string, creditApplied?: number, overpaymentCredit?: number };
    }) => Promise<boolean>;
    companySettings: CompanySettings;
    preselectedMonth?: string; // YYYY-MM pre-filled from ledger
    routerId?: string;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({ isOpen, onClose, secret, plans, nonPaymentProfile, onSave, companySettings, preselectedMonth, routerId }) => {
    const { t, formatCurrency } = useLocalization();
    const [selectedPlanId, setSelectedPlanId] = useState('');
    const [discountDays, setDiscountDays] = useState('0');
    const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
    const [receiptData, setReceiptData] = useState<SaleRecord | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedMonth, setSelectedMonth] = useState<string>(''); // YYYY-MM for postpaid
    const [unpaidMonths, setUnpaidMonths] = useState<UnpaidMonthEntry[]>([]);
    const [isPostpaid, setIsPostpaid] = useState(false);
    const [clientBalance, setClientBalance] = useState<number>(0); // negative = credit available
    const [customAmount, setCustomAmount] = useState<string>('');

    useEffect(() => {
        if (isOpen) {
            setReceiptData(null);
            setDiscountDays('0');
            setPaymentDate(new Date().toISOString().split('T')[0]);
            setIsSubmitting(false);
            setSelectedMonth('');
            setUnpaidMonths([]);
            setClientBalance(0);
            setCustomAmount('');

            if (plans.length > 0) {
                setSelectedPlanId(plans[0].id);
            }

            // Detect plan type
            let planType: 'prepaid' | 'postpaid' = 'prepaid';
            try {
                const c = JSON.parse(String(secret?.comment || '{}'));
                const pt = String(c.planType || '').toLowerCase();
                if (pt === 'postpaid') planType = 'postpaid';
            } catch {}
            setIsPostpaid(planType === 'postpaid');

            // Fetch unpaid months for postpaid
            if (planType === 'postpaid' && routerId && secret?.name) {
                fetch(`/api/billing-ledger/unpaid/${encodeURIComponent(routerId)}/${encodeURIComponent(secret.name)}`, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
                })
                    .then(res => res.ok ? res.json() : [])
                    .then((data: UnpaidMonthEntry[]) => {
                        setUnpaidMonths(data);
                        // Pre-select month: from prop, or first unpaid, or current month
                        if (preselectedMonth) {
                            setSelectedMonth(preselectedMonth);
                        } else if (data.length > 0) {
                            setSelectedMonth(data[0].month);
                        } else {
                            const now = new Date();
                            setSelectedMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
                        }
                    })
                    .catch(() => {
                        const now = new Date();
                        setSelectedMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
                    });
            } else {
                // Prepaid: default to current month
                const now = new Date();
                setSelectedMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
            }

            // Fetch client balance (credit from installation fee deduction, etc.)
            if (routerId && secret?.name) {
                fetch(`/api/client-balance/${encodeURIComponent(routerId)}/${encodeURIComponent(secret.name)}`, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
                })
                    .then(res => res.ok ? res.json() : { balance: 0 })
                    .then((data: any) => {
                        setClientBalance(data.balance || 0);
                    })
                    .catch(() => setClientBalance(0));
            }
        }
    }, [isOpen, plans, secret, preselectedMonth, routerId]);

    useEffect(() => {
        if (receiptData) {
            const timer = setTimeout(() => window.print(), 300);
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
    
    const daysInCycle = selectedPlan?.cycle_days || 30;
    
    const pricePerDay = daysInCycle > 0 ? planPrice / daysInCycle : 0;
    const discountDaysValue = parseInt(discountDays, 10) || 0;
    const discountAmount = pricePerDay * discountDaysValue;
    // Apply client credit (negative balance = credit available)
    const creditAvailable = clientBalance < 0 ? Math.abs(clientBalance) : 0;
    const creditApplied = Math.min(creditAvailable, Math.max(0, planPrice - discountAmount));
    // Custom amount (overpayment) logic
    const customAmountValue = parseFloat(customAmount) || 0;
    const hasCustomAmount = customAmountValue > 0;
    const amountDue = Math.max(0, planPrice - discountAmount - creditApplied);
    const overpaymentCredit = hasCustomAmount ? Math.max(0, customAmountValue - amountDue) : 0;
    const finalAmount = hasCustomAmount ? customAmountValue : amountDue;

    // Format month for display
    const formatMonthDisplay = (monthStr: string): string => {
        const [year, month] = monthStr.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1, 1);
        return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    };

    const isMonthOverdue = (monthStr: string): boolean => {
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        return monthStr < currentMonth;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedPlan) {
            alert('Please select a billing plan.');
            return;
        }
        if (isPostpaid && !selectedMonth) {
            alert('Please select a billing month.');
            return;
        }
        
        setIsSubmitting(true);
        
        // For postpaid, use selectedMonth as coveredMonth
        const coveredMonth = isPostpaid && selectedMonth
            ? formatMonthDisplay(selectedMonth)
            : (() => {
                // Prepaid: auto-calculate from payment date
                const paymentDT = new Date(paymentDate);
                return paymentDT.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
            })();

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
            planType: isPostpaid ? 'postpaid' as const : 'prepaid' as const,
            coveredMonth,
        };
        
        const paymentData = {
            plan: selectedPlan,
            nonPaymentProfile,
            discountDays: discountDaysValue,
            paymentDate,
            coveredMonth: selectedMonth, // YYYY-MM for backend ledger update
            creditApplied, // amount of credit deducted from this payment
            overpaymentCredit, // extra amount to add as client credit
        };

        const success = await onSave({ sale: saleData, payment: paymentData });
        if (success) {
            setIsSubmitting(false);
            // Ask user if they want to print acknowledgement receipt
            const wantPrint = window.confirm('Payment successful! Do you want to print the acknowledgement receipt?');
            if (wantPrint) {
                // Use setTimeout to ensure state updates properly after blocking confirm
                setTimeout(() => {
                    setReceiptData({
                        ...saleData,
                        id: `sale_${Date.now()}`,
                        date: new Date().toISOString(),
                        routerName: '',
                    } as SaleRecord);
                }, 50);
            } else {
                onClose();
            }
            return;
        }
        setIsSubmitting(false);
    };

    return (
        <>
            <div className={receiptData ? 'printable-area' : 'hidden'}>
                <PrintableReceipt sale={receiptData} companySettings={companySettings} />
            </div>
            <div className={`fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 ${receiptData ? 'hidden' : ''}`}>
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg border border-slate-200 dark:border-slate-700 max-h-[90vh] flex flex-col">
                    <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
                        <div className="p-6 overflow-y-auto flex-1">
                            <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400] mb-1">Process Payment</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">For user: {secret.customer?.fullName || secret.name}</p>

                            {/* Billing Status Info for Postpaid */}
                            {isPostpaid && (
                                <div className="mb-4 bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-600 rounded-lg p-3">
                                    <div className="flex items-center gap-2 mb-2">
                                        <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Billing Status</span>
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                                        {unpaidMonths.length > 0 && (
                                            <div className="text-red-600 dark:text-red-400 font-medium">
                                                {unpaidMonths.length} unpaid month{unpaidMonths.length > 1 ? 's' : ''}: {unpaidMonths.map(m => formatMonthDisplay(m.month)).join(', ')}
                                            </div>
                                        )}
                                        {unpaidMonths.length === 0 && (
                                            <div className="text-green-600 dark:text-green-400 font-medium">All months are paid or up to date.</div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Client Credit Balance */}
                            {creditAvailable > 0 && (
                                <div className="mb-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                                    <div className="flex items-center gap-2 mb-1">
                                        <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <span className="text-sm font-semibold text-green-800 dark:text-green-300">Client Credit Available</span>
                                    </div>
                                    <p className="text-xs text-green-700 dark:text-green-400">
                                        Current credit: <span className="font-bold">{formatCurrency(creditAvailable)}</span> — will be automatically applied to this payment.
                                    </p>
                                </div>
                            )}

                            <div className="space-y-4">
                                {/* Month Selector for Postpaid */}
                                {isPostpaid && (
                                    <div>
                                        <label htmlFor="billingMonth" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Billing Month</label>
                                        <select
                                            id="billingMonth"
                                            value={selectedMonth}
                                            onChange={(e) => setSelectedMonth(e.target.value)}
                                            className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                                        >
                                            {(() => {
                                                const now = new Date();
                                                const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                                                const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                                                const prevMonthKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
                                                
                                                // Build set of months already in unpaid list
                                                const unpaidMonthKeys = new Set(unpaidMonths.map(m => m.month));
                                                
                                                const options: React.ReactNode[] = [];
                                                
                                                // Add previous month if not already in unpaid list
                                                if (!unpaidMonthKeys.has(prevMonthKey)) {
                                                    options.push(
                                                        <option key={prevMonthKey} value={prevMonthKey}>
                                                            {formatMonthDisplay(prevMonthKey)} (PREVIOUS)
                                                        </option>
                                                    );
                                                }
                                                
                                                // Add unpaid months
                                                unpaidMonths.forEach(m => {
                                                    options.push(
                                                        <option key={m.month} value={m.month}>
                                                            {formatMonthDisplay(m.month)} {isMonthOverdue(m.month) ? '(OVERDUE)' : '(CURRENT)'} - {formatCurrency(m.planPrice || planPrice)}
                                                        </option>
                                                    );
                                                });
                                                
                                                // If no unpaid months, also add current + advance months
                                                if (unpaidMonths.length === 0) {
                                                    for (let i = 0; i < 3; i++) {
                                                        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
                                                        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                                                        // Skip if this is the previous month we already added
                                                        if (key === prevMonthKey) continue;
                                                        options.push(
                                                            <option key={key} value={key}>
                                                                {formatMonthDisplay(key)} {i === 0 ? '(CURRENT)' : '(ADVANCE)'}
                                                            </option>
                                                        );
                                                    }
                                                }
                                                
                                                return options;
                                            })()}
                                        </select>
                                        {selectedMonth && isMonthOverdue(selectedMonth) && (
                                            <p className="mt-1 text-xs text-red-500">This month is overdue. Payment will reconnect the user.</p>
                                        )}
                                        {selectedMonth && !isMonthOverdue(selectedMonth) && (
                                            <p className="mt-1 text-xs text-blue-500">This payment will be applied as credit for the selected month.</p>
                                        )}
                                    </div>
                                )}

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
                                    <label htmlFor="paymentDate" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Payment Date</label>
                                    <input type="date" id="paymentDate" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                                </div>
                                <div>
                                    <label htmlFor="discountDays" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Discount for Downtime (Days)</label>
                                    <input type="number" id="discountDays" value={discountDays} onChange={(e) => setDiscountDays(e.target.value)} min="0" step="1" className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                                </div>
                                <div>
                                    <label htmlFor="customAmount" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Custom Amount Paid <span className="text-xs text-slate-400">(optional — leave empty for exact amount)</span></label>
                                    <input type="number" id="customAmount" value={customAmount} onChange={(e) => setCustomAmount(e.target.value)} min="0" step="0.01" placeholder={`Exact: ${formatCurrency(amountDue)}`} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white placeholder-slate-400" />
                                    {hasCustomAmount && overpaymentCredit > 0 && (
                                        <p className="mt-1 text-xs text-green-600 dark:text-green-400 font-medium">
                                            Overpayment of <span className="font-bold">{formatCurrency(overpaymentCredit)}</span> will be added as client credit.
                                        </p>
                                    )}
                                    {hasCustomAmount && overpaymentCredit === 0 && customAmountValue < amountDue && (
                                        <p className="mt-1 text-xs text-yellow-600 dark:text-yellow-400 font-medium">
                                            Amount is less than the amount due ({formatCurrency(amountDue)}).
                                        </p>
                                    )}
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
                                    {creditApplied > 0 && (
                                        <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                                            <span>Credit Applied</span>
                                            <span>- {formatCurrency(creditApplied)}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between text-sm font-semibold text-slate-700 dark:text-slate-200 mt-1">
                                        <span>Amount Due</span>
                                        <span>{formatCurrency(amountDue)}</span>
                                    </div>
                                    {hasCustomAmount && (
                                        <div className="flex justify-between text-sm text-blue-600 dark:text-blue-400">
                                            <span>Amount Paid (Custom)</span>
                                            <span>{formatCurrency(customAmountValue)}</span>
                                        </div>
                                    )}
                                    {overpaymentCredit > 0 && (
                                        <div className="flex justify-between text-sm font-bold text-green-600 dark:text-green-400">
                                            <span>New Client Credit</span>
                                            <span>+ {formatCurrency(overpaymentCredit)}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between text-lg font-bold text-slate-900 dark:text-white mt-2">
                                        <span>TOTAL</span>
                                        <span>{formatCurrency(finalAmount)}</span>
                                    </div>
                                    {creditApplied > 0 && creditApplied < creditAvailable && (
                                        <p className="mt-1 text-xs text-green-600 dark:text-green-400">
                                            Remaining credit after payment: {formatCurrency(creditAvailable - creditApplied)}
                                        </p>
                                    )}
                                    {isPostpaid && selectedMonth && (
                                        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                            Covering: <span className="font-semibold">{formatMonthDisplay(selectedMonth)}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg shrink-0">
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
