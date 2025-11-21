import { getAuthHeader } from './databaseService.ts';
import type { RouterConfigWithId, SystemInfo, Interface, DhcpClient, PppSecret, PppProfile, PppActiveConnection, HotspotActiveUser, HotspotHost, HotspotProfile, HotspotUserProfile, IpPool, DhcpServer, DhcpLease, Bridge, BridgePort, VlanInterface, IpAddress, IpRoute, WanRoute, FailoverStatus, FirewallRule, SslCertificate, MikroTikFile, MikroTikLogEntry, DhcpClientActionParams, HotspotSetupParams, DhcpServerSetupParams, DhcpCaptivePortalSetupParams, PppSecretData, PppServerData, PppProfileData, HotspotProfileData, HotspotUserProfileData, BridgeData, BridgePortData, IpRouteData, DhcpServerData, FirewallRuleData, PppServer } from '../types.ts';

const BASE_URL = (typeof window !== 'undefined' && window.location.port !== '3000')
    ? `http://${window.location.hostname}:3001/mt-api`
    : '/mt-api';

// Helper for API Calls
const apiCall = async <T>(router: RouterConfigWithId, endpoint: string, method: string = 'GET', body?: any): Promise<T> => {
    const url = `${BASE_URL}/${router.id}/${endpoint.replace(/^\//, '')}`;
    console.log('DEBUG: mikrotikService API call to:', url, 'for router:', router.id);
    const response = await fetch(url, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeader()
        },
        body: body ? JSON.stringify(body) : undefined
    });

    if (response.status === 401) {
        // Handle unauthorized specifically if needed, usually done globally or by auth service
    }

    if (!response.ok) {
        const errData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(errData.message || `API Error: ${response.status}`);
    }
    
    if (response.status === 204) {
        return {} as T;
    }

    return response.json();
};

// --- System & Interfaces ---

export const getSystemInfo = (router: RouterConfigWithId) => apiCall<SystemInfo>(router, 'system/resource/print');

export const getInterfaces = (router: RouterConfigWithId) => apiCall<Interface[]>(router, 'interface/print');

export const getInterfaceStats = (router: RouterConfigWithId) => apiCall<Interface[]>(router, 'interface/stats'); // Special endpoint handling stats

// --- DHCP Clients (Portal) ---

export const getDhcpClients = async (router: RouterConfigWithId): Promise<DhcpClient[]> => {
    // This logic merges DHCP leases and Firewall Address Lists to form a "Client" view
    const [leases, addressLists] = await Promise.all([
        apiCall<any[]>(router, 'ip/dhcp-server/lease/print'),
        apiCall<any[]>(router, 'ip/firewall/address-list/print')
    ]);

    const authorizedList = addressLists.filter((al: any) => al.list === 'authorized-dhcp-users');
    const authorizedAddressListMapByIp = new Map(authorizedList.map((al: any) => [al.address, al]));
    
    const clients: DhcpClient[] = [];

    leases.forEach((lease: any) => {
        const leaseIp = lease.address;
        const leaseMac = lease['mac-address'];

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
                creationTime: addressListEntry['creation-time'],
                comment: addressListEntry.comment
            };
            clients.push(baseClient);
        } else {
             // Pending client (lease exists but not in authorized list)
             clients.push({
                id: lease.id,
                status: 'pending',
                address: leaseIp,
                macAddress: leaseMac,
                hostName: lease['host-name'] || 'N/A',
             });
        }
    });

    return clients;
};

export const updateDhcpClientDetails = (router: RouterConfigWithId, client: DhcpClient, params: DhcpClientActionParams) => {
    // This usually involves updating the address list entry comment or properties
    return apiCall(router, 'ip/firewall/address-list/set', 'POST', {
        '.id': client.id,
        comment: JSON.stringify(params) // Simplified for this example
    });
};

export const deleteDhcpClient = (router: RouterConfigWithId, client: DhcpClient) => {
    // If active, remove from address list. If pending, remove lease? 
    // Implementation depends on backend logic, assuming generic delete on resource
    if (client.status === 'active') {
         return apiCall(router, 'ip/firewall/address-list/remove', 'POST', { '.id': client.id });
    } else {
         return apiCall(router, 'ip/dhcp-server/lease/remove', 'POST', { '.id': client.id });
    }
};

export const runDhcpCaptivePortalSetup = (router: RouterConfigWithId, params: DhcpCaptivePortalSetupParams) => {
    return apiCall<{message: string}>(router, 'script/run-dhcp-portal-setup', 'POST', params);
};

export const runDhcpCaptivePortalUninstall = (router: RouterConfigWithId) => {
    return apiCall<{message: string}>(router, 'script/run-dhcp-portal-uninstall', 'POST');
};


// --- PPPoE ---

export const getPppSecrets = (router: RouterConfigWithId) => apiCall<PppSecret[]>(router, 'ppp/secret/print');
export const addPppSecret = (router: RouterConfigWithId, data: PppSecretData) => apiCall(router, 'ppp/secret/add', 'POST', data);
export const updatePppSecret = (router: RouterConfigWithId, id: string, data: Partial<PppSecretData>) => apiCall(router, 'ppp/secret/set', 'POST', { ...data, '.id': id });
export const deletePppSecret = (router: RouterConfigWithId, id: string) => apiCall(router, 'ppp/secret/remove', 'POST', { '.id': id });

export const getPppActiveConnections = (router: RouterConfigWithId) => apiCall<PppActiveConnection[]>(router, 'ppp/active/print');
export const deletePppActiveConnection = (router: RouterConfigWithId, id: string) => apiCall(router, 'ppp/active/remove', 'POST', { '.id': id });

export const getPppProfiles = (router: RouterConfigWithId) => apiCall<PppProfile[]>(router, 'ppp/profile/print');
export const addPppProfile = (router: RouterConfigWithId, data: PppProfileData) => apiCall(router, 'ppp/profile/add', 'POST', data);
export const updatePppProfile = (router: RouterConfigWithId, data: PppProfile | PppProfileData) => {
    const { id, ...rest } = data as any; 
    return apiCall(router, 'ppp/profile/set', 'POST', { ...rest, '.id': id });
};
export const deletePppProfile = (router: RouterConfigWithId, id: string) => apiCall(router, 'ppp/profile/remove', 'POST', { '.id': id });

export const getPppServers = (router: RouterConfigWithId) => apiCall<PppServer[]>(router, 'interface/pppoe-server/server/print');
export const addPppServer = (router: RouterConfigWithId, data: PppServerData) => apiCall(router, 'interface/pppoe-server/server/add', 'POST', data);
export const updatePppServer = (router: RouterConfigWithId, id: string, data: Partial<PppServerData>) => apiCall(router, 'interface/pppoe-server/server/set', 'POST', { ...data, '.id': id });
export const deletePppServer = (router: RouterConfigWithId, id: string) => apiCall(router, 'interface/pppoe-server/server/remove', 'POST', { '.id': id });

export const processPppPayment = (router: RouterConfigWithId, paymentData: any) => {
    // Logic to enable secret, set comment, etc.
    // This might be a custom script runner or a sequence of updates
    // For simplicity, assuming a backend endpoint handles the logic or we update secret directly
    return apiCall(router, 'ppp/payment/process', 'POST', paymentData); // Hypothetical backend helper
};

export const savePppUser = (router: RouterConfigWithId, data: any) => {
    // Wrapper for complex user saving logic
    return apiCall(router, 'ppp/user/save', 'POST', data);
};


// --- Hotspot ---

export const getHotspotActiveUsers = (router: RouterConfigWithId) => apiCall<HotspotActiveUser[]>(router, 'ip/hotspot/active/print');
export const removeHotspotActiveUser = (router: RouterConfigWithId, id: string) => apiCall(router, 'ip/hotspot/active/remove', 'POST', { '.id': id });

export const getHotspotHosts = (router: RouterConfigWithId) => apiCall<HotspotHost[]>(router, 'ip/hotspot/host/print');

export const getHotspotProfiles = (router: RouterConfigWithId) => apiCall<HotspotProfile[]>(router, 'ip/hotspot/profile/print');
export const addHotspotProfile = (router: RouterConfigWithId, data: HotspotProfileData) => apiCall(router, 'ip/hotspot/profile/add', 'POST', data);
export const updateHotspotProfile = (router: RouterConfigWithId, data: HotspotProfile | HotspotProfileData) => {
     const { id, ...rest } = data as any;
     return apiCall(router, 'ip/hotspot/profile/set', 'POST', { ...rest, '.id': id });
};
export const deleteHotspotProfile = (router: RouterConfigWithId, id: string) => apiCall(router, 'ip/hotspot/profile/remove', 'POST', { '.id': id });

export const getHotspotUserProfiles = (router: RouterConfigWithId) => apiCall<HotspotUserProfile[]>(router, 'ip/hotspot/user/profile/print');
export const addHotspotUserProfile = (router: RouterConfigWithId, data: HotspotUserProfileData) => apiCall(router, 'ip/hotspot/user/profile/add', 'POST', data);
export const updateHotspotUserProfile = (router: RouterConfigWithId, data: HotspotUserProfile | HotspotUserProfileData) => {
    const { id, ...rest } = data as any;
    return apiCall(router, 'ip/hotspot/user/profile/set', 'POST', { ...rest, '.id': id });
};
export const deleteHotspotUserProfile = (router: RouterConfigWithId, id: string) => apiCall(router, 'ip/hotspot/user/profile/remove', 'POST', { '.id': id });

export const runHotspotSetup = (router: RouterConfigWithId, params: HotspotSetupParams) => {
    return apiCall<{message: string}>(router, 'script/run-hotspot-setup', 'POST', params);
};

// --- IP & Network ---

export const getIpPools = (router: RouterConfigWithId) => apiCall<IpPool[]>(router, 'ip/pool/print');
export const addIpPool = (router: RouterConfigWithId, data: Omit<IpPool, 'id'>) => apiCall(router, 'ip/pool/add', 'POST', data);
export const updateIpPool = (router: RouterConfigWithId, id: string, data: Partial<IpPool>) => apiCall(router, 'ip/pool/set', 'POST', { ...data, '.id': id });
export const deleteIpPool = (router: RouterConfigWithId, id: string) => apiCall(router, 'ip/pool/remove', 'POST', { '.id': id });

export const getIpAddresses = (router: RouterConfigWithId) => apiCall<IpAddress[]>(router, 'ip/address/print');

export const getIpRoutes = (router: RouterConfigWithId) => apiCall<IpRoute[]>(router, 'ip/route/print');
export const addIpRoute = (router: RouterConfigWithId, data: IpRouteData) => apiCall(router, 'ip/route/add', 'POST', data);
export const updateIpRoute = (router: RouterConfigWithId, id: string, data: Partial<IpRouteData>) => apiCall(router, 'ip/route/set', 'POST', { ...data, '.id': id });
export const deleteIpRoute = (router: RouterConfigWithId, id: string) => apiCall(router, 'ip/route/remove', 'POST', { '.id': id });

export const getWanRoutes = (router: RouterConfigWithId) => apiCall<WanRoute[]>(router, 'ip/route/print', 'GET'); // Filter logic might be needed on backend or frontend
export const getWanFailoverStatus = (router: RouterConfigWithId) => apiCall<FailoverStatus>(router, 'system/script/wan-failover-status'); // Hypothetical script/check
export const setRouteProperty = (router: RouterConfigWithId, id: string, props: any) => apiCall(router, 'ip/route/set', 'POST', { ...props, '.id': id });
export const configureWanFailover = (router: RouterConfigWithId, enabled: boolean) => apiCall(router, 'system/script/configure-wan-failover', 'POST', { enabled });

export const getVlans = (router: RouterConfigWithId) => apiCall<VlanInterface[]>(router, 'interface/vlan/print');
export const addVlan = (router: RouterConfigWithId, data: any) => apiCall(router, 'interface/vlan/add', 'POST', data);
export const deleteVlan = (router: RouterConfigWithId, id: string) => apiCall(router, 'interface/vlan/remove', 'POST', { '.id': id });

// --- Bridge ---

export const getBridges = (router: RouterConfigWithId) => apiCall<Bridge[]>(router, 'interface/bridge/print');
export const addBridge = (router: RouterConfigWithId, data: BridgeData) => apiCall(router, 'interface/bridge/add', 'POST', data);
export const updateBridge = (router: RouterConfigWithId, id: string, data: BridgeData) => apiCall(router, 'interface/bridge/set', 'POST', { ...data, '.id': id });
export const deleteBridge = (router: RouterConfigWithId, id: string) => apiCall(router, 'interface/bridge/remove', 'POST', { '.id': id });

export const getBridgePorts = (router: RouterConfigWithId) => apiCall<BridgePort[]>(router, 'interface/bridge/port/print');
export const addBridgePort = (router: RouterConfigWithId, data: BridgePortData) => apiCall(router, 'interface/bridge/port/add', 'POST', data);
export const deleteBridgePort = (router: RouterConfigWithId, id: string) => apiCall(router, 'interface/bridge/port/remove', 'POST', { '.id': id });


// --- DHCP Server ---

export const getDhcpServers = (router: RouterConfigWithId) => apiCall<DhcpServer[]>(router, 'ip/dhcp-server/print');
export const addDhcpServer = (router: RouterConfigWithId, data: DhcpServerData) => apiCall(router, 'ip/dhcp-server/add', 'POST', data);
export const updateDhcpServer = (router: RouterConfigWithId, id: string, data: DhcpServerData) => apiCall(router, 'ip/dhcp-server/set', 'POST', { ...data, '.id': id });
export const deleteDhcpServer = (router: RouterConfigWithId, id: string) => apiCall(router, 'ip/dhcp-server/remove', 'POST', { '.id': id });

export const getDhcpLeases = (router: RouterConfigWithId) => apiCall<DhcpLease[]>(router, 'ip/dhcp-server/lease/print');
export const makeLeaseStatic = (router: RouterConfigWithId, id: string) => apiCall(router, 'ip/dhcp-server/lease/make-static', 'POST', { '.id': id });
export const deleteDhcpLease = (router: RouterConfigWithId, id: string) => apiCall(router, 'ip/dhcp-server/lease/remove', 'POST', { '.id': id });

export const runDhcpSetup = (router: RouterConfigWithId, params: DhcpServerSetupParams) => apiCall(router, 'script/run-dhcp-setup', 'POST', params);

// --- Firewall ---

export const getFirewallFilter = (router: RouterConfigWithId) => apiCall<FirewallRule[]>(router, 'ip/firewall/filter/print');
export const addFirewallFilter = (router: RouterConfigWithId, data: FirewallRuleData) => apiCall(router, 'ip/firewall/filter/add', 'POST', data);
export const updateFirewallFilter = (router: RouterConfigWithId, id: string, data: FirewallRuleData) => apiCall(router, 'ip/firewall/filter/set', 'POST', { ...data, '.id': id });
export const deleteFirewallFilter = (router: RouterConfigWithId, id: string) => apiCall(router, 'ip/firewall/filter/remove', 'POST', { '.id': id });

export const getFirewallNat = (router: RouterConfigWithId) => apiCall<FirewallRule[]>(router, 'ip/firewall/nat/print');
export const addFirewallNat = (router: RouterConfigWithId, data: FirewallRuleData) => apiCall(router, 'ip/firewall/nat/add', 'POST', data);
export const updateFirewallNat = (router: RouterConfigWithId, id: string, data: FirewallRuleData) => apiCall(router, 'ip/firewall/nat/set', 'POST', { ...data, '.id': id });
export const deleteFirewallNat = (router: RouterConfigWithId, id: string) => apiCall(router, 'ip/firewall/nat/remove', 'POST', { '.id': id });

export const getFirewallMangle = (router: RouterConfigWithId) => apiCall<FirewallRule[]>(router, 'ip/firewall/mangle/print');
export const addFirewallMangle = (router: RouterConfigWithId, data: FirewallRuleData) => apiCall(router, 'ip/firewall/mangle/add', 'POST', data);
export const updateFirewallMangle = (router: RouterConfigWithId, id: string, data: FirewallRuleData) => apiCall(router, 'ip/firewall/mangle/set', 'POST', { ...data, '.id': id });
export const deleteFirewallMangle = (router: RouterConfigWithId, id: string) => apiCall(router, 'ip/firewall/mangle/remove', 'POST', { '.id': id });

// --- Files & Logs ---

export const listFiles = (router: RouterConfigWithId) => apiCall<MikroTikFile[]>(router, 'file/print');
export const getFileContent = (router: RouterConfigWithId, id: string) => apiCall<{contents: string}>(router, 'file/get-content', 'POST', { '.id': id });
export const saveFileContent = (router: RouterConfigWithId, id: string, contents: string) => apiCall(router, 'file/set', 'POST', { '.id': id, contents });
export const createFile = (router: RouterConfigWithId, name: string, contents: string) => apiCall(router, 'file/add', 'POST', { name, contents });

export const getRouterLogs = (router: RouterConfigWithId) => apiCall<MikroTikLogEntry[]>(router, 'log/print');

// --- Misc ---

export const getSslCertificates = (router: RouterConfigWithId) => apiCall<SslCertificate[]>(router, 'certificate/print');
export const testRouterConnection = (config: any) => apiCall<{success: boolean, message: string}>({ id: 'test', ...config }, 'test-connection', 'POST');
