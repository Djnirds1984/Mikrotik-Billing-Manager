
import { getAuthHeader } from './databaseService.ts';
import type { VersionInfo } from '../types.ts';

// A generic fetcher for simple JSON API calls
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

// --- Functions for simple fetch calls ---
export const getCurrentVersion = () => fetchData<VersionInfo>('/api/current-version');
export const listBackups = () => fetchData<string[]>('/api/list-backups');
export const deleteBackup = (backupFile: string) => fetchData('/api/delete-backup', {
    method: 'POST',
    body: JSON.stringify({ backupFile }),
});
export const executeGitCommand = (command: string) => fetchData<any>(`/api/git/${command}`, {
    method: 'POST',
});


// --- Streaming Logic using Fetch API ---
interface StreamCallbacks {
    onMessage: (data: any) => void;
    onError: (error: Error) => void;
    onClose?: () => void;
}

const streamEvents = async (url: string, callbacks: StreamCallbacks) => {
    try {
        const response = await fetch(url, {
            headers: getAuthHeader()
        });

        if (response.status === 401) {
            localStorage.removeItem('authToken');
            window.location.reload();
            throw new Error('Session expired. Please log in again.');
        }

        if (!response.ok || !response.body) {
            throw new Error(`Failed to connect to stream: ${response.statusText}`);
        }

        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                if (callbacks.onClose) callbacks.onClose();
                break;
            }

            buffer += value;
            const parts = buffer.split('\n\n');
            buffer = parts.pop() || ''; // Keep the last, possibly incomplete, part

            for (const part of parts) {
                if (part.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(part.substring(6));
                        callbacks.onMessage(data);
                    } catch (e) {
                        console.error("Failed to parse SSE message:", e);
                    }
                }
            }
        }
    } catch (err) {
        callbacks.onError(err as Error);
    }
};

// --- Exported functions for each streaming endpoint ---

export const streamUpdateStatus = (callbacks: StreamCallbacks) => {
    streamEvents('/api/update-status', callbacks);
};

export const streamUpdateApp = (callbacks: StreamCallbacks) => {
    streamEvents('/api/update-app', callbacks);
};

export const streamRollbackApp = (backupFile: string, callbacks: StreamCallbacks) => {
    const url = `/api/rollback-app?backupFile=${encodeURIComponent(backupFile)}`;
    streamEvents(url, callbacks);
};
