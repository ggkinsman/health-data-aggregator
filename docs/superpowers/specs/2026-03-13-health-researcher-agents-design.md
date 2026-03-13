# Health Researcher Multi-Agent Pipeline — Design Spec

## Overview

A multi-agent system for analyzing personal health data from multiple sources (Oura Ring, Apple Health, CPAP/OSCAR, Function Health). A primary health researcher agent drafts insights, three specialist reviewers verify accuracy and relevance, and the researcher delivers a final vetted analysis.

The system operates in two modes: interactive (ad-hoc questions via Claude Code) and automated (scheduled periodic reports via launchd).

## Goals

- Surface compelling health insights across short-term (1-3 days), medium-term (2-4 weeks), and long-term (months/seasons/year-over-year) time horizons
- Not every insight needs to be actionable — interesting patterns are worth communicating
- When insights are actionable, be concrete and specific
- Cross-check all findings through specialist reviewers before delivery
- Proactively suggest deeper analyses and additional data that could unlock more understanding
- Communicate in plain language calibrated to personal baselines, not population averages

## Agent Definitions

### Primary Agent — Dr. Hayden (Health Research Lead)

The main voice the user interacts with. A health researcher who specializes in longitudinal personal health data analysis.

**Responsibilities:**
- Query the SQLite database across all data sources
- Identify patterns across all time horizons
- Draft insights in plain language with specific numbers
- Incorporate reviewer feedback into final output
- Suggest follow-up analyses and missing data opportunities

**Persona traits:**
- Curious and thorough — treats the data like a research project
- Honest about confidence levels and data limitations
- Conversational, not clinical — explains without jargon
- Proactive — generates hypotheses and suggests what to explore next

### Reviewer 1 — Statistical Analyst

**Reviews for:**
- Cherry-picked data or misleading trends (is a "drop" within normal variance?)
- Sample size issues (too few data points for a claim)
- Correlation vs. causation overreach
- Whether the right time window was used for the analysis
- Statistical significance of observed patterns

### Reviewer 2 — Sleep & Recovery Specialist

**Reviews for:**
- Correct interpretation of sleep staging, HRV, temperature, and respiratory data
- CPAP data interpretation (AHI, leak rate, pressure trends) once available
- Sleep architecture context and nuance
- Recovery metric interpretation (readiness, restoration)

### Reviewer 3 — Biomarker & Wellness Specialist

**Reviews for:**
- Correct interpretation of activity, cardiovascular, and readiness metrics
- Function Health blood panel interpretation once available
- Cross-domain connections (e.g., sleep quality → next-day activity performance)
- Metabolic and inflammatory marker trends

## Pipeline Flow

```
1. Data context builder queries SQLite → assembles structured snapshot
2. Hayden receives data context + user question (or report parameters)
3. Hayden drafts insight(s) in structured format
4. Statistical Analyst reviews draft + raw data context
5. Sleep Specialist reviews draft + sleep/respiratory data subset
6. Biomarker Specialist reviews draft + activity/cardiovascular/blood panel subset
7. Hayden receives all three reviews, revises, and delivers final output
```

## Orchestration Architecture

### Runtime Mechanism

A TypeScript script (`scripts/health-pipeline.ts`) using the Anthropic SDK to make sequential API calls. Each agent is a separate `messages.create()` call with its own system prompt loaded from the `prompts/` directory.

### Data Flow Between Calls

All data flows in-memory within a single script execution:

1. **Data context builder** (TypeScript function) queries SQLite, returns a structured JSON object
2. **Hayden draft call** — system prompt from `hayden-researcher.md`, user message contains serialized data context + question/report params. Returns draft text.
3. **Three reviewer calls (parallel)** — each gets its own system prompt + Hayden's draft + relevant data subset as the user message. Returns structured review verdict.
4. **Hayden revision call** — extends the original Hayden conversation with reviewer feedback appended as a follow-up user message. Returns final output.

Total: **5 API calls per pipeline run** (1 draft + 3 parallel reviews + 1 revision).

### Entry Points

- **Interactive:** `npm run health:ask -- "why was my sleep bad last week?"` — runs the full pipeline, prints Hayden's final output to stdout. Review verdicts are saved to a temp file; user can re-run with `--show-review` to see them.
- **Automated:** `npm run health:report -- --type daily|weekly` — runs the pipeline with report template parameters instead of a user question. Saves output to `reports/`.

### Reviewer Data Subsetting

The orchestration script filters the data context before passing to each reviewer:
- **Statistical Analyst:** Full data context (needs all numbers to verify claims)
- **Sleep Specialist:** Filters to sleep stages, HRV, temperature, SpO2, respiratory data, CPAP metrics
- **Biomarker Specialist:** Filters to activity, cardiovascular, readiness, workout, blood panel metrics

## Failure Handling

### LLM Call Failures

- **Retry:** Each API call retries up to 2 times with exponential backoff (1s, 3s) for transient errors (rate limits, timeouts)
- **Partial review fallback:** If a reviewer call fails after retries, Hayden proceeds with available reviews. The final output includes a note: "Note: [reviewer role] review was unavailable for this analysis."
- **Hayden draft failure:** Fatal — no output is produced. Logged as an error.

### Data Issues

- **Empty data context:** If no data exists for the requested time window, the pipeline exits early with a message: "No data available for [time range]. Last sync: [date]."
- **Stale data:** If the most recent sync is >48 hours old, Hayden's output includes a staleness warning.

### Output Validation

- **Reviewer output parsing:** If a reviewer's response doesn't follow the structured format, treat it as a free-text review and pass it to Hayden as-is. Don't block the pipeline on format issues.
- **Automated mode logging:** All pipeline runs log to `~/Library/Logs/health-pipeline.log` with timestamps, call durations, token counts, and any errors.

## Output Storage

### Report Files

```
reports/
├── daily/
│   └── 2026-03-13.md           # Daily briefing
├── weekly/
│   └── 2026-W11.md             # Weekly deep dive
└── reviews/
    └── 2026-03-13-daily.json   # Reviewer verdicts (for --show-review)
```

- Reports are date-stamped markdown files
- Reviewer verdicts are saved as JSON alongside each report for on-demand viewing
- Historical reports are queryable — future enhancement: Hayden could reference past reports when answering interactive questions (deferred to implementation)

### Delivery

- **Automated reports:** Saved to `reports/` directory. At the start of each Claude Code session, Hayden can check for unread reports and surface highlights.
- **Interactive:** Output printed to stdout in the terminal

## Data Architecture

### Data Context Snapshot

A TypeScript function queries SQLite and assembles a structured JSON block passed to all agents. The primary data source is the existing `daily_summary` table (built by `summary-builder.ts`), supplemented by raw tables only when finer granularity is needed.

```
Data Context:
├── Time range available: [earliest date] → [latest date]
├── Short-term (last 3 days): daily summaries + hourly HR/HRV from raw tables
├── Medium-term (last 30 days): daily summaries with computed trend direction
├── Long-term (last 6 months): monthly averages from daily summaries
├── Year-over-year: same-month comparisons where data exists
├── Source coverage: which sources have data for which periods
└── Anomalies: values >2 std deviations from 90-day rolling average
```

**Anomaly detection:** Computed in SQL using a 90-day rolling window per metric. Any daily value more than 2 standard deviations from the rolling mean is flagged.

**Context size target:** ~2,000-4,000 tokens for the data snapshot. Daily summaries are already aggregated, so even 6 months fits comfortably. Raw hourly data is only included for the short-term window (last 3 days).

### Data Sources

| Source | Status | Key Metrics |
|--------|--------|-------------|
| Oura Ring | ✅ Live | Sleep stages, HRV, temperature, readiness, activity, SpO2 |
| Apple Health | ✅ Live | HR, resting HR, HRV, workouts, sleep (multiple sources) |
| CPAP (OSCAR) | 🔜 Coming | AHI, leak rate, pressure, respiratory events, usage hours |
| Function Health | 🔜 Coming | Blood panels, biomarkers, metabolic markers |

### What Each Agent Receives

| Agent | Data |
|-------|------|
| Hayden | Full data context + question or report parameters |
| Statistical Analyst | Hayden's draft + full raw data context |
| Sleep Specialist | Hayden's draft + sleep/respiratory data subset |
| Biomarker Specialist | Hayden's draft + activity/cardiovascular/blood panel subset |

### Cross-Source Awareness

Hayden is instructed to look for corroborations and contradictions across sources. When sources disagree (e.g., Oura reports 7h sleep, Apple Health reports 6.5h), explain likely reasons rather than ignoring the discrepancy.

## Structured Output Formats

### Hayden's Draft (to reviewers)

```markdown
## Insight: [title]
- Time horizon: short / medium / long
- Data sources used: [list]
- Finding: [plain language description]
- Confidence: high / moderate / low
- Actionable: yes / no
- If actionable: [suggested action]
- Supporting data: [specific numbers, dates, comparisons]
```

### Reviewer Output (to Hayden)

```markdown
## Review: [reviewer role]
- Verdict: ✅ confirmed / ⚠️ flag / 🔄 revise
- Notes: [specific feedback]
- Suggested edit: [if applicable]
```

### Hayden's Final Output (to user)

```markdown
## [Insight title]
[Plain language paragraph — conversational, not clinical]

📊 Data: [key numbers that support it]
🔄 Actionable: [action if applicable, or "No action needed — just interesting to know"]

🔍 Go deeper: [optional follow-up suggestions]
```

## "Go Deeper" Suggestions

A core behavior, not an afterthought. At the end of any insight, Hayden can suggest:

- **Follow-up analyses** — "Want me to check if this HRV pattern correlates with your workout intensity over the same period?"
- **Missing data that would help** — "If you tracked caffeine intake, we could test whether that's driving the late sleep onset"
- **Cross-source investigations** — "Once your CPAP data is available, I can check if your AHI events correlate with these HRV dips"
- **Longer/different time windows** — "This looks interesting at 30 days — want me to pull back to 6 months to see if it's seasonal?"

This turns the system into a research partner that generates its own hypotheses.

## Communication Style

1. **Lead with what's interesting, not what's normal.** Don't report routine values — surface what changed, what's unusual, or what tells a story.

2. **Plain language, specific numbers.** No medical jargon without explanation. Always include actual values — "your HRV dropped from 45ms to 31ms" not "your HRV dropped."

3. **Calibrate to personal baseline, not population averages.** "Your resting HR of 58 is 4 bpm above your 90-day average of 54" is more useful than "58 is normal."

4. **Not everything needs to be actionable.** Interesting patterns are worth communicating. "No action needed — this is just worth knowing" is a valid conclusion.

5. **When actionable, be concrete.** Not "improve sleep hygiene" — instead "your data shows you've been falling asleep 45 minutes later on weekends, and your Monday readiness scores are consistently your lowest."

6. **Confidence transparency.** If data is thin or a pattern is ambiguous, say so. "Based on only 5 days of CPAP data, this is preliminary."

7. **Cross-source storytelling.** The most valuable insights connect dots between sources. "Your Oura readiness dropped to 62 the same week your CPAP leak rate spiked — worth checking mask fit."

## Review Visibility

- **Default:** Reviews happen behind the scenes. User sees only Hayden's final output.
- **On-demand:** User can ask "show me the review" to see all three reviewer verdicts and reasoning for any insight.

## Operational Modes

### Interactive (Claude Code)

User asks a question → orchestration script chains: Hayden drafts → 3 reviewers evaluate → Hayden revises → user sees final output.

### Automated (Periodic Reports)

Scheduled via launchd on Mac Mini:

- **Daily briefing (morning):** Last night's sleep, yesterday's activity, anything notable in the last 24-48 hours
- **Weekly deep dive (Sunday evening):** Trends across the week, cross-source patterns, medium/long-term observations, go-deeper suggestions for the week ahead

The script assembles the data context, runs the full pipeline, and outputs a markdown report.

## Model Selection & Cost

- **Hayden (researcher):** Sonnet or Opus — needs strong reasoning and natural communication
- **Reviewers:** Haiku — focused verification tasks, lower token cost
- Each report = **5 API calls** (1 Hayden draft + 3 parallel reviews + 1 Hayden revision). Prompt caching on the revision call reduces cost since it shares context with the draft.

### Estimated Cost Per Run

Assuming ~4K tokens data context, ~1K token responses per agent:
- **Hayden (Sonnet):** ~$0.02-0.04 per run (draft + revision)
- **3x Reviewers (Haiku):** ~$0.003 total
- **Per daily report:** ~$0.03-0.05
- **Per week (7 daily + 1 weekly):** ~$0.30-0.50
- **Monthly estimate:** ~$1.50-2.50

Cost is modest. No budget cap needed at this scale, but the pipeline logs token counts per run for monitoring.

## Naming Convention

In code, the primary agent is referenced as `researcher`. The "Dr. Hayden" persona name appears only in prompt files and user-facing output.

## File Structure

```
prompts/
├── hayden-researcher.md          # Primary researcher persona + system prompt
├── reviewer-statistician.md      # Statistical review prompt
├── reviewer-sleep.md             # Sleep & recovery review prompt
├── reviewer-biomarker.md         # Biomarker & wellness review prompt
└── report-templates/
    ├── daily-briefing.md         # Parameters for daily morning report
    └── weekly-deep-dive.md       # Parameters for weekly analysis
```

## Extensibility

When new data sources come online (CPAP, Function Health):

1. **Data context builder** — add new query sections for the new tables
2. **Hayden's prompt** — add new source to the data awareness section
3. **Sleep Specialist** — gains CPAP review responsibilities (already scoped)
4. **Biomarker Specialist** — gains Function Health review responsibilities (already scoped)
5. **No new agents needed** — existing reviewers cover the domains
6. **Prompt update** — flip source status from `🔜 Coming` to `✅ Live`, add metric definitions

## Research References

This design is informed by:
- Google's Personal Health Agent (PHA) — multi-agent orchestrator with Data Scientist, Domain Expert, and Health Coach roles
- Google's PH-LLM — personal health LLM fine-tuned for sleep/fitness coaching with wearable data
- Oura Advisor — AI-powered health companion analyzing biometric data for personalized guidance
- PhysioLLM — wearable sensor data analysis with LLMs for personalized health insights
