import React, { useState, useEffect, useCallback, useRef } from 'react';
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
                    <div className="px-6 py-4 border-b border-slate-100">
                        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">DTR History</h3>
                    </div>
                    {dtrRecords.length === 0 ? (
                        <div className="p-6 text-center text-slate-400 text-sm">No DTR records yet.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                                    <tr>
                                        <th className="px-4 py-2 text-left">Date</th>
                                        <th className="px-4 py-2 text-center">In</th>
                                        <th className="px-4 py-2 text-center">Out</th>
                                        <th className="px-4 py-2 text-right">Hours</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {dtrRecords.slice(0, 30).map(rec => (
                                        <tr key={rec.id} className="border-t border-slate-100">
                                            <td className="px-4 py-2.5 font-medium text-slate-700">{rec.date}</td>
                                            <td className="px-4 py-2.5 text-center text-slate-600">{formatTime12h(rec.timeInAM || rec.timeIn) || '--'}</td>
                                            <td className="px-4 py-2.5 text-center text-slate-600">{formatTime12h(rec.timeOutPM || rec.timeOut) || '--'}</td>
                                            <td className="px-4 py-2.5 text-right font-medium text-slate-700">{computeHours(rec).toFixed(1)}h</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default EmployeeLogin;
