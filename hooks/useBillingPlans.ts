
import { useState, useEffect, useCallback } from 'react';
import type { BillingPlan, BillingPlanWithId } from '../types.ts';
import { dbApi } from '../services/databaseService.ts';

export const useBillingPlans = (routerId: string | null) => {
    const [plans, setPlans] = useState<BillingPlanWithId[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchPlans = useCallback(async () => {
        if (!routerId) {
            setPlans([]);
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const data = await dbApi.get<BillingPlanWithId[]>(`/billing-plans?routerId=${routerId}`);
            // Provide a fallback currency for plans created before currency support.
            const dataWithFallback = data.map(plan => ({
                ...plan,
                currency: plan.currency || 'USD',
            }));
            setPlans(dataWithFallback);
        } catch (err) {
            setError((err as Error).message);
            console.error("Failed to fetch billing plans from DB", err);
        } finally {
            setIsLoading(false);
        }
    }, [routerId]);

    useEffect(() => {
        fetchPlans();
    }, [fetchPlans]);

    const addPlan = async (planConfig: BillingPlan) => {
        if (!routerId) {
            throw new Error('Cannot add plan without a selected router.');
        }
        const newPlan: BillingPlanWithId = {
            ...planConfig,
            id: `plan_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            routerId: routerId,
            // Intentionally not persisting billingType for PPPoE plan creation
            billingType: (planConfig as any).billingType || 'prepaid',
        };
        try {
            // Exclude billingType from payload to decouple plans from type
            const { billingType, ...payload } = newPlan as any;
            await dbApi.post('/billing-plans', payload);
            await fetchPlans();
        } catch (err) {
            // Fallback: if backend complains about unknown column, retry without billingType
            const message = String((err as any)?.message || '');
            if (message.includes('no column named billingType') || message.includes('unknown column') || message.includes('SQLITE_ERROR')) {
                console.warn('[useBillingPlans] Backend missing billingType column. Retrying without it.');
                const { billingType: _bt, ...payloadNoType } = newPlan as any;
                await dbApi.post('/billing-plans', payloadNoType);
                await fetchPlans();
                return;
            }
            throw err;
        }
    };

    const updatePlan = async (updatedPlan: BillingPlanWithId) => {
        try {
            // Exclude billingType to keep it user-level only
            const { billingType, ...payload } = updatedPlan as any;
            await dbApi.patch(`/billing-plans/${updatedPlan.id}`, payload);
            await fetchPlans();
        } catch (err) {
            const message = String((err as any)?.message || '');
            if (message.includes('no column named billingType') || message.includes('unknown column') || message.includes('SQLITE_ERROR')) {
                console.warn('[useBillingPlans] Backend missing billingType column on update. Retrying without it.');
                const { billingType: _bt, ...payloadNoType } = updatedPlan as any;
                await dbApi.patch(`/billing-plans/${updatedPlan.id}`, payloadNoType);
                await fetchPlans();
                return;
            }
            throw err;
        }
    };

    const deletePlan = async (planId: string) => {
        try {
            await dbApi.delete(`/billing-plans/${planId}`);
            await fetchPlans();
        } catch (err) {
            console.error("Failed to delete billing plan:", err);
        }
    };

    return { plans, addPlan, updatePlan, deletePlan, isLoading, error };
};
