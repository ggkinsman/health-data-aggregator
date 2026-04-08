# Project Progress

## Completed
- ✅ Issue #1: Research data export options (Apple Health + Oura API)
- ✅ Issue #2: Implement Oura OAuth2 authentication flow
- ✅ Issue #3: Security hardening for OAuth2 token storage
- ✅ Issue #4: Oura data fetching client with all 9 API endpoints, TypeScript types, error handling, and 15 passing tests
- ✅ SQLite database layer with schema migrations and Oura repository (upserts, sync tracking)
- ✅ Incremental Oura sync script with pagination, rate limiting, and next_token support
- ✅ LaunchD wrapper for automated daily Oura sync
- ✅ OAuth helper script for one-time Oura authorization
- ✅ Initial Oura sync complete: 2,938+ records across 9 endpoints (2026-03-12)
- ✅ Automated launchd sync active at 9 AM / 8 PM (`com.health-data-aggregator.oura-sync`)
- ✅ Workflow documentation setup (.clinerules, .cursorrules, PROMPTS.md, issue templates)
- ✅ Apple Health XML parser: SAX streaming, V2 migration, 16 tests, `npm run import:apple` (2026-03-12)
- ✅ First Apple Health import: 1,478,425 records (1.3M HR, 105K sleep, 22K HRV, 2.6K resting HR, 2.7K workouts) (2026-03-12)
- ✅ Health researcher multi-agent pipeline (Dr. Hayden + 3 reviewers + self-reflection) (2026-03-13)
- ✅ Automated daily (9:30 AM) and weekly (Sunday 6 PM) health reports via launchd (2026-03-13)

- ✅ Workout deduplication: Apple Watch > Oura priority, excludes auto-walks and third-party HealthKit dupes (2026-03-13)
- ✅ Pipeline cost guardrails: 50K token budget cap, per-run cost estimates, fixed import.meta.dirname runtime bug (2026-03-13)

- ✅ CPAP database integration: STR.edf parser, V4 migration, import:cpap script, summary-builder CPAP fields — 241 nights imported (2026-03-15)
- ✅ CPAP device settings table (V5 migration): tracks pressure range changes from OSCAR, 3 settings periods seeded (2026-03-15)
- ✅ DoxGPT verification questions added to daily/weekly report templates + Dr. Hayden prompt (2026-03-15)
- ✅ `/health-report` slash command for local report generation without API costs (2026-03-15)
- ✅ CPAP leak rate tracking: V6 migration, gain*60 L/s→L/min conversion verified against OSCAR source (2026-03-16)
- ✅ CPAP import switched to OSCAR as single source of truth (no more SD card fallback) (2026-03-16)
- ✅ `/import-cpap` slash command for easy re-import after OSCAR upload (2026-03-16)
- ✅ HRV source interpretation: Oura nocturnal HRV suppressed by CPAP pressure (RSA dampening), Apple Watch daytime HRV is primary recovery signal — prompts + templates updated (2026-03-16)
- ✅ Travel trips table (V7 migration): 28 trips imported, correlates travel/alcohol with health metrics (2026-03-16)
- ✅ iMessage remote control: `claude --channels` listener in `~/Projects/inbox`, launchd-managed (`com.claude.imessage-listener`), KeepAlive on crash (2026-04-07)
- ✅ Telegram remote control: Gmini bot (`@glennmini_bot`), `claude --channels` listener, launchd-managed (`com.claude.telegram-listener`), KeepAlive on crash (2026-04-07)
- ✅ Proactive Telegram notifications: health reports (metric card + failure alert) and nightly improve jobs (branch + PR link + app screenshots) push to Gmini via `~/scripts/notify-telegram.sh` (2026-04-07)
- ✅ Telegram health card (`scripts/health-card.ts`): compact mobile-optimised metric card queried directly from SQLite — zero API cost, stale-data notes, empty sections suppressed (2026-04-07)

## In Progress
- Nothing active

## Next Up
- ⏭️ Historical CPAP data parser (if HIPAA request returns CSV/Excel)
- ⏭️ Function Health blood panel integration

## Key Decisions
- Using TypeScript (switched from initial Python plan)
- AES-256-GCM encryption for token storage
- OAuth2 required (Personal Access Tokens deprecated end of 2025)
- Manual Apple Health exports for now (no iOS app)
- SQLite for local data storage with upsert-based sync
- CPAP data via OSCAR (single source of truth) — not myAir API or direct SD card reads
- DoxGPT for medical fact-checking of pipeline interpretations (manual copy-paste, no API)
- Apple Watch daytime HRV is the primary autonomic recovery metric (Oura nocturnal HRV is suppressed by CPAP pressure)

## Data Sources
| Source | Method | Status |
|--------|--------|--------|
| Oura Ring | OAuth2 API + incremental sync | ✅ Working |
| Apple Health | XML export parsing | ✅ 1.48M records imported |
| CPAP (ResMed AirSense 11) | OSCAR backup STR.edf parser | ✅ 249 nights imported (incl. leak rate) |
| Travel Trips | CSV import | ✅ 28 trips (Jan 2025 – May 2026) |
