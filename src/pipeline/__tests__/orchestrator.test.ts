import { describe, it, expect } from 'vitest';
import { parseReviewVerdict, buildReviewerDataSubset } from '../orchestrator.js';

describe('parseReviewVerdict', () => {
  it('parses a well-formatted review', () => {
    const text = `## Review: Statistical Analyst
- Verdict: confirmed
- Notes: Numbers check out. Sample size is adequate.
- Suggested edit: None`;

    const verdict = parseReviewVerdict('statistician', text);
    expect(verdict.verdict).toBe('confirmed');
    expect(verdict.notes).toContain('Numbers check out');
    expect(verdict.suggestedEdit).toBeNull();
  });

  it('parses a revise verdict', () => {
    const text = `## Review: Sleep & Recovery Specialist
- Verdict: revise
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
Data range: 2025-12-01 to 2026-03-13

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
