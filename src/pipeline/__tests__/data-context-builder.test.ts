import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../db/migrations.js';
import { buildDataContext } from '../data-context-builder.js';

describe('buildDataContext', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  it('returns empty context when no data exists', () => {
    const ctx = buildDataContext(db);
    expect(ctx.shortTerm).toHaveLength(0);
    expect(ctx.anomalies).toHaveLength(0);
  });

  it('populates shortTerm from daily_summary for last 3 days', () => {
    const today = '2026-03-13';
    insertSummary(db, { day: '2026-03-11', sleep_score: 80, sources: 'oura' });
    insertSummary(db, { day: '2026-03-12', sleep_score: 75, sources: 'oura' });
    insertSummary(db, { day: '2026-03-13', sleep_score: 85, sources: 'oura' });
    insertSummary(db, { day: '2026-03-09', sleep_score: 70, sources: 'oura' });

    const ctx = buildDataContext(db, { today });
    expect(ctx.shortTerm).toHaveLength(3);
    expect(ctx.shortTerm[0].day).toBe('2026-03-11');
    expect(ctx.shortTerm[2].sleepScore).toBe(85);
  });

  it('computes mediumTerm trend direction', () => {
    const today = '2026-03-13';
    for (let i = 0; i < 7; i++) {
      const day1 = offsetDay(today, -(13 - i));
      const day2 = offsetDay(today, -(6 - i));
      insertSummary(db, { day: day1, total_sleep_minutes: 420, sources: 'oura' });
      insertSummary(db, { day: day2, total_sleep_minutes: 390, sources: 'oura' });
    }

    const ctx = buildDataContext(db, { today });
    expect(ctx.mediumTerm.metrics['totalSleepMinutes'].direction).toBe('down');
  });

  it('computes longTerm monthly averages', () => {
    const today = '2026-03-13';
    insertSummary(db, { day: '2026-01-15', avg_hrv: 40, sources: 'oura' });
    insertSummary(db, { day: '2026-01-16', avg_hrv: 44, sources: 'oura' });
    insertSummary(db, { day: '2026-02-15', avg_hrv: 48, sources: 'oura' });

    const ctx = buildDataContext(db, { today });
    expect(ctx.longTerm.length).toBeGreaterThanOrEqual(2);
    const jan = ctx.longTerm.find(m => m.month === '2026-01');
    expect(jan?.avgHrv).toBe(42);
  });

  it('detects anomalies >2 std deviations from 90-day rolling avg', () => {
    const today = '2026-03-13';
    for (let i = 90; i >= 2; i--) {
      insertSummary(db, {
        day: offsetDay(today, -i),
        avg_resting_hr: 55 + (i % 2 === 0 ? 1 : -1),
        sources: 'oura',
      });
    }
    insertSummary(db, {
      day: offsetDay(today, -1),
      avg_resting_hr: 72,
      sources: 'oura',
    });

    const ctx = buildDataContext(db, { today });
    const hrAnomaly = ctx.anomalies.find(a => a.metric === 'avgRestingHr');
    expect(hrAnomaly).toBeDefined();
    expect(hrAnomaly!.deviations).toBeGreaterThan(2);
  });

  it('reports source coverage dates', () => {
    insertSummary(db, { day: '2026-01-01', sources: 'oura' });
    insertSummary(db, { day: '2026-03-13', sources: 'apple_health,oura' });

    const ctx = buildDataContext(db);
    expect(ctx.sourceCoverage.oura.earliest).toBe('2026-01-01');
    expect(ctx.sourceCoverage.oura.latest).toBe('2026-03-13');
  });

  it('returns time range from data', () => {
    insertSummary(db, { day: '2025-12-01', sources: 'oura' });
    insertSummary(db, { day: '2026-03-13', sources: 'oura' });

    const ctx = buildDataContext(db);
    expect(ctx.timeRange.earliest).toBe('2025-12-01');
    expect(ctx.timeRange.latest).toBe('2026-03-13');
  });
});

// --- Helpers ---

function offsetDay(base: string, offset: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

function insertSummary(db: Database.Database, partial: {
  day: string;
  readiness_score?: number | null;
  sleep_score?: number | null;
  activity_score?: number | null;
  total_sleep_minutes?: number | null;
  deep_sleep_minutes?: number | null;
  rem_sleep_minutes?: number | null;
  sleep_efficiency?: number | null;
  avg_resting_hr?: number | null;
  min_hr?: number | null;
  max_hr?: number | null;
  avg_hrv?: number | null;
  steps?: number | null;
  active_calories?: number | null;
  workout_count?: number | null;
  workout_minutes?: number | null;
  sources: string;
}): void {
  db.prepare(`
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
      NULL, NULL,
      NULL, NULL, NULL,
      ?, datetime('now')
    )
  `).run(
    partial.day,
    partial.readiness_score ?? null,
    partial.sleep_score ?? null,
    partial.activity_score ?? null,
    partial.total_sleep_minutes ?? null,
    partial.deep_sleep_minutes ?? null,
    partial.rem_sleep_minutes ?? null,
    partial.sleep_efficiency ?? null,
    partial.avg_resting_hr ?? null,
    partial.min_hr ?? null,
    partial.max_hr ?? null,
    partial.avg_hrv ?? null,
    partial.steps ?? null,
    partial.active_calories ?? null,
    partial.workout_count ?? null,
    partial.workout_minutes ?? null,
    partial.sources,
  );
}
