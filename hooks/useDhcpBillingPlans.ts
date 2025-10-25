import { useState, useEffect, useCallback } from 'react';
import type { DhcpBillingPlan, DhcpBillingPlanWithId } from '../types.ts';
import { dbApi } from '../services/databaseService.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';

export const useDhcpBillingPlans = (routerId: string | null) => {
    const { currency } = useLocalization();
    const [plans, setPlans] = useState<DhcpBillingPlanWithId[]>([]);
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
            const data = await dbApi.get<DhcpBillingPlanWithId[]>(`/dhcp-billing-plans?routerId=${routerId}`);
            const dataWithFallback = data.map(plan => ({
                ...plan,
                currency: plan.currency || 'USD'
            }));
            setPlans(dataWithFallback);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsLoading(false);
        }
    }, [routerId]);

    useEffect(() => {
        fetchPlans();
    }, [fetchPlans]);

    const addPlan = async (planConfig: Omit<DhcpBillingPlan, 'routerId'>) => {
        if (!routerId) return;
        try {
            const newPlan: DhcpBillingPlanWithId = {
                ...planConfig,
                id: `dhcp_plan_${Date.now()}`,
                routerId: routerId,
                currency: planConfig.currency || currency,
            };
            await dbApi.post('/dhcp-billing-plans', newPlan);
            await fetchPlans();
        } catch (err) {
            console.error("Failed to add DHCP billing plan:", err);
            throw err;
        }
    };

    const updatePlan = async (updatedPlan: DhcpBillingPlanWithId) => {
        try {
            await dbApi.patch(`/dhcp-billing-plans/${updatedPlan.id}`, updatedPlan);
            await fetchPlans();
        } catch (err) {
            console.error("Failed to update DHCP billing plan:", err);
            throw err;
        }
    };

    const deletePlan = async (planId: string) => {
        try {
            await dbApi.delete(`/dhcp-billing-plans/${planId}`);
            await fetchPlans();
        } catch (err) {
            console.error("Failed to delete DHCP billing plan:", err);
            throw err;
        }
    };

    return { plans, addPlan, updatePlan, deletePlan, isLoading, error, fetchPlans };
};
