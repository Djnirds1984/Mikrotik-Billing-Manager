import React, { useState, useMemo } from 'react';
import type { InventoryItem, ExpenseRecord, PisowifiIncomeRecord } from '../types.ts';
// FIX: Import missing ReceiptPercentIcon.
import { EditIcon, TrashIcon, SearchIcon, ArchiveBoxIcon, ReceiptPercentIcon, CurrencyDollarIcon } from '../constants.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';

// --- Helper: Download as CSV ---
const downloadCSV = (data: any[], filename: string) => {
    if (data.length === 0) {
        alert("There is no data to export.");
        return;
    }
    const headers = Object.keys(data[0]);
    const csvRows = [
        headers.join(','),
        ...data.map(row => 
            headers.map(header => 
                JSON.stringify(row[header], (_, value) => value === null ? '' : value)
            ).join(',')
        )
    ];
    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

// --- Stock Management Components ---
interface ItemFormModalProps { /* ... */ }
// (ItemFormModal remains the same as before)
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
                                    <input type="number" name="price" id="price" value={item.price} onChange={handleChange} min="0" step="0.01" className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" placeholder="e.g., 99.99" />
                                </div>
                                <div>
                                    <label htmlFor="serialNumber" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Serial Number (Optional)</label>
                                    <input type="text" name="serialNumber" id="serialNumber" value={item.serialNumber} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" placeholder="For devices like modems" />
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
                        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-md text-white bg-[--color-primary-600] hover:bg-[--color-primary-500]">
                            Save Item
                        </button>
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
    deleteItem: (itemId: string) => void;
}> = ({ items, addItem, updateItem, deleteItem }) => {
    const { formatCurrency } = useLocalization();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    const filteredItems = useMemo(() => {
        if (!searchTerm.trim()) return items;
        const lowerCaseTerm = searchTerm.toLowerCase();
        return items.filter(item =>
            item.name.toLowerCase().includes(lowerCaseTerm) ||
            (item.serialNumber && item.serialNumber.toLowerCase().includes(lowerCaseTerm))
        );
    }, [items, searchTerm]);
    
    const handleSave = (itemData: InventoryItem | Omit<InventoryItem, 'id' | 'dateAdded'>) => {
        if ('id' in itemData) {
            updateItem(itemData);
        } else {
            addItem(itemData);
        }
        setIsModalOpen(false);
    };

    const handleEdit = (item: InventoryItem) => {
        setEditingItem(item);
        setIsModalOpen(true);
    };
    
    const handleAdd = () => {
        setEditingItem(null);
        setIsModalOpen(true);
    }
    
    const handleDelete = (itemId: string) => {
        if (window.confirm("Are you sure you want to delete this item?")) {
            deleteItem(itemId);
        }
    };

    return (
        <div>
            <ItemFormModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSave} initialData={editingItem} />
            <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-6">
                 <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3"><SearchIcon className="h-5 w-5 text-slate-400" /></span>
                    <input type="text" placeholder="Search by name or serial..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full md:w-64 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 pl-10 pr-4 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[--color-primary-500]" />
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => downloadCSV(items, 'inventory.csv')} className="px-4 py-2 text-sm text-white bg-sky-600 hover:bg-sky-500 rounded-lg font-semibold">Export CSV</button>
                    <button onClick={handleAdd} className="bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-bold py-2 px-4 rounded-lg flex-shrink-0">Add New Item</button>
                </div>
            </div>
             <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                            <tr>
                                <th className="px-6 py-3">Item Name</th><th className="px-6 py-3 text-center">Quantity</th><th className="px-6 py-3">Price</th>
                                <th className="px-6 py-3">Serial Number</th><th className="px-6 py-3">Date Added</th><th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredItems.length > 0 ? filteredItems.map(item => (
                                <tr key={item.id} className="border-b border-slate-200 dark:border-slate-700 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <td className="px-6 py-4 font-medium text-slate-900 dark:text-slate-200">{item.name}</td>
                                    <td className="px-6 py-4 text-center font-mono text-cyan-600 dark:text-cyan-400">{item.quantity}</td>
                                    <td className="px-6 py-4 font-mono text-green-600 dark:text-green-400">{item.price ? formatCurrency(item.price) : <span className="text-slate-500">N/A</span>}</td>
                                    <td className="px-6 py-4 font-mono text-slate-600 dark:text-slate-300">{item.serialNumber || <span className="text-slate-500">N/A</span>}</td>
                                    <td className="px-6 py-4 text-slate-500 dark:text-slate-400">{new Date(item.dateAdded).toLocaleDateString()}</td>
                                    <td className="px-6 py-4 text-right space-x-1">
                                        <button onClick={() => handleEdit(item)} className="p-2 text-slate-500 dark:text-slate-400 hover:text-[--color-primary-500] dark:hover:text-[--color-primary-400] rounded-md"><EditIcon className="h-5 w-5" /></button>
                                        <button onClick={() => handleDelete(item.id)} className="p-2 text-slate-500 dark:text-slate-400 hover:text-red-500 rounded-md"><TrashIcon className="h-5 w-5" /></button>
                                    </td>
                                </tr>
                            )) : (
                                <tr><td colSpan={6} className="text-center py-8 text-slate-500">{items.length > 0 ? 'No items found.' : 'Your inventory is empty.'}</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};


// --- Expenses & Accounting Components ---
const EXPENSE_CATEGORIES = ["Salary", "Utilities", "Rent", "Supplies", "Marketing", "Travel", "Other"];

interface ExpenseFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (expense: ExpenseRecord | Omit<ExpenseRecord, 'id'>) => void;
    initialData: ExpenseRecord | null;
}
const ExpenseFormModal: React.FC<ExpenseFormModalProps> = ({ isOpen, onClose, onSave, initialData }) => {
    const [expense, setExpense] = useState({ date: new Date().toISOString().split('T')[0], category: EXPENSE_CATEGORIES[0], description: '', amount: '' });

    React.useEffect(() => {
        if (isOpen) {
            if (initialData) {
                setExpense({ date: initialData.date, category: initialData.category, description: initialData.description, amount: initialData.amount.toString() });
            } else {
                setExpense({ date: new Date().toISOString().split('T')[0], category: EXPENSE_CATEGORIES[0], description: '', amount: '' });
            }
        }
    }, [initialData, isOpen]);

    if (!isOpen) return null;
    
    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setExpense(prev => ({...prev, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const dataToSave = { ...expense, amount: parseFloat(expense.amount) || 0 };
        onSave(initialData ? { ...initialData, ...dataToSave } : dataToSave);
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
             <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg border border-slate-200 dark:border-slate-700">
                <form onSubmit={handleSubmit}>
                    <div className="p-6"><h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400] mb-4">{initialData ? 'Edit Expense' : 'Add New Expense'}</h3>
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div><label htmlFor="date" className="block text-sm font-medium">Date</label><input type="date" name="date" id="date" value={expense.date} onChange={handleChange} required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2" /></div>
                                <div><label htmlFor="amount" className="block text-sm font-medium">Amount</label><input type="number" name="amount" id="amount" value={expense.amount} onChange={handleChange} required min="0" step="0.01" className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2" /></div>
                            </div>
                             <div><label htmlFor="category" className="block text-sm font-medium">Category</label><select name="category" id="category" value={expense.category} onChange={handleChange} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2">{EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                            <div><label htmlFor="description" className="block text-sm font-medium">Description</label><textarea name="description" id="description" value={expense.description} onChange={handleChange} rows={2} className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2"></textarea></div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end space-x-3"><button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md">Cancel</button><button type="submit" className="px-4 py-2 text-sm rounded-md text-white bg-[--color-primary-600] hover:bg-[--color-primary-500]">Save Expense</button></div>
                </form>
            </div>
        </div>
    );
};


const ExpensesManager: React.FC<{
    expenses: ExpenseRecord[];
    addExpense: (expense: Omit<ExpenseRecord, 'id'>) => void;
    updateExpense: (expense: ExpenseRecord) => void;
    deleteExpense: (expenseId: string) => void;
}> = ({ expenses, addExpense, updateExpense, deleteExpense }) => {
    const { formatCurrency } = useLocalization();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingExpense, setEditingExpense] = useState<ExpenseRecord | null>(null);

    const totalExpenses = useMemo(() => expenses.reduce((sum, item) => sum + item.amount, 0), [expenses]);
    
    const handleSave = (expenseData: ExpenseRecord | Omit<ExpenseRecord, 'id'>) => {
        if ('id' in expenseData) updateExpense(expenseData);
        else addExpense(expenseData);
        setIsModalOpen(false);
    };

    const handleEdit = (expense: ExpenseRecord) => {
        setEditingExpense(expense);
        setIsModalOpen(true);
    };

    const handleDelete = (expenseId: string) => {
        if (window.confirm("Are you sure you want to delete this expense record?")) {
            deleteExpense(expenseId);
        }
    };
    
    return (
        <div>
            <ExpenseFormModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSave} initialData={editingExpense} />
            <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                 <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 col-span-1 md:col-span-3">
                    <p className="text-sm text-slate-500 dark:text-slate-400">Total Expenses</p>
                    <p className="text-3xl font-bold text-red-600 dark:text-red-400">{formatCurrency(totalExpenses)}</p>
                </div>
            </div>
            <div className="flex justify-end gap-2 mb-6">
                <button onClick={() => downloadCSV(expenses, 'expenses.csv')} className="px-4 py-2 text-sm text-white bg-sky-600 hover:bg-sky-500 rounded-lg font-semibold">Export CSV</button>
                <button onClick={() => { setEditingExpense(null); setIsModalOpen(true); }} className="bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-bold py-2 px-4 rounded-lg">Add New Expense</button>
            </div>
             <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md overflow-hidden">
                <div className="overflow-x-auto"><table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50"><tr><th className="px-6 py-3">Date</th><th className="px-6 py-3">Category</th><th className="px-6 py-3">Description</th><th className="px-6 py-3 text-right">Amount</th><th className="px-6 py-3 text-right">Actions</th></tr></thead>
                    <tbody>{expenses.map(exp => <tr key={exp.id} className="border-b"><td className="px-6 py-4">{new Date(exp.date).toLocaleDateString()}</td><td className="px-6 py-4">{exp.category}</td><td className="px-6 py-4">{exp.description}</td><td className="px-6 py-4 text-right font-mono">{formatCurrency(exp.amount)}</td><td className="px-6 py-4 text-right"><button onClick={()=>handleEdit(exp)} className="p-2"><EditIcon className="h-5 w-5"/></button><button onClick={()=>handleDelete(exp.id)} className="p-2"><TrashIcon className="h-5 w-5"/></button></td></tr>)}</tbody>
                </table></div>
            </div>
        </div>
    );
};

interface PisowifiIncomeFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (record: PisowifiIncomeRecord | Omit<PisowifiIncomeRecord, 'id' | 'createdAt'>) => void;
    initialData: PisowifiIncomeRecord | null;
}

const PisowifiIncomeFormModal: React.FC<PisowifiIncomeFormModalProps> = ({ isOpen, onClose, onSave, initialData }) => {
    const [form, setForm] = useState({
        resellerName: '',
        vendoLocation: '',
        percentage: '',
        grossSales: '',
        expenses: '',
    });

    const computedNetTotal = useMemo(() => {
        const gross = parseFloat(form.grossSales) || 0;
        const exp = parseFloat(form.expenses) || 0;
        return gross - exp;
    }, [form.grossSales, form.expenses]);

    React.useEffect(() => {
        if (!isOpen) return;
        if (initialData) {
            setForm({
                resellerName: initialData.resellerName || '',
                vendoLocation: initialData.vendoLocation || '',
                percentage: String(initialData.percentage ?? ''),
                grossSales: String(initialData.grossSales ?? ''),
                expenses: String(initialData.expenses ?? ''),
            });
        } else {
            setForm({ resellerName: '', vendoLocation: '', percentage: '', grossSales: '', expenses: '' });
        }
    }, [initialData, isOpen]);

    if (!isOpen) return null;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setForm(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const dataToSave = {
            resellerName: form.resellerName.trim(),
            vendoLocation: form.vendoLocation.trim(),
            percentage: parseFloat(form.percentage) || 0,
            grossSales: parseFloat(form.grossSales) || 0,
            expenses: parseFloat(form.expenses) || 0,
            netTotal: computedNetTotal,
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
                        <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400] mb-4">{initialData ? 'Edit Pisowifi Income' : 'Add Pisowifi Income'}</h3>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="resellerName" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Reseller Name</label>
                                <input type="text" name="resellerName" id="resellerName" value={form.resellerName} onChange={handleChange} required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                            </div>
                            <div>
                                <label htmlFor="vendoLocation" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Vendo Location</label>
                                <input type="text" name="vendoLocation" id="vendoLocation" value={form.vendoLocation} onChange={handleChange} required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="percentage" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Percentage</label>
                                    <input type="number" name="percentage" id="percentage" value={form.percentage} onChange={handleChange} min="0" step="0.01" className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" placeholder="e.g., 10" />
                                </div>
                                <div>
                                    <label htmlFor="grossSales" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Gross Sales</label>
                                    <input type="number" name="grossSales" id="grossSales" value={form.grossSales} onChange={handleChange} required min="0" step="0.01" className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="expenses" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Expenses</label>
                                    <input type="number" name="expenses" id="expenses" value={form.expenses} onChange={handleChange} required min="0" step="0.01" className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                                </div>
                                <div>
                                    <label htmlFor="netTotal" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Net Total</label>
                                    <input type="number" name="netTotal" id="netTotal" value={computedNetTotal.toFixed(2)} readOnly className="mt-1 block w-full bg-slate-200 dark:bg-slate-600 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white" />
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Cancel</button>
                        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-md text-white bg-[--color-primary-600] hover:bg-[--color-primary-500]">
                            Save
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const PisowifiIncomeManager: React.FC<{
    records: PisowifiIncomeRecord[];
    addRecord: (record: Omit<PisowifiIncomeRecord, 'id' | 'createdAt'>) => void;
    updateRecord: (record: PisowifiIncomeRecord) => void;
    deleteRecord: (recordId: string) => void;
}> = ({ records, addRecord, updateRecord, deleteRecord }) => {
    const { formatCurrency } = useLocalization();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingRecord, setEditingRecord] = useState<PisowifiIncomeRecord | null>(null);

    const totals = useMemo(() => {
        return records.reduce(
            (acc, r) => {
                acc.gross += Number(r.grossSales) || 0;
                acc.expenses += Number(r.expenses) || 0;
                acc.net += Number(r.netTotal) || 0;
                return acc;
            },
            { gross: 0, expenses: 0, net: 0 }
        );
    }, [records]);

    const handleSave = (data: PisowifiIncomeRecord | Omit<PisowifiIncomeRecord, 'id' | 'createdAt'>) => {
        if ('id' in data) updateRecord(data);
        else addRecord(data);
        setIsModalOpen(false);
    };

    const handleDelete = (recordId: string) => {
        if (window.confirm("Are you sure you want to delete this record?")) {
            deleteRecord(recordId);
        }
    };

    return (
        <div>
            <PisowifiIncomeFormModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSave} initialData={editingRecord} />

            <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                    <p className="text-sm text-slate-500 dark:text-slate-400">Gross Sales</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{formatCurrency(totals.gross)}</p>
                </div>
                <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                    <p className="text-sm text-slate-500 dark:text-slate-400">Expenses</p>
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400">{formatCurrency(totals.expenses)}</p>
                </div>
                <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                    <p className="text-sm text-slate-500 dark:text-slate-400">Net Total</p>
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">{formatCurrency(totals.net)}</p>
                </div>
            </div>

            <div className="flex justify-end gap-2 mb-6">
                <button onClick={() => downloadCSV(records, 'pisowifi_income.csv')} className="px-4 py-2 text-sm text-white bg-sky-600 hover:bg-sky-500 rounded-lg font-semibold">Export CSV</button>
                <button onClick={() => { setEditingRecord(null); setIsModalOpen(true); }} className="bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-bold py-2 px-4 rounded-lg">Add Income</button>
            </div>

            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                            <tr>
                                <th className="px-6 py-3">Reseller Name</th>
                                <th className="px-6 py-3">Vendo Location</th>
                                <th className="px-6 py-3 text-right">Percentage</th>
                                <th className="px-6 py-3 text-right">Gross Sales</th>
                                <th className="px-6 py-3 text-right">Expenses</th>
                                <th className="px-6 py-3 text-right">Net Total</th>
                                <th className="px-6 py-3">Date</th>
                                <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {records.length > 0 ? records.map(r => (
                                <tr key={r.id} className="border-b border-slate-200 dark:border-slate-700 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <td className="px-6 py-4 font-medium text-slate-900 dark:text-slate-200">{r.resellerName}</td>
                                    <td className="px-6 py-4 text-slate-600 dark:text-slate-300">{r.vendoLocation}</td>
                                    <td className="px-6 py-4 text-right font-mono text-slate-700 dark:text-slate-200">{(Number(r.percentage) || 0).toFixed(2)}%</td>
                                    <td className="px-6 py-4 text-right font-mono text-slate-900 dark:text-slate-100">{formatCurrency(Number(r.grossSales) || 0)}</td>
                                    <td className="px-6 py-4 text-right font-mono text-red-600 dark:text-red-400">{formatCurrency(Number(r.expenses) || 0)}</td>
                                    <td className="px-6 py-4 text-right font-mono text-green-600 dark:text-green-400">{formatCurrency(Number(r.netTotal) || 0)}</td>
                                    <td className="px-6 py-4 text-slate-500 dark:text-slate-400">{r.createdAt ? new Date(r.createdAt).toLocaleString() : ''}</td>
                                    <td className="px-6 py-4 text-right space-x-1">
                                        <button onClick={() => { setEditingRecord(r); setIsModalOpen(true); }} className="p-2 text-slate-500 dark:text-slate-400 hover:text-[--color-primary-500] dark:hover:text-[--color-primary-400] rounded-md"><EditIcon className="h-5 w-5" /></button>
                                        <button onClick={() => handleDelete(r.id)} className="p-2 text-slate-500 dark:text-slate-400 hover:text-red-500 rounded-md"><TrashIcon className="h-5 w-5" /></button>
                                    </td>
                                </tr>
                            )) : (
                                <tr><td colSpan={8} className="text-center py-8 text-slate-500">No records yet.</td></tr>
                            )}
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
    deleteItem: (itemId: string) => void;
    expenses: ExpenseRecord[];
    addExpense: (expense: Omit<ExpenseRecord, 'id'>) => void;
    updateExpense: (expense: ExpenseRecord) => void;
    deleteExpense: (expenseId: string) => void;
    pisowifiIncome: PisowifiIncomeRecord[];
    addPisowifiIncome: (record: Omit<PisowifiIncomeRecord, 'id' | 'createdAt'>) => void;
    updatePisowifiIncome: (record: PisowifiIncomeRecord) => void;
    deletePisowifiIncome: (recordId: string) => void;
}

const TabButton: React.FC<{ label: string, icon: React.ReactNode, isActive: boolean, onClick: () => void }> = ({ label, icon, isActive, onClick }) => (
    <button onClick={onClick} className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors duration-200 ${isActive ? 'border-[--color-primary-500] text-[--color-primary-500]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{icon}{label}</button>
);

export const Inventory: React.FC<InventoryProps> = (props) => {
    const [activeTab, setActiveTab] = useState<'stock' | 'expenses' | 'pisowifi'>('stock');

    return (
        <div className="max-w-7xl mx-auto">
             <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-6">Stock & Inventory</h2>
             <div className="border-b border-slate-200 dark:border-slate-700 mb-6">
                <nav className="flex -mb-px">
                    <TabButton label="Stock Management" icon={<ArchiveBoxIcon className="w-5 h-5" />} isActive={activeTab === 'stock'} onClick={() => setActiveTab('stock')} />
                    <TabButton label="Expenses & Accounting" icon={<ReceiptPercentIcon className="w-5 h-5" />} isActive={activeTab === 'expenses'} onClick={() => setActiveTab('expenses')} />
                    <TabButton label="Pisowifi Income" icon={<CurrencyDollarIcon className="w-5 h-5" />} isActive={activeTab === 'pisowifi'} onClick={() => setActiveTab('pisowifi')} />
                </nav>
            </div>

            {activeTab === 'stock' && (
                <StockManager 
                    items={props.items}
                    addItem={props.addItem}
                    updateItem={props.updateItem}
                    deleteItem={props.deleteItem}
                />
            )}
            {activeTab === 'expenses' && (
                <ExpensesManager 
                    expenses={props.expenses}
                    addExpense={props.addExpense}
                    updateExpense={props.updateExpense}
                    deleteExpense={props.deleteExpense}
                />
            )}
            {activeTab === 'pisowifi' && (
                <PisowifiIncomeManager
                    records={props.pisowifiIncome}
                    addRecord={props.addPisowifiIncome}
                    updateRecord={props.updatePisowifiIncome}
                    deleteRecord={props.deletePisowifiIncome}
                />
            )}
        </div>
    );
};
