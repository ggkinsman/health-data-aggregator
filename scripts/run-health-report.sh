#!/bin/bash
# Wrapper for launchd to run health reports with .env loaded
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

REPORT_TYPE="${1:-daily}"

npx tsx scripts/health-report.ts "$REPORT_TYPE" 2>&1
