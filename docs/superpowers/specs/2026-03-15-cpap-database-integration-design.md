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
- `build:summaries` is the **sole writer** to `daily_summary` — it reads from `cpap_sessions` alongside Oura/Apple Health data
- `import:cpap` writes only to `cpap_sessions`, never to `daily_summary`
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
| `csr_minutes` | INTEGER | Cheyne-Stokes respiration duration (minutes) |
| `mask_events` | INTEGER | Number of mask-on/off events |
| `imported_at` | TEXT | ISO timestamp of last import |

Leak columns excluded until EDF scaling is verified against DATALOG data.

### Changes to `daily_summary` (Migration V4)

V3 already added `cpap_hours REAL` and `cpap_ahi REAL` to `daily_summary`. V4 adds four new columns only — ending with `PRAGMA user_version = 4`:

| Column | Type | Notes |
|---|---|---|
| `cpap_pressure_50` | REAL | Median mask pressure |
| `cpap_resp_rate` | REAL | Median respiratory rate |
| `cpap_cai` | REAL | Central apneas |
| `cpap_csr_flagged` | INTEGER | 1 if `csr_minutes > 0`, else 0 |

`runMigrations` must add a `if (currentVersion < 4)` branch calling `migrateV4`. The four `ALTER TABLE` statements and `PRAGMA user_version = 4` must be in **separate `db.exec` calls** — SQLite does not allow mixing DDL and PRAGMA in a single batch (follow the same split pattern used in V3).

The existing `cpap_hours` column is populated as `usage_minutes / 60.0`. The existing `cpap_ahi` column maps directly from `ahi`.

---

## Components

```
src/cpap/
  types.ts          — CPAPSession interface
  edf-parser.ts     — reads STR.edf → CPAPSession[]
  repository.ts     — upserts into cpap_sessions only (no daily_summary writes)
  index.ts          — module exports

scripts/
  import-cpap.ts    — CLI entry point (add `"import:cpap": "tsx scripts/import-cpap.ts"` to package.json)

src/db/migrations.ts — V4 migration
src/unified/
  types.ts          — DailySummary interface extended with 4 new CPAP fields
  summary-builder.ts — updated to read cpap_sessions and include CPAP days
```

### Import flow

1. `npm run import:cpap` (optional: `-- "/Volumes/NO NAME"`)
2. Parser reads `STR.edf` from SD card path
3. Returns `CPAPSession[]` (one per valid night with `usage_minutes > 0`)
4. Repository upserts all sessions into `cpap_sessions`
5. Done — `daily_summary` is not touched

### To populate `daily_summary` with CPAP data

Run `npm run build:summaries` after import. The builder reads from `cpap_sessions`.

### SD card path resolution (in order)

1. CLI argument
2. `CPAP_CARD_PATH` env var
3. Default: `/Volumes/NO NAME`

Note: paths with spaces must be quoted in shell and CLI arg usage.

---

## Changes to `summary-builder.ts`

Four specific changes required:

1. **Read from `cpap_sessions`**: for each day being built, look up the matching row in `cpap_sessions` and populate all six CPAP fields (`cpap_hours`, `cpap_ahi`, `cpap_pressure_50`, `cpap_resp_rate`, `cpap_cai`, `cpap_csr_flagged`).

2. **Include CPAP-only days**: the UNION of source days used to determine which days to build must include `SELECT day FROM cpap_sessions`. If a day has CPAP data but no Oura/Apple Health data, `sources` will contain only `'cpap'` — this is enough to pass the `sources.size > 0` guard and produce a row.

3. **Add `'cpap'` to sources**: when CPAP data is found for a day, add `'cpap'` to the sources set.

4. **Extend `DailySummary` interface** in `src/unified/types.ts` and the `INSERT OR REPLACE` statement in `summary-builder.ts` to include the four new V4 columns. All three artifacts — the interface, the INSERT column list, and the INSERT values list — must be updated together atomically. Missing any one of them will cause silent nulls in `daily_summary`.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| SD card not mounted | Clear error with expected path |
| STR.edf missing | Error — card may not have been in machine |
| Date parse failure for a night | Skip that night, log warning, continue |

---

## Testing

Manual only — consistent with the rest of the project. Run `npm run import:cpap`, then `npm run build:summaries`, then spot-check a few nights in the DB against OSCAR UI values for AHI and usage hours.

---

## Future Work

- Add leak rate columns once DATALOG scaling is verified (post 2026-03-15)
- Add detailed session data (waveforms, event timestamps) from DATALOG files
- Automated launchd sync if/when a routine with the SD card is established
