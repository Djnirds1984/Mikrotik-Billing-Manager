import type {
    RouterConfig,
    RouterConfigWithId,
    SystemInfo,
    Interface,
    PppProfile,
    PppProfileData,
    IpPool,
    PppSecret,
    PppSecretData,
    PppActiveConnection,
    HotspotActiveUser,
    HotspotHost,
    HotspotProfile,
    HotspotProfileData,
    HotspotUserProfile,
    HotspotUserProfileData,
    NtpSettings,
    VlanInterface,
    IpAddress,
    IpRoute,
    IpRouteData,
    WanRoute,
    FailoverStatus,
    FirewallFilterRule,
    FirewallNatRule,
    FirewallMangleRule,
    FirewallRuleData,
    SslCertificate,
    HotspotSetupParams,
    PppServer,
    PppServerData,
    FirewallRule,
    MikroTikLogEntry,
    MikroTikFile,
    DhcpServer,
    DhcpServerData,
    DhcpLease,
    DhcpServerSetupParams,
    DhcpCaptivePortalSetupParams,
    // FIX: Add missing type imports for DHCP Captive Portal
    DhcpClient,
    DhcpClientActionParams,
    SimpleQueue,
    SimpleQueueData
} from '../types.ts';
import { getAuthHeader } from './databaseService.ts';

type RuleType = 'filter' | 'nat' | 'mangle';

// A generic fetcher for MikroTik API calls
const fetchMikrotikData = async <T>(router: RouterConfig, path: string, options: RequestInit = {}): Promise<T> => {
    // Use a relative URL to allow for reverse proxying (e.g., via Nginx)
    const apiBaseUrl = `/mt-api`;
    
    const fullPath = 'id' in router ? `${apiBaseUrl}/${(router as RouterConfigWithId).id}${path}` : `${apiBaseUrl}${path}`;

    const response = await fetch(fullPath, {
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
            const textError = await response.text();
            if (textError) errorMsg = textError;
        }
        throw new Error(errorMsg);
    }
    
    if (response.status === 204) { // No Content
        return {} as T;
    }

    if (contentType && contentType.includes("application/json")) {
        return response.json() as Promise<T>;
    }
    return response.text() as unknown as Promise<T>;
};

// --- Test Connection ---
export const testRouterConnection = (routerConfig: RouterConfig): Promise<{ success: boolean, message: string }> => {
    return fetchMikrotikData<{ success: boolean, message: string }>(routerConfig, '/test-connection', {
        method: 'POST',
        body: JSON.stringify(routerConfig),
    });
};

// --- System Info ---
export const getSystemInfo = (router: RouterConfigWithId): Promise<SystemInfo> => {
    return fetchMikrotikData<SystemInfo>(router, '/system/resource');
};

export const rebootRouter = (router: RouterConfigWithId): Promise<{ message: string }> => {
    return fetchMikrotikData<{ message: string }>(router, '/system/reboot', { method: 'POST' });
};

export const syncTimeToRouter = (router: RouterConfigWithId): Promise<{ message: string }> => {
    return fetchMikrotikData<{ message: string }>(router, '/system/clock/sync', { method: 'POST' });
};

// --- Interfaces & IPs ---
export const getInterfaces = (router: RouterConfigWithId): Promise<Interface[]> => {
    return fetchMikrotikData<Interface[]>(router, '/interface');
};

export const getIpAddresses = (router: RouterConfigWithId): Promise<IpAddress[]> => {
    return fetchMikrotikData<IpAddress[]>(router, '/ip/address');
};

export const getVlans = (router: RouterConfigWithId): Promise<VlanInterface[]> => {
    return fetchMikrotikData<VlanInterface[]>(router, '/interface/vlan');
};

export const addVlan = (router: RouterConfigWithId, vlanData: Omit<VlanInterface, 'id'>): Promise<any> => {
    return fetchMikrotikData(router, '/interface/vlan', {
        method: 'PUT',
        body: JSON.stringify(vlanData),
    });
};

export const deleteVlan = (router: RouterConfigWithId, vlanId: string): Promise<any> => {
    return fetchMikrotikData(router, `/interface/vlan/${encodeURIComponent(vlanId)}`, {
        method: 'DELETE',
    });
};

// --- IP Routes & WAN ---
export const getIpRoutes = (router: RouterConfigWithId): Promise<IpRoute[]> => {
    return fetchMikrotikData<IpRoute[]>(router, '/ip/route');
};

export const addIpRoute = (router: RouterConfigWithId, routeData: IpRouteData): Promise<any> => {
    return fetchMikrotikData(router, '/ip/route', {
        method: 'PUT',
        body: JSON.stringify(routeData),
    });
};

export const updateIpRoute = (router: RouterConfigWithId, routeId: string, routeData: Partial<IpRouteData>): Promise<any> => {
    return fetchMikrotikData(router, `/ip/route/${encodeURIComponent(routeId)}`, {
        method: 'PATCH',
        body: JSON.stringify(routeData),
    });
};

export const deleteIpRoute = (router: RouterConfigWithId, routeId: string): Promise<any> => {
    return fetchMikrotikData(router, `/ip/route/${encodeURIComponent(routeId)}`, {
        method: 'DELETE',
    });
};

export const getWanRoutes = (router: RouterConfigWithId): Promise<WanRoute[]> => {
    return fetchMikrotikData<WanRoute[]>(router, '/ip/wan-routes');
};

export const setRouteProperty = (router: RouterConfigWithId, routeId: string, properties: Partial<{ disabled: 'true' | 'false' }>): Promise<any> => {
    return fetchMikrotikData(router, `/ip/route/${encodeURIComponent(routeId)}`, {
        method: 'PATCH',
        body: JSON.stringify(properties),
    });
};

export const getWanFailoverStatus = (router: RouterConfigWithId): Promise<FailoverStatus> => {
    return fetchMikrotikData<FailoverStatus>(router, '/ip/wan-failover-status');
};

export const configureWanFailover = (router: RouterConfigWithId, enabled: boolean): Promise<any> => {
    return fetchMikrotikData(router, '/ip/wan-failover', {
        method: 'POST',
        body: JSON.stringify({ enabled }),
    });
};



// --- PPP ---
export const getPppProfiles = (router: RouterConfigWithId): Promise<PppProfile[]> => {
    return fetchMikrotikData<PppProfile[]>(router, '/ppp/profile');
};

export const addPppProfile = (router: RouterConfigWithId, profileData: PppProfileData): Promise<any> => {
    return fetchMikrotikData(router, '/ppp/profile', { method: 'PUT', body: JSON.stringify(profileData) });
};

export const updatePppProfile = (router: RouterConfigWithId, profileData: PppProfile): Promise<any> => {
    const { id, ...dataToSend } = profileData as any;
    delete dataToSend['.id'];
    return fetchMikrotikData(router, `/ppp/profile/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(dataToSend) });
};

export const deletePppProfile = (router: RouterConfigWithId, profileId: string): Promise<any> => {
    return fetchMikrotikData(router, `/ppp/profile/${encodeURIComponent(profileId)}`, { method: 'DELETE' });
};

export const getIpPools = (router: RouterConfigWithId): Promise<IpPool[]> => {
    return fetchMikrotikData<IpPool[]>(router, '/ip/pool');
};

export const addIpPool = (router: RouterConfigWithId, poolData: Omit<IpPool, 'id'>): Promise<any> => {
    return fetchMikrotikData(router, '/ip/pool', {
        method: 'PUT',
        body: JSON.stringify(poolData),
    });
};

export const updateIpPool = (router: RouterConfigWithId, poolId: string, poolData: Partial<Omit<IpPool, 'id'>>): Promise<any> => {
    return fetchMikrotikData(router, `/ip/pool/${encodeURIComponent(poolId)}`, {
        method: 'PATCH',
        body: JSON.stringify(poolData),
    });
};

export const deleteIpPool = (router: RouterConfigWithId, poolId: string): Promise<any> => {
    return fetchMikrotikData(router, `/ip/pool/${encodeURIComponent(poolId)}`, {
        method: 'DELETE',
    });
};

export const getPppSecrets = (router: RouterConfigWithId): Promise<PppSecret[]> => {
    return fetchMikrotikData<PppSecret[]>(router, '/ppp/secret');
};

export const addPppSecret = (router: RouterConfigWithId, secretData: PppSecretData): Promise<any> => {
    return fetchMikrotikData(router, '/ppp/secret', { method: 'PUT', body: JSON.stringify(secretData) });
};

export const updatePppSecret = (router: RouterConfigWithId, secretData: PppSecret): Promise<any> => {
    const { id, 'last-logged-out': lastLoggedOut, name, ...dataToSend } = secretData as any;
    delete dataToSend['.id'];
    delete dataToSend.isActive;
    delete dataToSend.activeInfo;
    delete dataToSend.customer;
    delete dataToSend.subscription;
    return fetchMikrotikData(router, `/ppp/secret/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(dataToSend) });
};

export const deletePppSecret = (router: RouterConfigWithId, secretId: string): Promise<any> => {
    return fetchMikrotikData(router, `/ppp/secret/${encodeURIComponent(secretId)}`, { method: 'DELETE' });
};

export const getPppActiveConnections = (router: RouterConfigWithId): Promise<PppActiveConnection[]> => {
    return fetchMikrotikData<PppActiveConnection[]>(router, '/ppp/active');
};

export const processPppPayment = (router: RouterConfigWithId, paymentData: any): Promise<any> => {
    return fetchMikrotikData(router, '/ppp/process-payment', { method: 'POST', body: JSON.stringify(paymentData) });
};

export const getPppServers = (router: RouterConfigWithId): Promise<PppServer[]> => {
    return fetchMikrotikData<PppServer[]>(router, '/interface/pppoe-server/server');
};

export const addPppServer = (router: RouterConfigWithId, serverData: PppServerData): Promise<any> => {
    return fetchMikrotikData(router, '/interface/pppoe-server/server', { method: 'PUT', body: JSON.stringify(serverData) });
};

export const updatePppServer = (router: RouterConfigWithId, serverId: string, serverData: Partial<PppServerData>): Promise<any> => {
    return fetchMikrotikData(router, `/interface/pppoe-server/server/${encodeURIComponent(serverId)}`, { method: 'PATCH', body: JSON.stringify(serverData) });
};

export const deletePppServer = (router: RouterConfigWithId, serverId: string): Promise<any> => {
    return fetchMikrotikData(router, `/interface/pppoe-server/server/${encodeURIComponent(serverId)}`, { method: 'DELETE' });
};

// --- Hotspot ---
export const getHotspotActiveUsers = (router: RouterConfigWithId): Promise<HotspotActiveUser[]> => {
    return fetchMikrotikData<HotspotActiveUser[]>(router, '/ip/hotspot/active');
};

export const removeHotspotActiveUser = (router: RouterConfigWithId, userId: string): Promise<any> => {
    return fetchMikrotikData(router, `/ip/hotspot/active/${encodeURIComponent(userId)}`, { method: 'DELETE' });
};

export const getHotspotHosts = (router: RouterConfigWithId): Promise<HotspotHost[]> => {
    return fetchMikrotikData<HotspotHost[]>(router, '/ip/hotspot/host');
};

export const getHotspotProfiles = (router: RouterConfigWithId): Promise<HotspotProfile[]> => {
    return fetchMikrotikData<HotspotProfile[]>(router, '/ip/hotspot/profile');
};
export const addHotspotProfile = (router: RouterConfigWithId, profileData: HotspotProfileData): Promise<any> => {
    return fetchMikrotikData(router, '/ip/hotspot/profile', { method: 'PUT', body: JSON.stringify(profileData) });
};
export const updateHotspotProfile = (router: RouterConfigWithId, profile: HotspotProfile): Promise<any> => {
    const { id, ...dataToSend } = profile as any;
    delete dataToSend['.id'];
    return fetchMikrotikData(router, `/ip/hotspot/profile/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(dataToSend) });
};
export const deleteHotspotProfile = (router: RouterConfigWithId, profileId: string): Promise<any> => {
    return fetchMikrotikData(router, `/ip/hotspot/profile/${encodeURIComponent(profileId)}`, { method: 'DELETE' });
};

export const getHotspotUserProfiles = (router: RouterConfigWithId): Promise<HotspotUserProfile[]> => {
    return fetchMikrotikData<HotspotUserProfile[]>(router, '/ip/hotspot/user/profile');
};
export const addHotspotUserProfile = (router: RouterConfigWithId, profileData: HotspotUserProfileData): Promise<any> => {
    return fetchMikrotikData(router, '/ip/hotspot/user/profile', { method: 'PUT', body: JSON.stringify(profileData) });
};
export const updateHotspotUserProfile = (router: RouterConfigWithId, profile: HotspotUserProfile): Promise<any> => {
    const { id, ...dataToSend } = profile as any;
    delete dataToSend['.id'];
    return fetchMikrotikData(router, `/ip/hotspot/user/profile/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(dataToSend) });
};
export const deleteHotspotUserProfile = (router: RouterConfigWithId, profileId: string): Promise<any> => {
    return fetchMikrotikData(router, `/ip/hotspot/user/profile/${encodeURIComponent(profileId)}`, { method: 'DELETE' });
};

export const getSslCertificates = (router: RouterConfigWithId): Promise<SslCertificate[]> => {
    return fetchMikrotikData<SslCertificate[]>(router, '/certificate');
};

export const runHotspotSetup = (router: RouterConfigWithId, params: HotspotSetupParams): Promise<{ message: string }> => {
    return fetchMikrotikData(router, '/hotspot/setup', { method: 'POST', body: JSON.stringify(params) });
};

export const runPanelHotspotSetup = (router: RouterConfigWithId): Promise<{ message: string }> => {
    const panelHostname = window.location.hostname;
    return fetchMikrotikData(router, '/hotspot/panel-setup', {
        method: 'POST',
        body: JSON.stringify({ panelHostname }),
    });
};

// --- DHCP ---
export const getDhcpServers = (router: RouterConfigWithId): Promise<DhcpServer[]> => {
    return fetchMikrotikData<DhcpServer[]>(router, '/ip/dhcp-server');
};
export const addDhcpServer = (router: RouterConfigWithId, serverData: DhcpServerData): Promise<any> => {
    return fetchMikrotikData(router, '/ip/dhcp-server', { method: 'PUT', body: JSON.stringify(serverData) });
};
export const updateDhcpServer = (router: RouterConfigWithId, serverId: string, serverData: Partial<DhcpServerData>): Promise<any> => {
    return fetchMikrotikData(router, `/ip/dhcp-server/${encodeURIComponent(serverId)}`, { method: 'PATCH', body: JSON.stringify(serverData) });
};
export const deleteDhcpServer = (router: RouterConfigWithId, serverId: string): Promise<any> => {
    return fetchMikrotikData(router, `/ip/dhcp-server/${encodeURIComponent(serverId)}`, { method: 'DELETE' });
};
export const getDhcpLeases = (router: RouterConfigWithId): Promise<DhcpLease[]> => {
    return fetchMikrotikData<DhcpLease[]>(router, '/ip/dhcp-server/lease');
};
export const makeLeaseStatic = (router: RouterConfigWithId, leaseId: string): Promise<any> => {
    return fetchMikrotikData(router, `/ip/dhcp-server/lease/${encodeURIComponent(leaseId)}/make-static`, { method: 'POST', body: '{}' });
};
export const deleteDhcpLease = (router: RouterConfigWithId, leaseId: string): Promise<any> => {
    return fetchMikrotikData(router, `/ip/dhcp-server/lease/${encodeURIComponent(leaseId)}`, { method: 'DELETE' });
};
export const runDhcpSetup = (router: RouterConfigWithId, params: DhcpServerSetupParams): Promise<{ message: string }> => {
    return fetchMikrotikData(router, '/ip/dhcp-server/setup', { method: 'POST', body: JSON.stringify(params) });
};
export const runDhcpCaptivePortalSetup = (router: RouterConfigWithId, params: DhcpCaptivePortalSetupParams): Promise<{ message: string }> => {
    return fetchMikrotikData(router, '/dhcp-captive-portal/setup', { 
        method: 'POST', 
        body: JSON.stringify(params) 
    });
};

export const runDhcpCaptivePortalUninstall = (router: RouterConfigWithId): Promise<{ message: string }> => {
    return fetchMikrotikData(router, '/dhcp-captive-portal/uninstall', { 
        method: 'POST', 
    });
};

// FIX: Add functions for DHCP Captive Portal client management
// --- DHCP Captive Portal Client Management ---

const calculateTimeout = (expiresAt: string): string => {
    const expiryDate = new Date(expiresAt);
    const now = new Date();
    const diffSeconds = Math.round((expiryDate.getTime() - now.getTime()) / 1000);
    if (diffSeconds <= 0) return '1s'; // Expire almost immediately
    
    const days = Math.floor(diffSeconds / 86400);
    const hours = Math.floor((diffSeconds % 86400) / 3600);
    const minutes = Math.floor((diffSeconds % 3600) / 60);
    const seconds = diffSeconds % 60;
    
    let timeoutStr = '';
    if (days > 0) timeoutStr += `${days}d`;
    if (hours > 0) timeoutStr += `${hours}h`;
    if (minutes > 0) timeoutStr += `${minutes}m`;
    if (seconds > 0) timeoutStr += `${seconds}s`;

    return timeoutStr || '1s';
};

export const getDhcpClients = async (router: RouterConfigWithId): Promise<DhcpClient[]> => {
    // 1. Fetch all required data in parallel
    const [leases, addressLists] = await Promise.all([
        fetchMikrotikData<DhcpLease[]>(router, '/ip/dhcp-server/lease'),
        fetchMikrotikData<any[]>(router, '/ip/firewall/address-list')
    ]);

    const authorizedListName = "authorized-dhcp-users";
    const pendingListName = "pending-dhcp-users";

    // 2. Create lookup maps for efficient processing
    const authorizedAddressListMapByIp = new Map<string, any>();
    const pendingAddressListMapByMac = new Map<string, any>();

    for (const item of addressLists) {
        if (item.list === authorizedListName && item.address) {
            authorizedAddressListMapByIp.set(item.address, item);
        } else if (item.list === pendingListName && item.comment) {
            // Pending list uses MAC in comment
            pendingAddressListMapByMac.set(item.comment, item);
        }
    }

    const clients: DhcpClient[] = [];
    const processedMacs = new Set<string>();

    // 3. Iterate through DHCP leases as the primary source of truth
    for (const lease of leases) {
        const leaseIp = lease.address;
        const leaseMac = lease['mac-address'];

        // Skip invalid leases or already processed devices
        if (!leaseMac || leaseIp === '0.0.0.0' || processedMacs.has(leaseMac)) {
            continue;
        }

        if (authorizedAddressListMapByIp.has(leaseIp)) {
            // --- This is an ACTIVE client ---
            const addressListEntry = authorizedAddressListMapByIp.get(leaseIp)!;
            
            const baseClient: DhcpClient = {
                id: addressListEntry.id,
                status: 'active',
                address: leaseIp,
                macAddress: leaseMac,
                hostName: lease['host-name'] || 'N/A',
                customerInfo: '', // Default value
                timeout: addressListEntry.timeout,
                creationTime: addressListEntry['creation-time']
            };

            try {
                // Try to parse rich data from the comment
                const parsedComment = JSON.parse(addressListEntry.comment);
                clients.push({
                    ...baseClient,
                    customerInfo: parsedComment.customerInfo || '',
                    contactNumber: parsedComment.contactNumber || '',
                    email: parsedComment.email || '',
                    speedLimit: parsedComment.speedLimit || '',
                });
            } catch (e) {
                // If comment is not JSON, treat it as a simple string
                clients.push({
                    ...baseClient,
                    customerInfo: addressListEntry.comment || '',
                });
            }

        } else {
            // --- This is a PENDING client ---
            // It has a valid lease but is not in the authorized list.
            const pendingEntry = pendingAddressListMapByMac.get(leaseMac);

            clients.push({
                // The ID must come from the address-list to perform actions on it.
                // If the script hasn't run yet, pendingEntry might not exist.
                // We use the lease ID as a stable fallback key if needed.
                id: pendingEntry?.id || `lease_${lease.id}`, 
                status: 'pending',
                address: leaseIp,
                macAddress: leaseMac,
                hostName: lease['host-name'] || 'N/A',
                customerInfo: 'N/A',
                timeout: pendingEntry?.timeout,
                creationTime: pendingEntry?.['creation-time']
            });
        }
        
        processedMacs.add(leaseMac);
    }

    return clients;
};


export const activateDhcpClient = async (router: RouterConfigWithId, params: DhcpClientActionParams): Promise<any> => {
    // 1. Make lease static
    const leases = await getDhcpLeases(router);
    const leaseToMakeStatic = leases.find(l => l['mac-address'] === params.macAddress && l.dynamic === 'true');
    if (leaseToMakeStatic) {
        try {
            await makeLeaseStatic(router, leaseToMakeStatic.id);
        } catch (e) {
            console.warn(`Could not make lease static for ${params.macAddress}, but proceeding with activation. Error:`, (e as Error).message);
        }
    }

    // 2. Add/update simple queue if speed limit is provided
    const speed = params.speedLimit && !isNaN(parseFloat(params.speedLimit)) ? parseFloat(params.speedLimit) : 0;
    const queueName = `dhcp-${params.address}`;
    const queues = await getSimpleQueues(router);
    const existingQueue = queues.find(q => q.name === queueName);

    if (speed > 0) {
        const queueData = {
            target: params.address,
            'max-limit': `${params.speedLimit}M/${params.speedLimit}M`,
            comment: `Managed by panel for ${params.customerInfo}`
        };
        if (existingQueue) {
            await updateSimpleQueue(router, existingQueue.id, queueData);
        } else {
            await addSimpleQueue(router, { name: queueName, ...queueData });
        }
    } else if (existingQueue) {
        // If speed is set to 0 or empty, remove the queue
        await deleteSimpleQueue(router, existingQueue.id);
    }

    // 3. Robustly find the address list entry ID to modify.
    // The MAC is stored in the comment of the pending list.
    const addressLists = await fetchMikrotikData<any[]>(router, '/ip/firewall/address-list');
    const pendingEntry = addressLists.find(item => item.list === 'pending-dhcp-users' && item.comment === params.macAddress);
    
    const commentData = {
        customerInfo: params.customerInfo,
        contactNumber: params.contactNumber,
        email: params.email,
        speedLimit: params.speedLimit
    };

    const payload = {
        list: 'authorized-dhcp-users',
        comment: JSON.stringify(commentData),
        timeout: calculateTimeout(params.expiresAt),
        address: params.address
    };

    if (pendingEntry) {
        // An entry exists in the pending list. PATCH it to move it to authorized.
        return fetchMikrotikData(router, `/ip/firewall/address-list/${encodeURIComponent(pendingEntry.id)}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
        });
    } else {
        // No pending entry found. This can happen if the UI loaded before the DHCP script ran.
        // In this case, we CREATE a new entry directly in the authorized list using PUT.
        return fetchMikrotikData(router, `/ip/firewall/address-list`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
    }
};

export const updateDhcpClient = async (router: RouterConfigWithId, params: DhcpClientActionParams): Promise<any> => {
    // 1. Manage simple queue
    const queues = await getSimpleQueues(router);
    const queueName = `dhcp-${params.address}`;
    const existingQueue = queues.find(q => q.name === queueName);
    const speed = params.speedLimit && !isNaN(parseFloat(params.speedLimit)) ? parseFloat(params.speedLimit) : 0;

    if (speed > 0) {
        const queueData = {
            'max-limit': `${speed}M/${speed}M`,
            comment: `Managed by panel for ${params.customerInfo}`
        };
        if (existingQueue) {
            // Update existing queue
            await updateSimpleQueue(router, existingQueue.id, queueData);
        } else {
            // Create new queue
            await addSimpleQueue(router, {
                name: queueName,
                target: params.address,
                ...queueData
            });
        }
    } else if (existingQueue) {
        // Speed is 0 or invalid, remove the queue if it exists
        await deleteSimpleQueue(router, existingQueue.id);
    }
    
    // 2. Update address list entry
    const commentData = {
        customerInfo: params.customerInfo,
        contactNumber: params.contactNumber,
        email: params.email,
        speedLimit: params.speedLimit
    };
    
    return fetchMikrotikData(router, `/ip/firewall/address-list/${encodeURIComponent(params.addressListId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
            comment: JSON.stringify(commentData),
            timeout: calculateTimeout(params.expiresAt)
        })
    });
};

export const deleteDhcpClient = (router: RouterConfigWithId, addressListId: string): Promise<any> => {
    // If the ID is a lease fallback, we can't delete it directly. This action should only work for actual address list entries.
    if (addressListId.startsWith('lease_')) {
        return Promise.reject(new Error('Cannot delete client that does not have a firewall entry yet.'));
    }
    return fetchMikrotikData(router, `/ip/firewall/address-list/${encodeURIComponent(addressListId)}`, {
        method: 'DELETE'
    });
};


// --- Firewall ---
const firewallApi = <T extends FirewallRule, U extends FirewallRuleData>(type: RuleType) => ({
    get: (router: RouterConfigWithId): Promise<T[]> => fetchMikrotikData<T[]>(router, `/ip/firewall/${type}`),
    add: (router: RouterConfigWithId, data: U): Promise<any> => fetchMikrotikData(router, `/ip/firewall/${type}`, { method: 'PUT', body: JSON.stringify(data) }),
    update: (router: RouterConfigWithId, id: string, data: U): Promise<any> => fetchMikrotikData(router, `/ip/firewall/${type}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (router: RouterConfigWithId, id: string): Promise<any> => fetchMikrotikData(router, `/ip/firewall/${type}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
});

export const { get: getFirewallFilter, add: addFirewallFilter, update: updateFirewallFilter, delete: deleteFirewallFilter } = firewallApi<FirewallFilterRule, FirewallRuleData>('filter');
export const { get: getFirewallNat, add: addFirewallNat, update: updateFirewallNat, delete: deleteFirewallNat } = firewallApi<FirewallNatRule, FirewallRuleData>('nat');
export const { get: getFirewallMangle, add: addFirewallMangle, update: updateFirewallMangle, delete: deleteFirewallMangle } = firewallApi<FirewallMangleRule, FirewallRuleData>('mangle');

// --- Simple Queues ---
const simpleQueueApi = <T extends SimpleQueue, U extends SimpleQueueData>(path: string) => ({
    get: (router: RouterConfigWithId): Promise<T[]> => fetchMikrotikData<T[]>(router, path),
    add: (router: RouterConfigWithId, data: U): Promise<any> => fetchMikrotikData(router, path, { method: 'PUT', body: JSON.stringify(data) }),
    update: (router: RouterConfigWithId, id: string, data: Partial<U>): Promise<any> => fetchMikrotikData(router, `${path}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (router: RouterConfigWithId, id: string): Promise<any> => fetchMikrotikData(router, `${path}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
});

export const { get: getSimpleQueues, add: addSimpleQueue, update: updateSimpleQueue, delete: deleteSimpleQueue } = simpleQueueApi<SimpleQueue, SimpleQueueData>('/queue/simple');


// --- Logs ---
export const getRouterLogs = (router: RouterConfigWithId): Promise<MikroTikLogEntry[]> => {
    return fetchMikrotikData<MikroTikLogEntry[]>(router, '/log');
};

// --- Files ---
export const listFiles = (router: RouterConfigWithId): Promise<MikroTikFile[]> => {
    return fetchMikrotikData<MikroTikFile[]>(router, '/file');
};

export const getFileContent = async (router: RouterConfigWithId, fileId: string): Promise<{ contents: string }> => {
    // The path needs to be different for legacy vs REST APIs.
    // REST (v7+) uses `?=.id=...`
    // Legacy (v6) via node-routeros needs `?.id=...` which is achieved by passing `.id` as a query parameter key.
    const path = router.api_type === 'legacy'
        ? `/file?.id=${encodeURIComponent(fileId)}&.proplist=contents`
        : `/file?=.id=${encodeURIComponent(fileId)}&.proplist=contents`;
        
    // The response can sometimes be a single object instead of an array when filtering by ID.
    const response = await fetchMikrotikData<any | any[]>(router, path, {
        method: 'GET',
    });

    const fileObject = Array.isArray(response) ? response[0] : response;

    if (fileObject && typeof fileObject.contents !== 'undefined') {
        return { contents: fileObject.contents };
    }
    // Handle cases where the file is empty or the property is missing
    return { contents: '' };
};

export const saveFileContent = (router: RouterConfigWithId, fileId: string, content: string): Promise<any> => {
    // Some RouterOS versions handle POST better than PATCH for updating file contents.
    // This uses POST as a more compatible "set" operation.
    return fetchMikrotikData(router, `/file/${encodeURIComponent(fileId)}`, {
        method: 'POST', 
        body: JSON.stringify({ contents: content }) 
    });
};

export const createFile = (router: RouterConfigWithId, name: string, content: string): Promise<any> => {
    // POST is the correct verb for creating a new resource where the server assigns the ID.
    // For files, the 'name' property acts as the identifier on creation.
    return fetchMikrotikData(router, '/file', { 
        method: 'POST', 
        body: JSON.stringify({ name, contents: content }) 
    });
};