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
- `src/apple-health/` — Apple Health XML parser, repository, types
- `src/unified/` — Unified schema: daily summary builder, SQL views, activity type normalization
- `src/db/` — SQLite database layer, migrations (V1: Oura, V2: Apple Health, V3: unified schema)
- `src/storage/` — Encrypted token storage
- `src/pipeline/` — Health researcher multi-agent pipeline (orchestrator, data context, code executor, session memory)
- `src/cpap/` — CPAP data reader (planned)
- `scripts/` — CLI scripts (sync-oura, auth-oura, import-apple-health, build-summaries, health-ask, health-report)
- `prompts/` — Agent system prompts (Dr. Hayden, 3 reviewers, self-reflection, report templates)
- `reports/` — Generated health reports and session memory (gitignored)
- `data/` — Local health data storage (gitignored)
- `docs/plans/` — Implementation plans

## Commands
- `npm test` — Run vitest
- `npm run test:run` — Run tests once
- `npm run build` — TypeScript compilation
- `npm run auth:oura` — One-time OAuth2 setup
- `npm run sync:oura` — Incremental Oura data sync
- `npm run import:apple` — Import Apple Health XML export
- `npm run build:summaries` — Build daily summary rollups (use `--days N` to limit)
- `npm run health:ask -- "question"` — Interactive health data analysis
- `npm run health:report -- daily|weekly` — Generate automated health report

## Automated Sync
- launchd job: `com.health-data-aggregator.oura-sync` (9 AM / 8 PM)
- Plist: `~/Library/LaunchAgents/com.health-data-aggregator.oura-sync.plist`
- Logs: `~/Library/Logs/health-data-oura-sync.log`
- Wrapper: `scripts/run-sync.sh` (also rebuilds last 7 days of daily summaries)
- launchd job: `com.health-data-aggregator.daily-report` (9:30 AM daily briefing)
- launchd job: `com.health-data-aggregator.weekly-report` (Sunday 6 PM deep dive)
- Reports saved to: `reports/daily/` and `reports/weekly/`
- Pipeline logs: `~/Library/Logs/health-pipeline.log`

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
