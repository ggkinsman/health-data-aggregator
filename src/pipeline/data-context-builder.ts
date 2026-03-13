import type Database from 'better-sqlite3';
import type {
  DataContext, DaySnapshot, TrendSummary, TrendMetric,
  MonthlyAverage, YearOverYearComparison, Anomaly, SourceCoverage,
} from './types.js';

interface BuildOptions {
  today?: string;
  shortTermDays?: number;
  mediumTermDays?: number;
  longTermMonths?: number;
}

export function buildDataContext(
  db: Database.Database,
  options?: BuildOptions
): DataContext {
  const today = options?.today ?? new Date().toISOString().split('T')[0];
  const shortTermDays = options?.shortTermDays ?? 3;
  const mediumTermDays = options?.mediumTermDays ?? 30;
  const longTermMonths = options?.longTermMonths ?? 6;

  const timeRange = getTimeRange(db);
  const shortTerm = getShortTerm(db, today, shortTermDays);
  const mediumTerm = getMediumTerm(db, today, mediumTermDays);
  const longTerm = getLongTerm(db, today, longTermMonths);
  const yearOverYear = getYearOverYear(db, today);
  const anomalies = getAnomalies(db, today);
  const sourceCoverage = getSourceCoverage(db);
  const staleness = getStaleness(db);

  return { timeRange, shortTerm, mediumTerm, longTerm, yearOverYear, anomalies, sourceCoverage, staleness };
}

function getTimeRange(db: Database.Database): { earliest: string; latest: string } {
  const row = db.prepare(
    `SELECT MIN(day) AS earliest, MAX(day) AS latest FROM daily_summary`
  ).get() as { earliest: string | null; latest: string | null };
  return { earliest: row.earliest ?? '', latest: row.latest ?? '' };
}

function getShortTerm(db: Database.Database, today: string, days: number): DaySnapshot[] {
  const cutoff = offsetDay(today, -(days - 1));
  const rows = db.prepare(`
    SELECT * FROM daily_summary WHERE day >= ? AND day <= ? ORDER BY day
  `).all(cutoff, today) as any[];

  return rows.map(r => ({
    day: r.day,
    readinessScore: r.readiness_score,
    sleepScore: r.sleep_score,
    activityScore: r.activity_score,
    totalSleepMinutes: r.total_sleep_minutes,
    deepSleepMinutes: r.deep_sleep_minutes,
    remSleepMinutes: r.rem_sleep_minutes,
    sleepEfficiency: r.sleep_efficiency,
    avgRestingHr: r.avg_resting_hr,
    minHr: r.min_hr,
    maxHr: r.max_hr,
    avgHrv: r.avg_hrv,
    steps: r.steps,
    activeCalories: r.active_calories,
    workoutCount: r.workout_count,
    workoutMinutes: r.workout_minutes,
    sources: r.sources,
  }));
}

function getMediumTerm(db: Database.Database, today: string, days: number): TrendSummary {
  const cutoff = offsetDay(today, -days);
  const midpoint = offsetDay(today, -7);

  const metricColumns = [
    { name: 'totalSleepMinutes', col: 'total_sleep_minutes' },
    { name: 'deepSleepMinutes', col: 'deep_sleep_minutes' },
    { name: 'avgHrv', col: 'avg_hrv' },
    { name: 'avgRestingHr', col: 'avg_resting_hr' },
    { name: 'steps', col: 'steps' },
    { name: 'readinessScore', col: 'readiness_score' },
    { name: 'sleepScore', col: 'sleep_score' },
  ];

  const metrics: Record<string, TrendMetric> = {};

  for (const m of metricColumns) {
    const current = db.prepare(`
      SELECT AVG(${m.col}) AS avg_val FROM daily_summary
      WHERE day > ? AND day <= ? AND ${m.col} IS NOT NULL
    `).get(midpoint, today) as { avg_val: number | null };

    const prior = db.prepare(`
      SELECT AVG(${m.col}) AS avg_val FROM daily_summary
      WHERE day > ? AND day <= ? AND ${m.col} IS NOT NULL
    `).get(offsetDay(midpoint, -7), midpoint) as { avg_val: number | null };

    const thirtyDay = db.prepare(`
      SELECT AVG(${m.col}) AS avg_val FROM daily_summary
      WHERE day > ? AND day <= ? AND ${m.col} IS NOT NULL
    `).get(cutoff, today) as { avg_val: number | null };

    let direction: 'up' | 'down' | 'stable' = 'stable';
    if (current.avg_val !== null && prior.avg_val !== null && prior.avg_val !== 0) {
      const pctChange = (current.avg_val - prior.avg_val) / Math.abs(prior.avg_val);
      if (pctChange > 0.05) direction = 'up';
      else if (pctChange < -0.05) direction = 'down';
    }

    metrics[m.name] = {
      current7DayAvg: current.avg_val ? +current.avg_val.toFixed(1) : null,
      prior7DayAvg: prior.avg_val ? +prior.avg_val.toFixed(1) : null,
      thirtyDayAvg: thirtyDay.avg_val ? +thirtyDay.avg_val.toFixed(1) : null,
      direction,
    };
  }

  return { days, metrics };
}

function getLongTerm(db: Database.Database, today: string, months: number): MonthlyAverage[] {
  const cutoffDate = new Date(today);
  cutoffDate.setMonth(cutoffDate.getMonth() - months);
  const cutoff = cutoffDate.toISOString().split('T')[0];

  const rows = db.prepare(`
    SELECT
      strftime('%Y-%m', day) AS month,
      AVG(total_sleep_minutes) AS avg_sleep,
      AVG(deep_sleep_minutes) AS avg_deep,
      AVG(avg_hrv) AS avg_hrv,
      AVG(avg_resting_hr) AS avg_rhr,
      AVG(steps) AS avg_steps,
      AVG(readiness_score) AS avg_readiness
    FROM daily_summary
    WHERE day >= ?
    GROUP BY strftime('%Y-%m', day)
    ORDER BY month
  `).all(cutoff) as any[];

  return rows.map(r => ({
    month: r.month,
    avgSleepMinutes: r.avg_sleep ? +r.avg_sleep.toFixed(1) : null,
    avgDeepSleepMinutes: r.avg_deep ? +r.avg_deep.toFixed(1) : null,
    avgHrv: r.avg_hrv ? +r.avg_hrv.toFixed(1) : null,
    avgRestingHr: r.avg_rhr ? +r.avg_rhr.toFixed(1) : null,
    avgSteps: r.avg_steps ? +r.avg_steps.toFixed(0) : null,
    avgReadiness: r.avg_readiness ? +r.avg_readiness.toFixed(1) : null,
  }));
}

function getAnomalies(db: Database.Database, today: string): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const metricsToCheck = [
    { name: 'avgRestingHr', col: 'avg_resting_hr' },
    { name: 'avgHrv', col: 'avg_hrv' },
    { name: 'totalSleepMinutes', col: 'total_sleep_minutes' },
    { name: 'deepSleepMinutes', col: 'deep_sleep_minutes' },
    { name: 'steps', col: 'steps' },
  ];

  for (const m of metricsToCheck) {
    const rows = db.prepare(`
      WITH recent AS (
        SELECT day, ${m.col} AS val
        FROM daily_summary
        WHERE day <= ? AND ${m.col} IS NOT NULL
        ORDER BY day DESC
        LIMIT 90
      ),
      stats AS (
        SELECT AVG(val) AS mean_val, AVG(val * val) - AVG(val) * AVG(val) AS variance
        FROM recent
      )
      SELECT r.day, r.val, s.mean_val,
        CASE WHEN s.variance > 0 THEN SQRT(s.variance) ELSE 0 END AS std_dev
      FROM recent r, stats s
      WHERE r.day > date(?, '-7 days')
        AND s.variance > 0
        AND ABS(r.val - s.mean_val) > 2 * SQRT(s.variance)
      ORDER BY r.day DESC
    `).all(today, today) as any[];

    for (const r of rows) {
      anomalies.push({
        day: r.day,
        metric: m.name,
        value: r.val,
        mean90d: +r.mean_val.toFixed(1),
        stdDev90d: +r.std_dev.toFixed(1),
        deviations: +((Math.abs(r.val - r.mean_val) / r.std_dev).toFixed(1)),
      });
    }
  }

  return anomalies.sort((a, b) => b.deviations - a.deviations);
}

function getSourceCoverage(db: Database.Database): SourceCoverage {
  const oura = db.prepare(`
    SELECT MIN(day) AS earliest, MAX(day) AS latest
    FROM daily_summary WHERE sources LIKE '%oura%'
  `).get() as { earliest: string | null; latest: string | null };

  const ah = db.prepare(`
    SELECT MIN(day) AS earliest, MAX(day) AS latest
    FROM daily_summary WHERE sources LIKE '%apple_health%'
  `).get() as { earliest: string | null; latest: string | null };

  return {
    oura: { earliest: oura.earliest, latest: oura.latest },
    appleHealth: { earliest: ah.earliest, latest: ah.latest },
    cpap: { earliest: null, latest: null },
  };
}

function getYearOverYear(db: Database.Database, today: string): YearOverYearComparison[] {
  const currentMonth = today.substring(0, 7);
  const currentYear = parseInt(today.substring(0, 4));
  const priorYear = currentYear - 1;
  const priorMonth = `${priorYear}${today.substring(4, 7)}`;

  const metricCols = [
    { name: 'avgSleepMinutes', col: 'total_sleep_minutes' },
    { name: 'avgHrv', col: 'avg_hrv' },
    { name: 'avgRestingHr', col: 'avg_resting_hr' },
    { name: 'avgSteps', col: 'steps' },
  ];

  const results: YearOverYearComparison[] = [];

  const priorCount = db.prepare(
    `SELECT COUNT(*) AS cnt FROM daily_summary WHERE strftime('%Y-%m', day) = ?`
  ).get(priorMonth) as { cnt: number };

  if (priorCount.cnt === 0) return results;

  const metrics: Record<string, { current: number | null; prior: number | null; changePercent: number | null }> = {};

  for (const m of metricCols) {
    const curr = db.prepare(
      `SELECT AVG(${m.col}) AS val FROM daily_summary WHERE strftime('%Y-%m', day) = ? AND ${m.col} IS NOT NULL`
    ).get(currentMonth) as { val: number | null };

    const prior = db.prepare(
      `SELECT AVG(${m.col}) AS val FROM daily_summary WHERE strftime('%Y-%m', day) = ? AND ${m.col} IS NOT NULL`
    ).get(priorMonth) as { val: number | null };

    let changePercent: number | null = null;
    if (curr.val !== null && prior.val !== null && prior.val !== 0) {
      changePercent = +((curr.val - prior.val) / Math.abs(prior.val) * 100).toFixed(1);
    }

    metrics[m.name] = {
      current: curr.val ? +curr.val.toFixed(1) : null,
      prior: prior.val ? +prior.val.toFixed(1) : null,
      changePercent,
    };
  }

  results.push({ month: currentMonth, priorMonth, metrics });
  return results;
}

function getStaleness(db: Database.Database): { lastSyncAt: string | null; isStale: boolean } {
  const row = db.prepare(
    `SELECT MAX(last_synced_at) AS last FROM sync_metadata`
  ).get() as { last: string | null };

  if (!row.last) return { lastSyncAt: null, isStale: true };

  const hoursSince = (Date.now() - new Date(row.last).getTime()) / 3600000;
  return { lastSyncAt: row.last, isStale: hoursSince > 48 };
}

function offsetDay(base: string, offset: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}
