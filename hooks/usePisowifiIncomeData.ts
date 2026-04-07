import { useState, useEffect, useCallback } from 'react';
import type { PisowifiIncomeRecord } from '../types.ts';
import { dbApi } from '../services/databaseService.ts';

export const usePisowifiIncomeData = (autoLoad: boolean = true) => {
    const [records, setRecords] = useState<PisowifiIncomeRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const normalizePercent = (value: unknown) => {
        const raw = Number(value) || 0;
        if (raw <= 0) return 0;
        if (raw === 1) return 1;
        if (raw > 1) return raw;
        return raw * 100;
    };

    const fetchRecords = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await dbApi.get<PisowifiIncomeRecord[]>('/pisowifi-income');
            data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            setRecords(data);
        } catch (err) {
            setError((err as Error).message);
            console.error("Failed to fetch pisowifi income from DB", err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!autoLoad) {
            setIsLoading(false);
            return;
        }
        fetchRecords();
    }, [fetchRecords, autoLoad]);

    const addRecord = async (newRecordData: Omit<PisowifiIncomeRecord, 'id' | 'createdAt' | 'netTotal'> & { netTotal?: number }) => {
        const grossSales = Number(newRecordData.grossSales) || 0;
        const expenses = Number(newRecordData.expenses) || 0;
        const percentage = normalizePercent(newRecordData.percentage);
        const percentAmount = grossSales * (percentage / 100);
        const netTotal = grossSales - percentAmount - expenses;

        try {
            const newRecord: PisowifiIncomeRecord = {
                ...newRecordData,
                grossSales,
                expenses,
                netTotal,
                percentage,
                id: `pwi_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                createdAt: new Date().toISOString(),
            };
            await dbApi.post('/pisowifi-income', newRecord);
            await fetchRecords();
        } catch (err) {
            console.error("Failed to add pisowifi income:", err);
            throw err;
        }
    };

    const updateRecord = async (updatedRecord: PisowifiIncomeRecord) => {
        try {
            const grossSales = Number(updatedRecord.grossSales) || 0;
            const expenses = Number(updatedRecord.expenses) || 0;
            const percentage = normalizePercent(updatedRecord.percentage);
            const percentAmount = grossSales * (percentage / 100);
            const netTotal = grossSales - percentAmount - expenses;
            const toSave: PisowifiIncomeRecord = {
                ...updatedRecord,
                percentage,
                grossSales,
                expenses,
                netTotal,
            };
            await dbApi.patch(`/pisowifi-income/${updatedRecord.id}`, toSave);
            await fetchRecords();
        } catch (err) {
            console.error("Failed to update pisowifi income:", err);
            throw err;
        }
    };
    
    const deleteRecord = async (recordId: string) => {
        try {
            await dbApi.delete(`/pisowifi-income/${recordId}`);
            await fetchRecords();
        } catch (err) {
            console.error("Failed to delete pisowifi income:", err);
        }
    };

    return { records, addRecord, updateRecord, deleteRecord, isLoading, error, reload: fetchRecords };
};
