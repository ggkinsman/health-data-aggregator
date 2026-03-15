# CPAP Database Integration Design

**Date:** 2026-03-15
**Status:** Approved

## Goal

Parse ResMed AirSense 11 STR.edf summary data from the SD card and store it in the health database so the pipeline can query CPAP metrics alongside Oura and Apple Health data.

---

## Context

- Device: ResMed AirSense 11 AutoSet (serial: 23252139106)
- SD card inserted 2026-03-14; 241 nights of summary data available from 2025-07-11
- STR.edf contains nightly summary signals: AHI, event indices, pressure, respiratory rate, tidal volume, Cheyne-Stokes
- Leak rate signals are present but scaling is unverified until DATALOG session files are available (first full night: 2026-03-15)
- Import is manual — user plugs in SD card and runs `npm run import:cpap`

---

## Approach

Raw table + daily_summary pattern, matching how Oura and Apple Health are integrated.

- `cpap_sessions` table stores one row per night (source of truth)
- New columns added to `daily_summary` for pipeline-queryable metrics
- Idempotent: safe to re-run after each SD card sync

---

## Data Model

### New table: `cpap_sessions`

| Column | Type | Notes |
|---|---|---|
| `day` | TEXT PRIMARY KEY | YYYY-MM-DD |
| `usage_minutes` | INTEGER | Duration of therapy |
| `ahi` | REAL | Apnea-Hypopnea Index |
| `oai` | REAL | Obstructive Apnea Index |
| `cai` | REAL | Central Apnea Index |
| `hi` | REAL | Hypopnea Index |
| `uai` | REAL | Unclassified Apnea Index |
| `rin` | REAL | RERA Index |
| `mask_pressure_50` | REAL | 50th percentile mask pressure (cmH2O) |
| `mask_pressure_95` | REAL | 95th percentile mask pressure (cmH2O) |
| `resp_rate_50` | REAL | Median respiratory rate (breaths/min) |
| `tidal_vol_50` | REAL | Median tidal volume (L) |
| `min_vent_50` | REAL | Median minute ventilation (L/min) |
| `csr_minutes` | INTEGER | Cheyne-Stokes respiration duration |
| `mask_events` | INTEGER | Number of mask-on/off events |
| `imported_at` | TEXT | ISO timestamp of last import |

Leak columns excluded until EDF scaling is verified against DATALOG data.

### New columns in `daily_summary` (Migration V4)

| Column | Type | Notes |
|---|---|---|
| `cpap_ahi` | REAL | AHI for the night |
| `cpap_usage_minutes` | INTEGER | Therapy duration |
| `cpap_pressure_50` | REAL | Median mask pressure |
| `cpap_resp_rate` | REAL | Median respiratory rate |
| `cpap_cai` | REAL | Central apneas (clinically distinct from obstructive) |
| `cpap_csr_flagged` | INTEGER | 1 if Cheyne-Stokes detected, 0 otherwise |

---

## Components

```
src/cpap/
  types.ts          — CPAPSession interface
  edf-parser.ts     — reads STR.edf → CPAPSession[]
  repository.ts     — upserts cpap_sessions, updates daily_summary
  index.ts          — module exports

scripts/
  import-cpap.ts    — CLI entry point

src/db/migrations.ts — V4 migration
```

### Import flow

1. `npm run import:cpap` (optional: `-- /path/to/card`)
2. Parser reads `STR.edf` from SD card path
3. Returns `CPAPSession[]` (one per valid night with duration > 0)
4. Repository upserts all sessions into `cpap_sessions`
5. Repository updates matching rows in `daily_summary`; inserts row if missing

### SD card path resolution

1. CLI argument (if provided)
2. `CPAP_CARD_PATH` env var
3. Default: `/Volumes/NO NAME`

---

## Error Handling

| Scenario | Behavior |
|---|---|
| SD card not mounted | Clear error with expected path |
| STR.edf missing | Error — card may not have been in machine |
| Date parse failure for a night | Skip that night, log warning, continue |
| `daily_summary` row missing for a CPAP night | Insert the row (CPAP predates some Oura data) |

---

## Testing

Manual only — consistent with the rest of the project. Running `npm run import:cpap` against the real SD card is the integration test. Spot-check a few nights against OSCAR UI values.

---

## Future Work

- Add leak rate columns once DATALOG scaling is verified (post 2026-03-15)
- Add detailed session data (waveforms, event timestamps) from DATALOG files
- Automated launchd sync if/when a routine with the SD card is established
