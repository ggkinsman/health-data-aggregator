#!/usr/bin/env node
import { resolve } from 'path';
import { writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { openDatabase } from '../src/db/database.js';
import { buildDataContext } from '../src/pipeline/data-context-builder.js';
import { runPipeline } from '../src/pipeline/orchestrator.js';
import type { PipelineConfig } from '../src/pipeline/types.js';

const DB_PATH = resolve(import.meta.dirname, '..', 'data', 'health.db');
const MEMORY_PATH = resolve(import.meta.dirname, '..', 'reports', 'memory.json');
const REPORTS_DIR = resolve(import.meta.dirname, '..', 'reports');
const LOG_PATH = resolve(process.env.HOME ?? '~', 'Library', 'Logs', 'health-pipeline.log');

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const reportType = args.find(a => a === 'daily' || a === 'weekly') as 'daily' | 'weekly' | undefined;

  if (!reportType) {
    console.log('Usage: npm run health:report -- daily|weekly');
    process.exit(1);
  }

  const today = new Date().toISOString().split('T')[0];
  const timestamp = new Date().toISOString();
  log(`[${timestamp}] Starting ${reportType} report generation`);

  const db = openDatabase(DB_PATH);
  const dataContext = buildDataContext(db);

  if (dataContext.timeRange.earliest === '') {
    log(`[${timestamp}] No data available. Skipping report.`);
    console.log('No data available. Run sync first.');
    db.close();
    return;
  }

  if (dataContext.staleness.isStale) {
    log(`[${timestamp}] WARNING: Data may be stale (last sync: ${dataContext.staleness.lastSyncAt})`);
  }

  const config: PipelineConfig = { reportType };

  try {
    const result = await runPipeline(db, dataContext, config, MEMORY_PATH);

    // Save report
    const subdir = resolve(REPORTS_DIR, reportType);
    mkdirSync(subdir, { recursive: true });

    let filename: string;
    if (reportType === 'daily') {
      filename = `${today}.md`;
    } else {
      const weekNum = getISOWeek(new Date(today));
      filename = `${today.substring(0, 4)}-W${String(weekNum).padStart(2, '0')}.md`;
    }

    const reportPath = resolve(subdir, filename);
    writeFileSync(reportPath, result.finalOutput);

    // Save reviews
    const reviewDir = resolve(REPORTS_DIR, 'reviews');
    mkdirSync(reviewDir, { recursive: true });
    writeFileSync(
      resolve(reviewDir, `${today}-${reportType}.json`),
      JSON.stringify(result.reviews, null, 2)
    );

    log(`[${timestamp}] ${reportType} report saved to ${reportPath}`);
    log(`[${timestamp}] Duration: ${result.durationMs}ms | Tokens: ${result.tokenUsage.totalInput + result.tokenUsage.totalOutput}`);

    console.log(`${reportType} report saved to ${reportPath}`);
  } catch (err: any) {
    log(`[${timestamp}] ERROR: ${err.message}`);
    console.error(`Report generation failed: ${err.message}`);
    process.exit(1);
  } finally {
    db.close();
  }
}

function log(message: string): void {
  try {
    appendFileSync(LOG_PATH, message + '\n');
  } catch {
    // Logging failure is non-fatal
  }
}

function getISOWeek(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const yearStart = new Date(d.getFullYear(), 0, 4);
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

main();
