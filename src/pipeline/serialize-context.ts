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
    sections.push(`## ANOMALIES DETECTED`);
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
