

import React, { useState, useEffect, useCallback } from 'react';
import { 
    getCurrentVersion, listBackups, deleteBackup, 
    streamUpdateStatus, streamUpdateApp, streamRollbackApp,
    parseGitHubUrl, getRepositoryInfo, getBranches, streamPullFromRepository
} from '../services/updaterService.ts';
import { UpdateIcon, CloudArrowUpIcon, CheckCircleIcon, ExclamationTriangleIcon, TrashIcon, QuestionMarkCircleIcon } from '../constants.tsx';
import { Loader } from './Loader.tsx';
import { useLocalization } from '../contexts/LocalizationContext.tsx';
import type { VersionInfo, NewVersionInfo, GitHubRepository, GitHubBranch } from '../types.ts';

type UpdateStatus = 'idle' | 'checking' | 'uptodate' | 'available' | 'diverged' | 'ahead' | 'error' | 'updating' | 'restarting' | 'rollingback';
type StatusInfo = {
    status: UpdateStatus;
    message: string;
};
type LogEntry = {
    text: string;
    isError?: boolean;
};

const LogViewer: React.FC<{ logs: LogEntry[] }> = ({ logs }) => {
    const logContainerRef = React.useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div ref={logContainerRef} className="bg-slate-100 dark:bg-slate-900 text-xs font-mono text-slate-700 dark:text-slate-300 p-4 rounded-md h-64 overflow-y-auto border border-slate-200 dark:border-slate-600">
            {logs.map((log, index) => (
                <pre key={index} className={`whitespace-pre-wrap break-words ${log.isError ? 'text-red-500' : ''}`}>{log.text}</pre>
            ))}
        </div>
    );
};

const VersionInfoDisplay: React.FC<{ title: string; info: VersionInfo }> = ({ title, info }) => (
    <div>
        <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">{title}</h3>
        <div className="bg-slate-100 dark:bg-slate-900/50 p-4 rounded-lg space-y-3">
            <div>
                <p className="text-lg font-semibold text-[--color-primary-500] dark:text-[--color-primary-400]">{info.title} <span className="text-xs font-mono text-slate-500 ml-2">{info.hash}</span></p>
                {info.description && <p className="mt-2 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{info.description}</p>}
            </div>
            {info.remoteUrl && (
                <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
                     <p className="text-xs text-slate-500 dark:text-slate-400">Update Source Repository:</p>
                     <a href={info.remoteUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-mono text-sky-600 dark:text-sky-400 hover:underline break-all">{info.remoteUrl}</a>
                </div>
            )}
        </div>
    </div>
);

const ChangelogDisplay: React.FC<{ info: NewVersionInfo }> = ({ info }) => (
    <div>
        <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">New Version Available: <span className="text-cyan-500 dark:text-cyan-400">{info.title}</span></h3>
        <div className="bg-slate-100 dark:bg-slate-900/50 p-4 rounded-lg space-y-4">
            {info.description && <p className="text-sm text-slate-600 dark:text-slate-300 italic">{info.description}</p>}
            <div>
                <h4 className="font-semibold text-slate-800 dark:text-slate-200 mb-2">Changelog:</h4>
                <pre className="text-xs font-mono bg-slate-200 dark:bg-slate-800 p-3 rounded-md text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{info.changelog}</pre>
            </div>
        </div>
    </div>
);


export const Updater: React.FC = () => {
    const { t } = useLocalization();
    const [statusInfo, setStatusInfo] = useState<StatusInfo>({ status: 'idle', message: t('updater.check_latest_version') || 'Check for the latest version of the panel.' });
    const [backups, setBackups] = useState<string[]>([]);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [currentVersionInfo, setCurrentVersionInfo] = useState<VersionInfo | null>(null);
    const [newVersionInfo, setNewVersionInfo] = useState<NewVersionInfo | null>(null);
    const [isLoadingCurrentVersion, setIsLoadingCurrentVersion] = useState(true);
    const [isDeleting, setIsDeleting] = useState<string | null>(null);
    
    // New state for GitHub integration
    const [repositoryUrl, setRepositoryUrl] = useState('');
    const [selectedBranch, setSelectedBranch] = useState('main');
    const [branches, setBranches] = useState<GitHubBranch[]>([]);
    const [isLoadingRepo, setIsLoadingRepo] = useState(false);
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);
    const [isPulling, setIsPulling] = useState(false);
    const [repoError, setRepoError] = useState('');
    const [branchError, setBranchError] = useState('');
    const [pullError, setPullError] = useState('');
    const [repositoryInfo, setRepositoryInfo] = useState<any>(null);


    const fetchBackups = useCallback(async () => {
        try {
            const data = await listBackups();
            setBackups(data.filter(file => file.endsWith('.tar.gz')));
        } catch (error) {
            console.error(error);
             setStatusInfo({ status: 'error', message: `Failed to fetch backups: ${(error as Error).message}` });
        }
    }, []);

    useEffect(() => {
        const fetchCurrentVersion = async () => {
            setIsLoadingCurrentVersion(true);
            try {
                const data = await getCurrentVersion();
                setCurrentVersionInfo(data);
            } catch (error) {
                console.error(error);
                setStatusInfo({ status: 'error', message: (error as Error).message });
            } finally {
                setIsLoadingCurrentVersion(false);
            }
        };

        fetchCurrentVersion();
        fetchBackups();
        
        // Load saved repository URL and branch from localStorage
        const savedRepoUrl = localStorage.getItem('updaterRepositoryUrl');
        const savedBranch = localStorage.getItem('updaterBranch');
        if (savedRepoUrl) setRepositoryUrl(savedRepoUrl);
        if (savedBranch) setSelectedBranch(savedBranch);
    }, [fetchBackups]);

    const handleCheckForUpdates = () => {
        setLogs([]);
        setNewVersionInfo(null);
        setStatusInfo({ status: 'checking', message: 'Connecting to repository...' });

        streamUpdateStatus({
            onMessage: (data) => {
                 if (data.log) {
                    setLogs(prev => [...prev, { text: data.log.trim(), isError: data.isError }]);
                }
                
                if (data.newVersionInfo) {
                    setNewVersionInfo(data.newVersionInfo);
                }

                if (data.status && data.status !== 'finished') {
                    setStatusInfo(prev => ({...prev, ...data}));
                }
            },
            onClose: () => {
                setStatusInfo(prev => {
                    if (prev.status === 'checking') {
                         return { status: 'error', message: 'Failed to determine update status. Check logs for details.' };
                    }
                    return prev;
                });
            },
            onError: (err) => {
                setStatusInfo({ status: 'error', message: `Connection to server failed. Could not check for updates. ${err.message}` });
            }
        });
    };
    
    const handleUpdate = () => {
        setStatusInfo(prev => ({ ...prev, status: 'updating', message: 'Starting update process...' }));
        setLogs([]);

        streamUpdateApp({
            onMessage: (data) => {
                if (data.log) {
                    setLogs(prev => [...prev, { text: data.log.trim(), isError: data.isError }]);
                }
                if (data.status === 'restarting') {
                    setStatusInfo({ status: 'restarting', message: 'Update complete! The server is restarting. This page will reload in a few seconds...' });
                    setTimeout(() => window.location.reload(), 8000);
                }
                 if (data.status === 'error') {
                    setStatusInfo({ status: 'error', message: data.message });
                }
            },
            onError: (err) => {
                 setStatusInfo({ status: 'error', message: `Lost connection to the server during the update process. ${err.message}` });
            }
        });
    };
    
    const handleRollback = (backupFile: string) => {
        if (!window.confirm(`Are you sure you want to restore the backup "${backupFile}"? This will overwrite the current application files.`)) return;

        setStatusInfo({ status: 'rollingback', message: `Restoring from ${backupFile}...` });
        setLogs([]);
        
        streamRollbackApp(backupFile, {
             onMessage: (data) => {
                if(data.log) {
                    setLogs(prev => [...prev, { text: data.log.trim(), isError: data.isError }]);
                }
                if(data.status === 'restarting') {
                    setStatusInfo({ status: 'restarting', message: 'Rollback complete! Server is restarting...' });
                    setTimeout(() => window.location.reload(), 8000);
                }
                 if(data.status === 'error') {
                     setStatusInfo({ status: 'error', message: data.message });
                 }
             },
             onError: (err) => {
                 setStatusInfo({ status: 'error', message: `Lost connection during rollback. ${err.message}` });
             }
        });
    };

    const handleDeleteBackup = async (backupFile: string) => {
        if (!window.confirm(`Are you sure you want to PERMANENTLY delete the backup "${backupFile}"? This cannot be undone.`)) return;

        setIsDeleting(backupFile);
        try {
            await deleteBackup(backupFile);
            await fetchBackups(); // Refresh the list
        } catch (error) {
            alert(`Error: ${(error as Error).message}`);
        } finally {
            setIsDeleting(null);
        }
    };

    const handleRepositoryUrlChange = (url: string) => {
        setRepositoryUrl(url);
        setRepoError('');
        setBranches([]);
        setRepositoryInfo(null);
        
        // Save to localStorage
        localStorage.setItem('updaterRepositoryUrl', url);
        
        // Validate and fetch repository info
        if (url.trim()) {
            const repo = parseGitHubUrl(url);
            if (repo) {
                fetchRepositoryInfo(url);
            } else {
                setRepoError(t('updater.invalid_repo_url') || 'Invalid GitHub repository URL format. Use: https://github.com/owner/repo');
            }
        }
    };

    const fetchRepositoryInfo = async (url: string) => {
        setIsLoadingRepo(true);
        setRepoError('');
        try {
            const data = await getRepositoryInfo(url);
            setRepositoryInfo(data);
            // Fetch branches after getting repo info
            fetchBranches(url);
        } catch (error) {
            console.error('Failed to fetch repository info:', error);
            setRepoError(`Failed to access repository: ${(error as Error).message}`);
        } finally {
            setIsLoadingRepo(false);
        }
    };

    const fetchBranches = async (url: string) => {
        setIsLoadingBranches(true);
        setBranchError('');
        try {
            const data = await getBranches(url);
            setBranches(data);
            // Set default branch if available
            const defaultBranch = data.find(b => b.name === 'main') || data.find(b => b.name === 'master');
            if (defaultBranch) {
                setSelectedBranch(defaultBranch.name);
                localStorage.setItem('updaterBranch', defaultBranch.name);
            }
        } catch (error) {
            console.error('Failed to fetch branches:', error);
            setBranchError(`Failed to fetch branches: ${(error as Error).message}`);
        } finally {
            setIsLoadingBranches(false);
        }
    };

    const handleBranchChange = (branch: string) => {
        setSelectedBranch(branch);
        setBranchError('');
        localStorage.setItem('updaterBranch', branch);
    };

    const handlePullFromRepository = () => {
        if (!repositoryUrl.trim() || !selectedBranch) {
            setPullError('Repository URL and branch are required');
            return;
        }

        setLogs([]);
        setPullError('');
        setIsPulling(true);

        streamPullFromRepository(repositoryUrl, selectedBranch, {
            onMessage: (data) => {
                if (data.log) {
                    setLogs(prev => [...prev, { text: data.log.trim(), isError: data.isError }]);
                }
                
                if (data.status === 'completed') {
                    setStatusInfo({ status: 'uptodate', message: t('updater.pull_success') || 'Successfully pulled latest changes from repository' });
                    setIsPulling(false);
                }
                
                if (data.status === 'error') {
                    setStatusInfo({ status: 'error', message: data.message || (t('updater.pull_failed') || 'Pull operation failed') });
                    setPullError(data.message || (t('updater.pull_failed') || 'Pull operation failed'));
                    setIsPulling(false);
                }
            },
            onClose: () => {
                if (isPulling) {
                    setStatusInfo({ status: 'error', message: t('updater.connection_lost') || 'Connection lost during pull operation' });
                    setPullError(t('updater.connection_lost') || 'Connection lost during pull operation');
                    setIsPulling(false);
                }
            },
            onError: (err) => {
                setStatusInfo({ status: 'error', message: `${t('updater.pull_failed') || 'Pull operation failed'}: ${err.message}` });
                setPullError(`${t('updater.pull_failed') || 'Pull operation failed'}: ${err.message}`);
                setIsPulling(false);
            }
        });
    };


    const renderStatusInfo = () => {
        const { status, message } = statusInfo;
        switch (status) {
            case 'checking': return <div className="flex items-center gap-3"><Loader /><p>{message}</p></div>;
            case 'uptodate': return <div className="flex items-center gap-3 text-green-600 dark:text-green-400"><CheckCircleIcon className="w-8 h-8" /><p>{message}</p></div>;
            case 'available': return <div className="flex items-center gap-3 text-cyan-600 dark:text-cyan-400"><CloudArrowUpIcon className="w-8 h-8" /><p>{message}</p></div>;
            case 'error': return <div className="text-left flex items-start gap-3 text-red-600 dark:text-red-400"><ExclamationTriangleIcon className="w-8 h-8 flex-shrink-0" /><p>{message}</p></div>;
            case 'restarting': return <div className="flex items-center gap-3 text-[--color-primary-500] dark:text-[--color-primary-400]"><Loader /><p>{message}</p></div>;
            case 'ahead': return <div className="flex items-center gap-3 text-blue-600 dark:text-blue-400"><CloudArrowUpIcon className="w-8 h-8 rotate-180" /><p>{message}</p></div>;
            case 'diverged': return <div className="text-left flex items-start gap-3 text-orange-600 dark:text-orange-400"><ExclamationTriangleIcon className="w-8 h-8 flex-shrink-0" /><p>{message}</p></div>;
            default: return <div className="flex items-center gap-3 text-slate-500"><UpdateIcon className="w-8 h-8" /><p>{message}</p></div>;
        }
    };
    
    const isWorking = ['checking', 'updating', 'restarting', 'rollingback'].includes(statusInfo.status) || !!isDeleting || isPulling;

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-8">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">Panel Updater</h2>
                <div className="bg-slate-100 dark:bg-slate-900/50 p-6 rounded-lg min-h-[100px] flex items-center justify-center text-slate-700 dark:text-slate-200">
                    {renderStatusInfo()}
                </div>
                 <div className="mt-6 flex justify-end space-x-4">
                    <button onClick={handleCheckForUpdates} disabled={isWorking} className="px-4 py-2 bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500 text-slate-800 dark:text-white rounded-lg font-semibold disabled:opacity-50">
                        Check for Updates
                    </button>
                    {statusInfo.status === 'available' && (
                        <button onClick={handleUpdate} disabled={isWorking} className="px-4 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] text-white rounded-lg font-semibold disabled:opacity-50">
                            Install Update
                        </button>
                    )}
                </div>
            </div>

            {/* GitHub Repository Configuration */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-8">
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-6">{t('updater.github_config') || 'GitHub Repository Configuration'}</h3>
                
                {/* Repository URL Input */}
                <div className="mb-6">
                    <label htmlFor="repository-url" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        {t('updater.repository_url') || 'Git Repository URL'}
                        <QuestionMarkCircleIcon className="ml-1 w-4 h-4 inline-block text-slate-500 dark:text-slate-400 cursor-help" title={t('updater.repository_url_help') || 'Enter the GitHub repository URL in HTTPS or SSH format. Example: https://github.com/owner/repo or git@github.com:owner/repo.git'} />
                    </label>
                    <div className="relative">
                        <input
                            id="repository-url"
                            type="text"
                            value={repositoryUrl}
                            onChange={(e) => handleRepositoryUrlChange(e.target.value)}
                            placeholder={t('updater.repository_url_placeholder') || 'https://github.com/owner/repository'}
                            className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[--color-primary-500] focus:border-transparent ${
                                repoError ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'
                            }`}
                        />
                        {isLoadingRepo && (
                            <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                                <Loader className="w-4 h-4" />
                            </div>
                        )}
                    </div>
                    {repoError && (
                        <p className="mt-1 text-sm text-red-600 dark:text-red-400">{repoError}</p>
                    )}
                    {repositoryInfo && (
                        <div className="mt-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
                            <p className="text-sm text-green-800 dark:text-green-400">
                                {t('updater.repo_connected') || '✓ Connected to'} {repositoryInfo.owner}/{repositoryInfo.repo}
                                {repositoryInfo.description && ` - ${repositoryInfo.description}`}
                            </p>
                        </div>
                    )}
                </div>

                {/* Branch Selection */}
                <div className="mb-6">
                    <label htmlFor="branch-select" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        {t('updater.target_branch') || 'Target Branch'}
                        <QuestionMarkCircleIcon className="ml-1 w-4 h-4 inline-block text-slate-500 dark:text-slate-400 cursor-help" title={t('updater.target_branch_help') || 'Select the branch you want to pull updates from. Main is typically the stable branch.'} />
                    </label>
                    <div className="relative">
                        <select
                            id="branch-select"
                            value={selectedBranch}
                            onChange={(e) => handleBranchChange(e.target.value)}
                            disabled={isLoadingBranches || branches.length === 0}
                            className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[--color-primary-500] focus:border-transparent ${
                                branchError ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            {isLoadingBranches ? (
                                 <option value="">{t('updater.loading_branches') || 'Loading branches...'}</option>
                             ) : branches.length === 0 ? (
                                 <option value="">{t('updater.enter_repo_first') || 'Enter repository URL first'}</option>
                             ) : (
                                 branches.map((branch) => (
                                     <option key={branch.name} value={branch.name}>
                                         {branch.name} {branch.protected && (t('updater.protected') || '(protected)')}
                                     </option>
                                 ))
                             )}
                        </select>
                        {isLoadingBranches && (
                            <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                                <Loader className="w-4 h-4" />
                            </div>
                        )}
                    </div>
                    {branchError && (
                        <p className="mt-1 text-sm text-red-600 dark:text-red-400">{branchError}</p>
                    )}
                </div>

                {/* Pull Button */}
                <div className="flex justify-end">
                    <button
                        onClick={handlePullFromRepository}
                        disabled={isPulling || !repositoryUrl.trim() || !selectedBranch || branches.length === 0}
                        className="px-6 py-2 bg-[--color-primary-600] hover:bg-[--color-primary-500] disabled:bg-slate-400 dark:disabled:bg-slate-600 text-white rounded-lg font-semibold disabled:opacity-50 flex items-center gap-2"
                    >
                        {isPulling ? (
                             <>
                                 <Loader className="w-4 h-4" />
                                 {t('updater.pulling') || 'Pulling...'}
                             </>
                         ) : (
                             <>
                                 <CloudArrowUpIcon className="w-4 h-4" />
                                 {t('updater.pull_from_repo') || 'Pull from Repository'}
                             </>
                         )}
                    </button>
                </div>
                
                {pullError && (
                    <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                        <p className="text-sm text-red-800 dark:text-red-400">{pullError}</p>
                    </div>
                )}
            </div>
            
            {(isWorking || logs.length > 0) && (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-8">
                     <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-4 capitalize">{statusInfo.status} Log</h3>
                     <LogViewer logs={logs} />
                </div>
            )}

            { (isLoadingCurrentVersion && statusInfo.status === 'idle') && <div className="flex justify-center"><Loader /></div> }

            { !isWorking && newVersionInfo && (
                <ChangelogDisplay info={newVersionInfo} />
            )}

            { !isWorking && !newVersionInfo && currentVersionInfo && (
                <VersionInfoDisplay title="Current Version" info={currentVersionInfo} />
            )}
            
             <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-8">
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-4">Application Backups</h3>
                 {backups.length > 0 ? (
                    <ul className="space-y-2">
                        {backups.map(backup => (
                            <li key={backup} className="bg-slate-100 dark:bg-slate-700/50 p-3 rounded-md flex justify-between items-center">
                                <span className="font-mono text-sm text-slate-800 dark:text-slate-300">{backup}</span>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => handleRollback(backup)} disabled={isWorking} className="px-3 py-1 text-sm bg-sky-600 hover:bg-sky-500 text-white rounded-md font-semibold disabled:opacity-50">
                                        Restore
                                    </button>
                                    <button onClick={() => handleDeleteBackup(backup)} disabled={isWorking} className="p-2 text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 rounded-md disabled:opacity-50" title="Delete Backup">
                                        {isDeleting === backup ? <Loader /> : <TrashIcon className="h-4 w-4" />}
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                 ) : (
                    <p className="text-slate-500 dark:text-slate-500 text-center py-4">No application backups found. A backup is automatically created before an update.</p>
                 )}
            </div>
        </div>
    );
};