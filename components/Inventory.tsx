import React, { useState, useEffect, useCallback } from 'react';
import type { InventoryItem, EquipmentWithdrawal, RouterConfigWithId } from '../types.ts';
import { EditIcon, TrashIcon, ArchiveBoxIcon } from '../constants.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { useCustomers } from '../hooks/useCustomers.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { Loader } from './Loader.tsx';
import { dbApi } from '../services/databaseService.ts';

// --- Stock Management Components ---
interface ItemFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (item: InventoryItem | Omit<InventoryItem, 'id' | 'dateAdded'>) => void;
    initialData: InventoryItem | null;
}

const ItemFormModal: React.FC<ItemFormModalProps> = ({ isOpen, onClose, onSave, initialData }) => {
    const [item, setItem] = useState({ name: '', quantity: 1, price: '', serialNumber: '' });

    React.useEffect(() => {
        if (isOpen) {
            if (initialData) {
                setItem({
                    name: initialData.name,
                    quantity: initialData.quantity,
                    price: initialData.price?.toString() || '',
                    serialNumber: initialData.serialNumber || '',
                });
            } else {
                setItem({ name: '', quantity: 1, price: '', serialNumber: '' });
            }
        }
    }, [initialData, isOpen]);

    if (!isOpen) return null;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type } = e.target;
        setItem(prev => ({
            ...prev,
            [name]: type === 'number' ? parseInt(value, 10) || 0 : value
        }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const dataToSave = {
            ...item,
            price: item.price ? parseFloat(item.price) : undefined,
            quantity: Number(item.quantity),
        };

        if (initialData) {
            onSave({ ...initialData, ...dataToSave });
        } else {
            onSave(dataToSave);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg border border-slate-200 dark:border-slate-700">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400] mb-4">{initialData ? 'Edit Item' : 'Add New Item'}</h3>
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Item Name</label>
                                    <input type="text" name="name" id="name" value={item.name} onChange={handleChange} required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" placeholder="e.g., UBNT LiteBeam" />
                                </div>
                                <div>
                                    <label htmlFor="quantity" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Quantity</label>
                                    <input type="number" name="quantity" id="quantity" value={item.quantity} onChange={handleChange} required min="0" className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="price" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Price (Optional)</label>
                                    <input type="number" name="price" id="price" value={item.price} onChange={handleChange} min="0" step="0.01" className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" placeholder="0.00" />
                                </div>
                                <div>
                                    <label htmlFor="serialNumber" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Serial Number (Optional)</label>
                                    <input type="text" name="serialNumber" id="serialNumber" value={item.serialNumber} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" placeholder="e.g., SN123456789" />
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end space-x-3">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md">Cancel</button>
                        <button type="submit" className="px-4 py-2 text-sm rounded-md text-white bg-[--color-primary-600] hover:bg-[--color-primary-500]">Save Item</button>
                    </div>
                </form>
            </div>
        </div>
    );
};


const StockManager: React.FC<{
    items: InventoryItem[];
    addItem: (item: Omit<InventoryItem, 'id' | 'dateAdded'>) => void;
    updateItem: (item: InventoryItem) => void;
    deleteItem: (id: string) => void;
}> = ({ items, addItem, updateItem, deleteItem }) => {
    const { formatCurrency } = useLocalization();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);

    const handleDelete = (id: string) => {
        if (window.confirm("Are you sure you want to delete this item?")) {
            deleteItem(id);
        }
    };

    const handleSave = (itemData: InventoryItem | Omit<InventoryItem, 'id' | 'dateAdded'>) => {
        if ('id' in itemData) {
            updateItem(itemData as InventoryItem);
        } else {
            addItem(itemData);
        }
        setIsModalOpen(false);
        setEditingItem(null);
    };

    return (
        <div className="space-y-6">
            <ItemFormModal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditingItem(null); }} onSave={handleSave} initialData={editingItem} />
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md border border-slate-200 dark:border-slate-700">
                <div className="p-6 flex justify-between items-center">
                    <h3 className="text-xl font-bold">Stock Items</h3>
                    <button onClick={() => setIsModalOpen(true)} className="px-4 py-2 bg-[--color-primary-600] text-white rounded-md hover:bg-[--color-primary-500]">Add Item</button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                            <tr>
                                <th className="px-6 py-3">Name</th>
                                <th className="px-6 py-3">Quantity</th>
                                <th className="px-6 py-3">Price</th>
                                <th className="px-6 py-3">Serial Number</th>
                                <th className="px-6 py-3">Date Added</th>
                                <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map(item => (
                                <tr key={item.id} className="border-b border-slate-200 dark:border-slate-700 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <td className="px-6 py-4 font-medium">{item.name}</td>
                                    <td className="px-6 py-4">{item.quantity}</td>
                                    <td className="px-6 py-4 font-mono">{item.price ? formatCurrency(item.price) : '—'}</td>
                                    <td className="px-6 py-4 font-mono text-slate-500">{item.serialNumber || '—'}</td>
                                    <td className="px-6 py-4 text-slate-500">{new Date(item.dateAdded).toLocaleDateString()}</td>
                                    <td className="px-6 py-4 text-right space-x-2">
                                        <button onClick={() => { setEditingItem(item); setIsModalOpen(true); }} className="p-2 text-slate-500 hover:text-sky-500 rounded-md" title="Edit">
                                            <EditIcon className="h-5 w-5" />
                                        </button>
                                        <button onClick={() => handleDelete(item.id)} className="p-2 text-slate-500 hover:text-red-500 rounded-md" title="Delete">
                                            <TrashIcon className="h-5 w-5" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

// --- Withdraw Equipment Component ---
const WithdrawEquipment: React.FC<{
    items: InventoryItem[];
    onWithdrawSuccess: () => void;
    selectedRouter: RouterConfigWithId | null;
}> = ({ items, onWithdrawSuccess, selectedRouter }) => {
    const { formatCurrency } = useLocalization();
    const { user } = useAuth();
    const { customers } = useCustomers(selectedRouter?.id || null);

    const [withdrawals, setWithdrawals] = useState<EquipmentWithdrawal[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isWithdrawing, setIsWithdrawing] = useState(false);

    // Withdraw form state
    const [selectedItemId, setSelectedItemId] = useState('');
    const [withdrawQuantity, setWithdrawQuantity] = useState(1);
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    const [notes, setNotes] = useState('');

    const fetchWithdrawals = useCallback(async () => {
        try {
            const data = await dbApi.get<EquipmentWithdrawal[]>('/equipment-withdrawals');
            setWithdrawals(data.sort((a, b) => new Date(b.withdrawnDate).getTime() - new Date(a.withdrawnDate).getTime()));
        } catch (err) {
            console.error('Failed to fetch withdrawals:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchWithdrawals();
    }, [fetchWithdrawals]);

    const selectedItem = items.find(i => i.id === selectedItemId);
    const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

    const handleWithdraw = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedItem) return;
        if (withdrawQuantity > selectedItem.quantity) {
            alert(`Insufficient stock. Available: ${selectedItem.quantity}`);
            return;
        }

        setIsWithdrawing(true);
        try {
            await fetch('/api/equipment-withdrawals/process', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                },
                body: JSON.stringify({
                    inventoryItemId: selectedItem.id,
                    itemName: selectedItem.name,
                    quantity: withdrawQuantity,
                    customerId: selectedCustomer?.id || null,
                    customerName: selectedCustomer?.fullName || null,
                    customerUsername: selectedCustomer?.username || null,
                    notes: notes || null,
                    withdrawnBy: user?.username || null,
                    withdrawnDate: new Date().toISOString(),
                    routerId: selectedRouter?.id || null,
                })
            }).then(async res => {
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.message || 'Failed to process withdrawal');
                }
                return res.json();
            });

            // Reset form
            setSelectedItemId('');
            setWithdrawQuantity(1);
            setSelectedCustomerId('');
            setNotes('');

            // Refresh data
            await fetchWithdrawals();
            onWithdrawSuccess();
            alert('Equipment withdrawn successfully!');
        } catch (err) {
            alert(`Withdrawal failed: ${(err as Error).message}`);
        } finally {
            setIsWithdrawing(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Withdraw Form */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md border border-slate-200 dark:border-slate-700 p-6">
                <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400] mb-4">Withdraw Equipment</h3>
                <form onSubmit={handleWithdraw} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="withdrawItem" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Select Equipment</label>
                            <select
                                id="withdrawItem"
                                value={selectedItemId}
                                onChange={e => { setSelectedItemId(e.target.value); setWithdrawQuantity(1); }}
                                required
                                className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                            >
                                <option value="">-- Select Item --</option>
                                {items.filter(i => i.quantity > 0).map(item => (
                                    <option key={item.id} value={item.id}>
                                        {item.name} (Stock: {item.quantity})
                                    </option>
                                ))}
                            </select>
                            {selectedItem && (
                                <p className="mt-1 text-xs text-slate-500">
                                    Available: <span className="font-bold text-green-600">{selectedItem.quantity}</span>
                                    {selectedItem.price && ` · Unit Price: ${formatCurrency(selectedItem.price)}`}
                                </p>
                            )}
                        </div>
                        <div>
                            <label htmlFor="withdrawQty" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Quantity</label>
                            <input
                                type="number"
                                id="withdrawQty"
                                value={withdrawQuantity}
                                onChange={e => setWithdrawQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                                min={1}
                                max={selectedItem?.quantity || 1}
                                required
                                className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                            />
                        </div>
                    </div>
                    <div>
                        <label htmlFor="withdrawCustomer" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Assign to Client (Optional)</label>
                        <select
                            id="withdrawCustomer"
                            value={selectedCustomerId}
                            onChange={e => setSelectedCustomerId(e.target.value)}
                            className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                        >
                            <option value="">-- No Client --</option>
                            {customers.map(c => (
                                <option key={c.id} value={c.id}>
                                    {c.fullName || c.username} {c.accountNumber ? `(${c.accountNumber})` : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="withdrawNotes" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Notes (Optional)</label>
                        <input
                            type="text"
                            id="withdrawNotes"
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="e.g., Installation at client site"
                            className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white"
                        />
                    </div>
                    <div className="flex justify-end">
                        <button
                            type="submit"
                            disabled={isWithdrawing || !selectedItemId}
                            className="px-6 py-2 bg-orange-600 text-white font-semibold rounded-md hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {isWithdrawing ? 'Processing...' : 'Withdraw Equipment'}
                        </button>
                    </div>
                </form>
            </div>

            {/* Withdrawal Monitoring Table */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md border border-slate-200 dark:border-slate-700">
                <div className="p-6">
                    <h3 className="text-xl font-bold">Withdrawal History</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Monitor all withdrawn equipment and their assigned clients.</p>
                </div>
                <div className="overflow-x-auto">
                    {isLoading ? (
                        <div className="flex justify-center p-8"><Loader /></div>
                    ) : withdrawals.length === 0 ? (
                        <div className="text-center p-8 text-slate-500 dark:text-slate-400">
                            No equipment withdrawals recorded yet.
                        </div>
                    ) : (
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                                <tr>
                                    <th className="px-6 py-3">Date</th>
                                    <th className="px-6 py-3">Item</th>
                                    <th className="px-6 py-3">Qty</th>
                                    <th className="px-6 py-3">Client</th>
                                    <th className="px-6 py-3">Withdrawn By</th>
                                    <th className="px-6 py-3">Notes</th>
                                </tr>
                            </thead>
                            <tbody>
                                {withdrawals.map(w => (
                                    <tr key={w.id} className="border-b border-slate-200 dark:border-slate-700 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                        <td className="px-6 py-4 text-slate-500 whitespace-nowrap">
                                            {new Date(w.withdrawnDate).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4 font-medium">{w.itemName}</td>
                                        <td className="px-6 py-4">
                                            <span className="px-2 py-1 text-xs font-bold rounded-full bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">
                                                {w.quantity}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            {w.customerName ? (
                                                <div>
                                                    <p className="font-medium">{w.customerName}</p>
                                                    {w.customerUsername && <p className="text-xs text-slate-500">@{w.customerUsername}</p>}
                                                </div>
                                            ) : (
                                                <span className="text-slate-400 italic">Unassigned</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-slate-500">{w.withdrawnBy || '—'}</td>
                                        <td className="px-6 py-4 text-slate-500 max-w-[200px] truncate">{w.notes || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};

// --- Main Container Component ---
interface InventoryProps {
    items: InventoryItem[];
    addItem: (item: Omit<InventoryItem, 'id' | 'dateAdded'>) => void;
    updateItem: (item: InventoryItem) => void;
    deleteItem: (id: string) => void;
    reload?: () => void;
    selectedRouter?: RouterConfigWithId | null;
}

export const Inventory: React.FC<InventoryProps> = (props) => {
    const [activeTab, setActiveTab] = useState<'stock' | 'withdraw'>('stock');

    return (
        <div className="max-w-7xl mx-auto">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-6">Stock & Inventory</h2>

            {/* Tab Navigation */}
            <div className="flex border-b border-slate-200 dark:border-slate-700 mb-6">
                <button
                    onClick={() => setActiveTab('stock')}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'stock' ? 'border-[--color-primary-500] text-[--color-primary-500] dark:text-[--color-primary-400]' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                >
                    <ArchiveBoxIcon className="h-5 w-5" />
                    Stock Items
                </button>
                <button
                    onClick={() => setActiveTab('withdraw')}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'withdraw' ? 'border-[--color-primary-500] text-[--color-primary-500] dark:text-[--color-primary-400]' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Withdraw Equipment
                </button>
            </div>

            {activeTab === 'stock' && (
                <StockManager
                    items={props.items}
                    addItem={props.addItem}
                    updateItem={props.updateItem}
                    deleteItem={props.deleteItem}
                />
            )}

            {activeTab === 'withdraw' && (
                <WithdrawEquipment
                    items={props.items}
                    onWithdrawSuccess={props.reload || (() => {})}
                    selectedRouter={props.selectedRouter || null}
                />
            )}
        </div>
    );
};
