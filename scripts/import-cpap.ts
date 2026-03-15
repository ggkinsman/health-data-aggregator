#!/usr/bin/env node
/**
 * Import CPAP data from ResMed AirSense 11 SD card into SQLite.
 *
 * Reads STR.edf from the SD card and upserts nightly summaries into
 * cpap_sessions. Run build:summaries afterward to populate daily_summary.
 *
 * Usage:
 *   npm run import:cpap                          # uses /Volumes/NO NAME
 *   npm run import:cpap -- "/Volumes/NO NAME"    # explicit path
 *   CPAP_CARD_PATH="/path" npm run import:cpap   # env var
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { openDatabase } from '../src/db/database.js';
import { parseSTREdf } from '../src/cpap/edf-parser.js';
import { CpapRepository } from '../src/cpap/repository.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'health.db');
const DEFAULT_CARD_PATH = '/Volumes/NO NAME';

function resolveCardPath(): string {
  return process.argv[2] ?? process.env['CPAP_CARD_PATH'] ?? DEFAULT_CARD_PATH;
}

async function main() {
  const cardPath = resolveCardPath();
  const edfPath = path.join(cardPath, 'STR.edf');

  if (!fs.existsSync(cardPath)) {
    console.error(`SD card not found at: ${cardPath}`);
    console.error('Make sure the card is inserted and mounted, then try again.');
    process.exit(1);
  }

  if (!fs.existsSync(edfPath)) {
    console.error(`STR.edf not found at: ${edfPath}`);
    console.error('The SD card may not have been in the machine long enough to record data.');
    process.exit(1);
  }

  console.log(`Importing CPAP data from: ${edfPath}`);

  const db = openDatabase(DB_PATH);
  const repo = new CpapRepository(db);

  const sessions = parseSTREdf(edfPath);
  console.log(`Parsed ${sessions.length} nights`);

  const count = repo.upsertSessions(sessions);
  console.log(`Saved ${count} sessions to cpap_sessions`);
  console.log('');
  console.log('Run `npm run build:summaries` to populate daily_summary with CPAP data.');
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
