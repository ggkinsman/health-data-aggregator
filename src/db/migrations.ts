import type Database from 'better-sqlite3';
import {
  VIEW_UNIFIED_HEART_RATE,
  VIEW_UNIFIED_WORKOUTS,
  VIEW_UNIFIED_SLEEP,
  VIEW_UNIFIED_HRV,
} from '../unified/views.js';

/**
 * Run database migrations up to the latest version.
 * Uses SQLite user_version pragma for version tracking.
 */
export function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', {
    simple: true,
  }) as number;

  if (currentVersion < 1) {
    migrateV1(db);
  }
  if (currentVersion < 2) {
    migrateV2(db);
  }
  if (currentVersion < 3) {
    migrateV3(db);
  }
}

/**
 * V1: Initial schema - Oura data tables + sync metadata
 */
function migrateV1(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS oura_daily_readiness (
      id TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      score INTEGER,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_oura_daily_readiness_day ON oura_daily_readiness(day);

    CREATE TABLE IF NOT EXISTS oura_daily_sleep (
      id TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      score INTEGER,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_oura_daily_sleep_day ON oura_daily_sleep(day);

    CREATE TABLE IF NOT EXISTS oura_daily_activity (
      id TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      score INTEGER,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_oura_daily_activity_day ON oura_daily_activity(day);

    CREATE TABLE IF NOT EXISTS oura_sleep_sessions (
      id TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_oura_sleep_sessions_day ON oura_sleep_sessions(day);

    CREATE TABLE IF NOT EXISTS oura_heart_rate (
      timestamp TEXT NOT NULL,
      bpm INTEGER NOT NULL,
      source TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (timestamp, bpm, source)
    );
    CREATE INDEX IF NOT EXISTS idx_oura_heart_rate_timestamp ON oura_heart_rate(timestamp);

    CREATE TABLE IF NOT EXISTS oura_workouts (
      id TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_oura_workouts_day ON oura_workouts(day);

    CREATE TABLE IF NOT EXISTS oura_sessions (
      id TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_oura_sessions_day ON oura_sessions(day);

    CREATE TABLE IF NOT EXISTS oura_tags (
      id TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_oura_tags_day ON oura_tags(day);

    CREATE TABLE IF NOT EXISTS oura_personal_info (
      id TEXT PRIMARY KEY DEFAULT 'default',
      raw_json TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_metadata (
      source TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      last_synced_date TEXT NOT NULL,
      last_synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      record_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (source, endpoint)
    );

    PRAGMA user_version = 1;
  `);
}

/**
 * V2: Apple Health tables - records and workouts from XML exports
 */
function migrateV2(db: Database.Database): void {
  db.exec(`
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
  `);
}

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
