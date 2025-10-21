import React, { useState, useEffect, useRef } from 'react';
import type { RouterConfigWithId, View } from '../types.ts';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import { useTheme, colorThemes, ColorTheme } from '../contexts/ThemeContext.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';


interface TopBarProps {
  title: string;
  routers: RouterConfigWithId[];
  selectedRouter: RouterConfigWithId | null;
  onSelectRouter: (id: string | null) => void;
  setCurrentView: (view: View) => void;
  onToggleSidebar: () => void;
}

const MenuIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
);

const PaletteIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402a3.75 3.75 0 00-5.304-5.304L4.098 14.6c-.43.43-.755.92-.976 1.463l-3.268 8.171a.75.75 0 00.97.97l8.17-3.268c.544-.22 1.034-.546 1.464-.976z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 5.25a2.25 2.25 0 012.25 2.25c0 1.24-1.01 2.25-2.25 2.25S15.75 8.74 15.75 7.5s1.01-2.25 2.25-2.25zM12.75 15.75a2.25 2.25 0 012.25 2.25c0 1.24-1.01 2.25-2.25 2.25S10.5 19.24 10.5 18s1.01-2.25 2.25-2.25z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12.75a2.25 2.25 0 012.25 2.25c0 1.24-1.01 2.25-2.25 2.25S12.75 16.24 12.75 15s1.01-2.25 2.25-2.25z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 15.75a2.25 2.25 0 012.25 2.25c0 1.24-1.01 2.25-2.25 2.25S7.5 19.24 7.5 18s1.01-2.25 2.25-2.25z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 12.75a2.25 2.25 0 012.25 2.25c0 1.24-1.01 2.25-2.25 2.25S5.25 16.24 5.25 15s1.01-2.25 2.25-2.25z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75a2.25 2.25 0 012.25 2.25c0 1.24-1.01 2.25-2.25 2.25S7.5 13.24 7.5 12s1.01-2.25 2.25-2.25z" />
    </svg>
);

const LogoutIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
    </svg>
);


const ColorSelector: React.FC = () => {
    const { colorTheme, setColorTheme } = useTheme();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const themeColors: Record<ColorTheme, string> = {
        orange: 'bg-orange-500',
        sky: 'bg-sky-500',
        emerald: 'bg-emerald-500',
        violet: 'bg-violet-500',
    };

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);
    
    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors"
                title="Change theme color"
            >
                <PaletteIcon className="w-5 h-5" />
            </button>
            {isOpen && (
                 <div className="absolute right-0 mt-2 w-40 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg z-30 p-2">
                    <div className="grid grid-cols-2 gap-2">
                        {colorThemes.map(theme => (
                            <button
                                key={theme}
                                onClick={() => {
                                    setColorTheme(theme);
                                    setIsOpen(false);
                                }}
                                className={`w-full p-2 rounded-md transition-all ${colorTheme === theme ? 'ring-2 ring-offset-2 ring-offset-slate-100 dark:ring-offset-slate-800 ring-[--color-primary-500]' : ''}`}
                            >
                                <div className={`w-full h-8 rounded ${themeColors[theme]}`}></div>
                                <span className="block text-xs mt-1 capitalize text-slate-700 dark:text-slate-300">{theme}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

const RouterSelector: React.FC<{
  routers: RouterConfigWithId[];
  selectedRouter: RouterConfigWithId | null;
  onSelectRouter: (id: string) => void;
  setCurrentView: (view: View) => void;
}> = ({ routers, selectedRouter, onSelectRouter, setCurrentView }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const { t } = useLocalization();

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (routers.length === 0) {
        return (
            <button
                onClick={() => setCurrentView('routers')}
                className="px-4 py-2 text-sm text-white bg-[--color-primary-600] hover:bg-[--color-primary-700] rounded-md transition-colors font-semibold"
                title={t('topbar.add_router_title')}
            >
                {t('topbar.add_a_router')}
            </button>
        );
    }
    
    return (
        <div className="relative" ref={dropdownRef}>
            <button 
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-md transition-colors shadow-sm"
            >
                <span className="text-slate-500 dark:text-slate-300 hidden sm:inline">{t('topbar.router')}:</span>
                <span className="font-semibold text-slate-800 dark:text-white max-w-[120px] sm:max-w-xs truncate">{selectedRouter?.name || t('topbar.select')}</span>
                <svg className={`w-4 h-4 text-slate-500 dark:text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {isOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg z-30">
                    <ul className="py-1">
                        {routers.map(router => (
                            <li key={router.id}>
                                <button 
                                    onClick={() => {
                                        onSelectRouter(router.id);
                                        setIsOpen(false);
                                    }}
                                    className="w-full text-left px-4 py-2 text-sm text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                                >
                                    {router.name}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

export const TopBar: React.FC<TopBarProps> = ({ title, routers, selectedRouter, onSelectRouter, setCurrentView, onToggleSidebar }) => {
  const { logout } = useAuth();
  
  return (
    <header className="bg-white/80 dark:bg-slate-900/70 backdrop-blur-sm sticky top-0 z-20 border-b border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between h-16 px-4 sm:px-8">
        <div className="flex items-center gap-4">
            <button onClick={onToggleSidebar} className="lg:hidden text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white" aria-label="Open sidebar">
                <MenuIcon className="w-6 h-6" />
            </button>
            <h1 className="text-lg sm:text-xl font-bold text-slate-800 dark:text-slate-100 truncate">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
            <RouterSelector 
                routers={routers} 
                selectedRouter={selectedRouter} 
                onSelectRouter={onSelectRouter} 
                setCurrentView={setCurrentView} 
            />
            <ColorSelector />
             <button
                onClick={logout}
                className="p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors"
                title="Logout"
            >
                <LogoutIcon className="w-5 h-5" />
            </button>
        </div>
      </div>
    </header>
  );
};