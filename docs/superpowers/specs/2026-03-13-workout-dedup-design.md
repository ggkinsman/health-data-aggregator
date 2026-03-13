# Workout Deduplication: Source-Priority Strategy

## Problem

The daily summary builder (`src/unified/summary-builder.ts`, line 192) counts workouts from Oura and Apple Health by simple addition:

```typescript
const workoutCount = ouraWorkouts.length + ahWorkouts.length;
```

When the same physical workout is recorded by both Apple Watch and Oura Ring, it gets counted twice. This inflates `workout_count`, `workout_minutes`, and all downstream dashboard totals (e.g., 180 workouts in a single month, 2,962 total workouts).

## Decision

Use **source-priority deduplication**, the same approach Apple Health uses natively. Apple Health (Apple Watch) is the higher-priority source for workouts because:

- Apple Watch is more accurate for active heart rate and calorie tracking during exercise
- Apple Watch is always worn during workouts (Oura ring is removed for barbell/dumbbell work)
- This mirrors the industry-standard pattern used by Apple Health, Cronometer, and other aggregators

## Design

### Overlap Detection

For each Oura workout, check if any Apple Health workout overlaps in time using standard interval overlap:

```
oura.start < ah.end AND oura.end > ah.start
```

No fuzzy tolerance is needed — we're detecting the same real-world activity recorded by two devices.

### Priority Resolution

1. **Apple Health workouts are always kept** (higher priority)
2. **Oura workouts that overlap with any Apple Health workout are discarded** (duplicate)
3. **Oura workouts with no overlap are kept** (ring-only sessions)

### Edge Cases

- **Oura workout with missing timestamps**: If `start_datetime` or `end_datetime` is missing from raw_json, the workout cannot be compared for overlap. Keep it (no overlap can be proven).
- **Multiple AH workouts overlapping one Oura workout**: The algorithm handles this naturally — if *any* AH workout overlaps, the Oura workout is discarded.
- **Sources tracking**: Discarded Oura workouts should not add `'oura'` to the sources set for workout purposes. (Oura scores/sleep already add to sources independently.)

### Counting

Count and sum minutes from the deduplicated list only. For kept Apple Health workouts, use `duration`. For kept Oura workouts, compute duration from `start_datetime`/`end_datetime`.

## Scope

### Changes

- **`src/unified/summary-builder.ts`** — Replace lines 183-208 (workout section of `buildDay()`): update AH query to also select `start_date` and `end_date` (needed for overlap check), add dedup logic
- **`src/unified/__tests__/summary-builder.test.ts`** — Update existing workout test, add new tests:
  - Overlapping workouts from both sources → count as 1, use Apple Health duration
  - Non-overlapping workouts from both sources → count as 2
  - Oura-only workout with no Apple Health overlap → kept

### Not Changing

- No new tables or migrations
- No changes to import or sync scripts
- Dashboard HTML is unaffected (reads from `daily_summary`)

### Post-Fix

Run `npm run build:summaries` to rebuild all daily summaries with corrected counts.

## Data Shapes

### Apple Health Workouts Table

| Column | Type | Notes |
|--------|------|-------|
| `start_date` | TEXT | ISO timestamp |
| `end_date` | TEXT | ISO timestamp |
| `duration` | REAL | Minutes |

### Oura Workouts (from `raw_json`)

| Field | Type | Notes |
|-------|------|-------|
| `start_datetime` | string | ISO timestamp |
| `end_datetime` | string | ISO timestamp |
| Duration | computed | `(end - start) / 60000` ms → minutes |
