# Telegram Listener Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bun-based Telegram plugin with hdcd-telegram (Rust binary) to eliminate zombie processes, then simplify the wrapper script with a health check and 30-min backstop cycle.

**Architecture:** Download the hdcd-telegram ARM64 binary, register it as an MCP server via `~/Projects/inbox/.mcp.json`, update the tmux session launch command to use `--dangerously-load-development-channels server:telegram`, and rewrite the wrapper script to remove zombie cleanup and use an active Telegram API health check instead of a blind 5-min recycle.

**Tech Stack:** Bash, hdcd-telegram v0.1.1 (Rust binary), Telegram Bot API, launchd, tmux

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `~/.local/bin/hdcd-telegram` | Create | The Rust binary that replaces the bun Telegram plugin |
| `~/Projects/inbox/.mcp.json` | Create | Registers hdcd-telegram as an MCP server for the inbox session |
| `~/scripts/start-telegram-listener.sh` | Modify | Remove zombie cleanup, update launch command, add health check |

---

### Task 1: Download and install hdcd-telegram binary

**Files:**
- Create: `~/.local/bin/hdcd-telegram`

- [ ] **Step 1: Download the macOS ARM64 release**

```bash
cd /tmp
curl -L -o hdcd-telegram.tar.gz \
  https://github.com/gohyperdev/hdcd-telegram/releases/download/v0.1.1/hdcd-telegram-v0.1.1-macos-arm64.tar.gz
tar -xzf hdcd-telegram.tar.gz
ls -la
```

Expected: you should see an `hdcd-telegram` binary in the output.

- [ ] **Step 2: Verify the SHA256 checksum**

```bash
EXPECTED=$(curl -s https://github.com/gohyperdev/hdcd-telegram/releases/download/v0.1.1/SHA256SUMS.txt \
  | grep macos-arm64 | awk '{print $1}')
ACTUAL=$(shasum -a 256 hdcd-telegram | awk '{print $1}')
echo "Expected: $EXPECTED"
echo "Actual:   $ACTUAL"
[ "$EXPECTED" = "$ACTUAL" ] && echo "OK" || echo "MISMATCH — do not proceed"
```

Expected: `OK`

- [ ] **Step 3: Install to ~/.local/bin/ and remove quarantine**

```bash
mkdir -p ~/.local/bin
cp /tmp/hdcd-telegram ~/.local/bin/hdcd-telegram
chmod +x ~/.local/bin/hdcd-telegram
xattr -d com.apple.quarantine ~/.local/bin/hdcd-telegram 2>/dev/null || true
```

- [ ] **Step 4: Verify the binary runs**

```bash
~/.local/bin/hdcd-telegram --version
```

Expected: version string printed, no crash. If you see a Gatekeeper error, re-run the `xattr` command from Step 3.

- [ ] **Step 5: Commit**

```bash
# Binary is outside any git repo — nothing to commit.
# Record the install in a comment for the next commit.
echo "hdcd-telegram v0.1.1 installed to ~/.local/bin/hdcd-telegram"
```

---

### Task 2: Register hdcd-telegram as an MCP server

**Files:**
- Create: `~/Projects/inbox/.mcp.json`

This file tells Claude Code to load hdcd-telegram as the `telegram` MCP server whenever a session starts in `~/Projects/inbox`. The `--dangerously-load-development-channels server:telegram` flag then activates it as a channel.

- [ ] **Step 1: Create the MCP config**

```bash
cat > ~/Projects/inbox/.mcp.json << 'EOF'
{
  "mcpServers": {
    "telegram": {
      "command": "/Users/glennkinsman/.local/bin/hdcd-telegram",
      "args": []
    }
  }
}
EOF
```

- [ ] **Step 2: Verify it parses correctly**

```bash
python3 -m json.tool ~/Projects/inbox/.mcp.json
```

Expected: pretty-printed JSON with no errors.

- [ ] **Step 3: Confirm existing Telegram config is intact**

```bash
# Confirm token file exists (don't print the token)
grep -c TELEGRAM_BOT_TOKEN ~/.claude/channels/telegram/.env && echo "token file ok"
# Confirm access list has your chat ID
cat ~/.claude/channels/telegram/access.json
```

Expected: `token file ok` and your chat ID visible in `allowFrom`.

---

### Task 3: Rewrite the wrapper script

**Files:**
- Modify: `~/scripts/start-telegram-listener.sh`

Replace the full file. Key changes vs the current version:
- Removes `cleanup_channel_procs` function and all `pgrep/kill` calls (zombie cleanup not needed)
- Updates the `tmux new-session` launch command to use `--dangerously-load-development-channels server:telegram`
- Extends `MAX_RUNTIME` from 300 → 1800 (5 min → 30 min backstop)
- Adds a 60-second health check loop with 3-failure threshold before recycling

- [ ] **Step 1: Back up the current script**

```bash
cp ~/scripts/start-telegram-listener.sh ~/scripts/start-telegram-listener.sh.bak
```

- [ ] **Step 2: Write the new script**

```bash
cat > ~/scripts/start-telegram-listener.sh << 'SCRIPT'
#!/bin/bash
# start-telegram-listener.sh — always-on Claude Code session subscribed to Telegram (Gmini bot)
# Managed by launchd (com.claude.telegram-listener.plist).
# Attach interactively: tmux attach -t telegram
#
# Uses hdcd-telegram (Rust binary) instead of the official bun plugin.
# Clean process exit on session kill — no zombie cleanup needed.
# Health check every 60s: recycles if Telegram API unreachable 3x in a row.
# Backstop recycle at MAX_RUNTIME (30 min) regardless of health.
set -euo pipefail

SESSION="telegram"
WORKDIR="$HOME/Projects/inbox"
MAX_RUNTIME=1800         # 30-minute backstop
SCHEDULED_FLAG="/tmp/telegram-listener-scheduled-exit"
ENV_FILE="$HOME/.claude/channels/telegram/.env"

# Load bot token for health checks
BOT_TOKEN=""
if [[ -f "$ENV_FILE" ]]; then
  BOT_TOKEN=$(grep TELEGRAM_BOT_TOKEN "$ENV_FILE" | cut -d= -f2- | xargs)
fi

# ── Startup ping logic ────────────────────────────────────────────────────────
# Only ping on first launch or crash recovery — not on routine backstop cycles.
if [ -f "$SCHEDULED_FLAG" ]; then
  rm -f "$SCHEDULED_FLAG"
else
  SEND_PING=1
fi

# ── Session guard ─────────────────────────────────────────────────────────────
# If a session already exists (e.g. launchd restarted wrapper but claude is still
# running inside tmux), wait for it to end with max runtime enforced.
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "$(date): session '$SESSION' already exists, waiting with max runtime enforced..."
  WAIT_STARTED=$(date +%s)
  while tmux has-session -t "$SESSION" 2>/dev/null; do
    sleep 15
    NOW=$(date +%s)
    if [ $((NOW - WAIT_STARTED)) -ge $MAX_RUNTIME ]; then
      echo "$(date): backstop — recycling inherited session"
      touch "$SCHEDULED_FLAG"
      tmux kill-session -t "$SESSION" 2>/dev/null || true
      break
    fi
  done
  echo "$(date): session ended, exiting wrapper"
  exit 0
fi

echo "$(date): starting telegram listener in tmux session '$SESSION'"

tmux new-session -d -s "$SESSION" -c "$WORKDIR" \
  "unset CLAUDECODE; claude -n gmini --permission-mode auto --dangerously-load-development-channels server:telegram; echo \"claude exited \$?\"; sleep 5"

echo "$(date): tmux session '$SESSION' started"

# Send startup ping on first launch or crash recovery only
if [ "${SEND_PING:-0}" = "1" ]; then
  sleep 5
  ~/scripts/notify-telegram.sh "🟢 Gmini listener started ($(date +'%b %d %I:%M %p'))" || \
    echo "$(date): WARNING — startup notification failed" >&2
fi

# ── Health check + keep-alive loop ───────────────────────────────────────────
# Blocks launchd supervision while enforcing health checks and the backstop cycle.
STARTED_AT=$(date +%s)
FAIL_COUNT=0

while tmux has-session -t "$SESSION" 2>/dev/null; do
  sleep 60
  NOW=$(date +%s)

  # Backstop: recycle after MAX_RUNTIME regardless of health
  if [ $((NOW - STARTED_AT)) -ge $MAX_RUNTIME ]; then
    echo "$(date): backstop cycle — recycling session for fresh Telegram connection"
    touch "$SCHEDULED_FLAG"
    tmux kill-session -t "$SESSION" 2>/dev/null || true
    break
  fi

  # Health check: verify Telegram API is reachable
  # Three consecutive failures = stalled connection, recycle
  if [[ -n "$BOT_TOKEN" ]]; then
    if curl -sf --max-time 10 "https://api.telegram.org/bot${BOT_TOKEN}/getMe" | grep -q '"ok":true'; then
      FAIL_COUNT=0
    else
      FAIL_COUNT=$((FAIL_COUNT + 1))
      echo "$(date): health check failed ($FAIL_COUNT/3)"
      if [ $FAIL_COUNT -ge 3 ]; then
        echo "$(date): 3 consecutive health check failures — recycling session"
        tmux kill-session -t "$SESSION" 2>/dev/null || true
        break
      fi
    fi
  fi
done

echo "$(date): session ended, wrapper exiting (launchd will restart)"
SCRIPT
chmod +x ~/scripts/start-telegram-listener.sh
```

- [ ] **Step 3: Verify the script is valid bash**

```bash
bash -n ~/scripts/start-telegram-listener.sh && echo "syntax ok"
```

Expected: `syntax ok`

---

### Task 4: Restart the service and verify

- [ ] **Step 1: Unload the launchd job (stops the current listener gracefully)**

```bash
launchctl unload ~/Library/LaunchAgents/com.claude.telegram-listener.plist
sleep 3
# Confirm the old session is gone
tmux list-sessions 2>/dev/null || echo "no tmux sessions"
```

Expected: `telegram` session is no longer listed (or "no tmux sessions").

- [ ] **Step 2: Confirm no stale bun Telegram processes remain**

```bash
pgrep -f "bun.*telegram" 2>/dev/null && echo "WARNING: stale bun processes found" || echo "clean"
```

Expected: `clean`. If stale processes are found, kill them: `pkill -f "bun.*telegram"`.

- [ ] **Step 3: Load the launchd job (starts the new listener)**

```bash
launchctl load ~/Library/LaunchAgents/com.claude.telegram-listener.plist
sleep 8
```

- [ ] **Step 4: Confirm new tmux session is running**

```bash
tmux list-sessions
```

Expected: `telegram: 1 windows` (or similar). If not present, check the log:

```bash
tail -20 ~/Library/Logs/claude-telegram-listener.log
```

- [ ] **Step 5: Confirm hdcd-telegram process is running (not bun)**

```bash
ps aux | grep -E "(hdcd-telegram|telegram)" | grep -v grep
```

Expected: you should see `hdcd-telegram` in the process list. You should NOT see `bun run --cwd.*telegram`.

- [ ] **Step 6: Send a test Telegram message to Gmini and verify a response**

Send any message from your phone to @glennmini_bot. Wait up to 30 seconds. Confirm a response arrives.

If no response after 30s:
```bash
# Attach to the session to see what's happening
tmux attach -t telegram
# Detach with Ctrl+B then D
```

- [ ] **Step 7: Verify a health check cycle completes cleanly**

Wait 2 minutes, then check the log:

```bash
tail -30 ~/Library/Logs/claude-telegram-listener.log
```

Expected: you should see normal log lines. You should NOT see any `health check failed` lines (unless there's a real connectivity issue).

- [ ] **Step 8: Commit the changes**

```bash
cd ~/Projects/health-data-aggregator
git add docs/superpowers/plans/2026-04-08-telegram-listener-hardening.md
git commit -m "chore: add Telegram listener hardening implementation plan

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

Note: `~/scripts/start-telegram-listener.sh` and `~/Projects/inbox/.mcp.json` are outside this git repo and don't need to be committed here.

---

## Rollback

If anything goes wrong, restore the backup and restart:

```bash
cp ~/scripts/start-telegram-listener.sh.bak ~/scripts/start-telegram-listener.sh
rm ~/Projects/inbox/.mcp.json
launchctl unload ~/Library/LaunchAgents/com.claude.telegram-listener.plist
launchctl load ~/Library/LaunchAgents/com.claude.telegram-listener.plist
```

---

## Post-deployment monitoring (1 week)

Watch for these in `~/Library/Logs/claude-telegram-listener.log`:
- Frequent `health check failed` lines → increase curl `--max-time` or investigate network
- Sessions restarting more often than every 30 min → hdcd-telegram may be crashing; check `tmux attach -t telegram` for error output
- No restarts at all after 30+ min → backstop is working, health checks are clean ✓

Expected steady-state: one `starting telegram listener` line per 30 min, zero `health check failed` lines.
