import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

// Define the shape of the user object and the context
interface User {
    id: string;
    username: string;
    role: {
        id: string;
        name: string;
    };
    permissions: string[];
}

interface SecurityQuestion {
    question: string;
    answer: string;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    isLoading: boolean;
    hasUsers: boolean;
    error: string | null;
    login: (username: string, password: string) => Promise<void>;
    register: (username: string, password: string, securityQuestions: SecurityQuestion[]) => Promise<void>;
    logout: () => void;
    getSecurityQuestions: (username: string) => Promise<string[]>;
    resetPassword: (username: string, answers: string[], newPassword: string) => Promise<{ success: boolean; message: string }>;
    clearError: () => void;
    hasPermission: (permission: string) => boolean;
    verifyToken: (token: string) => Promise<void>; // Expose verifyToken
}

// Create the context with a default undefined value
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Define the provider component
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(() => localStorage.getItem('authToken'));
    const [isLoading, setIsLoading] = useState(true);
    const [hasUsers, setHasUsers] = useState(true); // Assume users exist initially
    const [error, setError] = useState<string | null>(null);

    const clearError = () => setError(null);

    const checkHasUsers = useCallback(async () => {
        try {
            console.log('DEBUG: Checking for existing users...');
            const res = await fetch('/api/auth/has-users');
            console.log('DEBUG: has-users response status:', res.status);
            if (!res.ok) {
                console.log('DEBUG: has-users request failed with status:', res.status);
                return;
            }
            const data = await res.json();
            console.log('DEBUG: has-users data:', data);
            setHasUsers(data.hasUsers);
        } catch (e) {
            console.error("Could not check for existing users", e);
            // Default to true to show login form if backend is down
            setHasUsers(true);
        }
    }, []);

    const verifyToken = useCallback(async (tokenToVerify: string) => {
        try {
            console.log('DEBUG: Verifying token...');
            const response = await fetch('/api/auth/status', {
                headers: { 'Authorization': `Bearer ${tokenToVerify}` },
            });
            console.log('DEBUG: Token verification response status:', response.status);
            if (response.ok) {
                const userData = await response.json();
                console.log('DEBUG: Token verification successful');
                setUser(userData);
            } else {
                console.log('DEBUG: Token verification failed with status:', response.status);
                // Token is invalid, clear it
                setUser(null);
                setToken(null);
                localStorage.removeItem('authToken');
            }
        } catch (e) {
            console.error("Token verification failed", e);
            // On error, also clear the token
            setUser(null);
            setToken(null);
            localStorage.removeItem('authToken');
        }
    }, []);

    useEffect(() => {
        const initializeAuth = async () => {
            setIsLoading(true);
            await checkHasUsers();
            const storedToken = localStorage.getItem('authToken');
            if (storedToken) {
                setToken(storedToken);
                await verifyToken(storedToken);
            }
            setIsLoading(false);
        };
        initializeAuth();
    }, [checkHasUsers, verifyToken]);

    const handleAuth = async (url: string, body: object) => {
        setError(null);
        setIsLoading(true);
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'An error occurred.');
            }
            const { token: newToken, user: newUser } = data;
            setToken(newToken);
            setUser(newUser);
            localStorage.setItem('authToken', newToken);
            await checkHasUsers(); // Re-check after registration
        } catch (e) {
            setError((e as Error).message);
            // Clear any potentially bad state
            setUser(null);
            setToken(null);
            localStorage.removeItem('authToken');
        } finally {
            setIsLoading(false);
        }
    };

    const login = (username: string, password: string) => handleAuth('/api/auth/login', { username, password });
    const register = (username: string, password: string, securityQuestions: SecurityQuestion[]) => handleAuth('/api/auth/register', { username, password, securityQuestions });
    
    const getSecurityQuestions = async (username: string): Promise<string[]> => {
        try {
            const response = await fetch(`/api/auth/security-questions/${encodeURIComponent(username)}`);
            if (!response.ok) {
                throw new Error("Could not fetch security questions.");
            }
            const data = await response.json();
            return data.questions || [];
        } catch (e) {
            console.error("Failed to get security questions", e);
            setError((e as Error).message);
            return [];
        }
    };

    const resetPassword = async (username: string, answers: string[], newPassword: string): Promise<{ success: boolean; message: string }> => {
        setError(null);
        setIsLoading(true);
        try {
             const response = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, answers, newPassword }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'An error occurred.');
            }
            return { success: true, message: data.message };
        } catch (e) {
             setError((e as Error).message);
             return { success: false, message: (e as Error).message };
        } finally {
            setIsLoading(false);
        }
    };

    const logout = async () => {
        setError(null);
        if (token) {
            try {
                await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                });
            } catch (e) {
                console.error("Logout failed on server, clearing client-side anyway.", e);
            }
        }
        setUser(null);
        setToken(null);
        localStorage.removeItem('authToken');
    };

    const hasPermission = (permission: string) => {
        if (!user || !user.permissions) return false;
        // Admin has a wildcard permission
        if (user.permissions.includes('*:*')) return true;
        return user.permissions.includes(permission) || false;
    };

    const value = { user, token, isLoading, hasUsers, error, login, register, logout, getSecurityQuestions, resetPassword, clearError, hasPermission, verifyToken };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

// Custom hook for using the auth context
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
