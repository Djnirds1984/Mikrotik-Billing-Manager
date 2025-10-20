
import React from 'react';

interface ScriptGeneratorProps {
  prompt: string;
  setPrompt: (prompt: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export const ScriptGenerator: React.FC<ScriptGeneratorProps> = ({ prompt, setPrompt, onSubmit, isLoading }) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="flex flex-col space-y-4">
      <label htmlFor="prompt-input" className="text-lg font-semibold text-slate-800 dark:text-slate-300">
        Describe your networking task
      </label>
      <textarea
        id="prompt-input"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="e.g., 'Create a firewall rule to block all incoming traffic on port 8080 to the router itself'"
        className="w-full h-48 p-3 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-[--color-primary-500] focus:outline-none transition-all resize-y text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500"
        disabled={isLoading}
      />
      <button
        onClick={onSubmit}
        disabled={isLoading}
        className="w-full bg-[--color-primary-600] hover:bg-[--color-primary-500] disabled:bg-[--color-primary-800] disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center transition-colors duration-200"
      >
        {isLoading ? 'Generating...' : 'Generate Script'}
        <span className="ml-2 text-xs font-mono bg-black/20 px-1.5 py-0.5 rounded">[Ctrl+Enter]</span>
      </button>
    </div>
  );
};