


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
            // FIX: Provide a fallback currency for plans created before this update.
            // Also map old cycle values to cycle_days for backward compatibility.
            const dataWithFallback = data.map(plan => {
                let cycleDays = plan.cycle_days;
                if (!cycleDays) {
                    if (plan.cycle === 'Quarterly') cycleDays = 90;
                    else if (plan.cycle === 'Yearly') cycleDays = 365;
                    else cycleDays = 30;
                }
                return {
                    ...plan,
                    currency: plan.currency || 'USD',
                    cycle_days: cycleDays
                };
            });
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
            console.error("Cannot add plan without a selected router.");
            return;
        }
        try {
            const newPlan: BillingPlanWithId = {
                ...planConfig,
                id: `plan_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                routerId: routerId,
            };
            await dbApi.post('/billing-plans', newPlan);
            await fetchPlans();
        } catch (err) {
            console.error("Failed to add billing plan:", err);
        }
    };

    const updatePlan = async (updatedPlan: BillingPlanWithId) => {
        try {
            await dbApi.patch(`/billing-plans/${updatedPlan.id}`, updatedPlan);
            await fetchPlans();
        } catch (err) {
            console.error("Failed to update billing plan:", err);
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
