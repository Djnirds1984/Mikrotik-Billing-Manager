import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { Loader } from './Loader.tsx';

interface LoginProps {
    onSwitchToForgotPassword: () => void;
}

export const Login: React.FC<LoginProps> = ({ onSwitchToForgotPassword }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [validationErrors, setValidationErrors] = useState<{username?: string; password?: string}>({});
    const { login, error, isLoading } = useAuth();

    const validateForm = () => {
        const errors: {username?: string; password?: string} = {};
        
        if (!username.trim()) {
            errors.username = 'Username is required';
        } else if (username.length < 3) {
            errors.username = 'Username must be at least 3 characters';
        }
        
        if (!password) {
            errors.password = 'Password is required';
        } else if (password.length < 6) {
            errors.password = 'Password must be at least 6 characters';
        }
        
        setValidationErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!validateForm()) {
            return;
        }
        
        await login(username, password);
    };

    return (
        <div className="w-full max-w-md">
            <h2 className="text-2xl font-bold text-center text-slate-800 dark:text-slate-200 mb-6">
                Login to Panel
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                    <div className="p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-600 rounded-md text-red-700 dark:text-red-300 text-sm">
                        {error}
                    </div>
                )}
                <div>
                    <label htmlFor="username" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Username or Email</label>
                    <input
                        id="username"
                        name="username"
                        type="text"
                        autoComplete="username"
                        required
                        value={username}
                        onChange={(e) => {
                            setUsername(e.target.value);
                            if (validationErrors.username) {
                                setValidationErrors(prev => ({ ...prev, username: undefined }));
                            }
                        }}
                        className={`mt-1 block w-full bg-slate-100 dark:bg-slate-700 border rounded-md shadow-sm py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-[--color-primary-500] focus:border-[--color-primary-500] ${
                            validationErrors.username ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'
                        }`}
                    />
                    {validationErrors.username && (
                        <p className="mt-1 text-sm text-red-600 dark:text-red-400">{validationErrors.username}</p>
                    )}
                </div>
                <div>
                    <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Password</label>
                    <input
                        id="password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => {
                            setPassword(e.target.value);
                            if (validationErrors.password) {
                                setValidationErrors(prev => ({ ...prev, password: undefined }));
                            }
                        }}
                        className={`mt-1 block w-full bg-slate-100 dark:bg-slate-700 border rounded-md shadow-sm py-2 px-3 text-slate-900 dark:text-white focus:outline-none focus:ring-[--color-primary-500] focus:border-[--color-primary-500] ${
                            validationErrors.password ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'
                        }`}
                    />
                    {validationErrors.password && (
                        <p className="mt-1 text-sm text-red-600 dark:text-red-400">{validationErrors.password}</p>
                    )}
                </div>
                <div>
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-[--color-primary-600] hover:bg-[--color-primary-700] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[--color-primary-500] disabled:opacity-50 transition-colors"
                    >
                        {isLoading ? <Loader /> : 'Sign in'}
                    </button>
                </div>
            </form>
            <p className="mt-4 text-center text-sm text-slate-600 dark:text-slate-400">
                <button onClick={onSwitchToForgotPassword} className="font-medium text-[--color-primary-600] hover:text-[--color-primary-500]">
                    Forgot Password?
                </button>
            </p>
        </div>
    );
};