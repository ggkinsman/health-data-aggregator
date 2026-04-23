# Proactive Telegram Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push Telegram notifications to Gmini only when there's something actionable: daily/weekly health reports (delivered deliverables), nightly improve completions (branch needs morning review), and any job failure (always worth knowing).

**Notify on:** daily health report, weekly health report, workout nightly improve, spend nightly improve, any job error.
**Do NOT notify on:** Oura sync (routine, nothing to act on), Oura summary rebuilds.

**Architecture:** A single `notify-telegram.sh` script wraps the Telegram Bot API (sendMessage endpoint). Each qualifying run script calls it at the end. Error trapping ensures job failures also send a notification. No new services required — pure shell + curl.

**Tech Stack:** bash, curl, Telegram Bot API (`https://api.telegram.org/bot{token}/sendMessage`), existing launchd run scripts.

---

### Task 1: Create the `notify-telegram.sh` utility

**Files:**
- Create: `~/scripts/notify-telegram.sh`

- [ ] **Step 1: Write the script**

```bash
#!/bin/bash
# notify-telegram.sh — send a message to Gmini (Telegram Bot API)
# Usage: notify-telegram.sh "Your message here"
# Bot token loaded from ~/.claude/channels/telegram/.env
# Chat ID loaded from ~/.claude/channels/telegram/access.json (first allowFrom entry)

set -euo pipefail

MESSAGE="${1:-}"
if [[ -z "$MESSAGE" ]]; then
  echo "Usage: notify-telegram.sh <message>" >&2
  exit 1
fi

ENV_FILE="$HOME/.claude/channels/telegram/.env"
ACCESS_FILE="$HOME/.claude/channels/telegram/access.json"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "notify-telegram: $ENV_FILE not found, skipping notification" >&2
  exit 0
fi

BOT_TOKEN=$(grep TELEGRAM_BOT_TOKEN "$ENV_FILE" | cut -d= -f2)
CHAT_ID=$(python3 -c "import json; d=json.load(open('$ACCESS_FILE')); print(d['allowFrom'][0])")

RESPONSE=$(curl -s -X POST \
  "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\": \"${CHAT_ID}\", \"text\": $(python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))" <<< "$MESSAGE"), \"parse_mode\": \"Markdown\"}")

STATUS=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ok', False))")
if [[ "$STATUS" != "True" ]]; then
  echo "notify-telegram: send failed: $RESPONSE" >&2
  exit 1
fi
```

- [ ] **Step 2: Make executable**

```bash
chmod +x ~/scripts/notify-telegram.sh
```

- [ ] **Step 3: Smoke test**

```bash
~/scripts/notify-telegram.sh "test notification from Mac Mini"
```

Expected: message appears in Gmini Telegram chat within a few seconds.

- [ ] **Step 4: Commit**

```bash
cd ~/Projects/health-data-aggregator
git add ~/scripts/notify-telegram.sh
git commit -m "feat: add notify-telegram.sh utility for Gmini push notifications"
```

---

### Task 2: Notify after daily and weekly health reports

**Files:**
- Modify: `~/Projects/health-data-aggregator/scripts/run-health-report.sh`

- [ ] **Step 1: View current run-health-report.sh**

```bash
cat ~/Projects/health-data-aggregator/scripts/run-health-report.sh
```

- [ ] **Step 2: Add error trap and notification block**

Replace the file contents with the following (same script, adds error trapping + notification):

```bash
#!/bin/bash
# Wrapper for launchd to run health reports with .env loaded
set -euo pipefail

cd /Users/glennkinsman/Projects/health-data-aggregator

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

REPORT_TYPE="${1:-daily}"

# Notify Gmini on failure
trap '~/scripts/notify-telegram.sh "❌ Health report FAILED (${REPORT_TYPE}, $(date +\"%b %d %I:%M %p\")) — check ~/Library/Logs/health-pipeline.log" || true' ERR

npx tsx scripts/health-report.ts "$REPORT_TYPE" 2>&1

# Notify on success — send first 400 chars of the report as a preview
REPORT_DATE=$(date '+%b %d')
LATEST_REPORT=$(ls -t "reports/${REPORT_TYPE}"/*.md 2>/dev/null | head -1 || echo "")

if [[ -n "$LATEST_REPORT" ]]; then
  PREVIEW=$(head -c 400 "$LATEST_REPORT" || echo "(preview unavailable)")
  ~/scripts/notify-telegram.sh "${REPORT_TYPE^} health report ready (${REPORT_DATE}):

${PREVIEW}..." || true
else
  ~/scripts/notify-telegram.sh "${REPORT_TYPE^} health report ran (${REPORT_DATE}) — no output file found" || true
fi
```

- [ ] **Step 3: Test manually**

```bash
cd ~/Projects/health-data-aggregator && bash scripts/run-health-report.sh daily
```

Expected: Gmini receives a notification with the report date and a preview of the report content.

- [ ] **Step 4: Commit**

```bash
cd ~/Projects/health-data-aggregator
git add scripts/run-health-report.sh
git commit -m "feat: notify Gmini after health reports, alert on failure"
```

---

### Task 3: Replace dead ntfy in workout-tracker nightly improve

**Files:**
- Modify: `~/Projects/workout-tracker/scripts/improve.sh`

- [ ] **Step 1: Find CLAUDE_NOTIFY and ntfy references**

```bash
grep -n "CLAUDE_NOTIFY\|ntfy" ~/Projects/workout-tracker/scripts/improve.sh
```

- [ ] **Step 2: Remove CLAUDE_NOTIFY export**

Delete the line `export CLAUDE_NOTIFY=1`.

- [ ] **Step 3: Add error trap near top of script (after set -e line)**

```bash
# Notify Gmini on failure
trap '~/scripts/notify-telegram.sh "❌ Workout nightly improve FAILED ($(date +\"%b %d\")) — check ~/Projects/workout-tracker/logs/" || true' ERR
```

- [ ] **Step 4: Add success notification near the end of the script (after git operations complete)**

```bash
# Notify Gmini — branch is ready for morning review
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
~/scripts/notify-telegram.sh "Workout nightly improve ✓ ($(date +'%b %d'))
Branch: \`${BRANCH}\`
Cherry-pick improvements when ready." || true
```

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/workout-tracker
git add scripts/improve.sh
git commit -m "feat: replace ntfy with Telegram notification in nightly improve"
```

---

### Task 4: Replace dead ntfy in spend-tracker nightly improve

**Files:**
- Modify: `~/Projects/spend-tracker/scripts/improve.sh`

- [ ] **Step 1: Find CLAUDE_NOTIFY and ntfy references**

```bash
grep -n "CLAUDE_NOTIFY\|ntfy" ~/Projects/spend-tracker/scripts/improve.sh
```

- [ ] **Step 2: Remove CLAUDE_NOTIFY export**

Delete the line `export CLAUDE_NOTIFY=1`.

- [ ] **Step 3: Add error trap near top of script (after set -e line)**

```bash
# Notify Gmini on failure
trap '~/scripts/notify-telegram.sh "❌ Spend nightly improve FAILED ($(date +\"%b %d\")) — check ~/Projects/spend-tracker/logs/" || true' ERR
```

- [ ] **Step 4: Add success notification near the end of the script (after git operations complete)**

```bash
# Notify Gmini — branch is ready for morning review
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
~/scripts/notify-telegram.sh "Spend nightly improve ✓ ($(date +'%b %d'))
Branch: \`${BRANCH}\`
Cherry-pick improvements when ready." || true
```

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/spend-tracker
git add scripts/improve.sh
git commit -m "feat: replace ntfy with Telegram notification in nightly improve"
```

---

### Task 5: Verify end-to-end

- [ ] **Step 1: Test health report notification**

```bash
cd ~/Projects/health-data-aggregator && bash scripts/run-health-report.sh daily
```

Expected: one Gmini message with report preview.

- [ ] **Step 2: Verify no notification fires for Oura sync**

```bash
cd ~/Projects/health-data-aggregator && bash scripts/run-sync.sh
```

Expected: no Gmini message.

- [ ] **Step 3: Test failure notification**

```bash
# Temporarily break the script to trigger the ERR trap
bash -c 'trap "~/scripts/notify-telegram.sh \"❌ test failure alert\" || true" ERR; exit 1'
```

Expected: Gmini receives a failure alert.

- [ ] **Step 4: Verify Telegram downtime doesn't break jobs**

```bash
TELEGRAM_BOT_TOKEN=BROKEN ~/scripts/notify-telegram.sh "test" || echo "failed gracefully"
```

Expected: error printed to stderr, non-zero exit — but all callers use `|| true` so jobs continue.
