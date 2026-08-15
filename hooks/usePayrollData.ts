import { useState, useEffect, useCallback } from 'react';
import type { Employee, EmployeeBenefit, TimeRecord, Holiday, PayrollSettings, SalaryRecord } from '../types.ts';
import { dbApi } from '../services/databaseService.ts';

const DEFAULT_PAYROLL_SETTINGS: PayrollSettings = {
    otPremiumPercent: 50,
    restDayOtPremiumPercent: 50,
    regularHolidayMultiplier: 2.0,
    specialHolidayMultiplier: 1.5,
    defaultHoursPerDay: 8,
};

export const usePayrollData = (autoLoad: boolean = true) => {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [benefits, setBenefits] = useState<EmployeeBenefit[]>([]);
    const [timeRecords, setTimeRecords] = useState<TimeRecord[]>([]);
    const [holidays, setHolidays] = useState<Holiday[]>([]);
    const [payrollSettings, setPayrollSettings] = useState<PayrollSettings>(DEFAULT_PAYROLL_SETTINGS);
    const [salaryRecords, setSalaryRecords] = useState<SalaryRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [empData, benData, timeData, holidayData, settingsData] = await Promise.all([
                dbApi.get<Employee[]>('/employees'),
                dbApi.get<EmployeeBenefit[]>('/employee-benefits'),
                dbApi.get<TimeRecord[]>('/time-records'),
                dbApi.get<Holiday[]>('/holidays'),
                dbApi.get<Record<string, number>>('/payroll-settings'),
            ]);
            setEmployees(empData.sort((a, b) => a.fullName.localeCompare(b.fullName)));
            setBenefits(benData);
            setTimeRecords(timeData);
            setHolidays(holidayData.sort((a, b) => a.date.localeCompare(b.date)));
            setPayrollSettings({
                otPremiumPercent: settingsData.otPremiumPercent ?? DEFAULT_PAYROLL_SETTINGS.otPremiumPercent,
                restDayOtPremiumPercent: settingsData.restDayOtPremiumPercent ?? DEFAULT_PAYROLL_SETTINGS.restDayOtPremiumPercent,
                regularHolidayMultiplier: settingsData.regularHolidayMultiplier ?? DEFAULT_PAYROLL_SETTINGS.regularHolidayMultiplier,
                specialHolidayMultiplier: settingsData.specialHolidayMultiplier ?? DEFAULT_PAYROLL_SETTINGS.specialHolidayMultiplier,
                defaultHoursPerDay: settingsData.defaultHoursPerDay ?? DEFAULT_PAYROLL_SETTINGS.defaultHoursPerDay,
            });
        } catch (err) {
            setError((err as Error).message);
            console.error("Failed to fetch payroll data from DB", err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!autoLoad) {
            setIsLoading(false);
            return;
        }
        fetchData();
    }, [fetchData, autoLoad]);

    const addEmployee = async (employeeData: Omit<Employee, 'id'>, benefitData: Omit<EmployeeBenefit, 'id' | 'employeeId'>) => {
        try {
            const newEmployee: Employee = {
                ...employeeData,
                id: `emp_${Date.now()}`,
            };
            const result = await dbApi.post<{ message: string; generatedPassword?: string }>('/employees', newEmployee);
            
            const newBenefit: EmployeeBenefit = {
                ...benefitData,
                id: `ben_${Date.now()}`,
                employeeId: newEmployee.id,
            };
            await dbApi.post('/employee-benefits', newBenefit);
            await fetchData();
            return { generatedPassword: result?.generatedPassword || null };
        } catch (err) {
            console.error("Failed to add employee:", err);
            throw err;
        }
    };

    const updateEmployee = async (updatedEmployee: Employee, updatedBenefit: EmployeeBenefit) => {
        try {
            await Promise.all([
                dbApi.patch(`/employees/${updatedEmployee.id}`, updatedEmployee),
                dbApi.patch(`/employee-benefits/${updatedBenefit.id}`, updatedBenefit),
            ]);
            await fetchData();
        } catch (err) {
            console.error("Failed to update employee:", err);
            throw err;
        }
    };
    
    const deleteEmployee = async (employeeId: string) => {
        try {
            await dbApi.delete(`/employees/${employeeId}`); // Benefits and time records will be deleted by CASCADE
            await fetchData();
        } catch (err) {
            console.error("Failed to delete employee:", err);
            throw err;
        }
    };
    
    const saveTimeRecord = async (recordData: Omit<TimeRecord, 'id'> | TimeRecord) => {
        try {
            if ('id' in recordData) {
                 await dbApi.patch(`/time-records/${recordData.id}`, recordData);
            } else {
                const newRecord = { ...recordData, id: `dtr_${Date.now()}`};
                await dbApi.post('/time-records', newRecord);
            }
            await fetchData();
        } catch (err) {
             console.error("Failed to save time record:", err);
            throw err;
        }
    }
    
    const deleteTimeRecord = async (recordId: string) => {
        try {
            await dbApi.delete(`/time-records/${recordId}`);
            await fetchData();
        } catch (err) {
            console.error("Failed to delete time record:", err);
        }
    }

    const addHoliday = async (holidayData: Omit<Holiday, 'id'>) => {
        try {
            const newHoliday: Holiday = { ...holidayData, id: `hol_${Date.now()}` };
            await dbApi.post('/holidays', newHoliday);
            await fetchData();
        } catch (err) {
            console.error("Failed to add holiday:", err);
            throw err;
        }
    };

    const updateHoliday = async (holiday: Holiday) => {
        try {
            await dbApi.patch(`/holidays/${holiday.id}`, holiday);
            await fetchData();
        } catch (err) {
            console.error("Failed to update holiday:", err);
            throw err;
        }
    };

    const deleteHoliday = async (holidayId: string) => {
        try {
            await dbApi.delete(`/holidays/${holidayId}`);
            await fetchData();
        } catch (err) {
            console.error("Failed to delete holiday:", err);
            throw err;
        }
    };

    const savePayrollSettings = async (settings: PayrollSettings) => {
        try {
            const updated = await dbApi.patch<PayrollSettings>('/payroll-settings', settings);
            setPayrollSettings(updated);
        } catch (err) {
            console.error("Failed to save payroll settings:", err);
            throw err;
        }
    };

    const resetEmployeePassword = async (employeeId: string): Promise<string | null> => {
        try {
            const result = await dbApi.post<{ message: string; generatedPassword?: string }>(`/employees/${employeeId}/reset-password`, {});
            return result?.generatedPassword || null;
        } catch (err) {
            console.error("Failed to reset employee password:", err);
            throw err;
        }
    };

    // Payroll record persistence
    const loadLatestPayroll = async () => {
        try {
            const record = await dbApi.get<any>('/payroll-records/latest');
            return record || null;
        } catch (err) {
            console.error('Failed to load latest payroll:', err);
            return null;
        }
    };

    const savePayrollRecord = async (data: {
        periodStart: string;
        periodEnd: string;
        entries: any[];
        totalGross: number;
        totalDeductions: number;
        totalNet: number;
        employeeCount: number;
    }) => {
        try {
            const record = await dbApi.post<any>('/payroll-records', data);
            return record;
        } catch (err) {
            console.error('Failed to save payroll record:', err);
            throw err;
        }
    };

    const markPayrollPaid = async (id: string) => {
        try {
            const record = await dbApi.patch<any>(`/payroll-records/${id}/paid`, {});
            return record;
        } catch (err) {
            console.error('Failed to mark payroll as paid:', err);
            throw err;
        }
    };

    const deletePayrollRecord = async (id: string) => {
        try {
            await dbApi.delete(`/payroll-records/${id}`);
        } catch (err) {
            console.error('Failed to delete payroll record:', err);
            throw err;
        }
    };

    // Salary records (paid salary history)
    const fetchSalaryRecords = useCallback(async () => {
        try {
            const data = await dbApi.get<SalaryRecord[]>('/salary-records');
            setSalaryRecords(data);
        } catch (err) {
            console.error('Failed to fetch salary records:', err);
        }
    }, []);

    const saveSalaryRecord = async (record: Omit<SalaryRecord, 'id'>) => {
        try {
            const newRecord: SalaryRecord = { ...record, id: `salary_${Date.now()}_${Math.random().toString(36).substring(2, 7)}` };
            const saved = await dbApi.post<SalaryRecord>('/salary-records', newRecord);
            await fetchSalaryRecords();
            return saved;
        } catch (err) {
            console.error('Failed to save salary record:', err);
            throw err;
        }
    };

    const deleteSalaryRecord = async (id: string) => {
        try {
            await dbApi.delete(`/salary-records/${id}`);
            await fetchSalaryRecords();
        } catch (err) {
            console.error('Failed to delete salary record:', err);
            throw err;
        }
    };

    return { employees, benefits, timeRecords, holidays, payrollSettings, salaryRecords, addEmployee, updateEmployee, deleteEmployee, saveTimeRecord, deleteTimeRecord, addHoliday, updateHoliday, deleteHoliday, savePayrollSettings, resetEmployeePassword, loadLatestPayroll, savePayrollRecord, markPayrollPaid, deletePayrollRecord, fetchSalaryRecords, saveSalaryRecord, deleteSalaryRecord, isLoading, error, fetchData };
};
