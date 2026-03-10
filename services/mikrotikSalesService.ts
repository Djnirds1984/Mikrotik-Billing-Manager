import { getAuthHeader } from './databaseService.ts';

const API_BASE_URL = '/api/db';

export interface MikrotikSalesLog {
    id?: string;
    license_id: string;
    router_id: string;
    amount: number;
    currency: string;
    transaction_type: string;
    created_at?: string;
}

export const mikrotikSalesService = {
    // Get mikrotik sales logs
    async getSalesLogs(routerId?: string, licenseId?: string): Promise<MikrotikSalesLog[]> {
        const params = new URLSearchParams();
        if (routerId) params.append('routerId', routerId);
        if (licenseId) params.append('licenseId', licenseId);
        
        const response = await fetch(`${API_BASE_URL}/mikrotik-sales-logs?${params}`, {
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader()
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch mikrotik sales logs: ${response.statusText}`);
        }

        return response.json();
    },

    // Create a new mikrotik sales log
    async createSalesLog(logData: Omit<MikrotikSalesLog, 'id' | 'created_at'>): Promise<MikrotikSalesLog> {
        const response = await fetch(`${API_BASE_URL}/mikrotik-sales-logs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader()
            },
            body: JSON.stringify(logData)
        });

        if (!response.ok) {
            throw new Error(`Failed to create mikrotik sales log: ${response.statusText}`);
        }

        return response.json();
    },

    // Sync a local sale to mikrotik sales logs
    async syncSaleToMikrotik(saleId: string): Promise<{ success: boolean; message: string; data?: MikrotikSalesLog }> {
        const response = await fetch(`${API_BASE_URL}/sales/sync-to-mikrotik`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader()
            },
            body: JSON.stringify({ saleId })
        });

        if (!response.ok) {
            throw new Error(`Failed to sync sale to mikrotik: ${response.statusText}`);
        }

        return response.json();
    }
};