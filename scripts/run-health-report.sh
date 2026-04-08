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

# Notify Gmini on failure
trap '~/scripts/notify-telegram.sh "❌ Health report FAILED (${REPORT_TYPE}, $(date +"%b %d %I:%M %p")) — check ~/Library/Logs/health-pipeline.log" || true' ERR

npx tsx scripts/health-report.ts "$REPORT_TYPE" 2>&1

# Convert REPORT_TYPE to Title Case for notifications (bash 3.2 compatible)
REPORT_TYPE_LABEL=$(echo "$REPORT_TYPE" | awk '{print toupper(substr($0,1,1)) substr($0,2)}')

# Notify on success — send first 400 chars of the report as a preview
REPORT_DATE=$(date '+%b %d')
LATEST_REPORT=$(ls -t "reports/${REPORT_TYPE}"/*.md 2>/dev/null | head -1 || echo "")

CARD=$(npx tsx scripts/health-card.ts 2>/dev/null || echo "")
if [[ -n "$CARD" ]]; then
  ~/scripts/notify-telegram.sh "$CARD" || true
else
  ~/scripts/notify-telegram.sh "${REPORT_TYPE_LABEL} health report ready (${REPORT_DATE})" || true
fi
