import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { Loader } from './Loader.tsx';

interface ForgotPasswordProps {
    onSwitchToLogin: () => void;
}

export const ForgotPassword: React.FC<ForgotPasswordProps> = ({ onSwitchToLogin }) => {
    const [step, setStep] = useState(1);
    const [username, setUsername] = useState('');
    const [questions, setQuestions] = useState<string[]>([]);
    const [answers, setAnswers] = useState<string[]>(['', '', '']);
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [message, setMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null);

    const { getSecurityQuestions, resetPassword, isLoading, clearError } = useAuth();

    const handleUsernameSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage(null);
        clearError();
        const fetchedQuestions = await getSecurityQuestions(username);
        if (fetchedQuestions.length > 0) {
            setQuestions(fetchedQuestions);
            setStep(2);
        } else {
            setMessage({ type: 'error', text: 'Username not found or no security questions set up.' });
        }
    };

    const handleResetSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage(null);
        clearError();
        if (newPassword !== confirmPassword) {
            setMessage({ type: 'error', text: 'New passwords do not match.' });
            return;
        }
        const result = await resetPassword(username, answers, newPassword);
        if (result.success) {
            setMessage({ type: 'success', text: result.message });
            setStep(3);
        } else {
            setMessage({ type: 'error', text: result.message });
        }
    };
    
    const handleAnswerChange = (index: number, value: string) => {
        const newAnswers = [...answers];
        newAnswers[index] = value;
        setAnswers(newAnswers);
    };

    return (
        <div className="w-full max-w-md">
            <h2 className="text-2xl font-bold text-center text-slate-800 dark:text-slate-200 mb-6">
                Password Recovery
            </h2>

            {message && (
                <div className={`p-3 mb-4 rounded-md text-sm ${message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {message.text}
                </div>
            )}

            {step === 1 && (
                <form onSubmit={handleUsernameSubmit} className="space-y-4">
                    <p className="text-sm text-center text-slate-600 dark:text-slate-400">Enter your username to begin the recovery process.</p>
                    <div>
                        <label htmlFor="username" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Username</label>
                        <input id="username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2"/>
                    </div>
                    <div>
                        <button type="submit" disabled={isLoading} className="w-full flex justify-center py-2 px-4 rounded-md text-white bg-[--color-primary-600] hover:bg-[--color-primary-700] disabled:opacity-50">
                            {isLoading ? <Loader /> : 'Next'}
                        </button>
                    </div>
                </form>
            )}

            {step === 2 && (
                <form onSubmit={handleResetSubmit} className="space-y-4">
                     {questions.map((q, i) => (
                        <div key={i}>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{q}</label>
                            <input type="text" value={answers[i]} onChange={(e) => handleAnswerChange(i, e.target.value)} required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2" />
                        </div>
                     ))}
                     <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                         <label className="block text-sm font-medium">New Password</label>
                         <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2" />
                     </div>
                     <div>
                         <label className="block text-sm font-medium">Confirm New Password</label>
                         <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 rounded-md p-2" />
                     </div>
                     <div>
                        <button type="submit" disabled={isLoading} className="w-full flex justify-center py-2 px-4 rounded-md text-white bg-[--color-primary-600] hover:bg-[--color-primary-700] disabled:opacity-50">
                            {isLoading ? <Loader /> : 'Reset Password'}
                        </button>
                    </div>
                </form>
            )}
            
            {step === 3 && (
                 <div>
                    <button onClick={onSwitchToLogin} className="w-full flex justify-center py-2 px-4 rounded-md text-white bg-[--color-primary-600] hover:bg-[--color-primary-700]">
                        Back to Login
                    </button>
                </div>
            )}

            {step !== 3 && (
                <p className="mt-4 text-center text-sm text-slate-600 dark:text-slate-400">
                    <button onClick={onSwitchToLogin} className="font-medium text-[--color-primary-600] hover:text-[--color-primary-500]">
                        Back to Login
                    </button>
                </p>
            )}
        </div>
    );
};