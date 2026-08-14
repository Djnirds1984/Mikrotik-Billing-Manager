import { useState, useEffect, useCallback } from 'react';
import type { Employee, EmployeeBenefit, TimeRecord, Holiday, PayrollSettings } from '../types.ts';
import { dbApi } from '../services/databaseService.ts';

const DEFAULT_PAYROLL_SETTINGS: PayrollSettings = {
    otPremiumPercent: 50,
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
            await dbApi.post('/employees', newEmployee);
            
            const newBenefit: EmployeeBenefit = {
                ...benefitData,
                id: `ben_${Date.now()}`,
                employeeId: newEmployee.id,
            };
            await dbApi.post('/employee-benefits', newBenefit);
            await fetchData();
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

    return { employees, benefits, timeRecords, holidays, payrollSettings, addEmployee, updateEmployee, deleteEmployee, saveTimeRecord, deleteTimeRecord, addHoliday, updateHoliday, deleteHoliday, savePayrollSettings, isLoading, error, fetchData };
};
