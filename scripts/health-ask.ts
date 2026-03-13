#!/usr/bin/env node
import { resolve } from 'path';
import { openDatabase } from '../src/db/database.js';
import { buildDataContext } from '../src/pipeline/data-context-builder.js';
import { runPipeline } from '../src/pipeline/orchestrator.js';
import type { PipelineConfig } from '../src/pipeline/types.js';

const DB_PATH = resolve(import.meta.dirname, '..', 'data', 'health.db');
const MEMORY_PATH = resolve(import.meta.dirname, '..', 'reports', 'memory.json');
const CONTINUE_FILE = resolve(import.meta.dirname, '..', 'reports', '.last-output.txt');

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log('Usage: npm run health:ask -- "your question here" [--show-review] [--continue]');
    process.exit(0);
  }

  const question = args.find(a => !a.startsWith('--')) ?? '';
  const showReview = args.includes('--show-review');
  const continueMode = args.includes('--continue');

  if (!question && !showReview) {
    console.error('Please provide a question.');
    process.exit(1);
  }

  // Handle --show-review: display last review
  if (showReview && !question) {
    const { readFileSync, existsSync } = await import('fs');
    const reviewPath = resolve(import.meta.dirname, '..', 'reports', 'reviews', 'last-interactive.json');
    if (existsSync(reviewPath)) {
      const reviews = JSON.parse(readFileSync(reviewPath, 'utf-8'));
      for (const r of reviews) {
        console.log(`\n--- ${r.role} (${r.verdict}) ---`);
        console.log(r.notes);
        if (r.suggestedEdit) console.log(`Suggested: ${r.suggestedEdit}`);
      }
    } else {
      console.log('No previous review found. Run a query first.');
    }
    return;
  }

  console.log('Dr. Hayden is analyzing your data...\n');

  const db = openDatabase(DB_PATH);
  const dataContext = buildDataContext(db);

  if (dataContext.staleness.isStale) {
    console.log(`Warning: Data may be stale (last sync: ${dataContext.staleness.lastSyncAt})\n`);
  }

  // Load continue context
  let continueContext: string | undefined;
  if (continueMode) {
    const { readFileSync, existsSync } = await import('fs');
    if (existsSync(CONTINUE_FILE)) {
      continueContext = readFileSync(CONTINUE_FILE, 'utf-8');
    }
  }

  const config: PipelineConfig = {
    question,
    continueContext,
    showReview,
  };

  try {
    const result = await runPipeline(db, dataContext, config, MEMORY_PATH);

    console.log(result.finalOutput);

    // Save for --continue and --show-review
    const { writeFileSync, mkdirSync } = await import('fs');
    const { dirname } = await import('path');
    mkdirSync(dirname(CONTINUE_FILE), { recursive: true });
    mkdirSync(resolve(import.meta.dirname, '..', 'reports', 'reviews'), { recursive: true });
    writeFileSync(CONTINUE_FILE, result.finalOutput);
    writeFileSync(
      resolve(import.meta.dirname, '..', 'reports', 'reviews', 'last-interactive.json'),
      JSON.stringify(result.reviews, null, 2)
    );

    // Print stats
    console.log(`\n---`);
    console.log(`Duration: ${(result.durationMs / 1000).toFixed(1)}s | Tokens: ${result.tokenUsage.totalInput + result.tokenUsage.totalOutput}`);
    if (showReview) {
      for (const r of result.reviews) {
        console.log(`\n--- ${r.role} (${r.verdict}) ---`);
        console.log(r.notes);
      }
    }
  } catch (err: any) {
    console.error(`Pipeline error: ${err.message}`);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
