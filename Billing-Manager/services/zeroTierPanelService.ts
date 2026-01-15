import type { ZeroTierStatusResponse } from '../types.ts';
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
  
    const contentType = response.headers.get("content-type");
    if (!response.ok) {
        let errorMsg = `Request failed with status ${response.status}`;
        if (contentType && contentType.includes("application/json")) {
            const errorData = await response.json();
            errorMsg = errorData.message || errorMsg;
            const error = new Error(errorMsg);
            (error as any).data = errorData;
            throw error;
        } else {
            errorMsg = await response.text();
        }
        throw new Error(errorMsg);
    }

    if (contentType && contentType.includes("application/json")) {
        return response.json() as Promise<T>;
    }
    return response.text() as unknown as Promise<T>;
};

export const getZeroTierStatus = (): Promise<ZeroTierStatusResponse> => {
    return fetchData<ZeroTierStatusResponse>('/api/zt/status');
};

export const joinZeroTierNetwork = (networkId: string): Promise<{ message: string }> => {
    return fetchData<{ message: string }>('/api/zt/join', {
        method: 'POST',
        body: JSON.stringify({ networkId }),
    });
};

export const leaveZeroTierNetwork = (networkId: string): Promise<{ message: string }> => {
    return fetchData<{ message: string }>('/api/zt/leave', {
        method: 'POST',
        body: JSON.stringify({ networkId }),
    });
};

type ZeroTierSetting = 'allowManaged' | 'allowGlobal' | 'allowDefault';
export const setZeroTierNetworkSetting = (networkId: string, setting: ZeroTierSetting, value: boolean): Promise<{ message: string }> => {
    return fetchData<{ message: string }>('/api/zt/set', {
        method: 'POST',
        body: JSON.stringify({ networkId, setting, value }),
    });
};
