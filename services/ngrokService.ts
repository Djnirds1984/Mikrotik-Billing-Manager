import type { NgrokStatus } from '../types.ts';
import { getAuthHeader } from './databaseService.ts';

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
            const error = new Error(errorMsg);
            (error as any).data = errorData; // Attach full error data
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

export const getNgrokStatus = () => fetchData<NgrokStatus>('/api/ngrok/status');

export const saveNgrokSettings = (settings: { authtoken: string; proto: string; port: number }) => 
    fetchData('/api/ngrok/settings', {
        method: 'POST',
        body: JSON.stringify(settings),
    });

export const controlNgrokService = (action: 'start' | 'stop' | 'restart') => 
    fetchData(`/api/ngrok/control/${action}`, { method: 'POST' });

export const streamInstallNgrok = (callbacks: StreamCallbacks) => {
    streamEvents('/api/ngrok/install', callbacks);
};

export const streamUninstallNgrok = (callbacks: StreamCallbacks) => {
    streamEvents('/api/ngrok/uninstall', callbacks);
};
