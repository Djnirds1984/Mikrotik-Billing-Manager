import React, { useState, useEffect, useRef } from 'react';
import type { View, RouterConfigWithId, ChatMessage } from '../types.ts';
import { getAiHelp, analyzeSystemState } from '../services/geminiService.ts';
import { Loader } from './Loader.tsx';
import { QuestionMarkCircleIcon } from '../constants.tsx';

const HelpButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
    <button
        onClick={onClick}
        className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white rounded-full p-3 sm:p-4 shadow-lg z-40 transition-transform hover:scale-110"
        aria-label="Open AI Help"
    >
        <QuestionMarkCircleIcon className="w-6 h-6 sm:w-8 sm:h-8" />
    </button>
);

const HelpModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    currentView: View;
    selectedRouter: RouterConfigWithId | null;
}> = ({ isOpen, onClose, currentView, selectedRouter }) => {
    const [history, setHistory] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isReporting, setIsReporting] = useState(false);
    const chatContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            const initialGreeting = `Hello! I'm your AI assistant. You are currently on the **${currentView.charAt(0).toUpperCase() + currentView.slice(1)}** page${selectedRouter ? ` for the router **'${selectedRouter.name}'**` : ''}. How can I help you today?`;
            setHistory([{ role: 'model', content: initialGreeting }]);
        }
    }, [isOpen, currentView, selectedRouter]);

    useEffect(() => {
        chatContainerRef.current?.scrollTo(0, chatContainerRef.current.scrollHeight);
    }, [history]);

    if (!isOpen) return null;

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;
        
        const newHistory: ChatMessage[] = [...history, { role: 'user', content: input }];
        setHistory(newHistory);
        setInput('');
        setIsLoading(true);

        try {
            const context = `The user is on the '${currentView}' page. The selected router is '${selectedRouter?.name || 'none'}'.`;
            const response = await getAiHelp(context, history, input);
            setHistory([...newHistory, { role: 'model', content: response }]);
        } catch (error) {
            const errorMessage = (error as Error).message;
            setHistory([...newHistory, { role: 'model', content: `Sorry, I ran into an error: ${errorMessage}` }]);
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleGenerateReport = async () => {
        setIsReporting(true);
        try {
            // First, get an AI analysis of the current state
            const ztResponse = await fetch('/api/zt/status');
            const ztStatus = ztResponse.ok ? await ztResponse.text() : 'Not available.';
            const codeResponse = await fetch('/api/fixer/file-content');
            const backendCode = codeResponse.ok ? await codeResponse.text() : 'Not available.';
            
            const analysis = await analyzeSystemState({
                view: currentView,
                routerName: selectedRouter?.name || 'None',
                backendCode,
                ztStatus
            });
            
            // Then, ask the backend to compile the full report with this analysis
            const reportResponse = await fetch('/api/generate-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    view: currentView,
                    routerName: selectedRouter?.name,
                    geminiAnalysis: analysis
                })
            });
            
            if (!reportResponse.ok) throw new Error('Failed to generate report on the backend.');
            
            const blob = await reportResponse.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'mikrotik-panel-report.txt';
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);

        } catch (error) {
            alert(`Failed to generate report: ${(error as Error).message}`);
        } finally {
            setIsReporting(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-2xl h-[80vh] border border-slate-200 dark:border-slate-700 flex flex-col">
                <header className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                    <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400]">AI Assistant</h3>
                    <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-800 dark:hover:text-white">&times;</button>
                </header>
                <div ref={chatContainerRef} className="flex-1 p-4 overflow-y-auto space-y-4">
                    {history.map((msg, index) => (
                        <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-lg p-3 rounded-lg ${msg.role === 'user' ? 'bg-[--color-primary-600] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200'}`}>
                                <p className="text-sm whitespace-pre-wrap">{msg.content.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold">$1</strong>')
                                    .split('\n')
                                    .map((line, i) => <span key={i} dangerouslySetInnerHTML={{__html: line}} className="block"/>)
                                }</p>
                            </div>
                        </div>
                    ))}
                    {isLoading && <div className="flex justify-start"><div className="max-w-lg p-3 rounded-lg bg-slate-100 dark:bg-slate-700"><Loader/></div></div>}
                </div>
                <footer className="p-4 border-t border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-2">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Ask a question or describe your problem..."
                            className="flex-1 p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md text-slate-900 dark:text-white resize-none"
                            rows={2}
                            disabled={isLoading}
                        />
                        <button onClick={handleSend} disabled={isLoading || !input.trim()} className="px-4 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] rounded-md disabled:opacity-50 text-white">Send</button>
                    </div>
                    <div className="mt-2 text-center">
                         <button onClick={handleGenerateReport} disabled={isReporting} className="text-xs text-slate-500 dark:text-slate-400 hover:text-sky-500 dark:hover:text-sky-400 disabled:opacity-50">
                            {isReporting ? 'Generating...' : 'Generate System Report (.txt)'}
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
};


export const Help: React.FC<{
    currentView: View;
    selectedRouter: RouterConfigWithId | null;
}> = ({ currentView, selectedRouter }) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <HelpButton onClick={() => setIsOpen(true)} />
            <HelpModal 
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
                currentView={currentView}
                selectedRouter={selectedRouter}
            />
        </>
    );
};
