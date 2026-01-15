import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getFileContent } from '../services/aiFixerService.ts';
import { fixBackendCode } from '../services/geminiService.ts';
import type { AIFixResponse } from '../types.ts';
import { Loader } from './Loader.tsx';
import { CodeBlock } from './CodeBlock.tsx';
import { CheckCircleIcon, ExclamationTriangleIcon } from '../constants.tsx';

type FixerStatus = 'idle' | 'fetching' | 'thinking' | 'suggesting' | 'applying' | 'success' | 'error';

const LogViewer: React.FC<{ logs: string[] }> = ({ logs }) => {
    const logContainerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div ref={logContainerRef} className="bg-slate-100 dark:bg-slate-900 text-xs font-mono text-slate-700 dark:text-slate-300 p-4 rounded-md h-48 overflow-y-auto border border-slate-200 dark:border-slate-600">
            {logs.map((log, index) => (
                <pre key={index} className="whitespace-pre-wrap break-words">{log}</pre>
            ))}
        </div>
    );
};

export const AIFixer: React.FC<{ errorMessage: string, routerName: string }> = ({ errorMessage, routerName }) => {
    const [status, setStatus] = useState<FixerStatus>('idle');
    const [fix, setFix] = useState<AIFixResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [logs, setLogs] = useState<string[]>([]);

    useEffect(() => {
        const getFix = async () => {
            setStatus('fetching');
            setError(null);
            try {
                const backendCode = await getFileContent();
                setStatus('thinking');
                const aiResponse = await fixBackendCode(backendCode, errorMessage, routerName);
                setFix(aiResponse);
                setStatus('suggesting');
            } catch (err) {
                console.error('AI Fixer failed:', err);
                setError((err as Error).message);
                setStatus('error');
            }
        };

        getFix();
    }, [errorMessage, routerName]);

    const handleApplyFix = () => {
        if (!fix?.fixedCode) return;
        
        setStatus('applying');
        setLogs([]);

        // The endpoint is a POST that returns a text/event-stream.
        // We use fetch to initiate it and read the stream.
        fetch('/api/fixer/apply-fix', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: fix.fixedCode,
        })
        .then(response => {
            if (!response.body) {
                throw new Error("Streaming response not supported or failed.");
            }
            const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
            
            const readStream = () => {
                reader.read().then(({ done, value }) => {
                    if (done) {
                        // The stream might close before the restart is fully complete.
                        // We show success and prompt a reload.
                        if (status !== 'error') {
                            setStatus('success');
                        }
                        return;
                    }
                    
                    // Process SSE data chunks
                    const lines = value.split('\n').filter(line => line.startsWith('data: '));
                    lines.forEach(line => {
                        try {
                            const json = JSON.parse(line.substring(5));
                            if (json.log) {
                                setLogs(prev => [...prev, json.log]);
                            }
                            if (json.status === 'restarting') {
                                setStatus('success');
                            }
                            if (json.status === 'error') {
                                setError(json.message);
                                setStatus('error');
                            }
                        } catch (e) {
                            // ignore parse errors for non-json lines
                        }
                    });

                    readStream();
                });
            };
            
            readStream();
        })
        .catch(err => {
            setError(err.message);
            setStatus('error');
        });
    };

    const renderStatus = () => {
        switch (status) {
            case 'fetching':
                return <div className="flex items-center gap-3"><Loader /><p>Reading backend code...</p></div>;
            case 'thinking':
                return <div className="flex items-center gap-3"><Loader /><p>AI is analyzing the error and code...</p></div>;
            case 'error':
                 return <div className="flex items-center gap-3 text-red-600 dark:text-red-400"><ExclamationTriangleIcon className="w-8 h-8" /><p>{error}</p></div>;
            case 'applying':
                return (
                    <div>
                        <div className="flex items-center gap-3 mb-4"><Loader /><p>Applying fix and restarting backend...</p></div>
                        <LogViewer logs={logs} />
                    </div>
                );
            case 'success':
                 return (
                    <div className="text-center">
                        <CheckCircleIcon className="w-12 h-12 text-green-500 dark:text-green-400 mx-auto mb-2" />
                        <h3 className="text-lg font-semibold text-green-800 dark:text-green-300">Fix Applied Successfully!</h3>
                        <p className="text-green-600/80 dark:text-green-400/80 text-sm mt-2">The backend service has been updated and restarted. Please try reloading the page or the "Try Again" button on the error card.</p>
                    </div>
                 );
            default:
                return null;
        }
    };
    
    return (
        <div className="bg-white dark:bg-slate-800 border border-sky-300 dark:border-sky-700/50 rounded-lg p-6 mt-6">
            <h3 className="text-xl font-bold text-sky-600 dark:text-sky-400 mb-4">AI Code Fixer</h3>
            
            {status !== 'suggesting' && (
                <div className="bg-slate-100 dark:bg-slate-900/50 p-6 rounded-lg min-h-[100px] flex items-center justify-center">
                    {renderStatus()}
                </div>
            )}
            
            {status === 'suggesting' && fix && (
                <div className="space-y-6">
                    <div>
                        <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">AI Analysis:</h4>
                        <p className="text-sm bg-slate-100 dark:bg-slate-700/50 p-3 rounded-md border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300">{fix.explanation}</p>
                    </div>
                    <div>
                        <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Suggested Fix (api-backend/server.js):</h4>
                        <div className="h-96 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900">
                             <CodeBlock script={fix.fixedCode} />
                        </div>
                    </div>
                     <div className="flex justify-end pt-4 border-t border-slate-200 dark:border-slate-700">
                        <button onClick={handleApplyFix} className="px-5 py-2.5 bg-green-600 hover:bg-green-500 rounded-lg font-semibold text-white">
                           Apply Fix & Restart Backend
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
