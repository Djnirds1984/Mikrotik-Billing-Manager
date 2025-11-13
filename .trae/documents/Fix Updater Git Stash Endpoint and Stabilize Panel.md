## Findings
- Updater page already includes a "Git Stash" button that calls `POST /api/git/stash` via `services/updaterService.ts`.
- Backend currently has no `/api/git/:command` route, so the button will fail (404).
- `services/updaterService.ts` defines `executeGitCommand` twice, which can cause build errors.
- Frontend Telegram logic is now log-only (no axios in browser), and backend has `telegram-endpoint.js` but it is not integrated into `server.js`.

## Changes to Implement
1. Backend: Add `/api/git/:command` endpoint in `api-backend/server.js`.
- Allowlist commands: `stash`, `status`, `log`, `pull`, `push`.
- Execute with `child_process.exec` using `cwd: path.resolve(__dirname, '..')` to run at the project root (works on Windows).
- Map outputs to JSON: `{ success, message, output, error }` with clear messages for no local changes and timeouts.
- Require and forward existing `Authorization` header checks if present (reuse current auth pattern), and keep CORS/JSON setup unchanged.

2. Frontend: Fix `services/updaterService.ts` duplicate export.
- Remove the second `export const executeGitCommand` and keep a single definition.

3. Backend (optional): Integrate Telegram test endpoint.
- Move the code from `api-backend/telegram-endpoint.js` into `server.js` (or `require` it) so `/api/telegram/test` works from the panel.

## Validation
- Start backend (`node api-backend/server.js`) and confirm it runs without errors.
- Test endpoints manually:
  - `POST /api/git/status` → returns current status output.
  - Make a local change, then `POST /api/git/stash` → returns success message; re-run `status` to verify clean state.
- Open the Updater page and click "Git Stash"; confirm success/failure messages and that the page stays responsive (no white screen).

## Rollback/Safety
- No destructive operations beyond `git stash`.
- Endpoint is restricted to a safe command allowlist and robust error handling.
- Avoid creating new files beyond what is necessary; only edit existing files as described.

Please confirm, and I will implement these changes and verify end-to-end.