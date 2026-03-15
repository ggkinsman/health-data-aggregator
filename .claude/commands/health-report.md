---
allowed-tools: Bash, Read
description: Generate a local health report (daily or weekly) by querying SQLite directly — no API calls
---

# Health Report Generator

Generate a health report by querying `data/health.db` directly with `sqlite3`. No Anthropic API calls.

**Argument:** `$ARGUMENTS` (expects `daily` or `weekly`, defaults to `weekly`)

## Patient Context

Include in all DoxGPT questions: 32-year-old male, severe OSA (baseline pAHI 50, central apnea index 5.8, RDI 62.2/hr from April 2025 Lofta home sleep test), on APAP therapy (ResMed AirSense 11 AutoSet) since July 2025.

## Data Collection

Query `data/health.db` using `sqlite3` via the Bash tool. Run these queries in parallel:

### Core queries (both report types)
1. **Last 7 days detail:** `daily_summary d LEFT JOIN cpap_sessions c ON d.day = c.day` — all columns, ordered by day
2. **Prior 4 weeks baseline:** Same join, averaged metrics for the 28 days before this week
3. **Current CPAP settings:** `cpap_device_settings` — the active pressure range
4. **Workouts this week:** `apple_health_workouts` joined to daily_summary, Apple Watch source only
5. **2026 baselines:** Average HRV, RHR, sleep score, deep sleep from `daily_summary` since Jan 1

### Weekly-only queries
6. **Monthly trend (3 months):** Monthly averages from cpap_sessions and daily_summary
7. **AHI distribution this month:** Count nights by AHI bucket (0-2, 2-5, 5-10, 10+)

## Report Generation

### If `daily`
Follow the template in `prompts/report-templates/daily-briefing.md`. Focus on last night + yesterday. Keep it to 200-400 words.

### If `weekly` (default)
Follow the template in `prompts/report-templates/weekly-deep-dive.md`. Cover the full week with medium-term context. Aim for 600-1000 words.

## DoxGPT Questions

For every report, generate verification questions per the template instructions. Each question MUST be fully self-contained and copy-paste ready — include:
- Full patient profile (age, diagnosis, treatment details, current pressure settings from the data)
- Specific numbers from this report
- The exact claim or interpretation being validated
- Timeframe of the data

## Quality Checks

Before presenting the report:
- Flag any days with suspiciously low Oura sleep data (<60 min) but normal CPAP usage — likely ring sensor failure, not actual poor sleep
- Cross-check CPAP usage_minutes against Oura total_sleep_minutes for consistency
- Note any missing data sources (check the `sources` column in daily_summary)
- All numbers must come from actual query results — never estimate or fabricate values
