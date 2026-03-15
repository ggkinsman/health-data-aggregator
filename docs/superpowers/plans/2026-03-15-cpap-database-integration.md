# CPAP Database Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse ResMed AirSense 11 STR.edf summary data from the SD card into SQLite so the health pipeline can query CPAP metrics alongside Oura and Apple Health data.

**Architecture:** `import:cpap` writes to a new `cpap_sessions` table only. `build:summaries` (already the sole writer to `daily_summary`) is updated to read from `cpap_sessions` and populate six CPAP columns. Migration V4 creates the new table and adds four new columns to `daily_summary`.

**Tech Stack:** TypeScript, better-sqlite3, tsx (for scripts), Node.js built-in `fs`/`path`. No new dependencies needed.

**Spec:** `docs/superpowers/specs/2026-03-15-cpap-database-integration-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/cpap/types.ts` | Create | CPAPSession interface |
| `src/cpap/edf-parser.ts` | Create | Reads STR.edf → CPAPSession[] |
| `src/cpap/repository.ts` | Create | Upserts into cpap_sessions |
| `src/cpap/index.ts` | Create | Module exports |
| `scripts/import-cpap.ts` | Create | CLI entry point |
| `src/db/migrations.ts` | Modify | V4 migration |
| `src/unified/types.ts` | Modify | Extend DailySummary with 6 CPAP fields |
| `src/unified/summary-builder.ts` | Modify | Read cpap_sessions, include CPAP days |
| `package.json` | Modify | Add `import:cpap` script |

---

## Chunk 1: Migration V4 and Types

### Task 1: Add V4 migration

**Files:**
- Modify: `src/db/migrations.ts`

- [ ] **Step 1: Add `migrateV4` function and wire it into `runMigrations`**

Open `src/db/migrations.ts`. Add after `migrateV3`. Note: `db.exec()` here is better-sqlite3's SQLite execution method, not child_process — safe to use:

```typescript
/**
 * V4: CPAP data — cpap_sessions table + 4 new daily_summary columns
 */
function migrateV4(db: Database.Database): void {
  // ALTER TABLE and PRAGMA user_version must be in separate exec calls —
  // SQLite does not allow mixing DDL and PRAGMA in a single batch.
  db.exec(`
    CREATE TABLE IF NOT EXISTS cpap_sessions (
      day TEXT PRIMARY KEY,
      usage_minutes INTEGER,
      ahi REAL,
      oai REAL,
      cai REAL,
      hi REAL,
      uai REAL,
      rin REAL,
      mask_pressure_50 REAL,
      mask_pressure_95 REAL,
      resp_rate_50 REAL,
      tidal_vol_50 REAL,
      min_vent_50 REAL,
      csr_minutes INTEGER,
      mask_events INTEGER,
      imported_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    ALTER TABLE daily_summary ADD COLUMN cpap_pressure_50 REAL;
    ALTER TABLE daily_summary ADD COLUMN cpap_resp_rate REAL;
    ALTER TABLE daily_summary ADD COLUMN cpap_cai REAL;
    ALTER TABLE daily_summary ADD COLUMN cpap_csr_flagged INTEGER;
  `);

  db.exec('PRAGMA user_version = 4;');
}
```

Then in `runMigrations`, add after the `currentVersion < 3` block:

```typescript
  if (currentVersion < 4) {
    migrateV4(db);

```

- [ ] **Step 2: Verify migration runs without error**

```bash
npm run build:summaries -- --days 1
```

Then check:

```bash
sqlite3 data/health.db ".schema cpap_sessions"
sqlite3 data/health.db "PRAGMA user_version;"
```

Expected: schema printed, version = `4`.

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations.ts
git commit -m "feat: add V4 migration — cpap_sessions table and daily_summary CPAP columns"
```

---

### Task 2: Define CPAPSession type and extend DailySummary

**Files:**
- Create: `src/cpap/types.ts`
- Modify: `src/unified/types.ts`

- [ ] **Step 1: Create `src/cpap/types.ts`**

```typescript
/**
 * One night of CPAP therapy summary data, parsed from ResMed STR.edf.
 * Sourced from the SD card; populated nightly by the machine.
 */
export interface CPAPSession {
  day: string;              // YYYY-MM-DD
  usage_minutes: number;
  ahi: number;
  oai: number;
  cai: number;
  hi: number;
  uai: number;
  rin: number;
  mask_pressure_50: number;
  mask_pressure_95: number;
  resp_rate_50: number;
  tidal_vol_50: number;
  min_vent_50: number;
  csr_minutes: number;
  mask_events: number;
}
```

- [ ] **Step 2: Extend `DailySummary` in `src/unified/types.ts`**

Replace the `// CPAP (future)` block:

```typescript
  // CPAP (from cpap_sessions, populated by import:cpap + build:summaries)
  cpap_hours: number | null;
  cpap_ahi: number | null;
  cpap_pressure_50: number | null;
  cpap_resp_rate: number | null;
  cpap_cai: number | null;
  cpap_csr_flagged: number | null;  // 0 or 1
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/cpap/types.ts src/unified/types.ts
git commit -m "feat: add CPAPSession type and extend DailySummary with CPAP fields"
```

---

## Chunk 2: EDF Parser

### Task 3: Implement the STR.edf parser

**Files:**
- Create: `src/cpap/edf-parser.ts`

**EDF format background:** 256-byte file header, then signal headers (256 bytes x num_signals), then data records. Signal header field sizes per signal: label=16, transducer=80, phys_dim=8, phys_min=8, phys_max=8, dig_min=8, dig_max=8, prefilter=80, num_samples=8, reserved=32.

**ResMed quirks:**
- Date epoch is Unix (1970-01-01), not 1900-01-01
- Duration signal is in minutes
- Only sessions where `usage_minutes > 0` are valid

- [ ] **Step 1: Create `src/cpap/edf-parser.ts`**

```typescript
import * as fs from 'node:fs';
import type { CPAPSession } from './types.js';

// ResMed stores dates as days since Unix epoch (1970-01-01)
const RESMED_EPOCH = new Date('1970-01-01T00:00:00Z').getTime();
const MS_PER_DAY = 86400000;

/**
 * Parse a ResMed STR.edf file and return one CPAPSession per valid night.
 * A valid night has usage_minutes > 0.
 */
export function parseSTREdf(filePath: string): CPAPSession[] {
  const buf = fs.readFileSync(filePath);

  // --- File header (256 bytes) ---
  const numRecords  = parseInt(buf.subarray(236, 244).toString('ascii').trim(), 10);
  const numSignals  = parseInt(buf.subarray(252, 256).toString('ascii').trim(), 10);
  const headerBytes = parseInt(buf.subarray(184, 192).toString('ascii').trim(), 10);

  // --- Signal headers ---
  // Field sizes per signal (label, transducer, phys_dim, phys_min, phys_max,
  // dig_min, dig_max, prefilter, num_samples, reserved):
  const fieldSizes = [16, 80, 8, 8, 8, 8, 8, 80, 8, 32];
  const fieldStarts: number[] = [0];
  for (const size of fieldSizes) {
    fieldStarts.push(fieldStarts[fieldStarts.length - 1] + size * numSignals);


  const sigHeader = buf.subarray(256, headerBytes);

  function getField(fieldIdx: number, fieldLen: number): string[] {
    const start = fieldStarts[fieldIdx];
    return Array.from({ length: numSignals }, (_, i) =>
      sigHeader
        .subarray(start + i * fieldLen, start + (i + 1) * fieldLen)
        .toString('ascii')
        .trim()
    );


  const labels   = getField(0, 16);
  const physMins = getField(3, 8).map(Number);
  const physMaxs = getField(4, 8).map(Number);
  const digMins  = getField(5, 8).map(Number);
  const digMaxs  = getField(6, 8).map(Number);
  const numSamps = getField(8, 8).map(Number);

  // Scale factor: maps raw int16 → physical value
  const gains = physMins.map((pMin, i) => {
    const dRange = digMaxs[i] - digMins[i];
    return dRange !== 0 ? (physMaxs[i] - pMin) / dRange : 1;
);
  const offsets = physMins.map((pMin, i) => pMin - gains[i] * digMins[i]);

  // Note: signals not found in the record produce undefined, which falls through to ?? 0 defaults.





  // --- Read all records ---
  const sessions: CPAPSession[] = [];
  let pos = headerBytes;

  for (let r = 0; r < numRecords; r++) {
    const record: Record<string, number> = {};

    for (let i = 0; i < numSignals; i++) {
      const n = numSamps[i];
      if (n === 0) continue;
      // Read first sample (STR.edf daily summaries use n=1 for scalar signals)
      const raw = buf.readInt16LE(pos);
      record[labels[i]] = gains[i] * raw + offsets[i];
      pos += n * 2;
  

    const dateVal = record['Date'];
    if (!dateVal || dateVal <= 0) {
      console.warn(`Skipping record ${r}: invalid date value (${dateVal})`);
      continue;
    }

    const usageMinutes = Math.round(record['Duration'] ?? 0);
    if (usageMinutes <= 0) continue;

    const dayMs = RESMED_EPOCH + Math.round(dateVal) * MS_PER_DAY;
    const day = new Date(dayMs).toISOString().split('T')[0];

    sessions.push({
      day,
      usage_minutes:    usageMinutes,
      ahi:              +(record['AHI']          ?? 0).toFixed(2),
      oai:              +(record['OAI']          ?? 0).toFixed(2),
      cai:              +(record['CAI']          ?? 0).toFixed(2),
      hi:               +(record['HI']           ?? 0).toFixed(2),
      uai:              +(record['UAI']          ?? 0).toFixed(2),
      rin:              +(record['RIN']          ?? 0).toFixed(2),
      mask_pressure_50: +(record['MaskPress.50'] ?? 0).toFixed(2),
      mask_pressure_95: +(record['MaskPress.95'] ?? 0).toFixed(2),
      resp_rate_50:     +(record['RespRate.50']  ?? 0).toFixed(1),
      tidal_vol_50:     +(record['TidVol.50']    ?? 0).toFixed(3),
      min_vent_50:      +(record['MinVent.50']   ?? 0).toFixed(2),
      csr_minutes:      Math.round(record['CSR'] ?? 0),
      mask_events:      Math.round(record['MaskEvents'] ?? 0),
  );


  return sessions;
}
```

- [ ] **Step 2: Smoke-test the parser**

```bash
npx tsx -e "
import { parseSTREdf } from './src/cpap/edf-parser.ts';
const s = parseSTREdf('/Volumes/NO NAME/STR.edf');
console.log('Total nights:', s.length);
console.log('First:', s[0]);
console.log('Last:', s[s.length - 1]);
"
```

Expected: `Total nights: 241`, first `2025-07-11`, last `2026-03-14`.

- [ ] **Step 3: Cross-check a night against OSCAR**

Pick any night in OSCAR. Confirm `ahi` and `usage_minutes / 60` match what OSCAR shows for AHI and hours.

- [ ] **Step 4: Commit**

```bash
git add src/cpap/edf-parser.ts
git commit -m "feat: implement STR.edf parser for ResMed AirSense 11"
```

---

## Chunk 3: Repository and Module Exports

### Task 4: Implement the CPAP repository

**Files:**
- Create: `src/cpap/repository.ts`
- Create: `src/cpap/index.ts`

- [ ] **Step 1: Create `src/cpap/repository.ts`**

```typescript
import type Database from 'better-sqlite3';
import type { CPAPSession } from './types.js';

export class CpapRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;


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
    
      return items.length;
  );

    return upsertMany(sessions);

}
```

- [ ] **Step 2: Create `src/cpap/index.ts`**

```typescript
export { parseSTREdf } from './edf-parser.js';
export { CpapRepository } from './repository.js';
export type { CPAPSession } from './types.js';
```

- [ ] **Step 3: Compile**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/cpap/repository.ts src/cpap/index.ts
git commit -m "feat: add CPAP repository and module exports"
```

---

## Chunk 4: Import Script

### Task 5: Create the import:cpap CLI script

**Files:**
- Create: `scripts/import-cpap.ts`
- Modify: `package.json`

- [ ] **Step 1: Create `scripts/import-cpap.ts`**

```typescript
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


  if (!fs.existsSync(edfPath)) {
    console.error(`STR.edf not found at: ${edfPath}`);
    console.error('The SD card may not have been in the machine long enough to record data.');
    process.exit(1);


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
```

- [ ] **Step 2: Add `import:cpap` to `package.json` scripts block**

```json
"import:cpap": "tsx scripts/import-cpap.ts",
```

- [ ] **Step 3: Run the real import**

```bash
npm run import:cpap
```

Expected:
```
Importing CPAP data from: /Volumes/NO NAME/STR.edf
Parsed 241 nights
Saved 241 sessions to cpap_sessions
Run `npm run build:summaries` to populate daily_summary with CPAP data.
```

- [ ] **Step 4: Spot-check DB**

```bash
sqlite3 data/health.db "SELECT day, ahi, usage_minutes FROM cpap_sessions ORDER BY day DESC LIMIT 5;"
```

Expected: 5 recent nights with real values.

- [ ] **Step 5: Commit**

```bash
git add scripts/import-cpap.ts package.json
git commit -m "feat: add import:cpap script for ResMed AirSense 11 SD card"
```

---

## Chunk 5: Summary Builder Updates

### Task 6: Update summary-builder to read from cpap_sessions

**Files:**
- Modify: `src/unified/summary-builder.ts`

Three sub-changes: include CPAP days in source union, read CPAP data per day, extend upsert statement.

- [ ] **Step 1: Add `cpap_sessions` to `getAllDays` UNION query**

Find the UNION in `getAllDays` and add one more line:

```typescript
      UNION SELECT day FROM cpap_sessions
```

- [ ] **Step 2: Add CPAP lookup in `buildDay`**

After the workouts block (before `// Timezone detection`), add:

```typescript
  // CPAP: read nightly summary (written by import:cpap, never by this builder)
  const cpap = db.prepare(
    `SELECT usage_minutes, ahi, cai, mask_pressure_50, resp_rate_50, csr_minutes
     FROM cpap_sessions WHERE day = ?`
  ).get(day) as {
    usage_minutes: number;
    ahi: number;
    cai: number;
    mask_pressure_50: number;
    resp_rate_50: number;
    csr_minutes: number;
 | undefined;

  if (cpap) sources.add('cpap');
```

- [ ] **Step 3: Update `upsertStmt` to include all 6 CPAP columns**

Replace the entire `upsertStmt` definition with the version below. All three artifacts (column list, VALUES placeholders, and the `.run()` call in Step 5) must be updated together — missing any one causes silent nulls. The full new INSERT:

```typescript
  const upsertStmt = db.prepare(`
    INSERT OR REPLACE INTO daily_summary (
      day, readiness_score, sleep_score, activity_score,
      total_sleep_minutes, deep_sleep_minutes, rem_sleep_minutes, sleep_efficiency,
      avg_resting_hr, min_hr, max_hr, avg_hrv,
      steps, active_calories,
      workout_count, workout_minutes,
      cpap_hours, cpap_ahi, cpap_pressure_50, cpap_resp_rate, cpap_cai, cpap_csr_flagged,
      timezone_offset, timezone_change, location_label,
      sources, built_at
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?
    )
  `);
```

- [ ] **Step 4: Update `buildDay` return object**

Replace `cpap_hours: null, cpap_ahi: null` with:

```typescript
    cpap_hours:       cpap ? +(cpap.usage_minutes / 60).toFixed(2) : null,
    cpap_ahi:         cpap?.ahi ?? null,
    cpap_pressure_50: cpap?.mask_pressure_50 ?? null,
    cpap_resp_rate:   cpap?.resp_rate_50 ?? null,
    cpap_cai:         cpap?.cai ?? null,
    cpap_csr_flagged: cpap ? (cpap.csr_minutes > 0 ? 1 : 0) : null,
```

- [ ] **Step 5: Update `upsertStmt.run(...)` call**

Replace `summary.cpap_hours, summary.cpap_ahi,` with:

```typescript
        summary.cpap_hours, summary.cpap_ahi,
        summary.cpap_pressure_50, summary.cpap_resp_rate,
        summary.cpap_cai, summary.cpap_csr_flagged,
```

- [ ] **Step 6: Compile**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 7: Run build:summaries and verify**

```bash
npm run build:summaries -- --days 30
sqlite3 data/health.db \
  "SELECT day, cpap_hours, cpap_ahi, cpap_pressure_50, cpap_csr_flagged, sources
   FROM daily_summary
   WHERE cpap_ahi IS NOT NULL
   ORDER BY day DESC LIMIT 10;"
```

Expected: 10 nights with non-null CPAP values, `sources` contains `cpap`.

- [ ] **Step 8: Verify CPAP-only nights appear**

```bash
sqlite3 data/health.db \
  "SELECT day, sources FROM daily_summary WHERE sources = 'cpap' LIMIT 5;"
```

Expected: early nights (~2025-07-11) with only `cpap` as source.

- [ ] **Step 9: Verify idempotency — run twice, data unchanged**

```bash
npm run import:cpap && npm run build:summaries -- --days 7
npm run import:cpap && npm run build:summaries -- --days 7
```

- [ ] **Step 10: Commit**

```bash
git add src/unified/summary-builder.ts
git commit -m "feat: populate CPAP fields in daily_summary from cpap_sessions"
```

---

## Final Verification

- [ ] **End-to-end pipeline test**

```bash
npm run health:ask -- "How has my AHI trended over the last 30 days?"
```

Expected: pipeline answers using CPAP data.

- [ ] **Update PROGRESS.md** with a one-liner noting CPAP integration complete.
