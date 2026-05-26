import React, { useState, useMemo, useEffect, useRef } from 'react';
import type { Employee, EmployeeBenefit, TimeRecord } from '../types.ts';
import { Loader } from './Loader.tsx';
import { EditIcon, TrashIcon, UsersIcon, ClockIcon, CalculatorIcon, CheckCircleIcon } from '../constants.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';

// ─── Philippine government contribution rates (2024) ───────────────────────
// SSS: employee share ~4.5% of MSC, capped at ₱900/month
// PhilHealth: 5% of basic salary, employee share 2.5%, capped at ₱2,500/month
// Pag-IBIG: 2% of monthly salary, capped at ₱100/month
const SSS_RATE = 0.045;
const SSS_MAX = 900;
const PHILHEALTH_RATE = 0.025; // employee share
const PHILHEALTH_MAX = 2500;
const PAGIBIG_RATE = 0.02;
const PAGIBIG_MAX = 100;

interface PayrollEntry {
    employee: Employee;
    benefit: EmployeeBenefit;
    daysWorked: number;
    hoursWorked: number;
    grossPay: number;
    sssDeduction: number;
    philhealthDeduction: number;
    pagibigDeduction: number;
    totalDeductions: number;
    netPay: number;
}

const computeHoursWorked = (timeIn: string, timeOut: string): number => {
    if (!timeIn || !timeOut) return 0;
    const [inH, inM] = timeIn.split(':').map(Number);
    const [outH, outM] = timeOut.split(':').map(Number);
    const diff = (outH * 60 + outM) - (inH * 60 + inM);
    return diff > 0 ? diff / 60 : 0;
};

const computePayrollEntry = (
    employee: Employee,
    benefit: EmployeeBenefit,
    records: TimeRecord[],
    periodStart: string,
    periodEnd: string
): PayrollEntry => {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);

    const filtered = records.filter(r => {
        const d = new Date(r.date);
        return d >= start && d <= end;
    });

    let daysWorked = 0;
    let hoursWorked = 0;

    filtered.forEach(r => {
        const h = computeHoursWorked(r.timeIn, r.timeOut);
        if (h > 0) {
            hoursWorked += h;
            daysWorked += 1;
        } else if (!r.timeIn && !r.timeOut) {
            // Full day entry with no time — count as 1 day
            daysWorked += 1;
            hoursWorked += 8;
        }
    });

    let grossPay = 0;
    if (employee.salaryType === 'daily') {
        grossPay = employee.rate * daysWorked;
    } else {
        // Monthly: prorate by working days in period (assume 26 working days/month)
        const workingDaysInMonth = 26;
        const periodDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        const periodWorkingDays = Math.round((periodDays / 30) * workingDaysInMonth);
        grossPay = (employee.rate / workingDaysInMonth) * Math.min(daysWorked, periodWorkingDays);
    }

    // Monthly equivalent for deduction computation
    const monthlyEquivalent = employee.salaryType === 'monthly' ? employee.rate : employee.rate * 26;

    const sssDeduction = benefit.sss ? Math.min(monthlyEquivalent * SSS_RATE, SSS_MAX) : 0;
    const philhealthDeduction = benefit.philhealth ? Math.min(monthlyEquivalent * PHILHEALTH_RATE, PHILHEALTH_MAX) : 0;
    const pagibigDeduction = benefit.pagibig ? Math.min(monthlyEquivalent * PAGIBIG_RATE, PAGIBIG_MAX) : 0;
    const totalDeductions = sssDeduction + philhealthDeduction + pagibigDeduction;
    const netPay = Math.max(0, grossPay - totalDeductions);

    return { employee, benefit, daysWorked, hoursWorked, grossPay, sssDeduction, philhealthDeduction, pagibigDeduction, totalDeductions, netPay };
};

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
    onPayrollPaid?: (periodStart: string, periodEnd: string, totalNet: number, employeeCount: number) => Promise<void>;
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

export const Payroll: React.FC<PayrollProps> = (props) => {
    const { employees, benefits, timeRecords, addEmployee, updateEmployee, deleteEmployee, saveTimeRecord, deleteTimeRecord, isLoading, error, onPayrollPaid } = props;
    const [activeTab, setActiveTab] = useState<'employees' | 'time_records' | 'generate_payroll'>('employees');
    const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState<{ employee: Employee, benefit: EmployeeBenefit } | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { t, formatCurrency } = useLocalization();
    const [selectedEmployeeForDtr, setSelectedEmployeeForDtr] = useState<Employee | null>(null);
    const [isTimeRecordModalOpen, setIsTimeRecordModalOpen] = useState(false);
    const [editingTimeRecord, setEditingTimeRecord] = useState<TimeRecord | null>(null);
    const [payrollPaid, setPayrollPaid] = useState(false);
    const [isProcessingPayment, setIsProcessingPayment] = useState(false);

    // Payroll generation state
    const today = new Date();
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
    const [periodStart, setPeriodStart] = useState(firstOfMonth);
    const [periodEnd, setPeriodEnd] = useState(lastOfMonth);
    const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());
    const [generated, setGenerated] = useState(false);
    const printRef = useRef<HTMLDivElement>(null);

    const payrollEntries = useMemo<PayrollEntry[]>(() => {
        if (!generated) return [];
        const targets = employees.filter(e => selectedEmployeeIds.size === 0 || selectedEmployeeIds.has(e.id));
        return targets.map(emp => {
            const benefit = benefits.find(b => b.employeeId === emp.id) || { id: '', employeeId: emp.id, sss: false, philhealth: false, pagibig: false };
            const empRecords = timeRecords.filter(r => r.employeeId === emp.id);
            return computePayrollEntry(emp, benefit, empRecords, periodStart, periodEnd);
        });
    }, [generated, employees, benefits, timeRecords, selectedEmployeeIds, periodStart, periodEnd]);

    const totals = useMemo(() => ({
        gross: payrollEntries.reduce((s, e) => s + e.grossPay, 0),
        deductions: payrollEntries.reduce((s, e) => s + e.totalDeductions, 0),
        net: payrollEntries.reduce((s, e) => s + e.netPay, 0),
    }), [payrollEntries]);

    const handleGenerate = () => {
        if (!periodStart || !periodEnd) return;
        setGenerated(true);
        setPayrollPaid(false); // Reset paid status when generating new payroll
    };

    const handleMarkAsPaid = async () => {
        if (!onPayrollPaid || payrollEntries.length === 0) return;
        
        try {
            setIsProcessingPayment(true);
            await onPayrollPaid(periodStart, periodEnd, totals.net, payrollEntries.length);
            setPayrollPaid(true);
            alert(`Payroll marked as paid! Total net amount: ${formatCurrency(totals.net)} has been recorded as an expense.`);
        } catch (err) {
            console.error('Failed to mark payroll as paid:', err);
            alert('Failed to record payroll payment. Please try again.');
        } finally {
            setIsProcessingPayment(false);
        }
    };

    const handlePrint = () => {
        const content = printRef.current;
        if (!content) return;
        const win = window.open('', '_blank');
        if (!win) return;
        win.document.write(`
            <html><head><title>Payroll Report</title>
            <style>
                body { font-family: Arial, sans-serif; font-size: 12px; color: #000; }
                h2 { text-align: center; margin-bottom: 4px; }
                p.period { text-align: center; color: #555; margin-bottom: 16px; }
                table { width: 100%; border-collapse: collapse; }
                th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
                th { background: #f0f0f0; font-weight: bold; }
                td.num { text-align: right; }
                tr.total td { font-weight: bold; background: #f9f9f9; }
                .badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px; }
                .badge-yes { background: #d1fae5; color: #065f46; }
                .badge-no  { background: #f3f4f6; color: #6b7280; }
            </style>
            </head><body>${content.innerHTML}</body></html>
        `);
        win.document.close();
        win.focus();
        win.print();
        win.close();
    };

    const toggleEmployee = (id: string) => {
        setSelectedEmployeeIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
        setGenerated(false);
    };

    const toggleAll = () => {
        if (selectedEmployeeIds.size === employees.length) {
            setSelectedEmployeeIds(new Set());
        } else {
            setSelectedEmployeeIds(new Set(employees.map(e => e.id)));
        }
        setGenerated(false);
    };

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
                return (
                    <div className="space-y-6">
                        {/* Controls */}
                        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
                            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-4">Payroll Period & Employees</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Period Start</label>
                                    <input type="date" value={periodStart} onChange={e => { setPeriodStart(e.target.value); setGenerated(false); }}
                                        className="w-full p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Period End</label>
                                    <input type="date" value={periodEnd} onChange={e => { setPeriodEnd(e.target.value); setGenerated(false); }}
                                        className="w-full p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md text-sm" />
                                </div>
                            </div>

                            {/* Employee selector */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
                                        Include Employees <span className="text-slate-400">(leave all unchecked = include all)</span>
                                    </label>
                                    <button onClick={toggleAll} className="text-xs text-[--color-primary-500] hover:underline">
                                        {selectedEmployeeIds.size === employees.length ? 'Deselect All' : 'Select All'}
                                    </button>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {employees.map(emp => (
                                        <button key={emp.id} onClick={() => toggleEmployee(emp.id)}
                                            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                                                selectedEmployeeIds.has(emp.id)
                                                    ? 'bg-[--color-primary-600] text-white border-[--color-primary-600]'
                                                    : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600'
                                            }`}>
                                            {emp.fullName}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="mt-5 flex justify-end">
                                <button onClick={handleGenerate}
                                    className="flex items-center gap-2 px-6 py-2.5 bg-[--color-primary-600] hover:bg-[--color-primary-700] text-white font-bold rounded-lg transition-colors">
                                    <CalculatorIcon className="w-5 h-5" />
                                    Generate Payroll
                                </button>
                            </div>
                        </div>

                        {/* Results */}
                        {generated && (
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                                        Payroll Report &mdash; {periodStart} to {periodEnd}
                                    </h3>
                                    <div className="flex gap-2">
                                        {!payrollPaid && onPayrollPaid && (
                                            <button 
                                                onClick={handleMarkAsPaid}
                                                disabled={isProcessingPayment}
                                                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                                                <CheckCircleIcon className="w-4 h-4" />
                                                {isProcessingPayment ? 'Processing...' : 'Mark as Paid'}
                                            </button>
                                        )}
                                        {payrollPaid && (
                                            <div className="flex items-center gap-2 px-4 py-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-sm font-semibold rounded-lg">
                                                <CheckCircleIcon className="w-4 h-4" />
                                                Paid & Recorded as Expense
                                            </div>
                                        )}
                                        <button onClick={handlePrint}
                                            className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg transition-colors">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
                                            </svg>
                                            Print / Export
                                        </button>
                                    </div>
                                </div>

                                {payrollEntries.length === 0 ? (
                                    <div className="p-8 text-center bg-slate-100 dark:bg-slate-700/50 rounded-xl text-slate-500">
                                        No employees found for the selected period.
                                    </div>
                                ) : (
                                    <div ref={printRef}>
                                        <h2 className="hidden print:block text-xl font-bold text-center mb-1">Payroll Report</h2>
                                        <p className="hidden print:block text-center text-sm text-slate-500 mb-4">Period: {periodStart} to {periodEnd}</p>

                                        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                                            <table className="w-full text-sm">
                                                <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                                    <tr>
                                                        <th className="px-4 py-3 text-left">Employee</th>
                                                        <th className="px-4 py-3 text-left">Role</th>
                                                        <th className="px-4 py-3 text-center">Days</th>
                                                        <th className="px-4 py-3 text-center">Hours</th>
                                                        <th className="px-4 py-3 text-right">Gross Pay</th>
                                                        <th className="px-4 py-3 text-right">SSS</th>
                                                        <th className="px-4 py-3 text-right">PhilHealth</th>
                                                        <th className="px-4 py-3 text-right">Pag-IBIG</th>
                                                        <th className="px-4 py-3 text-right">Total Deductions</th>
                                                        <th className="px-4 py-3 text-right font-bold text-slate-700 dark:text-slate-200">Net Pay</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                                    {payrollEntries.map(entry => (
                                                        <tr key={entry.employee.id} className="bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                                                            <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-100">{entry.employee.fullName}</td>
                                                            <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{entry.employee.role}</td>
                                                            <td className="px-4 py-3 text-center">{entry.daysWorked}</td>
                                                            <td className="px-4 py-3 text-center">{entry.hoursWorked.toFixed(1)}</td>
                                                            <td className="px-4 py-3 text-right">{formatCurrency(entry.grossPay)}</td>
                                                            <td className="px-4 py-3 text-right text-red-500 dark:text-red-400">
                                                                {entry.benefit.sss ? formatCurrency(entry.sssDeduction) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                                                            </td>
                                                            <td className="px-4 py-3 text-right text-red-500 dark:text-red-400">
                                                                {entry.benefit.philhealth ? formatCurrency(entry.philhealthDeduction) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                                                            </td>
                                                            <td className="px-4 py-3 text-right text-red-500 dark:text-red-400">
                                                                {entry.benefit.pagibig ? formatCurrency(entry.pagibigDeduction) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                                                            </td>
                                                            <td className="px-4 py-3 text-right text-red-600 dark:text-red-400 font-medium">{formatCurrency(entry.totalDeductions)}</td>
                                                            <td className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(entry.netPay)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                                <tfoot className="bg-slate-50 dark:bg-slate-900/60 border-t-2 border-slate-300 dark:border-slate-600">
                                                    <tr>
                                                        <td colSpan={4} className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200 uppercase text-xs tracking-wider">
                                                            Totals ({payrollEntries.length} employee{payrollEntries.length !== 1 ? 's' : ''})
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-bold text-slate-800 dark:text-slate-100">{formatCurrency(totals.gross)}</td>
                                                        <td colSpan={3}></td>
                                                        <td className="px-4 py-3 text-right font-bold text-red-600 dark:text-red-400">{formatCurrency(totals.deductions)}</td>
                                                        <td className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400 text-base">{formatCurrency(totals.net)}</td>
                                                    </tr>
                                                </tfoot>
                                            </table>
                                        </div>

                                        {/* Per-employee breakdown cards */}
                                        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                            {payrollEntries.map(entry => (
                                                <div key={entry.employee.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm">
                                                    <div className="flex items-start justify-between mb-3">
                                                        <div>
                                                            <p className="font-bold text-slate-800 dark:text-slate-100">{entry.employee.fullName}</p>
                                                            <p className="text-xs text-slate-500 dark:text-slate-400">{entry.employee.role} &bull; {entry.employee.salaryType === 'daily' ? `${formatCurrency(entry.employee.rate)}/day` : `${formatCurrency(entry.employee.rate)}/mo`}</p>
                                                        </div>
                                                        <CheckCircleIcon className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                                                    </div>
                                                    <div className="space-y-1.5 text-sm">
                                                        <div className="flex justify-between">
                                                            <span className="text-slate-500 dark:text-slate-400">Days Worked</span>
                                                            <span className="font-medium">{entry.daysWorked} days ({entry.hoursWorked.toFixed(1)} hrs)</span>
                                                        </div>
                                                        <div className="flex justify-between">
                                                            <span className="text-slate-500 dark:text-slate-400">Gross Pay</span>
                                                            <span className="font-semibold text-slate-800 dark:text-slate-100">{formatCurrency(entry.grossPay)}</span>
                                                        </div>
                                                        {entry.benefit.sss && (
                                                            <div className="flex justify-between text-red-500 dark:text-red-400">
                                                                <span>SSS</span><span>- {formatCurrency(entry.sssDeduction)}</span>
                                                            </div>
                                                        )}
                                                        {entry.benefit.philhealth && (
                                                            <div className="flex justify-between text-red-500 dark:text-red-400">
                                                                <span>PhilHealth</span><span>- {formatCurrency(entry.philhealthDeduction)}</span>
                                                            </div>
                                                        )}
                                                        {entry.benefit.pagibig && (
                                                            <div className="flex justify-between text-red-500 dark:text-red-400">
                                                                <span>Pag-IBIG</span><span>- {formatCurrency(entry.pagibigDeduction)}</span>
                                                            </div>
                                                        )}
                                                        <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-700 flex justify-between">
                                                            <span className="font-bold text-slate-700 dark:text-slate-200">Net Pay</span>
                                                            <span className="font-bold text-emerald-600 dark:text-emerald-400 text-base">{formatCurrency(entry.netPay)}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
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
