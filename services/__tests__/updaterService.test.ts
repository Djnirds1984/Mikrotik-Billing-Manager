import { describe, it, expect } from 'vitest';
import { parseGitHubUrl } from '../updaterService.ts';
import type { GitHubRepository } from '../../types.ts';

describe('parseGitHubUrl', () => {
    it('should parse valid HTTPS GitHub URLs', () => {
        const testCases = [
            {
                input: 'https://github.com/owner/repo',
                expected: {
                    owner: 'owner',
                    repo: 'repo',
                    url: 'https://github.com/owner/repo',
                    isValid: true
                }
            },
            {
                input: 'https://github.com/user/my-awesome-project',
                expected: {
                    owner: 'user',
                    repo: 'my-awesome-project',
                    url: 'https://github.com/user/my-awesome-project',
                    isValid: true
                }
            },
            {
                input: 'https://github.com/company/enterprise-app.git',
                expected: {
                    owner: 'company',
                    repo: 'enterprise-app',
                    url: 'https://github.com/company/enterprise-app.git',
                    isValid: true
                }
            },
            {
                input: 'http://github.com/test/test-repo',
                expected: {
                    owner: 'test',
                    repo: 'test-repo',
                    url: 'http://github.com/test/test-repo',
                    isValid: true
                }
            }
        ];

        testCases.forEach(({ input, expected }) => {
            const result = parseGitHubUrl(input);
            expect(result).toEqual(expected);
        });
    });

    it('should parse valid SSH GitHub URLs', () => {
        const testCases = [
            {
                input: 'git@github.com:owner/repo.git',
                expected: {
                    owner: 'owner',
                    repo: 'repo',
                    url: 'https://github.com/owner/repo',
                    isValid: true
                }
            },
            {
                input: 'git@github.com:user/my-project.git',
                expected: {
                    owner: 'user',
                    repo: 'my-project',
                    url: 'https://github.com/user/my-project',
                    isValid: true
                }
            },
            {
                input: 'git@github.com:company/enterprise.git',
                expected: {
                    owner: 'company',
                    repo: 'enterprise',
                    url: 'https://github.com/company/enterprise',
                    isValid: true
                }
            }
        ];

        testCases.forEach(({ input, expected }) => {
            const result = parseGitHubUrl(input);
            expect(result).toEqual(expected);
        });
    });

    it('should return null for invalid URLs', () => {
        const invalidUrls = [
            'https://gitlab.com/owner/repo',
            'https://bitbucket.org/owner/repo',
            'https://github.com/',
            'https://github.com/owner',
            'https://github.com',
            'not-a-url',
            '',
            'git@gitlab.com:owner/repo.git',
            'https://github.com/owner/repo/extra/path',
            'https://github.com/owner/repo.git/extra'
        ];

        invalidUrls.forEach(url => {
            const result = parseGitHubUrl(url);
            expect(result).toBeNull();
        });
    });

    it('should handle edge cases gracefully', () => {
        // Test with special characters in owner/repo names
        const result1 = parseGitHubUrl('https://github.com/user-name/repo_name');
        expect(result1).toEqual({
            owner: 'user-name',
            repo: 'repo_name',
            url: 'https://github.com/user-name/repo_name',
            isValid: true
        });

        // Test with numbers
        const result2 = parseGitHubUrl('https://github.com/user123/repo456');
        expect(result2).toEqual({
            owner: 'user123',
            repo: 'repo456',
            url: 'https://github.com/user123/repo456',
            isValid: true
        });

        // Test with dots in repo name
        const result3 = parseGitHubUrl('https://github.com/owner/my.repo.name');
        expect(result3).toEqual({
            owner: 'owner',
            repo: 'my.repo.name',
            url: 'https://github.com/owner/my.repo.name',
            isValid: true
        });
    });

    it('should handle malformed URLs without throwing errors', () => {
        const malformedUrls = [
            'github.com/owner/repo', // Missing protocol
            'https://github.com', // Missing owner and repo
            'https://github.com/', // Missing owner and repo
            'https://github.com/owner/', // Missing repo
            'git@github.com', // Missing owner and repo
            'git@github.com:', // Missing owner and repo
            'git@github.com:owner', // Missing repo
            'git@github.com:owner/', // Missing repo
        ];

        malformedUrls.forEach(url => {
            expect(() => parseGitHubUrl(url)).not.toThrow();
            expect(parseGitHubUrl(url)).toBeNull();
        });
    });
});