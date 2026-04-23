# Remote Permission Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Claude Code is running remotely (iMessage or Telegram session) and hits a risky tool call (Bash writes, file edits) that requires permission, send a Telegram notification with the details and allow Glenn to approve or deny from his phone within 60 seconds.

**Architecture:** A `PreToolUse` hook in `~/.claude/settings.json` runs `~/.claude/hooks/pre-tool-approve.sh` before any Bash/Write/Edit tool call. The hook checks if it's a remote session (via `REMOTE_SESSION=1` env var set in the listener wrapper scripts), then sends a Telegram message and polls the Bot API for a YES/NO reply for up to 60 seconds. Exit 0 = approve, exit 2 = deny. Interactive Cursor sessions are unaffected (no `REMOTE_SESSION` var).

**Tech Stack:** bash, curl, Python3 (JSON parsing), Telegram Bot API (`getUpdates`, `sendMessage`), Claude Code PreToolUse hooks.

---

### Task 1: Set `REMOTE_SESSION=1` in listener wrapper scripts

**Files:**
- Modify: `~/scripts/start-telegram-listener.sh`
- Modify: `~/scripts/start-imessage-listener.sh`

- [ ] **Step 1: Update start-telegram-listener.sh**

Find the `tmux new-session` line and add `REMOTE_SESSION=1` before `unset CLAUDECODE`:

```bash
tmux new-session -d -s "$SESSION" -c "$WORKDIR" \
  "export REMOTE_SESSION=1; unset CLAUDECODE; claude -n gmini --channels plugin:telegram@claude-plugins-official; echo \"claude exited \$?\"; sleep 5"
```

- [ ] **Step 2: Update start-imessage-listener.sh**

Same change — add `export REMOTE_SESSION=1;` before `unset CLAUDECODE`:

```bash
tmux new-session -d -s "$SESSION" -c "$WORKDIR" \
  "export REMOTE_SESSION=1; unset CLAUDECODE; claude -n imessage --channels plugin:imessage@claude-plugins-official; echo \"claude exited \$?\"; sleep 5"
```

- [ ] **Step 3: Commit**

```bash
git add ~/scripts/start-telegram-listener.sh ~/scripts/start-imessage-listener.sh
git commit -m "feat: set REMOTE_SESSION=1 env var in listener wrapper scripts"
```

---

### Task 2: Create the pre-tool-approve hook script

**Files:**
- Create: `~/.claude/hooks/pre-tool-approve.sh`

- [ ] **Step 1: Write the hook**

```bash
#!/bin/bash
# pre-tool-approve.sh — Claude Code PreToolUse hook for remote permission relay
#
# Only activates for remote sessions (REMOTE_SESSION=1).
# Reads tool call details from stdin (JSON), sends a Telegram notification,
# and polls for YES/NO reply for 60 seconds.
# Exit 0 = allow, Exit 2 = deny (Claude Code PreToolUse protocol).

set -euo pipefail

# Only run for remote sessions — interactive Cursor sessions pass through
if [[ "${REMOTE_SESSION:-0}" != "1" ]]; then
  exit 0
fi

ENV_FILE="$HOME/.claude/channels/telegram/.env"
ACCESS_FILE="$HOME/.claude/channels/telegram/access.json"

if [[ ! -f "$ENV_FILE" ]]; then
  exit 0  # Telegram not configured — allow the tool call
fi

BOT_TOKEN=$(grep TELEGRAM_BOT_TOKEN "$ENV_FILE" | cut -d= -f2)
CHAT_ID=$(python3 -c "import json; d=json.load(open('$ACCESS_FILE')); print(d['allowFrom'][0])")

# Read tool call details from stdin
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_name', 'unknown'))")
TOOL_INPUT=$(echo "$INPUT" | python3 -c "
import json, sys
d = json.load(sys.stdin)
inp = d.get('tool_input', {})
# Show the most relevant field depending on tool type
if 'command' in inp:
    print(str(inp['command'])[:300])
elif 'file_path' in inp:
    print(str(inp.get('file_path', '')) + ' — ' + str(inp.get('new_string', ''))[:100])
else:
    print(str(inp)[:300])
")

# Record timestamp before sending so we only look at replies that come after
SENT_TS=$(date +%s)

# Send approval request to Telegram
MESSAGE="🔐 *Tool approval needed*
Session: remote
Tool: \`${TOOL_NAME}\`
Input: \`${TOOL_INPUT}\`

Reply *YES* to approve or *NO* to deny (60s timeout → denied)"

curl -s -X POST \
  "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\": \"${CHAT_ID}\", \"text\": $(python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))" <<< "$MESSAGE"), \"parse_mode\": \"Markdown\"}" \
  > /dev/null

# Poll for YES/NO reply — check every 5 seconds for 60 seconds (12 attempts)
for i in $(seq 1 12); do
  sleep 5

  REPLY=$(curl -s \
    "https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=1&offset=-1" | \
    python3 -c "
import json, sys
data = json.load(sys.stdin)
results = data.get('result', [])
if not results:
    print('')
else:
    msg = results[-1].get('message', {})
    msg_ts = int(msg.get('date', 0))
    text = msg.get('text', '').strip().upper()
    # Only consider replies that arrived after we sent the notification
    if msg_ts > $SENT_TS and text in ('YES', 'NO', 'Y', 'N', 'APPROVE', 'DENY', 'OK'):
        print(text)
    else:
        print('')
")

  case "$REPLY" in
    YES|Y|APPROVE|OK)
      exit 0
      ;;
    NO|N|DENY)
      echo '{"decision": "block", "reason": "Denied via Telegram by Glenn"}'
      exit 2
      ;;
  esac
done

# Timeout — deny by default (safer for unattended remote sessions)
echo '{"decision": "block", "reason": "Approval timed out (60s) — denied for safety. Retry and reply faster."}'
exit 2
```

- [ ] **Step 2: Make executable**

```bash
chmod +x ~/.claude/hooks/pre-tool-approve.sh
```

- [ ] **Step 3: Syntax check**

```bash
bash -n ~/.claude/hooks/pre-tool-approve.sh
```

Expected: no output (clean syntax).

---

### Task 3: Register the hook in `~/.claude/settings.json`

**Files:**
- Modify: `~/.claude/settings.json`

- [ ] **Step 1: View current hooks section**

```bash
python3 -c "import json; d=json.load(open('$HOME/.claude/settings.json')); print(json.dumps(d.get('hooks', {}), indent=2))"
```

- [ ] **Step 2: Add PreToolUse hook**

Open `~/.claude/settings.json` and add a `hooks` key (or merge into the existing one). The final hooks section should look like:

```json
"hooks": {
  "PreToolUse": [
    {
      "matcher": "Bash|Write|Edit",
      "hooks": [
        {
          "type": "command",
          "command": "bash ~/.claude/hooks/pre-tool-approve.sh"
        }
      ]
    }
  ]
}
```

- [ ] **Step 3: Validate JSON**

```bash
python3 -c "import json; json.load(open('$HOME/.claude/settings.json')); print('Valid JSON')"
```

Expected: `Valid JSON`

- [ ] **Step 4: Commit**

```bash
git add ~/.claude/hooks/pre-tool-approve.sh
git commit -m "feat: add remote permission relay hook for Telegram approval"
```

---

### Task 4: Restart listener sessions to pick up REMOTE_SESSION env var

- [ ] **Step 1: Kill and restart both sessions**

```bash
tmux kill-session -t telegram 2>/dev/null; tmux kill-session -t imessage 2>/dev/null
sleep 35  # wait for launchd KeepAlive restart
tmux list-sessions
```

Expected: both `imessage` and `telegram` sessions restart.

- [ ] **Step 2: Verify REMOTE_SESSION is set inside the sessions**

```bash
tmux send-keys -t telegram "echo REMOTE_SESSION=$REMOTE_SESSION" Enter
sleep 2
tmux capture-pane -t telegram -p | tail -5
```

Expected: output contains `REMOTE_SESSION=1`.

---

### Task 5: End-to-end test

- [ ] **Step 1: From Telegram, ask Gmini to run a Bash command that would trigger the hook**

Send to @glennmini_bot: `run echo hello`

Expected: Telegram receives a "Tool approval needed" notification with the Bash command shown.

- [ ] **Step 2: Reply YES and confirm execution**

Reply `YES` to Gmini.

Expected: the tool runs and Gmini replies with `hello`.

- [ ] **Step 3: Test denial**

Ask Gmini to run another command, reply `NO`.

Expected: Gmini receives a "Denied via Telegram" message and stops.

- [ ] **Step 4: Test timeout**

Trigger a tool call and do not reply for 60 seconds.

Expected: Gmini receives a timeout denial message.

- [ ] **Step 5: Verify interactive Cursor session is unaffected**

Open a new Cursor Claude Code session and run a Bash command. 

Expected: no Telegram notification, command runs immediately (no REMOTE_SESSION var set).
