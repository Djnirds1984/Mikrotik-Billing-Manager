
import { useState, useEffect, useCallback } from 'react';
import type { Customer } from '../types.ts';
import { dbApi } from '../services/databaseService.ts';

export const useCustomers = (routerId: string | null) => {
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchCustomers = useCallback(async () => {
        if (!routerId) {
            setCustomers([]);
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const data = await dbApi.get<Customer[]>(`/customers?routerId=${routerId}`);
            setCustomers(data);
        } catch (err) {
            setError((err as Error).message);
            console.error("Failed to fetch customers from DB", err);
        } finally {
            setIsLoading(false);
        }
    }, [routerId]);

    useEffect(() => {
        fetchCustomers();
    }, [fetchCustomers]);

    const addCustomer = async (customerData: Omit<Customer, 'id'>) => {
        try {
            const newCustomer: Customer = {
                ...customerData,
                id: `cust_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            };
            await dbApi.post('/customers', newCustomer);
            await fetchCustomers(); // refetch for the current router
            return newCustomer;
        } catch (err) {
            console.error("Failed to add customer:", err);
            throw err;
        }
    };
    
    const updateCustomer = async (updatedCustomer: Customer) => {
        try {
            await dbApi.patch(`/customers/${updatedCustomer.id}`, updatedCustomer);
            await fetchCustomers(); // refetch for the current router
        } catch (err) {
            console.error("Failed to update customer:", err);
            throw err;
        }
    };
    
    const deleteCustomer = async (customerId: string) => {
        try {
            await dbApi.delete(`/customers/${customerId}`);
            await fetchCustomers(); // refetch for the current router
        } catch (err) {
            console.error("Failed to delete customer:", err);
        }
    };

    return { customers, addCustomer, updateCustomer, deleteCustomer, isLoading, error, fetchCustomers };
};
