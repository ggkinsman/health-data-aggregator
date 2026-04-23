# Domain-Specialized Agents + GitHub Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Gmini from a single general-purpose agent into a smart orchestrator that routes requests to domain-specialized contexts (health, spend, workout, general), and integrate GitHub so Gmini can query issues, PRs, and repo state.

**Architecture:** Gmini's `CLAUDE.md` gets explicit routing rules and loads domain-specific context files when switching projects. Domain files (`~/Projects/inbox/domains/*.md`) contain focused command references and personality for each project. A single Telegram bot handles everything — no separate bots needed. GitHub is connected via MCP (already installed, needs auth).

**Tech Stack:** CLAUDE.md routing conventions, domain context files (markdown), `claude mcp add` for GitHub auth, existing project CLAUDE.md files.

---

### Task 1: Authenticate the GitHub MCP plugin

**Files:**
- No files — CLI auth command only

- [ ] **Step 1: Add GitHub MCP server**

```bash
claude mcp add github --transport http https://api.githubcopilot.com/mcp/
```

This will open a browser authentication flow. Complete it.

- [ ] **Step 2: Verify GitHub tools are available**

In a Claude Code session, run:

```
/mcp
```

Expected: `github` appears in the MCP server list as connected.

- [ ] **Step 3: Test a GitHub query**

Ask Claude: "List my recent GitHub repos"

Expected: Claude uses the GitHub MCP tool and returns repo list.

---

### Task 2: Create domain context files

**Files:**
- Create: `~/Projects/inbox/domains/health.md`
- Create: `~/Projects/inbox/domains/spend.md`
- Create: `~/Projects/inbox/domains/workout.md`

- [ ] **Step 1: Create health domain context**

Create `~/Projects/inbox/domains/health.md`:

```markdown
# Health Domain Context

**Project path:** `~/Projects/health-data-aggregator`
**Always cd here before running any health commands.**

## Key Commands
- `npm run health:ask -- "question"` — natural language health data query
- `npm run sync:oura` — sync latest Oura data
- `npm run import:cpap` — import latest CPAP data from OSCAR
- `npm run health:report -- daily` — generate daily report (uses API credits)
- `npm run build:summaries -- --days 7` — rebuild last 7 days of summaries
- `/health-report daily` — generate report locally (no API cost)
- `/import-cpap` — full CPAP import + summary rebuild

## Data Sources
- Oura Ring: sleep, HRV, activity (syncs 2x daily via launchd)
- Apple Health: HR, HRV, workouts (manual XML import)
- CPAP: 249+ nights from OSCAR backup
- Travel: 28 trips in SQLite

## Key Context
- Apple Watch daytime HRV is the primary recovery signal (not Oura — CPAP suppresses it)
- Patient: 32M, severe OSA (pAHI=50), on APAP since Jul 2025
- Reports saved to `reports/daily/` and `reports/weekly/`

## Logs
- Sync: `~/Library/Logs/health-data-oura-sync.log`
- Pipeline: `~/Library/Logs/health-pipeline.log`
```

- [ ] **Step 2: Create spend domain context**

Create `~/Projects/inbox/domains/spend.md`:

```markdown
# Spend Domain Context

**Project path:** `~/Projects/spend-tracker`
**Always cd here before running any spend commands.**

## Key Commands
- See `~/Projects/spend-tracker/CLAUDE.md` for full command list
- Nightly improve runs at 3 AM (launchd `com.spend-tracker.nightly-improve`)

## Logs
- `~/Projects/spend-tracker/logs/`
```

- [ ] **Step 3: Create workout domain context**

Create `~/Projects/inbox/domains/workout.md`:

```markdown
# Workout Domain Context

**Project path:** `~/Projects/workout-tracker`
**Always cd here before running any workout commands.**

## Key Commands
- See `~/Projects/workout-tracker/CLAUDE.md` for full command list
- Daily sync at 6 AM, nightly improve at 2 AM (launchd)

## Logs
- `~/Projects/workout-tracker/logs/`
```

- [ ] **Step 4: Commit domain files**

```bash
cd ~/Projects/inbox
git init 2>/dev/null || true
git add domains/
git commit -m "feat: add domain context files for health, spend, workout routing" || echo "no git in inbox, files created"
```

---

### Task 3: Rewrite Gmini's CLAUDE.md with domain routing

**Files:**
- Modify: `~/Projects/inbox/CLAUDE.md`

- [ ] **Step 1: Replace the Glenn's Projects section with domain routing instructions**

Replace the existing `## Glenn's Projects` section and `## Example Interactions` section with the following:

```markdown
## Domain Routing

Gmini is the central orchestrator. When a request is domain-specific, route to the right project by:
1. `cd` to the project directory
2. Reading the domain context file from `~/Projects/inbox/domains/<domain>.md`
3. Reading the project's own `CLAUDE.md`
4. Running commands there

### Routing Rules

| Trigger | Domain | Project path |
|---------|--------|-------------|
| `!health` prefix, or: sleep, HRV, Oura, CPAP, heart rate, recovery, health report | Health | `~/Projects/health-data-aggregator` |
| `!spend` prefix, or: spending, transactions, budget, money, expenses | Spend | `~/Projects/spend-tracker` |
| `!workout` prefix, or: exercise, training, workout, gym, run, ride | Workout | `~/Projects/workout-tracker` |
| `!github` prefix, or: PR, issue, repo, commit, code review | GitHub | Use GitHub MCP tools directly |
| Everything else | General | Answer inline |

### Routing Process

When routing to a domain:
1. Read `~/Projects/inbox/domains/<domain>.md` for quick command reference
2. `cd ~/Projects/<project-name>`
3. Source `.env` if needed: the project's CLAUDE.md will tell you

### Command Prefixes (optional shortcuts)
- `!health <query>` → health domain
- `!spend <query>` → spend domain
- `!workout <query>` → workout domain
- `!github <query>` → GitHub tools
- `!jobs` → check recent launchd job logs
- `!reset` → this message resets context (Glenn can send to start fresh)

## GitHub

GitHub MCP is connected. Use it to:
- List repos, issues, PRs for github.com/glennkinsman
- Answer questions about code, open issues, recent commits
- Draft PR descriptions or issue summaries on request

Never push code or merge PRs without explicit confirmation.

## Example Interactions

- `!health how was my sleep last week?` → `cd ~/Projects/health-data-aggregator && npm run health:ask -- "summarize sleep quality last week"`
- `sync oura` → `cd ~/Projects/health-data-aggregator && npm run sync:oura`
- `import cpap` → `cd ~/Projects/health-data-aggregator && npm run import:cpap`
- `!github what are my open PRs?` → use GitHub MCP list_pull_requests tool
- `!jobs` → `tail -20 ~/Library/Logs/health-data-oura-sync.log ~/Library/Logs/health-pipeline.log`
- `what time is it?` → just answer
- `!workout how many workouts this month?` → `cd ~/Projects/workout-tracker` then use workout query command
- `!reset` → acknowledge and treat the next message as a fresh start
```

- [ ] **Step 2: Verify the file looks right**

```bash
cat ~/Projects/inbox/CLAUDE.md
```

Review that routing rules are clear and domain files are referenced correctly.

- [ ] **Step 3: Commit**

```bash
# No git in inbox dir likely — just verify the file was saved
ls -la ~/Projects/inbox/CLAUDE.md ~/Projects/inbox/domains/
```

---

### Task 4: Add GitHub to the launchd listener PATH (ensure MCP auth is accessible)

**Files:**
- Verify: `~/Library/LaunchAgents/com.claude.telegram-listener.plist`
- Verify: `~/Library/LaunchAgents/com.claude.imessage-listener.plist`

- [ ] **Step 1: Check where GitHub MCP credentials are stored**

```bash
cat ~/.claude/mcp_servers.json 2>/dev/null || ls ~/.claude/ | grep -i github
```

Note the path — credentials stored by `claude mcp add` live in Claude's config directory and are accessible to launchd sessions (same user, same home directory). No plist changes needed.

- [ ] **Step 2: Verify GitHub works in a headless context**

```bash
tmux send-keys -t telegram "list my GitHub repos" Enter
sleep 10
tmux capture-pane -t telegram -p | tail -20
```

Expected: Gmini uses GitHub MCP and returns a repo list.

---

### Task 5: End-to-end routing test

- [ ] **Step 1: Test health routing**

Send to Gmini: `!health how many hours of sleep did I get last night?`

Expected: Gmini cd's to health-data-aggregator and queries SQLite, replies with sleep duration.

- [ ] **Step 2: Test spend routing**

Send to Gmini: `!spend what did I spend most on this month?`

Expected: Gmini cd's to spend-tracker, runs appropriate query, replies.

- [ ] **Step 3: Test GitHub routing**

Send to Gmini: `!github what are my open issues on health-data-aggregator?`

Expected: Gmini uses GitHub MCP and lists open issues.

- [ ] **Step 4: Test jobs shortcut**

Send to Gmini: `!jobs`

Expected: Gmini tails recent launchd logs and reports status of overnight jobs.

- [ ] **Step 5: Test reset**

Send to Gmini: `!reset`

Expected: Gmini acknowledges and is ready for a fresh topic.
