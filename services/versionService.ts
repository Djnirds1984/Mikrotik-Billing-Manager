import { getAuthHeader } from './databaseService.ts';

export interface AppVersionInfo {
  version: string;
  buildDate?: string;
}

export interface MigrationStatus {
  currentVersion: string;
  pendingMigrations: string[];
  appliedMigrations: { version: string; applied_at: string; description: string }[];
}

const fetchData = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(path, {
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
    const errorData = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(errorData.message || `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
};

export const getAppVersion = (): Promise<AppVersionInfo> => {
  return fetchData<AppVersionInfo>('/api/app-version');
};

export const getMigrationStatus = (): Promise<MigrationStatus> => {
  return fetchData<MigrationStatus>('/api/migration-status');
};
