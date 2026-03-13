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
- Write and execute SQL queries or simple statistical code to validate findings (see Analysis Code Execution)
- Draft insights in plain language with specific numbers
- Ground interpretive claims in established health/sleep science (see Evidence Grounding)
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
2a. Query clarification: if the question is ambiguous, Hayden first produces
    an analysis plan (what metrics, what time window, what comparison)
    before drafting insights
3. Hayden drafts insight(s), optionally writing + executing SQL/stats code
4. Statistical Analyst reviews draft + raw data context
5. Sleep Specialist reviews draft + sleep/respiratory data subset
6. Biomarker Specialist reviews draft + activity/cardiovascular/blood panel subset
7. Hayden receives all three reviews, revises, and produces final draft
8. Self-reflection: orchestrator prompts a coherence/accuracy check on the final draft
9. Session memory updated with key findings, open questions, and goal progress
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

Total: **6 API calls per pipeline run** (1 draft + 3 parallel reviews + 1 revision + 1 self-reflection).

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
├── reviews/
│   └── 2026-03-13-daily.json   # Reviewer verdicts (for --show-review)
└── memory.json                  # Session memory (findings, open questions, baselines)
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

## Analysis Code Execution

Inspired by PHA's Data Science Agent, Hayden can write and execute code against the SQLite database to produce rigorous, verifiable findings rather than relying solely on LLM reasoning over pre-computed snapshots.

### How It Works

During the draft phase, Hayden can include SQL queries or simple TypeScript statistical computations in the draft output. The orchestration script:

1. Extracts code blocks tagged as `executable` from Hayden's draft
2. Runs them against the SQLite database in a sandboxed context (read-only, no writes)
3. Appends the results back into Hayden's draft before sending to reviewers

Code execution happens between the draft call and the reviewer calls — the orchestrator extracts code from Hayden's response, executes it locally, and staples the results onto the draft. Reviewers see both Hayden's narrative and the raw query results. Hayden then interprets the full picture (draft + code results + reviewer feedback) during the revision call.

### Code Retry Loop

If a code block fails (SQL error, timeout, empty result set):

1. The orchestrator captures the error message
2. Re-prompts Hayden with: "Your query failed with: [error]. Please fix and resubmit."
3. Up to **2 retries** per code block. If all retries fail, Hayden proceeds without code results and notes the limitation in the draft.

This mirrors PHA's iterative code execution approach (75.5% first-attempt → 79% after retries).

### Code Result Validation

Before stapling results onto the draft, the orchestrator performs basic sanity checks:

- **Not empty:** If a query returns zero rows for a time range that should have data, flag it
- **No SQL errors:** Parse for error messages in the output
- **Reasonable bounds:** If a numeric result is wildly outside expected ranges (e.g., negative sleep hours, HR > 300), flag it

Flagged results are still included but marked with a warning so the Statistical Analyst can investigate.

### When To Use Code Execution

- **Correlation analysis:** "Does my HRV correlate with workout intensity?" → compute Pearson correlation
- **Trend validation:** "Is my deep sleep declining?" → linear regression over the time window
- **Anomaly investigation:** "What happened on March 5th?" → query raw records for that day
- **Comparison queries:** "How does my weekday sleep compare to weekends?" → grouped averages with statistical test

### Scope Constraints

- Read-only access to the SQLite database
- No external network calls
- Execution timeout: 5 seconds per query
- Results are included in the reviewer context so the Statistical Analyst can verify the methodology

## Evidence Grounding

When Hayden makes interpretive claims about health metrics, the prompt instructs grounding in established science:

- **Reference known baselines:** "Deep sleep typically comprises 15-25% of total sleep in adults your age" when contextualizing a finding
- **Cite mechanisms:** "HRV tends to drop after alcohol consumption because alcohol suppresses parasympathetic nervous system activity" — not just "alcohol affects HRV"
- **Acknowledge limits:** When the science is uncertain or contested, say so. "The relationship between HRV and stress is well-established, but the optimal HRV range is highly individual"
- **No diagnosis:** Hayden explains what the data shows and what the science says, but never diagnoses conditions. Concerning patterns are flagged with a recommendation to discuss with a healthcare provider

This is baked into the prompt, not a separate agent or API call. Hayden draws on the LLM's training knowledge for health science context.

## Query Clarification

For ambiguous or vague questions, Hayden produces an **analysis plan** before drafting insights. This is inspired by PHA's two-stage Data Science module.

### Examples

| User asks | Hayden's analysis plan |
|-----------|----------------------|
| "Am I sleeping well?" | Compare last 30 days of total sleep, deep sleep %, sleep efficiency, and sleep onset time against 90-day personal baselines. Check for trends. |
| "How's my health?" | Produce a multi-domain summary: sleep quality (7-day), cardiovascular trends (30-day), activity levels (7-day), and flag any anomalies across all sources. |
| "Why do I feel tired?" | Investigate last 7 days: sleep duration and quality, HRV trends, readiness scores, recent workout load, and any CPAP issues (if available). |

### In Automated Mode

Report templates serve as pre-defined analysis plans, so the clarification step is skipped. The daily briefing template already specifies which metrics and time windows to analyze.

## Safety Guardrails

All agent prompts include these safety guidelines:

1. **Never diagnose.** Hayden is a data researcher, not a clinician. "Your data shows X pattern" is acceptable. "You have condition Y" is never acceptable.
2. **Recommend professional consultation for concerning trends.** If a metric shows a sustained, significant deviation from baseline (e.g., resting HR up 10+ bpm for a week, AHI consistently above 15), Hayden flags it clearly: "This trend is worth discussing with your doctor."
3. **Distinguish observation from advice.** Data observations ("your deep sleep dropped 30% this week") are clearly separated from suggestions ("consider whether your new evening routine might be a factor").
4. **No medication or supplement recommendations.** Hayden can note correlations ("your HRV improved during the weeks you logged magnesium intake") but never recommends starting, stopping, or changing medications or supplements.
5. **Mental health sensitivity.** If data patterns could indicate mental health concerns (e.g., prolonged sleep disruption, dramatic activity drops), Hayden acknowledges the data gently and suggests speaking with a healthcare provider rather than speculating on causes.

## Session Memory

A lightweight JSON file (`reports/memory.json`) maintains continuity between interactive sessions and across automated reports.

### What Gets Stored

```json
{
  "lastUpdated": "2026-03-13",
  "recentFindings": [
    {
      "date": "2026-03-13",
      "insight": "Deep sleep trending down 15% over 3 weeks",
      "status": "open",
      "followUp": "Check if trend continues or reverses"
    }
  ],
  "openQuestions": [
    "Does weekend sleep timing affect Monday readiness?"
  ],
  "userConcerns": [
    "Interested in HRV trends around travel"
  ],
  "goals": [
    {
      "goal": "Improve deep sleep percentage",
      "setDate": "2026-03-10",
      "status": "active",
      "baselineValue": "16% deep sleep (30-day avg)",
      "targetValue": "20%+ deep sleep",
      "lastChecked": "2026-03-13",
      "progress": "Currently at 14% — trending down, not toward target"
    }
  ],
  "baselineSnapshots": {
    "restingHR_90day": 54,
    "hrvMean_90day": 42,
    "deepSleepPct_90day": 0.18
  }
}
```

### How It's Used

- **Interactive mode:** Memory is loaded into Hayden's context at the start of each pipeline run. Hayden can reference prior findings ("Last week I noted your deep sleep was declining — it's continued this week") and track open questions.
- **Automated mode:** After each report, the pipeline updates memory with new findings, marks resolved questions, and updates goal progress.
- **Goal tracking:** Hayden is not a coach — no motivational interviewing, no SMART goal frameworks. But when you express a health goal ("I want to improve my deep sleep"), Hayden records it and references it naturally in future analyses. Weekly reports include a brief goal progress check. Goals can be added, updated, or removed by the user at any time.
- **Pruning:** Findings older than 90 days with status "resolved" are automatically archived. Goals with status "achieved" or "abandoned" are archived after 30 days. Memory file stays small.
- **Concurrency:** The pipeline acquires a simple file lock (`reports/memory.lock`) before reading/writing `memory.json`. If the lock is held (e.g., automated report running while interactive query starts), the second process skips the memory update rather than blocking. Stale baselines in memory are non-authoritative — they're refreshed from the data context builder each run.

## Structured Output Formats

### Hayden's Draft (to reviewers)

```markdown
## Insight: [title]
- Analysis plan: [what was investigated and why this approach]
- Time horizon: short / medium / long
- Data sources used: [list]
- Code executed: [SQL/stats code and results, if any]
- Finding: [plain language description]
- Science context: [relevant health science grounding, if applicable]
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

## Self-Reflection

Inspired by PHA's orchestrator self-query reflection. After Hayden produces the revised final draft (step 7), the orchestrator runs one additional check before delivering to the user.

### How It Works

A lightweight Haiku call receives Hayden's final output and checks for:

- **Internal consistency:** Do the numbers in the narrative match the numbers in the data section?
- **Claim drift:** Did the revision introduce claims not supported by the original data or reviewer feedback?
- **Safety compliance:** Does the output follow all safety guardrails (no diagnosis, appropriate caveats)?
- **Coherence:** Does the output read clearly, or did the revision create contradictions?

### Output

```markdown
## Self-Reflection
- Consistent: yes / no — [details if no]
- Claim drift: none / [flagged claims]
- Safety compliant: yes / no — [details if no]
- Action: ✅ deliver / 🔄 revise [specific fix needed]
```

If the reflection flags an issue, the orchestrator appends the feedback to Hayden's conversation and requests a targeted fix (1 additional API call, max once). If the fix still fails, deliver with a caveat note.

This adds **1 API call** (Haiku, cheap) to the pipeline. Total is now **6 API calls** per run. Estimated cost increase: ~$0.001 per run.

## Operational Modes

### Interactive (Claude Code)

User asks a question → orchestration script chains: Hayden drafts → 3 reviewers evaluate → Hayden revises → self-reflection → user sees final output.

**Multi-turn conversations:** The interactive pipeline supports follow-up questions within the same session. After the first query completes, the user can ask follow-ups that build on the prior context:

```
$ npm run health:ask -- "why was my sleep bad last week?"
[Hayden's analysis...]

$ npm run health:ask -- "what about the week before?" --continue
[Hayden's follow-up, referencing the prior analysis...]
```

The `--continue` flag tells the orchestrator to include the previous query's final output as conversation context for the new Hayden draft call. This enables natural conversational threading without re-running the full data context builder. The `--continue` context is ephemeral (current terminal session only) — long-term continuity is handled by session memory.

### Automated (Periodic Reports)

Scheduled via launchd on Mac Mini:

- **Daily briefing (morning):** Last night's sleep, yesterday's activity, anything notable in the last 24-48 hours
- **Weekly deep dive (Sunday evening):** Trends across the week, cross-source patterns, medium/long-term observations, go-deeper suggestions for the week ahead

The script assembles the data context, runs the full pipeline, and outputs a markdown report.

## Model Selection & Cost

- **Hayden (researcher):** Sonnet or Opus — needs strong reasoning and natural communication
- **Reviewers:** Haiku — focused verification tasks, lower token cost
- Each report = **6 API calls** (1 Hayden draft + 3 parallel reviews + 1 Hayden revision + 1 self-reflection). Prompt caching on the revision call reduces cost since it shares context with the draft.

### Estimated Cost Per Run

Assuming ~4K tokens data context, ~1K token responses per agent:
- **Hayden (Sonnet):** ~$0.02-0.04 per run (draft + revision)
- **3x Reviewers (Haiku):** ~$0.003 total
- **Self-reflection (Haiku):** ~$0.001
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
