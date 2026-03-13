# Apple Health XML Parser — Design Spec

**Date:** 2026-03-12
**Status:** Approved
**Goal:** Parse Apple Health XML exports and store sleep, heart rate, HRV, and workout data in SQLite for cross-source analysis with Oura and future CPAP data.

---

## Scope

Parse these record types from Apple Health `export.xml` (2.8 GB, ~6.5M records):

| Type | Apple Health Identifier | Estimated Records |
|------|------------------------|-------------------|
| Sleep | `HKCategoryTypeIdentifierSleepAnalysis` | 105K |
| Heart Rate | `HKQuantityTypeIdentifierHeartRate` | 1.3M |
| HRV | `HKQuantityTypeIdentifierHeartRateVariabilitySDNN` | 22K |
| Resting HR | `HKQuantityTypeIdentifierRestingHeartRate` | 2.6K |
| Workouts | `Workout` elements | ~250 |

All other record types are skipped during parsing. The type filter is a simple set — easy to expand later.

---

## Architecture

### Parser (`src/apple-health/parser.ts`)

SAX streaming parser using the `sax` npm package. Pure function — no database knowledge.

**Interface:**
```typescript
function parseAppleHealthExport(
  filePath: string,
  onRecordBatch: (records: AppleHealthRecord[]) => void,
  onWorkoutBatch: (workouts: AppleHealthWorkout[]) => void,
  options?: { batchSize?: number }
): Promise<ParseSummary>
```

**Behavior:**
- Streams XML with `sax.createStream(strict=true)`
- On each `<Record>` open tag: checks `type` attribute against filter set. If matched, extracts attributes into `AppleHealthRecord` and adds to batch buffer.
- On each `<Workout>` open tag: extracts attributes. Collects child `<WorkoutStatistics>` and `<WorkoutEvent>` elements until the closing `</Workout>` tag.
- Emits batches every 5,000 records via callbacks.
- Logs progress every 50,000 records processed (matched + skipped).
- Returns a `ParseSummary` with counts per type and total processing time.

**Timestamp normalization:**
Apple Health uses `2024-01-15 08:30:00 -0500` format. Normalize to ISO 8601 (`2024-01-15T13:30:00.000Z`) on parse to match Oura's timestamp format. Use explicit regex parsing — split on space-separated components, reconstruct as `YYYY-MM-DDTHH:MM:SS±HH:MM`, then `new Date().toISOString()`. Do not rely on `new Date(rawString)` directly as the space-separated format is not guaranteed across JS engines. Normalize all timestamp fields: `startDate`, `endDate`, `creationDate` (when present), and `WorkoutEvent` dates.

**Error handling:**
- The returned promise rejects on stream `error` or SAX parse error events
- If a batch callback throws, the stream is destroyed and the promise rejects with the error
- The import script logs the record count at point of failure for debugging
- Pre-flight check: verify file exists and ends in `.xml` before starting SAX stream

### Types (`src/apple-health/types.ts`)

```typescript
export interface AppleHealthRecord {
  type: string;
  sourceName: string;
  sourceVersion?: string;
  unit?: string;
  value?: string;
  startDate: string;  // ISO 8601 (normalized)
  endDate: string;    // ISO 8601 (normalized)
  device?: string;
  creationDate?: string;
}

export interface AppleHealthWorkout {
  activityType: string;
  sourceName: string;
  startDate: string;  // ISO 8601 (normalized)
  endDate: string;    // ISO 8601 (normalized)
  duration?: number;  // minutes
  durationUnit?: string;
  totalDistance?: number;
  totalDistanceUnit?: string;
  totalEnergyBurned?: number;
  totalEnergyBurnedUnit?: string;
  statistics: WorkoutStatistic[];
  events: WorkoutEvent[];
}

export interface WorkoutStatistic {
  type: string;
  sum?: string;
  average?: string;
  minimum?: string;
  maximum?: string;
  unit?: string;
}

export interface WorkoutEvent {
  type: string;
  startDate: string;
  endDate: string;
}

export interface ParseSummary {
  totalProcessed: number;
  recordCounts: Record<string, number>;
  workoutCount: number;
  durationMs: number;
}
```

### Repository (`src/apple-health/repository.ts`)

Follows the `OuraRepository` pattern.

```typescript
export class AppleHealthRepository {
  upsertRecords(records: AppleHealthRecord[]): number;
  upsertWorkouts(workouts: AppleHealthWorkout[]): number;
  updateSyncMetadata(recordCounts: Record<string, number>): void;
}
```

**Upsert strategy:**
- Records: `INSERT OR REPLACE` with composite PK `(type, source_name, start_date, end_date)` — includes `end_date` because Apple Watch HR records can share the same type/source/start but differ by end time
- Workouts: `INSERT OR REPLACE` with composite PK `(activity_type, source_name, start_date)`
- Both store `raw_json` column with full parsed object (matches Oura pattern)
- Uses SQLite transactions for batch inserts (same as `OuraRepository`)

### Database Schema (V2 Migration)

Add a `migrateV2` function to `src/db/migrations.ts` and add `if (currentVersion < 2) { migrateV2(db); }` to `runMigrations`, following the existing V1 pattern:

```sql
CREATE TABLE IF NOT EXISTS apple_health_records (
  type TEXT NOT NULL,
  source_name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  value TEXT,
  unit TEXT,
  raw_json TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (type, source_name, start_date, end_date)
);
CREATE INDEX IF NOT EXISTS idx_apple_health_records_type ON apple_health_records(type);
CREATE INDEX IF NOT EXISTS idx_apple_health_records_start_date ON apple_health_records(start_date);

CREATE TABLE IF NOT EXISTS apple_health_workouts (
  activity_type TEXT NOT NULL,
  source_name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  duration REAL,
  total_distance REAL,
  total_energy_burned REAL,
  raw_json TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (activity_type, source_name, start_date)
);
CREATE INDEX IF NOT EXISTS idx_apple_health_workouts_start_date ON apple_health_workouts(start_date);

PRAGMA user_version = 2;
```

### Import Script (`scripts/import-apple-health.ts`)

**Usage:** `npm run import:apple <path-to-export.xml>`

**Behavior:**
1. Opens SQLite database, runs migrations
2. Calls `parseAppleHealthExport()` with callbacks that upsert batches
3. Updates `sync_metadata` table: one row per type with `source = 'apple_health'`, `endpoint = type_name` (e.g. `HKQuantityTypeIdentifierHeartRate`), `last_synced_date = today`. This gives queryable per-type counts while reusing the existing table.
4. Prints summary: record counts per type, total records, duration

**Example output:**
```
Importing Apple Health data from: data/apple-health/apple_health_export/export.xml
Progress: 50,000 records processed...
Progress: 100,000 records processed...
...

Import complete:
  Sleep records:     105,464
  Heart rate:      1,346,845
  HRV:               21,915
  Resting HR:         2,638
  Workouts:             256
  Total:           1,477,118
  Duration:            45.2s

Saved to: data/health.db
```

---

## File Structure

```
src/
  apple-health/
    types.ts
    parser.ts
    repository.ts
    index.ts
    __tests__/
      parser.test.ts
      repository.test.ts
scripts/
  import-apple-health.ts
```

---

## Cross-Source Compatibility

**Join points with existing data:**

| Apple Health | Oura | CPAP (future) | Workout Tracker |
|-------------|------|---------------|-----------------|
| Sleep stages (by date) | Sleep sessions (by day) | Usage hours (by date) | — |
| Heart rate (by timestamp) | Heart rate (by timestamp) | — | HR samples (by timestamp) |
| HRV (by date) | HRV (by day) | — | — |
| Workouts (by start time) | Workouts (by start_datetime) | — | Workouts (by start_time) |

**All sources share:**
- ISO 8601 timestamps
- `source_name` / source identification
- `raw_json` for full detail access
- `sync_metadata` tracking

---

## Testing Strategy

**Parser tests** (`parser.test.ts`):
- Small XML string fixtures (not the real 2.8 GB file)
- Tests: parses Record attributes correctly, filters by type, handles Workout with child elements, normalizes timestamps, emits batches at correct size, returns accurate ParseSummary

**Repository tests** (`repository.test.ts`):
- In-memory SQLite database
- Tests: upserts records, handles duplicates (same PK = update), upserts workouts, updates sync metadata

---

## Dependencies

- `sax` — SAX streaming XML parser (add to dependencies)
- `@types/sax` — TypeScript types (add to devDependencies)
- `better-sqlite3` — already installed
