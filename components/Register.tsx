import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { Loader } from './Loader.tsx';

const SECURITY_QUESTIONS = [
    "What was your mother's maiden name?",
    "What was the name of your first pet?",
    "What city were you born in?",
    "What was the model of your first car?",
    "What is your favorite book?",
];

export const Register: React.FC = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    
    const [q1, setQ1] = useState(SECURITY_QUESTIONS[0]);
    const [a1, setA1] = useState('');
    const [q2, setQ2] = useState(SECURITY_QUESTIONS[1]);
    const [a2, setA2] = useState('');
    const [q3, setQ3] = useState(SECURITY_QUESTIONS[2]);
    const [a3, setA3] = useState('');

    const [localError, setLocalError] = useState('');
    const { register, error: authError, isLoading } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError('');
        if (password !== confirmPassword) {
            setLocalError("Passwords do not match.");
            return;
        }
        if (!a1 || !a2 || !a3) {
            setLocalError("All three security answers are required.");
            return;
        }
        if (new Set([q1, q2, q3]).size !== 3) {
            setLocalError("Please select three unique security questions.");
            return;
        }
        
        const securityQuestions = [
            { question: q1, answer: a1 },
            { question: q2, answer: a2 },
            { question: q3, answer: a3 },
        ];
        
        console.log('DEBUG: Register submitting');
        await register(username, password, securityQuestions);
        console.log('DEBUG: Register completed, expecting App to render dashboard');
    };

    const error = localError || authError;

    return (
        <div className="w-full max-w-md">
            <h2 className="text-2xl font-bold text-center text-white mb-2">
                Create Admin Account
            </h2>
            <p className="text-center text-sm text-[#8A94A6] mb-6">Welcome! As the first user, you will be the administrator. Please set up your account and recovery questions.</p>
            <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                    <div className="p-3 bg-red-900/20 border border-red-800/50 rounded-md text-red-300 text-sm">
                        {error}
                    </div>
                )}
                <div>
                    <label className="block text-sm font-medium text-[#8A94A6]">Username</label>
                    <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} required className="mt-1 block w-full bg-[#1C2234] border border-[#1E2538] rounded-lg p-2 text-white focus:outline-none focus:ring-1 focus:ring-[#00E5FF]" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-[#8A94A6]">Password</label>
                    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="mt-1 block w-full bg-[#1C2234] border border-[#1E2538] rounded-lg p-2 text-white focus:outline-none focus:ring-1 focus:ring-[#00E5FF]" />
                </div>
                 <div>
                    <label className="block text-sm font-medium text-[#8A94A6]">Confirm Password</label>
                    <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required className="mt-1 block w-full bg-[#1C2234] border border-[#1E2538] rounded-lg p-2 text-white focus:outline-none focus:ring-1 focus:ring-[#00E5FF]" />
                </div>
                
                <div className="pt-4 border-t border-[#1E2538]">
                    <h3 className="text-lg font-semibold text-white mb-2">Password Recovery</h3>
                    <div className="space-y-4">
                        <div>
                           <label className="block text-sm font-medium">Question 1</label>
                           <select value={q1} onChange={e => setQ1(e.target.value)} className="mt-1 w-full p-2 bg-[#1C2234] border border-[#1E2538] rounded-lg text-white">{SECURITY_QUESTIONS.map(q => <option key={q} value={q}>{q}</option>)}</select>
                           <input type="text" placeholder="Answer 1" value={a1} onChange={e => setA1(e.target.value)} required className="mt-2 w-full p-2 bg-[#1C2234] border border-[#1E2538] rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-[#00E5FF]"/>
                        </div>
                         <div>
                           <label className="block text-sm font-medium">Question 2</label>
                           <select value={q2} onChange={e => setQ2(e.target.value)} className="mt-1 w-full p-2 bg-[#1C2234] border border-[#1E2538] rounded-lg text-white">{SECURITY_QUESTIONS.map(q => <option key={q} value={q}>{q}</option>)}</select>
                           <input type="text" placeholder="Answer 2" value={a2} onChange={e => setA2(e.target.value)} required className="mt-2 w-full p-2 bg-[#1C2234] border border-[#1E2538] rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-[#00E5FF]"/>
                        </div>
                         <div>
                           <label className="block text-sm font-medium">Question 3</label>
                           <select value={q3} onChange={e => setQ3(e.target.value)} className="mt-1 w-full p-2 bg-[#1C2234] border border-[#1E2538] rounded-lg text-white">{SECURITY_QUESTIONS.map(q => <option key={q} value={q}>{q}</option>)}</select>
                           <input type="text" placeholder="Answer 3" value={a3} onChange={e => setA3(e.target.value)} required className="mt-2 w-full p-2 bg-[#1C2234] border border-[#1E2538] rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-[#00E5FF]"/>
                        </div>
                    </div>
                </div>

                <div>
                    <button type="submit" disabled={isLoading} className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg text-sm font-bold text-[#0A0D18] bg-[#00E5FF] hover:bg-[#00C2FF] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#00E5FF] disabled:opacity-50">
                        {isLoading ? <Loader /> : 'Create Account'}
                    </button>
                </div>
            </form>
        </div>
    );
};
