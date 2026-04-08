# Telegram Listener Hardening Design

**Date:** 2026-04-08  
**Status:** Approved  
**Scope:** Mac Mini always-on Claude Code setup — Telegram channel only

## Problem

The current Telegram listener has two failure modes that cause slow responses and missed messages:

1. **Zombie bun processes** — the official Telegram plugin runs inside the bun runtime. When the tmux session is killed (every 5 min), bun's process group survives and keeps holding Telegram's long-poll slot. New sessions then start polling with a competing process already consuming updates, dropping messages silently.

2. **Cold-start gap** — the 5-min blind recycle was introduced to prevent long-polling stalls. But every recycle creates a ~10-30s window where Claude is initialising and any message sent during that window is permanently lost (Telegram does not queue undelivered messages).

## Solution

Replace the official bun-based Telegram plugin with `hdcd-telegram` — a self-contained Rust binary that is a drop-in replacement. It exits cleanly when the parent session dies, eliminating the zombie process problem at source. With zombies gone, the 5-min blind recycle is no longer necessary. Replace it with a 30-min backstop and an active health check.

## What Changes

### 1. Binary

Download `hdcd-telegram` macOS ARM64 binary from the latest GitHub release (`gohyperdev/hdcd-telegram`). Install to `~/.local/bin/hdcd-telegram`.

### 2. Plugin configuration

Update Claude Code's channel loading to use `hdcd-telegram` instead of `plugin:telegram@claude-plugins-official`. Exact mechanism (`.mcp.json` entry or `--dangerously-load-development-channels` flag) to be confirmed from the hdcd-telegram README during implementation. Existing config files are reused:

- `~/.claude/channels/telegram/.env` — bot token, unchanged
- `~/.claude/channels/telegram/access.json` — allowlist + chat ID, unchanged

### 3. Wrapper script (`~/scripts/start-telegram-listener.sh`)

Simplified from ~100 lines to ~50 lines:

- **Remove:** zombie process cleanup (`cleanup_channel_procs` function and all `pgrep/kill` logic) — no longer needed
- **Extend:** `MAX_RUNTIME` from 300s → 1800s (30 min) as a backstop
- **Add:** active health check loop every 60s — `curl` to `api.telegram.org/bot{TOKEN}/getMe`. Three consecutive failures trigger a recycle. Healthy sessions run uninterrupted for up to 30 min.
- **Keep:** startup ping logic (crash vs scheduled cycle distinction via flag file), tmux session guard, launchd-compatible exit behaviour

Health check pseudocode:
```bash
FAIL_COUNT=0
while tmux has-session -t "$SESSION"; do
  sleep 60
  if curl -sf "https://api.telegram.org/bot${BOT_TOKEN}/getMe" | grep -q '"ok":true'; then
    FAIL_COUNT=0
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    if [ $FAIL_COUNT -ge 3 ]; then
      # recycle session
    fi
  fi
  # also enforce MAX_RUNTIME backstop
done
```

### 4. Session startup command

Update the `tmux new-session` line to invoke Claude Code with hdcd-telegram. Exact flag TBD from README (likely `claude -n gmini --permission-mode auto --channels <hdcd-telegram-channel-flag>`).

## What Doesn't Change

- `com.claude.telegram-listener.plist` — unchanged (KeepAlive, ThrottleInterval 30s, PATH)
- iMessage listener — untouched
- `~/scripts/notify-telegram.sh` — unchanged
- `~/.claude/channels/telegram/` config files — reused as-is
- Startup ping behaviour — unchanged

## Expected Outcomes

| Symptom | Before | After |
|---|---|---|
| Missed messages | Common (zombie competes for poll slot) | Rare (clean exit, no competing process) |
| Cold-start gap | ~10-30s every 5 min | ~10-30s every 30 min max |
| Session restarts/day | ~288 (5-min cycle) | ~48 (30-min backstop) |
| Active recycles | Only on actual stall (health check fails 3×) | Same |
| Script complexity | ~100 lines with zombie cleanup | ~50 lines |

## Implementation Notes

- Verify hdcd-telegram README for exact channel flag and `.mcp.json` config before changing the wrapper
- Test with the existing Telegram bot token and access.json — no re-pairing should be needed
- After switching, monitor `~/Library/Logs/claude-telegram-listener.log` for a session or two to confirm no zombie processes appear and health checks pass
- If health checks prove noisy (false positives causing unnecessary recycles), increase failure threshold from 3 to 5

## Out of Scope

- iMessage listener improvements
- Vercel watchdog / dead man's switch (revisit if reliability gaps remain after a week)
- Outbound `notify-telegram.sh` — already working correctly
