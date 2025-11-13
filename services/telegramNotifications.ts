import { dbApi } from './databaseService.ts';
import axios from 'axios';
import type {
  RouterConfigWithId,
  Notification,
  PppSecret,
  DhcpClient,
  WanRoute,
  PanelSettings
} from '../types.ts';
import {
  getPppSecrets,
  getDhcpClients,
  getWanRoutes,
  getWanFailoverStatus
} from './mikrotikService.ts';

// Utility: parse MikroTik duration strings like "29d23h59m58s" into seconds
const parseDurationToSeconds = (str?: string): number | null => {
  if (!str) return null;
  const re = /(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i;
  const m = str.match(re);
  if (!m) return null;
  const d = parseInt(m[1] || '0', 10);
  const h = parseInt(m[2] || '0', 10);
  const min = parseInt(m[3] || '0', 10);
  const s = parseInt(m[4] || '0', 10);
  return d * 86400 + h * 3600 + min * 60 + s;
};

const makeId = () => `notif_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

const hasDuplicateMessage = (existing: Notification[], candidateMsg: string): boolean => {
  return existing.some(n => n.message === candidateMsg && n.is_read === 0);
};

const hasRecentMessage = (existing: Notification[], candidateMsg: string, withinMinutes: number): boolean => {
  const thresholdMs = withinMinutes * 60 * 1000;
  const now = Date.now();
  return existing.some(n => n.message === candidateMsg && (now - new Date(n.timestamp).getTime()) <= thresholdMs);
};

// Telegram notification functions
export const sendTelegramNotification = async (
  message: string,
  settings?: PanelSettings['telegramSettings']
): Promise<void> => {
  if (!settings?.enabled || !settings.botToken || !settings.chatId) {
    return; // Telegram not configured or disabled
  }

  try {
    const telegramApiUrl = `https://api.telegram.org/bot${settings.botToken}/sendMessage`;
    await axios.post(telegramApiUrl, {
      chat_id: settings.chatId,
      text: message,
      parse_mode: 'HTML'
    });
    console.log('Telegram notification sent successfully');
  } catch (error) {
    console.error('Failed to send Telegram notification:', error.response?.data || error.message);
  }
};

// Enhanced notification generators with Telegram support
export const generatePppoeNotificationsWithTelegram = async (
  routers: RouterConfigWithId[],
  existingNotifications: Notification[],
  settings?: PanelSettings
): Promise<void> => {
  for (const router of routers) {
    let secrets: PppSecret[] = [];
    try {
      secrets = await getPppSecrets(router);
    } catch (e) {
      console.warn(`PPPoE fetch failed for router ${router.name}:`, e);
      continue;
    }
    for (const s of secrets) {
      const isDisabled = s.disabled === 'true';
      const commentLower = (s.comment || '').toLowerCase();
      const mentionsExpired = commentLower.includes('expired') || commentLower.includes('due:');
      if (isDisabled || mentionsExpired) {
        const msg = `PPPoE user '${s.name}' is expired/disconnected on ${router.name}.`;
        const debounceMin = settings?.notificationSettings?.debounceMinutes ?? 15;
        if (hasDuplicateMessage(existingNotifications, msg) || hasRecentMessage(existingNotifications, msg, debounceMin)) continue;
        
        const notif: Notification = {
          id: makeId(),
          type: 'pppoe-expired',
          message: msg,
          is_read: 0,
          timestamp: new Date().toISOString(),
          link_to: 'pppoe',
          context_json: JSON.stringify({ routerId: router.id, username: s.name })
        };
        try {
          await dbApi.post('/notifications', notif);
          
          // Send Telegram notification if enabled
          if (settings?.telegramSettings?.enableClientDisconnected) {
            await sendTelegramNotification(msg, settings.telegramSettings);
          }
        } catch (err) {
          console.error('Failed to create PPPoE notification:', err);
        }
      }
    }
  }
};

export const generateDhcpPortalNotificationsWithTelegram = async (
  routers: RouterConfigWithId[],
  existingNotifications: Notification[],
  settings?: PanelSettings
): Promise<void> => {
  for (const router of routers) {
    let clients: DhcpClient[] = [];
    try {
      clients = await getDhcpClients(router);
    } catch (e) {
      console.warn(`DHCP portal fetch failed for router ${router.name}:`, e);
      continue;
    }
    for (const c of clients) {
      // If authorized with a timeout and close to zero, treat as expired/near-expiry
      const secs = parseDurationToSeconds(c.timeout);
      if (secs === null) continue;
      const nearHours = settings?.notificationSettings?.dhcpNearExpiryHours ?? 24;
      const nearSecs = nearHours * 3600;
      const debounceMin = settings?.notificationSettings?.debounceMinutes ?? 15;
      
      if (secs <= 0) {
        const msg = `DHCP portal client ${c.hostName || c.macAddress} has expired on ${router.name}.`;
        if (hasDuplicateMessage(existingNotifications, msg) || hasRecentMessage(existingNotifications, msg, debounceMin)) continue;
        
        const notif: Notification = {
          id: makeId(),
          type: 'info',
          message: msg,
          is_read: 0,
          timestamp: new Date().toISOString(),
          link_to: 'dhcp-portal',
          context_json: JSON.stringify({ routerId: router.id, macAddress: c.macAddress, address: c.address })
        };
        try {
          await dbApi.post('/notifications', notif);
          
          // Send Telegram notification if enabled
          if (settings?.telegramSettings?.enableClientDueDate) {
            await sendTelegramNotification(msg, settings.telegramSettings);
          }
        } catch (err) {
          console.error('Failed to create DHCP portal notification:', err);
        }
      } else if (secs <= nearSecs) {
        const msg = `DHCP portal client ${c.hostName || c.macAddress} expires soon (<24h) on ${router.name}.`;
        if (hasDuplicateMessage(existingNotifications, msg) || hasRecentMessage(existingNotifications, msg, debounceMin)) continue;
        
        const notif: Notification = {
          id: makeId(),
          type: 'info',
          message: msg,
          is_read: 0,
          timestamp: new Date().toISOString(),
          link_to: 'dhcp-portal',
          context_json: JSON.stringify({ routerId: router.id, macAddress: c.macAddress, address: c.address, timeout: c.timeout })
        };
        try {
          await dbApi.post('/notifications', notif);
          
          // Send Telegram notification if enabled
          if (settings?.telegramSettings?.enableClientDueDate) {
            await sendTelegramNotification(msg, settings.telegramSettings);
          }
        } catch (err) {
          console.error('Failed to create DHCP near-expiry notification:', err);
        }
      }
    }
  }
};

export const generateNetworkNotificationsWithTelegram = async (
  routers: RouterConfigWithId[],
  existingNotifications: Notification[],
  settings?: PanelSettings
): Promise<void> => {
  for (const router of routers) {
    try {
      const [routes, failover] = await Promise.all([
        getWanRoutes(router),
        getWanFailoverStatus(router)
      ]);
      const problematic: WanRoute[] = routes.filter(r => r.disabled === 'true' || r.active === 'false');
      for (const r of problematic) {
        const gw = r.gateway || 'unknown';
        const reason = r.disabled === 'true' ? 'disabled' : 'down';
        const msg = `WAN route ${gw} is ${reason} on ${router.name}.`;
        const debounceMin = settings?.notificationSettings?.debounceMinutes ?? 15;
        if (hasDuplicateMessage(existingNotifications, msg) || hasRecentMessage(existingNotifications, msg, debounceMin)) continue;
        
        const notif: Notification = {
          id: makeId(),
          type: 'info',
          message: msg,
          is_read: 0,
          timestamp: new Date().toISOString(),
          link_to: 'network',
          context_json: JSON.stringify({ routerId: router.id, gateway: gw, failoverEnabled: failover?.enabled ?? false })
        };
        try {
          await dbApi.post('/notifications', notif);
          
          // Send Telegram notification if enabled
          if (settings?.telegramSettings?.enableInterfaceDisconnected) {
            await sendTelegramNotification(msg, settings.telegramSettings);
          }
        } catch (err) {
          console.error('Failed to create network notification:', err);
        }
      }
    } catch (e) {
      console.warn(`Network check failed for router ${router.name}:`, e);
    }
  }
};

export const generateBilledNotificationsWithTelegram = async (
  routers: RouterConfigWithId[],
  existingNotifications: Notification[],
  settings?: PanelSettings
): Promise<void> => {
  try {
    // Fetch all sales; filter by last 24h
    const allSales = await dbApi.get<any[]>('/sales_records');
    const recentSales = allSales.filter(s => {
      const t = new Date(s.date).getTime();
      return Date.now() - t <= 24 * 3600 * 1000;
    });
    const debounceMin = settings?.notificationSettings?.debounceMinutes ?? 15;
    for (const sale of recentSales) {
      const router = routers.find(r => r.id === sale.routerId || r.name === sale.routerName);
      const clientName = sale.clientName?.trim();
      if (!router || !clientName) continue;
      // Try to match PPPoE user by name
      let link: 'pppoe' | 'dhcp-portal' | 'billing' = 'billing';
      try {
        const secrets = await getPppSecrets(router);
        if (secrets.some(s => s.name === clientName)) link = 'pppoe';
      } catch {}
      if (link === 'billing') {
        try {
          const clients = await getDhcpClients(router);
          if (clients.some(c => (c.customerInfo || '').trim() === clientName || (c.hostName || '').trim() === clientName)) link = 'dhcp-portal';
        } catch {}
      }
      const msg = `Client ${clientName} billed for '${sale.planName}' on ${router.name}.`;
      if (hasDuplicateMessage(existingNotifications, msg) || hasRecentMessage(existingNotifications, msg, debounceMin)) continue;
      
      const notif: Notification = {
        id: makeId(),
        type: 'info',
        message: msg,
        is_read: 0,
        timestamp: new Date().toISOString(),
        link_to: link,
        context_json: JSON.stringify({ routerId: router.id, clientName, saleId: sale.id })
      };
      try { 
        await dbApi.post('/notifications', notif); 
        
        // Send Telegram notification if enabled
        if (settings?.telegramSettings?.enableUserPaid) {
          await sendTelegramNotification(msg, settings.telegramSettings);
        }
      } catch (err) { 
        console.error('Failed to create billed notification:', err); 
      }
    }
  } catch (e) {
    console.warn('Failed to generate billed notifications:', e);
  }
};