#!/usr/bin/env npx tsx
/**
 * health-card.ts — generate a compact Telegram-ready text card from SQLite
 *
 * Queries daily_summary, cpap_sessions, and apple_health_records directly —
 * no API calls, no pipeline cost. Prints the card to stdout.
 *
 * Usage: npx tsx scripts/health-card.ts [daily|weekly]
 */

import { openDatabase } from '../src/db/database.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../data/health.db');

const db = openDatabase(DB_PATH);

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(val: number | null | undefined, decimals = 0, unit = ''): string {
  if (val == null) return '—';
  return val.toFixed(decimals) + unit;
}

function fmtMins(mins: number | null | undefined): string {
  if (mins == null) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Days between two YYYY-MM-DD strings
function daysDiff(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function staleNote(dataDay: string, today: string): string {
  const d = daysDiff(dataDay, today);
  if (d <= 1) return '';
  return ` (${d}d ago)`;
}

// ── Today ─────────────────────────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10);

// ── Latest daily summary ──────────────────────────────────────────────────────

const summary = db.prepare(`
  SELECT * FROM daily_summary ORDER BY day DESC LIMIT 1
`).get() as Record<string, number | string | null> | undefined;

if (!summary) {
  console.log('No daily summary data available.');
  process.exit(0);
}

const summaryDay = summary.day as string;
const displayDate = new Date(summaryDay + 'T12:00:00').toLocaleDateString('en-US', {
  weekday: 'short', month: 'short', day: 'numeric'
});

// Most recent row with sleep detail
const sleepRow = db.prepare(`
  SELECT day, total_sleep_minutes, deep_sleep_minutes, rem_sleep_minutes, sleep_score
  FROM daily_summary
  WHERE total_sleep_minutes IS NOT NULL
  ORDER BY day DESC LIMIT 1
`).get() as Record<string, number | string | null> | undefined;

// ── Latest CPAP session ───────────────────────────────────────────────────────

const cpap = db.prepare(`
  SELECT * FROM cpap_sessions ORDER BY day DESC LIMIT 1
`).get() as Record<string, number | string | null> | undefined;

// ── Latest Apple Watch daytime HRV ───────────────────────────────────────────
// Preferred over Oura nocturnal HRV — CPAP pressure suppresses RSA (see CLAUDE.md)

const appleHrv = db.prepare(`
  SELECT CAST(value AS REAL) as hrv, date(start_date) as day
  FROM apple_health_records
  WHERE type = 'HeartRateVariabilitySDNN'
    AND source_name LIKE '%Watch%'
  ORDER BY start_date DESC
  LIMIT 1
`).get() as { hrv: number; day: string } | undefined;

// ── Latest Apple Watch resting HR ─────────────────────────────────────────────

const appleRhr = db.prepare(`
  SELECT CAST(value AS REAL) as rhr, date(start_date) as day
  FROM apple_health_records
  WHERE type = 'RestingHeartRate'
    AND source_name LIKE '%Watch%'
  ORDER BY start_date DESC
  LIMIT 1
`).get() as { rhr: number; day: string } | undefined;

// ── Build card ────────────────────────────────────────────────────────────────

const readiness = fmt(summary.readiness_score as number);
const sleep     = fmt(summary.sleep_score as number);
const activity  = fmt(summary.activity_score as number);

const sleepDur  = sleepRow ? fmtMins(sleepRow.total_sleep_minutes as number) : '—';
const deep      = sleepRow ? fmtMins(sleepRow.deep_sleep_minutes as number) : '—';
const rem       = sleepRow ? fmtMins(sleepRow.rem_sleep_minutes as number) : '—';
const sleepNote = sleepRow ? staleNote(sleepRow.day as string, today) : '';

const steps    = summary.steps ? Number(summary.steps).toLocaleString() : '—';
const cals     = summary.active_calories ? `${summary.active_calories} kcal` : '—';
const workouts = summary.workout_count
  ? `${summary.workout_count} (${fmtMins(summary.workout_minutes as number)})`
  : '—';

// HRV: Apple Watch daytime preferred
const hrv     = appleHrv ? fmt(appleHrv.hrv, 0, 'ms') : fmt(summary.avg_hrv as number, 0, 'ms');
const hrvNote = appleHrv ? staleNote(appleHrv.day, today) : '';
const rhr     = appleRhr ? fmt(appleRhr.rhr, 0, ' bpm') : fmt(summary.avg_resting_hr as number, 0, ' bpm');
const rhrNote = appleRhr ? staleNote(appleRhr.day, today) : '';

const ahi      = cpap ? fmt(cpap.ahi as number, 1) : '—';
const cpapHrs  = cpap ? fmtMins(cpap.usage_minutes as number) : '—';
const pressure = cpap ? fmt(cpap.mask_pressure_50 as number, 1, 'cm') : '—';  // cmH₂O → cm saves space
const leak     = cpap ? fmt(cpap.leak_50 as number, 1, 'L/m') : '—';          // L/min → L/m saves space
const cpapNote = cpap ? staleNote(cpap.day as string, today) : '';

const location = summary.location_label ? ` — ${summary.location_label}` : '';

// Only include a line if it has at least one real value (not all dashes)
const lines: string[] = [];
lines.push(`📊 Daily Health — ${displayDate}${location}`);
lines.push('');
lines.push(`🟢 Scores  R:${readiness}  S:${sleep}  A:${activity}`);

if (sleepDur !== '—' || deep !== '—' || rem !== '—') {
  lines.push(`💤 Sleep   ${sleepDur}  Deep ${deep}  REM ${rem}${sleepNote}`);
}

if (rhr !== '—' || hrv !== '—') {
  lines.push(`❤️  HR     RHR ${rhr}${rhrNote}  HRV ${hrv}${hrvNote}`);
}

if (ahi !== '—' || cpapHrs !== '—') {
  lines.push(`😮 CPAP   AHI ${ahi}  ${cpapHrs}  P50 ${pressure}  Leak ${leak}${cpapNote}`);
}

if (steps !== '—' || cals !== '—' || workouts !== '—') {
  lines.push(`🏃 Move   ${steps} steps  ${cals}  Workouts ${workouts}`);
}

console.log(lines.join('\n'));
