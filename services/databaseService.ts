

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
        const suppress = localStorage.getItem('suppressReload');
        if (!suppress) {
            localStorage.removeItem('authToken');
            window.location.reload();
        }
        throw new Error('Session expired. Please log in again.');
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: `Request failed with status ${response.status}` }));
        throw new Error(errorData.message);
    }
    
    if (response.status === 204) { // No Content
        return {} as T;
    }

    // Handle empty response bodies gracefully
    const text = await response.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
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

export const initMariaDb = (): Promise<{ message: string }> => {
    return dbApi.post<{ message: string }>('/init-mariadb', {});
};

export const migrateSqliteToMariaDb = (): Promise<{ message: string }> => {
    return dbApi.post<{ message: string }>('/migrate-sqlite-to-mariadb', {});
};

export const factoryReset = (): Promise<{ message: string; success: boolean }> => {
    return dbApi.post<{ message: string; success: boolean }>('/factory-reset', {});
};

// --- Auto Backup ---
export interface AutoBackupSettings {
    enabled: boolean;
    intervalHours: number;
    maxBackups: number;
    lastBackup: string | null;
}

export const getAutoBackupSettings = (): Promise<AutoBackupSettings> => {
    return fetch('/api/auto-backup-settings', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
    }).then(r => r.json());
};

export const saveAutoBackupSettings = (settings: Omit<AutoBackupSettings, 'lastBackup'>): Promise<{ message: string; settings: AutoBackupSettings }> => {
    return fetch('/api/auto-backup-settings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        },
        body: JSON.stringify(settings)
    }).then(r => r.json());
};

export const runAutoBackup = (): Promise<{ message: string }> => {
    return fetch('/api/run-auto-backup', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
    }).then(r => r.json());
};

// --- Turso Cloud Sync ---
export interface TursoStatus {
    status: 'disabled' | 'connecting' | 'active' | 'warning' | 'failed' | 'recovering' | 'syncing';
    enabled: boolean;
    configured: boolean;
    url: string;
    databaseName: string;
    authToken: string;
    hasAuthToken: boolean;
    lastSuccess: string | null;
    lastAttempt: string | null;
    error: string | null;
    pending: number;
    restored: number;
    conflicts: number;
    tables: string[];
}

export interface TursoConfig {
    url: string;
    databaseName: string;
    authToken: string;
}

export const getTursoStatus = (): Promise<TursoStatus> => {
    return fetch('/api/db/turso/status', {
        headers: { ...getAuthHeader() }
    }).then(r => { if (!r.ok) throw new Error(`Request failed (${r.status})`); return r.json(); });
};

export const testTursoConnection = (config: TursoConfig): Promise<{ message: string }> => {
    return fetch('/api/db/turso/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(config)
    }).then(r => { if (!r.ok) throw new Error(`Request failed (${r.status})`); return r.json(); });
};

export const testTursoReach = (url: string): Promise<{ status: number; ok: boolean; body: string }> => {
    return fetch('/api/db/turso/test-reach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ url })
    }).then(r => { if (!r.ok) throw new Error(`Request failed (${r.status})`); return r.json(); });
};

export const configureTurso = (config: TursoConfig): Promise<TursoStatus> => {
    return fetch('/api/db/turso/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(config)
    }).then(r => { if (!r.ok) throw new Error(`Request failed (${r.status})`); return r.json(); });
};

export const disableTurso = (): Promise<TursoStatus> => {
    return fetch('/api/db/turso/disable', {
        method: 'POST',
        headers: { ...getAuthHeader() }
    }).then(r => { if (!r.ok) throw new Error(`Request failed (${r.status})`); return r.json(); });
};

export const syncTursoNow = (): Promise<{ message: string; status: TursoStatus }> => {
    return fetch('/api/db/turso/sync', {
        method: 'POST',
        headers: { ...getAuthHeader() }
    }).then(r => { if (!r.ok) throw new Error(`Request failed (${r.status})`); return r.json(); });
};
