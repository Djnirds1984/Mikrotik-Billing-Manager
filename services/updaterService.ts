
import { getAuthHeader } from './databaseService.ts';
import type { VersionInfo, GitHubRepository, GitHubBranch, GitHubPullResult } from '../types.ts';

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

// --- GitHub API Functions ---

export const parseGitHubUrl = (url: string): GitHubRepository | null => {
    try {
        // Handle HTTPS format: https://github.com/owner/repo
        const httpsMatch = url.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
        if (httpsMatch) {
            return {
                owner: httpsMatch[1],
                repo: httpsMatch[2],
                url: url,
                isValid: true
            };
        }
        
        // Handle SSH format: git@github.com:owner/repo.git
        const sshMatch = url.match(/^git@github\.com:([^\/]+)\/([^\/]+?)(?:\.git)?$/);
        if (sshMatch) {
            return {
                owner: sshMatch[1],
                repo: sshMatch[2],
                url: `https://github.com/${sshMatch[1]}/${sshMatch[2]}`,
                isValid: true
            };
        }
        
        return null;
    } catch {
        return null;
    }
};

export const getRepositoryInfo = (repoUrl: string) => {
    const repo = parseGitHubUrl(repoUrl);
    if (!repo) {
        throw new Error('Invalid GitHub repository URL format');
    }
    return fetchData<any>(`/api/github/repo-info?owner=${repo.owner}&repo=${repo.repo}`);
};

export const getBranches = (repoUrl: string) => {
    const repo = parseGitHubUrl(repoUrl);
    if (!repo) {
        throw new Error('Invalid GitHub repository URL format');
    }
    return fetchData<GitHubBranch[]>(`/api/github/branches?owner=${repo.owner}&repo=${repo.repo}`);
};

export const pullFromRepository = (repoUrl: string, branch: string) => {
    return fetchData<GitHubPullResult>('/api/github/pull', {
        method: 'POST',
        body: JSON.stringify({ repoUrl, branch }),
    });
};

export const streamPullFromRepository = (repoUrl: string, branch: string, callbacks: StreamCallbacks) => {
    const url = `/api/github/pull-stream?repoUrl=${encodeURIComponent(repoUrl)}&branch=${encodeURIComponent(branch)}`;
    streamEvents(url, callbacks);
};
