import type { HostNetworkConfig } from '../types.ts';
import { getAuthHeader } from './databaseService.ts';

const fetchData = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
    const apiBaseUrl = ``;
    const response = await fetch(`${apiBaseUrl}${path}`, {
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeader(),
            ...options.headers,
        },
        ...options,
    });
    
    if (response.status === 401) {
        localStorage.removeItem('authToken');
        window.location.reload();
        throw new Error('Session expired. Please log in again.');
    }
  
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'An unknown API error occurred.' }));
        throw new Error(errorData.message);
    }

    return response.json() as Promise<T>;
};

export const getHostNetworkConfig = (): Promise<HostNetworkConfig> => {
    return fetchData<HostNetworkConfig>('/api/host/network-config');
};

export const applyHostNetworkConfig = (config: { wan: string, lan: string, lanIp: string }): Promise<{ message: string }> => {
    return fetchData<{ message: string }>('/api/host/apply-network-config', {
        method: 'POST',
        body: JSON.stringify(config),
    });
};

export const revertHostNetworkConfig = (): Promise<{ message: string }> => {
    return fetchData<{ message: string }>('/api/host/revert-network-config', {
        method: 'POST',
    });
};
