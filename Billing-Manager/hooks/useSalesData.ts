

import { useState, useEffect, useCallback } from 'react';
import type { SaleRecord } from '../types.ts';
import { dbApi } from '../services/databaseService.ts';

export const useSalesData = (routerId: string | null) => {
    const [sales, setSales] = useState<SaleRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchSales = useCallback(async () => {
        if (!routerId) {
            setSales([]);
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const data = await dbApi.get<SaleRecord[]>(`/sales?routerId=${routerId}`);
            // Sort by date descending
            data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            setSales(data);
        } catch (err) {
            setError((err as Error).message);
            console.error("Failed to fetch sales from DB", err);
        } finally {
            setIsLoading(false);
        }
    }, [routerId]);

    useEffect(() => {
        fetchSales();
    }, [fetchSales]);

    const addSale = async (saleData: Omit<SaleRecord, 'id'>) => {
        if (!routerId) {
            const err = new Error("Cannot add sale without a selected router.");
            console.error(err);
            throw err;
        }
        try {
            const newSale: SaleRecord = {
                ...saleData,
                id: `sale_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                routerId: routerId,
            };
            await dbApi.post('/sales', newSale);
            await fetchSales();
        } catch (err) {
            console.error("Failed to add sale:", err);
            throw err;
        }
    };

    const deleteSale = async (saleId: string) => {
        try {
            await dbApi.delete(`/sales/${saleId}`);
            await fetchSales();
        } catch (err) {
            console.error("Failed to delete sale:", err);
        }
    };

    const clearSales = async () => {
        if (!routerId) return;
        try {
            await dbApi.post('/sales/clear-all', { routerId });
            await fetchSales();
        } catch (err) {
            console.error("Failed to clear sales:", err);
        }
    };

    return { sales, addSale, deleteSale, clearSales, isLoading, error };
};