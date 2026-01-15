import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';

type Theme = 'light' | 'dark' | 'system';
// New type for color themes
export type ColorTheme = 'orange' | 'sky' | 'emerald' | 'violet';
export const colorThemes: ColorTheme[] = ['orange', 'sky', 'emerald', 'violet'];

interface ThemeContextType {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    colorTheme: ColorTheme;
    setColorTheme: (theme: ColorTheme) => void;
    isDarkMode: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Light/Dark mode state
    const [theme, setThemeState] = useState<Theme>(() => {
        if (typeof window !== 'undefined' && window.localStorage) {
            const storedTheme = window.localStorage.getItem('theme') as Theme | null;
            if (storedTheme) {
                return storedTheme;
            }
        }
        return 'system';
    });

    // Color theme state
    const [colorTheme, setColorThemeState] = useState<ColorTheme>(() => {
         if (typeof window !== 'undefined' && window.localStorage) {
            const storedColor = window.localStorage.getItem('colorTheme') as ColorTheme | null;
            if (storedColor && colorThemes.includes(storedColor)) {
                return storedColor;
            }
        }
        return 'orange';
    });

    const isDarkMode = useMemo(() => 
        theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches),
        [theme]
    );

    // Effect for light/dark mode
    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.toggle('dark', isDarkMode);
        try {
            window.localStorage.setItem('theme', theme);
        } catch (e) {
            console.error('Failed to save theme to localStorage', e);
        }
    }, [theme, isDarkMode]);
    
    // Effect for color theme
    useEffect(() => {
        const root = window.document.documentElement;
        // Remove any existing theme- class
        colorThemes.forEach(ct => root.classList.remove(`theme-${ct}`));
        // Add the new class
        root.classList.add(`theme-${colorTheme}`);
        try {
            window.localStorage.setItem('colorTheme', colorTheme);
        } catch (e) {
            console.error('Failed to save color theme to localStorage', e);
        }
    }, [colorTheme]);
    
    // Listen for system theme changes if theme is 'system'
    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        
        const handleChange = () => {
             if (theme === 'system') {
                 const root = window.document.documentElement;
                 root.classList.toggle('dark', mediaQuery.matches);
             }
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, [theme]);


    const setTheme = (newTheme: Theme) => {
        setThemeState(newTheme);
    };

    const setColorTheme = (newColorTheme: ColorTheme) => {
        setColorThemeState(newColorTheme);
    };

    const value = useMemo(() => ({ theme, setTheme, colorTheme, setColorTheme, isDarkMode }), [theme, colorTheme, isDarkMode]);

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};