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

## In Progress
- CPAP/OSCAR integration — blocked on prerequisites (see docs/plans/cpap-oscar-integration.md)
  - Waiting on: SD card purchase, HIPAA data requests sent 2026-03-12

## Next Up
- ⏭️ Build Apple Health XML export parser
- ⏭️ CPAP/OSCAR reader (once SD card + OSCAR setup complete)
- ⏭️ Historical CPAP data parser (if HIPAA request returns CSV/Excel)
- ⏭️ Define unified health data schema
- ⏭️ Create data aggregation/merging logic

## Key Decisions
- Using TypeScript (switched from initial Python plan)
- AES-256-GCM encryption for token storage
- OAuth2 required (Personal Access Tokens deprecated end of 2025)
- Manual Apple Health exports for now (no iOS app)
- SQLite for local data storage with upsert-based sync
- CPAP data via OSCAR (reads ResMed SD card) — not myAir API

## Data Sources
| Source | Method | Status |
|--------|--------|--------|
| Oura Ring | OAuth2 API + incremental sync | ✅ Working |
| Apple Health | XML export parsing | ⏭️ Not started |
| CPAP (ResMed AirSense 11) | OSCAR data reader | Blocked on setup |
