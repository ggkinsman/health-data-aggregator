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
        tags: ['alcohol', 'magnesium'],
        sources: 'apple_health,oura',
      }],
      mediumTerm: { days: 30, metrics: {} },
      longTerm: [],
      yearOverYear: [],
      anomalies: [],
      sourceCoverage: {
        oura: { earliest: '2025-12-01', latest: '2026-03-13' },
        appleHealth: { earliest: '2025-12-01', latest: '2026-03-13' },
        cpap: { earliest: null, latest: null },
      },
      staleness: { lastSyncAt: '2026-03-13T08:00:00Z', isStale: false },
    };

    const text = serializeContext(ctx);
    expect(text).toContain('2026-03-13');
    expect(text).toContain('420');
    expect(text).toContain('oura');
    expect(text).toContain('Tags: alcohol, magnesium');
  });

  it('includes anomaly section when anomalies present', () => {
    const ctx: DataContext = {
      timeRange: { earliest: '2025-12-01', latest: '2026-03-13' },
      shortTerm: [],
      mediumTerm: { days: 30, metrics: {} },
      longTerm: [],
      yearOverYear: [],
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
      staleness: { lastSyncAt: null, isStale: true },
    };

    const text = serializeContext(ctx);
    expect(text).toContain('ANOMAL');
    expect(text).toContain('72');
    expect(text).toContain('5.7');
  });
});
