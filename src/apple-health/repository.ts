import type Database from 'better-sqlite3';
import type { AppleHealthRecord, AppleHealthWorkout } from './types.js';

const SOURCE = 'apple_health';

export class AppleHealthRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  upsertRecords(records: AppleHealthRecord[]): number {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO apple_health_records
        (type, source_name, start_date, end_date, value, unit, raw_json, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const upsertMany = this.db.transaction((items: AppleHealthRecord[]) => {
      let count = 0;
      for (const item of items) {
        stmt.run(
          item.type,
          item.sourceName,
          item.startDate,
          item.endDate,
          item.value ?? null,
          item.unit ?? null,
          JSON.stringify(item)
        );
        count++;
      }
      return count;
    });

    return upsertMany(records);
  }

  upsertWorkouts(workouts: AppleHealthWorkout[]): number {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO apple_health_workouts
        (activity_type, source_name, start_date, end_date, duration, total_distance, total_energy_burned, raw_json, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const upsertMany = this.db.transaction((items: AppleHealthWorkout[]) => {
      let count = 0;
      for (const item of items) {
        stmt.run(
          item.activityType,
          item.sourceName,
          item.startDate,
          item.endDate,
          item.duration ?? null,
          item.totalDistance ?? null,
          item.totalEnergyBurned ?? null,
          JSON.stringify(item)
        );
        count++;
      }
      return count;
    });

    return upsertMany(workouts);
  }

  updateSyncMetadata(recordCounts: Record<string, number>): void {
    const today = new Date().toISOString().split('T')[0];
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sync_metadata
        (source, endpoint, last_synced_date, last_synced_at, record_count)
      VALUES (?, ?, ?, datetime('now'), ?)
    `);

    const updateAll = this.db.transaction((counts: Record<string, number>) => {
      for (const [type, count] of Object.entries(counts)) {
        stmt.run(SOURCE, type, today, count);
      }
    });

    updateAll(recordCounts);
  }
}
