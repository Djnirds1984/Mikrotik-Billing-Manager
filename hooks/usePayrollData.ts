import { useState, useEffect, useCallback } from 'react';
import type { Employee, EmployeeBenefit, TimeRecord } from '../types.ts';
import { dbApi } from '../services/databaseService.ts';

export const usePayrollData = () => {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [benefits, setBenefits] = useState<EmployeeBenefit[]>([]);
    const [timeRecords, setTimeRecords] = useState<TimeRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [empData, benData, timeData] = await Promise.all([
                dbApi.get<Employee[]>('/employees'),
                dbApi.get<EmployeeBenefit[]>('/employee-benefits'),
                dbApi.get<TimeRecord[]>('/time-records'),
            ]);
            setEmployees(empData.sort((a, b) => a.fullName.localeCompare(b.fullName)));
            setBenefits(benData);
            setTimeRecords(timeData);
        } catch (err) {
            setError((err as Error).message);
            console.error("Failed to fetch payroll data from DB", err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

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

    return { employees, benefits, timeRecords, addEmployee, updateEmployee, deleteEmployee, saveTimeRecord, deleteTimeRecord, isLoading, error, fetchData };
};
