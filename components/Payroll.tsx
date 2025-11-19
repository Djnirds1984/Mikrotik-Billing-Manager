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
                                <div>
                                    <label>Full Name</label>
                                    <input name="fullName" value={employee.fullName} onChange={handleChange} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                </div>
                                <div>
                                    <label>Role / Position</label>
                                    <input name="role" value={employee.role} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label>Hire Date</label>
                                    <input type="date" name="hireDate" value={employee.hireDate} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                </div>
                                <div>
                                    <label>Salary Type</label>
                                    <select name="salaryType" value={employee.salaryType} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">
                                        <option value="daily">Daily</option>
                                        <option value="monthly">Monthly</option>
                                    </select>
                                </div>
                                <div>
                                    <label>Rate</label>
                                    <input type="number" name="rate" value={employee.rate} onChange={handleChange} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                </div>
                            </div>
                            <div>
                                <label>Benefits</label>
                                <div className="mt-2 flex items-center gap-6">
                                    <label className="flex items-center gap-2"><input type="checkbox" name="sss" checked={benefit.sss} onChange={handleChange} /> SSS</label>
                                    <label className="flex items-center gap-2"><input type="checkbox" name="philhealth" checked={benefit.philhealth} onChange={handleChange} /> PhilHealth</label>
                                    <label className="flex items-center gap-2"><input type="checkbox" name="pagibig" checked={benefit.pagibig} onChange={handleChange} /> Pag-IBIG</label>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-4">
                        <button type="button" onClick={onClose} disabled={isSubmitting}>Cancel</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-[--color-primary-600] text-white rounded-md disabled:opacity-50">
                            {isSubmitting ? 'Saving...' : 'Save Employee'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const TimeRecordModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (record: Omit<TimeRecord, 'id'> | TimeRecord) => void;
    initialData: TimeRecord | null;
    employeeId: string;
    isSubmitting: boolean;
}> = ({ isOpen, onClose, onSave, initialData, employeeId, isSubmitting }) => {
    const [record, setRecord] = useState({ date: '', timeIn: '', timeOut: '' });

    useEffect(() => {
        if(isOpen) {
            if (initialData) {
                setRecord({ date: initialData.date, timeIn: initialData.timeIn || '', timeOut: initialData.timeOut || '' });
            } else {
                setRecord({ date: new Date().toISOString().split('T')[0], timeIn: '', timeOut: '' });
            }
        }
    }, [isOpen, initialData]);

    if (!isOpen) return null;
    
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setRecord(r => ({ ...r, [e.target.name]: e.target.value }));
    };
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(initialData ? { ...record, id: initialData.id, employeeId } : { ...record, employeeId });
    };

    return (
         <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-md">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold mb-4">{initialData ? 'Edit Time Record' : 'Add Time Record'}</h3>
                        <div className="space-y-4">
                            <div>
                                <label>Date</label>
                                <input type="date" name="date" value={record.date} onChange={handleChange} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label>Time In</label>
                                    <input type="time" name="timeIn" value={record.timeIn} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                </div>
                                <div>
                                    <label>Time Out</label>
                                    <input type="time" name="timeOut" value={record.timeOut} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-4">
                        <button type="button" onClick={onClose} disabled={isSubmitting}>Cancel</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-[--color-primary-600] text-white rounded-md disabled:opacity-50">{isSubmitting ? 'Saving...' : 'Save'}</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// FIX: Add the missing Payroll component
export const Payroll: React.FC<PayrollProps> = (props) => {
    const { employees, benefits, timeRecords, addEmployee, updateEmployee, deleteEmployee, saveTimeRecord, deleteTimeRecord, isLoading, error } = props;
    const [activeTab, setActiveTab] = useState<'employees' | 'time_records' | 'generate_payroll'>('employees');
    const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState<{ employee: Employee, benefit: EmployeeBenefit } | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { t, formatCurrency } = useLocalization();
    const [selectedEmployeeForDtr, setSelectedEmployeeForDtr] = useState<Employee | null>(null);
    const [isTimeRecordModalOpen, setIsTimeRecordModalOpen] = useState(false);
    const [editingTimeRecord, setEditingTimeRecord] = useState<TimeRecord | null>(null);

    const handleSaveEmployee = async (employeeData: any, benefitData: any) => {
        setIsSubmitting(true);
        try {
            if ('id' in employeeData) {
                await updateEmployee(employeeData, benefitData);
            } else {
                await addEmployee(employeeData, benefitData);
            }
            setIsEmployeeModalOpen(false);
        } catch (err) {
            console.error(err);
            alert("Failed to save employee.");
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleSaveTimeRecord = async (recordData: any) => {
        setIsSubmitting(true);
        try {
            await saveTimeRecord(recordData);
            setIsTimeRecordModalOpen(false);
        } catch (err) {
            console.error(err);
            alert("Failed to save time record.");
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const employeeTimeRecords = useMemo(() => {
        if (!selectedEmployeeForDtr) return [];
        return timeRecords.filter(r => r.employeeId === selectedEmployeeForDtr.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [timeRecords, selectedEmployeeForDtr]);

    const renderContent = () => {
        if (isLoading) return <div className="flex justify-center p-8"><Loader /></div>;
        if (error) return <div className="p-4 bg-red-100 text-red-700">{error}</div>;

        switch (activeTab) {
            case 'employees':
                return (
                    <div>
                        <div className="flex justify-end mb-4">
                            <button onClick={() => { setEditingEmployee(null); setIsEmployeeModalOpen(true); }} className="bg-[--color-primary-600] text-white font-bold py-2 px-4 rounded-lg">Add Employee</button>
                        </div>
                        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50"><tr><th className="px-6 py-3">Name</th><th className="px-6 py-3">Role</th><th className="px-6 py-3">Salary</th><th className="px-6 py-3 text-right">Actions</th></tr></thead>
                                <tbody>
                                    {employees.map(emp => {
                                        const benefit = benefits.find(b => b.employeeId === emp.id);
                                        return (
                                            <tr key={emp.id} className="border-b dark:border-slate-700">
                                                <td className="px-6 py-4 font-medium">{emp.fullName}</td>
                                                <td>{emp.role}</td>
                                                <td>{formatCurrency(emp.rate)} / {emp.salaryType}</td>
                                                <td className="px-6 py-4 text-right space-x-2">
                                                    <button onClick={() => { if(benefit) { setEditingEmployee({ employee: emp, benefit }); setIsEmployeeModalOpen(true); }}} className="p-1"><EditIcon className="w-5 h-5"/></button>
                                                    <button onClick={() => deleteEmployee(emp.id)} className="p-1"><TrashIcon className="w-5 h-5"/></button>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            case 'time_records':
                 return (
                     <div>
                        <div className="mb-4">
                            <label className="block text-sm font-medium">Select Employee</label>
                            <select onChange={e => setSelectedEmployeeForDtr(employees.find(emp => emp.id === e.target.value) || null)} value={selectedEmployeeForDtr?.id || ''} className="mt-1 w-full md:w-1/2 p-2 bg-slate-100 dark:bg-slate-700 rounded-md">
                                <option value="">-- Select an employee --</option>
                                {employees.map(e => <option key={e.id} value={e.id}>{e.fullName}</option>)}
                            </select>
                        </div>
                        {selectedEmployeeForDtr && (
                            <div>
                                <div className="flex justify-end mb-4"><button onClick={() => { setEditingTimeRecord(null); setIsTimeRecordModalOpen(true); }} className="bg-[--color-primary-600] text-white font-bold py-2 px-4 rounded-lg">Add Time Record</button></div>
                                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50"><tr><th className="px-6 py-3">Date</th><th className="px-6 py-3">Time In</th><th className="px-6 py-3">Time Out</th><th className="px-6 py-3 text-right">Actions</th></tr></thead>
                                        <tbody>
                                            {employeeTimeRecords.map(rec => (
                                                <tr key={rec.id} className="border-b dark:border-slate-700">
                                                    <td className="px-6 py-4">{rec.date}</td><td>{rec.timeIn || '--'}</td><td>{rec.timeOut || '--'}</td>
                                                    <td className="px-6 py-4 text-right space-x-2">
                                                        <button onClick={() => { setEditingTimeRecord(rec); setIsTimeRecordModalOpen(true); }} className="p-1"><EditIcon className="w-5 h-5"/></button>
                                                        <button onClick={() => deleteTimeRecord(rec.id)} className="p-1"><TrashIcon className="w-5 h-5"/></button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                     </div>
                 );
            case 'generate_payroll':
                 return <div className="p-8 text-center bg-slate-100 dark:bg-slate-700/50 rounded-lg">Feature coming soon.</div>;
        }
    };
    
    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <EmployeeFormModal isOpen={isEmployeeModalOpen} onClose={() => setIsEmployeeModalOpen(false)} onSave={handleSaveEmployee} initialData={editingEmployee} isSubmitting={isSubmitting} />
            {selectedEmployeeForDtr && <TimeRecordModal isOpen={isTimeRecordModalOpen} onClose={() => setIsTimeRecordModalOpen(false)} onSave={handleSaveTimeRecord} initialData={editingTimeRecord} employeeId={selectedEmployeeForDtr.id} isSubmitting={isSubmitting} />}
            <div className="border-b border-slate-200 dark:border-slate-700">
                <nav className="flex space-x-2">
                    <button onClick={() => setActiveTab('employees')} className={`flex items-center gap-2 px-4 py-2 ${activeTab === 'employees' ? 'border-b-2 border-[--color-primary-500]' : ''}`}><UsersIcon className="w-5 h-5"/> Employees</button>
                    <button onClick={() => setActiveTab('time_records')} className={`flex items-center gap-2 px-4 py-2 ${activeTab === 'time_records' ? 'border-b-2 border-[--color-primary-500]' : ''}`}><ClockIcon className="w-5 h-5"/> Time Records</button>
                    <button onClick={() => setActiveTab('generate_payroll')} className={`flex items-center gap-2 px-4 py-2 ${activeTab === 'generate_payroll' ? 'border-b-2 border-[--color-primary-500]' : ''}`}><CalculatorIcon className="w-5 h-5"/> Generate Payroll</button>
                </nav>
            </div>
            {renderContent()}
        </div>
    );
};
