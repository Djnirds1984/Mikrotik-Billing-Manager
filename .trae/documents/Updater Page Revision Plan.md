## Comprehensive Updater Page Revision Plan

Based on my analysis of the current codebase, here's the detailed implementation plan for the requested improvements:

### Current State Analysis
- **Existing UI**: Clean, modern design with Tailwind CSS, dark/light mode support
- **Current Functionality**: Mock update status, backup management, version display
- **Missing**: Real GitHub integration, repository/branch selection, pull functionality

### Implementation Plan

#### 1. Enhanced GitHub Repository Fetching
**Backend Changes (proxy/server.js):**
- Add new endpoints: `/api/github/repo-info`, `/api/github/branches`, `/api/github/pull`
- Implement proper GitHub API integration with authentication
- Add comprehensive error handling for network failures, invalid repos, API limits
- Implement loading states and timeout handling

**Frontend Changes (Updater.tsx):**
- Replace mock `streamUpdateStatus` with real GitHub API calls
- Add loading indicators during fetch operations
- Display user-friendly error messages for different failure scenarios
- Implement retry mechanisms for failed requests

#### 2. Repository URL Input Field
**New Component Features:**
- Text input with GitHub URL validation (HTTPS and SSH formats)
- Real-time URL format validation with visual feedback
- Persistent storage using localStorage/sessionStorage
- Support for both `https://github.com/owner/repo` and `git@github.com:owner/repo.git` formats
- Auto-detection and conversion between formats

**UI Integration:**
- Match existing input styling (rounded borders, focus states, dark mode)
- Add tooltip explaining supported formats
- Implement responsive design for mobile devices

#### 3. Branch Selection Input
**New Component Features:**
- Dropdown populated with available branches from GitHub API
- Default to "main" branch with fallback to "master"
- Branch existence validation before operations
- User preference persistence across sessions
- Quick-switch capability for common branches

**Validation & Error Handling:**
- Verify branch exists before pull operations
- Handle cases where default branch doesn't exist
- Provide clear feedback for invalid branch selections

#### 4. Pull Functionality Implementation
**New Backend Endpoint:**
- `/api/github/pull` - Execute git pull with specified repo and branch
- Progress tracking with streaming updates
- Error handling for merge conflicts, network issues, authentication failures
- Backup creation before pull operations

**Frontend Integration:**
- "Pull from Repository" button with loading states
- Progress indicators showing pull status
- Success/error notifications with detailed feedback
- Integration with existing log viewer for real-time updates

#### 5. UI/UX Enhancements
**Styling Consistency:**
- Match existing color scheme (slate/primary colors)
- Maintain consistent spacing and typography
- Implement proper focus states and hover effects
- Ensure dark mode compatibility

**Responsive Design:**
- Mobile-first approach for new input fields
- Proper stacking on smaller screens
- Touch-friendly button sizes
- Maintained usability across all device sizes

#### 6. Tooltips and Help Text
**Implementation:**
- Info icons next to each new field
- Hover tooltips explaining field purposes
- Inline validation messages
- Contextual help for error states

#### 7. Testing Strategy
**Unit Tests:**
- URL validation functions
- Branch selection logic
- Error handling scenarios
- GitHub API integration
- Local storage persistence

**Integration Tests:**
- End-to-end pull operations
- Error recovery flows
- UI state management
- Responsive behavior

### Technical Implementation Details

#### New Service Functions (updaterService.ts):
```typescript
export const getRepositoryInfo = (repoUrl: string) => fetchData<any>(`/api/github/repo-info?url=${encodeURIComponent(repoUrl)}`);
export const getBranches = (repoUrl: string) => fetchData<string[]>(`/api/github/branches?url=${encodeURIComponent(repoUrl)}`);
export const pullFromRepository = (repoUrl: string, branch: string) => fetchData('/api/github/pull', {
    method: 'POST',
    body: JSON.stringify({ repoUrl, branch }),
});
```

#### New State Management:
```typescript
const [repositoryUrl, setRepositoryUrl] = useState('');
const [selectedBranch, setSelectedBranch] = useState('main');
const [isLoadingRepo, setIsLoadingRepo] = useState(false);
const [branches, setBranches] = useState<string[]>([]);
const [repoError, setRepoError] = useState('');
```

#### Enhanced Error Handling:
- Network timeout handling (30s default)
- GitHub API rate limit detection
- Invalid repository/branch validation
- Authentication error handling
- Graceful degradation for offline scenarios

### File Modifications Required:
1. **components/Updater.tsx** - Major rewrite with new UI components
2. **services/updaterService.ts** - Add new GitHub API functions
3. **proxy/server.js** - Add new backend endpoints
4. **types.ts** - Add new interface definitions
5. **locales/en.json** - Add new translation keys

### Security Considerations:
- Input sanitization for repository URLs
- Rate limiting for GitHub API calls
- Authentication token protection
- Path traversal prevention in file operations

This comprehensive plan ensures all requested features are implemented with proper error handling, responsive design, and testing coverage while maintaining consistency with the existing codebase architecture and styling patterns.