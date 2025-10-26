import React, { useState, useMemo } from 'react';
import type { Employee, EmployeeBenefit, TimeRecord } from '../types.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { Loader } from './Loader.tsx';
import { CalculatorIcon, EditIcon, TrashIcon, UsersIcon, ClockIcon } from '../constants.tsx';

// --- Types for this component ---
type PayrollData = {
    employees: Employee[];
    benefits: EmployeeBenefit[];
    timeRecords: TimeRecord[];
    addEmployee: (employeeData: Omit<Employee, 'id'>, benefitData: Omit<EmployeeBenefit, 'id' | 'employeeId'>) => Promise<void>;
    updateEmployee: (updatedEmployee: Employee, updatedBenefit: EmployeeBenefit) => Promise<void>;
    deleteEmployee: (employeeId: string) => Promise<void>;
    saveTimeRecord: (recordData: Omit<TimeRecord, 'id'> | TimeRecord) => Promise<void>;
    deleteTimeRecord: (recordId: string) => Promise<void>;
    isLoading: boolean;
    error: string | null;
};
type PayrollTab = 'employees' | 'dtr' | 'payslip';

// --- Employee Form Modal ---
const EmployeeModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (emp: Omit<Employee, 'id'>, ben: Omit<EmployeeBenefit, 'id' | 'employeeId'>) => void;
}> = ({ isOpen, onClose, onSave }) => {
    const [emp, setEmp] = useState<Omit<Employee, 'id'>>({ fullName: '', role: '', hireDate: '', salaryType: 'daily', rate: 0 });
    const [ben, setBen] = useState({ sss: false, philhealth: false, pagibig: false });

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(emp, ben);
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
            <div className="bg-white dark:bg-slate-800 p-6 rounded-lg w-full max-w-lg">
                <h3 className="text-xl font-bold mb-4">Add Employee</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* ... form fields for employee and benefits ... */}
                    <button type="submit" className="bg-sky-600 text-white px-4 py-2 rounded-md">Save</button>
                    <button type="button" onClick={onClose}>Cancel</button>
                </form>
            </div>
        </div>
    );
};

// --- Main Component ---
export const Payroll: React.FC<PayrollData> = (props) => {
    const { formatCurrency } = useLocalization();
    const [activeTab, setActiveTab] = useState<PayrollTab>('employees');
    const [isModalOpen, setIsModalOpen] = useState(false);

    const handleSaveEmployee = async (emp: Omit<Employee, 'id'>, ben: Omit<EmployeeBenefit, 'id' | 'employeeId'>) => {
        await props.addEmployee(emp, ben);
        setIsModalOpen(false);
    };

    if (props.isLoading) return <Loader />;
    if (props.error) return <div className="text-red-500">{props.error}</div>;

    const renderContent = () => {
        switch (activeTab) {
            case 'employees':
                return (
                    <div>
                        <div className="flex justify-end mb-4">
                            <button onClick={() => setIsModalOpen(true)} className="bg-sky-600 text-white px-4 py-2 rounded-lg">Add Employee</button>
                        </div>
                        <div className="bg-white dark:bg-slate-800 border rounded-lg overflow-hidden">
                             <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b">
                                        <th className="p-4 text-left">Name</th>
                                        <th className="p-4 text-left">Role</th>
                                        <th className="p-4 text-left">Rate</th>
                                        <th className="p-4 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {props.employees.map(emp => {
                                        const benefit = props.benefits.find(b => b.employeeId === emp.id);
                                        return (
                                            <tr key={emp.id} className="border-b last:border-0">
                                                <td className="p-4">{emp.fullName}</td>
                                                <td className="p-4">{emp.role}</td>
                                                <td className="p-4">{formatCurrency(emp.rate)} / {emp.salaryType}</td>
                                                <td className="p-4 text-right">
                                                    <button className="p-1"><EditIcon className="w-5 h-5"/></button>
                                                    <button onClick={() => props.deleteEmployee(emp.id)} className="p-1"><TrashIcon className="w-5 h-5 text-red-500"/></button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            case 'dtr': return <div>Daily Time Record - Under Construction</div>;
            case 'payslip': return <div>Payslip Generator - Under Construction</div>;
            default: return null;
        }
    };

    return (
        <div className="space-y-6">
            <EmployeeModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveEmployee} />
             <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-3"><CalculatorIcon className="w-8 h-8"/> Payroll Management</h2>
            <div className="border-b">
                <nav className="flex space-x-2">
                    <button onClick={() => setActiveTab('employees')} className={`px-4 py-2 ${activeTab === 'employees' ? 'border-b-2 border-sky-500' : ''}`}>Employees</button>
                    <button onClick={() => setActiveTab('dtr')} className={`px-4 py-2 ${activeTab === 'dtr' ? 'border-b-2 border-sky-500' : ''}`}>Time Records</button>
                    <button onClick={() => setActiveTab('payslip')} className={`px-4 py-2 ${activeTab === 'payslip' ? 'border-b-2 border-sky-500' : ''}`}>Payslips</button>
                </nav>
            </div>
            {renderContent()}
        </div>
    );
};
