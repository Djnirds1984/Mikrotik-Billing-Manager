

import type { PanelSettings } from '../types.ts';

const apiBaseUrl = '/api/db';

// --- Auth Helper ---
// This can be used by other services as well
export const getAuthHeader = () => {
    const token = localStorage.getItem('authToken');
    if (token) {
        return { 'Authorization': `Bearer ${token}` };
    }
    return {};
};

const fetchData = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${apiBaseUrl}${path}`, {
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeader(),
            ...options.headers,
        },
        ...options,
    });
  
    if (response.status === 401) {
        // Unauthorized, likely bad token. Force a logout.
        localStorage.removeItem('authToken');
        window.location.reload();
        throw new Error('Session expired. Please log in again.');
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: `Request failed with status ${response.status}` }));
        throw new Error(errorData.message);
    }
    
    if (response.status === 204) { // No Content
        return {} as T;
    }

    return response.json() as Promise<T>;
};

export const dbApi = {
    get: <T>(path: string): Promise<T> => fetchData<T>(path),
    post: <T>(path: string, data: any): Promise<T> => fetchData<T>(path, { method: 'POST', body: JSON.stringify(data) }),
    patch: <T>(path: string, data: any): Promise<T> => fetchData<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: <T>(path: string): Promise<T> => fetchData<T>(path, { method: 'DELETE' }),
};

export const getPanelSettings = async (): Promise<PanelSettings> => {
    try {
        const raw = localStorage.getItem('panelSettingsCache');
        if (raw) {
            const parsed = JSON.parse(raw);
            const ttlMs = 10 * 60 * 1000;
            if (parsed && parsed.data && Date.now() - parsed.timestamp < ttlMs) {
                dbApi.get<PanelSettings>('/panel-settings').then((data) => {
                    try { localStorage.setItem('panelSettingsCache', JSON.stringify({ timestamp: Date.now(), data })); } catch {}
                }).catch(() => {});
                return parsed.data as PanelSettings;
            }
        }
    } catch {}
    const data = await dbApi.get<PanelSettings>('/panel-settings');
    try { localStorage.setItem('panelSettingsCache', JSON.stringify({ timestamp: Date.now(), data })); } catch {}
    return data;
};

export const savePanelSettings = (settings: Partial<PanelSettings>): Promise<{ message: string }> => {
    return dbApi.post<{ message: string }>('/panel-settings', settings);
};

export const initMariaDb = (): Promise<{ message: string }> => {
    return dbApi.post<{ message: string }>('/init-mariadb', {});
};

export const migrateSqliteToMariaDb = (): Promise<{ message: string }> => {
    return dbApi.post<{ message: string }>('/migrate-sqlite-to-mariadb', {});
};
