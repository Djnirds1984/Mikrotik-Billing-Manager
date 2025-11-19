import React, { useState, useEffect, useCallback } from 'react';
import type { RouterConfigWithId, MikroTikFile } from '../types.ts';
import { listFiles, getFileContent, saveFileContent, createFile } from '../services/mikrotikService.ts';
import { Loader } from './Loader.tsx';
// FIX: Import missing CodeBracketIcon.
import { CodeBracketIcon, EyeIcon } from '../constants.tsx';

const DEFAULT_PORTAL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Internet Access Pending</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #f1f5f9;
            color: #334155;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            text-align: center;
        }
        .container {
            background-color: #ffffff;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
            max-width: 500px;
            width: 90%;
        }
        h1 {
            color: #f97316;
            font-size: 2em;
            margin-bottom: 20px;
        }
        p {
            font-size: 1.1em;
            line-height: 1.6;
        }
        .info-box {
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 20px;
            margin-top: 30px;
            text-align: left;
        }
        .info-box h2 {
            font-size: 1.2em;
            color: #1e293b;
            margin-top: 0;
            margin-bottom: 15px;
        }
        .info-item {
            display: flex;
            justify-content: space-between;
            font-size: 1em;
            margin-bottom: 10px;
        }
        .info-item span {
            color: #64748b;
        }
        .info-item strong {
            font-family: monospace;
            color: #0f172a;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Activation Required</h1>
        <p>Your device is connected, but internet access is not yet activated.</p>
        <p>Please contact the network administrator to enable your service.</p>
        
        <div class="info-box">
            <h2>Your Device Information</h2>
            <div class="info-item">
                <span>IP Address:</span>
                <strong>$(ip)</strong>
            </div>
            <div class="info-item">
                <span>MAC Address:</span>
                <strong>$(mac)</strong>
            </div>
        </div>
    </div>
</body>
</html>`;

const PORTAL_FILE_PATH = 'flash/hotspot/dhcp_portal.html';

type Status = 'loading' | 'editing' | 'saving' | 'error';

export const DhcpPortalPageEditor: React.FC<{ selectedRouter: RouterConfigWithId }> = ({ selectedRouter }) => {
    const [content, setContent] = useState('');
    const [status, setStatus] = useState<Status>('loading');
    const [error, setError] = useState<string | null>(null);
    const [fileId, setFileId] = useState<string | null>(null);

    const fetchFile = useCallback(async () => {
        setStatus('loading');
        setError(null);
        try {
            const allFiles = await listFiles(selectedRouter);
            const portalFile = allFiles.find(f => f.name === PORTAL_FILE_PATH);

            if (portalFile) {
                setFileId(portalFile.id);
                const { contents } = await getFileContent(selectedRouter, portalFile.id);
                setContent(contents);
            } else {
                setFileId(null);
                setContent(DEFAULT_PORTAL_HTML);
            }
            setStatus('editing');
        } catch (err) {
            setError(`Failed to load portal page: ${(err as Error).message}`);
            setStatus('error');
        }
    }, [selectedRouter]);

    useEffect(() => {
        fetchFile();
    }, [fetchFile]);

    const handleSave = async () => {
        setStatus('saving');
        setError(null);
        try {
            if (fileId) {
                await saveFileContent(selectedRouter, fileId, content);
            } else {
                await createFile(selectedRouter, PORTAL_FILE_PATH, content);
                // After creating, we need to fetch again to get the new file ID for subsequent saves
                await fetchFile();
            }
            alert('Portal page saved successfully!');
            setStatus('editing');
        } catch (err) {
            setError(`Failed to save file: ${(err as Error).message}`);
            setStatus('error');
        }
    };

    if (status === 'loading') {
        return <div className="flex justify-center p-8"><Loader /></div>;
    }

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">DHCP Portal Page Editor</h2>
            <p className="text-sm text-slate-500 -mt-4">
                Edit the HTML page that non-activated clients see. The file is stored on the router at <strong>{PORTAL_FILE_PATH}</strong>.
            </p>

            {error && <div className="p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-md text-sm">{error}</div>}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-[60vh]">
                {/* Editor */}
                <div className="flex flex-col">
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="font-semibold flex items-center gap-2"><CodeBracketIcon className="w-5 h-5"/> HTML Editor</h3>
                         <button onClick={handleSave} disabled={status === 'saving'} className="px-4 py-2 bg-[--color-primary-600] text-white font-bold rounded-lg disabled:opacity-50">
                            {status === 'saving' ? 'Saving...' : 'Save Page'}
                        </button>
                    </div>
                    <textarea
                        value={content}
                        onChange={e => setContent(e.target.value)}
                        className="w-full flex-grow p-2 font-mono text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md resize-none"
                        spellCheck="false"
                        disabled={status !== 'editing'}
                    />
                </div>
                {/* Preview */}
                <div className="flex flex-col">
                    <h3 className="font-semibold mb-2 flex items-center gap-2"><EyeIcon className="w-5 h-5"/> Live Preview</h3>
                    <div className="flex-grow bg-white border border-slate-300 dark:border-slate-600 rounded-md">
                        <iframe
                            srcDoc={content}
                            title="Portal Page Preview"
                            className="w-full h-full"
                            sandbox="allow-scripts"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};