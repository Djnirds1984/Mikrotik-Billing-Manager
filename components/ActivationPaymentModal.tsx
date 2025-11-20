
import React, { useState, useEffect, useMemo } from 'react';
import type { DhcpClient, DhcpBillingPlanWithId, DhcpClientDbRecord, DhcpClientActionParams } from '../types.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';

interface ActivationPaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (params: DhcpClientActionParams) => void;
    client: DhcpClient | null;
    plans: DhcpBillingPlanWithId[];
    isSubmitting: boolean;
    dbClient?: DhcpClientDbRecord | null;
}

export const ActivationPaymentModal: React.FC<ActivationPaymentModalProps> = ({
    isOpen,
    onClose,
    onSave,
    client,
    plans,
    isSubmitting,
    dbClient
}) => {
    const { t, formatCurrency } = useLocalization();
    
    // State
    const [selectedPlanId, setSelectedPlanId] = useState<string>('');
    const [customerInfo, setCustomerInfo] = useState('');
    const [contactNumber, setContactNumber] = useState('');
    const [email, setEmail] = useState('');
    const [downtimeDays, setDowntimeDays] = useState<number>(0);
    const [manualExpiresAt, setManualExpiresAt] = useState('');

    // Effect to initialize data when modal opens or client/dbClient changes
    useEffect(() => {
        if (isOpen && client) {
            setCustomerInfo(dbClient?.customerInfo || client.customerInfo || client.hostName || '');
            setContactNumber(dbClient?.contactNumber || client.contactNumber || '');
            setEmail(dbClient?.email || client.email || '');
            setDowntimeDays(0);
            setManualExpiresAt('');
            
            // Select first plan by default if none selected
            if (plans.length > 0) {
                setSelectedPlanId(plans[0].id);
            }
        }
    }, [isOpen, client, dbClient, plans]);

    // Computed values
    const selectedPlan = useMemo(() => plans.find(p => p.id === selectedPlanId), [plans, selectedPlanId]);
    
    const calculation = useMemo(() => {
        if (!selectedPlan) return { price: 0, discount: 0, total: 0 };
        
        const price = selectedPlan.price;
        const days = selectedPlan.cycle_days;
        const pricePerDay = days > 0 ? price / days : 0;
        const discount = pricePerDay * downtimeDays;
        const total = Math.max(0, price - discount);
        
        return { price, discount, total };
    }, [selectedPlan, downtimeDays]);

    if (!isOpen || !client) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedPlan) return;

        onSave({
            customerInfo,
            contactNumber,
            email,
            plan: selectedPlan,
            downtimeDays,
            expiresAt: manualExpiresAt || undefined, // If empty string, undefined to let backend calculate based on plan
            speedLimit: selectedPlan.speedLimit
        });
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg border border-slate-200 dark:border-slate-700 flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400]">
                         Activate Client: <span className="text-slate-700 dark:text-slate-300 font-mono text-base">{client.address}</span>
                    </h3>
                </div>
                
                <div className="p-6 overflow-y-auto">
                    <form id="activation-form" onSubmit={handleSubmit} className="space-y-4">
                        {/* Customer Details */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Customer Name / Identifier</label>
                            <input 
                                type="text" 
                                required 
                                value={customerInfo} 
                                onChange={e => setCustomerInfo(e.target.value)}
                                className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md focus:ring-2 focus:ring-[--color-primary-500] focus:outline-none text-slate-900 dark:text-white"
                            />
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Contact Number</label>
                                <input 
                                    type="text" 
                                    value={contactNumber} 
                                    onChange={e => setContactNumber(e.target.value)}
                                    className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md text-slate-900 dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Email</label>
                                <input 
                                    type="email" 
                                    value={email} 
                                    onChange={e => setEmail(e.target.value)}
                                    className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md text-slate-900 dark:text-white"
                                />
                            </div>
                        </div>

                        <hr className="border-slate-200 dark:border-slate-700" />

                        {/* Plan Details */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Select Billing Plan</label>
                            <select 
                                value={selectedPlanId} 
                                onChange={e => setSelectedPlanId(e.target.value)}
                                className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md text-slate-900 dark:text-white"
                            >
                                {plans.map(p => (
                                    <option key={p.id} value={p.id}>
                                        {p.name} - {formatCurrency(p.price)} / {p.cycle_days} days
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                             <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Downtime Discount (Days)</label>
                             <input 
                                type="number" 
                                min="0"
                                value={downtimeDays} 
                                onChange={e => setDowntimeDays(parseInt(e.target.value) || 0)}
                                className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md text-slate-900 dark:text-white"
                             />
                             <p className="text-xs text-slate-500 mt-1">Reduce price based on days without service.</p>
                        </div>
                        
                         <div>
                             <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Manual Expiration (Optional)</label>
                             <input 
                                type="datetime-local" 
                                value={manualExpiresAt} 
                                onChange={e => setManualExpiresAt(e.target.value)}
                                className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md text-slate-900 dark:text-white"
                             />
                             <p className="text-xs text-slate-500 mt-1">Override the plan's default duration.</p>
                        </div>

                        {/* Summary */}
                        <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-md space-y-2">
                            <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400">
                                <span>Plan Price:</span>
                                <span>{formatCurrency(calculation.price)}</span>
                            </div>
                             <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400">
                                <span>Discount:</span>
                                <span>- {formatCurrency(calculation.discount)}</span>
                            </div>
                            <div className="flex justify-between font-bold text-lg text-slate-900 dark:text-white border-t border-slate-200 dark:border-slate-700 pt-2 mt-2">
                                <span>Total to Pay:</span>
                                <span>{formatCurrency(calculation.total)}</span>
                            </div>
                        </div>

                    </form>
                </div>
                
                <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-4 flex justify-end gap-3 rounded-b-lg border-t border-slate-200 dark:border-slate-700">
                    <button 
                        type="button" 
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500"
                    >
                        Cancel
                    </button>
                    <button 
                        type="submit" 
                        form="activation-form"
                        disabled={isSubmitting || !selectedPlan}
                        className="px-4 py-2 text-sm font-medium text-white bg-[--color-primary-600] hover:bg-[--color-primary-700] rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[--color-primary-500] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? 'Processing...' : 'Activate & Save'}
                    </button>
                </div>
            </div>
        </div>
    );
};
