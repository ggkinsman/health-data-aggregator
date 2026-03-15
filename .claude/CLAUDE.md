# Health Data Aggregator

Personal health data aggregation tool combining Oura Ring, Apple Health, and CPAP data.

## Technical Stack
- TypeScript with vitest for testing
- SQLite (better-sqlite3) for local data storage
- Oura Cloud API v2 (OAuth2 authentication)
- Apple Health XML exports (manual for now)
- CPAP data via OSCAR/STR.edf SD card reader
- AES-256-GCM encryption for token storage

## Project Structure
- `src/oura/` — Oura API client, auth, types (9 endpoints)
- `src/apple-health/` — Apple Health XML parser, repository, types
- `src/unified/` — Unified schema: daily summary builder, SQL views, activity type normalization
- `src/db/` — SQLite database layer, migrations (V1: Oura, V2: Apple Health, V3: unified schema, V4: CPAP sessions, V5: CPAP device settings)
- `src/storage/` — Encrypted token storage
- `src/pipeline/` — Health researcher multi-agent pipeline (orchestrator, data context, code executor, session memory)
- `src/cpap/` — CPAP STR.edf parser, repository, types (CPAPSession, CPAPDeviceSettings)
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
- `npm run health:ask -- "question"` — Interactive health data analysis (flags: `--continue`, `--show-review`)
- `npm run import:cpap` — Import CPAP data from ResMed SD card STR.edf
- `npm run health:report -- daily|weekly` — Generate automated health report (uses Anthropic API)
- `/health-report daily|weekly` — Generate report locally in Claude Code (no API cost, queries SQLite directly)

## Automated Sync
- launchd job: `com.health-data-aggregator.oura-sync` (9 AM / 8 PM)
- Plist: `~/Library/LaunchAgents/com.health-data-aggregator.oura-sync.plist`
- Logs: `~/Library/Logs/health-data-oura-sync.log`
- Wrapper: `scripts/run-sync.sh` (also rebuilds last 7 days of daily summaries)
- launchd job: `com.health-data-aggregator.daily-report` (9:30 AM daily briefing)
- launchd job: `com.health-data-aggregator.weekly-report` (Sunday 6 PM deep dive)
- Reports saved to: `reports/daily/` and `reports/weekly/`
- Pipeline logs: `~/Library/Logs/health-pipeline.log`

## Workout Deduplication
- Apple Watch is the trusted HealthKit workout source (`source_name LIKE '%Watch%'`)
- Third-party HealthKit sources (Peloton, Strava, Oura) are excluded to avoid duplicates
- Oura auto-detected walks are excluded — only explicitly-tracked Oura activities count
- Oura workouts that time-overlap with Apple Watch workouts are discarded (Apple Watch wins)
- Oura workouts without timestamps are kept (can't prove overlap)

## Pipeline Cost Guardrails
- Token budget: 50,000 tokens per run (default) — pipeline aborts if exceeded
- Override via `maxTokenBudget` in PipelineConfig
- Cost estimate shown after each run (based on Sonnet/Haiku pricing)
- Estimated cost: ~$0.05–0.15 per interactive query, ~$2–5/month with scheduled reports
- Uses Anthropic API credits (ANTHROPIC_API_KEY in .env), not Claude Max subscription
- Model pricing defined in `src/pipeline/orchestrator.ts` — update if models change

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

## DoxGPT Verification
- Report templates include a "Verify with DoxGPT" section generating copy-paste-ready medical fact-check questions
- Every question must be fully self-contained with patient profile, specific numbers, and the claim being validated
- Patient context: 32-year-old male, severe OSA (pAHI 50 baseline), on APAP since July 2025

## CPAP Device Settings
- `cpap_device_settings` table tracks pressure range changes over time
- Join to sessions: `c.day BETWEEN s.start_date AND s.end_date`
- Currently 3 settings periods seeded from OSCAR (Jul 2025 – Mar 2026)

## Security Requirements
- API tokens and secrets go in `.env` only
- All personal health data must be in gitignored directories
- Never commit personal data or credentials
