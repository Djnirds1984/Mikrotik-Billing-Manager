import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Updater } from '../components/Updater.tsx';

// Mock the services
vi.mock('../services/updaterService.ts', () => ({
    getCurrentVersion: vi.fn().mockResolvedValue({
        title: 'v1.0.0',
        description: 'Current version',
        hash: 'abc123',
        remoteUrl: 'https://github.com/test/repo'
    }),
    listBackups: vi.fn().mockResolvedValue(['backup1.tar.gz', 'backup2.tar.gz']),
    deleteBackup: vi.fn(),
    streamUpdateStatus: vi.fn(),
    streamUpdateApp: vi.fn(),
    streamRollbackApp: vi.fn(),
    parseGitHubUrl: vi.fn((url) => {
        if (url.includes('github.com')) {
            return {
                owner: 'test',
                repo: 'repo',
                url: url,
                isValid: true
            };
        }
        return null;
    }),
    getRepositoryInfo: vi.fn().mockResolvedValue({
        owner: 'test',
        repo: 'repo',
        description: 'Test repository',
        defaultBranch: 'main'
    }),
    getBranches: vi.fn().mockResolvedValue([
        { name: 'main', protected: true, sha: 'abc123' },
        { name: 'develop', protected: false, sha: 'def456' }
    ]),
    streamPullFromRepository: vi.fn()
}));

describe('Updater Component', () => {
    beforeEach(() => {
        // Clear localStorage before each test
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('should render the updater component', () => {
        render(<Updater />);
        
        expect(screen.getByText('Panel Updater')).toBeInTheDocument();
        expect(screen.getByText('Check for Updates')).toBeInTheDocument();
    });

    it('should load saved repository URL and branch from localStorage', () => {
        localStorage.setItem('updaterRepositoryUrl', 'https://github.com/test/repo');
        localStorage.setItem('updaterBranch', 'develop');
        
        render(<Updater />);
        
        // Wait for the component to load
        waitFor(() => {
            const urlInput = screen.getByLabelText('Git Repository URL') as HTMLInputElement;
            const branchSelect = screen.getByLabelText('Target Branch') as HTMLSelectElement;
            
            expect(urlInput.value).toBe('https://github.com/test/repo');
            expect(branchSelect.value).toBe('develop');
        });
    });

    it('should validate repository URL format', async () => {
        render(<Updater />);
        
        const urlInput = screen.getByLabelText('Git Repository URL') as HTMLInputElement;
        
        // Test invalid URL
        fireEvent.change(urlInput, { target: { value: 'https://gitlab.com/test/repo' } });
        
        await waitFor(() => {
            expect(screen.getByText('Invalid GitHub repository URL format. Use: https://github.com/owner/repo')).toBeInTheDocument();
        });
        
        // Test valid URL
        fireEvent.change(urlInput, { target: { value: 'https://github.com/test/repo' } });
        
        await waitFor(() => {
            expect(screen.queryByText('Invalid GitHub repository URL format')).not.toBeInTheDocument();
        });
    });

    it('should enable pull button when repository and branch are selected', async () => {
        render(<Updater />);
        
        const urlInput = screen.getByLabelText('Git Repository URL') as HTMLInputElement;
        const pullButton = screen.getByText('Pull from Repository').closest('button') as HTMLButtonElement;
        
        // Initially disabled
        expect(pullButton.disabled).toBe(true);
        
        // Enter valid repository URL
        fireEvent.change(urlInput, { target: { value: 'https://github.com/test/repo' } });
        
        await waitFor(() => {
            // Button should be enabled after repository is loaded
            expect(pullButton.disabled).toBe(false);
        });
    });

    it('should show loading states during operations', async () => {
        render(<Updater />);
        
        const urlInput = screen.getByLabelText('Git Repository URL') as HTMLInputElement;
        
        // Enter repository URL to trigger loading
        fireEvent.change(urlInput, { target: { value: 'https://github.com/test/repo' } });
        
        await waitFor(() => {
            // Check for loading indicators
            expect(screen.getByText('Loading branches...')).toBeInTheDocument();
        });
    });

    it('should handle branch selection changes', async () => {
        render(<Updater />);
        
        const urlInput = screen.getByLabelText('Git Repository URL') as HTMLInputElement;
        
        // Enter repository URL
        fireEvent.change(urlInput, { target: { value: 'https://github.com/test/repo' } });
        
        await waitFor(() => {
            const branchSelect = screen.getByLabelText('Target Branch') as HTMLSelectElement;
            
            // Change branch selection
            fireEvent.change(branchSelect, { target: { value: 'develop' } });
            
            expect(branchSelect.value).toBe('develop');
            expect(localStorage.getItem('updaterBranch')).toBe('develop');
        });
    });

    it('should show repository connection success', async () => {
        render(<Updater />);
        
        const urlInput = screen.getByLabelText('Git Repository URL') as HTMLInputElement;
        
        // Enter valid repository URL
        fireEvent.change(urlInput, { target: { value: 'https://github.com/test/repo' } });
        
        await waitFor(() => {
            expect(screen.getByText('✓ Connected to test/repo - Test repository')).toBeInTheDocument();
        });
    });

    it('should persist repository URL to localStorage', async () => {
        render(<Updater />);
        
        const urlInput = screen.getByLabelText('Git Repository URL') as HTMLInputElement;
        
        // Enter repository URL
        fireEvent.change(urlInput, { target: { value: 'https://github.com/test/repo' } });
        
        await waitFor(() => {
            expect(localStorage.getItem('updaterRepositoryUrl')).toBe('https://github.com/test/repo');
        });
    });

    it('should show pull button in loading state during pull operation', async () => {
        render(<Updater />);
        
        const urlInput = screen.getByLabelText('Git Repository URL') as HTMLInputElement;
        const pullButton = screen.getByText('Pull from Repository').closest('button') as HTMLButtonElement;
        
        // Setup repository
        fireEvent.change(urlInput, { target: { value: 'https://github.com/test/repo' } });
        
        await waitFor(() => {
            expect(pullButton.disabled).toBe(false);
        });
        
        // Click pull button
        fireEvent.click(pullButton);
        
        await waitFor(() => {
            expect(screen.getByText('Pulling...')).toBeInTheDocument();
            expect(pullButton.disabled).toBe(true);
        });
    });

    it('should display error messages appropriately', async () => {
        render(<Updater />);
        
        const urlInput = screen.getByLabelText('Git Repository URL') as HTMLInputElement;
        
        // Test repository error
        fireEvent.change(urlInput, { target: { value: 'invalid-url' } });
        
        await waitFor(() => {
            expect(screen.getByText('Invalid GitHub repository URL format. Use: https://github.com/owner/repo')).toBeInTheDocument();
        });
    });

    it('should have proper responsive design classes', () => {
        render(<Updater />);
        
        // Check that inputs have responsive classes
        const urlInput = screen.getByLabelText('Git Repository URL');
        expect(urlInput).toHaveClass('w-full');
        
        const branchSelect = screen.getByLabelText('Target Branch');
        expect(branchSelect).toHaveClass('w-full');
    });

    it('should have proper styling for different states', async () => {
        render(<Updater />);
        
        const urlInput = screen.getByLabelText('Git Repository URL') as HTMLInputElement;
        
        // Test error state styling
        fireEvent.change(urlInput, { target: { value: 'invalid-url' } });
        
        await waitFor(() => {
            expect(urlInput).toHaveClass('border-red-500');
        });
        
        // Test valid state styling
        fireEvent.change(urlInput, { target: { value: 'https://github.com/test/repo' } });
        
        await waitFor(() => {
            expect(urlInput).not.toHaveClass('border-red-500');
            expect(urlInput).toHaveClass('border-slate-300');
        });
    });
});