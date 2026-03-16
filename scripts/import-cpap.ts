#!/usr/bin/env node
/**
 * Import CPAP data from OSCAR into SQLite.
 *
 * Reads STR.edf from OSCAR's backup directory and upserts nightly
 * summaries into cpap_sessions. Upload SD card data to OSCAR first,
 * then run this script.
 *
 * Usage:
 *   npm run import:cpap                          # reads from OSCAR
 *   npm run import:cpap -- "/path/to/STR.edf"    # explicit override
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openDatabase } from '../src/db/database.js';
import { parseSTREdf } from '../src/cpap/edf-parser.js';
import { CpapRepository } from '../src/cpap/repository.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'health.db');
const OSCAR_EDF_PATH = path.join(
  os.homedir(),
  'Documents/OSCAR_Data/Profiles/ggkinsman/ResMed_23252139106/Backup/STR.edf'
);

function resolveEdfPath(): string {
  // Explicit path override via CLI arg
  if (process.argv[2]) {
    const p = process.argv[2].endsWith('.edf')
      ? process.argv[2]
      : path.join(process.argv[2], 'STR.edf');
    if (fs.existsSync(p)) return p;
    console.error(`STR.edf not found at: ${p}`);
    process.exit(1);
  }

  if (fs.existsSync(OSCAR_EDF_PATH)) return OSCAR_EDF_PATH;

  console.error(`OSCAR STR.edf not found at: ${OSCAR_EDF_PATH}`);
  console.error('Import your SD card data into OSCAR first, then re-run.');
  process.exit(1);
}

async function main() {
  const edfPath = resolveEdfPath();

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
