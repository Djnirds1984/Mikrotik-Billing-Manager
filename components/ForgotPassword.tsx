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
            <h2 className="text-2xl font-bold text-center text-white mb-6">
                Password Recovery
            </h2>

            {message && (
                <div className={`p-3 mb-4 rounded-lg text-sm ${message.type === 'success' ? 'bg-emerald-900/20 text-emerald-300 border border-emerald-800/50' : 'bg-red-900/20 text-red-300 border border-red-800/50'}`}>
                    {message.text}
                </div>
            )}

            {step === 1 && (
                <form onSubmit={handleUsernameSubmit} className="space-y-4">
                    <p className="text-sm text-center text-[#8A94A6]">Enter your username to begin the recovery process.</p>
                    <div>
                        <label htmlFor="username" className="block text-sm font-medium text-[#8A94A6]">Username</label>
                        <input id="username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} required className="mt-1 block w-full bg-[#1C2234] border border-[#1E2538] rounded-lg p-2 text-white focus:outline-none focus:ring-1 focus:ring-[#00E5FF]"/>
                    </div>
                    <div>
                        <button type="submit" disabled={isLoading} className="w-full flex justify-center py-2.5 px-4 rounded-lg text-[#0A0D18] bg-[#00E5FF] hover:bg-[#00C2FF] font-bold disabled:opacity-50">
                            {isLoading ? <Loader /> : 'Next'}
                        </button>
                    </div>
                </form>
            )}

            {step === 2 && (
                <form onSubmit={handleResetSubmit} className="space-y-4">
                     {questions.map((q, i) => (
                        <div key={i}>
                            <label className="block text-sm font-medium text-[#8A94A6]">{q}</label>
                            <input type="text" value={answers[i]} onChange={(e) => handleAnswerChange(i, e.target.value)} required className="mt-1 block w-full bg-[#1C2234] border border-[#1E2538] rounded-lg p-2 text-white focus:outline-none focus:ring-1 focus:ring-[#00E5FF]" />
                        </div>
                     ))}
                     <div className="pt-4 border-t border-[#1E2538]">
                         <label className="block text-sm font-medium text-[#8A94A6]">New Password</label>
                         <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required className="mt-1 block w-full bg-[#1C2234] border border-[#1E2538] rounded-lg p-2 text-white focus:outline-none focus:ring-1 focus:ring-[#00E5FF]" />
                     </div>
                     <div>
                         <label className="block text-sm font-medium text-[#8A94A6]">Confirm New Password</label>
                         <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required className="mt-1 block w-full bg-[#1C2234] border border-[#1E2538] rounded-lg p-2 text-white focus:outline-none focus:ring-1 focus:ring-[#00E5FF]" />
                     </div>
                     <div>
                        <button type="submit" disabled={isLoading} className="w-full flex justify-center py-2.5 px-4 rounded-lg text-[#0A0D18] bg-[#00E5FF] hover:bg-[#00C2FF] font-bold disabled:opacity-50">
                            {isLoading ? <Loader /> : 'Reset Password'}
                        </button>
                    </div>
                </form>
            )}
            
            {step === 3 && (
                 <div>
                    <button onClick={onSwitchToLogin} className="w-full flex justify-center py-2.5 px-4 rounded-lg text-[#0A0D18] bg-[#00E5FF] hover:bg-[#00C2FF] font-bold">
                        Back to Login
                    </button>
                </div>
            )}

            {step !== 3 && (
                <p className="mt-4 text-center text-sm text-[#8A94A6]">
                    <button onClick={onSwitchToLogin} className="font-medium text-[#00E5FF] hover:text-[#00C2FF]">
                        Back to Login
                    </button>
                </p>
            )}
        </div>
    );
};