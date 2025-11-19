import React, { useState, useMemo, useEffect } from 'react';
import type { Employee, EmployeeBenefit, TimeRecord } from '../types.ts';
import { Loader } from './Loader.tsx';
// FIX: Import missing ClockIcon and CalculatorIcon.
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
                        <h3