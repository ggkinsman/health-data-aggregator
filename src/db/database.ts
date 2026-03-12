import Database from 'better-sqlite3';
import { runMigrations } from './migrations.js';

/**
 * Open (or create) the health database and run migrations.
 */
export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  runMigrations(db);

  return db;
}
