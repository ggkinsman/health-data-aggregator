import type Database from 'better-sqlite3';
import type {
  DailyReadiness,
  DailySleep,
  DailyActivity,
  SleepSession,
  HeartRate,
  Workout,
  Session,
  Tag,
  PersonalInfo,
} from '../oura/types.js';

const SOURCE = 'oura';

/**
 * Repository for upserting Oura data into SQLite.
 */
export class OuraRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  upsertDailyReadiness(records: DailyReadiness[]): number {
    return this.upsertWithId('oura_daily_readiness', records, (r) => r.score);
  }

  upsertDailySleep(records: DailySleep[]): number {
    return this.upsertWithId('oura_daily_sleep', records, (r) => r.score);
  }

  upsertDailyActivity(records: DailyActivity[]): number {
    return this.upsertWithId('oura_daily_activity', records, (r) => r.score);
  }

  upsertSleepSessions(records: SleepSession[]): number {
    return this.upsertWithId('oura_sleep_sessions', records);
  }

  upsertWorkouts(records: Workout[]): number {
    return this.upsertWithId('oura_workouts', records);
  }

  upsertSessions(records: Session[]): number {
    return this.upsertWithId('oura_sessions', records);
  }

  upsertTags(records: Tag[]): number {
    return this.upsertWithId('oura_tags', records);
  }

  upsertHeartRate(records: HeartRate[]): number {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO oura_heart_rate (timestamp, bpm, source, synced_at)
      VALUES (?, ?, ?, datetime('now'))
    `);

    const upsertMany = this.db.transaction((items: HeartRate[]) => {
      let count = 0;
      for (const item of items) {
        stmt.run(item.timestamp, item.bpm, item.source);
        count++;
      }
      return count;
    });

    return upsertMany(records);
  }

  upsertPersonalInfo(info: PersonalInfo): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO oura_personal_info (id, raw_json, synced_at)
         VALUES ('default', ?, datetime('now'))`
      )
      .run(JSON.stringify(info));
  }

  getLastSyncDate(endpoint: string): string | null {
    const row = this.db
      .prepare(
        'SELECT last_synced_date FROM sync_metadata WHERE source = ? AND endpoint = ?'
      )
      .get(SOURCE, endpoint) as { last_synced_date: string } | undefined;

    return row?.last_synced_date ?? null;
  }

  updateSyncMetadata(
    endpoint: string,
    lastSyncedDate: string,
    recordCount: number
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sync_metadata (source, endpoint, last_synced_date, last_synced_at, record_count)
         VALUES (?, ?, ?, datetime('now'), ?)`
      )
      .run(SOURCE, endpoint, lastSyncedDate, recordCount);
  }

  /**
   * Generic upsert for tables with Oura-provided id and day fields.
   */
  private upsertWithId<T extends { id: string; day: string }>(
    table: string,
    records: T[],
    getScore?: (record: T) => number | undefined
  ): number {
    const hasScore = getScore !== undefined;
    const sql = hasScore
      ? `INSERT OR REPLACE INTO ${table} (id, day, score, raw_json, synced_at)
         VALUES (?, ?, ?, ?, datetime('now'))`
      : `INSERT OR REPLACE INTO ${table} (id, day, raw_json, synced_at)
         VALUES (?, ?, ?, datetime('now'))`;

    const stmt = this.db.prepare(sql);

    const upsertMany = this.db.transaction((items: T[]) => {
      let count = 0;
      for (const item of items) {
        if (hasScore) {
          stmt.run(item.id, item.day, getScore(item) ?? null, JSON.stringify(item));
        } else {
          stmt.run(item.id, item.day, JSON.stringify(item));
        }
        count++;
      }
      return count;
    });

    return upsertMany(records);
  }
}
