import { openDatabase } from '../src/db/database.js';
import { buildDailySummaries } from '../src/unified/summary-builder.js';

const DB_PATH = 'data/health.db';

function main() {
  const args = process.argv.slice(2);
  let days: number | undefined;

  const daysIdx = args.indexOf('--days');
  if (daysIdx !== -1 && args[daysIdx + 1]) {
    days = parseInt(args[daysIdx + 1], 10);
    if (isNaN(days) || days < 1) {
      console.error('--days must be a positive number');
      process.exit(1);
    }
  }

  const start = Date.now();
  const db = openDatabase(DB_PATH);

  try {
    const results = buildDailySummaries(db, days ? { days } : undefined);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`Built ${results.length} daily summaries in ${elapsed}s`);
  } finally {
    db.close();
  }
}

main();
