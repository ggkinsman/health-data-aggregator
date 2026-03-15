import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { openDatabase } from '../database.js';

describe('openDatabase', () => {
  let tmpDir: string;
  let dbPath: string;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should create a new database with all tables', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-db-'));
    dbPath = path.join(tmpDir, 'test.db');

    const db = openDatabase(dbPath);

    // Check that tables exist by querying sqlite_master
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('oura_daily_readiness');
    expect(tableNames).toContain('oura_daily_sleep');
    expect(tableNames).toContain('oura_daily_activity');
    expect(tableNames).toContain('oura_sleep_sessions');
    expect(tableNames).toContain('oura_heart_rate');
    expect(tableNames).toContain('oura_workouts');
    expect(tableNames).toContain('oura_sessions');
    expect(tableNames).toContain('oura_tags');
    expect(tableNames).toContain('oura_personal_info');
    expect(tableNames).toContain('sync_metadata');
    expect(tableNames).toContain('apple_health_records');
    expect(tableNames).toContain('apple_health_workouts');
    expect(tableNames).toContain('daily_summary');
    expect(tableNames).toContain('cpap_sessions');

    db.close();
  });

  it('should set the schema version', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-db-'));
    dbPath = path.join(tmpDir, 'test.db');

    const db = openDatabase(dbPath);
    const version = db.pragma('user_version', { simple: true });
    expect(version).toBe(4);
    db.close();
  });

  it('should be idempotent - opening twice does not error', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-db-'));
    dbPath = path.join(tmpDir, 'test.db');

    const db1 = openDatabase(dbPath);
    db1.close();

    const db2 = openDatabase(dbPath);
    const version = db2.pragma('user_version', { simple: true });
    expect(version).toBe(4);
    db2.close();
  });
});
