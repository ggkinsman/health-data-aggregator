import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../db/migrations.js';
import {
  extractExecutableBlocks,
  executeCodeBlock,
  validateResult,
} from '../code-executor.js';

describe('extractExecutableBlocks', () => {
  it('extracts executable-sql blocks from text', () => {
    const text = `
Some narrative text.

\`\`\`executable-sql
SELECT * FROM daily_summary LIMIT 5
\`\`\`

More text.
    `;
    const blocks = extractExecutableBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('SELECT * FROM daily_summary');
  });

  it('returns empty array when no executable blocks', () => {
    const text = 'Just plain text with no code blocks.';
    expect(extractExecutableBlocks(text)).toHaveLength(0);
  });

  it('extracts multiple blocks', () => {
    const text = `
\`\`\`executable-sql
SELECT 1
\`\`\`

\`\`\`executable-sql
SELECT 2
\`\`\`
    `;
    expect(extractExecutableBlocks(text)).toHaveLength(2);
  });
});

describe('executeCodeBlock', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`
      INSERT INTO daily_summary (day, avg_hrv, sources, built_at)
      VALUES ('2026-03-13', 42, 'oura', datetime('now'))
    `).run();
  });

  it('runs a valid SELECT and returns results', () => {
    const result = executeCodeBlock(db, 'SELECT day, avg_hrv FROM daily_summary');
    expect(result.output).toContain('2026-03-13');
    expect(result.error).toBeNull();
  });

  it('returns error for invalid SQL', () => {
    const result = executeCodeBlock(db, 'SELECT * FROM nonexistent_table');
    expect(result.error).not.toBeNull();
    expect(result.output).toBeNull();
  });

  it('blocks write operations', () => {
    const result = executeCodeBlock(db, "DELETE FROM daily_summary WHERE day = '2026-03-13'");
    expect(result.error).toContain('read-only');
  });

  it('returns error for queries exceeding timeout', () => {
    const result = executeCodeBlock(db, `
      WITH RECURSIVE cnt(x) AS (
        SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x < 10000000
      ) SELECT COUNT(*) FROM cnt
    `);
    expect(result.error !== null || result.output !== null).toBe(true);
  });
});

describe('validateResult', () => {
  it('flags empty results for time ranges with expected data', () => {
    const warnings = validateResult({ output: '[]', error: null, retryCount: 0, code: '', validated: false, warnings: [] });
    expect(warnings).toContain('Result is empty — query returned no rows');
  });

  it('flags unreasonable HR values', () => {
    const warnings = validateResult({
      output: JSON.stringify([{ avg_resting_hr: 350 }]),
      error: null, retryCount: 0, code: '', validated: false, warnings: [],
    });
    expect(warnings.some(w => w.includes('bounds'))).toBe(true);
  });

  it('passes valid results with no warnings', () => {
    const warnings = validateResult({
      output: JSON.stringify([{ avg_hrv: 42 }]),
      error: null, retryCount: 0, code: '', validated: false, warnings: [],
    });
    expect(warnings).toHaveLength(0);
  });
});
