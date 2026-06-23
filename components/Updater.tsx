

import React, { useState, useEffect, useCallback } from 'react';
import { 
    getCurrentVersion, listBackups, deleteBackup, 
    streamUpdateStatus, streamUpdateApp, streamRollbackApp,
    listUpdateSnapshots, deleteUpdateSnapshot, streamRollbackUpdate,
    parseGitHubUrl, getRepositoryInfo, getBranches, streamPullFromRepository
} from '../services/updaterService.ts';
import type { UpdateSnapshot } from '../services/updaterService.ts';
import { getAppVersion, getMigrationStatus } from '../services/versionService.ts';
import type { MigrationStatus } from '../services/versionService.ts';
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

const VersionInfoDisplay: React.FC<{ title: string; info: VersionInfo; versionNumber?: string }> = ({ title, info, versionNumber }) => (
    <div>
        <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">{title}</h3>
        <div className="bg-slate-100 dark:bg-slate-900/50 p-4 rounded-lg space-y-3">
            {versionNumber && (
                <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">App Version</p>
                    <p className="text-lg font-semibold text-[--color-primary-500] dark:text-[--color-primary-400]">v{versionNumber}</p>
                </div>
            )}
            <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Build Info</p>
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
    const [updateSnapshots, setUpdateSnapshots] = useState<UpdateSnapshot[]>([]);
    const [isDeletingSnapshot, setIsDeletingSnapshot] = useState<string | null>(null);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [currentVersionInfo, setCurrentVersionInfo] = useState<VersionInfo | null>(null);
    const [appVersion, setAppVersion] = useState<string>('2.0.0');
    const [migrationStatus, setMigrationStatus] = useState<MigrationStatus | null>(null);
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

    const fetchUpdateSnapshots = useCallback(async () => {
        try {
            const data = await listUpdateSnapshots();
            setUpdateSnapshots(data);
        } catch (error) {
            console.error('Failed to fetch update snapshots:', error);
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
        fetchUpdateSnapshots();

        // Fetch app version
        getAppVersion().then(data => {
            setAppVersion(data.version);
        }).catch(() => {});

        // Fetch migration status
        getMigrationStatus().then(data => {
            setMigrationStatus(data);
        }).catch(() => {});
        
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

    const handleRollbackUpdate = (snapshot: UpdateSnapshot) => {
        const label = `${snapshot.timestamp || snapshot.id} (${(snapshot.prevCommit || '').slice(0, 7)})`;
        if (!window.confirm(`Roll back the entire application to snapshot ${label}?\n\nThis will:\n  • git reset --hard to commit ${(snapshot.prevCommit || '').slice(0, 7)}\n  • restore the database from ${snapshot.dbBackupFile || '(none)'}\n  • restore ${snapshot.capturedPaths.length} preserved file(s)\n  • reinstall dependencies + rebuild + restart\n\nA safety snapshot of the CURRENT state will be saved first.`)) return;

        setStatusInfo({ status: 'rollingback', message: `Rolling back update ${label}...` });
        setLogs([]);

        streamRollbackUpdate(snapshot.id, {
            onMessage: (data) => {
                if (data.log) setLogs(prev => [...prev, { text: data.log.trim(), isError: data.isError }]);
                if (data.status === 'restarting') {
                    setStatusInfo({ status: 'restarting', message: 'Rollback complete! Server is restarting...' });
                    setTimeout(() => window.location.reload(), 8000);
                }
                if (data.status === 'error') {
                    setStatusInfo({ status: 'error', message: data.message });
                }
            },
            onError: (err) => {
                setStatusInfo({ status: 'error', message: `Lost connection during rollback. ${err.message}` });
            },
        });
    };

    const handleDeleteUpdateSnapshot = async (id: string) => {
        if (!window.confirm(`Permanently delete update snapshot "${id}"? The matching DB backup will also be removed. This cannot be undone.`)) return;
        setIsDeletingSnapshot(id);
        try {
            await deleteUpdateSnapshot(id);
            await fetchUpdateSnapshots();
        } catch (error) {
            alert(`Error: ${(error as Error).message}`);
        } finally {
            setIsDeletingSnapshot(null);
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
                <VersionInfoDisplay title="Current Version" info={currentVersionInfo} versionNumber={appVersion} />
            )}
            
             <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-8">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">Update Snapshots (Full Rollback)</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Each update creates a snapshot containing the previous git commit, database, and user data. Use these to roll the entire application back to any earlier point if a bug is introduced.</p>
                    </div>
                    <button onClick={fetchUpdateSnapshots} disabled={isWorking} className="px-3 py-1 text-sm bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-md font-semibold disabled:opacity-50">Refresh</button>
                </div>
                {updateSnapshots.length > 0 ? (
                    <ul className="space-y-2">
                        {updateSnapshots.map(snap => (
                            <li key={snap.id} className="bg-slate-100 dark:bg-slate-700/50 p-3 rounded-md">
                                <div className="flex justify-between items-start gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-mono text-sm text-slate-800 dark:text-slate-200 truncate">{snap.timestamp || snap.id}</span>
                                            {snap.kind === 'pre-rollback-safety' && (
                                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100">SAFETY</span>
                                            )}
                                        </div>
                                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 space-x-3">
                                            <span>branch: <span className="font-mono">{snap.branch || '-'}</span></span>
                                            <span>commit: <span className="font-mono">{(snap.prevCommit || '-').slice(0, 7)}</span></span>
                                            <span>db: <span className="font-mono">{snap.dbBackupExists ? '✓' : '✗'}</span></span>
                                            <span>files: {snap.capturedPaths.length}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button onClick={() => handleRollbackUpdate(snap)} disabled={isWorking || !snap.prevCommit} className="px-3 py-1 text-sm bg-amber-600 hover:bg-amber-500 text-white rounded-md font-semibold disabled:opacity-50" title={snap.prevCommit ? 'Roll back code + DB + user data to this point' : 'No commit recorded'}>
                                            Rollback
                                        </button>
                                        <button onClick={() => handleDeleteUpdateSnapshot(snap.id)} disabled={isWorking} className="p-2 text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 rounded-md disabled:opacity-50" title="Delete Snapshot">
                                            {isDeletingSnapshot === snap.id ? <Loader /> : <TrashIcon className="h-4 w-4" />}
                                        </button>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-slate-500 dark:text-slate-500 text-center py-4">No update snapshots yet. The next update will create one automatically.</p>
                )}
            </div>

            {/* Database Migrations */}
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-8">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">Database Migrations</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            Schema version: <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{migrationStatus?.currentVersion || 'unknown'}</span>
                            {migrationStatus && migrationStatus.pendingMigrations.length > 0 && (
                                <span className="ml-2 text-amber-600 dark:text-amber-400">
                                    ({migrationStatus.pendingMigrations.length} pending)
                                </span>
                            )}
                        </p>
                    </div>
                </div>
                {migrationStatus && migrationStatus.appliedMigrations.length > 0 ? (
                    <ul className="space-y-2">
                        {migrationStatus.appliedMigrations.map((m, idx) => (
                            <li key={idx} className="bg-slate-100 dark:bg-slate-700/50 p-3 rounded-md">
                                <div className="flex justify-between items-center gap-3">
                                    <div>
                                        <span className="font-mono text-sm text-green-700 dark:text-green-400 font-semibold">{m.version}</span>
                                        <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">applied {new Date(m.applied_at).toLocaleString()}</span>
                                    </div>
                                    <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">{m.description}</span>
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-slate-500 dark:text-slate-500 text-center py-4">No migrations have been applied yet.</p>
                )}
                {migrationStatus && migrationStatus.pendingMigrations.length > 0 && (
                    <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
                        <p className="text-sm text-amber-800 dark:text-amber-400">
                            Pending migrations: {migrationStatus.pendingMigrations.join(', ')}
                        </p>
                        <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                            Migrations are applied automatically on server startup.
                        </p>
                    </div>
                )}
            </div>

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