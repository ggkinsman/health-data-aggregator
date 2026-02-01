# Health Data Aggregator

Personal health data aggregation tool combining Apple Health and Oura Ring data.

## Technical Stack
- TypeScript with vitest for testing
- Oura Cloud API (OAuth2 authentication)
- Apple Health XML exports (manual for now)
- AES-256-GCM encryption for token storage

## File Organization
- `src/` — Application source code
- `data/` — Local health data storage (gitignored)
- `.env` — Secrets and API tokens (gitignored)

## Issue Workflow
- Labels: `spike` (research), `ready` (scoped), `blocked` (waiting)
- Each issue needs: Context, Requirements, Technical Notes, Acceptance Criteria
- Close issues with commit messages: `closes #N`

## Code Standards
- Handle API failures gracefully
- Explain "why" not "what" in comments
- Manual testing is fine for this solo project
- Keep the root directory clean

## Security Requirements
- API tokens and secrets go in `.env` only
- All personal health data must be in gitignored directories
- Never commit personal data or credentials
