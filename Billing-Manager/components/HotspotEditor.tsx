import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { listFiles, getFileContent, saveFileContent, createFile } from '../services/mikrotikService.ts';
import type { RouterConfigWithId, MikroTikFile } from '../types.ts';
import { Loader } from './Loader.tsx';
// FIX: Import missing FolderIcon and FileIcon.
import { FolderIcon, FileIcon } from '../constants.tsx';

type Status = 'browsing' | 'loading_list' | 'loading_content' | 'editing' | 'saving' | 'error';

export const HotspotEditor: React.FC<{ selectedRouter: RouterConfigWithId }> = ({ selectedRouter }) => {
    const [allFiles, setAllFiles] = useState<MikroTikFile[]>([]);
    const [path, setPath] = useState<string[]>(['flash', 'hotspot']);
    const [status, setStatus] = useState<Status>('loading_list');
    const [error, setError] = useState<string | null>(null);
    const [selectedFile, setSelectedFile] = useState<MikroTikFile | null>(null);
    const [content, setContent] = useState('');
    const [view, setView] = useState<'browser' | 'editor'>('browser');
    
    const [fileToUpload, setFileToUpload] = useState<File | null>(null);
    const uploadInputRef = useRef<HTMLInputElement>(null);

    const currentPath = useMemo(() => path.join('/'), [path]);

    const fetchData = useCallback(async () => {
        setStatus('loading_list');
        setError(null);
        try {
            const fileList = await listFiles(selectedRouter);
            setAllFiles(fileList);
            setStatus('browsing');
        } catch (err) {
            setError(`Failed to list files: ${(err as Error).message}`);
            setStatus('error');
        }
    }, [selectedRouter]);

    useEffect(() => {
        fetchData();
        setPath(['flash', 'hotspot']);
    }, [fetchData]);

    const directoryContents = useMemo(() => {
        const pathPrefix = currentPath ? `${currentPath}/` : '';
        const items = new Map<string, { name: string; type: 'directory' | 'file'; original: MikroTikFile }>();

        for (const file of allFiles) {
            if (currentPath && !file.name.startsWith(pathPrefix)) {
                continue;
            }
            const relativePath = file.name.substring(pathPrefix.length);
            if (relativePath === '') continue;

            const slashIndex = relativePath.indexOf('/');

            if (slashIndex === -1) {
                if (!items.has(relativePath)) {
                    items.set(relativePath, { name: relativePath, type: file.type === '.folder' ? 'directory' : 'file', original: file });
                }
            } else {
                const dirName = relativePath.substring(0, slashIndex);
                if (dirName && !items.has(dirName)) {
                     const dirFile = allFiles.find(f => f.name === `${pathPrefix}${dirName}/` || (f.name === `${pathPrefix}${dirName}` && f.type === '.folder'));
                     items.set(dirName, {
                        name: dirName,
                        type: 'directory',
                        original: dirFile || { ...file, id: `dir-${pathPrefix}${dirName}`, name: `${pathPrefix}${dirName}/`, type: '.folder' }
                    });
                }
            }
        }

        return Array.from(items.values()).sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name);
            return a.type === 'directory' ? -1 : 1;
        });
    }, [allFiles, currentPath]);

    const handleItemClick = async (item: { name: string, type: 'directory' | 'file', original: MikroTikFile }) => {
        if (item.type === 'directory') {
            setPath(prev => [...prev, item.name]);
        } else {
            setStatus('loading_content');
            setError(null);
            try {
                setSelectedFile(item.original);
                const { contents } = await getFileContent(selectedRouter, item.original.id);
                setContent(contents);
                setView('editor');
                setStatus('browsing');
            } catch (err) {
                setError(`Failed to load content for '${item.name}': ${(err as Error).message}`);
                setStatus('error');
            }
        }
    };

    const handleSave = async () => {
        if (!selectedFile) return;
        setStatus('saving');
        setError(null);
        try {
            await saveFileContent(selectedRouter, selectedFile.id, content);
            alert('File saved successfully!');
            setView('browser');
            setStatus('browsing');
        } catch (err) {
            setError(`Failed to save '${selectedFile.name}': ${(err as Error).message}`);
            setStatus('error');
        }
    };

    const handleBreadcrumbClick = (index: number) => {
        setPath(prev => prev.slice(0, index + 1));
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFileToUpload(e.target.files?.[0] || null);
    };

    const handleUpload = async () => {
        if (!fileToUpload) return alert("Please select a file to upload.");

        const fullPath = `${currentPath}/${fileToUpload.name}`;
        const existingFile = allFiles.find(f => f.name === fullPath);

        if (existingFile && !window.confirm(`File "${fileToUpload.name}" already exists. Overwrite it?`)) return;
        
        setStatus('saving');
        setError(null);

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const textContent = event.target?.result as string;
                if (existingFile) {
                    await saveFileContent(selectedRouter, existingFile.id, textContent);
                } else {
                    await createFile(selectedRouter, fullPath, textContent);
                }
                alert('File uploaded successfully!');
                await fetchData();
                setFileToUpload(null);
                if (uploadInputRef.current) uploadInputRef.current.value = "";
                setStatus('browsing');
            } catch (err) {
                setError(`Upload failed: ${(err as Error).message}`);
                setStatus('error');
            }
        };
        reader.onerror = () => { setError("Failed to read the selected file."); setStatus('error'); };
        reader.readAsText(fileToUpload);
    };

    if (view === 'editor') {
        return (
            <div className="space-y-4 h-full flex flex-col">
                <div className="flex justify-between items-center">
                    <div>
                        <h3 className="text-xl font-semibold">Editing:</h3>
                        <p className="text-sm font-mono text-slate-500">{selectedFile?.name}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setView('browser')} disabled={status === 'saving'} className="px-4 py-2 text-sm bg-slate-200 rounded-lg">Back</button>
                        <button onClick={handleSave} disabled={status === 'saving'} className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg disabled:opacity-50">
                            {status === 'saving' ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </div>
                {error && <div className="p-3 bg-red-100 text-red-700 rounded-md text-sm">{error}</div>}
                <textarea
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    className="w-full flex-grow p-2 font-mono text-xs bg-white dark:bg-slate-900 border rounded-md resize-none"
                    spellCheck="false"
                />
            </div>
        );
    }
    
    return (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-md p-6">
            <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2">Login Page File Browser</h3>
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-4">
                <div className="text-sm text-slate-500 dark:text-slate-400 font-mono bg-slate-100 dark:bg-slate-900/50 p-2 rounded-md overflow-x-auto whitespace-nowrap">
                    <button onClick={() => setPath([])} className="hover:underline">root</button>
                    {path.map((p, i) => (
                        <span key={i}>{' / '}<button onClick={() => handleBreadcrumbClick(i)} className="hover:underline">{p}</button></span>
                    ))}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    <input ref={uploadInputRef} type="file" onChange={handleFileSelect} className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-slate-200 dark:file:bg-slate-600 file:text-slate-700 dark:file:text-slate-200 hover:file:bg-slate-300 dark:hover:file:bg-slate-500" />
                    <button onClick={handleUpload} disabled={!fileToUpload || status === 'saving'} className="px-3 py-1.5 text-sm bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-semibold disabled:opacity-50">
                        {status === 'saving' ? 'Uploading...' : 'Upload'}
                    </button>
                </div>
            </div>
            
            {(status === 'loading_list' || status === 'saving') && <div className="flex justify-center p-8"><Loader /></div>}
            {status === 'error' && <div className="p-4 bg-red-100 text-red-700 rounded-md">{error}</div>}

            {status === 'browsing' && (
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