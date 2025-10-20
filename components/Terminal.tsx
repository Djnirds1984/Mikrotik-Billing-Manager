import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XtermTerminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import type { RouterConfigWithId } from '../types.ts';
import { RouterIcon } from '../constants.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';

// Define a simple theme for the terminal
const darkTheme = {
    background: '#1e293b', // slate-800
    foreground: '#f1f5f9', // slate-100
    cursor: '#f97316', // orange-500
    selectionBackground: '#475569', // slate-600
};

const lightTheme = {
    background: '#ffffff', // white
    foreground: '#0f172a', // slate-900
    cursor: '#f97316', // orange-500
    selectionBackground: '#cbd5e1', // slate-300
};

export const Terminal: React.FC<{ selectedRouter: RouterConfigWithId | null }> = ({ selectedRouter }) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const termRef = useRef<XtermTerminal | null>(null);
    const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
    const { isDarkMode } = useTheme();

    useEffect(() => {
        if (!selectedRouter || !terminalRef.current) {
            // Cleanup on router deselect
            if (wsRef.current) wsRef.current.close();
            if (termRef.current) {
                termRef.current.dispose();
                termRef.current = null;
            }
             if (terminalRef.current) {
                terminalRef.current.innerHTML = '';
            }
            return;
        }

        if (termRef.current) {
             // If terminal already exists, just update its theme
             termRef.current.options.theme = isDarkMode ? darkTheme : lightTheme;
             return;
        }

        // --- Initialize Terminal and WebSocket ---
        const term = new XtermTerminal({
            cursorBlink: true,
            rows: 20,
            fontFamily: 'monospace',
            fontSize: 14,
            theme: isDarkMode ? darkTheme : lightTheme,
        });
        termRef.current = term;

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());
        term.open(terminalRef.current);
        fitAddon.fit();
        term.focus();

        term.write('Welcome to the MikroTik Web Terminal!\r\n');
        term.write(`Attempting to connect to ${selectedRouter.name} (${selectedRouter.host})...\r\n`);
        setStatus('connecting');

        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}/ws/ssh`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            const authPayload = {
                type: 'auth',
                data: {
                    host: selectedRouter.host,
                    user: selectedRouter.user,
                    password: selectedRouter.password || '',
                    port: selectedRouter.port, // This is for REST API, SSH is usually 22, backend will use 22.
                    term_cols: term.cols,
                    term_rows: term.rows,
                }
            };
            ws.send(JSON.stringify(authPayload));
        };

        ws.onmessage = (event) => {
            term.write(event.data);
            if (status !== 'connected') {
                setStatus('connected');
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket Error:', error);
            term.write('\r\n*** WebSocket connection error. Please check the backend server. ***\r\n');
            setStatus('error');
        };

        ws.onclose = () => {
            if (status !== 'error') {
                 term.write('\r\n*** Connection Closed ***\r\n');
            }
            setStatus('disconnected');
        };

        term.onData((data) => {
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'data', data }));
            }
        });
        
        const handleResize = () => {
            fitAddon.fit();
            if (ws.readyState === ws.OPEN) {
                 ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
            }
        };

        const resizeObserver = new ResizeObserver(handleResize);
        // Observe the parent of the terminal container for better resize detection
        if (terminalRef.current.parentElement) {
            resizeObserver.observe(terminalRef.current.parentElement);
        }
        
        // Initial fit
        setTimeout(() => handleResize(), 100);

        return () => {
            resizeObserver.disconnect();
            ws.close();
            term.dispose();
            termRef.current = null;
            if (terminalRef.current) {
                terminalRef.current.innerHTML = '';
            }
        };
    }, [selectedRouter, isDarkMode]);

    const getStatusIndicator = () => {
        switch(status) {
            case 'connected': return <span className="text-green-500">Connected</span>;
            case 'connecting': return <span className="text-yellow-500">Connecting...</span>;
            case 'disconnected': return <span className="text-slate-500">Disconnected</span>;
            case 'error': return <span className="text-red-500">Error</span>;
        }
    }

    if (!selectedRouter) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                <RouterIcon className="w-16 h-16 text-slate-400 dark:text-slate-600 mb-4" />
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">Router Terminal</h2>
                <p className="mt-2 text-slate-500 dark:text-slate-400">Please select a router from the top bar to open an SSH terminal session.</p>
            </div>
        );
    }
    
    return (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md flex flex-col h-full overflow-hidden">
            <div className="p-2 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center text-xs font-mono">
                <span>Status: {getStatusIndicator()}</span>
                <span>{selectedRouter.user}@{selectedRouter.host}</span>
            </div>
             <div ref={terminalRef} className="w-full flex-grow p-2" />
        </div>
    );
};