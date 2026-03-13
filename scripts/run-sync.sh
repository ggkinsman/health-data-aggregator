#!/bin/bash
# Wrapper for launchd to run Oura sync with .env loaded
set -euo pipefail

cd /Users/glennkinsman/Projects/health-data-aggregator

# Ensure homebrew binaries are on PATH (Apple Silicon)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Load .env file
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

npx tsx scripts/sync-oura.ts 2>&1

# Rebuild last week's daily summaries after sync
echo "Building daily summaries..."
npx tsx scripts/build-summaries.ts --days 7 2>&1
