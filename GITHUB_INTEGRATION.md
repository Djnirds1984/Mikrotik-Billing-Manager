# GitHub Integration for Updater Page

This document describes the new GitHub integration features added to the updater page.

## Features Implemented

### 1. GitHub Repository URL Input
- **Field**: "Git Repository URL" with validation
- **Formats Supported**: 
  - HTTPS: `https://github.com/owner/repo`
  - SSH: `git@github.com:owner/repo.git`
- **Validation**: Real-time URL format validation with visual feedback
- **Persistence**: URL is saved to localStorage for future sessions
- **Error Handling**: Clear error messages for invalid formats

### 2. Branch Selection
- **Field**: "Target Branch" dropdown
- **Default**: Automatically selects "main" or "master" branch
- **Dynamic Loading**: Populates with available branches from the repository
- **Validation**: Validates branch existence before operations
- **Persistence**: Selected branch is saved to localStorage

### 3. Pull Functionality
- **Button**: "Pull from Repository" with loading states
- **Progress Indicators**: Real-time status updates during pull operations
- **Streaming**: Uses Server-Sent Events for real-time progress updates
- **Error Handling**: Comprehensive error messages for various failure scenarios
- **Success Feedback**: Clear success messages with change statistics

### 4. Enhanced Error Handling
- **Network Errors**: Handles connection failures and timeouts
- **Repository Errors**: Handles invalid repositories, authentication issues
- **Branch Errors**: Handles invalid branch selections
- **Pull Errors**: Handles merge conflicts, network issues during pull

### 5. UI/UX Improvements
- **Tooltips**: Help icons with explanatory text for each field
- **Responsive Design**: Mobile-friendly layout for all new elements
- **Loading States**: Visual feedback during all operations
- **Consistent Styling**: Matches existing application design patterns
- **Dark Mode Support**: Full dark mode compatibility

### 6. Internationalization (i18n)
- **Translation Keys**: All UI text uses translation system
- **Fallback Support**: English fallbacks for missing translations
- **Extensible**: Easy to add new languages

## API Endpoints Added

### Backend (proxy/server.js)
- `GET /api/github/repo-info` - Get repository information
- `GET /api/github/branches` - Get available branches
- `POST /api/github/pull` - Pull from repository (non-streaming)
- `GET /api/github/pull-stream` - Pull from repository (streaming)

### Frontend Services (services/updaterService.ts)
- `parseGitHubUrl()` - URL parsing and validation
- `getRepositoryInfo()` - Fetch repository information
- `getBranches()` - Fetch available branches
- `streamPullFromRepository()` - Streaming pull functionality

## New Types Added (types.ts)
- `GitHubRepository` - Repository information structure
- `GitHubBranch` - Branch information structure
- `GitHubPullResult` - Pull operation result structure

## Testing

### Unit Tests
- **URL Parsing**: Comprehensive tests for GitHub URL parsing
- **Validation**: Tests for URL format validation
- **Error Handling**: Tests for various error scenarios

### Integration Tests
- **Component Tests**: Full component testing with React Testing Library
- **User Interactions**: Tests for user input and form validation
- **State Management**: Tests for localStorage persistence
- **Error Scenarios**: Tests for error message display

## Usage Instructions

1. **Enter Repository URL**: 
   - Paste your GitHub repository URL in the "Git Repository URL" field
   - Supports both HTTPS and SSH formats
   - URL is automatically validated and saved

2. **Select Branch**:
   - The dropdown will populate with available branches
   - Defaults to "main" or "master" if available
   - Selection is automatically saved

3. **Pull Updates**:
   - Click "Pull from Repository" to fetch latest changes
   - Monitor progress in the log viewer
   - Success/error messages will appear automatically

## Configuration

### Environment Variables (for production)
- `GITHUB_TOKEN` - Personal access token for GitHub API (optional, for private repos)
- `GITHUB_API_BASE_URL` - GitHub API base URL (defaults to https://api.github.com)

### Local Storage Keys
- `updaterRepositoryUrl` - Saved repository URL
- `updaterBranch` - Saved branch selection

## Security Considerations

- **Input Sanitization**: All user inputs are sanitized before processing
- **URL Validation**: Strict validation prevents path traversal attacks
- **Rate Limiting**: GitHub API calls are rate-limited to prevent abuse
- **Authentication**: Uses existing application authentication

## Future Enhancements

- **GitHub Token Management**: UI for managing GitHub personal access tokens
- **Private Repository Support**: Enhanced authentication for private repos
- **Branch Protection**: Visual indicators for protected branches
- **Release Notes**: Display release notes and changelogs
- **Rollback Functionality**: Easy rollback to previous versions
- **Webhook Integration**: Automatic updates via GitHub webhooks

## Files Modified

### Core Files
- `components/Updater.tsx` - Enhanced with new GitHub integration
- `services/updaterService.ts` - New GitHub API functions
- `proxy/server.js` - New backend endpoints
- `types.ts` - New type definitions
- `locales/en.json` - New translation keys

### Test Files
- `services/__tests__/updaterService.test.ts` - Unit tests for URL parsing
- `src/__tests__/Updater.test.tsx` - Component integration tests

### Configuration Files
- `package.json` - Added testing dependencies
- `vitest.config.ts` - Test configuration
- `src/test-setup.ts` - Test setup file

## Troubleshooting

### Common Issues

1. **"Invalid GitHub repository URL format"**
   - Ensure URL follows the correct format
   - Check for typos in the URL
   - Verify repository exists and is accessible

2. **"Failed to fetch branches"**
   - Check network connectivity
   - Verify repository is public or you have access
   - Check GitHub API rate limits

3. **"Pull operation failed"**
   - Check for merge conflicts
   - Verify branch exists and is accessible
   - Check network connectivity during operation

### Debug Information
- Check browser console for detailed error messages
- Monitor network tab for API call failures
- Review application logs for backend errors