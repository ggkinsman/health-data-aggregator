import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/database.js';
import { AppleHealthRepository } from '../repository.js';
import type { AppleHealthRecord, AppleHealthWorkout } from '../types.js';

describe('AppleHealthRepository', () => {
  let tmpDir: string;
  let db: Database.Database;
  let repo: AppleHealthRepository;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-repo-'));
    db = openDatabase(path.join(tmpDir, 'test.db'));
    repo = new AppleHealthRepository(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('upsertRecords', () => {
    it('should insert new records', () => {
      const records: AppleHealthRecord[] = [
        {
          type: 'HKQuantityTypeIdentifierHeartRate',
          sourceName: 'Apple Watch',
          startDate: '2024-01-15T13:30:00.000Z',
          endDate: '2024-01-15T13:30:00.000Z',
          value: '72',
          unit: 'count/min',
        },
        {
          type: 'HKQuantityTypeIdentifierHeartRate',
          sourceName: 'Apple Watch',
          startDate: '2024-01-15T13:31:00.000Z',
          endDate: '2024-01-15T13:31:00.000Z',
          value: '75',
          unit: 'count/min',
        },
      ];

      const count = repo.upsertRecords(records);
      expect(count).toBe(2);

      const rows = db.prepare('SELECT * FROM apple_health_records').all();
      expect(rows).toHaveLength(2);
    });

    it('should handle duplicates via upsert', () => {
      const record: AppleHealthRecord = {
        type: 'HKQuantityTypeIdentifierHeartRate',
        sourceName: 'Apple Watch',
        startDate: '2024-01-15T13:30:00.000Z',
        endDate: '2024-01-15T13:30:00.000Z',
        value: '72',
        unit: 'count/min',
      };

      repo.upsertRecords([record]);
      repo.upsertRecords([{ ...record, value: '80' }]);

      const rows = db.prepare('SELECT * FROM apple_health_records').all() as any[];
      expect(rows).toHaveLength(1);
      const raw = JSON.parse(rows[0].raw_json);
      expect(raw.value).toBe('80');
    });
  });

  describe('upsertWorkouts', () => {
    it('should insert workouts', () => {
      const workouts: AppleHealthWorkout[] = [
        {
          activityType: 'HKWorkoutActivityTypeRunning',
          sourceName: 'Apple Watch',
          startDate: '2024-01-15T12:00:00.000Z',
          endDate: '2024-01-15T12:45:00.000Z',
          duration: 45.0,
          totalDistance: 5.12,
          totalEnergyBurned: 350,
          statistics: [],
          events: [],
        },
      ];

      const count = repo.upsertWorkouts(workouts);
      expect(count).toBe(1);

      const rows = db.prepare('SELECT * FROM apple_health_workouts').all() as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0].duration).toBeCloseTo(45.0);
    });

    it('should handle duplicate workouts via upsert', () => {
      const workout: AppleHealthWorkout = {
        activityType: 'HKWorkoutActivityTypeRunning',
        sourceName: 'Apple Watch',
        startDate: '2024-01-15T12:00:00.000Z',
        endDate: '2024-01-15T12:45:00.000Z',
        duration: 45.0,
        statistics: [],
        events: [],
      };

      repo.upsertWorkouts([workout]);
      repo.upsertWorkouts([{ ...workout, duration: 46.5 }]);

      const rows = db.prepare('SELECT * FROM apple_health_workouts').all() as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0].duration).toBeCloseTo(46.5);
    });
  });

  describe('updateSyncMetadata', () => {
    it('should save per-type sync metadata', () => {
      repo.updateSyncMetadata({
        HKQuantityTypeIdentifierHeartRate: 1000,
        HKCategoryTypeIdentifierSleepAnalysis: 500,
      });

      const rows = db
        .prepare("SELECT * FROM sync_metadata WHERE source = 'apple_health' ORDER BY endpoint")
        .all() as any[];
      expect(rows).toHaveLength(2);
      expect(rows[0].endpoint).toBe('HKCategoryTypeIdentifierSleepAnalysis');
      expect(rows[0].record_count).toBe(500);
      expect(rows[1].endpoint).toBe('HKQuantityTypeIdentifierHeartRate');
      expect(rows[1].record_count).toBe(1000);
    });
  });
});
