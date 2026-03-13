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
