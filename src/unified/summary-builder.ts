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
