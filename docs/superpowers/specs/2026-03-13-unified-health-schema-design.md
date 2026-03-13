# Unified Health Data Schema — Design Spec

**Date:** 2026-03-13
**Status:** Approved
**Goal:** Create a unified schema layer over existing Oura and Apple Health source tables, combining a materialized daily summary table with live SQL views for time-series and cross-source analysis. Designed to support an HTML dashboard, future CPAP integration, workout performance insights, and travel-aware health tracking.

---

## Approach: Hybrid (Views + One Summary Table)

- **One materialized table** (`daily_summary`) — pre-computed daily rollup for fast dashboard queries and automation hooks
- **Four SQL views** — live joins/unions over raw source tables for time-series and cross-source comparison
- **Parser enhancement** — preserve timezone offsets from Apple Health for travel detection
- **Activity type normalization** — map Apple Health `HKWorkoutActivityType*` identifiers to readable names

---

## Daily Summary Table

One row per day. Rebuilt by a script (`npm run build:summaries`).

```sql
CREATE TABLE IF NOT EXISTS daily_summary (
  day TEXT PRIMARY KEY,

  -- Oura scores (0-100)
  readiness_score INTEGER,
  sleep_score INTEGER,
  activity_score INTEGER,

  -- Sleep (from Oura sleep sessions)
  total_sleep_minutes INTEGER,
  deep_sleep_minutes INTEGER,
  rem_sleep_minutes INTEGER,
  sleep_efficiency REAL,          -- total_sleep / time_in_bed

  -- Heart rate
  avg_resting_hr REAL,            -- Apple Health RestingHeartRate avg for day
  min_hr INTEGER,                 -- Apple Health lowest HR sample
  max_hr INTEGER,                 -- Apple Health highest HR sample

  -- HRV (prefer Oura sleep-measured, fallback Apple Health)
  avg_hrv REAL,

  -- Activity (from Oura daily activity)
  steps INTEGER,
  active_calories INTEGER,

  -- Workouts (merged across sources)
  workout_count INTEGER,
  workout_minutes REAL,

  -- CPAP (future, NULL until data available)
  cpap_hours REAL,
  cpap_ahi REAL,

  -- Travel / location
  timezone_offset TEXT,           -- Earliest offset from Apple Health records, e.g. "-0500"
  timezone_change INTEGER,        -- 1 if offset changed during the day (travel flag)
  location_label TEXT,            -- User-supplied, e.g. "NYC", "London". NULL by default

  -- Metadata
  sources TEXT,                   -- Comma-separated: "oura,apple_health,cpap"
  built_at TEXT NOT NULL          -- When this row was last computed
);
CREATE INDEX IF NOT EXISTS idx_daily_summary_sources ON daily_summary(sources);
```

### Source Priority Rules

| Metric | Primary Source | Rationale |
|--------|---------------|-----------|
| Sleep duration/stages | Oura | Measured during sleep, more accurate than all-day Watch sampling |
| Sleep score | Oura | Only source with computed scores |
| Readiness/activity scores | Oura | Only source |
| Resting HR | Apple Health | Dedicated `RestingHeartRate` record type |
| Min/max HR | Apple Health | Continuous Watch sampling gives fuller coverage |
| HRV | Oura (primary), Apple Health (fallback) | Oura measures during sleep (more consistent), Apple Health fills gaps |
| Steps | Oura | Consistent daily values via API |
| Workouts | Merged | Count and duration from both sources, deduplicated by start time proximity |
| CPAP | CPAP (future) | Only source |

### Timezone Detection

The summary builder extracts the timezone offset from Apple Health records for each day. If the earliest and latest offsets differ, `timezone_change` is set to 1. This detects travel days without GPS data. Users can optionally label days with `location_label` (e.g., via dashboard or CLI prompt for days where `timezone_change = 1`).

---

## SQL Views

### `v_unified_heart_rate`

Union of all HR samples with a common shape. No deduplication — both sources visible for comparison.

```sql
CREATE VIEW IF NOT EXISTS v_unified_heart_rate AS
SELECT
  'oura' AS source,
  timestamp,
  bpm,
  source AS context  -- 'rest', 'awake', 'workout', 'session'
FROM oura_heart_rate

UNION ALL

SELECT
  'apple_health' AS source,
  start_date AS timestamp,
  CAST(value AS INTEGER) AS bpm,
  'watch' AS context
FROM apple_health_records
WHERE type = 'HKQuantityTypeIdentifierHeartRate';
```

### `v_unified_workouts`

Merged workouts with normalized activity types. Activity type normalization uses a TypeScript lookup map since SQLite views cannot call external functions. The view preserves raw types; normalization happens in application code.

Note: Apple Health workout `avg_hr`/`max_hr` are NULL in the view because `WorkoutStatistics` array ordering is not guaranteed — the heart rate statistic may not be at index `[0]`. The summary builder resolves these in TypeScript by filtering the `statistics` array from `raw_json` for `type = 'HKQuantityTypeIdentifierHeartRate'`.

```sql
CREATE VIEW IF NOT EXISTS v_unified_workouts AS
SELECT
  'oura' AS source,
  json_extract(raw_json, '$.activity') AS activity_type,
  json_extract(raw_json, '$.start_datetime') AS start_date,
  json_extract(raw_json, '$.end_datetime') AS end_date,
  ROUND(
    (julianday(json_extract(raw_json, '$.end_datetime'))
     - julianday(json_extract(raw_json, '$.start_datetime'))) * 1440,
    1
  ) AS duration_minutes,
  json_extract(raw_json, '$.distance') AS distance_meters,
  json_extract(raw_json, '$.calories') AS calories,
  json_extract(raw_json, '$.heart_rate.average') AS avg_hr,
  json_extract(raw_json, '$.heart_rate.maximum') AS max_hr
FROM oura_workouts

UNION ALL

SELECT
  'apple_health' AS source,
  activity_type,
  start_date,
  end_date,
  duration AS duration_minutes,
  total_distance AS distance_meters,
  total_energy_burned AS calories,
  NULL AS avg_hr,
  NULL AS max_hr
FROM apple_health_workouts;
```

### `v_unified_sleep`

Sleep sessions from both sources with stage breakdowns.

```sql
CREATE VIEW IF NOT EXISTS v_unified_sleep AS
SELECT
  'oura' AS source,
  day,
  json_extract(raw_json, '$.bedtime_start') AS bedtime_start,
  json_extract(raw_json, '$.bedtime_end') AS bedtime_end,
  ROUND(json_extract(raw_json, '$.total_sleep_duration') / 60.0) AS total_sleep_minutes,
  ROUND(json_extract(raw_json, '$.deep_sleep_duration') / 60.0) AS deep_sleep_minutes,
  ROUND(json_extract(raw_json, '$.rem_sleep_duration') / 60.0) AS rem_sleep_minutes,
  ROUND(json_extract(raw_json, '$.light_sleep_duration') / 60.0) AS light_sleep_minutes,
  json_extract(raw_json, '$.average_heart_rate') AS avg_hr,
  json_extract(raw_json, '$.average_hrv') AS avg_hrv,
  json_extract(raw_json, '$.score') AS score
FROM oura_sleep_sessions

UNION ALL

SELECT
  'apple_health' AS source,
  DATE(start_date) AS day,
  start_date AS bedtime_start,
  end_date AS bedtime_end,
  ROUND((julianday(end_date) - julianday(start_date)) * 1440) AS total_sleep_minutes,
  NULL AS deep_sleep_minutes,
  NULL AS rem_sleep_minutes,
  NULL AS light_sleep_minutes,
  NULL AS avg_hr,
  NULL AS avg_hrv,
  NULL AS score
FROM apple_health_records
WHERE type = 'HKCategoryTypeIdentifierSleepAnalysis'
  AND value = 'HKCategoryValueSleepAnalysisInBed';
```

Note: Apple Health sleep data uses `InBed` records as the session boundary (representing the overall time in bed), while stage-level entries (`AsleepCore`, `AsleepDeep`, `AsleepREM`, `Awake`) represent subdivisions within that window. The view uses `InBed` for session-level rollups. The Apple Watch is the primary source for these records. Stage-level detail is available via direct queries on `apple_health_records` when needed.

### `v_unified_hrv`

HRV readings by day from both sources.

```sql
CREATE VIEW IF NOT EXISTS v_unified_hrv AS
SELECT
  'oura' AS source,
  day,
  json_extract(raw_json, '$.average_hrv') AS hrv_ms
FROM oura_sleep_sessions
WHERE json_extract(raw_json, '$.average_hrv') IS NOT NULL

UNION ALL

SELECT
  'apple_health' AS source,
  DATE(start_date) AS day,
  CAST(value AS REAL) AS hrv_ms
FROM apple_health_records
WHERE type = 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN';
```

---

## Parser Changes

### Timezone Offset Preservation

Add a `timezoneOffset` field to `AppleHealthRecord`:

```typescript
export interface AppleHealthRecord {
  // ... existing fields ...
  timezoneOffset?: string;  // Original offset, e.g. "-0500"
}
```

Add a new helper function alongside the existing `normalizeTimestamp`:

```typescript
export function extractTimezoneOffset(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/([+-]\d{4})$/);
  return match ? match[1] : undefined;
}
```

The parser calls `extractTimezoneOffset` on `startDate` and stores the result as `timezoneOffset` on each record. The existing `normalizeTimestamp` signature is unchanged.

The `AppleHealthRepository.upsertRecords` method must be updated to include `timezone_offset` in both the `INSERT OR REPLACE` column list and the bound parameters:

```typescript
stmt.run(
  item.type, item.sourceName, item.startDate, item.endDate,
  item.value ?? null, item.unit ?? null,
  item.timezoneOffset ?? null,  // new
  JSON.stringify(item)
);
```

The `apple_health_records` table gets a new column via V3 migration:

```sql
ALTER TABLE apple_health_records ADD COLUMN timezone_offset TEXT;
```

---

## Activity Type Normalization

A lookup map in `src/unified/activity-types.ts`:

```typescript
const ACTIVITY_TYPE_MAP: Record<string, string> = {
  'HKWorkoutActivityTypeRunning': 'running',
  'HKWorkoutActivityTypeCycling': 'cycling',
  'HKWorkoutActivityTypeSwimming': 'swimming',
  'HKWorkoutActivityTypeWalking': 'walking',
  'HKWorkoutActivityTypeHiking': 'hiking',
  'HKWorkoutActivityTypeYoga': 'yoga',
  'HKWorkoutActivityTypeStrengthTraining': 'strength_training',
  'HKWorkoutActivityTypeHighIntensityIntervalTraining': 'hiit',
  'HKWorkoutActivityTypeElliptical': 'elliptical',
  'HKWorkoutActivityTypeRowing': 'rowing',
  'HKWorkoutActivityTypeCoreTraining': 'core_training',
  'HKWorkoutActivityTypeFunctionalStrengthTraining': 'functional_strength',
  'HKWorkoutActivityTypeDance': 'dance',
  'HKWorkoutActivityTypeCooldown': 'cooldown',
  'HKWorkoutActivityTypeSocialDance': 'social_dance',
  'HKWorkoutActivityTypePickleball': 'pickleball',
  'HKWorkoutActivityTypeTennis': 'tennis',
  'HKWorkoutActivityTypeBarre': 'barre',
  'HKWorkoutActivityTypePilates': 'pilates',
  'HKWorkoutActivityTypeMindAndBody': 'mind_and_body',
};

export function normalizeActivityType(raw: string): string {
  return ACTIVITY_TYPE_MAP[raw]
    ?? raw.replace('HKWorkoutActivityType', '').toLowerCase();
}
```

Oura activity types (`running`, `cycling`, etc.) pass through as-is.

---

## Build Script

### `scripts/build-summaries.ts`

**Usage:** `npm run build:summaries [--days N]`

**Behavior:**

1. Opens SQLite database, runs migrations (ensures V3 schema)
2. Determines date range: all days by default, or last N days if `--days N` specified
3. For each day in range, queries source tables to compute the daily rollup:
   - Oura scores: direct lookup from `oura_daily_readiness`, `oura_daily_sleep`, `oura_daily_activity`
   - Sleep metrics: from `oura_sleep_sessions` (primary session for that night)
   - HR metrics: aggregate `apple_health_records` WHERE type = HeartRate for that day
   - Resting HR: average `apple_health_records` WHERE type = RestingHeartRate
   - HRV: Oura sleep session `average_hrv`, fallback to Apple Health SDNN average
   - Steps/calories: from `oura_daily_activity` raw_json
   - Workouts: count and sum duration from both `oura_workouts` and `apple_health_workouts`
   - Timezone: extract distinct offsets from `apple_health_records` for that day
   - Sources: which source tables had data for this day
4. Upserts each row with `INSERT OR REPLACE`
5. Prints summary: "Built 847 daily summaries in 2.3s"

### Integration with existing sync

After the Oura sync completes, `scripts/run-sync.sh` calls `build:summaries --days 7` to keep the last week's summaries fresh. Full rebuilds happen on Apple Health re-import or on demand.

---

## Database Migration (V3)

Add `migrateV3` to `src/db/migrations.ts`, following the existing V1/V2 pattern. Add `if (currentVersion < 3) { migrateV3(db); }` to `runMigrations`, matching the existing conditional chain.

Migration steps:

1. `ALTER TABLE apple_health_records ADD COLUMN timezone_offset TEXT`
2. `CREATE TABLE IF NOT EXISTS daily_summary (...)`
3. `CREATE INDEX IF NOT EXISTS idx_daily_summary_sources ON daily_summary(sources)`
4. `CREATE VIEW IF NOT EXISTS v_unified_heart_rate AS ...`
5. `CREATE VIEW IF NOT EXISTS v_unified_workouts AS ...`
6. `CREATE VIEW IF NOT EXISTS v_unified_sleep AS ...`
7. `CREATE VIEW IF NOT EXISTS v_unified_hrv AS ...`
8. `PRAGMA user_version = 3`

---

## File Structure

```
src/
  unified/
    types.ts              -- DailySummary interface, view row types
    activity-types.ts     -- HK to readable activity type map
    summary-builder.ts    -- Queries sources, computes daily rollups
    views.ts              -- SQL strings for CREATE VIEW statements
    index.ts              -- Barrel export
    __tests__/
      summary-builder.test.ts
      activity-types.test.ts
  apple-health/
    parser.ts             -- Modified: extract timezone offset
    types.ts              -- Modified: add timezoneOffset field
scripts/
  build-summaries.ts      -- CLI: npm run build:summaries [--days N]
```

---

## Testing Strategy

### `summary-builder.test.ts`

In-memory SQLite with fixture data from both sources:
- Computes correct daily rollup from Oura + Apple Health data
- Handles days with only one source present
- Handles missing/null fields gracefully
- Detects timezone changes (different offsets in same day)
- Respects `--days N` filtering (only rebuilds recent days)
- Sets `sources` column correctly

### `activity-types.test.ts`

- Maps known HK workout types to readable names
- Falls back to stripping prefix and lowercasing for unknown types
- Passes through Oura types unchanged

### Existing parser tests

- Add test for timezone offset extraction alongside normalized timestamp

---

## Future Hooks

- **Automation:** The build script returns structured `DailySummary` data that a notification script can scan for anomalies (HRV drop, missed sleep, travel day without CPAP)
- **CPAP:** Add `cpap_hours` and `cpap_ahi` population to the summary builder when CPAP data reader is ready. Columns already exist. Views can include CPAP data via additional UNION ALL.
- **Dashboard:** Queries `daily_summary` for overview charts, drills into views for detail. Location labels can be managed through a dashboard UI.
- **Mobile access:** Daily summary is small enough to serve as JSON from a simple local HTTP server.
