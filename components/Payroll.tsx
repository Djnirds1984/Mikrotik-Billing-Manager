import React, { useState, useMemo, useEffect, useRef } from 'react';
import type { Employee, EmployeeBenefit, TimeRecord, Holiday, PayrollSettings } from '../types.ts';
import { Loader } from './Loader.tsx';
import { EditIcon, TrashIcon, UsersIcon, ClockIcon, CalculatorIcon, CheckCircleIcon, CalendarIcon, CogIcon, XMarkIcon, KeyIcon } from '../constants.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { printPayrollThermal } from './PayrollThermalPrint.tsx';
import { EmployeeIDModal } from './EmployeeIDModal.tsx';

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
    regularHours: number;
    overtimeHours: number;
    regularPay: number;
    overtimePay: number;
    otHourlyRate: number;
    holidayPay: number;
    holidayDays: number;
    totalPay: number;
}

const computeHoursWorked = (timeIn: string, timeOut: string): number => {
    if (!timeIn || !timeOut) return 0;
    const [inH, inM] = timeIn.split(':').map(Number);
    const [outH, outM] = timeOut.split(':').map(Number);
    const diff = (outH * 60 + outM) - (inH * 60 + inM);
    return diff > 0 ? diff / 60 : 0;
};

// Convert 24h time ("13:00") to 12h format ("1:00 PM")
const formatTime12h = (time: string): string => {
    if (!time) return '';
    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
};

// Form 48: compute hours from AM/PM split
const computeHoursFromForm48 = (record: TimeRecord): number => {
    if (record.timeInAM && record.timeOutAM) {
        const amHours = computeHoursWorked(record.timeInAM, record.timeOutAM);
        const pmHours = (record.timeInPM && record.timeOutPM) ? computeHoursWorked(record.timeInPM, record.timeOutPM) : 0;
        return amHours + pmHours;
    }
    // Fallback to legacy
    return computeHoursWorked(record.timeIn, record.timeOut);
};

// Compute overtime pay — auto-calculated when total hours exceed standard (8 hrs)
// On Sundays/rest days, uses the rest day OT premium rate instead of the regular one
const computeOvertimePayForDay = (
    totalHours: number,
    baseRate: number,
    stdHoursPerDay: number,
    otPremiumPercent: number,
    holidayMultiplier: number | null,
    date: string,
    restDayOtPremiumPercent: number
) => {
    const effectiveBase = holidayMultiplier ? baseRate * holidayMultiplier : baseRate;
    const hourlyRate = effectiveBase / stdHoursPerDay;
    // Check if the date is a Sunday (day 0)
    const dayOfWeek = new Date(date).getDay();
    const isSunday = dayOfWeek === 0;
    const premiumPercent = isSunday ? restDayOtPremiumPercent : otPremiumPercent;
    const otRate = hourlyRate * (1 + premiumPercent / 100);
    const regularHours = Math.min(totalHours, stdHoursPerDay);
    const autoOtHours = Math.max(0, totalHours - stdHoursPerDay);
    return {
        regularPay: hourlyRate * regularHours,
        overtimePay: otRate * autoOtHours,
        otRate,
        regularHours,
        totalOtHours: autoOtHours,
        isSunday,
        premiumPercent,
    };
};

// Check if a date matches a holiday
const findHoliday = (date: string, holidays: Holiday[]): Holiday | null => {
    return holidays.find(h => h.date === date) || null;
};

const computePayrollEntry = (
    employee: Employee,
    benefit: EmployeeBenefit,
    records: TimeRecord[],
    periodStart: string,
    periodEnd: string,
    holidays: Holiday[],
    settings: PayrollSettings
): PayrollEntry => {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);

    const filtered = records.filter(r => {
        const d = new Date(r.date);
        return d >= start && d <= end;
    });

    let daysWorked = 0;
    let hoursWorked = 0;
    let totalRegularPay = 0;
    let totalOvertimePay = 0;
    let totalOtHours = 0;
    let totalRegularHours = 0;
    let totalHolidayPay = 0;
    let holidayDaysCount = 0;
    let lastOtRate = 0;

    filtered.forEach(r => {
        const h = computeHoursFromForm48(r);
        const holiday = findHoliday(r.date, holidays);
        const holidayMultiplier = holiday
            ? (holiday.type === 'regular' ? settings.regularHolidayMultiplier : settings.specialHolidayMultiplier)
            : null;

        if (h > 0 || (!r.timeIn && !r.timeOut && (!r.timeInAM || !r.timeOutAM))) {
            const effectiveHours = h > 0 ? h : settings.defaultHoursPerDay;
            daysWorked += 1;
            hoursWorked += effectiveHours;

            const baseRate = employee.salaryType === 'daily' ? employee.rate : employee.rate / 26;
            const otResult = computeOvertimePayForDay(effectiveHours, baseRate, settings.defaultHoursPerDay, settings.otPremiumPercent, holidayMultiplier, r.date, settings.restDayOtPremiumPercent);
            totalRegularPay += otResult.regularPay;
            totalOvertimePay += otResult.overtimePay;
            totalOtHours += otResult.totalOtHours;
            totalRegularHours += otResult.regularHours;
            lastOtRate = otResult.otRate;

            // Holiday bonus: extra pay on top of base
            if (holiday && holidayMultiplier) {
                const baseRate = employee.salaryType === 'daily' ? employee.rate : employee.rate / 26;
                totalHolidayPay += baseRate * (holidayMultiplier - 1);
                holidayDaysCount += 1;
            }
        }
    });

    const grossPay = totalRegularPay + totalOvertimePay + totalHolidayPay;

    // Monthly equivalent for deduction computation
    const monthlyEquivalent = employee.salaryType === 'monthly' ? employee.rate : employee.rate * 26;

    const sssDeduction = benefit.sss ? Math.min(monthlyEquivalent * SSS_RATE, SSS_MAX) : 0;
    const philhealthDeduction = benefit.philhealth ? Math.min(monthlyEquivalent * PHILHEALTH_RATE, PHILHEALTH_MAX) : 0;
    const pagibigDeduction = benefit.pagibig ? Math.min(monthlyEquivalent * PAGIBIG_RATE, PAGIBIG_MAX) : 0;
    const totalDeductions = sssDeduction + philhealthDeduction + pagibigDeduction;
    const netPay = Math.max(0, grossPay - totalDeductions);

    return {
        employee, benefit, daysWorked, hoursWorked, grossPay,
        sssDeduction, philhealthDeduction, pagibigDeduction, totalDeductions, netPay,
        regularHours: totalRegularHours,
        overtimeHours: totalOtHours,
        regularPay: totalRegularPay,
        overtimePay: totalOvertimePay,
        otHourlyRate: lastOtRate,
        holidayPay: totalHolidayPay,
        holidayDays: holidayDaysCount,
        totalPay: grossPay,
    };
};

interface PayrollProps {
    employees: Employee[];
    benefits: EmployeeBenefit[];
    timeRecords: TimeRecord[];
    holidays: Holiday[];
    payrollSettings: PayrollSettings;
    addEmployee: (employeeData: Omit<Employee, 'id'>, benefitData: Omit<EmployeeBenefit, 'id' | 'employeeId'>) => Promise<{ generatedPassword: string | null }>;
    updateEmployee: (employee: Employee, benefit: EmployeeBenefit) => Promise<void>;
    deleteEmployee: (employeeId: string) => Promise<void>;
    saveTimeRecord: (record: Omit<TimeRecord, 'id'> | TimeRecord) => Promise<void>;
    deleteTimeRecord: (recordId: string) => Promise<void>;
    addHoliday: (holidayData: Omit<Holiday, 'id'>) => Promise<void>;
    updateHoliday: (holiday: Holiday) => Promise<void>;
    deleteHoliday: (holidayId: string) => Promise<void>;
    savePayrollSettings: (settings: PayrollSettings) => Promise<void>;
    resetEmployeePassword?: (employeeId: string) => Promise<string | null>;
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
    employeeRate: number;
    employeeSalaryType: 'daily' | 'monthly';
    holidays: Holiday[];
    payrollSettings: PayrollSettings;
    isSubmitting: boolean;
}> = ({ isOpen, onClose, onSave, initialData, employeeId, employeeRate, employeeSalaryType, holidays, payrollSettings, isSubmitting }) => {
    const [record, setRecord] = useState({ date: '', timeIn: '', timeOut: '', timeInAM: '', timeOutAM: '', timeInPM: '', timeOutPM: '' });

    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                setRecord({
                    date: initialData.date,
                    timeIn: initialData.timeIn || '', timeOut: initialData.timeOut || '',
                    timeInAM: initialData.timeInAM || '', timeOutAM: initialData.timeOutAM || '',
                    timeInPM: initialData.timeInPM || '', timeOutPM: initialData.timeOutPM || '',
                });
            } else {
                setRecord({ date: new Date().toISOString().split('T')[0], timeIn: '', timeOut: '', timeInAM: '', timeOutAM: '', timeInPM: '', timeOutPM: '' });
            }
        }
    }, [isOpen, initialData]);

    // Auto-compute total hours from AM/PM Form 48
    const totalHours = useMemo(() => {
        let h = 0;
        if (record.timeInAM && record.timeOutAM) {
            const [inH, inM] = record.timeInAM.split(':').map(Number);
            const [outH, outM] = record.timeOutAM.split(':').map(Number);
            const diff = (outH * 60 + outM) - (inH * 60 + inM);
            if (diff > 0) h += diff / 60;
        }
        if (record.timeInPM && record.timeOutPM) {
            const [inH, inM] = record.timeInPM.split(':').map(Number);
            const [outH, outM] = record.timeOutPM.split(':').map(Number);
            const diff = (outH * 60 + outM) - (inH * 60 + inM);
            if (diff > 0) h += diff / 60;
        }
        return h;
    }, [record.timeInAM, record.timeOutAM, record.timeInPM, record.timeOutPM]);

    // Auto-calculate overtime: anything beyond standard hours per day (default 8)
    const autoOtHours = Math.max(0, totalHours - payrollSettings.defaultHoursPerDay);

    // Detect holiday
    const holiday = holidays.find(h => h.date === record.date) || null;
    const holidayMultiplier = holiday
        ? (holiday.type === 'regular' ? payrollSettings.regularHolidayMultiplier : payrollSettings.specialHolidayMultiplier)
        : null;

    // Compute rate display
    const stdHours = payrollSettings.defaultHoursPerDay;
    const baseRate = employeeSalaryType === 'daily' ? employeeRate : employeeRate / 26;
    const effectiveBase = holidayMultiplier ? baseRate * holidayMultiplier : baseRate;
    const hourlyRate = effectiveBase / stdHours;
    const isSunday = record.date ? new Date(record.date).getDay() === 0 : false;
    const activePremium = isSunday ? payrollSettings.restDayOtPremiumPercent : payrollSettings.otPremiumPercent;
    const otRate = hourlyRate * (1 + activePremium / 100);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setRecord(r => ({ ...r, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const data: Omit<TimeRecord, 'id'> = {
            ...record,
            employeeId,
            otHours: autoOtHours,
            isOvertime: autoOtHours > 0 ? 1 : 0,
            holidayType: holiday ? holiday.type : null,
        };
        onSave(initialData ? { ...data, id: initialData.id } : data);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <h3 className="text-xl font-bold mb-4">{initialData ? 'Edit DTR Entry' : 'Add DTR Entry (Form 48)'}</h3>
                        <div className="space-y-4">
                            <div>
                                <label>Date</label>
                                <input type="date" name="date" value={record.date} onChange={handleChange} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                            </div>

                            {/* Holiday Badge */}
                            {holiday && (
                                <div className={`px-3 py-2 rounded-md text-sm font-semibold ${holiday.type === 'regular' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                                    {holiday.type === 'regular' ? '🔴 Regular Holiday' : '🔵 Special Holiday'} — {holiday.name} (x{holidayMultiplier})
                                </div>
                            )}

                            {/* AM/PM Split (Form 48) */}
                            <div className="border border-slate-200 dark:border-slate-600 rounded-lg p-3">
                                <p className="text-xs font-bold uppercase text-slate-500 mb-2">Morning (AM)</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-sm">Time In</label>
                                        <input type="time" name="timeInAM" value={record.timeInAM} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                    </div>
                                    <div>
                                        <label className="text-sm">Time Out</label>
                                        <input type="time" name="timeOutAM" value={record.timeOutAM} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                    </div>
                                </div>
                            </div>
                            <div className="border border-slate-200 dark:border-slate-600 rounded-lg p-3">
                                <p className="text-xs font-bold uppercase text-slate-500 mb-2">Afternoon (PM)</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-sm">Time In</label>
                                        <input type="time" name="timeInPM" value={record.timeInPM} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                    </div>
                                    <div>
                                        <label className="text-sm">Time Out</label>
                                        <input type="time" name="timeOutPM" value={record.timeOutPM} onChange={handleChange} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                    </div>
                                </div>
                            </div>

                            {/* Auto-computed Summary */}
                            <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-700/50 rounded-md px-3 py-2">
                                <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Total Hours</span>
                                <span className="font-bold text-lg">{totalHours.toFixed(2)} hrs</span>
                            </div>

                            {/* Auto Overtime Display */}
                            {autoOtHours > 0 && (
                                <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-700 rounded-md px-3 py-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">⏱ Overtime (auto-calculated)</span>
                                        <span className="font-bold text-amber-700 dark:text-amber-400">{autoOtHours.toFixed(2)} hrs</span>
                                    </div>
                                    <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">Exceeds standard {payrollSettings.defaultHoursPerDay}hr work day</p>
                                </div>
                            )}

                            {/* Rate Display */}
                            <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-700 rounded-md px-3 py-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-slate-600 dark:text-slate-300">Hourly Rate</span>
                                    <span className="font-semibold">₱{hourlyRate.toFixed(2)}/hr</span>
                                </div>
                                <div className="flex justify-between mt-1">
                                    <span className="text-emerald-700 dark:text-emerald-400">OT Rate (+{activePremium}%{isSunday ? ' Sun' : ''})</span>
                                    <span className="font-bold text-emerald-700 dark:text-emerald-400">₱{otRate.toFixed(2)}/hr</span>
                                </div>
                                {isSunday && (
                                    <div className="mt-1 text-xs text-amber-600 dark:text-amber-400 font-semibold">☀️ Sunday / Rest Day premium applies</div>
                                )}
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
    const { employees, benefits, timeRecords, holidays, payrollSettings, addEmployee, updateEmployee, deleteEmployee, saveTimeRecord, deleteTimeRecord, addHoliday, updateHoliday, deleteHoliday, savePayrollSettings, resetEmployeePassword, isLoading, error, onPayrollPaid } = props;
    const [activeTab, setActiveTab] = useState<'employees' | 'time_records' | 'generate_payroll' | 'holidays'>('employees');
    const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState<{ employee: Employee, benefit: EmployeeBenefit } | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { t, formatCurrency } = useLocalization();
    const [selectedEmployeeForDtr, setSelectedEmployeeForDtr] = useState<Employee | null>(null);
    const [isTimeRecordModalOpen, setIsTimeRecordModalOpen] = useState(false);
    const [editingTimeRecord, setEditingTimeRecord] = useState<TimeRecord | null>(null);
    const [payrollPaid, setPayrollPaid] = useState(false);
    const [isProcessingPayment, setIsProcessingPayment] = useState(false);
    const [isHolidayModalOpen, setIsHolidayModalOpen] = useState(false);
    const [editingHoliday, setEditingHoliday] = useState<Holiday | null>(null);
    const [holidayForm, setHolidayForm] = useState({ name: '', date: '', type: 'regular' as 'regular' | 'special' });
    const [settingsDraft, setSettingsDraft] = useState<PayrollSettings>(payrollSettings);
    const [settingsSaved, setSettingsSaved] = useState(true);
    const [selectedEmployeeForId, setSelectedEmployeeForId] = useState<Employee | null>(null);
    const [isIdModalOpen, setIsIdModalOpen] = useState(false);
    const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);

    // Payroll generation state
    const today = new Date();
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
    const [periodStart, setPeriodStart] = useState(firstOfMonth);
    const [periodEnd, setPeriodEnd] = useState(lastOfMonth);
    const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());
    const [generated, setGenerated] = useState(false);
    const printRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setSettingsDraft(payrollSettings);
    }, [payrollSettings]);

    const payrollEntries = useMemo<PayrollEntry[]>(() => {
        if (!generated) return [];
        const targets = employees.filter(e => selectedEmployeeIds.size === 0 || selectedEmployeeIds.has(e.id));
        return targets.map(emp => {
            const benefit = benefits.find(b => b.employeeId === emp.id) || { id: '', employeeId: emp.id, sss: false, philhealth: false, pagibig: false };
            const empRecords = timeRecords.filter(r => r.employeeId === emp.id);
            return computePayrollEntry(emp, benefit, empRecords, periodStart, periodEnd, holidays, payrollSettings);
        });
    }, [generated, employees, benefits, timeRecords, selectedEmployeeIds, periodStart, periodEnd, holidays, payrollSettings]);

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
        printPayrollThermal({
            entries: payrollEntries,
            periodStart, periodEnd,
        });
    };

    const handleDeletePayroll = () => {
        if (window.confirm('Delete this payroll generation? You can then regenerate it.')) {
            setGenerated(false);
            setPayrollPaid(false);
        }
    };

    const handlePrintDtr = () => {
        if (!selectedEmployeeForDtr) return;
        const win = window.open('', '_blank');
        if (!win) return;
        const records = employeeTimeRecords.slice().sort((a, b) => a.date.localeCompare(b.date));
        let totalHours = 0;
        let totalOtHours = 0;
        let holidayCount = 0;
        const rows = records.map((rec, i) => {
            const hrs = computeHoursFromForm48(rec);
            const otHrs = Math.max(0, hrs - payrollSettings.defaultHoursPerDay);
            totalHours += hrs;
            totalOtHours += otHrs;
            const hol = holidays.find(h => h.date === rec.date);
            if (hol) holidayCount++;
            const holBadge = hol ? (hol.type === 'regular' ? `<span style="color:red;font-weight:bold">RH - ${hol.name}</span>` : `<span style="color:blue;font-weight:bold">SH - ${hol.name}</span>`) : '';
            const otMark = otHrs > 0 ? `<span style="color:#d97706;font-weight:bold">OT ${otHrs.toFixed(1)}h</span>` : '';
            return `<tr><td>${i + 1}</td><td>${rec.date}</td><td>${formatTime12h(rec.timeInAM || rec.timeIn)}</td><td>${formatTime12h(rec.timeOutAM || rec.timeOut)}</td><td>${formatTime12h(rec.timeInPM)}</td><td>${formatTime12h(rec.timeOutPM)}</td><td style="text-align:center">${hrs.toFixed(2)}</td><td>${otMark}</td><td>${holBadge}</td></tr>`;
        }).join('');

        const stdHrs = payrollSettings.defaultHoursPerDay;
        const baseRate = selectedEmployeeForDtr.salaryType === 'daily' ? selectedEmployeeForDtr.rate : selectedEmployeeForDtr.rate / 26;
        const hourlyRate = baseRate / stdHrs;
        const otRate = hourlyRate * (1 + payrollSettings.otPremiumPercent / 100);
        const sundayOtRate = hourlyRate * (1 + payrollSettings.restDayOtPremiumPercent / 100);

        win.document.write(`
            <html><head><title>DTR Form 48 - ${selectedEmployeeForDtr.fullName}</title>
            <style>
                body { font-family: Arial, sans-serif; font-size: 11px; color: #000; margin: 20px; }
                h2 { text-align: center; margin-bottom: 2px; font-size: 16px; }
                h3 { text-align: center; margin-bottom: 12px; font-size: 12px; color: #555; }
                .info { margin-bottom: 12px; }
                .info span { margin-right: 24px; }
                table { width: 100%; border-collapse: collapse; }
                th, td { border: 1px solid #999; padding: 4px 8px; text-align: left; }
                th { background: #e5e7eb; font-weight: bold; font-size: 10px; text-transform: uppercase; }
                .summary { margin-top: 16px; }
                .summary td { font-weight: bold; }
            </style>
            </head><body>
            <h2>DAILY TIME RECORD</h2>
            <h3>(Form 48)</h3>
            <div class="info">
                <span><strong>Name:</strong> ${selectedEmployeeForDtr.fullName}</span>
                <span><strong>Position:</strong> ${selectedEmployeeForDtr.role}</span>
                <span><strong>Period:</strong> ${records.length > 0 ? records[0].date : ''} to ${records.length > 0 ? records[records.length - 1].date : ''}</span>
            </div>
            <table>
                <thead><tr><th>#</th><th>Date</th><th>AM In</th><th>AM Out</th><th>PM In</th><th>PM Out</th><th>Hours</th><th>OT</th><th>Holiday</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <table class="summary" style="margin-top:16px;width:60%">
                <tr><td>Total Regular Hours</td><td>${totalHours.toFixed(2)} hrs</td></tr>
                <tr><td>Total OT Hours</td><td>${totalOtHours.toFixed(2)} hrs</td></tr>
                <tr><td>Holiday Days Worked</td><td>${holidayCount}</td></tr>
                <tr><td>Hourly Rate</td><td>₱${hourlyRate.toFixed(2)}/hr</td></tr>
                <tr><td>OT Rate (+${payrollSettings.otPremiumPercent}%)</td><td>₱${otRate.toFixed(2)}/hr</td></tr>
                <tr><td>Sunday OT Rate (+${payrollSettings.restDayOtPremiumPercent}%)</td><td>₱${sundayOtRate.toFixed(2)}/hr</td></tr>
            </table>
            <div style="margin-top:40px;display:flex;justify-content:space-between">
                <div style="border-top:1px solid #000;width:200px;text-align:center;padding-top:4px">Employee Signature</div>
                <div style="border-top:1px solid #000;width:200px;text-align:center;padding-top:4px">Supervisor Signature</div>
            </div>
            </body></html>
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
                const result = await addEmployee(employeeData, benefitData);
                if (result?.generatedPassword) {
                    setGeneratedPassword(result.generatedPassword);
                }
            }
            setIsEmployeeModalOpen(false);
        } catch (err) {
            console.error(err);
            alert("Failed to save employee.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleResetPassword = async (emp: Employee) => {
        if (!resetEmployeePassword) return;
        if (!confirm(`Reset password for ${emp.fullName}?`)) return;
        try {
            const newPw = await resetEmployeePassword(emp.id);
            if (newPw) {
                setGeneratedPassword(newPw);
            }
        } catch (err) {
            console.error(err);
            alert('Failed to reset password.');
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

    const handleSaveHoliday = async () => {
        if (!holidayForm.name || !holidayForm.date) return;
        setIsSubmitting(true);
        try {
            if (editingHoliday) {
                await updateHoliday({ ...editingHoliday, ...holidayForm });
            } else {
                await addHoliday(holidayForm);
            }
            setIsHolidayModalOpen(false);
            setEditingHoliday(null);
            setHolidayForm({ name: '', date: '', type: 'regular' });
        } catch (err) {
            console.error(err);
            alert('Failed to save holiday.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSaveSettings = async () => {
        setIsSubmitting(true);
        try {
            await savePayrollSettings(settingsDraft);
            setSettingsSaved(true);
        } catch (err) {
            console.error(err);
            alert('Failed to save payroll settings.');
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
                            <button onClick={() => { setEditingEmployee(null); setGeneratedPassword(null); setIsEmployeeModalOpen(true); }} className="bg-[--color-primary-600] text-white font-bold py-2 px-4 rounded-lg">Add Employee</button>
                        </div>

                        {/* Generated Password Alert */}
                        {generatedPassword && (
                            <div className="mb-4 p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Employee credentials generated:</p>
                                        <p className="text-lg font-mono font-bold text-emerald-800 dark:text-emerald-200 mt-1">Password: {generatedPassword}</p>
                                        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">Please share this with the employee. It will not be shown again.</p>
                                    </div>
                                    <button onClick={() => setGeneratedPassword(null)} className="p-1 text-emerald-600 hover:text-emerald-800">
                                        <XMarkIcon className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                        )}
                        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50"><tr><th className="px-6 py-3">Name</th><th className="px-6 py-3">Role</th><th className="px-6 py-3">Salary</th><th className="px-6 py-3 text-right">Actions</th></tr></thead>
                                <tbody>
                                    {employees.map(emp => {
                                        const benefit = benefits.find(b => b.employeeId === emp.id);
                                        return (
                                            <tr key={emp.id} className="border-b dark:border-slate-700">
                                                <td className="px-6 py-4 font-medium">
                                                    <button
                                                        onClick={() => { setSelectedEmployeeForId(emp); setIsIdModalOpen(true); }}
                                                        className="hover:text-emerald-600 cursor-pointer text-left transition-colors"
                                                        title="View Employee ID Card"
                                                    >
                                                        {emp.fullName}
                                                    </button>
                                                </td>
                                                <td>{emp.role}</td>
                                                <td>{formatCurrency(emp.rate)} / {emp.salaryType}</td>
                                                <td className="px-6 py-4 text-right space-x-2">
                                                    <button onClick={() => { if(benefit) { setEditingEmployee({ employee: emp, benefit }); setIsEmployeeModalOpen(true); }}} className="p-1" title="Edit"><EditIcon className="w-5 h-5"/></button>
                                                    {resetEmployeePassword && (
                                                        <button onClick={() => handleResetPassword(emp)} className="p-1 text-amber-500 hover:text-amber-700" title="Reset Password">
                                                            <KeyIcon className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                    <button onClick={() => deleteEmployee(emp.id)} className="p-1" title="Delete"><TrashIcon className="w-5 h-5"/></button>
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
                                <div className="flex justify-between items-center mb-4">
                                    <button onClick={() => handlePrintDtr()} className="text-sm px-3 py-1.5 bg-slate-600 text-white rounded-lg hover:bg-slate-700">Print DTR (Form 48)</button>
                                    <button onClick={() => { setEditingTimeRecord(null); setIsTimeRecordModalOpen(true); }} className="bg-[--color-primary-600] text-white font-bold py-2 px-4 rounded-lg">Add DTR Entry</button>
                                </div>
                                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50">
                                            <tr>
                                                <th className="px-3 py-3">Date</th>
                                                <th className="px-3 py-3">AM In</th>
                                                <th className="px-3 py-3">AM Out</th>
                                                <th className="px-3 py-3">PM In</th>
                                                <th className="px-3 py-3">PM Out</th>
                                                <th className="px-3 py-3 text-center">Total</th>
                                                <th className="px-3 py-3 text-center">OT</th>
                                                <th className="px-3 py-3 text-center">Holiday</th>
                                                <th className="px-3 py-3 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {employeeTimeRecords.map(rec => {
                                                const hrs = computeHoursFromForm48(rec);
                                                const otHrs = Math.max(0, hrs - payrollSettings.defaultHoursPerDay);
                                                const hol = holidays.find(h => h.date === rec.date);
                                                return (
                                                <tr key={rec.id} className={`border-b dark:border-slate-700 ${hol ? (hol.type === 'regular' ? 'bg-red-50 dark:bg-red-900/10' : 'bg-blue-50 dark:bg-blue-900/10') : ''}`}>
                                                    <td className="px-3 py-3 font-medium">
                                                        <div className="flex items-center gap-1.5">
                                                            {rec.date}
                                                            {rec.source === 'employee' && (
                                                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 uppercase" title="Recorded via Employee Clock-In">Clock-In</span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-3">{formatTime12h(rec.timeInAM || rec.timeIn) || '--'}</td>
                                                    <td className="px-3 py-3">{formatTime12h(rec.timeOutAM || rec.timeOut) || '--'}</td>
                                                    <td className="px-3 py-3">{formatTime12h(rec.timeInPM) || '--'}</td>
                                                    <td className="px-3 py-3">{formatTime12h(rec.timeOutPM) || '--'}</td>
                                                    <td className="px-3 py-3 text-center">{hrs.toFixed(1)}h</td>
                                                    <td className="px-3 py-3 text-center">
                                                        {otHrs > 0
                                                            ? <span className="text-amber-600 font-semibold">{otHrs.toFixed(1)}h</span>
                                                            : <span className="text-slate-400">—</span>}
                                                    </td>
                                                    <td className="px-3 py-3 text-center">
                                                        {hol
                                                            ? <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${hol.type === 'regular' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>{hol.type === 'regular' ? 'RH' : 'SH'}</span>
                                                            : <span className="text-slate-400">—</span>}
                                                    </td>
                                                    <td className="px-3 py-3 text-right space-x-2">
                                                        <button onClick={() => { setEditingTimeRecord(rec); setIsTimeRecordModalOpen(true); }} className="p-1" title="Edit"><EditIcon className="w-5 h-5"/></button>
                                                        {rec.source !== 'employee' && (
                                                            <button onClick={() => deleteTimeRecord(rec.id)} className="p-1" title="Delete"><TrashIcon className="w-5 h-5"/></button>
                                                        )}
                                                    </td>
                                                </tr>
                                                );
                                            })}
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
                                        <button onClick={handleDeletePayroll}
                                            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors">
                                            <TrashIcon className="w-4 h-4" />
                                            Delete
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
                                                        <th className="px-3 py-3 text-left">Employee</th>
                                                        <th className="px-3 py-3 text-left">Role</th>
                                                        <th className="px-3 py-3 text-center">Days</th>
                                                        <th className="px-3 py-3 text-center">Hours</th>
                                                        <th className="px-3 py-3 text-center">OT Hrs</th>
                                                        <th className="px-3 py-3 text-right">OT Pay</th>
                                                        <th className="px-3 py-3 text-center">Hol</th>
                                                        <th className="px-3 py-3 text-right">Hol Pay</th>
                                                        <th className="px-3 py-3 text-right">Gross</th>
                                                        <th className="px-3 py-3 text-right">SSS</th>
                                                        <th className="px-3 py-3 text-right">PhilHealth</th>
                                                        <th className="px-3 py-3 text-right">Pag-IBIG</th>
                                                        <th className="px-3 py-3 text-right">Deductions</th>
                                                        <th className="px-3 py-3 text-right font-bold text-slate-700 dark:text-slate-200">Net Pay</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                                    {payrollEntries.map(entry => (
                                                        <tr key={entry.employee.id} className="bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                                                            <td className="px-3 py-3 font-semibold text-slate-800 dark:text-slate-100">{entry.employee.fullName}</td>
                                                            <td className="px-3 py-3 text-slate-500 dark:text-slate-400">{entry.employee.role}</td>
                                                            <td className="px-3 py-3 text-center">{entry.daysWorked}</td>
                                                            <td className="px-3 py-3 text-center">{entry.regularHours.toFixed(1)}</td>
                                                            <td className="px-3 py-3 text-center text-amber-600 font-medium">{entry.overtimeHours > 0 ? entry.overtimeHours.toFixed(1) : '—'}</td>
                                                            <td className="px-3 py-3 text-right text-amber-600">{entry.overtimePay > 0 ? formatCurrency(entry.overtimePay) : '—'}</td>
                                                            <td className="px-3 py-3 text-center">{entry.holidayDays > 0 ? <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">{entry.holidayDays}d</span> : '—'}</td>
                                                            <td className="px-3 py-3 text-right text-red-500">{entry.holidayPay > 0 ? formatCurrency(entry.holidayPay) : '—'}</td>
                                                            <td className="px-3 py-3 text-right font-medium">{formatCurrency(entry.grossPay)}</td>
                                                            <td className="px-3 py-3 text-right text-red-500 dark:text-red-400">
                                                                {entry.benefit.sss ? formatCurrency(entry.sssDeduction) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                                                            </td>
                                                            <td className="px-3 py-3 text-right text-red-500 dark:text-red-400">
                                                                {entry.benefit.philhealth ? formatCurrency(entry.philhealthDeduction) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                                                            </td>
                                                            <td className="px-3 py-3 text-right text-red-500 dark:text-red-400">
                                                                {entry.benefit.pagibig ? formatCurrency(entry.pagibigDeduction) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                                                            </td>
                                                            <td className="px-3 py-3 text-right text-red-600 dark:text-red-400 font-medium">{formatCurrency(entry.totalDeductions)}</td>
                                                            <td className="px-3 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(entry.netPay)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                                <tfoot className="bg-slate-50 dark:bg-slate-900/60 border-t-2 border-slate-300 dark:border-slate-600">
                                                    <tr>
                                                        <td colSpan={4} className="px-3 py-3 font-bold text-slate-700 dark:text-slate-200 uppercase text-xs tracking-wider">
                                                            Totals ({payrollEntries.length} employee{payrollEntries.length !== 1 ? 's' : ''})
                                                        </td>
                                                        <td className="px-3 py-3 text-center font-bold text-amber-600">{payrollEntries.reduce((s, e) => s + e.overtimeHours, 0).toFixed(1)}</td>
                                                        <td className="px-3 py-3"></td>
                                                        <td className="px-3 py-3 text-center font-bold">{payrollEntries.reduce((s, e) => s + e.holidayDays, 0)}</td>
                                                        <td className="px-3 py-3"></td>
                                                        <td className="px-3 py-3 text-right font-bold text-slate-800 dark:text-slate-100">{formatCurrency(totals.gross)}</td>
                                                        <td colSpan={3}></td>
                                                        <td className="px-3 py-3 text-right font-bold text-red-600 dark:text-red-400">{formatCurrency(totals.deductions)}</td>
                                                        <td className="px-3 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400 text-base">{formatCurrency(totals.net)}</td>
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
                                                            <span className="text-slate-500 dark:text-slate-400">Regular Hours</span>
                                                            <span className="font-medium">{entry.regularHours.toFixed(1)} hrs</span>
                                                        </div>
                                                        {entry.overtimeHours > 0 && (
                                                            <div className="flex justify-between text-amber-600 dark:text-amber-400">
                                                                <span>OT Hours ({entry.overtimeHours.toFixed(1)}h @ ₱{entry.otHourlyRate.toFixed(2)}/hr)</span>
                                                                <span className="font-medium">+{formatCurrency(entry.overtimePay)}</span>
                                                            </div>
                                                        )}
                                                        {entry.holidayDays > 0 && (
                                                            <div className="flex justify-between text-red-500 dark:text-red-400">
                                                                <span>Holiday Bonus ({entry.holidayDays} day{entry.holidayDays > 1 ? 's' : ''})</span>
                                                                <span className="font-medium">+{formatCurrency(entry.holidayPay)}</span>
                                                            </div>
                                                        )}
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
            case 'holidays':
                return (
                    <div className="space-y-6">
                        {/* Payroll Settings Panel */}
                        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
                            <div className="flex items-center gap-2 mb-4">
                                <CogIcon className="w-5 h-5 text-slate-500" />
                                <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Payroll Rate Settings</h3>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Overtime Premium (%)</label>
                                    <input type="number" value={settingsDraft.otPremiumPercent} onChange={e => { setSettingsDraft(s => ({ ...s, otPremiumPercent: parseFloat(e.target.value) || 0 })); setSettingsSaved(false); }} min={0} max={300} step={5} className="w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md text-sm" />
                                    <p className="text-xs text-slate-400 mt-1">OT = hourly rate × (1 + {settingsDraft.otPremiumPercent}/100)</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">☀️ Sunday / Rest Day OT Premium (%)</label>
                                    <input type="number" value={settingsDraft.restDayOtPremiumPercent} onChange={e => { setSettingsDraft(s => ({ ...s, restDayOtPremiumPercent: parseFloat(e.target.value) || 0 })); setSettingsSaved(false); }} min={0} max={300} step={5} className="w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md text-sm" />
                                    <p className="text-xs text-slate-400 mt-1">Sunday OT = hourly rate × (1 + {settingsDraft.restDayOtPremiumPercent}/100)</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Regular Holiday Multiplier (×)</label>
                                    <input type="number" value={settingsDraft.regularHolidayMultiplier} onChange={e => { setSettingsDraft(s => ({ ...s, regularHolidayMultiplier: parseFloat(e.target.value) || 1 })); setSettingsSaved(false); }} min={1} max={5} step={0.1} className="w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md text-sm" />
                                    <p className="text-xs text-slate-400 mt-1">Employee gets ×{settingsDraft.regularHolidayMultiplier} of daily rate</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Special Holiday Multiplier (×)</label>
                                    <input type="number" value={settingsDraft.specialHolidayMultiplier} onChange={e => { setSettingsDraft(s => ({ ...s, specialHolidayMultiplier: parseFloat(e.target.value) || 1 })); setSettingsSaved(false); }} min={1} max={5} step={0.1} className="w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md text-sm" />
                                    <p className="text-xs text-slate-400 mt-1">Employee gets ×{settingsDraft.specialHolidayMultiplier} of daily rate</p>
                                </div>
                            </div>

                            {/* Live Preview */}
                            <div className="mt-4 p-3 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-700 rounded-lg text-sm">
                                <p className="font-semibold text-emerald-800 dark:text-emerald-300 mb-2">Live Preview (based on ₱500/day, {settingsDraft.defaultHoursPerDay}hrs):</p>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                                    <div><span className="text-slate-500">Hourly:</span> <span className="font-bold">₱{(500 / settingsDraft.defaultHoursPerDay).toFixed(2)}</span></div>
                                    <div><span className="text-emerald-600">OT Rate:</span> <span className="font-bold">₱{(500 / settingsDraft.defaultHoursPerDay * (1 + settingsDraft.otPremiumPercent / 100)).toFixed(2)}</span></div>
                                    <div><span className="text-amber-600">Sunday OT:</span> <span className="font-bold">₱{(500 / settingsDraft.defaultHoursPerDay * (1 + settingsDraft.restDayOtPremiumPercent / 100)).toFixed(2)}</span></div>
                                    <div><span className="text-amber-600">Std Day:</span> <span className="font-bold">{settingsDraft.defaultHoursPerDay} hrs</span></div>
                                </div>
                            </div>

                            <div className="mt-4 flex justify-end">
                                <button onClick={handleSaveSettings} disabled={isSubmitting || settingsSaved} className="px-4 py-2 bg-[--color-primary-600] text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                                    {isSubmitting ? 'Saving...' : settingsSaved ? '✓ Saved' : 'Save Settings'}
                                </button>
                            </div>
                        </div>

                        {/* Holiday Rules Info Box */}
                        <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-700 rounded-lg p-4 text-sm">
                            <p className="font-bold text-amber-800 dark:text-amber-300 mb-2">Holiday Pay Rules (Philippine Labor Code):</p>
                            <ul className="list-disc list-inside space-y-1 text-amber-700 dark:text-amber-400">
                                <li><strong>Regular Holiday:</strong> Employee receives ×{payrollSettings.regularHolidayMultiplier} ({(payrollSettings.regularHolidayMultiplier - 1) * 100}%) of daily rate if they report for work</li>
                                <li><strong>Special Holiday:</strong> Employee receives ×{payrollSettings.specialHolidayMultiplier} ({(payrollSettings.specialHolidayMultiplier - 1) * 100}% additional) of daily rate if they report for work</li>
                                <li><strong>Overtime on Holiday:</strong> OT rate is computed on top of the holiday-multiplied rate</li>
                            </ul>
                        </div>

                        {/* Holiday List */}
                        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                            <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
                                <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                    <CalendarIcon className="w-5 h-5" /> Philippine Holidays
                                </h3>
                                <button onClick={() => { setEditingHoliday(null); setHolidayForm({ name: '', date: '', type: 'regular' }); setIsHolidayModalOpen(true); }} className="bg-[--color-primary-600] text-white text-sm font-bold py-2 px-4 rounded-lg">Add Holiday</button>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="text-xs uppercase bg-slate-50 dark:bg-slate-900/50">
                                        <tr>
                                            <th className="px-4 py-3 text-left">Date</th>
                                            <th className="px-4 py-3 text-left">Holiday Name</th>
                                            <th className="px-4 py-3 text-center">Type</th>
                                            <th className="px-4 py-3 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {holidays.length === 0 ? (
                                            <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">No holidays added yet. Click "Add Holiday" to get started.</td></tr>
                                        ) : holidays.map(hol => (
                                            <tr key={hol.id} className="border-b dark:border-slate-700">
                                                <td className="px-4 py-3 font-medium">{hol.date}</td>
                                                <td className="px-4 py-3">{hol.name}</td>
                                                <td className="px-4 py-3 text-center">
                                                    <span className={`text-xs font-bold px-2 py-1 rounded ${hol.type === 'regular' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                                                        {hol.type === 'regular' ? `Regular (×${payrollSettings.regularHolidayMultiplier})` : `Special (×${payrollSettings.specialHolidayMultiplier})`}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-right space-x-2">
                                                    <button onClick={() => { setEditingHoliday(hol); setHolidayForm({ name: hol.name, date: hol.date, type: hol.type }); setIsHolidayModalOpen(true); }} className="p-1"><EditIcon className="w-5 h-5"/></button>
                                                    <button onClick={() => deleteHoliday(hol.id)} className="p-1"><TrashIcon className="w-5 h-5"/></button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Holiday Modal */}
                        {isHolidayModalOpen && (
                            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-md">
                                    <div className="p-6">
                                        <h3 className="text-xl font-bold mb-4">{editingHoliday ? 'Edit Holiday' : 'Add Holiday'}</h3>
                                        <div className="space-y-4">
                                            <div>
                                                <label>Holiday Name</label>
                                                <input value={holidayForm.name} onChange={e => setHolidayForm(f => ({ ...f, name: e.target.value }))} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" placeholder="e.g. New Year's Day" />
                                            </div>
                                            <div>
                                                <label>Date</label>
                                                <input type="date" value={holidayForm.date} onChange={e => setHolidayForm(f => ({ ...f, date: e.target.value }))} required className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md" />
                                            </div>
                                            <div>
                                                <label>Type</label>
                                                <select value={holidayForm.type} onChange={e => setHolidayForm(f => ({ ...f, type: e.target.value as 'regular' | 'special' }))} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md">
                                                    <option value="regular">Regular (×{payrollSettings.regularHolidayMultiplier})</option>
                                                    <option value="special">Special (×{payrollSettings.specialHolidayMultiplier})</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end gap-4">
                                        <button onClick={() => { setIsHolidayModalOpen(false); setEditingHoliday(null); }} disabled={isSubmitting}>Cancel</button>
                                        <button onClick={handleSaveHoliday} disabled={isSubmitting || !holidayForm.name || !holidayForm.date} className="px-4 py-2 bg-[--color-primary-600] text-white rounded-md disabled:opacity-50">{isSubmitting ? 'Saving...' : 'Save'}</button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                );
        }
    };
    
    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <EmployeeFormModal isOpen={isEmployeeModalOpen} onClose={() => setIsEmployeeModalOpen(false)} onSave={handleSaveEmployee} initialData={editingEmployee} isSubmitting={isSubmitting} />
            {selectedEmployeeForDtr && <TimeRecordModal isOpen={isTimeRecordModalOpen} onClose={() => setIsTimeRecordModalOpen(false)} onSave={handleSaveTimeRecord} initialData={editingTimeRecord} employeeId={selectedEmployeeForDtr.id} employeeRate={selectedEmployeeForDtr.rate} employeeSalaryType={selectedEmployeeForDtr.salaryType} holidays={holidays} payrollSettings={payrollSettings} isSubmitting={isSubmitting} />}
            <div className="border-b border-slate-200 dark:border-slate-700">
                <nav className="flex space-x-2">
                    <button onClick={() => setActiveTab('employees')} className={`flex items-center gap-2 px-4 py-2 ${activeTab === 'employees' ? 'border-b-2 border-[--color-primary-500]' : ''}`}><UsersIcon className="w-5 h-5"/> Employees</button>
                    <button onClick={() => setActiveTab('time_records')} className={`flex items-center gap-2 px-4 py-2 ${activeTab === 'time_records' ? 'border-b-2 border-[--color-primary-500]' : ''}`}><ClockIcon className="w-5 h-5"/> Time Records</button>
                    <button onClick={() => setActiveTab('generate_payroll')} className={`flex items-center gap-2 px-4 py-2 ${activeTab === 'generate_payroll' ? 'border-b-2 border-[--color-primary-500]' : ''}`}><CalculatorIcon className="w-5 h-5"/> Generate Payroll</button>
                    <button onClick={() => setActiveTab('holidays')} className={`flex items-center gap-2 px-4 py-2 ${activeTab === 'holidays' ? 'border-b-2 border-[--color-primary-500]' : ''}`}><CalendarIcon className="w-5 h-5"/> Holidays</button>
                </nav>
            </div>
            {renderContent()}
            <EmployeeIDModal isOpen={isIdModalOpen} onClose={() => setIsIdModalOpen(false)} employee={selectedEmployeeForId} />
        </div>
    );
};
