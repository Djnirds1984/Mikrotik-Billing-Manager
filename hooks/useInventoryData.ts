import { useState, useEffect, useCallback } from 'react';
import type { InventoryItem } from '../types.ts';
import { dbApi } from '../services/databaseService.ts';

export const useInventoryData = (enabled: boolean = true) => {
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchItems = useCallback(async () => {
        if (!enabled) { setIsLoading(false); return; }
        setIsLoading(true);
        setError(null);
        try {
            const data = await dbApi.get<InventoryItem[]>('/inventory');
            setItems(data);
        } catch (err) {
            setError((err as Error).message);
            console.error("Failed to fetch inventory from DB", err);
        } finally {
            setIsLoading(false);
        }
    }, [enabled]);

    useEffect(() => {
        fetchItems();
    }, [fetchItems]);

    const addItem = async (newItemData: Omit<InventoryItem, 'id' | 'dateAdded'>) => {
        try {
            const newItem: InventoryItem = {
                ...newItemData,
                id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                dateAdded: new Date().toISOString(),
            };
            await dbApi.post('/inventory', newItem);
            await fetchItems();
        } catch (err) {
            console.error("Failed to add inventory item:", err);
        }
    };

    const updateItem = async (updatedItem: InventoryItem) => {
        try {
            await dbApi.patch(`/inventory/${updatedItem.id}`, updatedItem);
            await fetchItems();
        } catch (err) {
            console.error("Failed to update inventory item:", err);
        }
    };
    
    const deleteItem = async (itemId: string) => {
        try {
            await dbApi.delete(`/inventory/${itemId}`);
            await fetchItems();
        } catch (err) {
            console.error("Failed to delete inventory item:", err);
        }
    };

    return { items, addItem, updateItem, deleteItem, isLoading, error };
};
