#!/usr/bin/env node
/**
 * Import travel trips from CSV into SQLite.
 *
 * Travel context helps correlate health metric dips with travel,
 * timezone changes, and alcohol consumption.
 *
 * Usage:
 *   npm run import:travel                            # default path
 *   npm run import:travel -- "/path/to/trips.csv"    # explicit path
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { openDatabase } from '../src/db/database.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'health.db');
const DEFAULT_CSV = path.join(process.cwd(), 'data', 'travel_trips.csv');

function resolveCsvPath(): string {
  if (process.argv[2]) {
    const p = process.argv[2];
    if (fs.existsSync(p)) return p;
    console.error(`CSV not found at: ${p}`);
    process.exit(1);
  }

  if (fs.existsSync(DEFAULT_CSV)) return DEFAULT_CSV;

  console.error(`No travel CSV found at: ${DEFAULT_CSV}`);
  console.error('Provide a path: npm run import:travel -- "/path/to/trips.csv"');
  process.exit(1);
}

function parseCsv(filePath: string): Array<{
  trip_name: string;
  depart_date: string;
  return_date: string;
  nights_away: number;
  destination: string;
  trip_type: string;
}> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  const header = lines[0];
  if (!header.includes('Depart Date')) {
    throw new Error('CSV does not have expected headers');
  }

  return lines.slice(1).map((line) => {
    // Handle quoted fields with commas
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current.trim());

    return {
      trip_name: fields[0],
      depart_date: fields[1],
      return_date: fields[2],
      nights_away: parseInt(fields[3], 10),
      destination: fields[4],
      trip_type: fields[5],
    };
  });
}

async function main() {
  const csvPath = resolveCsvPath();
  console.log(`Importing travel data from: ${csvPath}`);

  const trips = parseCsv(csvPath);
  console.log(`Parsed ${trips.length} trips`);

  const db = openDatabase(DB_PATH);

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO travel_trips (
      depart_date, return_date, nights_away, destination, trip_type, trip_name
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertAll = db.transaction(() => {
    for (const t of trips) {
      stmt.run(t.depart_date, t.return_date, t.nights_away, t.destination, t.trip_type, t.trip_name);
    }
  });

  insertAll();
  console.log(`Saved ${trips.length} trips to travel_trips`);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
