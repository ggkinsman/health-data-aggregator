#!/usr/bin/env node
/**
 * Import Apple Health XML export into SQLite.
 *
 * Parses sleep, heart rate, HRV, resting HR, and workout data
 * from an Apple Health export.xml file.
 *
 * Usage: npm run import:apple <path-to-export.xml>
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { openDatabase } from '../src/db/database.js';
import { parseAppleHealthExport } from '../src/apple-health/parser.js';
import { AppleHealthRepository } from '../src/apple-health/repository.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'health.db');

const FRIENDLY_NAMES: Record<string, string> = {
  HKCategoryTypeIdentifierSleepAnalysis: 'Sleep records',
  HKQuantityTypeIdentifierHeartRate: 'Heart rate',
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: 'HRV',
  HKQuantityTypeIdentifierRestingHeartRate: 'Resting HR',
};

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npm run import:apple <path-to-export.xml>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  console.log(`Importing Apple Health data from: ${resolvedPath}`);

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const db = openDatabase(DB_PATH);
  const repo = new AppleHealthRepository(db);

  try {
    const summary = await parseAppleHealthExport(
      resolvedPath,
      (records) => repo.upsertRecords(records),
      (workouts) => repo.upsertWorkouts(workouts)
    );

    // Update sync metadata with final counts (includes workout count)
    const allCounts = { ...summary.recordCounts };
    if (summary.workoutCount > 0) {
      allCounts['Workout'] = summary.workoutCount;
    }
    repo.updateSyncMetadata(allCounts);

    console.log('\nImport complete:');
    for (const [type, count] of Object.entries(summary.recordCounts)) {
      const name = FRIENDLY_NAMES[type] ?? type;
      console.log(`  ${name.padEnd(18)} ${count.toLocaleString()}`);
    }
    if (summary.workoutCount > 0) {
      console.log(`  ${'Workouts'.padEnd(18)} ${summary.workoutCount.toLocaleString()}`);
    }

    const totalRecords = Object.values(summary.recordCounts).reduce((a, b) => a + b, 0) + summary.workoutCount;
    console.log(`  ${'Total'.padEnd(18)} ${totalRecords.toLocaleString()}`);
    console.log(`  ${'Duration'.padEnd(18)} ${(summary.durationMs / 1000).toFixed(1)}s`);
    console.log(`\nSaved to: ${DB_PATH}`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
