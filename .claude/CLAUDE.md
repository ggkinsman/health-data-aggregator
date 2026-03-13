# Health Data Aggregator

Personal health data aggregation tool combining Oura Ring, Apple Health, and CPAP data.

## Technical Stack
- TypeScript with vitest for testing
- SQLite (better-sqlite3) for local data storage
- Oura Cloud API v2 (OAuth2 authentication)
- Apple Health XML exports (manual for now)
- CPAP data via OSCAR (planned)
- AES-256-GCM encryption for token storage

## Project Structure
- `src/oura/` — Oura API client, auth, types (9 endpoints)
- `src/db/` — SQLite database layer, migrations, Oura repository
- `src/storage/` — Encrypted token storage
- `src/cpap/` — CPAP data reader (planned)
- `scripts/` — CLI scripts (sync-oura, auth-oura)
- `data/` — Local health data storage (gitignored)
- `docs/plans/` — Implementation plans

## Commands
- `npm test` — Run vitest
- `npm run test:run` — Run tests once
- `npm run build` — TypeScript compilation
- `npm run auth:oura` — One-time OAuth2 setup
- `npm run sync:oura` — Incremental Oura data sync

## Automated Sync
- launchd job: `com.health-data-aggregator.oura-sync` (9 AM / 8 PM)
- Plist: `~/Library/LaunchAgents/com.health-data-aggregator.oura-sync.plist`
- Logs: `~/Library/Logs/health-data-oura-sync.log`
- Wrapper: `scripts/run-sync.sh`

## Oura API Gotchas
- Heart rate endpoint is `/heartrate` (no underscore), not `/heart_rate`
- `/personal_info` returns data directly (not wrapped in `{ data: ... }` like other endpoints)

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
