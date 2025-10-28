import React, { useState, useMemo, useEffect } from 'react';
import type { Employee, EmployeeBenefit, TimeRecord } from '../types.ts';
import { Loader } from './Loader.tsx';
import { EditIcon, TrashIcon, UsersIcon, ClockIcon, CalculatorIcon } from '../constants.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';

interface PayrollProps {
    employees: Employee[];
    benefits: EmployeeBenefit[];
    timeRecords: TimeRecord[];
    addEmployee: (employeeData: Omit<Employee, 'id'>, benefitData: Omit<EmployeeBenefit, 'id' | 'employeeId'>) => Promise<void>;
    updateEmployee: (employee: Employee, benefit: EmployeeBenefit) => Promise<void>;
    deleteEmployee: (employeeId: string) => Promise<void>;
    saveTimeRecord: (record: Omit<TimeRecord, 'id'> | TimeRecord) => Promise<void>;
    deleteTimeRecord: (recordId: string) => Promise<void>;
    isLoading: boolean;
    error: string | null;
}

const EmployeeFormModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (employee: Omit<Employee, 'id'> | Employee, benefits: Omit<EmployeeBenefit, 'id' | 'employeeId'> | EmployeeBenefit) => void;
    initialData: { employee: Employee, benefit: EmployeeBenefit } | null;
    isSubmitting: boolean;
}> = ({ isOpen, onClose, onSave, initialData, isSubmitting }) => {
    const [employee, setEmployee] = useState<Omit<Employee, 'id'>>({ fullName: '', role: '', hireDate: '', salaryType: 'daily', rate: 0 });
    const [benefit, setBenefit] = useState<Omit<EmployeeBenefit, 'id' | 'employeeId'>>({ sss: false, philhealth: false, pagibig: false });

    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                setEmployee(initialData.employee);
                setBenefit(initialData.benefit);
            } else {
                setEmployee({ fullName: '', role: '', hireDate: new Date().toISOString().split('T')[0], salaryType: 'daily', rate: 0 });
                setBenefit({ sss: false, philhealth: false, pagibig: false });
            }
        }
    }, [initialData, isOpen]);

    if (!isOpen) return null;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const target = e.target;
        const { name, value, type } = target;
        if (['sss', 'philhealth', 'pagibig'].includes(name)) {
            const { checked } = target as HTMLInputElement;
            setBenefit(b => ({ ...b, [name]: checked }));
        } else {
            setEmployee(emp => ({ ...emp, [name]: type === 'number' ? parseFloat(value) || 0 : value }));
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (initialData) {
            onSave(
                { ...initialData.employee, ...employee },
                { ...initialData.benefit, ...benefit }
            );
        } else {
            onSave(employee, benefit);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-2xl">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold mb-4">{initialData ? 'Edit Employee' : 'Add New Employee'}</h3>
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div><label className="block text-sm">Full Name</label><input name="fullName" value={employee.fullName || ''} onChange={handleChange} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded" /></div>
                                <div><label className="block text-sm">Role/Position</label><input name="role" value={employee.role || ''} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded" /></div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div><label className="block text-sm">Hire Date</label><input type="date" name="hireDate" value={employee.hireDate || ''} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded" /></div>
                                <div><label className="block text-sm">Salary Type</label><select name="salaryType" value={employee.salaryType} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded"><option value="daily">Daily</option><option value="monthly">Monthly</option></select></div>
                                <div><label className="block text-sm">Rate</label><input type="number" name="rate" value={employee.rate || ''} onChange={handleChange} required min="0" step="0.01" className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded" /></div>
                            </div>
                            <div className="pt-4 border-t">
                                <label className="block text-sm font-medium">Philippine Benefits</label>
                                <div className="flex items-center gap-6 mt-2">
                                    <label className="flex items-center gap-2"><input type="checkbox" name="sss" checked={!!benefit.sss} onChange={handleChange} /> SSS</label>
                                    <label className="flex items-center gap-2"><input type="checkbox" name="philhealth" checked={!!benefit.philhealth} onChange={handleChange} /> PhilHealth</label>
                                    <label className="flex items-center gap-2"><input type="checkbox" name="pagibig" checked={!!benefit.pagibig} onChange={handleChange} /> Pag-IBIG</label>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-4">
                        <button type="button" onClick={onClose} disabled={isSubmitting}>Cancel</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-[--color-primary-600] text-white rounded">{isSubmitting ? 'Saving...' : 'Save'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const EmployeeManager: React.FC<PayrollProps> = (props) => {
    const { employees, benefits, addEmployee, updateEmployee, deleteEmployee } = props;
    const { formatCurrency } = useLocalization();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingData, setEditingData] = useState<{ employee: Employee, benefit: EmployeeBenefit } | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSave = async (employeeData: any, benefitData: any) => {
        setIsSubmitting(true);
        try {
            if (employeeData.id) {
                await updateEmployee(employeeData, benefitData);
            } else {
                await addEmployee(employeeData, benefitData);
            }
            setIsModalOpen(false);
        } catch(e) {
            alert(`Failed to save: ${(e as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };
    
    return (
        <div>
            <EmployeeFormModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSave} initialData={editingData} isSubmitting={isSubmitting} />
            <div className="flex justify-end mb-4">
                <button onClick={() => { setEditingData(null); setIsModalOpen(true); }} className="bg-[--color-primary-600] text-white font-bold py-2 px-4 rounded-lg">Add Employee</button>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md overflow-x-auto">
                <table className="w-full text-sm">
                    <thead><tr><th className="px-4 py-2">Name</th><th>Role</th><th>Salary</th><th>Actions</th></tr></thead>
                    <tbody>
                        {employees.map(emp => {
                            const benefit = benefits.find(b => b.employeeId === emp.id);
                            return (
                                <tr key={emp.id} className="border-t">
                                    <td className="px-4 py-2 font-semibold">{emp.fullName}</td>
                                    <td>{emp.role}</td>
                                    <td>{formatCurrency(emp.rate)} / {emp.salaryType}</td>
                                    <td className="px-4 py-2 space-x-2">
                                        <button onClick={() => { if (benefit) setEditingData({ employee: emp, benefit }); setIsModalOpen(true); }}><EditIcon className="w-5 h-5"/></button>
                                        <button onClick={() => deleteEmployee(emp.id)}><TrashIcon className="w-5 h-5"/></button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const TimeRecordManager: React.FC<PayrollProps> = (props) => {
    const { employees, timeRecords, saveTimeRecord, deleteTimeRecord } = props;
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
    const [currentDate, setCurrentDate] = useState(new Date());
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editingRecord, setEditingRecord] = useState<Partial<TimeRecord> & { date: string }>({
        date: new Date().toISOString().split('T')[0],
        timeIn: '',
        timeOut: ''
    });

    useEffect(() => {
        if (!selectedEmployeeId && employees.length > 0) {
            setSelectedEmployeeId(employees[0].id);
        }
    }, [employees, selectedEmployeeId]);

    const changeMonth = (offset: number) => {
        setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + offset, 1));
    };

    const calculateHours = (timeIn: string, timeOut: string): number => {
        if (!timeIn || !timeOut) return 0;
        try {
            const inDate = new Date(`1970-01-01T${timeIn}`);
            const outDate = new Date(`1970-01-01T${timeOut}`);
            if (outDate < inDate) { 
                return 0; // Does not handle overnight shifts for simplicity
            }
            const diff = outDate.getTime() - inDate.getTime();
            return diff / (1000 * 60 * 60);
        } catch (e) {
            return 0;
        }
    };

    const filteredRecords = useMemo(() => {
        if (!selectedEmployeeId) return [];
        return timeRecords
            .filter(r => r.employeeId === selectedEmployeeId && 
                         new Date(r.date).getFullYear() === currentDate.getFullYear() &&
                         new Date(r.date).getMonth() === currentDate.getMonth())
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }, [timeRecords, selectedEmployeeId, currentDate]);
    
    const totalHours = useMemo(() => filteredRecords.reduce((sum, r) => sum + calculateHours(r.timeIn || '', r.timeOut || ''), 0), [filteredRecords]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedEmployeeId || !editingRecord.date || !editingRecord.timeIn || !editingRecord.timeOut) {
            alert("Please fill all fields.");
            return;
        }
        setIsSubmitting(true);
        try {
            await saveTimeRecord({
                ...editingRecord,
                employeeId: selectedEmployeeId,
            } as TimeRecord); 
            // Reset form
            setEditingRecord({ date: new Date().toISOString().split('T')[0], timeIn: '', timeOut: '' });
        } catch (e) {
            alert(`Failed to save: ${(e as Error).message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (recordId: string) => {
        if (window.confirm("Delete this time record?")) {
            await deleteTimeRecord(recordId);
        }
    };

    const handleEditClick = (record: TimeRecord) => {
        setEditingRecord(record);
    };

    const cancelEdit = () => {
        setEditingRecord({ date: new Date().toISOString().split('T')[0], timeIn: '', timeOut: '' });
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setEditingRecord(prev => ({ ...prev, [name]: value }));
    };

    return (
        <div className="space-y-6">
            <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 space-y-4">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                    <div>
                        <label htmlFor="employee-select" className="block text-sm font-medium">Employee</label>
                        <select id="employee-select" value={selectedEmployeeId || ''} onChange={e => setSelectedEmployeeId(e.target.value)} className="mt-1 p-2 bg-slate-100 dark:bg-slate-700 rounded-md">
                            {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.fullName}</option>)}
                        </select>
                    </div>
                    <div className="flex items-center gap-4">
                        <button onClick={() => changeMonth(-1)} className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700">{"<"}</button>
                        <h3 className="text-lg font-semibold w-32 text-center">{currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</h3>
                        <button onClick={() => changeMonth(1)} className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700">{">"}</button>
                    </div>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                <h4 className="font-bold text-lg mb-4">{editingRecord.id ? 'Edit Record' : 'Add New Record'}</h4>
                <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                    <div className="md:col-span-1"><label className="block text-sm">Date</label><input type="date" name="date" value={editingRecord.date} onChange={handleInputChange} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded" /></div>
                    <div className="md:col-span-1"><label className="block text-sm">Time In</label><input type="time" name="timeIn" value={editingRecord.timeIn || ''} onChange={handleInputChange} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded" /></div>
                    <div className="md:col-span-1"><label className="block text-sm">Time Out</label><input type="time" name="timeOut" value={editingRecord.timeOut || ''} onChange={handleInputChange} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded" /></div>
                    <div className="md:col-span-2 flex gap-2">
                        <button type="submit" disabled={isSubmitting || !selectedEmployeeId} className="px-4 py-2 bg-[--color-primary-600] text-white rounded-md w-full disabled:opacity-50">{isSubmitting ? 'Saving...' : 'Save'}</button>
                        {editingRecord.id && <button type="button" onClick={cancelEdit} className="px-4 py-2 bg-slate-200 dark:bg-slate-600 rounded-md w-full">Cancel</button>}
                    </div>
                </form>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md overflow-x-auto">
                 <table className="w-full text-sm">
                    <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50">
                        <tr>
                            <th className="px-4 py-2 text-left">Date</th>
                            <th className="px-4 py-2 text-left">Time In</th>
                            <th className="px-4 py-2 text-left">Time Out</th>
                            <th className="px-4 py-2 text-left">Hours Worked</th>
                            <th className="px-4 py-2 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredRecords.map(rec => (
                            <tr key={rec.id} className="border-t dark:border-slate-700">
                                <td className="px-4 py-2">{new Date(rec.date).toLocaleDateString()}</td>
                                <td className="px-4 py-2">{rec.timeIn}</td>
                                <td className="px-4 py-2">{rec.timeOut}</td>
                                <td className="px-4 py-2">{calculateHours(rec.timeIn || '', rec.timeOut || '').toFixed(2)}</td>
                                <td className="px-4 py-2 space-x-2 text-right">
                                    <button onClick={() => handleEditClick(rec)}><EditIcon className="w-5 h-5"/></button>
                                    <button onClick={() => handleDelete(rec.id)}><TrashIcon className="w-5 h-5"/></button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot className="bg-slate-50 dark:bg-slate-900/50">
                        <tr className="border-t-2 font-bold">
                            <td colSpan={3} className="px-4 py-2 text-right">Total Hours:</td>
                            <td className="px-4 py-2">{totalHours.toFixed(2)}</td>
                            <td></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
};


export const Payroll: React.FC<PayrollProps> = (props) => {
    const [activeTab, setActiveTab] = useState('employees');

    if (props.isLoading) {
        return <div className="flex justify-center p-8"><Loader /></div>;
    }

    if (props.error) {
        return <div className="p-4 bg-red-100 text-red-700">{props.error}</div>;
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Payroll Management</h2>
            <div className="border-b border-slate-200 dark:border-slate-700">
                <nav className="flex -mb-px gap-4">
                    <button onClick={() => setActiveTab('employees')} className={`flex items-center gap-2 py-2 px-1 border-b-2 ${activeTab === 'employees' ? 'border-[--color-primary-500] text-[--color-primary-600]' : 'border-transparent text-slate-500'}`}><UsersIcon className="w-5 h-5"/>Employees</button>
                    <button onClick={() => setActiveTab('dtr')} className={`flex items-center gap-2 py-2 px-1 border-b-2 ${activeTab === 'dtr' ? 'border-[--color-primary-500] text-[--color-primary-600]' : 'border-transparent text-slate-500'}`}><ClockIcon className="w-5 h-5"/>Daily Time Record</button>
                </nav>
            </div>
            {activeTab === 'employees' && <EmployeeManager {...props} />}
            {activeTab === 'dtr' && <TimeRecordManager {...props} />}
        </div>
    );
};
