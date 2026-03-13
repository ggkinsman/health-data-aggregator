# CPAP/OSCAR Integration Plan

**Goal:** Read CPAP therapy data from a ResMed AirSense 11 AutoSet and integrate it into the health-data-aggregator project.

**Device:** ResMed AirSense 11 AutoSet (serial: 23252139106)

---

## Status: Blocked on Prerequisites (2026-03-12)

### Waiting On
1. **SD card** — Need SanDisk 32GB SDHC card. Insert into AirSense 11, sleep one night, then import into OSCAR.
2. **HIPAA data request to ResMed** — Sent 2026-03-12 to privacy@resmed.com requesting full therapy history in CSV/Excel format. Up to 30 days for response.
3. **HIPAA data request to sleep doctor/DME provider** — Sent 2026-03-12 requesting AirView export in electronic format. Up to 30 days for response.

### Already Done
- [x] SD card reader purchased
- [x] OSCAR .dmg downloaded (shows as mounted disk)
- [x] Researched data recovery options for pre-SD-card history
- [x] Sent HIPAA Right of Access requests to both ResMed and provider

### Still Need To Do (Before Code Work)
- [ ] Buy SanDisk 32GB SDHC card
- [ ] Install OSCAR (drag .dmg to Applications)
- [ ] Insert SD card into AirSense 11, sleep at least one night
- [ ] Import SD card into OSCAR, note data folder path (Help > About > Show Data Folder)
- [ ] Verify data visible in OSCAR UI
- [ ] Run `xcode-select --install` (needed for better-sqlite3 native compilation)

---

## Architecture

OSCAR parses ResMed's proprietary EDF+ files from the SD card. We discover OSCAR's internal storage format first (SQLite vs raw files), then build a reader that extracts nightly session summaries (AHI, leak rate, pressure, events, usage hours) and outputs JSON matching the existing `data/` directory pattern. A parse script (`npm run parse:cpap`) follows the same UX as `npm run parse:apple`.

**Tech Stack:** TypeScript, better-sqlite3 (or EDF parser — determined by discovery), vitest

---

## Chunk 1: Discovery and Types

### Task 1: Discover OSCAR's data storage format

This task determines the approach for everything else. OSCAR may use SQLite, raw EDF+ files, or a custom binary format.

- [ ] Explore the OSCAR data directory structure (ls, find maxdepth 3)
- [ ] Identify file types (.db, .sqlite, .edf, extension counts)
- [ ] Decision gate: SQLite path vs EDF path vs custom binary
- [ ] If SQLite: inspect schema (.schema, .tables, sample rows)
- [ ] If EDF: inspect file sizes, naming conventions, look for summary/index files
- [ ] Record findings

### Task 2: Define CPAP TypeScript types

- [ ] Create `src/cpap/types.ts` with CPAPSession, CPAPProfile, CPAPParseResult interfaces
- [ ] Commit

---

## Chunk 2: Reader Implementation (TDD)

### Task 3: Install dependencies and write failing tests

- [ ] Install data access dependency (better-sqlite3 or edf-decoder based on Task 1)
- [ ] Write failing tests in `src/cpap/__tests__/oscar-reader.test.ts`
- [ ] Verify tests fail
- [ ] Commit

### Task 4: Create test fixtures based on discovered schema

- [ ] Build realistic test fixtures in beforeAll based on Task 1 findings
- [ ] Verify fixtures match real OSCAR data
- [ ] Commit

### Task 5: Implement the OSCAR reader

- [ ] Implement `src/cpap/oscar-reader.ts`
- [ ] All tests pass
- [ ] Commit

---

## Chunk 3: Script and Integration

### Task 6: Create the parse script

- [ ] Create `scripts/parse-cpap.ts`
- [ ] Add `parse:cpap` npm script to package.json
- [ ] Commit

### Task 7: Add module exports and test with real data

- [ ] Create `src/cpap/index.ts`
- [ ] Add cpap exports to `src/index.ts`
- [ ] Add OSCAR_DATA_PATH to .env
- [ ] Test with real data, spot-check against OSCAR UI
- [ ] Commit

---

## Bonus: Historical Data Parser (If HIPAA Request Succeeds)

If ResMed or provider responds with CSV/Excel data:
- [ ] Inspect the format of received data
- [ ] Create `src/cpap/resmed-export-parser.ts` to parse the export
- [ ] Map to same CPAPSession types for unified data
- [ ] Add `parse:cpap-history` npm script

---

## File Structure (Final)

```
src/
  cpap/
    types.ts
    oscar-reader.ts
    resmed-export-parser.ts  (if HIPAA data received)
    index.ts
    __tests__/
      oscar-reader.test.ts
scripts/
  parse-cpap.ts
```
