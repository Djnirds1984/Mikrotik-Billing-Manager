import React, { useState, useEffect, useCallback } from 'react';
import type { EspDevice, EspDeviceData, CoinslotTransaction } from '../../types/hotspot.ts';
import { getEspDevices, createEspDevice, updateEspDevice, deleteEspDevice, getTransactions } from '../../services/hotspotControllerService.ts';
import { Loader } from '../Loader.tsx';

interface Props {
    routerId: string;
}

export const EspDeviceManager: React.FC<Props> = ({ routerId }) => {
    const [devices, setDevices] = useState<EspDevice[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Form
    const [formName, setFormName] = useState('');
    const [formCoinValue, setFormCoinValue] = useState(1);
    const [formMac, setFormMac] = useState('');

    // Selected device details
    const [selectedDevice, setSelectedDevice] = useState<EspDevice | null>(null);
    const [transactions, setTransactions] = useState<CoinslotTransaction[]>([]);

    const fetchDevices = useCallback(async () => {
        if (!routerId) return;
        setIsLoading(true);
        try {
            const data = await getEspDevices(routerId);
            setDevices(data);
        } catch (err) { setError((err as Error).message); }
        finally { setIsLoading(false); }
    }, [routerId]);

    useEffect(() => { fetchDevices(); }, [fetchDevices]);

    const fetchTransactions = useCallback(async (deviceId: string) => {
        try {
            const data = await getTransactions({ espDeviceId: deviceId });
            setTransactions(data);
        } catch { setTransactions([]); }
    }, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const data: EspDeviceData = {
                routerId,
                deviceName: formName,
                coinValue: formCoinValue,
                macAddress: formMac || undefined,
            };
            const device = await createEspDevice(data);
            setIsModalOpen(false);
            setFormName(''); setFormCoinValue(1); setFormMac('');
            await fetchDevices();
            // Show API key
            alert(`Device registered!\n\nAPI Key (save this - it will only be shown once):\n${device.apiKey}`);
        } catch (err) {
            alert(`Error: ${(err as Error).message}`);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Unregister this ESP device?')) return;
        try {
            await deleteEspDevice(id);
            if (selectedDevice?.id === id) setSelectedDevice(null);
            await fetchDevices();
        } catch (err) {
            alert(`Error: ${(err as Error).message}`);
        }
    };

    const handleViewDevice = (device: EspDevice) => {
        setSelectedDevice(device);
        fetchTransactions(device.id);
    };

    if (isLoading) return <div className="flex justify-center p-8"><Loader /></div>;

    return (
        <div className="space-y-4">
            {/* Register Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-md">
                        <form onSubmit={handleCreate}>
                            <div className="p-6 space-y-4">
                                <h3 className="text-xl font-bold text-[--color-primary-500]">Register ESP Device</h3>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Device Name</label>
                                    <input type="text" value={formName} onChange={e => setFormName(e.target.value)} required
                                        placeholder="e.g. Vendo-01"
                                        className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2 text-slate-900 dark:text-white" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Coin Value (per pulse)</label>
                                    <input type="number" value={formCoinValue} onChange={e => setFormCoinValue(Number(e.target.value))} step="0.5" min="0.5"
                                        className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2 text-slate-900 dark:text-white" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">MAC Address (optional)</label>
                                    <input type="text" value={formMac} onChange={e => setFormMac(e.target.value)}
                                        placeholder="AA:BB:CC:DD:EE:FF"
                                        className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2 font-mono text-slate-900 dark:text-white" />
                                </div>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-3 rounded-b-lg">
                                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 rounded-md text-slate-700 dark:text-slate-300">Cancel</button>
                                <button type="submit" className="px-4 py-2 bg-[--color-primary-600] text-white rounded-md">Register</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">ESP Devices ({devices.length})</h3>
                <button onClick={() => setIsModalOpen(true)} className="bg-[--color-primary-600] text-white font-bold py-2 px-4 rounded-lg hover:bg-[--color-primary-500]">
                    Register Device
                </button>
            </div>

            {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-600 dark:text-red-400">{error}</div>}

            {/* Device Detail Panel */}
            {selectedDevice && (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-3">
                    <div className="flex justify-between items-center">
                        <h4 className="font-bold text-slate-800 dark:text-slate-200">{selectedDevice.deviceName}</h4>
                        <button onClick={() => setSelectedDevice(null)} className="text-sm text-slate-500 hover:text-slate-700">Close</button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        <div>
                            <span className="text-slate-500 dark:text-slate-400">Status:</span>
                            <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-bold ${selectedDevice.status === 'online' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400' : 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-400'}`}>
                                {selectedDevice.status}
                            </span>
                        </div>
                        <div><span className="text-slate-500 dark:text-slate-400">Coin Value:</span> <span className="font-mono">{selectedDevice.coinValue}</span></div>
                        <div><span className="text-slate-500 dark:text-slate-400">MAC:</span> <span className="font-mono text-xs">{selectedDevice.macAddress || 'N/A'}</span></div>
                        <div><span className="text-slate-500 dark:text-slate-400">Last Seen:</span> <span className="text-xs">{selectedDevice.lastSeen ? new Date(selectedDevice.lastSeen).toLocaleString() : 'Never'}</span></div>
                    </div>
                    <div>
                        <span className="text-xs text-slate-500">API Key:</span>
                        <code className="ml-2 text-xs bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded font-mono text-slate-700 dark:text-slate-300">{selectedDevice.apiKey}</code>
                    </div>
                    {/* Recent Transactions */}
                    {transactions.length > 0 && (
                        <div>
                            <h5 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mt-3 mb-2">Recent Transactions</h5>
                            <div className="max-h-40 overflow-y-auto">
                                {transactions.slice(0, 10).map(t => (
                                    <div key={t.id} className="flex justify-between text-xs py-1 border-b border-slate-100 dark:border-slate-700">
                                        <span className="font-mono text-slate-600 dark:text-slate-400">{t.macAddress}</span>
                                        <span className="text-green-600 dark:text-green-400">{t.coinsInserted} coins = {t.amount}</span>
                                        <span className="text-slate-500">{new Date(t.createdAt).toLocaleTimeString()}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Device List */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md overflow-hidden">
                <ul className="divide-y divide-slate-200 dark:divide-slate-700">
                    {devices.map(device => (
                        <li key={device.id} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/50">
                            <div className="flex items-center gap-3">
                                <div className={`w-3 h-3 rounded-full ${device.status === 'online' ? 'bg-green-400' : 'bg-slate-300 dark:bg-slate-600'}`} />
                                <div>
                                    <p className="font-semibold text-slate-900 dark:text-slate-100">{device.deviceName}</p>
                                    <p className="text-xs text-slate-500 font-mono">{device.macAddress || 'No MAC'}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button onClick={() => handleViewDevice(device)} className="px-3 py-1.5 text-xs bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500 rounded-md text-slate-700 dark:text-slate-200">
                                    Details
                                </button>
                                <button onClick={() => handleDelete(device.id)} className="px-3 py-1.5 text-xs bg-red-100 dark:bg-red-500/20 hover:bg-red-200 dark:hover:bg-red-500/30 rounded-md text-red-600 dark:text-red-400">
                                    Delete
                                </button>
                            </div>
                        </li>
                    ))}
                    {devices.length === 0 && (
                        <li className="p-6 text-center text-slate-500">No ESP devices registered.</li>
                    )}
                </ul>
            </div>
        </div>
    );
};
