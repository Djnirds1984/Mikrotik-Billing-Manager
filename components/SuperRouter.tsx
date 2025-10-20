import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { HostNetworkConfig } from '../types.ts';
import { getHostNetworkConfig, applyHostNetworkConfig, revertHostNetworkConfig } from '../services/hostNetworkService.ts';
import { Loader } from './Loader.tsx';
import { CodeBlock } from './CodeBlock.tsx';
import { ShieldCheckIcon, TrashIcon } from '../constants.tsx';

const SudoInstructionBox: React.FC = () => {
    const visudoCommand = `sudo visudo`;
    const lineToAdd = `<your_username> ALL=(ALL) NOPASSWD: /usr/sbin/iptables, /bin/sysctl, /usr/sbin/ip, /usr/sbin/dnsmasq, /bin/systemctl, /usr/sbin/dhclient, /bin/rm, /bin/mv`;

    return (
        <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700/50 text-amber-900 dark:text-amber-200">
            <h4 className="font-bold text-lg mb-2">Action Required: Configure `sudo`</h4>
            <div className="text-sm space-y-2 text-amber-800 dark:text-amber-300">
                <p>
                    To allow this panel to manage system services (like networking, firewall, and DHCP),
                    you need to grant it passwordless `sudo` access for specific commands.
                </p>
                <ol className="list-decimal list-inside space-y-2 pl-2">
                    <li>SSH into your panel's host machine (your Orange Pi).</li>
                    <li>
                        Run this command to safely edit the sudoers file:
                        <div className="my-2 bg-amber-100 dark:bg-amber-900/50 rounded-md border border-amber-200 dark:border-amber-700/60">
                            <CodeBlock script={visudoCommand} />
                        </div>
                    </li>
                    <li>
                        Scroll to the very bottom of the file and add the following line.
                        <strong className="block">Important: Replace `&lt;your_username&gt;` with the actual username that runs this panel (e.g., `pi`, `orangepi`, or `root`).</strong>
                        <div className="my-2 bg-amber-100 dark:bg-amber-900/50 rounded-md border border-amber-200 dark:border-amber-700/60">
                             <CodeBlock script={lineToAdd} />
                        </div>
                    </li>
                    <li>To save and exit, press <kbd className="font-mono bg-slate-200 dark:bg-slate-700 px-1 py-0.5 rounded">Ctrl+X</kbd>, then <kbd className="font-mono bg-slate-200 dark:bg-slate-700 px-1 py-0.5 rounded">Y</kbd>, then <kbd className="font-mono bg-slate-200 dark:bg-slate-700 px-1 py-0.5 rounded">Enter</kbd>.</li>
                </ol>
            </div>
        </div>
    );
};

export const SuperRouter: React.FC = () => {
    const [config, setConfig] = useState<HostNetworkConfig | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [wan, setWan] = useState('');
    const [lan, setLan] = useState('');
    const [lanIp, setLanIp] = useState('192.168.100.1/24');

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await getHostNetworkConfig();
            setConfig(data);
            if (data.interfaces.length >= 2) {
                // Pre-fill selections if not already set or saved
                setWan(data.wanInterface || data.interfaces[0].name);
                setLan(data.lanInterface || data.interfaces[1].name);
                setLanIp(data.lanIp || '192.168.100.1/24');
            }
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const physicalInterfaces = useMemo(() => {
        return config?.interfaces.filter(i => 
            !i.name.startsWith('veth') && 
            !i.name.startsWith('br-') && 
            !i.name.startsWith('docker') &&
            !i.name.startsWith('zt')) // Filter out ZeroTier interfaces
        || [];
    }, [config]);

    const handleApply = async () => {
        if (wan === lan) {
            alert('WAN and LAN interfaces cannot be the same.');
            return;
        }
        if (!window.confirm("WARNING: This will modify your Orange Pi's core network settings, including IP addresses and firewall rules. A misconfiguration could make the device inaccessible. Are you sure you want to proceed?")) {
            return;
        }
        setIsSubmitting(true);
        setError(null);
        try {
            const result = await applyHostNetworkConfig({ wan, lan, lanIp });
            alert(result.message);
            await fetchData();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleRevert = async () => {
         if (!window.confirm("Are you sure you want to revert the host to its default network configuration? This will disable the router functionality.")) {
            return;
        }
        setIsSubmitting(true);
        setError(null);
        try {
            const result = await revertHostNetworkConfig();
            alert(result.message);
            await fetchData();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex justify-center p-8">
                <Loader />
            </div>
        );
    }
    
    if (error) {
        return <div className="p-4 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg">{error}</div>;
    }
    
    if (physicalInterfaces.length < 2) {
        return (
            <div className="p-6 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-lg text-center">
                 <h3 className="text-xl font-bold text-yellow-800 dark:text-yellow-200">Insufficient Network Interfaces</h3>
                 <p className="mt-2 text-yellow-700 dark:text-yellow-300">This feature requires at least two physical network interfaces (e.g., `eth0`, `eth1`) to function as a router. Only one was detected.</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8">
             <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                 <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-3">
                    <ShieldCheckIcon className="w-8 h-8 text-[--color-primary-500]" />
                    Host Router Configuration
                </h2>
                <p className="text-slate-500 dark:text-slate-400 mt-2">Turn your Orange Pi into a dedicated router. This feature directly modifies the host system's network settings.</p>
             </div>

             <SudoInstructionBox />

             <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                    <div className={`p-3 rounded-md text-center ${config?.ipForwarding ? 'bg-green-100 dark:bg-green-900/30' : 'bg-slate-100 dark:bg-slate-700'}`}>
                        <p className="font-bold">IP Forwarding</p>
                        <p className={config?.ipForwarding ? 'text-green-700 dark:text-green-300' : 'text-slate-500'}>{config?.ipForwarding ? 'Enabled' : 'Disabled'}</p>
                    </div>
                     <div className={`p-3 rounded-md text-center ${config?.natActive ? 'bg-green-100 dark:bg-green-900/30' : 'bg-slate-100 dark:bg-slate-700'}`}>
                        <p className="font-bold">NAT / Masquerade</p>
                        <p className={config?.natActive ? 'text-green-700 dark:text-green-300' : 'text-slate-500'}>{config?.natActive ? 'Active' : 'Inactive'}</p>
                    </div>
                     <div className={`p-3 rounded-md text-center ${config?.dnsmasqActive ? 'bg-green-100 dark:bg-green-900/30' : 'bg-slate-100 dark:bg-slate-700'}`}>
                        <p className="font-bold">LAN DHCP (dnsmasq)</p>
                        <p className={config?.dnsmasqActive ? 'text-green-700 dark:text-green-300' : 'text-slate-500'}>{config?.dnsmasqActive ? 'Active' : 'Inactive'}</p>
                    </div>
                     <div className="p-3 rounded-md text-center bg-slate-100 dark:bg-slate-700">
                        <p className="font-bold">WAN Interface</p>
                        <p className="text-slate-500">{config?.wanInterface || 'N/A'}</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-slate-200 dark:border-slate-700">
                    <div>
                        <label htmlFor="wan" className="block text-sm font-medium text-slate-700 dark:text-slate-300">WAN Interface (Internet)</label>
                        <select id="wan" value={wan} onChange={e => setWan(e.target.value)} className="mt-1 block w-full p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md">
                            {physicalInterfaces.map(iface => <option key={iface.name} value={iface.name}>{iface.name} ({iface.mac})</option>)}
                        </select>
                         <p className="text-xs text-slate-500 mt-1">This interface will be configured via DHCP to get an IP from your modem/main router.</p>
                    </div>
                    <div>
                        <label htmlFor="lan" className="block text-sm font-medium text-slate-700 dark:text-slate-300">LAN Interface (Local Network)</label>
                        <select id="lan" value={lan} onChange={e => setLan(e.target.value)} className="mt-1 block w-full p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md">
                             {physicalInterfaces.map(iface => <option key={iface.name} value={iface.name}>{iface.name} ({iface.mac})</option>)}
                        </select>
                         <p className="text-xs text-slate-500 mt-1">This interface will serve your local network. Devices connect here.</p>
                    </div>
                </div>
                 <div>
                    <label htmlFor="lanIp" className="block text-sm font-medium text-slate-700 dark:text-slate-300">LAN IP Address & Subnet</label>
                    <input id="lanIp" value={lanIp} onChange={e => setLanIp(e.target.value)} className="mt-1 block w-full p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md font-mono" />
                     <p className="text-xs text-slate-500 mt-1">The static IP for your LAN interface. A DHCP server will be created for this subnet.</p>
                </div>
                 <div className="flex flex-col sm:flex-row justify-end gap-4 pt-6 border-t border-slate-200 dark:border-slate-700">
                     <button onClick={handleRevert} disabled={isSubmitting || !config?.wanInterface} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                        <TrashIcon className="w-5 h-5"/> Revert to Default
                     </button>
                    <button onClick={handleApply} disabled={isSubmitting} className="px-4 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-bold rounded-lg flex items-center justify-center gap-2 disabled:opacity-50">
                        {isSubmitting ? <Loader /> : <ShieldCheckIcon className="w-5 h-5"/>}
                        {isSubmitting ? 'Applying...' : 'Apply Router Configuration'}
                    </button>
                </div>
             </div>
        </div>
    );
};