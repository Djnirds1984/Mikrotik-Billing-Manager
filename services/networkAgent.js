const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const path = require('path');

const execPromise = util.promisify(exec);

class NetworkAgent {
  constructor() {
    this.logFile = '/var/log/wan-config.log';
  }

  async log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    try {
      await execPromise(`echo '${logMessage}' | sudo tee -a ${this.logFile}`);
    } catch (e) {
      console.error('[NetworkAgent] Logging failed:', e.message);
    }
    console.log('[NetworkAgent]', message);
  }

  async detectOS() {
    try {
      // Check for netplan
      try {
        await execPromise('ls /etc/netplan/*.yaml');
        return 'netplan';
      } catch (e) {
        // Not netplan
      }

      // Check for NetworkManager
      try {
        await execPromise('which nmcli');
        return 'networkmanager';
      } catch (e) {
        // Not NetworkManager
      }

      // Default to ifupdown
      return 'ifupdown';
    } catch (e) {
      console.error('[NetworkAgent] OS detection failed:', e.message);
      return 'ifupdown';
    }
  }

  sanitizeInput(input) {
    if (!input) return '';
    // Remove any potentially dangerous characters
    return String(input).replace(/[$;&|`"'>]/g, '');
  }

  async applyConfiguration(config) {
    const { connectionType, wanInterface, staticIp, staticGateway, staticDns, pppoeUsername, pppoePassword } = config;
    
    await this.log(`Applying WAN configuration: type=${connectionType}, interface=${wanInterface}`);
    
    const sanitizedInterface = this.sanitizeInput(wanInterface);
    
    try {
      switch (connectionType) {
        case 'dhcp':
          await this.configureDHCP(sanitizedInterface);
          break;
        case 'static':
          await this.configureStaticIP(
            sanitizedInterface,
            this.sanitizeInput(staticIp),
            this.sanitizeInput(staticGateway),
            this.sanitizeInput(staticDns)
          );
          break;
        case 'pppoe':
          await this.configurePPPoE(
            sanitizedInterface,
            this.sanitizeInput(pppoeUsername),
            pppoePassword, // Don't sanitize password (may contain special chars)
            `pppoe-wan-system`
          );
          break;
        default:
          throw new Error(`Unknown connection type: ${connectionType}`);
      }
      
      await this.log(`WAN configuration applied successfully: ${connectionType}`);
    } catch (error) {
      await this.log(`WAN configuration failed: ${error.message}`);
      throw error;
    }
  }

  async configureDHCP(wanInterface) {
    await this.log(`Configuring DHCP on ${wanInterface}`);
    
    // Disable PPPoE if active
    await this.disablePPPoE();
    
    const osType = await this.detectOS();
    
    if (osType === 'netplan') {
      const netplanConfig = `network:
  version: 2
  ethernets:
    ${wanInterface}:
      dhcp4: true
      dhcp6: false
`;
      await execPromise(`echo '${netplanConfig}' | sudo tee /etc/netplan/01-wan-config.yaml`);
      await execPromise('sudo netplan apply');
    } else if (osType === 'networkmanager') {
      await execPromise(`sudo nmcli connection add type ethernet ifname ${wanInterface} con-name wan-dhcp`);
      await execPromise(`sudo nmcli connection modify wan-dhcp ipv4.method auto`);
      await execPromise(`sudo nmcli connection up wan-dhcp`);
    } else {
      // ifupdown - edit /etc/network/interfaces
      await execPromise(`sudo sed -i '/iface ${wanInterface}/,/auto/d' /etc/network/interfaces`);
      const interfaceConfig = `
auto ${wanInterface}
iface ${wanInterface} inet dhcp
`;
      await execPromise(`echo '${interfaceConfig}' | sudo tee -a /etc/network/interfaces`);
      await execPromise(`sudo ifdown ${wanInterface} || true`);
      await execPromise(`sudo ifup ${wanInterface}`);
    }
  }

  async configureStaticIP(wanInterface, ipWithCidr, gateway, dnsServers) {
    await this.log(`Configuring Static IP on ${wanInterface}: ${ipWithCidr}, GW: ${gateway}, DNS: ${dnsServers}`);
    
    // Disable PPPoE if active
    await this.disablePPPoE();
    
    const osType = await this.detectOS();
    const dnsArray = dnsServers.split(',').map(d => d.trim()).filter(d => d);
    
    if (osType === 'netplan') {
      const dnsConfig = dnsArray.map(d => `      - ${d}`).join('\n');
      const netplanConfig = `network:
  version: 2
  ethernets:
    ${wanInterface}:
      dhcp4: false
      addresses:
        - ${ipWithCidr}
      routes:
        - to: default
          via: ${gateway}
      nameservers:
        addresses:
${dnsConfig}
`;
      await execPromise(`echo '${netplanConfig}' | sudo tee /etc/netplan/01-wan-config.yaml`);
      await execPromise('sudo netplan apply');
    } else if (osType === 'networkmanager') {
      await execPromise(`sudo nmcli connection add type ethernet ifname ${wanInterface} con-name wan-static`);
      await execPromise(`sudo nmcli connection modify wan-static ipv4.method manual ipv4.addresses ${ipWithCidr} ipv4.gateway ${gateway}`);
      await execPromise(`sudo nmcli connection modify wan-static ipv4.dns "${dnsArray.join(',')}"`);
      await execPromise(`sudo nmcli connection up wan-static`);
    } else {
      // ifupdown
      await execPromise(`sudo sed -i '/iface ${wanInterface}/,/auto/d' /etc/network/interfaces`);
      const dnsConfig = dnsArray.join(' ');
      const interfaceConfig = `
auto ${wanInterface}
iface ${wanInterface} inet static
    address ${ipWithCidr}
    gateway ${gateway}
    dns-nameservers ${dnsConfig}
`;
      await execPromise(`echo '${interfaceConfig}' | sudo tee -a /etc/network/interfaces`);
      await execPromise(`sudo ifdown ${wanInterface} || true`);
      await execPromise(`sudo ifup ${wanInterface}`);
    }
  }

  async configurePPPoE(wanInterface, username, password, pppoeInterfaceName) {
    await this.log(`Configuring PPPoE on ${wanInterface} for user ${username}`);
    
    // Remove static IP configuration first
    await this.removeStaticIP(wanInterface);
    
    const osType = await this.detectOS();
    
    // Create PPPoE peer configuration
    const pppConfig = `plugin rp-pppoe.so
${wanInterface}
user "${username}"
password "${password}"
defaultroute
usepeerdns
persist
maxfail 0
holdoff 5
`;
    
    await execPromise(`echo '${pppConfig}' | sudo tee /etc/ppp/peers/${pppoeInterfaceName}`);
    
    // Set proper permissions on password file
    await execPromise(`sudo chmod 600 /etc/ppp/peers/${pppoeInterfaceName}`);
    
    // Kill any existing pppd processes
    try {
      await execPromise('sudo pkill pppd || true');
    } catch (e) {
      // No pppd running
    }
    
    // Start PPPoE connection
    await execPromise(`sudo pppd call ${pppoeInterfaceName}`);
    
    await this.log(`PPPoE connection started: ${pppoeInterfaceName}`);
    
    // Wait a moment and verify connection
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    try {
      const { stdout } = await execPromise('ip addr show ppp0 2>/dev/null || ip addr show ppp1 2>/dev/null || echo "no-ppp"');
      if (stdout.includes('no-ppp')) {
        throw new Error('PPPoE connection failed - no PPP interface found');
      }
      await this.log('PPPoE connection verified successfully');
    } catch (e) {
      throw new Error('PPPoE connection verification failed: ' + e.message);
    }
  }

  async disablePPPoE() {
    await this.log('Disabling existing PPPoE connections');
    try {
      await execPromise('sudo pkill pppd || true');
      // Remove old PPPoE config files with system tag
      const { stdout } = await execPromise('ls /etc/ppp/peers/pppoe-* 2>/dev/null || echo "none"');
      if (stdout.trim() !== 'none') {
        const files = stdout.trim().split('\n');
        for (const file of files) {
          await execPromise(`sudo rm -f ${file}`);
        }
      }
    } catch (e) {
      await this.log(`Warning: Failed to disable PPPoE: ${e.message}`);
    }
  }

  async removeStaticIP(wanInterface) {
    await this.log(`Removing static IP configuration from ${wanInterface}`);
    const osType = await this.detectOS();
    
    if (osType === 'netplan') {
      try {
        await execPromise('sudo rm -f /etc/netplan/01-wan-config.yaml');
        await execPromise('sudo netplan apply');
      } catch (e) {
        await this.log(`Warning: Failed to remove netplan config: ${e.message}`);
      }
    } else if (osType === 'networkmanager') {
      try {
        await execPromise(`sudo nmcli connection delete wan-static || true`);
        await execPromise(`sudo nmcli connection delete wan-dhcp || true`);
      } catch (e) {
        await this.log(`Warning: Failed to remove NM config: ${e.message}`);
      }
    } else {
      try {
        await execPromise(`sudo ifdown ${wanInterface} || true`);
        await execPromise(`sudo sed -i '/iface ${wanInterface} inet static/,/^$/d' /etc/network/interfaces`);
      } catch (e) {
        await this.log(`Warning: Failed to remove ifupdown config: ${e.message}`);
      }
    }
  }

  async getCurrentNetworkStatus() {
    try {
      // Get interface information
      const { stdout: addrOutput } = await execPromise('ip -j addr show 2>/dev/null || echo "[]"');
      const interfaces = JSON.parse(addrOutput);
      
      // Get default route
      const { stdout: routeOutput } = await execPromise('ip -j route show default 2>/dev/null || echo "[]"');
      const routes = JSON.parse(routeOutput);
      
      // Get DNS servers
      const { stdout: dnsOutput } = await execPromise('cat /etc/resolv.conf 2>/dev/null || echo ""');
      const dnsServers = [];
      const dnsLines = dnsOutput.split('\n');
      for (const line of dnsLines) {
        const match = line.match(/^nameserver\\s+(.+)$/);
        if (match) {
          dnsServers.push(match[1]);
        }
      }
      
      // Find WAN interface (usually the one with default route)
      let wanInterface = 'eth0';
      let ipAddress = '';
      let gateway = '';
      
      if (routes.length > 0) {
        gateway = routes[0].gateway || '';
        wanInterface = routes[0].dev || 'eth0';
        
        // Find IP address for this interface
        for (const iface of interfaces) {
          if (iface.ifname === wanInterface && iface.addr_info) {
            for (const addr of iface.addr_info) {
              if (addr.family === 'inet') {
                ipAddress = addr.local;
                break;
              }
            }
          }
        }
      }
      
      // Test internet connectivity
      let isOnline = false;
      try {
        await execPromise('ping -c 1 -W 2 8.8.8.8 >/dev/null 2>&1');
        isOnline = true;
      } catch (e) {
        isOnline = false;
      }
      
      return {
        wanInterface,
        ipAddress: ipAddress || 'Not assigned',
        gateway: gateway || 'Not configured',
        dnsServers,
        isOnline
      };
    } catch (e) {
      throw new Error('Failed to get network status: ' + e.message);
    }
  }

  async rollbackToPrevious(config) {
    await this.log(`Rolling back to previous configuration`);
    // In a production system, you'd store the previous config and restore it
    // For now, we'll just revert to DHCP as a safe default
    await this.configureDHCP(config.wanInterface || 'eth0');
  }
}

module.exports = { NetworkAgent };
