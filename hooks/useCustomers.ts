import { useState, useEffect, useCallback, useRef } from 'react';
import type { Customer } from '../types.ts';
import { dbApi } from '../services/databaseService.ts';

export const useCustomers = (routerId: string | null) => {
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const scope = useRef({ routerId, active: false, request: 0, loaded: false });

    const fetchCustomers = useCallback(async () => {
        const current = scope.current;
        if (!current.active || current.routerId !== routerId || !routerId) return;
        const request = ++current.request;
        setIsLoading(!current.loaded);
        setError(null);
        try {
            const data = await dbApi.get<Customer[]>(`/customers?routerId=${encodeURIComponent(routerId)}`);
            if (!current.active || request !== current.request) return;
            current.loaded = true;
            setCustomers(data);
        } catch (err) {
            if (current.active && request === current.request) setError((err as Error).message);
        } finally {
            if (current.active && request === current.request) setIsLoading(false);
        }
    }, [routerId]);

    useEffect(() => {
        const current = { routerId, active: true, request: 0, loaded: false };
        scope.current = current;
        setCustomers([]);
        setError(null);
        setIsLoading(!!routerId);
        void fetchCustomers();
        return () => { current.active = false; };
    }, [routerId, fetchCustomers]);

    const addCustomer = async (customerData: Omit<Customer, 'id'>) => {
        const current = scope.current;
        const newCustomer: Customer = {
            ...customerData,
            id: `cust_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        };
        const { customer } = await dbApi.post<{ customer: Customer }>('/customers', newCustomer);
        if (current.active && current.routerId === routerId) {
            current.loaded = true;
            setCustomers(rows => [...rows.filter(row => row.id !== customer.id), customer]);
            void fetchCustomers();
        }
        return customer;
    };

    const updateCustomer = async (updatedCustomer: Customer) => {
        const current = scope.current;
        const { customer } = await dbApi.patch<{ customer: Customer }>(`/customers/${encodeURIComponent(updatedCustomer.id)}`, updatedCustomer);
        if (current.active && current.routerId === routerId) {
            current.loaded = true;
            setCustomers(rows => {
                if (customer.routerId !== routerId) return rows.filter(row => row.id !== customer.id);
                return rows.some(row => row.id === customer.id)
                    ? rows.map(row => row.id === customer.id ? customer : row)
                    : [...rows, customer];
            });
            void fetchCustomers();
        }
    };

    const deleteCustomer = async (customerId: string) => {
        const current = scope.current;
        try {
            await dbApi.delete(`/customers/${encodeURIComponent(customerId)}`);
            if (current.active && current.routerId === routerId) {
                current.loaded = true;
                setCustomers(rows => rows.filter(row => row.id !== customerId));
                void fetchCustomers();
            }
        } catch (err) {
            if (current.active) setError((err as Error).message);
        }
    };

    return { customers, addCustomer, updateCustomer, deleteCustomer, isLoading, error, fetchCustomers };
};
