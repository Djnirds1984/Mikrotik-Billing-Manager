import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { RouterConfigWithId, MikroTikFile } from '../types.ts';
import { listFiles, getFileContent, saveFileContent } from '../services/mikrotikService.ts';
import { Loader } from './Loader.tsx';
import { RouterIcon, FolderIcon, FileIcon } from '../constants.tsx';

type View = 'browser' | 'editor';
type Status = 'loading' | 'editing' | 'saving' | 'error' | 'idle';

export const MikrotikFiles: React.FC<{ selectedRouter: RouterConfigWithId | null }> = ({ selectedRouter }) => {
    const [allFiles, setAllFiles] = useState<MikroTikFile[]>([]);
    const [path, setPath] = useState<string[]>(['flash']);
    const [status, setStatus] = useState<Status>('loading');
    const [error, setError] = useState<string | null>(null);
    
    const [view, setView] = useState<View>('browser');
    const [selectedFile, setSelectedFile] = useState<MikroTikFile | null>(null);
    const [content, setContent] = useState('');

    const fetchData = useCallback(async () => {
        if (!selectedRouter) return;
        setStatus('loading');
        setError(null);
        try {
            const files = await listFiles(selectedRouter);
            setAllFiles(files);
            setStatus('idle');
        } catch (err) {
            setError(`Failed to fetch file list: ${(err as Error).message}`);
            setStatus('error');
        }
    }, [selectedRouter]);

    useEffect(() => {
        fetchData();
        // When router changes, reset to the desired default path
        setPath(['flash']); 
    }, [fetchData]);

    const currentPathString = useMemo(() => path.join('/'), [path]);

    const directoryContents = useMemo(() => {
        const pathPrefix = currentPathString ? `${currentPathString}/` : '';
        const items = new Map<string, { name: string; type: 'directory' | 'file'; original: MikroTikFile }>();

        for (const file of allFiles) {
            if (currentPathString && !file.name.startsWith(pathPrefix)) {
                continue;
            }

            const relativePath = file.name.substring(pathPrefix.length);
            if (relativePath === '') continue;

            const slashIndex = relativePath.indexOf('/');

            if (slashIndex === -1) {
                // No slash. It could be a file OR a folder without a trailing slash.
                // e.g., "login.html" or "flash" (where type is '.folder')
                if (!items.has(relativePath)) {
                    items.set(relativePath, {
                        name: relativePath,
                        type: file.type === '.folder' ? 'directory' : 'file',
                        original: file
                    });
                }
            } else {
                // Has a slash. It represents a directory in the current view.
                // e.g., "hotspot/" or "hotspot/login.html"
                const dirName = relativePath.substring(0, slashIndex);
                if (dirName && !items.has(dirName)) {
                    // Find an explicit directory entry for this name if it exists.
                    const dirFile = allFiles.find(f => f.name === `${pathPrefix}${dirName}/` || (f.name === `${pathPrefix}${dirName}` && f.type === '.folder'));
                    // Use the explicit entry, or create a "virtual" one. The original doesn't matter much for display.
                    items.set(dirName, {
                        name: dirName,
                        type: 'directory',
                        original: dirFile || { ...file, id: `dir-${pathPrefix}${dirName}`, name: `${pathPrefix}${dirName}/`, type: '.folder' }
                    });
                }
            }
        }

        return Array.from(items.values()).sort((a, b) => {
            if (a.type === b.type) {
                return a.name.localeCompare(b.name);
            }
            return a.type === 'directory' ? -1 : 1;
        });
    }, [allFiles, currentPathString]);

    const handleItemClick = async (item: { name: string, type: 'directory' | 'file', original: MikroTikFile }) => {
        if (item.type === 'directory') {
            setPath(prev => [...prev, item.name]);
        } else {
            setStatus('loading');
            setError(null);
            try {
                setSelectedFile(item.original);
                const { contents } = await getFileContent(selectedRouter!, item.original.id);
                setContent(contents);
                setView('editor');
                setStatus('idle');
            } catch(err) {
                setError(`Failed to load file content: ${(err as Error).message}`);
                setStatus('error');
            }
        }
    };

    const handleSave = async () => {
        if (!selectedFile) return;
        setStatus('saving');
        setError(null);
        try {
            await saveFileContent(selectedRouter!, selectedFile.id, content);
            setStatus('idle');
            setView('browser');
            alert('File saved successfully!');
        } catch (err) {
            setError(`Failed to save file: ${(err as Error).message}`);
            setStatus('error');
        }
    };

    const handleBreadcrumbClick = (index: number) => {
        setPath(prev => prev.slice(0, index + 1));
    };


    if (!selectedRouter) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                <RouterIcon className="w-16 h-16 text-slate-400 dark:text-slate-600 mb-4" />
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">Mikrotik File Editor</h2>
                <p className="mt-2 text-slate-500 dark:text-slate-400">Please select a router to browse its files.</p>
            </div>
        );
    }
    
    if (view === 'editor') {
        return (
            <div className="space-y-4 h-full flex flex-col">
                <div className="flex justify-between items-center flex-shrink-0">
                    <div>
                        <h3 className="text-xl font-semibold">Editing:</h3>
                        <p className="text-sm font-mono text-slate-500">{selectedFile?.name}</p>
                    </div>
                     <div className="flex items-center gap-2">
                        <button onClick={() => setView('browser')} disabled={status === 'saving'} className="px-4 py-2 text-sm bg-slate-200 dark:bg-slate-600 rounded-lg">Back</button>
                        <button onClick={handleSave} disabled={status === 'saving'} className="px-4 py-2 text-sm bg-[--color-primary-600] text-white rounded-lg disabled:opacity-50">
                            {status === 'saving' ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </div>
                 {error && <div className="p-3 bg-red-100 text-red-700 rounded-md text-sm">{error}</div>}
                 <textarea
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    className="w-full flex-grow p-2 font-mono text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md resize-none"
                    spellCheck="false"
                 />
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md p-6">
            <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-4">File Browser</h3>
            <div className="text-sm text-slate-500 dark:text-slate-400 font-mono bg-slate-100 dark:bg-slate-900/50 p-2 rounded-md mb-4 overflow-x-auto whitespace-nowrap">
                <button onClick={() => setPath([])} className="hover:underline">root</button>
                {path.map((p, i) => (
                    <span key={i}>
                        {' / '}
                        <button onClick={() => handleBreadcrumbClick(i)} className="hover:underline">{p}</button>
                    </span>
                ))}
            </div>
            {status === 'loading' && <div className="flex justify-center p-8"><Loader /></div>}
            {status === 'error' && <div className="p-4 bg-red-100 text-red-700 rounded-md">{error}</div>}
            {status === 'idle' && (
                <ul className="space-y-1">
                    {directoryContents.map(item => (
                        <li key={item.original.id}>
                            <button onClick={() => handleItemClick(item)} className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700/50 text-left">
                                {item.type === 'directory' 
                                    ? <FolderIcon className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                                    : <FileIcon className="w-5 h-5 text-slate-500 flex-shrink-0" />
                                }
                                <span className="font-medium text-slate-800 dark:text-slate-200 truncate">{item.name}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};