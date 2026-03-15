import type Database from 'better-sqlite3';
import type { CPAPSession } from './types.js';

export class CpapRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Upsert CPAP sessions into cpap_sessions.
   * Does NOT write to daily_summary — that is handled by build:summaries.
   */
  upsertSessions(sessions: CPAPSession[]): number {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO cpap_sessions (
        day, usage_minutes, ahi, oai, cai, hi, uai, rin,
        mask_pressure_50, mask_pressure_95,
        resp_rate_50, tidal_vol_50, min_vent_50,
        csr_minutes, mask_events, imported_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, datetime('now')
      )
    `);

    const upsertMany = this.db.transaction((items: CPAPSession[]) => {
      for (const s of items) {
        stmt.run(
          s.day, s.usage_minutes, s.ahi, s.oai, s.cai, s.hi, s.uai, s.rin,
          s.mask_pressure_50, s.mask_pressure_95,
          s.resp_rate_50, s.tidal_vol_50, s.min_vent_50,
          s.csr_minutes, s.mask_events
        );
      }
      return items.length;
    });

    return upsertMany(sessions);
  }
}
