#!/usr/bin/env node
/**
 * Incremental Oura data sync to SQLite.
 *
 * Fetches new data since last sync for each endpoint,
 * upserts into health.db, and updates sync metadata.
 *
 * Usage: npm run sync:oura
 */

import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { OuraAuth, OuraClient, FileTokenStorage } from '../src/index.js';
import { openDatabase } from '../src/db/database.js';
import { OuraRepository } from '../src/db/oura-repository.js';
import type {
  DateRangeQuery,
  DailyReadiness,
  DailySleep,
  DailyActivity,
  SleepSession,
  HeartRate,
  Workout,
  Session,
  Tag,
} from '../src/oura/types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'health.db');
const TOKEN_DIR = path.join(DATA_DIR, 'tokens');
const USER_ID = 'default-user';

const RATE_LIMIT_RETRY_DELAY_MS = 60 * 1000; // 1 minute
const MAX_RETRIES = 3;
const REQUEST_DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get start date: last_synced_date - 1 day (for overlap), or 2 years ago on first run.
 */
function getStartDate(lastSynced: string | null): string {
  if (lastSynced) {
    const date = new Date(lastSynced);
    date.setDate(date.getDate() - 1); // 1-day overlap
    return formatDate(date);
  }
  // First run: 2 years back
  const date = new Date();
  date.setFullYear(date.getFullYear() - 2);
  return formatDate(date);
}

/**
 * Fetch all pages for a paginated endpoint.
 */
async function fetchAllPages<T extends { data: any[]; next_token?: string | null }>(
  fetchFn: (query: DateRangeQuery) => Promise<T>,
  query: DateRangeQuery,
  endpointName: string
): Promise<T['data']> {
  const allRecords: T['data'] = [];
  let nextToken: string | undefined;
  let page = 1;

  do {
    const fetchQuery: DateRangeQuery = {
      ...query,
      ...(nextToken ? { next_token: nextToken } : {}),
    };

    let response: T;
    let retries = MAX_RETRIES;

    while (true) {
      try {
        await sleep(REQUEST_DELAY_MS);
        response = await fetchFn(fetchQuery);
        break;
      } catch (error: any) {
        if (error.statusCode === 429 && retries > 0) {
          retries--;
          console.log(
            `  Rate limited on ${endpointName} (page ${page}). Waiting 60s... (${retries} retries left)`
          );
          await sleep(RATE_LIMIT_RETRY_DELAY_MS);
          continue;
        }
        throw error;
      }
    }

    allRecords.push(...response.data);
    nextToken = response.next_token ?? undefined;

    if (nextToken) {
      console.log(`  Fetched page ${page} (${response.data.length} records), continuing...`);
    }
    page++;
  } while (nextToken);

  return allRecords;
}

interface SyncResult {
  endpoint: string;
  recordCount: number;
  success: boolean;
  error?: string;
}

async function main() {
  console.log('Starting Oura sync...\n');

  // Check environment
  const clientId = process.env.OURA_CLIENT_ID;
  const clientSecret = process.env.OURA_CLIENT_SECRET;
  const redirectUri = process.env.OURA_REDIRECT_URI;
  const encryptionKey = process.env.ENCRYPTION_KEY;

  if (!clientId || !clientSecret || !redirectUri || !encryptionKey) {
    console.error('Missing required environment variables.');
    console.error('Required: OURA_CLIENT_ID, OURA_CLIENT_SECRET, OURA_REDIRECT_URI, ENCRYPTION_KEY');
    process.exit(1);
  }

  // Ensure data directory
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Check tokens
  const tokenStorage = new FileTokenStorage(TOKEN_DIR, encryptionKey);
  const tokensExist = await tokenStorage.exists(USER_ID);
  if (!tokensExist) {
    console.error('No tokens found. Run: npm run auth:oura');
    process.exit(1);
  }

  // Initialize
  const auth = new OuraAuth({ clientId, clientSecret, redirectUri });
  const client = new OuraClient({ auth, tokenStorage, userId: USER_ID });
  const db = openDatabase(DB_PATH);
  const repo = new OuraRepository(db);
  const today = formatDate(new Date());

  const results: SyncResult[] = [];

  // Define endpoints to sync
  const endpoints: Array<{
    name: string;
    fetch: (query: DateRangeQuery) => Promise<any[]>;
    upsert: (records: any[]) => number;
  }> = [
    {
      name: 'daily_readiness',
      fetch: (q) =>
        fetchAllPages((fq) => client.getDailyReadiness(fq), q, 'daily_readiness'),
      upsert: (r: DailyReadiness[]) => repo.upsertDailyReadiness(r),
    },
    {
      name: 'daily_sleep',
      fetch: (q) =>
        fetchAllPages((fq) => client.getDailySleep(fq), q, 'daily_sleep'),
      upsert: (r: DailySleep[]) => repo.upsertDailySleep(r),
    },
    {
      name: 'daily_activity',
      fetch: (q) =>
        fetchAllPages((fq) => client.getDailyActivity(fq), q, 'daily_activity'),
      upsert: (r: DailyActivity[]) => repo.upsertDailyActivity(r),
    },
    {
      name: 'sleep_sessions',
      fetch: (q) =>
        fetchAllPages((fq) => client.getSleep(fq), q, 'sleep_sessions'),
      upsert: (r: SleepSession[]) => repo.upsertSleepSessions(r),
    },
    {
      name: 'heart_rate',
      fetch: (q) =>
        fetchAllPages((fq) => client.getHeartRate(fq), q, 'heart_rate'),
      upsert: (r: HeartRate[]) => repo.upsertHeartRate(r),
    },
    {
      name: 'workouts',
      fetch: (q) =>
        fetchAllPages((fq) => client.getWorkouts(fq), q, 'workouts'),
      upsert: (r: Workout[]) => repo.upsertWorkouts(r),
    },
    {
      name: 'sessions',
      fetch: (q) =>
        fetchAllPages((fq) => client.getSessions(fq), q, 'sessions'),
      upsert: (r: Session[]) => repo.upsertSessions(r),
    },
    {
      name: 'tags',
      fetch: (q) =>
        fetchAllPages((fq) => client.getTags(fq), q, 'tags'),
      upsert: (r: Tag[]) => repo.upsertTags(r),
    },
  ];

  // Sync each endpoint
  for (const ep of endpoints) {
    const lastSynced = repo.getLastSyncDate(ep.name);
    const startDate = getStartDate(lastSynced);
    const query: DateRangeQuery = { start_date: startDate, end_date: today };

    const label = lastSynced ? `from ${startDate}` : 'full backfill';
    console.log(`Syncing ${ep.name} (${label})...`);

    try {
      const records = await ep.fetch(query);
      const count = records.length > 0 ? ep.upsert(records) : 0;

      if (records.length > 0) {
        repo.updateSyncMetadata(ep.name, today, count);
      }

      console.log(`  ${count} records`);
      results.push({ endpoint: ep.name, recordCount: count, success: true });
    } catch (error: any) {
      console.error(`  FAILED: ${error.message}`);
      results.push({
        endpoint: ep.name,
        recordCount: 0,
        success: false,
        error: error.message,
      });
    }
  }

  // Personal info (no date range, no pagination)
  console.log('Syncing personal_info...');
  try {
    const info = await client.getPersonalInfo();
    // API returns personal info directly (not wrapped in { data: ... })
    const personalData = (info as any).data ?? info;
    repo.upsertPersonalInfo(personalData);
    repo.updateSyncMetadata('personal_info', today, 1);
    console.log('  OK');
    results.push({ endpoint: 'personal_info', recordCount: 1, success: true });
  } catch (error: any) {
    console.error(`  FAILED: ${error.message}`);
    results.push({
      endpoint: 'personal_info',
      recordCount: 0,
      success: false,
      error: error.message,
    });
  }

  // Summary
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const total = results.reduce((sum, r) => sum + r.recordCount, 0);

  console.log(
    `\nSync complete: ${successful.length}/${results.length} endpoints, ${total} records`
  );
  if (failed.length > 0) {
    console.log('Failed:', failed.map((f) => f.endpoint).join(', '));
  }

  db.close();
}

main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
