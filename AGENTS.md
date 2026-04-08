# Health Data Aggregator — Agent Instructions

## Project Overview
Local health data pipeline on Mac Mini. Aggregates data from Oura Ring, Apple Health, CPAP (ResMed via OSCAR), and travel trips into SQLite. Generates AI-powered health reports via Claude. No cloud services — all data stays on Mac Mini.

## Build & Run Commands
```bash
npm run test:run        # run Vitest tests (non-interactive)
npm run sync:oura       # incremental Oura Ring sync (paginated, rate-limited)
npm run import:apple    # import Apple Health XML export
npm run import:cpap     # import CPAP data from OSCAR backup
npm run import:travel   # import travel trips CSV
npm run build:summaries # rebuild DB summary tables
npm run health:report   # generate AI health report (costs tokens ~50K budget)
npm run health:ask      # one-off health data question
```

## Architecture
- **Storage:** SQLite (`data/health.db`) — local only, gitignored
- **Scripts:** `scripts/` — all sync, import, and report scripts (tsx)
- **Prompts:** `prompts/` — AI analysis prompt templates
- **Reports:** `reports/` — generated report outputs (markdown)
- No web server — pure CLI scripts. Runs as launchd jobs on Mac Mini.

## Data Sources
| Source | Method | Cadence |
|--------|--------|---------|
| Oura Ring | OAuth2 API + incremental sync | 9 AM / 8 PM daily (launchd) |
| Apple Health | XML export (manual) | Re-import as needed |
| CPAP (ResMed AirSense 11) | OSCAR backup STR.edf parser | Re-import after OSCAR upload (`npm run import:cpap`) |
| Travel Trips | CSV import | Manual when new trips added |

## Automated Jobs (launchd)
- `com.health-data-aggregator.oura-sync` — Oura sync at 9 AM / 8 PM
- Daily health report at 9:30 AM, weekly health report Sundays at 6 PM
- Reports trigger Telegram notification to Gmini bot (`@glennmini_bot`) via `~/scripts/notify-telegram.sh`:
  - Success: sends key metrics preview + full report .md attachment
  - Failure: sends alert with error context

## Telegram Listener Architecture (as of 2026-04-08)
- **Job:** `com.claude.telegram-listener` → `~/scripts/start-telegram-listener.sh`
- **Plugin:** official bun plugin (`--channels plugin:telegram@claude-plugins-official`)
- **Cycle:** 30-min backstop + 60s health check (3 failures → recycle). Was 5-min blind cycle.
- **Zombie cleanup:** `cleanup_channel_procs` kills stale bun processes before each new session and on EXIT
- **Pending upgrade:** `hdcd-telegram` v0.1.1 (Rust binary, no zombies) installed at `~/.local/bin/hdcd-telegram`. Blocked by `--dangerously-load-development-channels` requiring interactive TUI on every start — not viable for unattended daemons. NOTE: do NOT add hdcd-telegram to `~/Projects/inbox/.mcp.json` — it will load as a polling sidecar alongside the official plugin and split the Telegram update stream, breaking message delivery. Claude-intel watchlist will flag when the daemon-mode fix lands.
- **Troubleshoot:** If Gmini stops responding, check for zombie bun processes: `ps aux | grep "bun.*telegram" | grep -v grep`. Kill stale PIDs, or `launchctl unload/load com.claude.telegram-listener.plist`.

## Key Domain Decisions
- **Apple Watch daytime HRV** is the primary autonomic recovery metric. Oura nocturnal HRV is suppressed by CPAP pressure (RSA dampening) and should not be used for recovery signals.
- **OSCAR is the single source of truth for CPAP data** — not SD card direct reads or myAir API
- **Workout deduplication:** Apple Watch > Oura priority; auto-walks and third-party HealthKit dupes excluded
- **Max HR** configurable per user via env vars (`GLENN_MAX_HR`), defaults to 185 bpm
- **SQLite** chosen for local-only simplicity; upsert-based sync enables safe re-imports without duplicates
- **DoxGPT** used for medical fact-checking of pipeline interpretations (manual copy-paste, no API integration)

## AI Report Pipeline
Multi-agent system: Dr. Hayden (primary analyst) + 3 reviewers + self-reflection loop. Token budget: 50K cap per run with cost estimates logged. Templates in `prompts/`. Report outputs in `reports/`.

## Security
- OAuth2 tokens stored with AES-256-GCM encryption (Oura Personal Access Tokens deprecated end of 2025)
- All health data stays on Mac Mini — no cloud sync, no third-party uploads
