// ============================================================
// Hotspot Controller - Frontend Service (Isolated)
// All API calls to /api/hotspot/* endpoints
// ============================================================

import type {
    EspDevice,
    EspDeviceData,
    HotspotPlan,
    HotspotPlanData,
    HotspotVoucherBatch,
    HotspotVoucher,
    HotspotSession,
    CoinslotTransaction,
    HotspotLoginResponse,
    BatchGenerateRequest,
} from '../types/hotspot.ts';

const BASE = '/api/hotspot';

const getAuthHeader = (): Record<string, string> => {
    const token = localStorage.getItem('authToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
};

const apiCall = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${BASE}${path}`, {
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
        const errorData = await response.json().catch(() => ({ message: `Request failed (${response.status})` }));
        throw new Error(errorData.message || 'Unknown error');
    }

    return response.json() as Promise<T>;
};

// ============================================================
// Plans
// ============================================================

export const getHotspotPlans = (routerId?: string) =>
    apiCall<HotspotPlan[]>(`/plans${routerId ? `?routerId=${routerId}` : ''}`);

export const createHotspotPlan = (data: HotspotPlanData) =>
    apiCall<HotspotPlan>('/plans', { method: 'POST', body: JSON.stringify(data) });

export const updateHotspotPlan = (id: string, data: Partial<HotspotPlanData>) =>
    apiCall<HotspotPlan>(`/plans/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteHotspotPlan = (id: string) =>
    apiCall<{ message: string }>(`/plans/${id}`, { method: 'DELETE' });

// ============================================================
// Voucher Batches
// ============================================================

export const getVoucherBatches = (routerId?: string) =>
    apiCall<HotspotVoucherBatch[]>(`/vouchers/batches${routerId ? `?routerId=${routerId}` : ''}`);

export const generateVoucherBatch = (data: BatchGenerateRequest) =>
    apiCall<{ batch: HotspotVoucherBatch; voucherCount: number }>('/vouchers/batch', {
        method: 'POST',
        body: JSON.stringify(data),
    });

export const deleteVoucherBatch = (id: string) =>
    apiCall<{ message: string }>(`/vouchers/batch/${id}`, { method: 'DELETE' });

// ============================================================
// Vouchers
// ============================================================

export const getVouchers = (params: { routerId?: string; status?: string; batchId?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.routerId) query.set('routerId', params.routerId);
    if (params.status) query.set('status', params.status);
    if (params.batchId) query.set('batchId', params.batchId);
    const qs = query.toString();
    return apiCall<HotspotVoucher[]>(`/vouchers${qs ? `?${qs}` : ''}`);
};

// ============================================================
// Sessions
// ============================================================

export const getSessions = (params: { routerId?: string; status?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.routerId) query.set('routerId', params.routerId);
    if (params.status) query.set('status', params.status);
    const qs = query.toString();
    return apiCall<HotspotSession[]>(`/sessions${qs ? `?${qs}` : ''}`);
};

export const kickSession = (id: string) =>
    apiCall<{ success: boolean }>(`/sessions/${id}/kick`, { method: 'POST' });

export const extendSession = (id: string, additionalSeconds: number) =>
    apiCall<HotspotSession>(`/sessions/${id}/extend`, {
        method: 'POST',
        body: JSON.stringify({ additionalSeconds }),
    });

// ============================================================
// ESP Devices
// ============================================================

export const getEspDevices = (routerId?: string) =>
    apiCall<EspDevice[]>(`/devices${routerId ? `?routerId=${routerId}` : ''}`);

export const createEspDevice = (data: EspDeviceData) =>
    apiCall<EspDevice>('/devices', { method: 'POST', body: JSON.stringify(data) });

export const updateEspDevice = (id: string, data: Partial<EspDeviceData>) =>
    apiCall<EspDevice>(`/devices/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteEspDevice = (id: string) =>
    apiCall<{ message: string }>(`/devices/${id}`, { method: 'DELETE' });

// ============================================================
// Transactions
// ============================================================

export const getTransactions = (params: { routerId?: string; espDeviceId?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.routerId) query.set('routerId', params.routerId);
    if (params.espDeviceId) query.set('espDeviceId', params.espDeviceId);
    const qs = query.toString();
    return apiCall<CoinslotTransaction[]>(`/transactions${qs ? `?${qs}` : ''}`);
};

// ============================================================
// Public Endpoints (no auth required)
// ============================================================

export const getPublicPlans = (routerId: string) =>
    fetch(`${BASE}/public/plans?routerId=${routerId}`).then(r => r.json()) as Promise<HotspotPlan[]>;

export const voucherLogin = (code: string, routerId: string, mac: string, ip: string) =>
    fetch(`${BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, routerId, mac, ip }),
    }).then(r => r.json()) as Promise<HotspotLoginResponse>;
