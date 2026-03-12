import type Database from 'better-sqlite3';

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
