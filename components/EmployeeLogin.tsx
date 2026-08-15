import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TimeRecord } from '../types.ts';
import { Loader } from './Loader.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';

interface EmployeeProfile {
    id: string;
    fullName: string;
    role: string;
    hireDate: string;
    salaryType: string;
    rate: number;
    photoUrl: string | null;
}

type View = 'login' | 'dashboard' | 'change-password';

export const EmployeeLogin: React.FC = () => {
    const { formatCurrency } = useLocalization();
    const [view, setView] = useState<View>('login');
    const [token, setToken] = useState<string | null>(() => localStorage.getItem('employee_token'));
    const [employee, setEmployee] = useState<EmployeeProfile | null>(null);
    const [loginId, setLoginId] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [loginError, setLoginError] = useState('');
    const [loginLoading, setLoginLoading] = useState(false);

    // DTR state
    const [todayRecord, setTodayRecord] = useState<TimeRecord | null>(null);
    const [dtrRecords, setDtrRecords] = useState<TimeRecord[]>([]);
    const [clockTime, setClockTime] = useState('');
    const [clockDate, setClockDate] = useState('');
    const [actionLoading, setActionLoading] = useState(false);
    const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

    // Change password state
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordLoading, setPasswordLoading] = useState(false);
    const [passwordMessage, setPasswordMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

    const clockInterval = useRef<number | null>(null);

    // Auth header helper
    const authHeaders = useCallback(() => ({
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    }), [token]);

    // Live clock (Philippine Time)
    useEffect(() => {
        const updateClock = () => {
            const now = new Date();
            setClockTime(now.toLocaleTimeString('en-PH', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Manila' }));
            setClockDate(now.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila' }));
        };
        updateClock();
        clockInterval.current = window.setInterval(updateClock, 1000);
        return () => { if (clockInterval.current) clearInterval(clockInterval.current); };
    }, []);

    // Auto-login if token exists
    useEffect(() => {
        if (token) {
            fetchProfile();
        }
    }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

    const fetchProfile = async () => {
        try {
            const res = await fetch('/api/employee-auth/me', { headers: authHeaders() });
            if (!res.ok) throw new Error('Session expired');
            const data = await res.json();
            setEmployee(data);
            setView('dashboard');
        } catch {
            handleLogout();
        }
    };

    const fetchTodayRecord = useCallback(async () => {
        try {
            const res = await fetch('/api/employee-dtr/today', { headers: authHeaders() });
            if (res.ok) {
                const data = await res.json();
                setTodayRecord(data);
            }
        } catch { /* ignore */ }
    }, [authHeaders]);

    const fetchDtrRecords = useCallback(async () => {
        try {
            const res = await fetch('/api/employee-dtr/records', { headers: authHeaders() });
            if (res.ok) {
                const data = await res.json();
                setDtrRecords(data);
            }
        } catch { /* ignore */ }
    }, [authHeaders]);

    // Fetch DTR data when dashboard loads
    useEffect(() => {
        if (view === 'dashboard' && token) {
            fetchTodayRecord();
            fetchDtrRecords();
        }
    }, [view, token, fetchTodayRecord, fetchDtrRecords]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoginLoading(true);
        setLoginError('');
        try {
            const res = await fetch('/api/employee-auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: loginId.trim(), password: loginPassword }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Login failed');
            localStorage.setItem('employee_token', data.token);
            setToken(data.token);
            setEmployee(data.employee);
            setView('dashboard');
        } catch (err) {
            setLoginError((err as Error).message);
        } finally {
            setLoginLoading(false);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('employee_token');
        setToken(null);
        setEmployee(null);
        setView('login');
        setLoginId('');
        setLoginPassword('');
        setTodayRecord(null);
        setDtrRecords([]);
    };

    const handleTimeIn = async () => {
        setActionLoading(true);
        setActionMessage(null);
        try {
            const res = await fetch('/api/employee-dtr/time-in', {
                method: 'POST',
                headers: authHeaders(),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            setTodayRecord(data.record);
            setActionMessage({ text: `Time-in recorded at ${data.serverTime || data.record.timeInAM}`, type: 'success' });
            fetchDtrRecords();
        } catch (err) {
            setActionMessage({ text: (err as Error).message, type: 'error' });
        } finally {
            setActionLoading(false);
        }
    };

    const handleTimeOut = async () => {
        setActionLoading(true);
        setActionMessage(null);
        try {
            const res = await fetch('/api/employee-dtr/time-out', {
                method: 'POST',
                headers: authHeaders(),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            setTodayRecord(data.record);
            setActionMessage({ text: `Time-out recorded at ${data.serverTime || data.record.timeOutPM}`, type: 'success' });
            fetchDtrRecords();
        } catch (err) {
            setActionMessage({ text: (err as Error).message, type: 'error' });
        } finally {
            setActionLoading(false);
        }
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordMessage(null);
        if (newPassword !== confirmPassword) {
            setPasswordMessage({ text: 'New passwords do not match.', type: 'error' });
            return;
        }
        if (newPassword.length < 6) {
            setPasswordMessage({ text: 'Password must be at least 6 characters.', type: 'error' });
            return;
        }
        setPasswordLoading(true);
        try {
            const res = await fetch('/api/employee-auth/change-password', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            setPasswordMessage({ text: 'Password changed successfully!', type: 'success' });
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err) {
            setPasswordMessage({ text: (err as Error).message, type: 'error' });
        } finally {
            setPasswordLoading(false);
        }
    };

    // Helper: compute hours from a record
    const computeHours = (rec: TimeRecord): number => {
        const parseTime = (t: string) => {
            if (!t) return null;
            const parts = t.split(':').map(Number);
            return parts[0] * 60 + parts[1];
        };
        const amIn = parseTime(rec.timeInAM || rec.timeIn);
        const amOut = parseTime(rec.timeOutAM);
        const pmIn = parseTime(rec.timeInPM);
        const pmOut = parseTime(rec.timeOutPM || rec.timeOut);

        let total = 0;
        if (amIn !== null && amOut !== null) total += (amOut - amIn) / 60;
        if (pmIn !== null && pmOut !== null) total += (pmOut - pmIn) / 60;

        // Fallback: if AM/PM split is incomplete (e.g. employee self-service
        // sets timeInAM + timeIn on time-in, and timeOutPM + timeOut on time-out),
        // compute directly from the earliest time-in to the latest time-out.
        if (total === 0) {
            const earliestIn = amIn ?? pmIn;
            const latestOut = pmOut ?? amOut;
            if (earliestIn !== null && latestOut !== null) {
                total = Math.max(0, (latestOut - earliestIn) / 60);
            }
        }

        return Math.max(0, total);
    };

    const formatTime12h = (time: string) => {
        if (!time) return '';
        const [h, m] = time.split(':').map(Number);
        const period = h >= 12 ? 'PM' : 'AM';
        const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
        return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
    };

    // Determine today's status
    const getTodayStatus = (): 'not-in' | 'timed-in' | 'completed' => {
        if (!todayRecord) return 'not-in';
        if (todayRecord.timeOutPM || todayRecord.timeOut) return 'completed';
        if (todayRecord.timeInAM || todayRecord.timeIn) return 'timed-in';
        return 'not-in';
    };

    // Helper: compute OT hours for a record (standard 8 hrs/day)
    const computeOtHours = (rec: TimeRecord): number => {
        const total = computeHours(rec);
        return Math.max(0, total - 8);
    };

    // Helper: check if a date is Sunday
    const isSunday = (dateStr: string): boolean => {
        return new Date(dateStr + 'T00:00:00').getDay() === 0;
    };

    // Print Form 48 DTR
    const handlePrintForm48 = () => {
        const win = window.open('', '_blank');
        if (!win) return;
        const records = [...dtrRecords].sort((a, b) => a.date.localeCompare(b.date));
        let totalHours = 0;
        let totalOtHours = 0;
        let totalSundayHours = 0;
        const rows = records.map((rec, i) => {
            const hrs = computeHours(rec);
            const otHrs = computeOtHours(rec);
            const sun = isSunday(rec.date);
            totalHours += hrs;
            totalOtHours += otHrs;
            if (sun) totalSundayHours += hrs;
            const otMark = otHrs > 0 ? `<span style="color:#d97706;font-weight:bold">OT ${otHrs.toFixed(1)}h</span>` : '';
            const sunBadge = sun ? '<span style="color:#7c3aed;font-weight:bold">SUN</span>' : '';
            return `<tr><td>${i + 1}</td><td>${rec.date}</td><td>${formatTime12h(rec.timeInAM || rec.timeIn) || '--'}</td><td>${formatTime12h(rec.timeOutPM || rec.timeOut) || '--'}</td><td style="text-align:center">${hrs.toFixed(2)}</td><td>${otMark}</td><td>${sunBadge}</td></tr>`;
        }).join('');
        const dailyRate = employee?.salaryType === 'daily' ? (employee?.rate || 0) : ((employee?.rate || 0) / 26);
        const hourlyRate = dailyRate / 8;
        const otRate = hourlyRate * 1.25;
        const sunOtRate = hourlyRate * 1.5;
        win.document.write(`<html><head><title>DTR Form 48 - ${employee?.fullName || 'Employee'}</title><style>body{font-family:Arial,sans-serif;font-size:11px;color:#000;margin:20px}h2{text-align:center;margin-bottom:2px;font-size:16px}h3{text-align:center;margin-bottom:12px;font-size:12px;color:#555}.info{margin-bottom:12px}.info span{margin-right:24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:4px 8px;text-align:left}th{background:#e5e7eb;font-weight:bold;font-size:10px;text-transform:uppercase}.summary{margin-top:16px}.summary td{font-weight:bold}.sig{margin-top:40px;display:flex;justify-content:space-between}.sig div{border-top:1px solid #000;width:200px;text-align:center;padding-top:4px}</style></head><body><h2>DAILY TIME RECORD</h2><h3>(Form 48)</h3><div class="info"><span><strong>Name:</strong> ${employee?.fullName || ''}</span><span><strong>Position:</strong> ${employee?.role || ''}</span><span><strong>Period:</strong> ${records.length > 0 ? records[0].date : ''} to ${records.length > 0 ? records[records.length - 1].date : ''}</span></div><table><thead><tr><th>#</th><th>Date</th><th>Time In</th><th>Time Out</th><th>Hours</th><th>OT</th><th>Day</th></tr></thead><tbody>${rows}</tbody></table><table class="summary" style="margin-top:16px;width:60%"><tr><td>Total Hours Worked</td><td>${totalHours.toFixed(2)} hrs</td></tr><tr><td>Total OT Hours</td><td>${totalOtHours.toFixed(2)} hrs</td></tr><tr><td>Sunday Hours</td><td>${totalSundayHours.toFixed(2)} hrs</td></tr><tr><td>Base Rate (Daily)</td><td>\u20B1${dailyRate.toFixed(2)}</td></tr><tr><td>Hourly Rate</td><td>\u20B1${hourlyRate.toFixed(2)}/hr</td></tr><tr><td>OT Rate (+25%)</td><td>\u20B1${otRate.toFixed(2)}/hr</td></tr><tr><td>Sunday OT Rate (+50%)</td><td>\u20B1${sunOtRate.toFixed(2)}/hr</td></tr></table><div class="sig"><div>Employee Signature</div><div>Supervisor Signature</div></div></body></html>`);
        win.document.close();
        win.focus();
        win.print();
        win.close();
    };

    // Estimated gross salary calculation (before deductions)
    const earningsEstimate = useMemo(() => {
        if (!employee || dtrRecords.length === 0) return null;
        const dailyRate = employee.salaryType === 'daily' ? employee.rate : employee.rate / 26;
        const hourlyRate = dailyRate / 8;
        const otRate = hourlyRate * 1.25;
        const sunOtRate = hourlyRate * 1.5;
        let totalHours = 0, totalOtHours = 0, totalSundayHours = 0, totalRegularHours = 0;
        let regularPay = 0, otPay = 0, sundayPremium = 0;
        dtrRecords.forEach(rec => {
            const hrs = computeHours(rec);
            const otHrs = computeOtHours(rec);
            const regHrs = Math.min(hrs, 8);
            const sun = isSunday(rec.date);
            totalHours += hrs;
            totalOtHours += otHrs;
            totalRegularHours += regHrs;
            if (sun) totalSundayHours += hrs;
            // Regular pay (includes Sunday base hours at base rate)
            regularPay += regHrs * hourlyRate;
            // OT pay
            if (sun) {
                otPay += otHrs * sunOtRate;
            } else {
                otPay += otHrs * otRate;
            }
            // Sunday premium (extra 20% on all Sunday hours)
            if (sun) {
                sundayPremium += hrs * hourlyRate * 0.20;
            }
        });
        const grossPay = regularPay + otPay + sundayPremium;
        return { totalHours, totalOtHours, totalSundayHours, totalRegularHours, regularPay, otPay, sundayPremium, grossPay, dailyRate, hourlyRate };
    }, [employee, dtrRecords]);

    // ─── Render ──────────────────────────────────────────────────────────────

    // Login Screen
    if (view === 'login' || !token) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-slate-100 flex items-center justify-center p-4">
                <div className="w-full max-w-sm">
                    <div className="bg-white rounded-2xl shadow-xl p-8">
                        <div className="text-center mb-8">
                            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-emerald-600">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                                </svg>
                            </div>
                            <h1 className="text-xl font-bold text-slate-800">Employee Login</h1>
                            <p className="text-sm text-slate-500 mt-1">Enter your credentials to continue</p>
                        </div>

                        <form onSubmit={handleLogin} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Employee ID</label>
                                <input
                                    type="text"
                                    value={loginId}
                                    onChange={e => setLoginId(e.target.value)}
                                    placeholder="e.g. emp_1234567890"
                                    className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                                <input
                                    type="password"
                                    value={loginPassword}
                                    onChange={e => setLoginPassword(e.target.value)}
                                    placeholder="Enter your password"
                                    className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                                    required
                                />
                            </div>

                            {loginError && (
                                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{loginError}</div>
                            )}

                            <button
                                type="submit"
                                disabled={loginLoading}
                                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
                            >
                                {loginLoading ? 'Signing in...' : 'Sign In'}
                            </button>
                        </form>
                    </div>
                    <p className="text-center text-xs text-slate-400 mt-4">DTR Clock-In System</p>
                </div>
            </div>
        );
    }

    // Change Password Screen
    if (view === 'change-password') {
        return (
            <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-slate-100 flex items-center justify-center p-4">
                <div className="w-full max-w-sm">
                    <div className="bg-white rounded-2xl shadow-xl p-8">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-lg font-bold text-slate-800">Change Password</h2>
                            <button onClick={() => setView('dashboard')} className="text-sm text-emerald-600 hover:underline">Back</button>
                        </div>

                        <form onSubmit={handleChangePassword} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Current Password</label>
                                <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" required />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
                                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" required minLength={6} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Confirm New Password</label>
                                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" required minLength={6} />
                            </div>

                            {passwordMessage && (
                                <div className={`p-3 rounded-lg text-sm border ${passwordMessage.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-red-50 border-red-200 text-red-600'}`}>
                                    {passwordMessage.text}
                                </div>
                            )}

                            <button type="submit" disabled={passwordLoading} className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-50">
                                {passwordLoading ? 'Changing...' : 'Change Password'}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        );
    }

    // Dashboard
    const status = getTodayStatus();

    return (
        <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-slate-100">
            {/* Header */}
            <div className="bg-white shadow-sm border-b border-slate-200">
                <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 font-bold text-sm">
                            {employee?.fullName?.charAt(0)?.toUpperCase() || 'E'}
                        </div>
                        <div>
                            <p className="font-semibold text-slate-800 text-sm">{employee?.fullName}</p>
                            <p className="text-xs text-slate-500">{employee?.role}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setView('change-password')} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded">
                            Password
                        </button>
                        <button onClick={handleLogout} className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded border border-red-200">
                            Logout
                        </button>
                    </div>
                </div>
            </div>

            <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
                {/* Clock Card */}
                <div className="bg-white rounded-2xl shadow-sm p-6 text-center border border-slate-200">
                    <p className="text-4xl font-mono font-bold text-slate-800 tracking-wider">{clockTime}</p>
                    <p className="text-sm text-slate-500 mt-2">{clockDate}</p>
                </div>

                {/* Time-In/Out Card */}
                <div className="bg-white rounded-2xl shadow-sm p-6 border border-slate-200">
                    <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">Today's Status</h3>

                    {actionMessage && (
                        <div className={`mb-4 p-3 rounded-lg text-sm border ${actionMessage.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-red-50 border-red-200 text-red-600'}`}>
                            {actionMessage.text}
                        </div>
                    )}

                    {status === 'not-in' && (
                        <div className="text-center">
                            <p className="text-slate-500 mb-4">You haven't timed in yet.</p>
                            <button
                                onClick={handleTimeIn}
                                disabled={actionLoading}
                                className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-bold rounded-xl transition-colors disabled:opacity-50 shadow-lg shadow-emerald-200"
                            >
                                {actionLoading ? 'Recording...' : 'TIME IN'}
                            </button>
                        </div>
                    )}

                    {status === 'timed-in' && (
                        <div className="text-center">
                            <div className="mb-4">
                                <p className="text-sm text-slate-500">Timed in at</p>
                                <p className="text-2xl font-bold text-emerald-600">
                                    {formatTime12h(todayRecord?.timeInAM || todayRecord?.timeIn || '')}
                                </p>
                            </div>
                            <button
                                onClick={handleTimeOut}
                                disabled={actionLoading}
                                className="w-full py-4 bg-red-500 hover:bg-red-600 text-white text-lg font-bold rounded-xl transition-colors disabled:opacity-50 shadow-lg shadow-red-200"
                            >
                                {actionLoading ? 'Recording...' : 'TIME OUT'}
                            </button>
                        </div>
                    )}

                    {status === 'completed' && (
                        <div className="text-center">
                            <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-100 text-emerald-700 rounded-full mb-4">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span className="font-semibold text-sm">Completed</span>
                            </div>
                            <div className="grid grid-cols-2 gap-4 text-center">
                                <div>
                                    <p className="text-xs text-slate-500">Time In</p>
                                    <p className="font-bold text-slate-800">{formatTime12h(todayRecord?.timeInAM || todayRecord?.timeIn || '')}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500">Time Out</p>
                                    <p className="font-bold text-slate-800">{formatTime12h(todayRecord?.timeOutPM || todayRecord?.timeOut || '')}</p>
                                </div>
                            </div>
                            <p className="text-sm text-slate-500 mt-3">
                                Total: <span className="font-semibold text-slate-700">{computeHours(todayRecord!).toFixed(1)} hours</span>
                            </p>
                        </div>
                    )}
                </div>

                {/* DTR History */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">DTR History</h3>
                        {dtrRecords.length > 0 && (
                            <button onClick={handlePrintForm48} className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.565-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.916-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.916-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25C4.504 2.25 4 2.754 4 3.375v3.658" /></svg>
                                Form 48
                            </button>
                        )}
                    </div>
                    {dtrRecords.length === 0 ? (
                        <div className="p-6 text-center text-slate-400 text-sm">No DTR records yet.</div>
                    ) : (
                        <>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                                        <tr>
                                            <th className="px-4 py-2 text-left">Date</th>
                                            <th className="px-4 py-2 text-center">In</th>
                                            <th className="px-4 py-2 text-center">Out</th>
                                            <th className="px-4 py-2 text-right">Hours</th>
                                            <th className="px-4 py-2 text-right">OT</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {dtrRecords.slice(0, 30).map(rec => {
                                            const hrs = computeHours(rec);
                                            const ot = computeOtHours(rec);
                                            const sun = isSunday(rec.date);
                                            return (
                                                <tr key={rec.id} className={`border-t border-slate-100 ${sun ? 'bg-violet-50/50' : ''}`}>
                                                    <td className="px-4 py-2.5 font-medium text-slate-700">
                                                        {rec.date}
                                                        {sun && <span className="ml-1.5 text-[10px] font-bold text-violet-500 uppercase">Sun</span>}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-center text-slate-600">{formatTime12h(rec.timeInAM || rec.timeIn) || '--'}</td>
                                                    <td className="px-4 py-2.5 text-center text-slate-600">{formatTime12h(rec.timeOutPM || rec.timeOut) || '--'}</td>
                                                    <td className="px-4 py-2.5 text-right font-medium text-slate-700">{hrs.toFixed(1)}h</td>
                                                    <td className="px-4 py-2.5 text-right">
                                                        {ot > 0 ? (
                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-700">+{ot.toFixed(1)}h</span>
                                                        ) : (
                                                            <span className="text-slate-300">--</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot className="bg-slate-50 border-t border-slate-200">
                                        <tr>
                                            <td colSpan={3} className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase">Total</td>
                                            <td className="px-4 py-2 text-right font-bold text-slate-700">{dtrRecords.reduce((sum, rec) => sum + computeHours(rec), 0).toFixed(1)}h</td>
                                            <td className="px-4 py-2 text-right font-bold text-amber-600">{dtrRecords.reduce((sum, rec) => sum + computeOtHours(rec), 0).toFixed(1)}h</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </>
                    )}
                </div>

                {/* Estimated Earnings */}
                {earningsEstimate && (
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100">
                            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Estimated Earnings</h3>
                            <p className="text-[10px] text-slate-400 mt-0.5">Gross estimate before deductions (SSS, PhilHealth, Pag-IBIG)</p>
                        </div>
                        <div className="p-4 space-y-3">
                            {/* Summary stats */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-slate-50 rounded-lg p-3">
                                    <p className="text-[10px] text-slate-400 uppercase font-semibold">Total Hours</p>
                                    <p className="text-lg font-bold text-slate-700">{earningsEstimate.totalHours.toFixed(1)}h</p>
                                    <p className="text-[10px] text-slate-400">{earningsEstimate.totalRegularHours.toFixed(1)} regular + {earningsEstimate.totalOtHours.toFixed(1)} OT</p>
                                </div>
                                <div className="bg-violet-50 rounded-lg p-3">
                                    <p className="text-[10px] text-violet-400 uppercase font-semibold">Sunday Hours</p>
                                    <p className="text-lg font-bold text-violet-700">{earningsEstimate.totalSundayHours.toFixed(1)}h</p>
                                    <p className="text-[10px] text-violet-400">+50% premium applied</p>
                                </div>
                            </div>
                            {/* Pay breakdown */}
                            <div className="space-y-1.5 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Regular Pay ({earningsEstimate.totalRegularHours.toFixed(1)}h × ₱{earningsEstimate.hourlyRate.toFixed(2)})</span>
                                    <span className="font-medium text-slate-700">₱{earningsEstimate.regularPay.toFixed(2)}</span>
                                </div>
                                {earningsEstimate.otPay > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-amber-600">Overtime Pay ({earningsEstimate.totalOtHours.toFixed(1)}h)</span>
                                        <span className="font-medium text-amber-700">₱{earningsEstimate.otPay.toFixed(2)}</span>
                                    </div>
                                )}
                                {earningsEstimate.sundayPremium > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-violet-600">Sunday Premium ({earningsEstimate.totalSundayHours.toFixed(1)}h)</span>
                                        <span className="font-medium text-violet-700">₱{earningsEstimate.sundayPremium.toFixed(2)}</span>
                                    </div>
                                )}
                            </div>
                            {/* Gross pay */}
                            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex justify-between items-center">
                                <div>
                                    <p className="text-xs font-semibold text-emerald-600 uppercase">Estimated Gross Salary</p>
                                    <p className="text-[10px] text-emerald-500">Before deductions</p>
                                </div>
                                <p className="text-xl font-bold text-emerald-700">₱{earningsEstimate.grossPay.toFixed(2)}</p>
                            </div>
                            {/* Rate info */}
                            <div className="flex justify-between text-[10px] text-slate-400 px-1">
                                <span>Daily Rate: ₱{earningsEstimate.dailyRate.toFixed(2)}</span>
                                <span>Hourly: ₱{earningsEstimate.hourlyRate.toFixed(2)}</span>
                                <span>OT: ×1.25</span>
                                <span>Sun OT: ×1.50</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default EmployeeLogin;
