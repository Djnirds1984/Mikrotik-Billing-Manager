import React, { useState, useMemo } from 'react';
import type { InventoryItem, ExpenseRecord } from '../types.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { Loader } from './Loader.tsx';
import { EditIcon, TrashIcon, ArchiveBoxIcon, CurrencyDollarIcon } from '../constants.tsx';

// --- Inventory Modal ---
const ItemFormModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (item: Omit<InventoryItem, 'id' | 'dateAdded'> | InventoryItem) => void;
    item: InventoryItem | null;
}> = ({ isOpen, onClose, onSave, item }) => {
    const [formState, setFormState] = useState({ name: '', quantity: 1, price: 0, serialNumber: '' });

    React.useEffect(() => {
        if (isOpen) {
            setFormState(item ? { name: item.name, quantity: item.quantity, price: item.price || 0, serialNumber: item.serialNumber || '' } : { name: '', quantity: 1, price: 0, serialNumber: '' });
        }
    }, [isOpen, item]);

    if (!isOpen) return null;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: (name === 'quantity' || name === 'price') ? parseFloat(value) || 0 : value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(item ? { ...formState, id: item.id, dateAdded: item.dateAdded } : formState);
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold mb-4">{item ? 'Edit' : 'Add'} Inventory Item</h3>
                        {/* Form fields */}
                        <div className="space-y-4">
                            <div><label>Item Name</label><input name="name" value={formState.name} onChange={handleChange} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md"/></div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label>Quantity</label><input type="number" name="quantity" value={formState.quantity} onChange={handleChange} required min="0" className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md"/></div>
                                <div><label>Price (per item)</label><input type="number" name="price" value={formState.price} onChange={handleChange} min="0" step="0.01" className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md"/></div>
                            </div>
                            <div><label>Serial Number</label><input name="serialNumber" value={formState.serialNumber} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md"/></div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-4">
                        <button type="button" onClick={onClose}>Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-sky-600 text-white rounded-md">Save</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- Expense Modal ---
const ExpenseFormModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (expense: Omit<ExpenseRecord, 'id'> | ExpenseRecord) => void;
    expense: ExpenseRecord | null;
}> = ({ isOpen, onClose, onSave, expense }) => {
    const [formState, setFormState] = useState({ date: new Date().toISOString().split('T')[0], category: 'Utilities', description: '', amount: 0 });

    React.useEffect(() => {
        if (isOpen) {
            setFormState(expense ? { date: expense.date, category: expense.category, description: expense.description, amount: expense.amount } : { date: new Date().toISOString().split('T')[0], category: 'Utilities', description: '', amount: 0 });
        }
    }, [isOpen, expense]);

    if (!isOpen) return null;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: name === 'amount' ? parseFloat(value) || 0 : value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(expense ? { ...formState, id: expense.id } : formState);
    };
    
    return (
         <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold mb-4">{expense ? 'Edit' : 'Add'} Expense</h3>
                         <div className="space-y-4">
                            <div><label>Date</label><input type="date" name="date" value={formState.date} onChange={handleChange} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md"/></div>
                            <div><label>Category</label><select name="category" value={formState.category} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md"><option>Utilities</option><option>Supplies</option><option>Salary</option><option>Rent</option><option>Maintenance</option><option>Other</option></select></div>
                             <div><label>Description</label><textarea name="description" value={formState.description} onChange={handleChange} required rows={2} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md"/></div>
                            <div><label>Amount</label><input type="number" name="amount" value={formState.amount} onChange={handleChange} required min="0" step="0.01" className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md"/></div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-4">
                        <button type="button" onClick={onClose}>Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-sky-600 text-white rounded-md">Save</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// --- Main Inventory Component ---
type InventoryTab = 'inventory' | 'expenses';

export const Inventory: React.FC<{
    items: InventoryItem[],
    addItem: (item: Omit<InventoryItem, 'id' | 'dateAdded'>) => void,
    updateItem: (item: InventoryItem) => void,
    deleteItem: (id: string) => void,
    expenses: ExpenseRecord[],
    addExpense: (expense: Omit<ExpenseRecord, 'id'>) => void,
    updateExpense: (expense: ExpenseRecord) => void,
    deleteExpense: (id: string) => void
}> = ({ items, addItem, updateItem, deleteItem, expenses, addExpense, updateExpense, deleteExpense }) => {
    const { formatCurrency } = useLocalization();
    const [activeTab, setActiveTab] = useState<InventoryTab>('inventory');
    
    const [isItemModalOpen, setIsItemModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
    const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
    const [editingExpense, setEditingExpense] = useState<ExpenseRecord | null>(null);

    const totalInventoryValue = useMemo(() => items.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0), [items]);
    const totalExpenses = useMemo(() => expenses.reduce((sum, expense) => sum + expense.amount, 0), [expenses]);
    
    return (
        <div className="space-y-6">
            <ItemFormModal isOpen={isItemModalOpen} onClose={() => setIsItemModalOpen(false)} onSave={(item) => { 'id' in item ? updateItem(item) : addItem(item); setIsItemModalOpen(false); }} item={editingItem} />
            <ExpenseFormModal isOpen={isExpenseModalOpen} onClose={() => setIsExpenseModalOpen(false)} onSave={(expense) => { 'id' in expense ? updateExpense(expense) : addExpense(expense); setIsExpenseModalOpen(false); }} expense={editingExpense} />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="p-6 bg-white dark:bg-slate-800 border rounded-lg flex items-center gap-4"><ArchiveBoxIcon className="w-10 h-10 text-sky-500"/><div className="text-right"><p className="text-sm text-slate-500">Total Inventory Value</p><p className="text-3xl font-bold">{formatCurrency(totalInventoryValue)}</p></div></div>
                 <div className="p-6 bg-white dark:bg-slate-800 border rounded-lg flex items-center gap-4"><CurrencyDollarIcon className="w-10 h-10 text-red-500"/><div className="text-right"><p className="text-sm text-slate-500">Total Expenses</p><p className="text-3xl font-bold">{formatCurrency(totalExpenses)}</p></div></div>
            </div>

            <div className="border-b border-slate-200 dark:border-slate-700">
                <nav className="flex space-x-2"><button onClick={() => setActiveTab('inventory')} className={`px-4 py-2 ${activeTab === 'inventory' ? 'border-b-2 border-sky-500' : ''}`}>Inventory</button><button onClick={() => setActiveTab('expenses')} className={`px-4 py-2 ${activeTab === 'expenses' ? 'border-b-2 border-sky-500' : ''}`}>Expenses</button></nav>
            </div>

            {activeTab === 'inventory' && (
                <div>
                    <div className="flex justify-end mb-4"><button onClick={() => { setEditingItem(null); setIsItemModalOpen(true); }} className="bg-sky-600 text-white font-bold py-2 px-4 rounded-lg">Add Item</button></div>
                    <div className="bg-white dark:bg-slate-800 border rounded-lg shadow-md overflow-hidden">
                        <table className="w-full text-sm">
                            <thead><tr><th className="px-6 py-3">Item</th><th className="px-6 py-3">Quantity</th><th className="px-6 py-3">Price</th><th className="px-6 py-3">Serial</th><th className="px-6 py-3 text-right">Actions</th></tr></thead>
                            <tbody>{items.map(item => (<tr key={item.id}><td className="px-6 py-4">{item.name}</td><td className="px-6 py-4">{item.quantity}</td><td className="px-6 py-4">{formatCurrency(item.price || 0)}</td><td className="px-6 py-4">{item.serialNumber}</td><td className="px-6 py-4 text-right"><button onClick={() => {setEditingItem(item); setIsItemModalOpen(true);}}><EditIcon className="w-5 h-5"/></button><button onClick={() => deleteItem(item.id)}><TrashIcon className="w-5 h-5"/></button></td></tr>))}</tbody>
                        </table>
                    </div>
                </div>
            )}
            {activeTab === 'expenses' && (
                <div>
                    <div className="flex justify-end mb-4"><button onClick={() => { setEditingExpense(null); setIsExpenseModalOpen(true); }} className="bg-red-600 text-white font-bold py-2 px-4 rounded-lg">Add Expense</button></div>
                    <div className="bg-white dark:bg-slate-800 border rounded-lg shadow-md overflow-hidden">
                        <table className="w-full text-sm">
                             <thead><tr><th className="px-6 py-3">Date</th><th className="px-6 py-3">Category</th><th className="px-6 py-3">Description</th><th className="px-6 py-3">Amount</th><th className="px-6 py-3 text-right">Actions</th></tr></thead>
                            <tbody>{expenses.map(exp => (<tr key={exp.id}><td className="px-6 py-4">{new Date(exp.date).toLocaleDateString()}</td><td className="px-6 py-4">{exp.category}</td><td className="px-6 py-4">{exp.description}</td><td className="px-6 py-4">{formatCurrency(exp.amount)}</td><td className="px-6 py-4 text-right"><button onClick={() => {setEditingExpense(exp); setIsExpenseModalOpen(true);}}><EditIcon className="w-5 h-5"/></button><button onClick={() => deleteExpense(exp.id)}><TrashIcon className="w-5 h-5"/></button></td></tr>))}</tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};
