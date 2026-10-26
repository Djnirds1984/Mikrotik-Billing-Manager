import { useState, useEffect, useCallback } from 'react';
import type { ExpenseCategory } from '../types.ts';
import { dbApi } from '../services/databaseService.ts';

export const useExpenseCategories = (autoLoad: boolean = true) => {
    const [categories, setCategories] = useState<ExpenseCategory[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchCategories = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await dbApi.get<ExpenseCategory[]>('/expense-categories');
            data.sort((a, b) => a.name.localeCompare(b.name));
            setCategories(data);
        } catch (err) {
            setError((err as Error).message);
            console.error("Failed to fetch expense categories", err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!autoLoad) {
            setIsLoading(false);
            return;
        }
        fetchCategories();
    }, [fetchCategories, autoLoad]);

    const addCategory = async (newCategory: Omit<ExpenseCategory, 'id' | 'createdAt'>) => {
        try {
            const category: ExpenseCategory = {
                ...newCategory,
                id: `ecat_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                createdAt: new Date().toISOString()
            };
            await dbApi.post('/expense-categories', category);
            await fetchCategories();
            return category;
        } catch (err) {
            console.error("Failed to add expense category:", err);
            throw err;
        }
    };

    const updateCategory = async (updatedCategory: ExpenseCategory) => {
        try {
            await dbApi.patch(`/expense-categories/${updatedCategory.id}`, updatedCategory);
            await fetchCategories();
        } catch (err) {
            console.error("Failed to update expense category:", err);
            throw err;
        }
    };

    const deleteCategory = async (categoryId: string) => {
        try {
            await dbApi.delete(`/expense-categories/${categoryId}`);
            await fetchCategories();
        } catch (err) {
            console.error("Failed to delete expense category:", err);
            throw err;
        }
    };

    return { categories, addCategory, updateCategory, deleteCategory, isLoading, error, reload: fetchCategories };
};
