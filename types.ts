import React from 'react';

export type View =
  | 'dashboard'
  | 'scripting'
  | 'routers'
  | 'network'
  | 'terminal'
  | 'pppoe'
  | 'users'
  | 'billing'
  | 'sales'
  | 'inventory'
  | 'hotspot'
  | 'zerotier'
  | 'company'
  | 'system'
  | 'updater'
  | 'super_router'
  | 'logs'
  | 'panel_roles'
  | 'help'
  | 'mikrotik_files'
  | 'license'
  | 'super_admin'
  | 'dhcp-portal'
  | 'notifications';

export interface Notification {
  id: string;
  type: 'pppoe-expired' | 'client-chat' | 'info';
  message: string;
  is_read: 0 | 1;
  timestamp: string; // ISO string
  link_to?: View;
  context_json?: string; // JSON string for context data
}

export interface LicenseStatus {
  licensed: boolean;
  expires?: string;
  deviceId?: string;
  licenseKey?: string;
  // FIX: Add optional error property to match potential API responses.
  error?: string;
}

export interface RouterConfig {
  name: string;
  host: string;
  user: string;
  password?: string;
  port: number;
  api_type?: 'rest' | 'legacy';
}

export interface RouterConfigWithId extends RouterConfig {
  id: string;
}

export interface SystemInfo {
  boardName: string;
  version: string;
  cpuLoad: number;
  uptime: string;
  memoryUsage: number;
  totalMemory: string;
}

export interface Interface {
  id: string;
  name: string;
  type: string;
  rxRate: number;
  txRate: number;
  'rx-byte'?: number;
  'tx-byte'?: number;
}

export interface TrafficHistoryPoint {
  name: string;
  rx: number;
  tx: number;
}

export interface InterfaceWithHistory extends Interface {
  trafficHistory: TrafficHistoryPoint[];
}

export interface HotspotActiveUser {
  id: string;
  user: string;
  address: string;
  macAddress: string;
  uptime: string;
  bytesIn: number;
  bytesOut: number;
  comment: string;
}

export interface HotspotHost {
    id: string;
    macAddress: string;
    address: string;
    toAddress: string;
    authorized: boolean;
    bypassed: boolean;
    comment?: string;
}

export interface HotspotProfile {
    id: string;
    name: string;
    'hotspot-address'?: string;
    'dns-name'?: string;
    'html-directory'?: string;
    'rate-limit'?: string;
    'login-by'?: string;
}

export type HotspotProfileData = Omit<HotspotProfile, 'id'>;

export interface HotspotUserProfile {
    id: string;
    name: string;
    'rate-limit'?: string;
    'session-timeout'?: string;
    'shared-users'?: string;
    'address-pool'?: string;
}

export type HotspotUserProfileData = Omit<HotspotUserProfile, 'id'>;


export interface PppProfile {
    id: string;
    name: string;
    'local-address'?: string;
    'remote-address'?: string;
    'rate-limit'?: string;
}

export type PppProfileData = Omit<PppProfile, 'id'>;

export interface PppServer {
    id: string;
    name: string;
    'service-name': string;
    interface: string;
    'default-profile': string;
    authentication: string; // "pap,chap,mschap1,mschap2"
    disabled: string; // 'true' or 'false'
}

export type PppServerData = {
    'service-name': string;
    interface: string;
    'default-profile': string;
    authentication: ('pap' | 'chap' | 'mschap1' | 'mschap2')[];
    disabled?: 'true' | 'false';
};

export interface IpPool {
    id: string;
    name: string;
    ranges: string;
}

export interface IpAddress {
    id: string;
    address: string;
    interface: string;
    disabled: string;
}

export interface IpRoute {
    id: string;
    'dst-address': string;
    gateway?: string;
    distance: string;
    // FIX: Changed boolean types to string to match MikroTik API response format.
    active: string;
    disabled: string;
    comment?: string;
    static: string;
    dynamic: string;
    connected: string;
}

export type IpRouteData = {
    'dst-address': string;
    gateway?: string;
    distance?: string;
    comment?: string;
    disabled?: 'true' | 'false';
};


export interface BillingPlan {
    name: string;
    price: number;
    cycle: 'Monthly' | 'Quarterly' | 'Yearly';
    pppoeProfile: string;
    description: string;
    currency: string;
    routerId?: string;
}

export interface BillingPlanWithId extends BillingPlan {
    id: string;
}

export interface VoucherPlan {
    routerId: string;
    name: string;
    duration_minutes: number;
    price: number;
    currency: string;
    mikrotik_profile_name: string;
}

export interface VoucherPlanWithId extends VoucherPlan {
    id: string;
}


export interface PppSecret {
    id: string;
    name: string;
    service: string;
    profile: string;
    comment: string;
    disabled: string;
    'last-logged-out'?: string;
    password?: string;
    customer?: Customer; // Link to customer data
}

export type PppSecretData = Omit<PppSecret, 'id' | 'last-logged-out' | 'customer'>;

export interface PppActiveConnection {
    id: string;
    name: string;
    service: string;
    'caller-id': string;
    address: string;
    uptime: string;
}

export interface NtpSettings {
    enabled: boolean;
    primaryNtp: string;
    secondaryNtp: string;
}

export interface VlanInterface {
    id: string;
    name: string;
    'vlan-id': string;
    interface: string;
}

export interface SaleRecord {
    id: string;
    date: string;
    clientName: string; // This will be the customer's full name
    planName: string;
    planPrice: number;
    discountAmount: number;
    finalAmount: number;
    routerName: string;
    currency: string;
    routerId?: string;
    // New fields for receipt
    clientAddress?: string;
    clientContact?: string;
    clientEmail?: string;
}

export interface InventoryItem {
    id: string;
    name: string;
    quantity: number;
    price?: number;
    serialNumber?: string;
    dateAdded: string;
}

export interface ExpenseRecord {
    id: string;
    date: string;
    category: string;
    description: string;
    amount: number;
}


export interface CompanySettings {
    companyName?: string;
    address?: string;
    contactNumber?: string;
    email?: string;
    logoBase64?: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

export interface AIFixResponse {
  explanation: string;
  fixedCode: string;
}

export interface ZeroTierInfo {
    address: string;
    clock: number;
    config: {
        settings: {
            portMappingEnabled: boolean;
            primaryPort: number;
        }
    };
    online: boolean;
    version: string;
}

export interface ZeroTierNetwork {
    allowDefault: boolean;
    allowGlobal: boolean;
    allowManaged: boolean;
    assignedAddresses: string[];
    bridge: boolean;
    mac: string;
    mtu: number;
    name: string;
    netconfRevision: number;
    nwid: string;
    portDeviceName: string;
    portError: number;
    status: string;
    type: string;
}

export interface ZeroTierStatusResponse {
    info: ZeroTierInfo;
    networks: ZeroTierNetwork[];
}

export interface PanelHostStatus {
    cpuUsage: number;
    memory: {
        total: string;
        free: string;
        used: string;
        percent: number;
    };
    disk: {
        total: string;
        used: string;
        free: string;
        percent: number;
    };
}

export interface PanelSettings {
    language: 'en' | 'fil' | 'es' | 'pt';
    currency: 'USD' | 'PHP' | 'EUR' | 'BRL';
}

export interface PanelNtpStatus {
    enabled: boolean;
}

export interface Customer {
    id: string;
    username: string; // pppoe username
    routerId: string; // router this customer belongs to
    fullName?: string;
    address?: string;
    contactNumber?: string;
    email?: string;
}

export interface WanRoute {
    id: string;
    gateway: string;
    distance: string;
    checkGateway: string;
    // FIX: Changed boolean types to string to match MikroTik API response format.
    active: string;
    disabled: string;
    comment?: string;
}

export interface FailoverStatus {
    enabled: boolean;
}

// --- Firewall Types ---
export interface FirewallRuleBase {
    '.id': string; // MikroTik API uses .id
    id: string; // We map .id to id for easier use
    chain: string;
    action: string;
    comment?: string;
    disabled: string; // 'true' or 'false'
    invalid: string;
    dynamic: string;
    bytes: number;
    packets: number;
}

export interface FirewallFilterRule extends FirewallRuleBase {
    'src-address'?: string;
    'dst-address'?: string;
    protocol?: string;
    'src-port'?: string;
    'dst-port'?: string;
    'in-interface'?: string;
    'out-interface'?: string;
    'connection-state'?: string;
}

export interface FirewallNatRule extends FirewallRuleBase {
    'src-address'?: string;
    'dst-address'?: string;
    protocol?: string;
    'src-port'?: string;
    'dst-port'?: string;
    'in-interface'?: string;
    'out-interface'?: string;
    'to-addresses'?: string;
    'to-ports'?: string;
}

export interface FirewallMangleRule extends FirewallRuleBase {
    'src-address'?: string;
    'dst-address'?: string;
    'new-routing-mark'?: string;
    passthrough: string; // 'true' or 'false'
    protocol?: string;
}

export type FirewallRule = FirewallFilterRule | FirewallNatRule | FirewallMangleRule;

// Data types for POST/PATCH requests
export type FirewallFilterRuleData = Partial<Omit<FirewallFilterRule, 'id' | '.id' | 'invalid' | 'dynamic' | 'bytes' | 'packets'>>;
export type FirewallNatRuleData = Partial<Omit<FirewallNatRule, 'id' | '.id' | 'invalid' | 'dynamic' | 'bytes' | 'packets'>>;
export type FirewallMangleRuleData = Partial<Omit<FirewallMangleRule, 'id' | '.id' | 'invalid' | 'dynamic' | 'bytes' | 'packets'>>;
export type FirewallRuleData = FirewallFilterRuleData | FirewallNatRuleData | FirewallMangleRuleData;

// --- Hotspot Setup Types ---
export interface SslCertificate {
    id: string;
    name: string;
    'key-usage': string;
    trusted: string;
    'expires-after': string;
}

export interface HotspotSetupParams {
    hotspotInterface: string;
    localAddress: string;
    addressPool: string;
    sslCertificate: string; // 'none' or certificate name
    dnsServers: string;
    dnsName: string;
    hotspotUser: string;
    hotspotPass: string;
}

export interface VersionInfo {
    title: string;
    description: string;
    hash?: string;
    remoteUrl?: string;
}

export interface NewVersionInfo {
    title: string;
    description: string;
    changelog: string;
}
// FIX: Added missing DataplicityStatus interface.
export interface DataplicityStatus {
    installed: boolean;
    url?: string;
}

export interface HostInterface {
    name: string;
    ip4: string;
    mac: string;
}

export interface HostNetworkConfig {
    ipForwarding: boolean;
    interfaces: HostInterface[];
    wanInterface: string | null;
    lanInterface: string | null;
    lanIp: string | null;
    natActive: boolean;
    dnsmasqActive: boolean;
}

export interface MikroTikLogEntry {
    id: string;
    time: string;
    topics: string;
    message: string;
}

export interface NgrokStatus {
    installed: boolean;
    active: boolean;
    url?: string;
    config?: {
        authtoken: string;
        proto: string;
        port: number;
    };
}

export interface MikroTikFile {
    id: string;
    name: string;
    type: string;
    size: string;
}

export interface DhcpServer {
    id: string;
    name: string;
    interface: string;
    'address-pool': string;
    'lease-time': string;
    disabled: 'true' | 'false';
    invalid: 'true' | 'false';
    'lease-script'?: string;
}

export type DhcpServerData = Partial<Omit<DhcpServer, 'id' | 'invalid'>>;

export interface DhcpLease {
    id: string;
    address: string;
    'mac-address': string;
    'client-id'?: string;
    server: string;
    status: string; // e.g., 'waiting', 'bound'
    dynamic: 'true' | 'false';
    comment?: string;
    'host-name'?: string;
}

export interface DhcpServerSetupParams {
    dhcpInterface: string;
    dhcpAddressSpace: string;
    gateway: string;
    addressPool: string;
    dnsServers: string;
    leaseTime: string;
}

export interface DhcpCaptivePortalSetupParams {
    panelIp: string;
    lanInterface: string;
}

export interface DhcpClient {
    id: string; // This will be the address list entry ID
    status: 'pending' | 'active';
    address: string;
    macAddress: string;
    hostName: string;
    // Parsed from comment
    customerInfo: string;
    contactNumber?: string;
    email?: string;
    speedLimit?: string;
    // Raw data
    timeout?: string; // e.g. 29d23h59m58s
    creationTime?: string;
}

export interface DhcpClientActionParams {
    addressListId: string;
    macAddress: string;
    address: string;
    customerInfo: string;
    expiresAt: string; // ISO date string
    speedLimit?: string;
    contactNumber?: string;
    email?: string;
}

export interface SimpleQueue {
    id: string;
    name: string;
    target: string;
    'max-limit': string;
    disabled: 'true' | 'false';
    comment?: string;
}

export type SimpleQueueData = Partial<Omit<SimpleQueue, 'id'>>;