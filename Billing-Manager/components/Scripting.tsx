
import React, { useState, useCallback } from 'react';
import { ScriptGenerator } from './ScriptGenerator.tsx';
import { CodeBlock } from './CodeBlock.tsx';
import { Loader } from './Loader.tsx';
import { generateMikroTikScript } from '../services/geminiService.ts';
import { EXAMPLE_PROMPTS } from '../constants.tsx';

export const Scripting: React.FC = () => {
  const [prompt, setPrompt] = useState<string>('');
  const [generatedScript, setGeneratedScript] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerateScript = useCallback(async () => {
    if (!prompt.trim()) {
      setError('Prompt cannot be empty.');
      return;
    }
    setIsLoading(true);
    setError(null);
    setGeneratedScript('');

    try {
      const script = await generateMikroTikScript(prompt);
      setGeneratedScript(script);
    } catch (err) {
      setError('Failed to generate script. Please check your API key and try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [prompt]);

  const handleExampleClick = (examplePrompt: string) => {
    setPrompt(examplePrompt);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="flex flex-col space-y-6">
        <ScriptGenerator
          prompt={prompt}
          setPrompt={setPrompt}
          onSubmit={handleGenerateScript}
          isLoading={isLoading}
        />
        <div>
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-300 mb-3">Or try an example:</h3>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_PROMPTS.map((example, index) => (
              <button
                key={index}
                onClick={() => handleExampleClick(example.prompt)}
                disabled={isLoading}
                className="bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:bg-slate-100 dark:disabled:bg-slate-800 disabled:cursor-not-allowed text-sm text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-md transition-colors duration-200"
              >
                {example.title}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col">
        <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 flex-grow relative border border-slate-200 dark:border-slate-700 min-h-[300px] lg:min-h-[480px]">
          {isLoading && (
            <div className="absolute inset-0 bg-slate-50/75 dark:bg-slate-800/75 flex flex-col items-center justify-center rounded-lg z-10">
              <Loader />
              <p className="mt-4 text-[--color-primary-500] dark:text-[--color-primary-400]">AI is thinking...</p>
            </div>
          )}
          {error && (
            <div className="text-red-700 dark:text-red-400 p-4 border border-red-300 dark:border-red-500 bg-red-100 dark:bg-red-900/20 rounded-md">
              <p className="font-bold">An Error Occurred</p>
              <p>{error}</p>
            </div>
          )}
          {!isLoading && !error && !generatedScript && (
             <div className="flex items-center justify-center h-full text-slate-400 dark:text-slate-500">
               <p>Your generated script will appear here.</p>
             </div>
          )}
          {generatedScript && <CodeBlock script={generatedScript} />}
        </div>
      </div>
    </div>
  );
};