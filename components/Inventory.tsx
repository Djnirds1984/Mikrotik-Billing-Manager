import React, { useState } from 'react';
import type { InventoryItem } from '../types.ts';
import { EditIcon, TrashIcon, ArchiveBoxIcon } from '../constants.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';

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


// --- Main Container Component ---
interface InventoryProps {
    items: InventoryItem[];
    addItem: (item: Omit<InventoryItem, 'id' | 'dateAdded'>) => void;
    updateItem: (item: InventoryItem) => void;
    deleteItem: (id: string) => void;
}

export const Inventory: React.FC<InventoryProps> = (props) => {
    return (
        <div className="max-w-7xl mx-auto">
             <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-6">Stock & Inventory</h2>
            <StockManager 
                items={props.items}
                addItem={props.addItem}
                updateItem={props.updateItem}
                deleteItem={props.deleteItem}
            />
        </div>
    );
};
