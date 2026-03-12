import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type Database from 'better-sqlite3';
import { openDatabase } from '../database.js';
import { OuraRepository } from '../oura-repository.js';

describe('OuraRepository', () => {
  let tmpDir: string;
  let db: Database.Database;
  let repo: OuraRepository;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-db-'));
    db = openDatabase(path.join(tmpDir, 'test.db'));
    repo = new OuraRepository(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('upsertDailyReadiness', () => {
    it('should insert new records', () => {
      const records = [
        { id: 'r1', day: '2026-03-10', score: 85, contributors: {} },
        { id: 'r2', day: '2026-03-11', score: 90, contributors: {} },
      ];

      const count = repo.upsertDailyReadiness(records);
      expect(count).toBe(2);

      const rows = db.prepare('SELECT * FROM oura_daily_readiness ORDER BY day').all();
      expect(rows).toHaveLength(2);
    });

    it('should update existing records on conflict', () => {
      const records = [{ id: 'r1', day: '2026-03-10', score: 85, contributors: {} }];
      repo.upsertDailyReadiness(records);

      const updated = [{ id: 'r1', day: '2026-03-10', score: 92, contributors: {} }];
      repo.upsertDailyReadiness(updated);

      const rows = db.prepare('SELECT * FROM oura_daily_readiness').all() as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0].score).toBe(92);
    });
  });

  describe('upsertHeartRate', () => {
    it('should insert heart rate records with composite key', () => {
      const records = [
        { timestamp: '2026-03-10T08:00:00+00:00', bpm: 65, source: 'rest' as const },
        { timestamp: '2026-03-10T08:00:00+00:00', bpm: 65, source: 'awake' as const },
      ];

      const count = repo.upsertHeartRate(records);
      expect(count).toBe(2);

      const rows = db.prepare('SELECT * FROM oura_heart_rate').all();
      expect(rows).toHaveLength(2);
    });
  });

  describe('upsertPersonalInfo', () => {
    it('should always replace the single row', () => {
      repo.upsertPersonalInfo({ age: 30, email: 'test@test.com' });
      repo.upsertPersonalInfo({ age: 31, email: 'test@test.com' });

      const rows = db.prepare('SELECT * FROM oura_personal_info').all() as any[];
      expect(rows).toHaveLength(1);

      const data = JSON.parse(rows[0].raw_json);
      expect(data.age).toBe(31);
    });
  });

  describe('sync metadata', () => {
    it('should return null for unknown endpoint', () => {
      const result = repo.getLastSyncDate('daily_readiness');
      expect(result).toBeNull();
    });

    it('should save and retrieve sync metadata', () => {
      repo.updateSyncMetadata('daily_readiness', '2026-03-10', 42);

      const result = repo.getLastSyncDate('daily_readiness');
      expect(result).toBe('2026-03-10');
    });

    it('should update existing sync metadata', () => {
      repo.updateSyncMetadata('daily_readiness', '2026-03-10', 42);
      repo.updateSyncMetadata('daily_readiness', '2026-03-11', 85);

      const result = repo.getLastSyncDate('daily_readiness');
      expect(result).toBe('2026-03-11');
    });
  });
});
