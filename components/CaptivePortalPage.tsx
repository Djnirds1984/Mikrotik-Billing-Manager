import React, { useState, useEffect, useRef } from 'react';
import { MikroTikLogoIcon, QuestionMarkCircleIcon } from '../constants.tsx';
import type { CompanySettings, ChatMessage } from '../types.ts';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { useCompanySettings } from '../hooks/useCompanySettings.ts';
import { getAiHelp } from '../services/geminiService.ts';
import { Loader } from './Loader.tsx';

const CAPTIVE_HELP_SYSTEM_INSTRUCTION = `You are a friendly AI assistant for a network captive portal page.
A user is connected to the network but does not have internet access yet. They are seeing a page that tells them activation is required.
Your ONLY goals are:
1. To be friendly and reassuring.
2. To explain in simple terms that their internet is not yet active.
3. To strongly advise them to contact the network administrator to get their service enabled.
4. DO NOT offer any technical solutions, troubleshooting steps, or ask for any personal information.
5. Keep your answers short, simple, and direct.`;

// A self-contained version of the Help component for the unauthenticated captive page
const CaptiveHelp: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [history, setHistory] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const chatContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            const initialGreeting = `Hello! I'm an AI assistant. It looks like you're connected to the network, but your internet isn't active yet. How can I help you?`;
            setHistory([{ role: 'model', content: initialGreeting }]);
        }
    }, [isOpen]);

    useEffect(() => {
        chatContainerRef.current?.scrollTo(0, chatContainerRef.current.scrollHeight);
    }, [history]);
    
    const handleSend = async () => {
        if (!input.trim() || isLoading) return;
        
        const newHistory: ChatMessage[] = [...history, { role: 'user', content: input }];
        setHistory(newHistory);
        setInput('');
        setIsLoading(true);

        try {
            const context = `The user is on the captive portal page, waiting for internet activation.`;
            const response = await getAiHelp(context, history, input);
            setHistory([...newHistory, { role: 'model', content: response }]);
        } catch (error) {
            const errorMessage = (error as Error).message.includes('API key not valid') 
                ? "Sorry, the AI Assistant is not configured correctly by the administrator."
                : `Sorry, I ran into an error: ${(error as Error).message}`;
            setHistory([...newHistory, { role: 'model', content: errorMessage }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white rounded-full p-3 sm:p-4 shadow-lg z-40 transition-transform hover:scale-110"
                aria-label="Open AI Help"
            >
                <QuestionMarkCircleIcon className="w-6 h-6 sm:w-8 sm:h-8" />
            </button>
            {isOpen && (
                 <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg h-[70vh] border border-slate-200 dark:border-slate-700 flex flex-col">
                        <header className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                            <h3 className="text-xl font-bold text-[--color-primary-500] dark:text-[--color-primary-400]">AI Assistant</h3>
                            <button onClick={() => setIsOpen(false)} className="p-1 text-slate-400 hover:text-slate-800 dark:hover:text-white text-2xl leading-none">&times;</button>
                        </header>
                         <div ref={chatContainerRef} className="flex-1 p-4 overflow-y-auto space-y-4">
                            {history.map((msg, index) => (
                                <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-md p-3 rounded-lg ${msg.role === 'user' ? 'bg-[--color-primary-600] text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200'}`}>
                                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                                    </div>
                                </div>
                            ))}
                            {isLoading && <div className="flex justify-start"><div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-700"><Loader/></div></div>}
                        </div>
                        <footer className="p-4 border-t border-slate-200 dark:border-slate-700">
                            <div className="flex items-center gap-2">
                                <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="Ask a question..."
                                    className="flex-1 p-2 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md text-slate-900 dark:text-white resize-none"
                                    rows={1} disabled={isLoading} />
                                <button onClick={handleSend} disabled={isLoading || !input.trim()} className="px-4 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] rounded-md disabled:opacity-50 text-white">Send</button>
                            </div>
                        </footer>
                    </div>
                </div>
            )}
        </>
    );
};


export const CaptivePortalPage: React.FC = () => {
    // This hook ensures theme classes are applied to the root <html> element
    useTheme(); 
    const { settings: companySettings, isLoading } = useCompanySettings();

    return (
        <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col justify-center items-center py-12 px-4">
            <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
                {isLoading ? <Loader /> : companySettings.logoBase64 ? (
                     <img src={companySettings.logoBase64} alt="Company Logo" className="mx-auto h-20 w-auto object-contain" />
                ) : (
                    <MikroTikLogoIcon className="mx-auto h-16 w-auto text-[--color-primary-500]" />
                )}
            </div>
            <div className="mt-8 bg-white dark:bg-slate-800 py-8 px-4 shadow-lg sm:rounded-lg sm:px-10 border border-slate-200 dark:border-slate-700 w-full max-w-lg">
                <h1 className="text-center text-3xl font-extrabold text-[--color-primary-600] dark:text-[--color-primary-400]">
                    Activation Required
                </h1>
                <p className="mt-4 text-center text-slate-600 dark:text-slate-300">
                    Your device is connected to the network, but you do not have internet access yet.
                </p>
                <p className="mt-2 text-center text-slate-600 dark:text-slate-300">
                    Please contact the network administrator to activate your service.
                </p>
                 <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700 text-center">
                    <h2 className="font-semibold text-slate-800 dark:text-slate-200">Need help?</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Click the chat bubble in the corner to talk to our AI assistant.</p>
                </div>
            </div>
             <footer className="mt-8 text-center text-sm text-slate-500 dark:text-slate-400">
                <p>Powered by {companySettings.companyName || 'MikroTik Orange Pi Manager'}</p>
            </footer>

            <CaptiveHelp />
        </div>
    );
};
