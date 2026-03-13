# Workout Deduplication Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix workout double-counting by implementing source-priority deduplication (Apple Health > Oura) in the daily summary builder.

**Architecture:** When building daily summaries, fetch workouts from both sources with time data, discard Oura workouts that overlap with any Apple Health workout, then count and sum minutes from the deduplicated list only.

**Tech Stack:** TypeScript, vitest, better-sqlite3

**Spec:** `docs/superpowers/specs/2026-03-13-workout-dedup-design.md`

---

## File Map

- **Modify:** `src/unified/summary-builder.ts:183-208` — Replace workout aggregation with dedup logic
- **Modify:** `src/unified/__tests__/summary-builder.test.ts:152-171` — Update existing test, add dedup test cases

---

## Chunk 1: Tests and Implementation

### Task 1: Add failing test for overlapping workouts

**Files:**
- Modify: `src/unified/__tests__/summary-builder.test.ts:152-171`

- [ ] **Step 1: Add test for overlapping workouts deduped to count 1**

Insert before the closing `});` of the describe block (line 172):

```typescript
  it('deduplicates overlapping workouts — keeps Apple Health, discards Oura', () => {
    // Same morning run recorded by both devices
    db.prepare(
      `INSERT INTO oura_workouts (id, day, raw_json) VALUES (?, ?, ?)`
    ).run('workout-oura-1', '2024-06-15', JSON.stringify({
      activity: 'running',
      start_datetime: '2024-06-15T07:00:00+00:00',
      end_datetime: '2024-06-15T07:45:00+00:00',
    }));

    db.prepare(
      `INSERT INTO apple_health_workouts (activity_type, source_name, start_date, end_date, duration, raw_json) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('HKWorkoutActivityTypeRunning', 'Watch', '2024-06-15T07:01:00.000Z', '2024-06-15T07:44:00.000Z', 43, '{}');

    const results = buildDailySummaries(db);

    expect(results.length).toBe(1);
    expect(results[0].workout_count).toBe(1);
    expect(results[0].workout_minutes).toBe(43);
  });
```

- [ ] **Step 2: Add test for Oura-only workout kept when no AH workouts exist**

```typescript
  it('keeps Oura-only workout when no Apple Health workouts exist', () => {
    db.prepare(
      `INSERT INTO oura_workouts (id, day, raw_json) VALUES (?, ?, ?)`
    ).run('workout-oura-only', '2024-06-15', JSON.stringify({
      activity: 'walking',
      start_datetime: '2024-06-15T12:00:00+00:00',
      end_datetime: '2024-06-15T12:30:00+00:00',
    }));

    const results = buildDailySummaries(db);

    expect(results.length).toBe(1);
    expect(results[0].workout_count).toBe(1);
    expect(results[0].workout_minutes).toBe(30);
    expect(results[0].sources).toBe('oura');
  });
```

- [ ] **Step 3: Add test for Oura workout with missing timestamps kept**

```typescript
  it('keeps Oura workout when timestamps are missing (cannot prove overlap)', () => {
    db.prepare(
      `INSERT INTO oura_workouts (id, day, raw_json) VALUES (?, ?, ?)`
    ).run('workout-no-times', '2024-06-15', JSON.stringify({
      activity: 'walking',
    }));

    db.prepare(
      `INSERT INTO apple_health_workouts (activity_type, source_name, start_date, end_date, duration, raw_json) VALUES (?, ?, ?, ?, ?, ?)`
    ).run('HKWorkoutActivityTypeWalking', 'Watch', '2024-06-15T08:00:00.000Z', '2024-06-15T08:30:00.000Z', 30, '{}');

    const results = buildDailySummaries(db);

    expect(results.length).toBe(1);
    // Both kept: AH workout + Oura workout (no timestamps to compare)
    expect(results[0].workout_count).toBe(2);
  });
```

- [ ] **Step 4: Run tests to verify the overlap test fails**

Run: `npm run test:run`
Expected: 1 new test FAILS (overlap test expects count 1 but gets 2). The Oura-only and missing-timestamps tests should pass with the current code since it already counts all workouts.

Note: The existing "counts workouts from both sources" test (non-overlapping workouts at 7am and 6pm) already covers the "non-overlapping from both sources → count as 2" spec requirement.

- [ ] **Step 5: Commit failing tests**

```bash
git add src/unified/__tests__/summary-builder.test.ts
git commit -m "test: add failing tests for workout deduplication"
```

---

### Task 2: Implement dedup logic in summary builder

**Files:**
- Modify: `src/unified/summary-builder.ts:183-208`

- [ ] **Step 1: Replace the workout section of buildDay()**

Replace lines 183-208 (from `// Workouts from both sources` through the last `for` loop closing brace) with:

```typescript
  // Workouts: source-priority dedup (Apple Health > Oura)
  const ouraWorkouts = db.prepare(
    `SELECT raw_json FROM oura_workouts WHERE day = ?`
  ).all(day) as { raw_json: string }[];

  const ahWorkouts = db.prepare(
    `SELECT start_date, end_date, duration FROM apple_health_workouts WHERE DATE(start_date) = ?`
  ).all(day) as { start_date: string; end_date: string; duration: number | null }[];

  // Parse AH time intervals for overlap checking
  const ahIntervals = ahWorkouts.map(w => ({
    start: new Date(w.start_date).getTime(),
    end: new Date(w.end_date).getTime(),
    duration: w.duration,
  }));

  // Keep Oura workouts that don't overlap with any AH workout
  const keptOuraWorkouts: { startMs: number; endMs: number }[] = [];
  for (const w of ouraWorkouts) {
    const data = JSON.parse(w.raw_json);
    if (!data.start_datetime || !data.end_datetime) {
      // No timestamps — can't prove overlap, keep it
      keptOuraWorkouts.push({ startMs: 0, endMs: 0 });
      continue;
    }
    const oStart = new Date(data.start_datetime).getTime();
    const oEnd = new Date(data.end_datetime).getTime();
    const overlaps = ahIntervals.some(ah => oStart < ah.end && oEnd > ah.start);
    if (!overlaps) {
      keptOuraWorkouts.push({ startMs: oStart, endMs: oEnd });
    }
  }

  // Count and sum minutes from deduplicated list
  const workoutCount = ahWorkouts.length + keptOuraWorkouts.length;
  let workoutMinutes = 0;

  for (const w of ahWorkouts) {
    sources.add('apple_health');
    if (w.duration) workoutMinutes += w.duration;
  }

  for (const w of keptOuraWorkouts) {
    sources.add('oura');
    if (w.startMs && w.endMs) {
      workoutMinutes += (w.endMs - w.startMs) / 60000;
    }
  }
```

- [ ] **Step 2: Run all tests**

Run: `npm run test:run`
Expected: ALL 99 tests pass (96 existing + 3 new). The existing "counts workouts from both sources" test still passes because those workouts don't overlap (7:00-7:45 running vs 18:00-18:30 yoga).

- [ ] **Step 3: Commit implementation**

```bash
git add src/unified/summary-builder.ts
git commit -m "fix: deduplicate workouts using source-priority (Apple Health > Oura)

Overlapping workouts from both sources now count as one, keeping the
Apple Health version. Oura-only workouts (no time overlap) are preserved.

Spec: docs/superpowers/specs/2026-03-13-workout-dedup-design.md"
```

---

### Task 3: Rebuild summaries

- [ ] **Step 1: Rebuild all daily summaries with corrected counts**

Run: `npm run build:summaries`

This will reprocess all historical days using the new dedup logic, fixing the inflated workout counts.
