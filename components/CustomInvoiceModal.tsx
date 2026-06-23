import React, { useState, useEffect, useRef, useCallback } from 'react';
import { XMarkIcon, SearchIcon } from '../constants.tsx';
import { dbApi, getAuthHeader } from '../services/databaseService.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import type { CustomInvoiceCategory, ClientInvoice } from '../types.ts';
import { Html5Qrcode } from 'html5-qrcode';

interface CustomInvoiceModalProps {
    isOpen: boolean;
    onClose: () => void;
    routers: any[];
    onInvoiceCreated: () => void;
}

const CATEGORIES: CustomInvoiceCategory[] = [
    'CCTV Installation',
    'Computer Repair',
    'Network Setup',
    'Cabling',
    'Maintenance',
    'Other',
];

export const CustomInvoiceModal: React.FC<CustomInvoiceModalProps> = ({ isOpen, onClose, routers, onInvoiceCreated }) => {
    const { formatCurrency, currency } = useLocalization();

    // Client selection state
    const [source, setSource] = useState<'pppoe' | 'dhcp'>('pppoe');
    const [routerId, setRouterId] = useState('');
    const [clients, setClients] = useState<any[]>([]);
    const [selectedClientId, setSelectedClientId] = useState('');
    const [loadingClients, setLoadingClients] = useState(false);

    // QR Scanner state
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const scannerRef = useRef<Html5Qrcode | null>(null);
    const scannerContainerId = 'qr-scanner-container';

    // Service details state
    const [category, setCategory] = useState<CustomInvoiceCategory | ''>('');
    const [description, setDescription] = useState('');
    const [laborCost, setLaborCost] = useState<number>(0);
    const [partsCost, setPartsCost] = useState<number>(0);

    // Billing option state
    const [billingOption, setBillingOption] = useState<'separate' | 'add_to_existing'>('separate');
    const [pendingInvoices, setPendingInvoices] = useState<ClientInvoice[]>([]);
    const [selectedExistingInvoiceId, setSelectedExistingInvoiceId] = useState('');
    const [dueDate, setDueDate] = useState('');

    // Submit state
    const [isSubmitting, setIsSubmitting] = useState(false);

    const total = laborCost + partsCost;

    // Fetch clients when router or source changes
    useEffect(() => {
        if (!routerId || !isOpen) return;
        const fetchClients = async () => {
            setLoadingClients(true);
            try {
                if (source === 'pppoe') {
                    const res = await fetch('/api/client-portal/users', { headers: getAuthHeader() });
                    const data = await res.json();
                    const list = Array.isArray(data) ? data.filter((u: any) => u.router_id === routerId) : [];
                    setClients(list.map((u: any) => ({
                        id: u.id,
                        label: `${u.username} (${u.pppoe_username})`,
                        username: u.username,
                        pppoe_username: u.pppoe_username,
                        account_number: u.account_number,
                    })));
                } else {
                    const rows = await dbApi.get<any[]>(`/dhcp_clients?routerId=${routerId}`);
                    const list = Array.isArray(rows) ? rows : [];
                    setClients(list.map((c: any) => ({
                        id: c.id || c.macAddress,
                        label: `${c.customerInfo || c.hostName || c.macAddress}`,
                        macAddress: c.macAddress,
                        hostName: c.hostName,
                        customerInfo: c.customerInfo,
                        account_number: c.accountNumber,
                    })));
                }
            } catch {
                setClients([]);
            } finally {
                setLoadingClients(false);
            }
        };
        fetchClients();
    }, [routerId, source, isOpen]);

    // Fetch pending invoices when client is selected and billing option is "add_to_existing"
    useEffect(() => {
        if (!routerId || !selectedClientId || billingOption !== 'add_to_existing' || !isOpen) {
            setPendingInvoices([]);
            return;
        }
        const fetchPending = async () => {
            try {
                const client = clients.find(c => c.id === selectedClientId);
                const username = client?.pppoe_username || client?.username || client?.macAddress || '';
                const encodedRouter = encodeURIComponent(routerId);
                const encodedUser = encodeURIComponent(username);
                const rows = await dbApi.get<ClientInvoice[]>(`/client-invoices-pending/${encodedRouter}/${encodedUser}`);
                setPendingInvoices(Array.isArray(rows) ? rows : []);
            } catch {
                setPendingInvoices([]);
            }
        };
        fetchPending();
    }, [selectedClientId, billingOption, routerId, isOpen, clients]);

    // QR Scanner functions
    const startScanner = useCallback(async () => {
        setIsScannerOpen(true);
        try {
            const scanner = new Html5Qrcode(scannerContainerId);
            scannerRef.current = scanner;
            await scanner.start(
                { facingMode: 'environment' },
                { fps: 10, qrbox: { width: 250, height: 250 } },
                (decodedText) => {
                    handleQrDecoded(decodedText);
                    stopScanner();
                },
                () => {} // ignore errors during scanning
            );
        } catch (err) {
            console.error('QR Scanner error:', err);
            alert('Could not start camera. Please ensure camera permissions are granted.');
            setIsScannerOpen(false);
        }
    }, [routerId, clients, source]);

    const stopScanner = useCallback(async () => {
        if (scannerRef.current) {
            try {
                await scannerRef.current.stop();
                scannerRef.current = null;
            } catch {}
        }
        setIsScannerOpen(false);
    }, []);

    const handleQrDecoded = (decodedText: string) => {
        // QR format: "accountNumber" or "routerId:accountNumber"
        const parts = decodedText.split(':');
        let targetRouterId = routerId;
        let accountNumber = decodedText;

        if (parts.length === 2) {
            targetRouterId = parts[0];
            accountNumber = parts[1];
        }

        // Auto-select router if matched
        if (targetRouterId && routers.some(r => r.id === targetRouterId)) {
            setRouterId(targetRouterId);
        }

        // Find client by account number
        const matchedClient = clients.find(c =>
            c.account_number === accountNumber ||
            c.macAddress === accountNumber ||
            c.pppoe_username === accountNumber
        );
        if (matchedClient) {
            setSelectedClientId(matchedClient.id);
        } else {
            // Try matching by partial account number in label
            const partialMatch = clients.find(c =>
                c.label?.toLowerCase().includes(accountNumber.toLowerCase())
            );
            if (partialMatch) {
                setSelectedClientId(partialMatch.id);
            }
        }
    };

    // Cleanup scanner on unmount
    useEffect(() => {
        return () => {
            if (scannerRef.current) {
                try { scannerRef.current.stop(); } catch {}
            }
        };
    }, []);

    // Reset form when modal opens/closes
    useEffect(() => {
        if (!isOpen) {
            setSource('pppoe');
            setRouterId('');
            setClients([]);
            setSelectedClientId('');
            setCategory('');
            setDescription('');
            setLaborCost(0);
            setPartsCost(0);
            setBillingOption('separate');
            setPendingInvoices([]);
            setSelectedExistingInvoiceId('');
            setDueDate('');
            setIsSubmitting(false);
            if (scannerRef.current) {
                try { scannerRef.current.stop(); } catch {}
                scannerRef.current = null;
            }
            setIsScannerOpen(false);
        }
    }, [isOpen]);

    const handleSubmit = async () => {
        if (!routerId || !selectedClientId) {
            alert('Please select a router and client.');
            return;
        }
        if (!category) {
            alert('Please select a service category.');
            return;
        }
        if (total <= 0) {
            alert('Total amount must be greater than zero.');
            return;
        }

        const client = clients.find(c => c.id === selectedClientId);
        const username = client?.pppoe_username || client?.username || client?.macAddress || client?.label || '';

        setIsSubmitting(true);
        try {
            if (billingOption === 'add_to_existing' && selectedExistingInvoiceId) {
                // Add to existing invoice: update amount and append description
                const existingInv = pendingInvoices.find(inv => inv.id === selectedExistingInvoiceId);
                if (!existingInv) {
                    alert('Selected invoice not found.');
                    return;
                }
                const newAmount = (existingInv.amount || 0) + total;
                const updatedDescription = existingInv.description
                    ? `${existingInv.description}\n+ ${category}: ${description || 'Custom service'} (Labor: ${laborCost}, Parts: ${partsCost})`
                    : `${category}: ${description || 'Custom service'} (Labor: ${laborCost}, Parts: ${partsCost})`;
                await dbApi.patch(`/client-invoices/${selectedExistingInvoiceId}`, {
                    amount: newAmount,
                    description: updatedDescription,
                    category: existingInv.category || category,
                    invoiceType: 'custom',
                });
                alert('Custom charge added to existing invoice.');
            } else {
                // Create new separate invoice
                const newInvoice: any = {
                    id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    routerId,
                    username,
                    accountNumber: client?.account_number || null,
                    source,
                    planName: category,
                    amount: total,
                    currency: currency || 'PHP',
                    issueDate: new Date().toISOString(),
                    dueDateTime: dueDate ? new Date(dueDate).toISOString() : null,
                    status: 'PENDING',
                    description: description || `${category} service`,
                    category,
                    laborCost,
                    partsCost,
                    invoiceType: 'custom',
                };
                await dbApi.post('/client-invoices', newInvoice);
                alert('Custom invoice created.');
            }
            onInvoiceCreated();
            onClose();
        } catch (err) {
            alert((err as Error).message);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center sticky top-0 bg-white dark:bg-slate-800 z-10">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Create Custom Invoice</h3>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md">
                        <XMarkIcon className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Section 1: Client Selection */}
                    <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">Client Selection</h4>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Source</label>
                                <select
                                    value={source}
                                    onChange={e => { setSource(e.target.value as 'pppoe' | 'dhcp'); setSelectedClientId(''); }}
                                    className="w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md text-slate-900 dark:text-white border-0"
                                >
                                    <option value="pppoe">PPPoE</option>
                                    <option value="dhcp">DHCP Portal</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Router</label>
                                <select
                                    value={routerId}
                                    onChange={e => { setRouterId(e.target.value); setSelectedClientId(''); }}
                                    className="w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md text-slate-900 dark:text-white border-0"
                                >
                                    <option value="">Select Router</option>
                                    {routers.map(r => <option key={r.id} value={r.id}>{r.name || r.id}</option>)}
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Client</label>
                            <div className="flex gap-2">
                                <select
                                    value={selectedClientId}
                                    onChange={e => setSelectedClientId(e.target.value)}
                                    disabled={loadingClients}
                                    className="flex-1 p-2 bg-slate-100 dark:bg-slate-700 rounded-md text-slate-900 dark:text-white border-0"
                                >
                                    <option value="">{loadingClients ? 'Loading...' : 'Select Client'}</option>
                                    {clients.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                                </select>
                                <button
                                    type="button"
                                    onClick={() => isScannerOpen ? stopScanner() : startScanner()}
                                    className={`px-3 py-2 rounded-md text-sm font-semibold text-white ${isScannerOpen ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                                    title={isScannerOpen ? 'Stop Scanner' : 'Scan QR/Barcode'}
                                >
                                    {isScannerOpen ? 'Stop' : 'Scan QR'}
                                </button>
                            </div>
                        </div>

                        {/* QR Scanner */}
                        {isScannerOpen && (
                            <div className="rounded-lg overflow-hidden border border-slate-300 dark:border-slate-600">
                                <div id={scannerContainerId} className="w-full bg-black" style={{ minHeight: '250px' }} />
                                <p className="text-xs text-slate-500 dark:text-slate-400 p-2 bg-slate-50 dark:bg-slate-700/50">
                                    Point camera at QR code or barcode. Format: <code className="text-xs">accountNumber</code> or <code className="text-xs">routerId:accountNumber</code>
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Section 2: Service Details */}
                    <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">Service Details</h4>

                        <div>
                            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Category</label>
                            <select
                                value={category}
                                onChange={e => setCategory(e.target.value as CustomInvoiceCategory)}
                                className="w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md text-slate-900 dark:text-white border-0"
                            >
                                <option value="">Select Category</option>
                                {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Description</label>
                            <textarea
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                rows={3}
                                placeholder="Describe the work performed..."
                                className="w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md text-slate-900 dark:text-white border-0 resize-none"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Labor Cost</label>
                                <input
                                    type="number"
                                    min={0}
                                    step={0.01}
                                    value={laborCost || ''}
                                    onChange={e => setLaborCost(Number(e.target.value) || 0)}
                                    className="w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md text-slate-900 dark:text-white border-0"
                                    placeholder="0.00"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Parts / Materials Cost</label>
                                <input
                                    type="number"
                                    min={0}
                                    step={0.01}
                                    value={partsCost || ''}
                                    onChange={e => setPartsCost(Number(e.target.value) || 0)}
                                    className="w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md text-slate-900 dark:text-white border-0"
                                    placeholder="0.00"
                                />
                            </div>
                        </div>

                        <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Total Amount</span>
                            <span className="text-xl font-bold text-green-600 dark:text-green-400">{formatCurrency(total)}</span>
                        </div>
                    </div>

                    {/* Section 3: Billing Option */}
                    <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">Billing Option</h4>

                        <div className="space-y-2">
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="radio"
                                    name="billingOption"
                                    value="separate"
                                    checked={billingOption === 'separate'}
                                    onChange={() => setBillingOption('separate')}
                                    className="w-4 h-4 text-indigo-600"
                                />
                                <div>
                                    <div className="text-sm font-medium text-slate-900 dark:text-white">Create Separate Invoice</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400">Creates a new standalone invoice for this custom service.</div>
                                </div>
                            </label>
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="radio"
                                    name="billingOption"
                                    value="add_to_existing"
                                    checked={billingOption === 'add_to_existing'}
                                    onChange={() => setBillingOption('add_to_existing')}
                                    className="w-4 h-4 text-indigo-600"
                                />
                                <div>
                                    <div className="text-sm font-medium text-slate-900 dark:text-white">Add to Existing Pending Invoice</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400">Adds this charge to an existing pending invoice for this client.</div>
                                </div>
                            </label>
                        </div>

                        {billingOption === 'separate' && (
                            <div>
                                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Due Date (optional)</label>
                                <input
                                    type="datetime-local"
                                    value={dueDate}
                                    onChange={e => setDueDate(e.target.value)}
                                    className="w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md text-slate-900 dark:text-white border-0"
                                />
                            </div>
                        )}

                        {billingOption === 'add_to_existing' && (
                            <div>
                                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Select Pending Invoice</label>
                                {pendingInvoices.length > 0 ? (
                                    <select
                                        value={selectedExistingInvoiceId}
                                        onChange={e => setSelectedExistingInvoiceId(e.target.value)}
                                        className="w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md text-slate-900 dark:text-white border-0"
                                    >
                                        <option value="">Select Invoice</option>
                                        {pendingInvoices.map(inv => (
                                            <option key={inv.id} value={inv.id}>
                                                {inv.planName || 'Invoice'} — {formatCurrency(inv.amount || 0)} — Issued: {inv.issueDate ? new Date(inv.issueDate).toLocaleDateString() : 'N/A'}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <p className="text-sm text-slate-500 dark:text-slate-400 italic">No pending invoices found for this client. A separate invoice will be created.</p>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3 sticky bottom-0 bg-white dark:bg-slate-800">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-md font-semibold hover:bg-slate-300 dark:hover:bg-slate-600"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting || !routerId || !selectedClientId || !category || total <= 0}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isSubmitting && (
                            <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                        )}
                        {isSubmitting ? 'Creating...' : 'Create Invoice'}
                    </button>
                </div>
            </div>
        </div>
    );
};
