import React, { useState, useEffect, useCallback } from 'react';
import type { RouterConfigWithId, Interface, SslCertificate, HotspotSetupParams } from '../types.ts';
import { getInterfaces, getSslCertificates, runHotspotSetup } from '../services/mikrotikService.ts';
import { generateHotspotSetupScript } from '../services/geminiService.ts';
import { Loader } from './Loader.tsx';
import { CodeBlock } from './CodeBlock.tsx';

// Helper to derive pool from network address
const getPoolFromNetwork = (network: string): string => {
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(network)) {
        return '';
    }
    const [ip, cidrStr] = network.split('/');
    const ipParts = ip.split('.').map(Number);
    const cidr = parseInt(cidrStr, 10);
    
    if (cidr < 8 || cidr > 30) return ''; // Only handle reasonable subnet sizes

    const startIp = [...ipParts];
    startIp[3]++;
    
    const ipAsInt = (ipParts[0] << 24 | ipParts[1] << 16 | ipParts[2] << 8 | ipParts[3]) >>> 0;
    const subnetMask = (0xffffffff << (32 - cidr)) >>> 0;
    const networkAddress = ipAsInt & subnetMask;
    const broadcastAddress = networkAddress | ~subnetMask;
    
    const endIpParts = [
        (broadcastAddress >> 24) & 255,
        (broadcastAddress >> 16) & 255,
        (broadcastAddress >> 8) & 255,
        (broadcastAddress & 255) - 1 // One less than broadcast
    ];

    // FIX: Removed spaces around the hyphen to match MikroTik API requirements.
    return `${startIp.join('.')}-${endIpParts.join('.')}`;
};


export const HotspotInstaller: React.FC<{ selectedRouter: RouterConfigWithId }> = ({ selectedRouter }) => {
    const [setupMethod, setSetupMethod] = useState<'ai' | 'smart'>('smart');
    const [params, setParams] = useState<HotspotSetupParams>({
        hotspotInterface: '',
        localAddress: '10.5.50.1/24',
        addressPool: '10.5.50.2-10.5.50.254',
        sslCertificate: 'none',
        dnsServers: '8.8.8.8, 1.1.1.1',
        dnsName: 'hotspot.login',
        hotspotUser: 'admin',
        hotspotPass: '1234'
    });
    const [interfaces, setInterfaces] = useState<Interface[]>([]);
    const [certificates, setCertificates] = useState<SslCertificate[]>([]);
    const [isLoadingData, setIsLoadingData] = useState(true);
    const [isWorking, setIsWorking] = useState(false);
    const [script, setScript] = useState('');
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoadingData(true);
        setError(null);
        try {
            const [ifaces, certs] = await Promise.all([
                getInterfaces(selectedRouter),
                getSslCertificates(selectedRouter)
            ]);
            setInterfaces(ifaces);
            setCertificates(certs.filter(c => !c.name.includes('*'))); // Filter default certs
            
            if (ifaces.length > 0 && !params.hotspotInterface) {
                const defaultIface = ifaces.find(i => i.type === 'bridge' && i.name.toLowerCase().includes('lan'))?.name || ifaces.find(i => i.type === 'bridge')?.name || ifaces[0].name;
                setParams(p => ({ ...p, hotspotInterface: defaultIface }));
            }

        } catch (err) {
            setError(`Failed to fetch initial data: ${(err as Error).message}`);
        } finally {
            setIsLoadingData(false);
        }
    }, [selectedRouter, params.hotspotInterface]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setParams(p => {
            const newParams = { ...p, [name]: value };
            if (name === 'localAddress') {
                newParams.addressPool = getPoolFromNetwork(value);
            }
            return newParams;
        });
    };
    
    const handleRun = async () => {
        setIsWorking(true);
        setScript('');
        setStatusMessage(null);
        setError(null);

        if (setupMethod === 'ai') {
            try {
                const generatedScript = await generateHotspotSetupScript(params);
                setScript(generatedScript);
            } catch (err) {
                setScript(`# Error generating script: ${(err as Error).message}`);
            }
        } else { // Smart Installer
            try {
                setStatusMessage("Starting Hotspot setup on router...");
                const result = await runHotspotSetup(selectedRouter, params);
                setStatusMessage(result.message);
            } catch (err) {
                setError(`Setup failed: ${(err as Error).message}`);
            }
        }
        setIsWorking(false);
    };
    
    if (isLoadingData) {
        return <div className="flex justify-center p-8"><Loader /></div>;
    }
    
    if (error && !isWorking) {
        return <div className="p-4 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-md">{error}</div>;
    }

    return (
         <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md">
            <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                <h3 className="text-lg font-semibold text-[--color-primary-500] dark:text-[--color-primary-400]">Hotspot Server Setup Assistant</h3>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
                <div className="space-y-4">
                    {/* Form Fields */}
                    <div><label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Hotspot Interface</label><select name="hotspotInterface" value={params.hotspotInterface} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md">{interfaces.map(i => <option key={i.name}>{i.name}</option>)}</select></div>
                    <div><label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Local Address of Network</label><input name="localAddress" value={params.localAddress} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md" /></div>
                    <div><label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Address Pool of Network</label><input name="addressPool" value={params.addressPool} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md" /></div>
                    <div><label className="block text-sm font-medium text-slate-700 dark:text-slate-300">SSL Certificate</label><select name="sslCertificate" value={params.sslCertificate} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md"><option value="none">none</option>{certificates.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select></div>
                    <div><label className="block text-sm font-medium text-slate-700 dark:text-slate-300">DNS Servers</label><input name="dnsServers" value={params.dnsServers} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md" /></div>
                    <div><label className="block text-sm font-medium text-slate-700 dark:text-slate-300">DNS Name</label><input name="dnsName" value={params.dnsName} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md" /></div>
                    <div className="grid grid-cols-2 gap-4">
                         <div><label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Hotspot Admin User</label><input name="hotspotUser" value={params.hotspotUser} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md" /></div>
                         <div><label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Password</label><input name="hotspotPass" value={params.hotspotPass} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md" /></div>
                    </div>
                </div>
                 <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Installation Method</label>
                        <div className="flex items-center gap-2 rounded-lg bg-slate-100 dark:bg-slate-700 p-1">
                            <button onClick={() => setSetupMethod('smart')} className={`w-full rounded-md py-2 px-3 text-sm font-medium ${setupMethod === 'smart' ? 'bg-white dark:bg-slate-900 text-[--color-primary-600]' : 'text-slate-600 dark:text-slate-300'}`}>Smart Installer</button>
                            <button onClick={() => setSetupMethod('ai')} className={`w-full rounded-md py-2 px-3 text-sm font-medium ${setupMethod === 'ai' ? 'bg-white dark:bg-slate-900 text-[--color-primary-600]' : 'text-slate-600 dark:text-slate-300'}`}>AI Script Generator</button>
                        </div>
                    </div>
                     <button onClick={handleRun} disabled={isWorking} className="w-full bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center disabled:opacity-50">
                        {isWorking ? 'Working...' : (setupMethod === 'ai' ? 'Generate Script' : 'Run Smart Setup')}
                    </button>
                    <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-2 border border-slate-200 dark:border-slate-700 min-h-[300px] relative">
                        {isWorking && <div className="absolute inset-0 bg-slate-50/80 dark:bg-slate-900/80 flex items-center justify-center"><Loader /></div>}
                        {setupMethod === 'ai' ? (
                            <CodeBlock script={script || '# The generated setup script will appear here.\n# Review it carefully before running it in the Terminal.'} />
                        ) : (
                            <div className="p-4 text-sm">
                                {statusMessage && <p className="text-green-600 dark:text-green-400 font-semibold">{statusMessage}</p>}
                                {error && <p className="text-red-600 dark:text-red-400 font-semibold">{error}</p>}
                                {!statusMessage && !error && <p className="text-slate-500">Click "Run Smart Setup" to begin. The setup status will be shown here.</p>}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
