import { useState, useEffect, useCallback } from 'react';
import type { ExpenseRecord } from '../types.ts';
import { dbApi } from '../services/databaseService.ts';

export const useExpensesData = () => {
    const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchExpenses = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await dbApi.get<ExpenseRecord[]>('/expenses');
            data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            setExpenses(data);
        } catch (err) {
            setError((err as Error).message);
            console.error("Failed to fetch expenses from DB", err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchExpenses();
    }, [fetchExpenses]);

    const addExpense = async (newExpenseData: Omit<ExpenseRecord, 'id'>) => {
        try {
            const newExpense: ExpenseRecord = {
                ...newExpenseData,
                id: `exp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            };
            await dbApi.post('/expenses', newExpense);
            await fetchExpenses();
        } catch (err) {
            console.error("Failed to add expense:", err);
            throw err;
        }
    };

    const updateExpense = async (updatedExpense: ExpenseRecord) => {
        try {
            await dbApi.patch(`/expenses/${updatedExpense.id}`, updatedExpense);
            await fetchExpenses();
        } catch (err) {
            console.error("Failed to update expense:", err);
            throw err;
        }
    };
    
    const deleteExpense = async (expenseId: string) => {
        try {
            await dbApi.delete(`/expenses/${expenseId}`);
            await fetchExpenses();
        } catch (err) {
            console.error("Failed to delete expense:", err);
        }
    };

    return { expenses, addExpense, updateExpense, deleteExpense, isLoading, error };
};