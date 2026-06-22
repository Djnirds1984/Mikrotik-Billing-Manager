// ============================================================
// Hotspot Controller Types - Isolated Module
// ============================================================

export interface EspDevice {
    id: string;
    routerId: string;
    deviceName: string;
    macAddress?: string;
    apiKey: string;
    coinValue: number;
    status: 'online' | 'offline';
    lastSeen?: string;
    createdAt: string;
}

export type EspDeviceData = Omit<EspDevice, 'id' | 'apiKey' | 'status' | 'lastSeen' | 'createdAt'>;

export interface HotspotPlan {
    id: string;
    routerId: string;
    name: string;
    durationSeconds: number;
    price: number;
    rateLimit?: string;
    sharedUsers: number;
    currency: string;
    createdAt: string;
}

export type HotspotPlanData = Omit<HotspotPlan, 'id' | 'createdAt'>;

export interface HotspotVoucherBatch {
    id: string;
    routerId: string;
    batchName: string;
    planId: string;
    durationSeconds: number;
    rateLimit?: string;
    price: number;
    totalCount: number;
    remainingCount?: number; // computed at query time
    createdAt: string;
}

export interface HotspotVoucher {
    id: string;
    batchId: string;
    routerId: string;
    code: string;
    durationSeconds: number;
    rateLimit?: string;
    price: number;
    status: 'available' | 'active' | 'used' | 'expired';
    activatedAt?: string;
    expiresAt?: string;
    macAddress?: string;
    ipAddress?: string;
    soldVia: 'manual' | 'paymongo' | 'coinslot';
    espDeviceId?: string;
    createdAt: string;
}

export interface HotspotSession {
    id: string;
    voucherId?: string;
    routerId: string;
    espDeviceId?: string;
    username: string;
    macAddress: string;
    ipAddress?: string;
    durationSeconds: number;
    startedAt: string;
    expiresAt: string;
    status: 'active' | 'expired' | 'kicked';
    amountPaid: number;
    paymentMethod: 'coinslot' | 'voucher' | 'paymongo';
    bytesIn: number;
    bytesOut: number;
}

export interface CoinslotTransaction {
    id: string;
    espDeviceId: string;
    routerId: string;
    macAddress: string;
    ipAddress?: string;
    coinsInserted: number;
    amount: number;
    durationSeconds: number;
    sessionId?: string;
    status: 'completed' | 'refunded';
    createdAt: string;
}

// API Request/Response types
export interface CoinInsertRequest {
    macAddress: string;
    ipAddress?: string;
    coinPulses: number;
}

export interface VoucherLoginRequest {
    code: string;
    routerId: string;
    mac: string;
    ip: string;
}

export interface BatchGenerateRequest {
    routerId: string;
    planId: string;
    count: number;
    batchName?: string;
}

export interface HotspotLoginResponse {
    success: boolean;
    message: string;
    session?: HotspotSession;
    redirectUrl?: string;
}

export interface EspCoinInsertResponse {
    success: boolean;
    message: string;
    durationSeconds?: number;
    expiresAt?: string;
    planName?: string;
}
