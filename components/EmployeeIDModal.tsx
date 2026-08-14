import React, { useState, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { Employee } from '../types.ts';
import { XMarkIcon, PrinterIcon, CameraIcon, UserIcon, IdentificationIcon } from '../constants.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';

interface EmployeeIDModalProps {
    isOpen: boolean;
    onClose: () => void;
    employee: Employee | null;
}

export const EmployeeIDModal: React.FC<EmployeeIDModalProps> = ({ isOpen, onClose, employee }) => {
    const { formatCurrency } = useLocalization();
    const [photoUrl, setPhotoUrl] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const idCardRef = useRef<HTMLDivElement>(null);

    const handlePhotoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            setPhotoUrl(ev.target?.result as string);
        };
        reader.readAsDataURL(file);
    }, []);

    const handlePrint = useCallback(() => {
        window.print();
    }, []);

    if (!isOpen || !employee) return null;

    // DTR-ready QR payload — error correction "H" for crisp thermal scanning
    const qrValue = JSON.stringify({
        empId: employee.id,
        name: employee.fullName,
        type: 'DTR_VERIFY',
    });

    const employeeIdDisplay = `EMP-${employee.id.slice(0, 8).toUpperCase()}`;

    return (
        <>
            {/* ── Screen-only modal overlay ── */}
            <div className="print:hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
                        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            <IdentificationIcon className="w-5 h-5 text-emerald-500" />
                            Employee ID Card
                        </h2>
                        <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                            <XMarkIcon className="w-5 h-5 text-slate-500" />
                        </button>
                    </div>

                    {/* ID Card Preview */}
                    <div className="p-6">
                        <div className="border-2 border-slate-200 dark:border-slate-600 rounded-xl overflow-hidden bg-gradient-to-br from-slate-50 to-white dark:from-slate-800 dark:to-slate-750">
                            {/* Card Header Band */}
                            <div className="bg-emerald-600 px-4 py-2 text-center">
                                <p className="text-[10px] uppercase tracking-widest text-emerald-100 font-medium">Employee Identification</p>
                            </div>

                            <div className="p-4 flex gap-4">
                                {/* Photo Section */}
                                <div className="flex-shrink-0">
                                    <div className="w-24 h-28 rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-600 flex items-center justify-center border-2 border-slate-300 dark:border-slate-500">
                                        {photoUrl ? (
                                            <img src={photoUrl} alt={employee.fullName} className="w-full h-full object-cover" />
                                        ) : (
                                            <UserIcon className="w-10 h-10 text-slate-400" />
                                        )}
                                    </div>
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="mt-2 w-full flex items-center justify-center gap-1 text-xs text-emerald-600 hover:text-emerald-700 font-medium py-1.5 rounded-md border border-emerald-200 hover:border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 transition-colors"
                                    >
                                        <CameraIcon className="w-3.5 h-3.5" />
                                        Upload Photo
                                    </button>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handlePhotoUpload}
                                    />
                                </div>

                                {/* Details Section */}
                                <div className="flex-1 min-w-0">
                                    <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 truncate">{employee.fullName}</h3>
                                    <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">{employee.role}</p>

                                    <div className="mt-3 space-y-1.5">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-slate-500 dark:text-slate-400">ID No.</span>
                                            <span className="font-mono font-bold text-slate-700 dark:text-slate-200">{employeeIdDisplay}</span>
                                        </div>
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-slate-500 dark:text-slate-400">Rate</span>
                                            <span className="font-medium text-slate-700 dark:text-slate-200">
                                                {formatCurrency(employee.rate)} / {employee.salaryType}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-slate-500 dark:text-slate-400">Hired</span>
                                            <span className="text-slate-700 dark:text-slate-200">{employee.hireDate}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* QR Code Footer */}
                            <div className="flex items-center justify-center gap-3 px-4 py-3 bg-slate-100 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-700">
                                <QRCodeSVG
                                    value={qrValue}
                                    size={64}
                                    level="H"
                                    includeMargin={false}
                                    bgColor="transparent"
                                    fgColor="currentColor"
                                    className="text-slate-800 dark:text-slate-100"
                                />
                                <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                                    <p className="font-semibold text-slate-600 dark:text-slate-300">Scan for DTR</p>
                                    <p>Time Clock Verification</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="px-6 pb-6 flex gap-3">
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 font-medium text-sm transition-colors"
                        >
                            <CameraIcon className="w-4 h-4" />
                            {photoUrl ? 'Change Photo' : 'Upload Photo'}
                        </button>
                        <button
                            onClick={handlePrint}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm transition-colors"
                        >
                            <PrinterIcon className="w-4 h-4" />
                            Print ID Badge
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Print-only ID Card (visible only during window.print()) ── */}
            <div className="hidden print:block employee-id-print-area">
                <div ref={idCardRef} style={{ width: '80mm', minHeight: '54mm', margin: '0 auto', fontFamily: 'Arial, sans-serif' }}>
                    <div style={{ border: '1.5px solid #333', borderRadius: '4px', overflow: 'hidden', fontSize: '9pt' }}>
                        {/* Print Card Header */}
                        <div style={{ background: '#059669', padding: '3mm 4mm', textAlign: 'center' }}>
                            <span style={{ fontSize: '7pt', textTransform: 'uppercase', letterSpacing: '2px', color: '#d1fae5', fontWeight: 600 }}>
                                Employee Identification
                            </span>
                        </div>

                        <div style={{ display: 'flex', padding: '3mm 4mm', gap: '3mm' }}>
                            {/* Photo */}
                            <div style={{ flexShrink: 0 }}>
                                <div style={{
                                    width: '22mm',
                                    height: '26mm',
                                    borderRadius: '3px',
                                    overflow: 'hidden',
                                    border: '1px solid #ccc',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: '#f1f5f9',
                                }}>
                                    {photoUrl ? (
                                        <img src={photoUrl} alt={employee.fullName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    ) : (
                                        <span style={{ color: '#94a3b8', fontSize: '18pt' }}>👤</span>
                                    )}
                                </div>
                            </div>

                            {/* Details */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 700, fontSize: '11pt', marginBottom: '1mm', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {employee.fullName}
                                </div>
                                <div style={{ color: '#059669', fontWeight: 600, fontSize: '9pt', marginBottom: '2mm' }}>{employee.role}</div>

                                <table style={{ width: '100%', fontSize: '8pt', borderCollapse: 'collapse' }}>
                                    <tbody>
                                        <tr>
                                            <td style={{ color: '#64748b', padding: '0.5mm 0' }}>ID No.</td>
                                            <td style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>{employeeIdDisplay}</td>
                                        </tr>
                                        <tr>
                                            <td style={{ color: '#64748b', padding: '0.5mm 0' }}>Rate</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(employee.rate)} / {employee.salaryType}</td>
                                        </tr>
                                        <tr>
                                            <td style={{ color: '#64748b', padding: '0.5mm 0' }}>Hired</td>
                                            <td style={{ textAlign: 'right' }}>{employee.hireDate}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Print QR Footer */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3mm', padding: '2mm 4mm', borderTop: '1px solid #ccc', background: '#f8fafc' }}>
                            <QRCodeSVG
                                value={qrValue}
                                size={48}
                                level="H"
                                includeMargin={false}
                                bgColor="transparent"
                                fgColor="#1e293b"
                            />
                            <div style={{ fontSize: '7pt', color: '#64748b', lineHeight: 1.3 }}>
                                <div style={{ fontWeight: 700, color: '#334155' }}>Scan for DTR</div>
                                <div>Time Clock Verification</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};
