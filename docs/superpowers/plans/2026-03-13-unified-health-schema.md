# Unified Health Data Schema Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a unified schema layer over existing Oura and Apple Health source tables — one materialized daily summary table, four SQL views, timezone extraction, and activity type normalization.

**Architecture:** V3 migration adds `timezone_offset` column, `daily_summary` table, and 4 views. Parser extracts timezone offsets from Apple Health timestamps. A build script computes daily rollups from source tables. Activity type normalization happens in application code via a lookup map.

**Tech Stack:** TypeScript, better-sqlite3, vitest, tsx

---

## File Structure

```
src/
  unified/
    types.ts              -- DailySummary interface, view row types
    activity-types.ts     -- HK to readable activity type map + normalizeActivityType()
    views.ts              -- SQL strings for CREATE VIEW statements
    summary-builder.ts    -- Queries sources, computes daily rollups
    index.ts              -- Barrel export
    __tests__/
      activity-types.test.ts
      summary-builder.test.ts
  apple-health/
    parser.ts             -- Modified: add extractTimezoneOffset()
    types.ts              -- Modified: add timezoneOffset field
    repository.ts         -- Modified: include timezone_offset in upsert
  db/
    migrations.ts         -- Modified: add migrateV3()
    __tests__/
      database.test.ts    -- Modified: version assertion to 3, daily_summary table check
scripts/
  build-summaries.ts      -- CLI: npm run build:summaries [--days N]
  run-sync.sh             -- Modified: add build:summaries --days 7 after sync
```

---

## Chunk 1: Foundation (Migration, Types, Activity Map)

### Task 1: Activity Type Normalization Module

**Files:**
- Create: `src/unified/activity-types.ts`
- Create: `src/unified/__tests__/activity-types.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/unified/__tests__/activity-types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeActivityType } from '../activity-types.js';

describe('normalizeActivityType', () => {
  it('maps known HK workout types to readable names', () => {
    expect(normalizeActivityType('HKWorkoutActivityTypeRunning')).toBe('running');
    expect(normalizeActivityType('HKWorkoutActivityTypeStrengthTraining')).toBe('strength_training');
    expect(normalizeActivityType('HKWorkoutActivityTypeHighIntensityIntervalTraining')).toBe('hiit');
    expect(normalizeActivityType('HKWorkoutActivityTypePickleball')).toBe('pickleball');
  });

  it('falls back to stripping prefix and lowercasing for unknown types', () => {
    expect(normalizeActivityType('HKWorkoutActivityTypeSkateboarding')).toBe('skateboarding');
    expect(normalizeActivityType('HKWorkoutActivityTypeArchery')).toBe('archery');
  });

  it('passes through Oura activity types unchanged', () => {
    expect(normalizeActivityType('running')).toBe('running');
    expect(normalizeActivityType('cycling')).toBe('cycling');
    expect(normalizeActivityType('walking')).toBe('walking');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/unified/__tests__/activity-types.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement activity-types module**

Create `src/unified/activity-types.ts`:

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/unified/__tests__/activity-types.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/unified/activity-types.ts src/unified/__tests__/activity-types.test.ts
git commit -m "feat: add activity type normalization module"
```

---

### Task 2: Unified Type Definitions

**Files:**
- Create: `src/unified/types.ts`

- [ ] **Step 1: Create the types file**

Create `src/unified/types.ts`:

```typescript
export interface DailySummary {
  day: string;

  // Oura scores (0-100)
  readiness_score: number | null;
  sleep_score: number | null;
  activity_score: number | null;

  // Sleep (from Oura sleep sessions)
  total_sleep_minutes: number | null;
  deep_sleep_minutes: number | null;
  rem_sleep_minutes: number | null;
  sleep_efficiency: number | null;

  // Heart rate
  avg_resting_hr: number | null;
  min_hr: number | null;
  max_hr: number | null;

  // HRV
  avg_hrv: number | null;

  // Activity (from Oura daily activity)
  steps: number | null;
  active_calories: number | null;

  // Workouts (merged across sources)
  workout_count: number | null;
  workout_minutes: number | null;

  // CPAP (future)
  cpap_hours: number | null;
  cpap_ahi: number | null;

  // Travel / location
  timezone_offset: string | null;
  timezone_change: number | null;
  location_label: string | null;

  // Metadata
  sources: string;
  built_at: string;
}

export interface UnifiedHeartRateRow {
  source: string;
  timestamp: string;
  bpm: number;
  context: string;
}

export interface UnifiedWorkoutRow {
  source: string;
  activity_type: string;
  start_date: string;
  end_date: string;
  duration_minutes: number | null;
  distance_meters: number | null;
  calories: number | null;
  avg_hr: number | null;
  max_hr: number | null;
}

export interface UnifiedSleepRow {
  source: string;
  day: string;
  bedtime_start: string | null;
  bedtime_end: string | null;
  total_sleep_minutes: number | null;
  deep_sleep_minutes: number | null;
  rem_sleep_minutes: number | null;
  light_sleep_minutes: number | null;
  avg_hr: number | null;
  avg_hrv: number | null;
  score: number | null;
}

export interface UnifiedHrvRow {
  source: string;
  day: string;
  hrv_ms: number;
}
```

- [ ] **Step 2: Verify file compiles**

Run: `npx tsc --noEmit src/unified/types.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/unified/types.ts
git commit -m "feat: add unified schema type definitions"
```

---

### Task 3: SQL View Definitions

**Files:**
- Create: `src/unified/views.ts`

- [ ] **Step 1: Create the views module**

Create `src/unified/views.ts`:

```typescript
export const VIEW_UNIFIED_HEART_RATE = `
CREATE VIEW IF NOT EXISTS v_unified_heart_rate AS
SELECT
  'oura' AS source,
  timestamp,
  bpm,
  source AS context
FROM oura_heart_rate

UNION ALL

SELECT
  'apple_health' AS source,
  start_date AS timestamp,
  CAST(value AS INTEGER) AS bpm,
  'watch' AS context
FROM apple_health_records
WHERE type = 'HKQuantityTypeIdentifierHeartRate';
`;

export const VIEW_UNIFIED_WORKOUTS = `
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
`;

export const VIEW_UNIFIED_SLEEP = `
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
`;

export const VIEW_UNIFIED_HRV = `
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
`;
```

- [ ] **Step 2: Verify file compiles**

Run: `npx tsc --noEmit src/unified/views.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/unified/views.ts
git commit -m "feat: add SQL view definitions for unified schema"
```

---

### Task 4: Parser Timezone Extraction

**Files:**
- Modify: `src/apple-health/parser.ts`
- Modify: `src/apple-health/types.ts`
- Modify: `src/apple-health/__tests__/parser.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/apple-health/__tests__/parser.test.ts`. Import `extractTimezoneOffset` alongside the existing import:

```typescript
import { normalizeTimestamp, extractTimezoneOffset, parseAppleHealthExport } from '../parser.js';
```

Add a new describe block after the existing tests:

```typescript
describe('extractTimezoneOffset', () => {
  it('extracts offset from Apple Health timestamp', () => {
    expect(extractTimezoneOffset('2024-01-15 08:30:00 -0500')).toBe('-0500');
    expect(extractTimezoneOffset('2024-06-20 14:00:00 +0100')).toBe('+0100');
  });

  it('returns undefined for missing or invalid input', () => {
    expect(extractTimezoneOffset(undefined)).toBeUndefined();
    expect(extractTimezoneOffset('')).toBeUndefined();
    expect(extractTimezoneOffset('2024-01-15T08:30:00Z')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/apple-health/__tests__/parser.test.ts`
Expected: FAIL — extractTimezoneOffset not exported

- [ ] **Step 3: Add timezoneOffset to AppleHealthRecord type**

In `src/apple-health/types.ts`, add `timezoneOffset?: string;` to the `AppleHealthRecord` interface after `creationDate`:

```typescript
export interface AppleHealthRecord {
  type: string;
  sourceName: string;
  sourceVersion?: string;
  unit?: string;
  value?: string;
  startDate: string;
  endDate: string;
  device?: string;
  creationDate?: string;
  timezoneOffset?: string;
}
```

- [ ] **Step 4: Implement extractTimezoneOffset in parser**

Add to `src/apple-health/parser.ts` after the `normalizeTimestamp` function:

```typescript
/**
 * Extract the timezone offset from an Apple Health timestamp.
 * Input:  "2024-01-15 08:30:00 -0500"
 * Output: "-0500"
 */
export function extractTimezoneOffset(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/([+-]\d{4})$/);
  return match ? match[1] : undefined;
}
```

Then update the Record parsing block in the `opentag` handler. The raw `startDate` attribute value is needed *before* normalization for timezone extraction. Update the section that creates the record object:

```typescript
// Capture raw startDate before normalization (for timezone extraction)
const rawStartDate = node.attributes.startDate as string;

const record: AppleHealthRecord = {
  type,
  sourceName: node.attributes.sourceName as string,
  startDate: normalizeTimestamp(rawStartDate),
  endDate: normalizeTimestamp(node.attributes.endDate as string),
};
// ... existing optional field assignments ...
const tzOffset = extractTimezoneOffset(rawStartDate);
if (tzOffset) record.timezoneOffset = tzOffset;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/apple-health/__tests__/parser.test.ts`
Expected: All tests PASS (existing + 2 new)

- [ ] **Step 6: Commit**

```bash
git add src/apple-health/parser.ts src/apple-health/types.ts src/apple-health/__tests__/parser.test.ts
git commit -m "feat: extract timezone offset from Apple Health timestamps"
```

---

### Task 5: V3 Database Migration

**Files:**
- Modify: `src/db/migrations.ts`
- Modify: `src/db/__tests__/database.test.ts`

- [ ] **Step 1: Update the database test expectations**

In `src/db/__tests__/database.test.ts`:

1. Change both version assertions from `2` to `3` (in "should set the schema version" and "should be idempotent" tests)

2. Add `daily_summary` table check to "should create a new database with all tables":
   ```typescript
   expect(tableNames).toContain('daily_summary');
   ```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/db/__tests__/database.test.ts`
Expected: FAIL — version is still 2, daily_summary table doesn't exist

- [ ] **Step 3: Implement V3 migration**

In `src/db/migrations.ts`:

1. Add import at the top:
   ```typescript
   import {
     VIEW_UNIFIED_HEART_RATE,
     VIEW_UNIFIED_WORKOUTS,
     VIEW_UNIFIED_SLEEP,
     VIEW_UNIFIED_HRV,
   } from '../unified/views.js';
   ```

2. Add `if (currentVersion < 3) { migrateV3(db); }` to `runMigrations` after the V2 check.

3. Add the function:

```typescript
/**
 * V3: Unified schema - daily summary table, SQL views, timezone offset column
 */
function migrateV3(db: Database.Database): void {
  db.exec(`
    ALTER TABLE apple_health_records ADD COLUMN timezone_offset TEXT;

    CREATE TABLE IF NOT EXISTS daily_summary (
      day TEXT PRIMARY KEY,
      readiness_score INTEGER,
      sleep_score INTEGER,
      activity_score INTEGER,
      total_sleep_minutes INTEGER,
      deep_sleep_minutes INTEGER,
      rem_sleep_minutes INTEGER,
      sleep_efficiency REAL,
      avg_resting_hr REAL,
      min_hr INTEGER,
      max_hr INTEGER,
      avg_hrv REAL,
      steps INTEGER,
      active_calories INTEGER,
      workout_count INTEGER,
      workout_minutes REAL,
      cpap_hours REAL,
      cpap_ahi REAL,
      timezone_offset TEXT,
      timezone_change INTEGER,
      location_label TEXT,
      sources TEXT,
      built_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_daily_summary_sources ON daily_summary(sources);
  `);

  db.exec(VIEW_UNIFIED_HEART_RATE);
  db.exec(VIEW_UNIFIED_WORKOUTS);
  db.exec(VIEW_UNIFIED_SLEEP);
  db.exec(VIEW_UNIFIED_HRV);

  db.exec('PRAGMA user_version = 3;');
}
```

- [ ] **Step 4: Run ALL tests to verify everything passes**

Run: `npx vitest run`
Expected: ALL tests pass

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations.ts src/db/__tests__/database.test.ts
git commit -m "feat: add V3 migration with daily_summary table and unified views"
```

---

### Task 6: Update Apple Health Repository for Timezone

**Files:**
- Modify: `src/apple-health/repository.ts`
- Modify: `src/apple-health/__tests__/repository.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test to `src/apple-health/__tests__/repository.test.ts` inside the existing describe block:

```typescript
it('should store timezone_offset when provided', () => {
  const records: AppleHealthRecord[] = [
    {
      type: 'HKQuantityTypeIdentifierHeartRate',
      sourceName: 'Watch',
      startDate: '2024-01-15T13:30:00.000Z',
      endDate: '2024-01-15T13:30:00.000Z',
      value: '72',
      unit: 'count/min',
      timezoneOffset: '-0500',
    },
  ];

  repo.upsertRecords(records);

  const row = db
    .prepare('SELECT timezone_offset FROM apple_health_records WHERE type = ?')
    .get('HKQuantityTypeIdentifierHeartRate') as { timezone_offset: string };
  expect(row.timezone_offset).toBe('-0500');
});
```

- [ ] **Step 2: Run tests to verify the new test fails**

Run: `npx vitest run src/apple-health/__tests__/repository.test.ts`
Expected: FAIL — the `timezone_offset` column now exists (from V3 migration in Task 5), but the value is null because the repository doesn't write it yet.

- [ ] **Step 3: Update repository to include timezone_offset**

In `src/apple-health/repository.ts`, update the `upsertRecords` method.

Change the INSERT statement to:
```typescript
const stmt = this.db.prepare(`
  INSERT OR REPLACE INTO apple_health_records
    (type, source_name, start_date, end_date, value, unit, timezone_offset, raw_json, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
`);
```

Update the `stmt.run` call to:
```typescript
stmt.run(
  item.type,
  item.sourceName,
  item.startDate,
  item.endDate,
  item.value ?? null,
  item.unit ?? null,
  item.timezoneOffset ?? null,
  JSON.stringify(item)
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/apple-health/__tests__/repository.test.ts`
Expected: ALL tests pass including the new timezone_offset test

- [ ] **Step 5: Commit**

```bash
git add src/apple-health/repository.ts src/apple-health/__tests__/repository.test.ts
git commit -m "feat: store timezone_offset in apple_health_records"
```

---

### Task 7: Barrel Exports

**Files:**
- Create: `src/unified/index.ts`

- [ ] **Step 1: Create barrel export**

Create `src/unified/index.ts` with only the exports that exist so far. The `summary-builder` export will be added in Task 9 after that module is implemented.

```typescript
export { normalizeActivityType } from './activity-types.js';
export type {
  DailySummary,
  UnifiedHeartRateRow,
  UnifiedWorkoutRow,
  UnifiedSleepRow,
  UnifiedHrvRow,
} from './types.js';
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/unified/index.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/unified/index.ts
git commit -m "feat: add unified module barrel export"
```

---

## Chunk 2: Summary Builder and Build Script

### Task 8: Summary Builder — Core Logic

**Files:**
- Create: `src/unified/summary-builder.ts`
- Create: `src/unified/__tests__/summary-builder.test.ts`

- [ ] **Step 1: Write the test file with fixture setup**

Create `src/unified/__tests__/summary-builder.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { openDatabase } from '../../db/database.js';
import { buildDailySummaries } from '../summary-builder.js';

describe('buildDailySummaries', () => {
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-test-'));
    db = openDatabase(path.join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedOuraData(day: string) {
    db.prepare(
      `INSERT INTO oura_daily_readiness (id, day, score, raw_json) VALUES (?, ?, ?, ?)`
    ).run(`readiness-${day}`, day, 85, JSON.stringify({ score: 85 }));

    db.prepare(
      `INSERT INTO oura_daily_sleep (id, day, score, raw_json) VALUES (?, ?, ?, ?)`
    ).run(`sleep-score-${day}`, day, 78, JSON.stringify({ score: 78 }));

    db.prepare(
      `INSERT INTO oura_daily_activity (id, day, score, raw_json) VALUES (?, ?, ?, ?)`
    ).run(`activity-${day}`, day, 90, JSON.stringify({
      score: 90,
      steps: 8500,
      active_calories: 350,
    }));

    db.prepare(
      `INSERT INTO oura_sleep_sessions (id, day, raw_json) VALUES (?, ?, ?)`
    ).run(`sleep-${day}`, day, JSON.stringify({
      total_sleep_duration: 28800,
      deep_sleep_duration: 5400,
      rem_sleep_duration: 7200,
      light_sleep_duration: 14400,
      average_heart_rate: 58,
      average_hrv: 45,
      score: 78,
      bedtime_start: `${day}T23:00:00+00:00`,
      bedtime_end: `${day}T07:00:00+00:00`,
    }));
  }

  function seedAppleHealthData(day: string) {
    // Resting HR
    db.prepare(
      `INSERT INTO apple_health_records (type, source_name, start_date, end_date, value, unit, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('HKQuantityTypeIdentifierRestingHeartRate', 'Watch', `${day}T08:00:00.000Z`, `${day}T08:00:00.000Z`, '55', 'count/min', '{}');

    // HR samples (for min/max)
    db.prepare(
      `INSERT INTO apple_health_records (type, source_name, start_date, end_date, value, unit, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('HKQuantityTypeIdentifierHeartRate', 'Watch', `${day}T03:00:00.000Z`, `${day}T03:00:00.000Z`, '48', 'count/min', '{}');

    db.prepare(
      `INSERT INTO apple_health_records (type, source_name, start_date, end_date, value, unit, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('HKQuantityTypeIdentifierHeartRate', 'Watch', `${day}T14:00:00.000Z`, `${day}T14:00:00.000Z`, '145', 'count/min', '{}');
  }

  it('computes a daily rollup from Oura + Apple Health data', () => {
    seedOuraData('2024-06-15');
    seedAppleHealthData('2024-06-15');

    const results = buildDailySummaries(db);

    expect(results.length).toBe(1);
    const row = results[0];
    expect(row.day).toBe('2024-06-15');
    expect(row.readiness_score).toBe(85);
    expect(row.sleep_score).toBe(78);
    expect(row.activity_score).toBe(90);
    expect(row.total_sleep_minutes).toBe(480);
    expect(row.deep_sleep_minutes).toBe(90);
    expect(row.rem_sleep_minutes).toBe(120);
    expect(row.avg_hrv).toBe(45);
    expect(row.steps).toBe(8500);
    expect(row.active_calories).toBe(350);
    expect(row.avg_resting_hr).toBe(55);
    expect(row.min_hr).toBe(48);
    expect(row.max_hr).toBe(145);
    expect(row.sources).toContain('oura');
    expect(row.sources).toContain('apple_health');
  });

  it('handles days with only Oura data', () => {
    seedOuraData('2024-06-15');

    const results = buildDailySummaries(db);

    expect(results.length).toBe(1);
    const row = results[0];
    expect(row.readiness_score).toBe(85);
    expect(row.avg_resting_hr).toBeNull();
    expect(row.min_hr).toBeNull();
    expect(row.max_hr).toBeNull();
    expect(row.sources).toBe('oura');
  });

  it('handles days with only Apple Health data', () => {
    seedAppleHealthData('2024-06-15');

    const results = buildDailySummaries(db);

    expect(results.length).toBe(1);
    const row = results[0];
    expect(row.readiness_score).toBeNull();
    expect(row.sleep_score).toBeNull();
    expect(row.avg_resting_hr).toBe(55);
    expect(row.min_hr).toBe(48);
    expect(row.max_hr).toBe(145);
    expect(row.sources).toBe('apple_health');
  });

  it('respects --days filtering', () => {
    seedOuraData('2024-06-10');
    seedOuraData('2024-06-15');

    const results = buildDailySummaries(db, { days: 3, today: '2024-06-15' });

    // Only 2024-06-13 through 2024-06-15 — should include 06-15 but not 06-10
    expect(results.length).toBe(1);
    expect(results[0].day).toBe('2024-06-15');
  });

  it('detects timezone changes within a day', () => {
    db.prepare(
      `INSERT INTO apple_health_records (type, source_name, start_date, end_date, value, unit, timezone_offset, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('HKQuantityTypeIdentifierHeartRate', 'Watch', '2024-06-15T08:00:00.000Z', '2024-06-15T08:00:00.000Z', '72', 'count/min', '-0500', '{}');

    db.prepare(
      `INSERT INTO apple_health_records (type, source_name, start_date, end_date, value, unit, timezone_offset, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('HKQuantityTypeIdentifierHeartRate', 'Watch', '2024-06-15T20:00:00.000Z', '2024-06-15T20:00:00.000Z', '68', 'count/min', '-0700', '{}');

    const results = buildDailySummaries(db);

    expect(results.length).toBe(1);
    expect(results[0].timezone_change).toBe(1);
    expect(results[0].timezone_offset).toBe('-0500');
  });

  it('counts workouts from both sources', () => {
    db.prepare(
      `INSERT INTO oura_workouts (id, day, raw_json) VALUES (?, ?, ?)`
    ).run('workout-1', '2024-06-15', JSON.stringify({
      activity: 'running',
      start_datetime: '2024-06-15T07:00:00+00:00',
      end_datetime: '2024-06-15T07:45:00+00:00',
      calories: 400,
    }));

    db.prepare(
      `INSERT INTO apple_health_workouts (activity_type, source_name, start_date, end_date, duration, raw_json) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('HKWorkoutActivityTypeYoga', 'Watch', '2024-06-15T18:00:00.000Z', '2024-06-15T18:30:00.000Z', 30, '{}');

    const results = buildDailySummaries(db);

    expect(results.length).toBe(1);
    expect(results[0].workout_count).toBe(2);
    expect(results[0].workout_minutes).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/unified/__tests__/summary-builder.test.ts`
Expected: FAIL — summary-builder module not found

- [ ] **Step 3: Implement summary-builder**

Create `src/unified/summary-builder.ts`:

```typescript
import type Database from 'better-sqlite3';
import type { DailySummary } from './types.js';

interface BuildOptions {
  days?: number;
  today?: string;
}

export function buildDailySummaries(
  db: Database.Database,
  options?: BuildOptions
): DailySummary[] {
  const today = options?.today ?? new Date().toISOString().split('T')[0];
  const days = getAllDays(db, options?.days, today);
  const results: DailySummary[] = [];

  const upsertStmt = db.prepare(`
    INSERT OR REPLACE INTO daily_summary (
      day, readiness_score, sleep_score, activity_score,
      total_sleep_minutes, deep_sleep_minutes, rem_sleep_minutes, sleep_efficiency,
      avg_resting_hr, min_hr, max_hr, avg_hrv,
      steps, active_calories,
      workout_count, workout_minutes,
      cpap_hours, cpap_ahi,
      timezone_offset, timezone_change, location_label,
      sources, built_at
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?
    )
  `);

  for (const day of days) {
    const summary = buildDay(db, day);
    if (summary) {
      upsertStmt.run(
        summary.day,
        summary.readiness_score, summary.sleep_score, summary.activity_score,
        summary.total_sleep_minutes, summary.deep_sleep_minutes, summary.rem_sleep_minutes, summary.sleep_efficiency,
        summary.avg_resting_hr, summary.min_hr, summary.max_hr, summary.avg_hrv,
        summary.steps, summary.active_calories,
        summary.workout_count, summary.workout_minutes,
        summary.cpap_hours, summary.cpap_ahi,
        summary.timezone_offset, summary.timezone_change, summary.location_label,
        summary.sources, summary.built_at
      );
      results.push(summary);
    }
  }

  return results;
}

function getAllDays(
  db: Database.Database,
  daysLimit: number | undefined,
  today: string
): string[] {
  let dateFilter = '';
  if (daysLimit) {
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - daysLimit);
    dateFilter = ` WHERE day >= '${cutoff.toISOString().split('T')[0]}'`;
  }

  const rows = db.prepare(`
    SELECT DISTINCT day FROM (
      SELECT day FROM oura_daily_readiness
      UNION SELECT day FROM oura_daily_sleep
      UNION SELECT day FROM oura_daily_activity
      UNION SELECT day FROM oura_sleep_sessions
      UNION SELECT day FROM oura_workouts
      UNION SELECT DATE(start_date) AS day FROM apple_health_records
      UNION SELECT DATE(start_date) AS day FROM apple_health_workouts
    )${dateFilter}
    ORDER BY day
  `).all() as { day: string }[];

  return rows.map(r => r.day);
}

function buildDay(db: Database.Database, day: string): DailySummary | null {
  const sources: Set<string> = new Set();

  // Oura scores
  const readiness = db.prepare(
    `SELECT score FROM oura_daily_readiness WHERE day = ?`
  ).get(day) as { score: number } | undefined;

  const sleepScore = db.prepare(
    `SELECT score FROM oura_daily_sleep WHERE day = ?`
  ).get(day) as { score: number } | undefined;

  const activity = db.prepare(
    `SELECT score, raw_json FROM oura_daily_activity WHERE day = ?`
  ).get(day) as { score: number; raw_json: string } | undefined;

  if (readiness || sleepScore || activity) sources.add('oura');

  // Steps and calories from activity raw_json
  let steps: number | null = null;
  let activeCalories: number | null = null;
  if (activity) {
    const activityData = JSON.parse(activity.raw_json);
    steps = activityData.steps ?? null;
    activeCalories = activityData.active_calories ?? null;
  }

  // Oura sleep session
  const sleepSession = db.prepare(
    `SELECT raw_json FROM oura_sleep_sessions WHERE day = ? LIMIT 1`
  ).get(day) as { raw_json: string } | undefined;

  let totalSleepMinutes: number | null = null;
  let deepSleepMinutes: number | null = null;
  let remSleepMinutes: number | null = null;
  let sleepEfficiency: number | null = null;
  let ouraHrv: number | null = null;

  if (sleepSession) {
    sources.add('oura');
    const sleep = JSON.parse(sleepSession.raw_json);
    totalSleepMinutes = sleep.total_sleep_duration
      ? Math.round(sleep.total_sleep_duration / 60) : null;
    deepSleepMinutes = sleep.deep_sleep_duration
      ? Math.round(sleep.deep_sleep_duration / 60) : null;
    remSleepMinutes = sleep.rem_sleep_duration
      ? Math.round(sleep.rem_sleep_duration / 60) : null;

    if (sleep.total_sleep_duration && sleep.bedtime_start && sleep.bedtime_end) {
      const bedStart = new Date(sleep.bedtime_start).getTime();
      const bedEnd = new Date(sleep.bedtime_end).getTime();
      const timeInBedSeconds = (bedEnd - bedStart) / 1000;
      if (timeInBedSeconds > 0) {
        sleepEfficiency = +(sleep.total_sleep_duration / timeInBedSeconds).toFixed(2);
      }
    }

    ouraHrv = sleep.average_hrv ?? null;
  }

  // Apple Health resting heart rate
  const hrStats = db.prepare(`
    SELECT AVG(CAST(value AS REAL)) AS avg_resting_hr
    FROM apple_health_records
    WHERE type = 'HKQuantityTypeIdentifierRestingHeartRate'
      AND DATE(start_date) = ?
  `).get(day) as { avg_resting_hr: number | null };

  // Apple Health min/max heart rate
  const minMaxHr = db.prepare(`
    SELECT
      MIN(CAST(value AS INTEGER)) AS min_hr,
      MAX(CAST(value AS INTEGER)) AS max_hr
    FROM apple_health_records
    WHERE type = 'HKQuantityTypeIdentifierHeartRate'
      AND DATE(start_date) = ?
  `).get(day) as { min_hr: number | null; max_hr: number | null };

  if (hrStats.avg_resting_hr !== null || minMaxHr.min_hr !== null) {
    sources.add('apple_health');
  }

  // HRV: Oura primary, Apple Health fallback
  let avgHrv = ouraHrv;
  if (avgHrv === null) {
    const ahHrv = db.prepare(`
      SELECT AVG(CAST(value AS REAL)) AS avg_hrv
      FROM apple_health_records
      WHERE type = 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN'
        AND DATE(start_date) = ?
    `).get(day) as { avg_hrv: number | null };
    avgHrv = ahHrv.avg_hrv;
    if (avgHrv !== null) sources.add('apple_health');
  }

  // Workouts from both sources
  const ouraWorkouts = db.prepare(
    `SELECT raw_json FROM oura_workouts WHERE day = ?`
  ).all(day) as { raw_json: string }[];

  const ahWorkouts = db.prepare(
    `SELECT duration FROM apple_health_workouts WHERE DATE(start_date) = ?`
  ).all(day) as { duration: number | null }[];

  const workoutCount = ouraWorkouts.length + ahWorkouts.length;
  let workoutMinutes = 0;

  for (const w of ouraWorkouts) {
    sources.add('oura');
    const data = JSON.parse(w.raw_json);
    if (data.start_datetime && data.end_datetime) {
      const start = new Date(data.start_datetime).getTime();
      const end = new Date(data.end_datetime).getTime();
      workoutMinutes += (end - start) / 60000;
    }
  }

  for (const w of ahWorkouts) {
    sources.add('apple_health');
    if (w.duration) workoutMinutes += w.duration;
  }

  // Timezone detection
  const tzRows = db.prepare(`
    SELECT DISTINCT timezone_offset
    FROM apple_health_records
    WHERE DATE(start_date) = ? AND timezone_offset IS NOT NULL
    ORDER BY start_date
  `).all(day) as { timezone_offset: string }[];

  const timezoneOffset = tzRows.length > 0 ? tzRows[0].timezone_offset : null;
  const timezoneChange = tzRows.length > 1 ? 1 : null;

  // Preserve existing location_label
  const existing = db.prepare(
    `SELECT location_label FROM daily_summary WHERE day = ?`
  ).get(day) as { location_label: string | null } | undefined;

  if (sources.size === 0) return null;

  return {
    day,
    readiness_score: readiness?.score ?? null,
    sleep_score: sleepScore?.score ?? null,
    activity_score: activity?.score ?? null,
    total_sleep_minutes: totalSleepMinutes,
    deep_sleep_minutes: deepSleepMinutes,
    rem_sleep_minutes: remSleepMinutes,
    sleep_efficiency: sleepEfficiency,
    avg_resting_hr: hrStats.avg_resting_hr
      ? +hrStats.avg_resting_hr.toFixed(1) : null,
    min_hr: minMaxHr.min_hr,
    max_hr: minMaxHr.max_hr,
    avg_hrv: avgHrv ? +avgHrv.toFixed(1) : null,
    steps,
    active_calories: activeCalories,
    workout_count: workoutCount > 0 ? workoutCount : null,
    workout_minutes: workoutMinutes > 0 ? +workoutMinutes.toFixed(1) : null,
    cpap_hours: null,
    cpap_ahi: null,
    timezone_offset: timezoneOffset,
    timezone_change: timezoneChange,
    location_label: existing?.location_label ?? null,
    sources: Array.from(sources).sort().join(','),
    built_at: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/unified/__tests__/summary-builder.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: ALL tests pass

- [ ] **Step 6: Commit**

```bash
git add src/unified/summary-builder.ts src/unified/__tests__/summary-builder.test.ts
git commit -m "feat: add daily summary builder with cross-source aggregation"
```

---

### Task 9: Update Barrel Export with Summary Builder

**Files:**
- Modify: `src/unified/index.ts`

- [ ] **Step 1: Add summary-builder export**

Add to `src/unified/index.ts`:
```typescript
export { buildDailySummaries } from './summary-builder.js';
```

- [ ] **Step 2: Commit**

```bash
git add src/unified/index.ts
git commit -m "feat: export buildDailySummaries from unified module"
```

---

### Task 10: Build Summaries CLI Script

**Files:**
- Create: `scripts/build-summaries.ts`
- Modify: `package.json` (add npm script)

- [ ] **Step 1: Create the build script**

Create `scripts/build-summaries.ts`:

```typescript
import { openDatabase } from '../src/db/database.js';
import { buildDailySummaries } from '../src/unified/summary-builder.js';

const DB_PATH = 'data/health.db';

function main() {
  const args = process.argv.slice(2);
  let days: number | undefined;

  const daysIdx = args.indexOf('--days');
  if (daysIdx !== -1 && args[daysIdx + 1]) {
    days = parseInt(args[daysIdx + 1], 10);
    if (isNaN(days) || days < 1) {
      console.error('--days must be a positive number');
      process.exit(1);
    }
  }

  const start = Date.now();
  const db = openDatabase(DB_PATH);

  try {
    const results = buildDailySummaries(db, days ? { days } : undefined);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`Built ${results.length} daily summaries in ${elapsed}s`);
  } finally {
    db.close();
  }
}

main();
```

- [ ] **Step 2: Add npm script to package.json**

Add to the `"scripts"` section in `package.json`:
```json
"build:summaries": "tsx scripts/build-summaries.ts"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/build-summaries.ts package.json
git commit -m "feat: add build-summaries CLI script"
```

---

### Task 11: Integrate Build Script with Sync

**Files:**
- Modify: `scripts/run-sync.sh`

- [ ] **Step 1: Add summary build after Oura sync**

Append to `scripts/run-sync.sh` after the `npx tsx scripts/sync-oura.ts 2>&1` line:

```bash

# Rebuild last week's daily summaries after sync
echo "Building daily summaries..."
npx tsx scripts/build-summaries.ts --days 7 2>&1
```

- [ ] **Step 2: Commit**

```bash
git add scripts/run-sync.sh
git commit -m "feat: rebuild daily summaries after Oura sync"
```

---

### Task 12: Final Verification and PROGRESS.md Update

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL tests pass

- [ ] **Step 2: Run build:summaries against real database**

Run: `npm run build:summaries`
Expected: Prints "Built N daily summaries in X.Xs" with N > 0

- [ ] **Step 3: Verify views work with real data**

```bash
npx tsx -e "
import { openDatabase } from './src/db/database.js';
const db = openDatabase('data/health.db');
console.log('HR samples:', db.prepare('SELECT COUNT(*) as c FROM v_unified_heart_rate').get());
console.log('Workouts:', db.prepare('SELECT COUNT(*) as c FROM v_unified_workouts').get());
console.log('Sleep:', db.prepare('SELECT COUNT(*) as c FROM v_unified_sleep').get());
console.log('HRV:', db.prepare('SELECT COUNT(*) as c FROM v_unified_hrv').get());
db.close();
"
```
Expected: Counts > 0 for each view

- [ ] **Step 4: Update PROGRESS.md**

Move "Define unified health data schema" from Next Up to Completed:
```
- ✅ Unified health schema: daily_summary table, 4 SQL views, timezone extraction, activity type normalization (2026-03-13)
```

Add new Next Up entry:
```
- ⏭️ HTML health dashboard
```

- [ ] **Step 5: Commit progress update**

```bash
git add PROGRESS.md
git commit -m "docs: update progress with unified schema completion"
```
