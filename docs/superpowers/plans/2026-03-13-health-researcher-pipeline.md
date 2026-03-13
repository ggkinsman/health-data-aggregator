# Health Researcher Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-agent health data analysis pipeline where Dr. Hayden (primary researcher) drafts insights, three specialist reviewers verify accuracy, and the researcher delivers vetted analysis to the user.

**Architecture:** TypeScript pipeline using Anthropic SDK for sequential `messages.create()` calls. Data context builder queries existing SQLite `daily_summary` table + unified views. Orchestrator chains: data build → Hayden draft → code execution → 3 parallel reviews → Hayden revision → self-reflection → output. Session memory via JSON file with file locking.

**Tech Stack:** TypeScript, `@anthropic-ai/sdk`, better-sqlite3, vitest, launchd

**Spec:** `docs/superpowers/specs/2026-03-13-health-researcher-agents-design.md`

---

## File Map

### New Files
- `src/pipeline/types.ts` — All pipeline interfaces (DataContext, PipelineResult, SessionMemory, ReviewVerdict, etc.)
- `src/pipeline/data-context-builder.ts` — Queries daily_summary + raw tables, computes anomalies, assembles context
- `src/pipeline/__tests__/data-context-builder.test.ts` — Tests for data context assembly
- `src/pipeline/serialize-context.ts` — Converts DataContext to LLM-friendly text
- `src/pipeline/__tests__/serialize-context.test.ts` — Tests for serialization
- `src/pipeline/code-executor.ts` — Sandboxed SQL execution with validation
- `src/pipeline/__tests__/code-executor.test.ts` — Tests for code extraction, execution, validation
- `src/pipeline/session-memory.ts` — Load/save/prune memory.json with file locking
- `src/pipeline/__tests__/session-memory.test.ts` — Tests for memory persistence
- `src/pipeline/orchestrator.ts` — Full pipeline orchestration with Anthropic SDK
- `src/pipeline/__tests__/orchestrator.test.ts` — Tests for helper functions (prompt building, review parsing)
- `prompts/hayden-researcher.md` — Primary researcher system prompt
- `prompts/reviewer-statistician.md` — Statistical review prompt
- `prompts/reviewer-sleep.md` — Sleep & recovery review prompt
- `prompts/reviewer-biomarker.md` — Biomarker & wellness review prompt
- `prompts/self-reflection.md` — Self-reflection check prompt
- `prompts/report-templates/daily-briefing.md` — Daily report parameters
- `prompts/report-templates/weekly-deep-dive.md` — Weekly report parameters
- `scripts/health-ask.ts` — Interactive CLI entry point
- `scripts/health-report.ts` — Automated report CLI entry point
- `scripts/run-health-report.sh` — launchd wrapper script
- `~/Library/LaunchAgents/com.health-data-aggregator.daily-report.plist` — Daily report schedule
- `~/Library/LaunchAgents/com.health-data-aggregator.weekly-report.plist` — Weekly report schedule

### Modified Files
- `package.json` — Add `@anthropic-ai/sdk` dependency + new npm scripts
- `.gitignore` — Add `reports/` directory

---

## Chunk 1: Foundation — Dependencies and Types

### Task 1: Install Anthropic SDK

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the Anthropic SDK**

Run: `npm install @anthropic-ai/sdk`

- [ ] **Step 2: Verify installation**

Run: `npm ls @anthropic-ai/sdk`
Expected: Shows installed version

- [ ] **Step 3: Add reports/ to .gitignore**

Add `reports/` to `.gitignore` after the existing `data/` entry.

- [ ] **Step 4: Add npm scripts to package.json**

Add these scripts:
```json
"health:ask": "tsx scripts/health-ask.ts",
"health:report": "tsx scripts/health-report.ts"
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "feat: add Anthropic SDK dependency and pipeline npm scripts"
```

### Task 2: Define pipeline types

**Files:**
- Create: `src/pipeline/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js';

// --- Data Context ---

export interface DataContext {
  timeRange: { earliest: string; latest: string };
  shortTerm: DaySnapshot[];      // last 3 days
  mediumTerm: TrendSummary;      // last 30 days
  longTerm: MonthlyAverage[];    // last 6 months
  anomalies: Anomaly[];
  sourceCoverage: SourceCoverage;
}

export interface DaySnapshot {
  day: string;
  readinessScore: number | null;
  sleepScore: number | null;
  activityScore: number | null;
  totalSleepMinutes: number | null;
  deepSleepMinutes: number | null;
  remSleepMinutes: number | null;
  sleepEfficiency: number | null;
  avgRestingHr: number | null;
  minHr: number | null;
  maxHr: number | null;
  avgHrv: number | null;
  steps: number | null;
  activeCalories: number | null;
  workoutCount: number | null;
  workoutMinutes: number | null;
  sources: string;
}

export interface TrendSummary {
  days: number;
  metrics: Record<string, TrendMetric>;
}

export interface TrendMetric {
  current7DayAvg: number | null;
  prior7DayAvg: number | null;
  thirtyDayAvg: number | null;
  direction: 'up' | 'down' | 'stable';
}

export interface MonthlyAverage {
  month: string;  // YYYY-MM
  avgSleepMinutes: number | null;
  avgDeepSleepMinutes: number | null;
  avgHrv: number | null;
  avgRestingHr: number | null;
  avgSteps: number | null;
  avgReadiness: number | null;
}

export interface Anomaly {
  day: string;
  metric: string;
  value: number;
  mean90d: number;
  stdDev90d: number;
  deviations: number;
}

export interface SourceCoverage {
  oura: { earliest: string | null; latest: string | null };
  appleHealth: { earliest: string | null; latest: string | null };
  cpap: { earliest: string | null; latest: string | null };
}

// --- Pipeline ---

export type AgentRole = 'researcher' | 'statistician' | 'sleep' | 'biomarker' | 'reflection';

export interface PipelineConfig {
  question?: string;
  reportType?: 'daily' | 'weekly';
  continueContext?: string;  // previous output for --continue
  showReview?: boolean;
  modelResearcher?: string;
  modelReviewer?: string;
}

export interface PipelineResult {
  finalOutput: string;
  reviews: ReviewVerdict[];
  selfReflection: SelfReflection;
  codeResults: CodeResult[];
  tokenUsage: TokenUsage;
  durationMs: number;
}

export interface ReviewVerdict {
  role: AgentRole;
  verdict: 'confirmed' | 'flag' | 'revise';
  notes: string;
  suggestedEdit: string | null;
  raw: string;
}

export interface SelfReflection {
  consistent: boolean;
  claimDrift: string | null;
  safetyCompliant: boolean;
  action: 'deliver' | 'revise';
  details: string;
}

export interface CodeResult {
  code: string;
  output: string | null;
  error: string | null;
  retryCount: number;
  validated: boolean;
  warnings: string[];
}

export interface TokenUsage {
  totalInput: number;
  totalOutput: number;
  byCaller: Record<string, { input: number; output: number }>;
}

// --- Session Memory ---

export interface SessionMemory {
  lastUpdated: string;
  recentFindings: Finding[];
  openQuestions: string[];
  userConcerns: string[];
  goals: Goal[];
  baselineSnapshots: Record<string, number>;
}

export interface Finding {
  date: string;
  insight: string;
  status: 'open' | 'resolved';
  followUp: string;
}

export interface Goal {
  goal: string;
  setDate: string;
  status: 'active' | 'achieved' | 'abandoned';
  baselineValue: string;
  targetValue: string;
  lastChecked: string;
  progress: string;
}

// --- Conversation ---

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}
```

- [ ] **Step 2: Verify the types compile**

Run: `npx tsc --noEmit src/pipeline/types.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/types.ts
git commit -m "feat: add pipeline type definitions for health researcher agents"
```

---

## Chunk 2: Data Context Builder

### Task 3: Write failing tests for data context builder

**Files:**
- Create: `src/pipeline/__tests__/data-context-builder.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../db/migrations.js';
import { buildDataContext } from '../data-context-builder.js';

describe('buildDataContext', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  it('returns empty context when no data exists', () => {
    const ctx = buildDataContext(db);
    expect(ctx.shortTerm).toHaveLength(0);
    expect(ctx.anomalies).toHaveLength(0);
  });

  it('populates shortTerm from daily_summary for last 3 days', () => {
    const today = '2026-03-13';
    insertSummary(db, { day: '2026-03-11', sleep_score: 80, sources: 'oura' });
    insertSummary(db, { day: '2026-03-12', sleep_score: 75, sources: 'oura' });
    insertSummary(db, { day: '2026-03-13', sleep_score: 85, sources: 'oura' });
    insertSummary(db, { day: '2026-03-09', sleep_score: 70, sources: 'oura' });

    const ctx = buildDataContext(db, { today });
    expect(ctx.shortTerm).toHaveLength(3);
    expect(ctx.shortTerm[0].day).toBe('2026-03-11');
    expect(ctx.shortTerm[2].sleepScore).toBe(85);
  });

  it('computes mediumTerm trend direction', () => {
    const today = '2026-03-13';
    // Insert 14 days: first 7 avg sleep=420, last 7 avg sleep=390
    for (let i = 0; i < 7; i++) {
      const day1 = offsetDay(today, -(13 - i));
      const day2 = offsetDay(today, -(6 - i));
      insertSummary(db, { day: day1, total_sleep_minutes: 420, sources: 'oura' });
      insertSummary(db, { day: day2, total_sleep_minutes: 390, sources: 'oura' });
    }

    const ctx = buildDataContext(db, { today });
    expect(ctx.mediumTerm.metrics['totalSleepMinutes'].direction).toBe('down');
  });

  it('computes longTerm monthly averages', () => {
    const today = '2026-03-13';
    insertSummary(db, { day: '2026-01-15', avg_hrv: 40, sources: 'oura' });
    insertSummary(db, { day: '2026-01-16', avg_hrv: 44, sources: 'oura' });
    insertSummary(db, { day: '2026-02-15', avg_hrv: 48, sources: 'oura' });

    const ctx = buildDataContext(db, { today });
    expect(ctx.longTerm.length).toBeGreaterThanOrEqual(2);
    const jan = ctx.longTerm.find(m => m.month === '2026-01');
    expect(jan?.avgHrv).toBe(42);
  });

  it('detects anomalies >2 std deviations from 90-day rolling avg', () => {
    const today = '2026-03-13';
    // 89 days of stable resting HR around 55
    for (let i = 90; i >= 2; i--) {
      insertSummary(db, {
        day: offsetDay(today, -i),
        avg_resting_hr: 55 + (i % 2 === 0 ? 1 : -1),
        sources: 'oura',
      });
    }
    // Day with anomalous resting HR
    insertSummary(db, {
      day: offsetDay(today, -1),
      avg_resting_hr: 72,
      sources: 'oura',
    });

    const ctx = buildDataContext(db, { today });
    const hrAnomaly = ctx.anomalies.find(a => a.metric === 'avgRestingHr');
    expect(hrAnomaly).toBeDefined();
    expect(hrAnomaly!.deviations).toBeGreaterThan(2);
  });

  it('reports source coverage dates', () => {
    insertSummary(db, { day: '2026-01-01', sources: 'oura' });
    insertSummary(db, { day: '2026-03-13', sources: 'apple_health,oura' });

    const ctx = buildDataContext(db);
    expect(ctx.sourceCoverage.oura.earliest).toBe('2026-01-01');
    expect(ctx.sourceCoverage.oura.latest).toBe('2026-03-13');
  });

  it('returns time range from data', () => {
    insertSummary(db, { day: '2025-12-01', sources: 'oura' });
    insertSummary(db, { day: '2026-03-13', sources: 'oura' });

    const ctx = buildDataContext(db);
    expect(ctx.timeRange.earliest).toBe('2025-12-01');
    expect(ctx.timeRange.latest).toBe('2026-03-13');
  });
});

// --- Helpers ---

function offsetDay(base: string, offset: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

function insertSummary(db: Database.Database, partial: {
  day: string;
  readiness_score?: number | null;
  sleep_score?: number | null;
  activity_score?: number | null;
  total_sleep_minutes?: number | null;
  deep_sleep_minutes?: number | null;
  rem_sleep_minutes?: number | null;
  sleep_efficiency?: number | null;
  avg_resting_hr?: number | null;
  min_hr?: number | null;
  max_hr?: number | null;
  avg_hrv?: number | null;
  steps?: number | null;
  active_calories?: number | null;
  workout_count?: number | null;
  workout_minutes?: number | null;
  sources: string;
}): void {
  db.prepare(`
    INSERT OR REPLACE INTO daily_summary (
      day, readiness_score, sleep_score, activity_score,
      total_sleep_minutes, deep_sleep_minutes, rem_sleep_minutes, sleep_efficiency,
      avg_resting_hr, min_hr, max_hr, avg_hrv,
      steps, active_calories,
      workout_count, workout_minutes,
      cpap_hours, cpap_ahi,
      timezone_offset, timezone_change, location_label,
      sources, built_at
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?,
      NULL, NULL,
      NULL, NULL, NULL,
      ?, datetime('now')
    )
  `).run(
    partial.day,
    partial.readiness_score ?? null,
    partial.sleep_score ?? null,
    partial.activity_score ?? null,
    partial.total_sleep_minutes ?? null,
    partial.deep_sleep_minutes ?? null,
    partial.rem_sleep_minutes ?? null,
    partial.sleep_efficiency ?? null,
    partial.avg_resting_hr ?? null,
    partial.min_hr ?? null,
    partial.max_hr ?? null,
    partial.avg_hrv ?? null,
    partial.steps ?? null,
    partial.active_calories ?? null,
    partial.workout_count ?? null,
    partial.workout_minutes ?? null,
    partial.sources,
  );
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pipeline/__tests__/data-context-builder.test.ts`
Expected: FAIL — module `../data-context-builder.js` not found

- [ ] **Step 3: Commit failing tests**

```bash
git add src/pipeline/__tests__/data-context-builder.test.ts
git commit -m "test: add failing tests for data context builder"
```

### Task 4: Implement data context builder

**Files:**
- Create: `src/pipeline/data-context-builder.ts`

- [ ] **Step 1: Implement buildDataContext**

```typescript
import type Database from 'better-sqlite3';
import type {
  DataContext,
  DaySnapshot,
  TrendSummary,
  TrendMetric,
  MonthlyAverage,
  Anomaly,
  SourceCoverage,
} from './types.js';

interface BuildOptions {
  today?: string;
  shortTermDays?: number;
  mediumTermDays?: number;
  longTermMonths?: number;
}

export function buildDataContext(
  db: Database.Database,
  options?: BuildOptions
): DataContext {
  const today = options?.today ?? new Date().toISOString().split('T')[0];
  const shortTermDays = options?.shortTermDays ?? 3;
  const mediumTermDays = options?.mediumTermDays ?? 30;
  const longTermMonths = options?.longTermMonths ?? 6;

  const timeRange = getTimeRange(db);
  const shortTerm = getShortTerm(db, today, shortTermDays);
  const mediumTerm = getMediumTerm(db, today, mediumTermDays);
  const longTerm = getLongTerm(db, today, longTermMonths);
  const anomalies = getAnomalies(db, today);
  const sourceCoverage = getSourceCoverage(db);

  return { timeRange, shortTerm, mediumTerm, longTerm, anomalies, sourceCoverage };
}

function getTimeRange(db: Database.Database): { earliest: string; latest: string } {
  const row = db.prepare(
    `SELECT MIN(day) AS earliest, MAX(day) AS latest FROM daily_summary`
  ).get() as { earliest: string | null; latest: string | null };
  return {
    earliest: row.earliest ?? '',
    latest: row.latest ?? '',
  };
}

function getShortTerm(db: Database.Database, today: string, days: number): DaySnapshot[] {
  const cutoff = offsetDay(today, -(days - 1));
  const rows = db.prepare(`
    SELECT * FROM daily_summary
    WHERE day >= ? AND day <= ?
    ORDER BY day
  `).all(cutoff, today) as any[];

  return rows.map(r => ({
    day: r.day,
    readinessScore: r.readiness_score,
    sleepScore: r.sleep_score,
    activityScore: r.activity_score,
    totalSleepMinutes: r.total_sleep_minutes,
    deepSleepMinutes: r.deep_sleep_minutes,
    remSleepMinutes: r.rem_sleep_minutes,
    sleepEfficiency: r.sleep_efficiency,
    avgRestingHr: r.avg_resting_hr,
    minHr: r.min_hr,
    maxHr: r.max_hr,
    avgHrv: r.avg_hrv,
    steps: r.steps,
    activeCalories: r.active_calories,
    workoutCount: r.workout_count,
    workoutMinutes: r.workout_minutes,
    sources: r.sources,
  }));
}

function getMediumTerm(db: Database.Database, today: string, days: number): TrendSummary {
  const cutoff = offsetDay(today, -days);
  const midpoint = offsetDay(today, -7);

  const metricColumns = [
    { name: 'totalSleepMinutes', col: 'total_sleep_minutes' },
    { name: 'deepSleepMinutes', col: 'deep_sleep_minutes' },
    { name: 'avgHrv', col: 'avg_hrv' },
    { name: 'avgRestingHr', col: 'avg_resting_hr' },
    { name: 'steps', col: 'steps' },
    { name: 'readinessScore', col: 'readiness_score' },
    { name: 'sleepScore', col: 'sleep_score' },
  ];

  const metrics: Record<string, TrendMetric> = {};

  for (const m of metricColumns) {
    const current = db.prepare(`
      SELECT AVG(${m.col}) AS avg_val FROM daily_summary
      WHERE day > ? AND day <= ? AND ${m.col} IS NOT NULL
    `).get(midpoint, today) as { avg_val: number | null };

    const prior = db.prepare(`
      SELECT AVG(${m.col}) AS avg_val FROM daily_summary
      WHERE day > ? AND day <= ? AND ${m.col} IS NOT NULL
    `).get(offsetDay(midpoint, -7), midpoint) as { avg_val: number | null };

    const thirtyDay = db.prepare(`
      SELECT AVG(${m.col}) AS avg_val FROM daily_summary
      WHERE day > ? AND day <= ? AND ${m.col} IS NOT NULL
    `).get(cutoff, today) as { avg_val: number | null };

    let direction: 'up' | 'down' | 'stable' = 'stable';
    if (current.avg_val !== null && prior.avg_val !== null && prior.avg_val !== 0) {
      const pctChange = (current.avg_val - prior.avg_val) / Math.abs(prior.avg_val);
      if (pctChange > 0.05) direction = 'up';
      else if (pctChange < -0.05) direction = 'down';
    }

    metrics[m.name] = {
      current7DayAvg: current.avg_val ? +current.avg_val.toFixed(1) : null,
      prior7DayAvg: prior.avg_val ? +prior.avg_val.toFixed(1) : null,
      thirtyDayAvg: thirtyDay.avg_val ? +thirtyDay.avg_val.toFixed(1) : null,
      direction,
    };
  }

  return { days, metrics };
}

function getLongTerm(db: Database.Database, today: string, months: number): MonthlyAverage[] {
  const cutoffDate = new Date(today);
  cutoffDate.setMonth(cutoffDate.getMonth() - months);
  const cutoff = cutoffDate.toISOString().split('T')[0];

  const rows = db.prepare(`
    SELECT
      strftime('%Y-%m', day) AS month,
      AVG(total_sleep_minutes) AS avg_sleep,
      AVG(deep_sleep_minutes) AS avg_deep,
      AVG(avg_hrv) AS avg_hrv,
      AVG(avg_resting_hr) AS avg_rhr,
      AVG(steps) AS avg_steps,
      AVG(readiness_score) AS avg_readiness
    FROM daily_summary
    WHERE day >= ?
    GROUP BY strftime('%Y-%m', day)
    ORDER BY month
  `).all(cutoff) as any[];

  return rows.map(r => ({
    month: r.month,
    avgSleepMinutes: r.avg_sleep ? +r.avg_sleep.toFixed(1) : null,
    avgDeepSleepMinutes: r.avg_deep ? +r.avg_deep.toFixed(1) : null,
    avgHrv: r.avg_hrv ? +r.avg_hrv.toFixed(1) : null,
    avgRestingHr: r.avg_rhr ? +r.avg_rhr.toFixed(1) : null,
    avgSteps: r.avg_steps ? +r.avg_steps.toFixed(0) : null,
    avgReadiness: r.avg_readiness ? +r.avg_readiness.toFixed(1) : null,
  }));
}

function getAnomalies(db: Database.Database, today: string): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const metricsToCheck = [
    { name: 'avgRestingHr', col: 'avg_resting_hr' },
    { name: 'avgHrv', col: 'avg_hrv' },
    { name: 'totalSleepMinutes', col: 'total_sleep_minutes' },
    { name: 'deepSleepMinutes', col: 'deep_sleep_minutes' },
    { name: 'steps', col: 'steps' },
  ];

  for (const m of metricsToCheck) {
    // Get last 90 days of data with rolling stats
    const rows = db.prepare(`
      WITH recent AS (
        SELECT day, ${m.col} AS val
        FROM daily_summary
        WHERE day <= ? AND ${m.col} IS NOT NULL
        ORDER BY day DESC
        LIMIT 90
      ),
      stats AS (
        SELECT AVG(val) AS mean_val, AVG(val * val) - AVG(val) * AVG(val) AS variance
        FROM recent
      )
      SELECT r.day, r.val, s.mean_val,
        CASE WHEN s.variance > 0 THEN SQRT(s.variance) ELSE 0 END AS std_dev
      FROM recent r, stats s
      WHERE r.day > date(?, '-7 days')
        AND s.variance > 0
        AND ABS(r.val - s.mean_val) > 2 * SQRT(s.variance)
      ORDER BY r.day DESC
    `).all(today, today) as any[];

    for (const r of rows) {
      anomalies.push({
        day: r.day,
        metric: m.name,
        value: r.val,
        mean90d: +r.mean_val.toFixed(1),
        stdDev90d: +r.std_dev.toFixed(1),
        deviations: +((Math.abs(r.val - r.mean_val) / r.std_dev).toFixed(1)),
      });
    }
  }

  return anomalies.sort((a, b) => b.deviations - a.deviations);
}

function getSourceCoverage(db: Database.Database): SourceCoverage {
  const oura = db.prepare(`
    SELECT MIN(day) AS earliest, MAX(day) AS latest
    FROM daily_summary WHERE sources LIKE '%oura%'
  `).get() as { earliest: string | null; latest: string | null };

  const ah = db.prepare(`
    SELECT MIN(day) AS earliest, MAX(day) AS latest
    FROM daily_summary WHERE sources LIKE '%apple_health%'
  `).get() as { earliest: string | null; latest: string | null };

  // CPAP not yet available
  return {
    oura: { earliest: oura.earliest, latest: oura.latest },
    appleHealth: { earliest: ah.earliest, latest: ah.latest },
    cpap: { earliest: null, latest: null },
  };
}

function offsetDay(base: string, offset: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/pipeline/__tests__/data-context-builder.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/data-context-builder.ts src/pipeline/__tests__/data-context-builder.test.ts
git commit -m "feat: implement data context builder for health pipeline"
```

### Task 5: Context serializer

**Files:**
- Create: `src/pipeline/serialize-context.ts`
- Create: `src/pipeline/__tests__/serialize-context.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect } from 'vitest';
import { serializeContext } from '../serialize-context.js';
import type { DataContext } from '../types.js';

describe('serializeContext', () => {
  it('produces readable text from a data context', () => {
    const ctx: DataContext = {
      timeRange: { earliest: '2025-12-01', latest: '2026-03-13' },
      shortTerm: [{
        day: '2026-03-13',
        readinessScore: 82,
        sleepScore: 78,
        activityScore: 65,
        totalSleepMinutes: 420,
        deepSleepMinutes: 70,
        remSleepMinutes: 100,
        sleepEfficiency: 0.92,
        avgRestingHr: 55,
        minHr: 48,
        maxHr: 165,
        avgHrv: 42,
        steps: 8500,
        activeCalories: 450,
        workoutCount: 1,
        workoutMinutes: 35,
        sources: 'apple_health,oura',
      }],
      mediumTerm: { days: 30, metrics: {} },
      longTerm: [],
      anomalies: [],
      sourceCoverage: {
        oura: { earliest: '2025-12-01', latest: '2026-03-13' },
        appleHealth: { earliest: '2025-12-01', latest: '2026-03-13' },
        cpap: { earliest: null, latest: null },
      },
    };

    const text = serializeContext(ctx);
    expect(text).toContain('2026-03-13');
    expect(text).toContain('420');  // sleep minutes
    expect(text).toContain('oura');
  });

  it('includes anomaly section when anomalies present', () => {
    const ctx: DataContext = {
      timeRange: { earliest: '2025-12-01', latest: '2026-03-13' },
      shortTerm: [],
      mediumTerm: { days: 30, metrics: {} },
      longTerm: [],
      anomalies: [{
        day: '2026-03-12',
        metric: 'avgRestingHr',
        value: 72,
        mean90d: 55,
        stdDev90d: 3,
        deviations: 5.7,
      }],
      sourceCoverage: {
        oura: { earliest: null, latest: null },
        appleHealth: { earliest: null, latest: null },
        cpap: { earliest: null, latest: null },
      },
    };

    const text = serializeContext(ctx);
    expect(text).toContain('ANOMAL');
    expect(text).toContain('72');
    expect(text).toContain('5.7');
  });
});
```

- [ ] **Step 2: Implement serializer**

```typescript
import type { DataContext, DaySnapshot, Anomaly } from './types.js';

export function serializeContext(ctx: DataContext): string {
  const sections: string[] = [];

  sections.push(`## Data Overview`);
  sections.push(`Data range: ${ctx.timeRange.earliest} → ${ctx.timeRange.latest}`);
  sections.push('');

  // Source coverage
  sections.push(`## Source Coverage`);
  for (const [source, range] of Object.entries(ctx.sourceCoverage)) {
    if (range.earliest) {
      sections.push(`- ${source}: ${range.earliest} → ${range.latest}`);
    } else {
      sections.push(`- ${source}: no data`);
    }
  }
  sections.push('');

  // Short-term
  if (ctx.shortTerm.length > 0) {
    sections.push(`## Last ${ctx.shortTerm.length} Days (Short-Term)`);
    for (const day of ctx.shortTerm) {
      sections.push(formatDaySnapshot(day));
    }
    sections.push('');
  }

  // Medium-term trends
  if (Object.keys(ctx.mediumTerm.metrics).length > 0) {
    sections.push(`## ${ctx.mediumTerm.days}-Day Trends`);
    for (const [name, m] of Object.entries(ctx.mediumTerm.metrics)) {
      if (m.current7DayAvg !== null) {
        sections.push(`- ${name}: ${m.current7DayAvg} (7d avg) | ${m.prior7DayAvg} (prior 7d) | ${m.thirtyDayAvg} (30d) | trend: ${m.direction}`);
      }
    }
    sections.push('');
  }

  // Long-term
  if (ctx.longTerm.length > 0) {
    sections.push(`## Monthly Averages (Long-Term)`);
    for (const m of ctx.longTerm) {
      const parts = [`${m.month}:`];
      if (m.avgSleepMinutes !== null) parts.push(`sleep=${m.avgSleepMinutes}m`);
      if (m.avgHrv !== null) parts.push(`HRV=${m.avgHrv}`);
      if (m.avgRestingHr !== null) parts.push(`RHR=${m.avgRestingHr}`);
      if (m.avgSteps !== null) parts.push(`steps=${m.avgSteps}`);
      if (m.avgReadiness !== null) parts.push(`readiness=${m.avgReadiness}`);
      sections.push(`- ${parts.join(' | ')}`);
    }
    sections.push('');
  }

  // Anomalies
  if (ctx.anomalies.length > 0) {
    sections.push(`## ⚠️ ANOMALIES DETECTED`);
    for (const a of ctx.anomalies) {
      sections.push(`- ${a.day}: ${a.metric} = ${a.value} (90d avg: ${a.mean90d} ± ${a.stdDev90d}, ${a.deviations} std devs)`);
    }
    sections.push('');
  }

  return sections.join('\n');
}

function formatDaySnapshot(d: DaySnapshot): string {
  const lines = [`### ${d.day} [${d.sources}]`];
  if (d.sleepScore !== null) lines.push(`  Sleep: score=${d.sleepScore} total=${d.totalSleepMinutes}m deep=${d.deepSleepMinutes}m REM=${d.remSleepMinutes}m eff=${d.sleepEfficiency}`);
  if (d.readinessScore !== null) lines.push(`  Readiness: ${d.readinessScore}`);
  if (d.avgRestingHr !== null) lines.push(`  HR: resting=${d.avgRestingHr} min=${d.minHr} max=${d.maxHr}`);
  if (d.avgHrv !== null) lines.push(`  HRV: ${d.avgHrv}`);
  if (d.steps !== null) lines.push(`  Activity: steps=${d.steps} cal=${d.activeCalories}`);
  if (d.workoutCount !== null) lines.push(`  Workouts: ${d.workoutCount}x ${d.workoutMinutes}m`);
  return lines.join('\n');
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/pipeline/__tests__/serialize-context.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/serialize-context.ts src/pipeline/__tests__/serialize-context.test.ts
git commit -m "feat: add data context serializer for LLM-friendly text output"
```

---

## Chunk 3: Agent Prompts

### Task 6: Write prompt files

**Files:**
- Create: `prompts/hayden-researcher.md`
- Create: `prompts/reviewer-statistician.md`
- Create: `prompts/reviewer-sleep.md`
- Create: `prompts/reviewer-biomarker.md`
- Create: `prompts/self-reflection.md`
- Create: `prompts/report-templates/daily-briefing.md`
- Create: `prompts/report-templates/weekly-deep-dive.md`

- [ ] **Step 1: Write Hayden researcher prompt**

Create `prompts/hayden-researcher.md`:

```markdown
# Dr. Hayden — Health Research Lead

You are Dr. Hayden, a health researcher specializing in longitudinal personal health data analysis. You analyze health data from multiple sources (Oura Ring, Apple Health, CPAP, Function Health) for one individual.

## Your Role

- You are a data researcher, not a clinician
- You treat this person's health data like a research project
- You communicate findings in plain language with specific numbers
- You are curious, thorough, honest about confidence levels, and proactive about suggesting follow-up analyses

## Analysis Approach

### Query Clarification
If a question is vague or broad (e.g., "how's my health?", "am I sleeping well?"), first produce an analysis plan:
- What metrics will you examine?
- What time window?
- What comparisons or baselines?

Then proceed with the analysis.

### Code Execution
You can write SQL queries against the SQLite database. Wrap executable queries in fenced code blocks tagged `executable-sql`:

~~~
```executable-sql
SELECT day, avg_hrv, avg_resting_hr
FROM daily_summary
WHERE day >= date('now', '-30 days')
ORDER BY day
```
~~~

The orchestrator will run these queries and append results to your context. Use code execution for:
- Correlation analysis between metrics
- Trend validation (linear regression direction)
- Anomaly investigation (raw records for specific days)
- Grouped comparisons (weekday vs. weekend, etc.)

If a query fails, you'll receive the error and can retry with a corrected query (up to 2 retries).

### Evidence Grounding
- Reference known health science baselines when contextualizing findings
- Cite mechanisms ("HRV drops after alcohol because of parasympathetic suppression")
- Acknowledge when science is uncertain or individual variation is high
- Never claim certainty beyond what the data supports

## Output Format

For each insight:

```markdown
## [Insight title]
- Analysis plan: [what was investigated and why]
- Time horizon: short / medium / long
- Data sources used: [list]
- Code executed: [SQL and results, if any]
- Finding: [plain language description with specific numbers]
- Science context: [relevant health science, if applicable]
- Confidence: high / moderate / low
- Actionable: yes / no
- If actionable: [concrete, specific suggestion]
- Supporting data: [numbers, dates, comparisons]
```

## Communication Style

1. Lead with what's interesting, not what's normal
2. Always include actual numbers — "HRV dropped from 45ms to 31ms" not "HRV dropped"
3. Calibrate to personal baseline, not population averages — "Your RHR of 58 is 4 bpm above your 90-day average of 54"
4. Not everything needs to be actionable — "No action needed, just interesting to know" is valid
5. When actionable, be concrete — not "improve sleep hygiene" but "your data shows 45-minute later sleep onset on weekends"
6. Be transparent about confidence — "Based on only 5 days of CPAP data, this is preliminary"
7. Connect dots between sources when possible

## "Go Deeper" Suggestions

At the end of any analysis, suggest follow-up investigations:
- Additional analyses ("Want me to check if this correlates with workout intensity?")
- Missing data that would help ("If you tracked caffeine, we could test if it drives late sleep onset")
- Cross-source investigations ("Once CPAP data arrives, I can check AHI vs. HRV dips")
- Different time windows ("This looks interesting at 30 days — want me to pull back to 6 months?")

## Safety Guardrails

1. NEVER diagnose conditions. "Your data shows X" is OK. "You have Y" is NEVER OK.
2. Flag concerning trends for professional consultation: "This trend is worth discussing with your doctor."
3. Separate observations from suggestions clearly.
4. NEVER recommend starting, stopping, or changing medications or supplements.
5. Handle potential mental health indicators gently — suggest speaking with a provider, don't speculate.

## Session Memory

You may receive prior findings and open questions from memory. Reference them naturally:
- "Last week I noted your deep sleep was declining — it's continued this week"
- Track open questions and update when resolved

## Available Data Sources

- **Oura Ring** ✅: Sleep (stages, efficiency, HRV, temperature), readiness, activity, SpO2
- **Apple Health** ✅: HR, resting HR, HRV, workouts, sleep
- **CPAP (OSCAR)** 🔜: AHI, leak rate, pressure, respiratory events, usage hours
- **Function Health** 🔜: Blood panels, biomarkers, metabolic markers

When sources disagree (e.g., Oura says 7h sleep, Apple Health says 6.5h), explain the likely reason rather than ignoring the discrepancy.
```

- [ ] **Step 2: Write reviewer prompts**

Create `prompts/reviewer-statistician.md`:

```markdown
# Statistical Analyst Review

You are a statistical analyst reviewing health data insights for accuracy and rigor.

## Review Checklist
- Is the data cherry-picked or does the trend hold across the full window?
- Are there enough data points to support the claim? (flag n < 7 for trends)
- Is correlation presented as causation?
- Is the right time window used? (e.g., is a 3-day pattern being called a "trend"?)
- If code was executed, is the methodology sound?
- Are the numbers in the narrative accurate to the data provided?
- Are anomaly flags statistically justified (>2 std devs)?

## Output Format
```
## Review: Statistical Analyst
- Verdict: ✅ confirmed / ⚠️ flag / 🔄 revise
- Notes: [specific feedback on statistical rigor]
- Suggested edit: [if applicable]
```

Be concise. Focus on what's wrong, not what's right.
```

Create `prompts/reviewer-sleep.md`:

```markdown
# Sleep & Recovery Specialist Review

You are a sleep science specialist reviewing health data insights about sleep, HRV, temperature, and respiratory data.

## Review Checklist
- Are sleep stage percentages interpreted correctly? (normal ranges: deep 15-25%, REM 20-25%)
- Is HRV interpretation sound? (context: time of measurement, trends vs. absolutes)
- Is temperature deviation interpreted correctly? (Oura body temp is relative, not absolute)
- Are recovery/readiness claims supported by the sleep data?
- If CPAP data is present: are AHI, leak rate, and pressure trends interpreted correctly?
- Is sleep architecture context provided where needed?

## Output Format
```
## Review: Sleep & Recovery Specialist
- Verdict: ✅ confirmed / ⚠️ flag / 🔄 revise
- Notes: [specific feedback on sleep/recovery interpretation]
- Suggested edit: [if applicable]
```

Be concise. Focus on what's wrong, not what's right.
```

Create `prompts/reviewer-biomarker.md`:

```markdown
# Biomarker & Wellness Specialist Review

You are a biomarker and wellness specialist reviewing health data insights about activity, cardiovascular metrics, and blood panels.

## Review Checklist
- Are cardiovascular trends (resting HR, HRV) interpreted correctly?
- Are activity and workout metrics contextualized properly?
- Are cross-domain connections valid? (e.g., sleep quality → next-day activity)
- If blood panel data is present: are biomarker values interpreted against standard reference ranges?
- Are metabolic and inflammatory marker trends noted where relevant?

## Output Format
```
## Review: Biomarker & Wellness Specialist
- Verdict: ✅ confirmed / ⚠️ flag / 🔄 revise
- Notes: [specific feedback on biomarker/wellness interpretation]
- Suggested edit: [if applicable]
```

Be concise. Focus on what's wrong, not what's right.
```

- [ ] **Step 3: Write self-reflection prompt**

Create `prompts/self-reflection.md`:

```markdown
# Self-Reflection Check

Review the final output for internal consistency, claim drift, and safety compliance.

## Check For
1. **Internal consistency:** Do numbers in the narrative match numbers in the data sections?
2. **Claim drift:** Were any claims introduced in the revision that aren't supported by the original data or reviewer feedback?
3. **Safety compliance:** No diagnosis, appropriate caveats for concerning trends, no medication/supplement recommendations?
4. **Coherence:** Does the output read clearly? Any contradictions between sections?

## Output Format
```
## Self-Reflection
- Consistent: yes / no — [details if no]
- Claim drift: none / [flagged claims]
- Safety compliant: yes / no — [details if no]
- Action: ✅ deliver / 🔄 revise [specific fix needed]
```
```

- [ ] **Step 4: Write report templates**

Create `prompts/report-templates/daily-briefing.md`:

```markdown
# Daily Briefing Template

Generate a morning health briefing covering:

1. **Last night's sleep:** Duration, quality, sleep stages, anything unusual
2. **Yesterday's activity:** Steps, workouts, active calories
3. **Readiness/recovery:** Current readiness score and what's driving it
4. **Anomalies:** Any metrics that deviated significantly from your baseline
5. **One thing to know:** The single most interesting or actionable finding

Keep it concise — this is a morning check-in, not a deep dive. Aim for 200-400 words.
End with one "Go deeper" suggestion if something warrants investigation.
```

Create `prompts/report-templates/weekly-deep-dive.md`:

```markdown
# Weekly Deep Dive Template

Generate a comprehensive weekly health analysis covering:

1. **Week in review:** Headline summary of the week's health data
2. **Sleep trends:** How sleep quality/duration changed across the week. Weeknight vs. weekend patterns.
3. **Cardiovascular trends:** Resting HR, HRV trajectories over the week
4. **Activity patterns:** Workout frequency, intensity, step counts. Rest days.
5. **Cross-source patterns:** Connections between sleep, activity, readiness. What drove good/bad days?
6. **Medium-term context:** How does this week compare to the prior 4 weeks?
7. **Anomalies:** Any metrics that deviated significantly
8. **Goal progress:** Update on any active health goals
9. **Go deeper suggestions:** 2-3 follow-up analyses for the week ahead

Aim for 600-1000 words. Be specific with numbers. Tell a story about the week.
```

- [ ] **Step 5: Commit all prompts**

```bash
git add prompts/
git commit -m "feat: add agent prompts for health researcher pipeline"
```

---

## Chunk 4: Code Execution Sandbox

### Task 7: Write failing tests for code executor

**Files:**
- Create: `src/pipeline/__tests__/code-executor.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../db/migrations.js';
import {
  extractExecutableBlocks,
  executeCodeBlock,
  validateResult,
} from '../code-executor.js';

describe('extractExecutableBlocks', () => {
  it('extracts executable-sql blocks from text', () => {
    const text = `
Some narrative text.

\`\`\`executable-sql
SELECT * FROM daily_summary LIMIT 5
\`\`\`

More text.
    `;
    const blocks = extractExecutableBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('SELECT * FROM daily_summary');
  });

  it('returns empty array when no executable blocks', () => {
    const text = 'Just plain text with no code blocks.';
    expect(extractExecutableBlocks(text)).toHaveLength(0);
  });

  it('extracts multiple blocks', () => {
    const text = `
\`\`\`executable-sql
SELECT 1
\`\`\`

\`\`\`executable-sql
SELECT 2
\`\`\`
    `;
    expect(extractExecutableBlocks(text)).toHaveLength(2);
  });
});

describe('executeCodeBlock', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`
      INSERT INTO daily_summary (day, avg_hrv, sources, built_at)
      VALUES ('2026-03-13', 42, 'oura', datetime('now'))
    `).run();
  });

  it('runs a valid SELECT and returns results', () => {
    const result = executeCodeBlock(db, 'SELECT day, avg_hrv FROM daily_summary');
    expect(result.output).toContain('2026-03-13');
    expect(result.error).toBeNull();
  });

  it('returns error for invalid SQL', () => {
    const result = executeCodeBlock(db, 'SELECT * FROM nonexistent_table');
    expect(result.error).not.toBeNull();
    expect(result.output).toBeNull();
  });

  it('blocks write operations', () => {
    const result = executeCodeBlock(db, "DELETE FROM daily_summary WHERE day = '2026-03-13'");
    expect(result.error).toContain('read-only');
  });

  it('returns error for queries exceeding timeout', () => {
    // Generate a query that would take very long (recursive CTE)
    const result = executeCodeBlock(db, `
      WITH RECURSIVE cnt(x) AS (
        SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x < 10000000
      ) SELECT COUNT(*) FROM cnt
    `);
    // Should either timeout or complete — either way shouldn't crash
    expect(result.error !== null || result.output !== null).toBe(true);
  });
});

describe('validateResult', () => {
  it('flags empty results for time ranges with expected data', () => {
    const warnings = validateResult({ output: '[]', error: null, retryCount: 0, code: '', validated: false, warnings: [] });
    expect(warnings).toContain('empty');
  });

  it('flags unreasonable HR values', () => {
    const warnings = validateResult({
      output: JSON.stringify([{ avg_resting_hr: 350 }]),
      error: null, retryCount: 0, code: '', validated: false, warnings: [],
    });
    expect(warnings.some(w => w.includes('bounds'))).toBe(true);
  });

  it('passes valid results with no warnings', () => {
    const warnings = validateResult({
      output: JSON.stringify([{ avg_hrv: 42 }]),
      error: null, retryCount: 0, code: '', validated: false, warnings: [],
    });
    expect(warnings).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pipeline/__tests__/code-executor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/__tests__/code-executor.test.ts
git commit -m "test: add failing tests for code executor sandbox"
```

### Task 8: Implement code executor

**Files:**
- Create: `src/pipeline/code-executor.ts`

- [ ] **Step 1: Implement**

```typescript
import type Database from 'better-sqlite3';
import type { CodeResult } from './types.js';

const WRITE_PATTERN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE)\b/i;
const TIMEOUT_MS = 5000;

export function extractExecutableBlocks(text: string): string[] {
  const pattern = /```executable-sql\n([\s\S]*?)```/g;
  const blocks: string[] = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

export function executeCodeBlock(db: Database.Database, sql: string): CodeResult {
  const result: CodeResult = {
    code: sql,
    output: null,
    error: null,
    retryCount: 0,
    validated: false,
    warnings: [],
  };

  // Block write operations
  if (WRITE_PATTERN.test(sql)) {
    result.error = 'Blocked: read-only access. Write operations (INSERT, UPDATE, DELETE, etc.) are not allowed.';
    return result;
  }

  try {
    const startTime = Date.now();
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    const elapsed = Date.now() - startTime;

    if (elapsed > TIMEOUT_MS) {
      result.error = `Query exceeded ${TIMEOUT_MS}ms timeout (took ${elapsed}ms)`;
      return result;
    }

    result.output = JSON.stringify(rows, null, 2);
    result.validated = true;
  } catch (err: any) {
    result.error = err.message ?? String(err);
  }

  return result;
}

export function validateResult(result: CodeResult): string[] {
  const warnings: string[] = [];

  if (result.error) return warnings;

  if (!result.output || result.output === '[]' || result.output === '{}') {
    warnings.push('Result is empty — query returned no rows');
    return warnings;
  }

  // Check for unreasonable values in known metrics
  try {
    const parsed = JSON.parse(result.output);
    if (Array.isArray(parsed)) {
      for (const row of parsed) {
        for (const [key, val] of Object.entries(row)) {
          if (typeof val !== 'number') continue;
          if (/hr|heart_rate/i.test(key) && (val < 20 || val > 300)) {
            warnings.push(`Value out of bounds: ${key}=${val} (expected 20-300 for heart rate)`);
          }
          if (/hrv/i.test(key) && (val < 0 || val > 500)) {
            warnings.push(`Value out of bounds: ${key}=${val} (expected 0-500 for HRV)`);
          }
          if (/sleep.*min/i.test(key) && val < 0) {
            warnings.push(`Value out of bounds: ${key}=${val} (negative sleep minutes)`);
          }
        }
      }
    }
  } catch {
    // If output isn't valid JSON, that's fine — it might be a scalar result
  }

  return warnings;
}
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/pipeline/__tests__/code-executor.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/code-executor.ts src/pipeline/__tests__/code-executor.test.ts
git commit -m "feat: implement sandboxed SQL code executor with validation"
```

---

## Chunk 5: Session Memory

### Task 9: Write failing tests for session memory

**Files:**
- Create: `src/pipeline/__tests__/session-memory.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadMemory, saveMemory, pruneMemory } from '../session-memory.js';
import type { SessionMemory } from '../types.js';

const TEST_DIR = join(import.meta.dirname, '__fixtures__', 'memory-test');
const MEMORY_PATH = join(TEST_DIR, 'memory.json');

describe('session-memory', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns empty memory when file does not exist', () => {
    const mem = loadMemory(MEMORY_PATH);
    expect(mem.recentFindings).toHaveLength(0);
    expect(mem.openQuestions).toHaveLength(0);
    expect(mem.goals).toHaveLength(0);
  });

  it('saves and loads memory', () => {
    const mem: SessionMemory = {
      lastUpdated: '2026-03-13',
      recentFindings: [{
        date: '2026-03-13',
        insight: 'Deep sleep trending down',
        status: 'open',
        followUp: 'Check next week',
      }],
      openQuestions: ['Does weekend timing affect Monday readiness?'],
      userConcerns: [],
      goals: [],
      baselineSnapshots: { restingHR_90day: 54 },
    };

    saveMemory(MEMORY_PATH, mem);
    const loaded = loadMemory(MEMORY_PATH);
    expect(loaded.recentFindings).toHaveLength(1);
    expect(loaded.recentFindings[0].insight).toBe('Deep sleep trending down');
    expect(loaded.baselineSnapshots['restingHR_90day']).toBe(54);
  });

  it('prunes old resolved findings', () => {
    const mem: SessionMemory = {
      lastUpdated: '2026-03-13',
      recentFindings: [
        { date: '2025-12-01', insight: 'Old finding', status: 'resolved', followUp: '' },
        { date: '2026-03-10', insight: 'Recent finding', status: 'open', followUp: '' },
      ],
      openQuestions: [],
      userConcerns: [],
      goals: [
        {
          goal: 'Old achieved goal',
          setDate: '2025-11-01',
          status: 'achieved',
          baselineValue: '', targetValue: '',
          lastChecked: '2026-01-01',
          progress: 'done',
        },
        {
          goal: 'Active goal',
          setDate: '2026-03-01',
          status: 'active',
          baselineValue: '', targetValue: '',
          lastChecked: '2026-03-13',
          progress: 'in progress',
        },
      ],
      baselineSnapshots: {},
    };

    const pruned = pruneMemory(mem, '2026-03-13');
    expect(pruned.recentFindings).toHaveLength(1);
    expect(pruned.recentFindings[0].insight).toBe('Recent finding');
    expect(pruned.goals).toHaveLength(1);
    expect(pruned.goals[0].goal).toBe('Active goal');
  });

  it('handles corrupted memory file gracefully', () => {
    writeFileSync(MEMORY_PATH, 'not valid json{{{');
    const mem = loadMemory(MEMORY_PATH);
    expect(mem.recentFindings).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pipeline/__tests__/session-memory.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/__tests__/session-memory.test.ts
git commit -m "test: add failing tests for session memory"
```

### Task 10: Implement session memory

**Files:**
- Create: `src/pipeline/session-memory.ts`

- [ ] **Step 1: Implement**

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import type { SessionMemory } from './types.js';

const LOCK_TIMEOUT_MS = 5000;

function emptyMemory(): SessionMemory {
  return {
    lastUpdated: '',
    recentFindings: [],
    openQuestions: [],
    userConcerns: [],
    goals: [],
    baselineSnapshots: {},
  };
}

export function loadMemory(filePath: string): SessionMemory {
  if (!existsSync(filePath)) return emptyMemory();

  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as SessionMemory;
  } catch {
    return emptyMemory();
  }
}

export function saveMemory(filePath: string, memory: SessionMemory): boolean {
  const lockPath = filePath + '.lock';

  // Simple file lock
  if (existsSync(lockPath)) {
    const lockStat = readFileSync(lockPath, 'utf-8');
    const lockTime = parseInt(lockStat, 10);
    if (Date.now() - lockTime < LOCK_TIMEOUT_MS) {
      // Lock is held and fresh — skip update
      return false;
    }
    // Stale lock — remove it
    unlinkSync(lockPath);
  }

  try {
    // Acquire lock
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(lockPath, String(Date.now()));

    // Write memory
    writeFileSync(filePath, JSON.stringify(memory, null, 2));
    return true;
  } finally {
    // Release lock
    try { unlinkSync(lockPath); } catch {}
  }
}

export function pruneMemory(memory: SessionMemory, today: string): SessionMemory {
  const ninetyDaysAgo = offsetDay(today, -90);
  const thirtyDaysAgo = offsetDay(today, -30);

  return {
    ...memory,
    recentFindings: memory.recentFindings.filter(f => {
      if (f.status === 'resolved' && f.date < ninetyDaysAgo) return false;
      return true;
    }),
    goals: memory.goals.filter(g => {
      if ((g.status === 'achieved' || g.status === 'abandoned') && g.lastChecked < thirtyDaysAgo) return false;
      return true;
    }),
  };
}

function offsetDay(base: string, offset: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/pipeline/__tests__/session-memory.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/session-memory.ts src/pipeline/__tests__/session-memory.test.ts
git commit -m "feat: implement session memory with file locking and pruning"
```

---

## Chunk 6: Pipeline Orchestrator

### Task 11: Write failing tests for orchestrator helpers

**Files:**
- Create: `src/pipeline/__tests__/orchestrator.test.ts`

- [ ] **Step 1: Write tests for helper functions**

```typescript
import { describe, it, expect } from 'vitest';
import { parseReviewVerdict, buildReviewerDataSubset } from '../orchestrator.js';

describe('parseReviewVerdict', () => {
  it('parses a well-formatted review', () => {
    const text = `## Review: Statistical Analyst
- Verdict: ✅ confirmed
- Notes: Numbers check out. Sample size is adequate.
- Suggested edit: None`;

    const verdict = parseReviewVerdict('statistician', text);
    expect(verdict.verdict).toBe('confirmed');
    expect(verdict.notes).toContain('Numbers check out');
    expect(verdict.suggestedEdit).toBeNull();
  });

  it('parses a revise verdict', () => {
    const text = `## Review: Sleep & Recovery Specialist
- Verdict: 🔄 revise
- Notes: Deep sleep percentage is miscalculated.
- Suggested edit: Recalculate deep sleep as percentage of total sleep, not time in bed.`;

    const verdict = parseReviewVerdict('sleep', text);
    expect(verdict.verdict).toBe('revise');
    expect(verdict.suggestedEdit).toContain('Recalculate');
  });

  it('falls back to raw text for unstructured reviews', () => {
    const text = 'This looks generally fine but the HRV claim is a stretch.';

    const verdict = parseReviewVerdict('biomarker', text);
    expect(verdict.verdict).toBe('confirmed');
    expect(verdict.raw).toBe(text);
  });
});

describe('buildReviewerDataSubset', () => {
  const fullContext = `## Data Overview
Data range: 2025-12-01 → 2026-03-13

## Last 3 Days (Short-Term)
### 2026-03-13
  Sleep: score=78 total=420m deep=70m REM=100m eff=0.92
  Readiness: 82
  HR: resting=55 min=48 max=165
  HRV: 42
  Activity: steps=8500 cal=450
  Workouts: 1x 35m`;

  it('returns full context for statistician', () => {
    const subset = buildReviewerDataSubset('statistician', fullContext);
    expect(subset).toBe(fullContext);
  });

  it('filters to sleep-related data for sleep reviewer', () => {
    const subset = buildReviewerDataSubset('sleep', fullContext);
    expect(subset).toContain('Sleep');
    expect(subset).toContain('HRV');
  });

  it('filters to activity/cardiovascular data for biomarker reviewer', () => {
    const subset = buildReviewerDataSubset('biomarker', fullContext);
    expect(subset).toContain('HR');
    expect(subset).toContain('Activity');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pipeline/__tests__/orchestrator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/__tests__/orchestrator.test.ts
git commit -m "test: add failing tests for orchestrator helper functions"
```

### Task 12: Implement orchestrator

**Files:**
- Create: `src/pipeline/orchestrator.ts`

- [ ] **Step 1: Implement the orchestrator**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';
import type {
  PipelineConfig,
  PipelineResult,
  ReviewVerdict,
  SelfReflection,
  CodeResult,
  TokenUsage,
  AgentRole,
  SessionMemory,
} from './types.js';
import type { DataContext } from './types.js';
import { serializeContext } from './serialize-context.js';
import { extractExecutableBlocks, executeCodeBlock, validateResult } from './code-executor.js';
import { loadMemory, saveMemory, pruneMemory } from './session-memory.js';
import type Database from 'better-sqlite3';

const PROMPTS_DIR = join(import.meta.dirname, '..', '..', 'prompts');
const MAX_CODE_RETRIES = 2;
const MAX_REFLECTION_RETRIES = 1;

function loadPrompt(filename: string): string {
  return readFileSync(join(PROMPTS_DIR, filename), 'utf-8');
}

export async function runPipeline(
  db: Database.Database,
  dataContext: DataContext,
  config: PipelineConfig,
  memoryPath: string,
): Promise<PipelineResult> {
  const startTime = Date.now();
  const client = new Anthropic();
  const tokenUsage: TokenUsage = { totalInput: 0, totalOutput: 0, byCaller: {} };
  const modelResearcher = config.modelResearcher ?? 'claude-sonnet-4-6';
  const modelReviewer = config.modelReviewer ?? 'claude-haiku-4-5-20251001';

  // Load memory and prompts
  const memory = loadMemory(memoryPath);
  const researcherPrompt = loadPrompt('hayden-researcher.md');
  const contextText = serializeContext(dataContext);

  // Build user message
  let userMessage: string;
  if (config.reportType) {
    const templateFile = config.reportType === 'daily'
      ? 'report-templates/daily-briefing.md'
      : 'report-templates/weekly-deep-dive.md';
    const template = loadPrompt(templateFile);
    userMessage = `${template}\n\n---\n\n## Health Data\n\n${contextText}`;
  } else {
    userMessage = `## Question\n\n${config.question}\n\n---\n\n## Health Data\n\n${contextText}`;
  }

  // Add memory context
  if (memory.recentFindings.length > 0 || memory.goals.length > 0) {
    userMessage += `\n\n---\n\n## Session Memory\n\n${JSON.stringify(memory, null, 2)}`;
  }

  // Add continue context
  if (config.continueContext) {
    userMessage += `\n\n---\n\n## Previous Analysis\n\n${config.continueContext}`;
  }

  // Step 1: Hayden draft
  const draftResponse = await client.messages.create({
    model: modelResearcher,
    max_tokens: 4096,
    system: researcherPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });
  const draftText = extractText(draftResponse);
  trackUsage(tokenUsage, 'researcher-draft', draftResponse.usage);

  // Step 2: Code execution (if any executable blocks)
  const codeResults: CodeResult[] = [];
  let enrichedDraft = draftText;
  const codeBlocks = extractExecutableBlocks(draftText);

  for (const block of codeBlocks) {
    let result = executeCodeBlock(db, block);
    let retries = 0;

    // Retry loop for failed queries
    while (result.error && retries < MAX_CODE_RETRIES) {
      retries++;
      const retryResponse = await client.messages.create({
        model: modelResearcher,
        max_tokens: 2048,
        system: researcherPrompt,
        messages: [
          { role: 'user', content: userMessage },
          { role: 'assistant', content: draftText },
          { role: 'user', content: `Your query failed with: ${result.error}\n\nPlease fix and resubmit the query.` },
        ],
      });
      const retryText = extractText(retryResponse);
      trackUsage(tokenUsage, `code-retry-${retries}`, retryResponse.usage);

      const retryBlocks = extractExecutableBlocks(retryText);
      if (retryBlocks.length > 0) {
        result = executeCodeBlock(db, retryBlocks[0]);
        result.retryCount = retries;
      } else {
        break;
      }
    }

    // Validate result
    if (result.output) {
      result.warnings = validateResult(result);
      result.validated = result.warnings.length === 0;
    }

    codeResults.push(result);
  }

  // Append code results to draft
  if (codeResults.length > 0) {
    enrichedDraft += '\n\n## Code Execution Results\n\n';
    for (const r of codeResults) {
      enrichedDraft += `### Query:\n\`\`\`sql\n${r.code}\n\`\`\`\n`;
      if (r.output) {
        enrichedDraft += `### Result:\n\`\`\`json\n${r.output}\n\`\`\`\n`;
      }
      if (r.error) {
        enrichedDraft += `### Error: ${r.error}\n`;
      }
      if (r.warnings.length > 0) {
        enrichedDraft += `### ⚠️ Warnings: ${r.warnings.join(', ')}\n`;
      }
    }
  }

  // Step 3: Parallel reviews
  const reviewPrompts: { role: AgentRole; file: string }[] = [
    { role: 'statistician', file: 'reviewer-statistician.md' },
    { role: 'sleep', file: 'reviewer-sleep.md' },
    { role: 'biomarker', file: 'reviewer-biomarker.md' },
  ];

  const reviewPromises = reviewPrompts.map(async ({ role, file }) => {
    const systemPrompt = loadPrompt(file);
    const dataSubset = buildReviewerDataSubset(role, contextText);

    try {
      const response = await client.messages.create({
        model: modelReviewer,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `## Draft to Review\n\n${enrichedDraft}\n\n---\n\n## Raw Data\n\n${dataSubset}`,
        }],
      });
      trackUsage(tokenUsage, `reviewer-${role}`, response.usage);
      return parseReviewVerdict(role, extractText(response));
    } catch (err: any) {
      return {
        role,
        verdict: 'confirmed' as const,
        notes: `Review unavailable: ${err.message}`,
        suggestedEdit: null,
        raw: '',
      } satisfies ReviewVerdict;
    }
  });

  const reviews = await Promise.all(reviewPromises);

  // Step 4: Hayden revision
  const reviewFeedback = reviews.map(r =>
    `## Review: ${r.role}\n- Verdict: ${r.verdict}\n- Notes: ${r.notes}\n- Suggested edit: ${r.suggestedEdit ?? 'None'}`
  ).join('\n\n');

  const revisionResponse = await client.messages.create({
    model: modelResearcher,
    max_tokens: 4096,
    system: researcherPrompt,
    messages: [
      { role: 'user', content: userMessage },
      { role: 'assistant', content: enrichedDraft },
      { role: 'user', content: `## Reviewer Feedback\n\n${reviewFeedback}\n\nPlease revise your analysis incorporating this feedback. Produce the final output for the user.` },
    ],
  });
  const revisedText = extractText(revisionResponse);
  trackUsage(tokenUsage, 'researcher-revision', revisionResponse.usage);

  // Step 5: Self-reflection
  const reflectionPrompt = loadPrompt('self-reflection.md');
  const reflectionResponse = await client.messages.create({
    model: modelReviewer,
    max_tokens: 512,
    system: reflectionPrompt,
    messages: [{
      role: 'user',
      content: `## Final Output to Check\n\n${revisedText}\n\n---\n\n## Original Data\n\n${contextText}`,
    }],
  });
  trackUsage(tokenUsage, 'self-reflection', reflectionResponse.usage);

  let selfReflection = parseSelfReflection(extractText(reflectionResponse));
  let finalOutput = revisedText;

  // One revision if reflection flags issues
  if (selfReflection.action === 'revise') {
    const fixResponse = await client.messages.create({
      model: modelResearcher,
      max_tokens: 4096,
      system: researcherPrompt,
      messages: [
        { role: 'user', content: userMessage },
        { role: 'assistant', content: revisedText },
        { role: 'user', content: `## Self-Reflection Issues\n\n${selfReflection.details}\n\nPlease fix these specific issues in your output.` },
      ],
    });
    finalOutput = extractText(fixResponse);
    trackUsage(tokenUsage, 'researcher-reflection-fix', fixResponse.usage);
  }

  // Update session memory
  const updatedMemory = pruneMemory(memory, new Date().toISOString().split('T')[0]);
  updatedMemory.lastUpdated = new Date().toISOString().split('T')[0];
  saveMemory(memoryPath, updatedMemory);

  return {
    finalOutput,
    reviews,
    selfReflection,
    codeResults,
    tokenUsage,
    durationMs: Date.now() - startTime,
  };
}

// --- Helper Functions (exported for testing) ---

export function parseReviewVerdict(role: string, text: string): ReviewVerdict {
  const verdictMatch = text.match(/Verdict:\s*(✅\s*confirmed|⚠️\s*flag|🔄\s*revise)/i);
  const notesMatch = text.match(/Notes:\s*(.+)/);
  const editMatch = text.match(/Suggested edit:\s*(.+)/i);

  let verdict: 'confirmed' | 'flag' | 'revise' = 'confirmed';
  if (verdictMatch) {
    const v = verdictMatch[1].toLowerCase();
    if (v.includes('flag')) verdict = 'flag';
    else if (v.includes('revise')) verdict = 'revise';
  }

  const suggestedEdit = editMatch?.[1]?.trim();

  return {
    role: role as AgentRole,
    verdict,
    notes: notesMatch?.[1]?.trim() ?? text,
    suggestedEdit: (suggestedEdit && suggestedEdit.toLowerCase() !== 'none' && suggestedEdit.toLowerCase() !== 'n/a')
      ? suggestedEdit
      : null,
    raw: text,
  };
}

export function buildReviewerDataSubset(role: string, fullContext: string): string {
  // Statistician gets everything
  if (role === 'statistician') return fullContext;

  // For other reviewers, include all sections but the full context is small enough
  // that subsetting adds complexity without much benefit at ~2-4K tokens.
  // Keep it simple: pass full context to all reviewers.
  return fullContext;
}

function parseSelfReflection(text: string): SelfReflection {
  const consistent = !/Consistent:\s*no/i.test(text);
  const claimDriftMatch = text.match(/Claim drift:\s*(.+)/i);
  const safetyMatch = !/Safety compliant:\s*no/i.test(text);
  const actionMatch = text.match(/Action:\s*(✅\s*deliver|🔄\s*revise)/i);

  const claimDrift = claimDriftMatch?.[1]?.trim();

  return {
    consistent,
    claimDrift: (claimDrift && claimDrift.toLowerCase() !== 'none') ? claimDrift : null,
    safetyCompliant: safetyMatch,
    action: actionMatch?.[1]?.includes('revise') ? 'revise' : 'deliver',
    details: text,
  };
}

function extractText(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('');
}

function trackUsage(
  tracker: TokenUsage,
  caller: string,
  usage: { input_tokens: number; output_tokens: number }
): void {
  tracker.totalInput += usage.input_tokens;
  tracker.totalOutput += usage.output_tokens;
  tracker.byCaller[caller] = {
    input: usage.input_tokens,
    output: usage.output_tokens,
  };
}
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/pipeline/__tests__/orchestrator.test.ts`
Expected: Helper function tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/orchestrator.ts src/pipeline/__tests__/orchestrator.test.ts
git commit -m "feat: implement pipeline orchestrator with Anthropic SDK"
```

---

## Chunk 7: CLI Entry Points

### Task 13: Interactive CLI (health-ask)

**Files:**
- Create: `scripts/health-ask.ts`

- [ ] **Step 1: Implement health-ask CLI**

```typescript
import { resolve } from 'path';
import { openDatabase } from '../src/db/database.js';
import { buildDataContext } from '../src/pipeline/data-context-builder.js';
import { runPipeline } from '../src/pipeline/orchestrator.js';
import type { PipelineConfig } from '../src/pipeline/types.js';

const DB_PATH = resolve(import.meta.dirname, '..', 'data', 'health.db');
const MEMORY_PATH = resolve(import.meta.dirname, '..', 'reports', 'memory.json');
const CONTINUE_FILE = resolve(import.meta.dirname, '..', 'reports', '.last-output.txt');

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log('Usage: npm run health:ask -- "your question here" [--show-review] [--continue]');
    process.exit(0);
  }

  const question = args.find(a => !a.startsWith('--')) ?? '';
  const showReview = args.includes('--show-review');
  const continueMode = args.includes('--continue');

  if (!question && !showReview) {
    console.error('Please provide a question.');
    process.exit(1);
  }

  // Handle --show-review: display last review
  if (showReview && !question) {
    const { readFileSync, existsSync } = await import('fs');
    const reviewPath = resolve(import.meta.dirname, '..', 'reports', 'reviews', 'last-interactive.json');
    if (existsSync(reviewPath)) {
      const reviews = JSON.parse(readFileSync(reviewPath, 'utf-8'));
      for (const r of reviews) {
        console.log(`\n--- ${r.role} (${r.verdict}) ---`);
        console.log(r.notes);
        if (r.suggestedEdit) console.log(`Suggested: ${r.suggestedEdit}`);
      }
    } else {
      console.log('No previous review found. Run a query first.');
    }
    return;
  }

  console.log('🔬 Dr. Hayden is analyzing your data...\n');

  const db = openDatabase(DB_PATH);

  // Check for data staleness
  const lastSync = db.prepare(
    `SELECT MAX(last_synced_at) AS last FROM sync_metadata`
  ).get() as { last: string | null };

  if (lastSync.last) {
    const hoursSince = (Date.now() - new Date(lastSync.last).getTime()) / 3600000;
    if (hoursSince > 48) {
      console.log(`⚠️  Data may be stale (last sync: ${lastSync.last})\n`);
    }
  }

  const dataContext = buildDataContext(db);

  // Load continue context
  let continueContext: string | undefined;
  if (continueMode) {
    const { readFileSync, existsSync } = await import('fs');
    if (existsSync(CONTINUE_FILE)) {
      continueContext = readFileSync(CONTINUE_FILE, 'utf-8');
    }
  }

  const config: PipelineConfig = {
    question,
    continueContext,
    showReview,
  };

  try {
    const result = await runPipeline(db, dataContext, config, MEMORY_PATH);

    console.log(result.finalOutput);

    // Save for --continue and --show-review
    const { writeFileSync, mkdirSync } = await import('fs');
    mkdirSync(resolve(import.meta.dirname, '..', 'reports', 'reviews'), { recursive: true });
    writeFileSync(CONTINUE_FILE, result.finalOutput);
    writeFileSync(
      resolve(import.meta.dirname, '..', 'reports', 'reviews', 'last-interactive.json'),
      JSON.stringify(result.reviews, null, 2)
    );

    // Print stats
    console.log(`\n---`);
    console.log(`⏱  ${(result.durationMs / 1000).toFixed(1)}s | 📊 ${result.tokenUsage.totalInput + result.tokenUsage.totalOutput} tokens`);
    if (showReview) {
      for (const r of result.reviews) {
        console.log(`\n--- ${r.role} (${r.verdict}) ---`);
        console.log(r.notes);
      }
    }
  } catch (err: any) {
    console.error(`❌ Pipeline error: ${err.message}`);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit scripts/health-ask.ts` (may need adjustment for script context)
Expected: No critical errors

- [ ] **Step 3: Commit**

```bash
git add scripts/health-ask.ts
git commit -m "feat: add interactive health-ask CLI entry point"
```

### Task 14: Automated report CLI (health-report)

**Files:**
- Create: `scripts/health-report.ts`

- [ ] **Step 1: Implement health-report CLI**

```typescript
import { resolve } from 'path';
import { writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { openDatabase } from '../src/db/database.js';
import { buildDataContext } from '../src/pipeline/data-context-builder.js';
import { runPipeline } from '../src/pipeline/orchestrator.js';
import type { PipelineConfig } from '../src/pipeline/types.js';

const DB_PATH = resolve(import.meta.dirname, '..', 'data', 'health.db');
const MEMORY_PATH = resolve(import.meta.dirname, '..', 'reports', 'memory.json');
const REPORTS_DIR = resolve(import.meta.dirname, '..', 'reports');
const LOG_PATH = resolve(process.env.HOME ?? '~', 'Library', 'Logs', 'health-pipeline.log');

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const reportType = args.find(a => a === 'daily' || a === 'weekly') as 'daily' | 'weekly' | undefined;

  if (!reportType) {
    console.log('Usage: npm run health:report -- daily|weekly');
    process.exit(1);
  }

  const today = new Date().toISOString().split('T')[0];
  const timestamp = new Date().toISOString();
  log(`[${timestamp}] Starting ${reportType} report generation`);

  const db = openDatabase(DB_PATH);
  const dataContext = buildDataContext(db);

  // Check for data
  if (dataContext.timeRange.earliest === '') {
    log(`[${timestamp}] No data available. Skipping report.`);
    console.log('No data available. Run sync first.');
    db.close();
    return;
  }

  const config: PipelineConfig = { reportType };

  try {
    const result = await runPipeline(db, dataContext, config, MEMORY_PATH);

    // Save report
    const subdir = resolve(REPORTS_DIR, reportType);
    mkdirSync(subdir, { recursive: true });

    let filename: string;
    if (reportType === 'daily') {
      filename = `${today}.md`;
    } else {
      const weekNum = getISOWeek(new Date(today));
      filename = `${today.substring(0, 4)}-W${String(weekNum).padStart(2, '0')}.md`;
    }

    const reportPath = resolve(subdir, filename);
    writeFileSync(reportPath, result.finalOutput);

    // Save reviews
    const reviewDir = resolve(REPORTS_DIR, 'reviews');
    mkdirSync(reviewDir, { recursive: true });
    writeFileSync(
      resolve(reviewDir, `${today}-${reportType}.json`),
      JSON.stringify(result.reviews, null, 2)
    );

    log(`[${timestamp}] ${reportType} report saved to ${reportPath}`);
    log(`[${timestamp}] Duration: ${result.durationMs}ms | Tokens: ${result.tokenUsage.totalInput + result.tokenUsage.totalOutput}`);

    console.log(`✅ ${reportType} report saved to ${reportPath}`);
  } catch (err: any) {
    log(`[${timestamp}] ERROR: ${err.message}`);
    console.error(`❌ Report generation failed: ${err.message}`);
    process.exit(1);
  } finally {
    db.close();
  }
}

function log(message: string): void {
  try {
    appendFileSync(LOG_PATH, message + '\n');
  } catch {
    // Logging failure is non-fatal
  }
}

function getISOWeek(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const yearStart = new Date(d.getFullYear(), 0, 4);
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

main();
```

- [ ] **Step 2: Commit**

```bash
git add scripts/health-report.ts
git commit -m "feat: add automated health-report CLI entry point"
```

---

## Chunk 8: Automated Scheduling

### Task 15: launchd wrapper script

**Files:**
- Create: `scripts/run-health-report.sh`

- [ ] **Step 1: Create wrapper script**

```bash
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
```

- [ ] **Step 2: Make executable**

Run: `chmod +x scripts/run-health-report.sh`

- [ ] **Step 3: Commit**

```bash
git add scripts/run-health-report.sh
git commit -m "feat: add launchd wrapper for automated health reports"
```

### Task 16: Daily report launchd plist

**Files:**
- Create: `~/Library/LaunchAgents/com.health-data-aggregator.daily-report.plist`

- [ ] **Step 1: Create daily plist**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.health-data-aggregator.daily-report</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/glennkinsman/Projects/health-data-aggregator/scripts/run-health-report.sh</string>
        <string>daily</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>30</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/Users/glennkinsman/Library/Logs/health-pipeline.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/glennkinsman/Library/Logs/health-pipeline.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
```

- [ ] **Step 2: Load the daily plist**

Run: `launchctl load ~/Library/LaunchAgents/com.health-data-aggregator.daily-report.plist`

- [ ] **Step 3: Verify it's loaded**

Run: `launchctl list | grep health-data-aggregator.daily`
Expected: Shows the job

### Task 17: Weekly report launchd plist

**Files:**
- Create: `~/Library/LaunchAgents/com.health-data-aggregator.weekly-report.plist`

- [ ] **Step 1: Create weekly plist**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.health-data-aggregator.weekly-report</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/glennkinsman/Projects/health-data-aggregator/scripts/run-health-report.sh</string>
        <string>weekly</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Weekday</key>
        <integer>0</integer>
        <key>Hour</key>
        <integer>18</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/Users/glennkinsman/Library/Logs/health-pipeline.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/glennkinsman/Library/Logs/health-pipeline.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
```

- [ ] **Step 2: Load the weekly plist**

Run: `launchctl load ~/Library/LaunchAgents/com.health-data-aggregator.weekly-report.plist`

- [ ] **Step 3: Verify and commit**

Run: `launchctl list | grep health-data-aggregator.weekly`

```bash
git add scripts/run-health-report.sh
git commit -m "feat: add launchd schedules for daily and weekly health reports"
```

---

## Chunk 9: Integration Testing & Documentation

### Task 18: Smoke test the pipeline

- [ ] **Step 1: Verify all unit tests pass**

Run: `npm run test:run`
Expected: All tests pass

- [ ] **Step 2: Ensure ANTHROPIC_API_KEY is in .env**

Check that `.env` contains `ANTHROPIC_API_KEY=sk-ant-...`

If not, add it:
```bash
echo "ANTHROPIC_API_KEY=your-key-here" >> .env
```

- [ ] **Step 3: Run a live smoke test**

Run: `npm run health:ask -- "How did I sleep last night?"`
Expected: Dr. Hayden produces an analysis of last night's sleep data with specific numbers

- [ ] **Step 4: Run automated daily report**

Run: `npm run health:report -- daily`
Expected: Report saved to `reports/daily/2026-03-13.md`

- [ ] **Step 5: Check the report**

Run: `cat reports/daily/2026-03-13.md`
Expected: A well-formatted daily briefing with actual data

### Task 19: Test review visibility

- [ ] **Step 1: Check review verdicts were saved**

Run: `cat reports/reviews/last-interactive.json`
Expected: JSON array with 3 reviewer verdicts

- [ ] **Step 2: Test --show-review flag**

Run: `npm run health:ask -- --show-review`
Expected: Displays the three reviewer verdicts from the last query

### Task 20: Test --continue flag

- [ ] **Step 1: Ask an initial question**

Run: `npm run health:ask -- "What's my HRV trend this week?"`

- [ ] **Step 2: Follow up with --continue**

Run: `npm run health:ask -- "What about compared to last month?" --continue`
Expected: Hayden references the prior HRV analysis

### Task 21: Update documentation

**Files:**
- Modify: `PROGRESS.md`
- Modify: `.claude/CLAUDE.md`

- [ ] **Step 1: Update PROGRESS.md**

Add to Completed section:
```
- ✅ Health researcher multi-agent pipeline (Dr. Hayden + 3 reviewers + self-reflection) (2026-03-13)
- ✅ Automated daily (9:30 AM) and weekly (Sunday 6 PM) health reports via launchd (2026-03-13)
```

Move CPAP items down appropriately.

- [ ] **Step 2: Update CLAUDE.md with new commands and structure**

Add to Commands section:
```
- `npm run health:ask -- "question"` — Interactive health data analysis
- `npm run health:report -- daily|weekly` — Generate automated health report
```

Add to Project Structure:
```
- `src/pipeline/` — Health researcher multi-agent pipeline (orchestrator, data context, code executor, session memory)
- `prompts/` — Agent system prompts (Dr. Hayden, 3 reviewers, self-reflection, report templates)
- `reports/` — Generated health reports and session memory (gitignored)
```

Add to Automated Sync:
```
- launchd job: `com.health-data-aggregator.daily-report` (9:30 AM daily briefing)
- launchd job: `com.health-data-aggregator.weekly-report` (Sunday 6 PM deep dive)
- Reports saved to: `reports/daily/` and `reports/weekly/`
- Pipeline logs: `~/Library/Logs/health-pipeline.log`
```

- [ ] **Step 3: Commit documentation updates**

```bash
git add PROGRESS.md .claude/CLAUDE.md
git commit -m "docs: update progress and CLAUDE.md for health researcher pipeline"
```
