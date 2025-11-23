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
            <h2 className="text-2xl font-bold text-center text-slate-800 dark:text-slate-200 mb-2">
                Create Admin Account
            </h2>
            <p className="text-center text-sm text-slate-500 dark:text-slate-400 mb-6">Welcome! As the first user, you will be the administrator. Please set up your account and recovery questions.</p>
            <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                    <div className="p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-600 rounded-md text-red-700 dark:text-red-300 text-sm">
                        {error}
                    </div>
                )}
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Username</label>
                    <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md p-2"/>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Password</label>
                    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md p-2"/>
                </div>
                 <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Confirm Password</label>
                    <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required className="mt-1 block w-full bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md p-2"/>
                </div>
                
                <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                    <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-2">Password Recovery</h3>
                    <div className="space-y-4">
                        <div>
                           <label className="block text-sm font-medium">Question 1</label>
                           <select value={q1} onChange={e => setQ1(e.target.value)} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md">{SECURITY_QUESTIONS.map(q => <option key={q} value={q}>{q}</option>)}</select>
                           <input type="text" placeholder="Answer 1" value={a1} onChange={e => setA1(e.target.value)} required className="mt-2 w-full p-2 bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md"/>
                        </div>
                         <div>
                           <label className="block text-sm font-medium">Question 2</label>
                           <select value={q2} onChange={e => setQ2(e.target.value)} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md">{SECURITY_QUESTIONS.map(q => <option key={q} value={q}>{q}</option>)}</select>
                           <input type="text" placeholder="Answer 2" value={a2} onChange={e => setA2(e.target.value)} required className="mt-2 w-full p-2 bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md"/>
                        </div>
                         <div>
                           <label className="block text-sm font-medium">Question 3</label>
                           <select value={q3} onChange={e => setQ3(e.target.value)} className="mt-1 w-full p-2 bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md">{SECURITY_QUESTIONS.map(q => <option key={q} value={q}>{q}</option>)}</select>
                           <input type="text" placeholder="Answer 3" value={a3} onChange={e => setA3(e.target.value)} required className="mt-2 w-full p-2 bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded-md"/>
                        </div>
                    </div>
                </div>

                <div>
                    <button type="submit" disabled={isLoading} className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-[--color-primary-600] hover:bg-[--color-primary-700] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[--color-primary-500] disabled:opacity-50">
                        {isLoading ? <Loader /> : 'Create Account'}
                    </button>
                </div>
            </form>
        </div>
    );
};
