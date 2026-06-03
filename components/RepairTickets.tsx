import React, { useState, useEffect, useCallback } from 'react';
import { Loader } from './Loader.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';

interface RepairTicket {
    id: string;
    client_user_id: string | null;
    username: string;
    client_type: string;
    category: string;
    description: string;
    status: string;
    priority: string;
    admin_notes: string | null;
    created_by: string;
    assigned_to: string | null;
    resolved_at: string | null;
    created_at: string;
    updated_at: string | null;
}

interface ClientUser {
    id: string;
    username: string;
    pppoe_username: string;
    router_id: string;
    router_name?: string;
    account_number?: string;
    profile?: string;
    plan_name?: string;
    client_type?: string;
}

const CATEGORIES = [
    { value: 'no_internet', label: 'No Internet' },
    { value: 'slow_connection', label: 'Slow Connection' },
    { value: 'intermittent', label: 'Intermittent Connection' },
    { value: 'line_issue', label: 'Line / Cable Issue' },
    { value: 'other', label: 'Other' },
];

const STATUSES = [
    { value: 'open', label: 'Open' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'closed', label: 'Closed' },
];

const PRIORITIES = [
    { value: 'low', label: 'Low' },
    { value: 'normal', label: 'Normal' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' },
];

const getStatusBadge = (status: string) => {
    switch (status) {
        case 'open': return 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400';
        case 'in_progress': return 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400';
        case 'resolved': return 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400';
        case 'closed': return 'bg-slate-200 dark:bg-slate-600/50 text-slate-600 dark:text-slate-400';
        default: return 'bg-slate-200 dark:bg-slate-600/50 text-slate-600 dark:text-slate-400';
    }
};

const getPriorityBadge = (priority: string) => {
    switch (priority) {
        case 'low': return 'bg-slate-100 dark:bg-slate-600/30 text-slate-600 dark:text-slate-400';
        case 'normal': return 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400';
        case 'high': return 'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-400';
        case 'urgent': return 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400';
        default: return 'bg-slate-100 dark:bg-slate-600/30 text-slate-600 dark:text-slate-400';
    }
};

const authHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
});

// --- Create Ticket Modal ---
const CreateTicketModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onCreated: () => void;
    clients: ClientUser[];
}> = ({ isOpen, onClose, onCreated, clients }) => {
    const [username, setUsername] = useState('');
    const [clientType, setClientType] = useState('pppoe');
    const [category, setCategory] = useState('no_internet');
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState('normal');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setUsername('');
            setClientType('pppoe');
            setCategory('no_internet');
            setDescription('');
            setPriority('normal');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!username) { alert('Please select or enter a client username'); return; }
        setIsSubmitting(true);
        try {
            const selectedClient = clients.find(c => c.pppoe_username === username || c.username === username);
            const res = await fetch('/api/repair-tickets', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({
                    username,
                    client_user_id: selectedClient?.id || null,
                    client_type: clientType,
                    category,
                    description,
                    priority,
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            onCreated();
            onClose();
        } catch (err) {
            alert((err as Error).message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg border border-slate-200 dark:border-slate-700">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400] mb-4">Create Repair Ticket</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Client Username</label>
                                <input
                                    list="client-list"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-[--color-primary-500]"
                                    placeholder="Type or select a client..."
                                    required
                                />
                                <datalist id="client-list">
                                    {clients.map(c => (
                                        <option key={c.id} value={c.pppoe_username || c.username}>
                                            {c.pppoe_username || c.username} - {c.router_name || 'Unknown'} {c.plan_name ? `(${c.plan_name})` : ''}
                                        </option>
                                    ))}
                                </datalist>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Client Type</label>
                                    <select value={clientType} onChange={(e) => setClientType(e.target.value)} className="w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-[--color-primary-500]">
                                        <option value="pppoe">PPPoE</option>
                                        <option value="dhcp">DHCP</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Priority</label>
                                    <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-[--color-primary-500]">
                                        {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Category</label>
                                <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-[--color-primary-500]">
                                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description</label>
                                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-[--color-primary-500]" placeholder="Describe the issue..." />
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                        <button type="button" onClick={onClose} disabled={isSubmitting} className="px-4 py-2 text-sm font-medium rounded-md text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 disabled:opacity-50">Cancel</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-[--color-primary-600] hover:bg-[--color-primary-500] disabled:opacity-50">
                            {isSubmitting ? 'Creating...' : 'Create Ticket'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- Edit Ticket Modal ---
const EditTicketModal: React.FC<{
    ticket: RepairTicket | null;
    onClose: () => void;
    onUpdated: () => void;
}> = ({ ticket, onClose, onUpdated }) => {
    const [status, setStatus] = useState('');
    const [priority, setPriority] = useState('');
    const [adminNotes, setAdminNotes] = useState('');
    const [assignedTo, setAssignedTo] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (ticket) {
            setStatus(ticket.status);
            setPriority(ticket.priority);
            setAdminNotes(ticket.admin_notes || '');
            setAssignedTo(ticket.assigned_to || '');
        }
    }, [ticket]);

    if (!ticket) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            const res = await fetch(`/api/repair-tickets/${ticket.id}`, {
                method: 'PUT',
                headers: authHeaders(),
                body: JSON.stringify({ status, priority, admin_notes: adminNotes, assigned_to: assignedTo })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            onUpdated();
            onClose();
        } catch (err) {
            alert((err as Error).message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const categoryLabel = CATEGORIES.find(c => c.value === ticket.category)?.label || ticket.category;

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg border border-slate-200 dark:border-slate-700">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400] mb-4">Edit Ticket</h3>
                        <div className="mb-4 p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg text-sm space-y-1">
                            <div><span className="font-medium text-slate-600 dark:text-slate-400">Client:</span> <span className="text-slate-900 dark:text-white">{ticket.username}</span></div>
                            <div><span className="font-medium text-slate-600 dark:text-slate-400">Type:</span> <span className="text-slate-900 dark:text-white uppercase">{ticket.client_type}</span></div>
                            <div><span className="font-medium text-slate-600 dark:text-slate-400">Category:</span> <span className="text-slate-900 dark:text-white">{categoryLabel}</span></div>
                            <div><span className="font-medium text-slate-600 dark:text-slate-400">Description:</span> <span className="text-slate-900 dark:text-white">{ticket.description || 'N/A'}</span></div>
                            <div><span className="font-medium text-slate-600 dark:text-slate-400">Created:</span> <span className="text-slate-900 dark:text-white">{new Date(ticket.created_at).toLocaleString()}</span></div>
                            <div><span className="font-medium text-slate-600 dark:text-slate-400">Created By:</span> <span className="text-slate-900 dark:text-white capitalize">{ticket.created_by}</span></div>
                        </div>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Status</label>
                                    <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-[--color-primary-500]">
                                        {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Priority</label>
                                    <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-[--color-primary-500]">
                                        {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Assigned To</label>
                                <input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-[--color-primary-500]" placeholder="Technician name..." />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Admin Notes</label>
                                <textarea value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} rows={3} className="w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-[--color-primary-500]" placeholder="Internal notes..." />
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                        <button type="button" onClick={onClose} disabled={isSubmitting} className="px-4 py-2 text-sm font-medium rounded-md text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 disabled:opacity-50">Cancel</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-[--color-primary-600] hover:bg-[--color-primary-500] disabled:opacity-50">
                            {isSubmitting ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- Main Component ---
export const RepairTickets: React.FC = () => {
    const { t } = useLocalization();
    const [tickets, setTickets] = useState<RepairTicket[]>([]);
    const [clients, setClients] = useState<ClientUser[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState('');
    const [filterPriority, setFilterPriority] = useState('');
    const [filterType, setFilterType] = useState('');
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [editTicket, setEditTicket] = useState<RepairTicket | null>(null);

    const fetchTickets = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            if (filterStatus) params.append('status', filterStatus);
            if (filterPriority) params.append('priority', filterPriority);
            if (filterType) params.append('client_type', filterType);
            const res = await fetch(`/api/repair-tickets?${params.toString()}`, { headers: authHeaders() });
            if (!res.ok) throw new Error('Failed to fetch tickets');
            const data = await res.json();
            setTickets(data);
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    }, [filterStatus, filterPriority, filterType]);

    const fetchClients = useCallback(async () => {
        try {
            // Fetch PPPoE clients from all routers
            const res = await fetch('/api/pppoe-clients', { headers: authHeaders() });
            if (res.ok) {
                const data = await res.json();
                setClients(data);
            }
        } catch (err) {
            console.error('Failed to fetch PPPoE clients:', err);
        }
    }, []);

    useEffect(() => { fetchTickets(); }, [fetchTickets]);
    useEffect(() => { fetchClients(); }, [fetchClients]);

    const handleDelete = async (id: string) => {
        if (!window.confirm('Are you sure you want to delete this ticket?')) return;
        try {
            const res = await fetch(`/api/repair-tickets/${id}`, { method: 'DELETE', headers: authHeaders() });
            if (!res.ok) throw new Error('Failed to delete');
            fetchTickets();
        } catch (err) {
            alert((err as Error).message);
        }
    };

    const openCount = tickets.filter(t => t.status === 'open').length;
    const inProgressCount = tickets.filter(t => t.status === 'in_progress').length;
    const resolvedCount = tickets.filter(t => t.status === 'resolved').length;

    if (isLoading) {
        return <div className="flex flex-col items-center justify-center h-64"><Loader /><p className="mt-4 text-[--color-primary-500]">Loading tickets...</p></div>;
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <CreateTicketModal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} onCreated={fetchTickets} clients={clients} />
            <EditTicketModal ticket={editTicket} onClose={() => setEditTicket(null)} onUpdated={fetchTickets} />

            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">{t('repair_tickets.title') || 'Repair Tickets'}</h2>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">Manage client repair and service requests</p>
                </div>
                <button onClick={() => setIsCreateOpen(true)} className="bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white font-bold py-2 px-4 rounded-lg self-start sm:self-center">
                    + Create Ticket
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{openCount}</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">Open</div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{inProgressCount}</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">In Progress</div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">{resolvedCount}</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">Resolved</div>
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-slate-600 dark:text-slate-400">{tickets.length}</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">Total</div>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Filters:</span>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="text-sm bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-1.5 px-3 text-slate-900 dark:text-white">
                    <option value="">All Status</option>
                    {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="text-sm bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-1.5 px-3 text-slate-900 dark:text-white">
                    <option value="">All Priority</option>
                    {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                <select value={filterType} onChange={e => setFilterType(e.target.value)} className="text-sm bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md py-1.5 px-3 text-slate-900 dark:text-white">
                    <option value="">All Types</option>
                    <option value="pppoe">PPPoE</option>
                    <option value="dhcp">DHCP</option>
                </select>
            </div>

            {/* Tickets Table */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/50">
                            <tr>
                                <th className="px-4 py-3">Client</th>
                                <th className="px-4 py-3">Category</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Priority</th>
                                <th className="px-4 py-3">Type</th>
                                <th className="px-4 py-3">Created</th>
                                <th className="px-4 py-3">Assigned</th>
                                <th className="px-4 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {tickets.length > 0 ? tickets.map(ticket => {
                                const catLabel = CATEGORIES.find(c => c.value === ticket.category)?.label || ticket.category;
                                return (
                                    <tr key={ticket.id} className="border-b border-slate-200 dark:border-slate-700 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer" onClick={() => setEditTicket(ticket)}>
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-slate-800 dark:text-slate-200">{ticket.username}</div>
                                            <div className="text-xs text-slate-500">{ticket.created_by === 'client' ? 'Self-reported' : 'Admin-created'}</div>
                                        </td>
                                        <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{catLabel}</td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadge(ticket.status)}`}>
                                                {STATUSES.find(s => s.value === ticket.status)?.label || ticket.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getPriorityBadge(ticket.priority)}`}>
                                                {PRIORITIES.find(p => p.value === ticket.priority)?.label || ticket.priority}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 uppercase text-xs font-medium text-slate-600 dark:text-slate-400">{ticket.client_type}</td>
                                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">{new Date(ticket.created_at).toLocaleDateString()}</td>
                                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{ticket.assigned_to || '—'}</td>
                                        <td className="px-4 py-3 text-right">
                                            <button onClick={(e) => { e.stopPropagation(); handleDelete(ticket.id); }} className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-red-500 rounded-md" title="Delete Ticket">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                                            </button>
                                        </td>
                                    </tr>
                                );
                            }) : (
                                <tr>
                                    <td colSpan={8} className="text-center py-8 text-slate-500">No repair tickets found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
