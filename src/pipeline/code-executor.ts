import type Database from 'better-sqlite3';
import type { CodeResult } from './types.js';

const WRITE_PATTERN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE)\b/i;
// Note: timeout is checked post-execution, not enforced mid-query.
// better-sqlite3 runs synchronously so we can't interrupt a running query.
// In practice, queries against local SQLite data complete in <100ms.
const TIMEOUT_MS = 5000;

export function extractExecutableBlocks(text: string): string[] {
  const pattern = /```executable-sql\n([\s\S]*?)```/g;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    blocks.push(m[1].trim());
  }
  return blocks;
}

export function executeCodeBlock(db: Database.Database, sql: string): CodeResult {
  const result: CodeResult = {
    code: sql,
    output: null,
    error: null,
    retryCount: 0,
    validated: false,
    warnings: [],
  };

  // Block write operations to enforce read-only access
  if (WRITE_PATTERN.test(sql)) {
    result.error = 'Blocked: read-only access. Write operations (INSERT, UPDATE, DELETE, etc.) are not allowed.';
    return result;
  }

  try {
    const startTime = Date.now();
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    const elapsed = Date.now() - startTime;

    if (elapsed > TIMEOUT_MS) {
      result.error = `Query exceeded ${TIMEOUT_MS}ms timeout (took ${elapsed}ms)`;
      return result;
    }

    result.output = JSON.stringify(rows, null, 2);
    result.validated = true;
  } catch (err: unknown) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

export function validateResult(result: CodeResult): string[] {
  const warnings: string[] = [];

  if (result.error) return warnings;

  if (!result.output || result.output === '[]' || result.output === '{}') {
    warnings.push('Result is empty — query returned no rows');
    return warnings;
  }

  // Check for unreasonable values in known metrics
  try {
    const parsed = JSON.parse(result.output);
    if (Array.isArray(parsed)) {
      for (const row of parsed) {
        for (const [key, val] of Object.entries(row)) {
          if (typeof val !== 'number') continue;
          if (/hr|heart_rate/i.test(key) && (val < 20 || val > 300)) {
            warnings.push(`Value out of bounds: ${key}=${val} (expected 20-300 for heart rate)`);
          }
          if (/hrv/i.test(key) && (val < 0 || val > 500)) {
            warnings.push(`Value out of bounds: ${key}=${val} (expected 0-500 for HRV)`);
          }
          if (/sleep.*min/i.test(key) && val < 0) {
            warnings.push(`Value out of bounds: ${key}=${val} (negative sleep minutes)`);
          }
        }
      }
    }
  } catch {
    // If output isn't valid JSON, that's fine — it might be a scalar result
  }

  return warnings;
}
