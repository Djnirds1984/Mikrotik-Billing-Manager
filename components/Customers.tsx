import React, { useState, useMemo } from 'react';
import { useCustomers } from '../hooks/useCustomers.ts';
import type { Customer } from '../types.ts';
import type { RouterConfigWithId } from '../types.ts';

// Icons
const PlusIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
);
const PencilIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
);
const TrashIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
);
const SearchIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
);

// --- Customer Form Modal ---
interface CustomerFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: Omit<Customer, 'id'> | Customer) => void;
    initialData: Customer | null;
    isSubmitting: boolean;
    routerId: string;
}

const CustomerFormModal: React.FC<CustomerFormModalProps> = ({ isOpen, onClose, onSave, initialData, isSubmitting, routerId }) => {
    const [form, setForm] = React.useState({
        fullName: '',
        address: '',
        contactNumber: '',
        email: '',
        gps: '',
        username: '',
        accountNumber: '',
    });

    React.useEffect(() => {
        if (!isOpen) return;
        if (initialData) {
            setForm({
                fullName: initialData.fullName || '',
                address: initialData.address || '',
                contactNumber: initialData.contactNumber || '',
                email: initialData.email || '',
                gps: initialData.gps || '',
                username: initialData.username || '',
                accountNumber: initialData.accountNumber || '',
            });
        } else {
            setForm({
                fullName: '',
                address: '',
                contactNumber: '',
                email: '',
                gps: '',
                username: '',
                accountNumber: '',
            });
        }
    }, [isOpen, initialData]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.fullName.trim()) {
            alert('Full Name is required.');
            return;
        }
        if (initialData) {
            onSave({ ...initialData, ...form, routerId });
        } else {
            onSave({ ...form, routerId } as Omit<Customer, 'id'>);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
                <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
                    <div className="p-6 overflow-y-auto">
                        <h3 className="text-xl font-bold mb-4">{initialData ? 'Edit Customer' : 'Add New Customer'}</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Full Name <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    value={form.fullName}
                                    onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
                                    required
                                    className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="Juan Dela Cruz"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Username</label>
                                <input
                                    type="text"
                                    value={form.username}
                                    onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                                    disabled={!!initialData}
                                    className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 disabled:opacity-50 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="pppoe_username"
                                />
                                {!initialData && <p className="text-xs text-slate-500 mt-1">Optional. If linked to a PPPoE user.</p>}
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Full Address</label>
                                <input
                                    type="text"
                                    value={form.address}
                                    onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                                    className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="123 Main St, Brgy, City"
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Contact Number</label>
                                    <input
                                        type="text"
                                        value={form.contactNumber}
                                        onChange={e => setForm(f => ({ ...f, contactNumber: e.target.value }))}
                                        className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        placeholder="09XX-XXX-XXXX"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Email</label>
                                    <input
                                        type="email"
                                        value={form.email}
                                        onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                                        className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        placeholder="customer@email.com"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">GPS Coordinates</label>
                                <input
                                    type="text"
                                    value={form.gps}
                                    onChange={e => setForm(f => ({ ...f, gps: e.target.value }))}
                                    className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="e.g. 9.124384, 125.534409"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Account Number</label>
                                <input
                                    type="text"
                                    value={form.accountNumber}
                                    onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))}
                                    className="mt-1 w-full p-2 rounded-md bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="Auto-generated if left blank"
                                />
                                <p className="text-xs text-slate-500 mt-1">Leave blank to auto-generate.</p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-3 flex-shrink-0 border-t border-slate-200 dark:border-slate-700">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600">
                            Cancel
                        </button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                            {isSubmitting ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- Main Customers Component ---
interface CustomersProps {
    selectedRouter: RouterConfigWithId | null;
}

export const Customers: React.FC<CustomersProps> = ({ selectedRouter }) => {
    const routerId = selectedRouter?.id || null;
    const { customers, addCustomer, updateCustomer, deleteCustomer, isLoading, error } = useCustomers(routerId);

    const [isModalOpen, setModalOpen] = useState(false);
    const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    const filteredCustomers = useMemo(() => {
        if (!searchTerm.trim()) return customers;
        const q = searchTerm.toLowerCase();
        return customers.filter(c =>
            (c.fullName || '').toLowerCase().includes(q) ||
            (c.username || '').toLowerCase().includes(q) ||
            (c.email || '').toLowerCase().includes(q) ||
            (c.contactNumber || '').toLowerCase().includes(q) ||
            (c.accountNumber || '').toLowerCase().includes(q) ||
            (c.address || '').toLowerCase().includes(q)
        );
    }, [customers, searchTerm]);

    const handleOpenAdd = () => {
        setEditingCustomer(null);
        setModalOpen(true);
    };

    const handleOpenEdit = (customer: Customer) => {
        setEditingCustomer(customer);
        setModalOpen(true);
    };

    const handleDelete = async (customer: Customer) => {
        if (!window.confirm(`Are you sure you want to delete customer "${customer.fullName || customer.username}"?`)) return;
        await deleteCustomer(customer.id);
    };

    const handleSave = async (data: Omit<Customer, 'id'> | Customer) => {
        setIsSubmitting(true);
        try {
            if ('id' in data && data.id) {
                await updateCustomer(data as Customer);
            } else {
                // Generate a username if not provided
                const customerData = data as Omit<Customer, 'id'>;
                if (!customerData.username) {
                    customerData.username = `cust_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                }
                await addCustomer(customerData);
            }
            setModalOpen(false);
        } catch (err) {
            alert(`Failed to save customer: ${(err as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!selectedRouter) {
        return (
            <div className="flex items-center justify-center h-64">
                <p className="text-slate-500 dark:text-slate-400 text-lg">Please select a router to manage customers.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Customers</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Manage customer records for <span className="font-medium">{selectedRouter.name}</span>
                    </p>
                </div>
                <button
                    onClick={handleOpenAdd}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition shadow-sm"
                >
                    <PlusIcon className="w-5 h-5" />
                    Add Customer
                </button>
            </div>

            {/* Search */}
            <div className="relative max-w-md">
                <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search customers..."
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition"
                />
            </div>

            {/* Error */}
            {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            {/* Loading */}
            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    <span className="ml-3 text-slate-500 dark:text-slate-400">Loading customers...</span>
                </div>
            ) : filteredCustomers.length === 0 ? (
                <div className="text-center py-12">
                    <p className="text-slate-500 dark:text-slate-400">
                        {searchTerm ? 'No customers match your search.' : 'No customers found. Click "Add Customer" to create one.'}
                    </p>
                </div>
            ) : (
                /* Table */
                <div className="overflow-x-auto bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
                    <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                        <thead className="bg-slate-50 dark:bg-slate-900/50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Name</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Username</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider hidden md:table-cell">Address</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider hidden lg:table-cell">Contact</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider hidden lg:table-cell">Email</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider hidden xl:table-cell">Account #</th>
                                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {filteredCustomers.map((customer) => (
                                <tr key={customer.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition">
                                    <td className="px-4 py-3 text-sm font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                                        {customer.fullName || <span className="text-slate-400 italic">No name</span>}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                        {customer.username || '-'}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300 hidden md:table-cell max-w-[200px] truncate">
                                        {customer.address || '-'}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300 hidden lg:table-cell whitespace-nowrap">
                                        {customer.contactNumber || '-'}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300 hidden lg:table-cell whitespace-nowrap">
                                        {customer.email || '-'}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300 hidden xl:table-cell whitespace-nowrap">
                                        {customer.accountNumber || '-'}
                                    </td>
                                    <td className="px-4 py-3 text-right whitespace-nowrap">
                                        <button
                                            onClick={() => handleOpenEdit(customer)}
                                            className="inline-flex items-center p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-md transition"
                                            title="Edit"
                                        >
                                            <PencilIcon className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(customer)}
                                            className="inline-flex items-center p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-md transition ml-1"
                                            title="Delete"
                                        >
                                            <TrashIcon className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
                        Showing {filteredCustomers.length} of {customers.length} customer{customers.length !== 1 ? 's' : ''}
                    </div>
                </div>
            )}

            {/* Modal */}
            <CustomerFormModal
                isOpen={isModalOpen}
                onClose={() => setModalOpen(false)}
                onSave={handleSave}
                initialData={editingCustomer}
                isSubmitting={isSubmitting}
                routerId={routerId || ''}
            />
        </div>
    );
};
