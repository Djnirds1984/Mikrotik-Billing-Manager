import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { Loader } from './Loader.tsx';

interface LoginProps {
    onSwitchToForgotPassword: () => void;
}

export const Login: React.FC<LoginProps> = ({ onSwitchToForgotPassword }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const { login, error, isLoading } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await login(username, password);
    };

    return (
        <div className="w-full max-w-md">
            <h2 className="text-2xl font-bold text-center text-white mb-6">
                Login to Panel
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                    <div className="p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-600 rounded-md text-red-700 dark:text-red-300 text-sm">
                        {error}
                    </div>
                )}
                <div>
                    <label htmlFor="username" className="block text-sm font-medium text-[#8A94A6]">Username</label>
                    <input
                        id="username"
                        name="username"
                        type="text"
                        autoComplete="username"
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="mt-1 block w-full bg-[#1C2234] border border-[#1E2538] rounded-lg shadow-sm py-2 px-3 text-white placeholder-[#5A6478] focus:outline-none focus:ring-1 focus:ring-[#00E5FF] focus:border-[#00E5FF]"
                    />
                </div>
                <div>
                    <label htmlFor="password"className="block text-sm font-medium text-[#8A94A6]">Password</label>
                    <input
                        id="password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="mt-1 block w-full bg-[#1C2234] border border-[#1E2538] rounded-lg shadow-sm py-2 px-3 text-white placeholder-[#5A6478] focus:outline-none focus:ring-1 focus:ring-[#00E5FF] focus:border-[#00E5FF]"
                    />
                </div>
                <div>
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg text-sm font-bold text-[#0A0D18] bg-[#00E5FF] hover:bg-[#00C2FF] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#00E5FF] disabled:opacity-50"
                    >
                        {isLoading ? <Loader /> : 'Sign in'}
                    </button>
                </div>
            </form>
            <p className="mt-4 text-center text-sm text-[#8A94A6]">
                <button onClick={onSwitchToForgotPassword} className="font-medium text-[#00E5FF] hover:text-[#00C2FF]">
                    Forgot Password?
                </button>
            </p>
        </div>
    );
};