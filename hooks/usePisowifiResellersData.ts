import { useState, useEffect, useCallback } from 'react';
import type { PisowifiReseller } from '../types.ts';
import { dbApi } from '../services/databaseService.ts';

export const usePisowifiResellersData = (autoLoad: boolean = true) => {
    const [resellers, setResellers] = useState<PisowifiReseller[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchResellers = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await dbApi.get<PisowifiReseller[]>('/pisowifi-resellers');
            data.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            setResellers(data);
        } catch (err) {
            setError((err as Error).message);
            console.error("Failed to fetch pisowifi resellers from DB", err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!autoLoad) {
            setIsLoading(false);
            return;
        }
        fetchResellers();
    }, [fetchResellers, autoLoad]);

    const addReseller = async (newResellerData: Omit<PisowifiReseller, 'id' | 'createdAt'>) => {
        try {
            const newReseller: PisowifiReseller = {
                ...newResellerData,
                id: `pwr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                createdAt: new Date().toISOString(),
            };
            await dbApi.post('/pisowifi-resellers', newReseller);
            await fetchResellers();
        } catch (err) {
            console.error("Failed to add pisowifi reseller:", err);
            throw err;
        }
    };

    const updateReseller = async (updatedReseller: PisowifiReseller) => {
        try {
            await dbApi.patch(`/pisowifi-resellers/${updatedReseller.id}`, updatedReseller);
            await fetchResellers();
        } catch (err) {
            console.error("Failed to update pisowifi reseller:", err);
            throw err;
        }
    };
    
    const deleteReseller = async (resellerId: string) => {
        try {
            await dbApi.delete(`/pisowifi-resellers/${resellerId}`);
            await fetchResellers();
        } catch (err) {
            console.error("Failed to delete pisowifi reseller:", err);
        }
    };

    return { resellers, addReseller, updateReseller, deleteReseller, isLoading, error, reload: fetchResellers };
};

