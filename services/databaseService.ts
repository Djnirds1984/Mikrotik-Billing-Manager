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

    if (response.status === 204) { // No Content
        return {} as T;
    }
    
    const contentType = response.headers.get("content-type");
    // Check if the response is JSON before trying to parse it.
    if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        // If the server returns an HTML page, it's a routing error.
        if (text && text.trim().startsWith('<!DOCTYPE html>')) {
            throw new Error(`API Error (${response.status}): Server returned an HTML page instead of JSON. This suggests a routing issue for path: ${path}.`);
        }
        // Handle other non-JSON responses that are not HTML.
        throw new Error(`Expected a JSON response but received "${contentType || 'no content type'}".`);
    }

    // Now it's safe to assume the response is JSON.
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || `Request failed with status ${response.status}`);
    }

    return data as Promise<T>;
};

export const dbApi = {
    get: <T>(path: string): Promise<T> => fetchData<T>(path),
    post: <T>(path: string, data: any): Promise<T> => fetchData<T>(path, { method: 'POST', body: JSON.stringify(data) }),
    patch: <T>(path: string, data: any): Promise<T> => fetchData<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: <T>(path: string): Promise<T> => fetchData<T>(path, { method: 'DELETE' }),
};

export const getPanelSettings = (): Promise<PanelSettings> => {
    return dbApi.get<PanelSettings>('/panel-settings');
};

export const savePanelSettings = (settings: Partial<PanelSettings>): Promise<{ message: string }> => {
    return dbApi.post<{ message: string }>('/panel-settings', settings);
};