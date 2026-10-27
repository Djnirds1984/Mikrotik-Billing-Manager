import { useState, useEffect, useCallback } from 'react';
import { dbApi } from '../services/databaseService.ts';

interface AllBillingPlan {
    id: string;
    name: string;
    price: number;
    cycle: string;
    cycle_days: number;
    billingType: string;
    store_enabled: number;
    routerId: string | null;
    routerName: string | null;
    pppoeProfile: string;
    description: string;
    currency: string;
    createdAt: string;
}

export const useAllBillingPlans = (autoLoad: boolean = true) => {
    const [plans, setPlans] = useState<AllBillingPlan[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchAllPlans = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            // Fetch all billing plans with router names via JOIN
            const data = await dbApi.get<AllBillingPlan[]>('/all-billing-plans');
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
            console.error("Failed to fetch all billing plans from DB", err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (autoLoad) fetchAllPlans();
    }, [fetchAllPlans, autoLoad]);

    const deletePlan = async (planId: string) => {
        try {
            await dbApi.delete(`/billing-plans/${planId}`);
            await fetchAllPlans();
        } catch (err) {
            console.error("Failed to delete billing plan:", err);
            throw err;
        }
    };

    const toggleStoreEnabled = async (plan: AllBillingPlan) => {
        try {
            const updated = { ...plan, store_enabled: plan.store_enabled ? 0 : 1 };
            await dbApi.patch(`/billing-plans/${plan.id}`, updated);
            await fetchAllPlans();
        } catch (err) {
            console.error("Failed to toggle store visibility:", err);
            throw err;
        }
    };

    return { plans, deletePlan, toggleStoreEnabled, isLoading, error, reload: fetchAllPlans };
};
