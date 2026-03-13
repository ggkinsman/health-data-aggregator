import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js';

// --- Data Context ---

export interface DataContext {
  timeRange: { earliest: string; latest: string };
  shortTerm: DaySnapshot[];      // last 3 days
  mediumTerm: TrendSummary;      // last 30 days
  longTerm: MonthlyAverage[];    // last 6 months
  yearOverYear: YearOverYearComparison[];  // same-month comparisons
  anomalies: Anomaly[];
  sourceCoverage: SourceCoverage;
  staleness: { lastSyncAt: string | null; isStale: boolean };  // >48h = stale
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

export interface YearOverYearComparison {
  month: string;       // YYYY-MM (current year)
  priorMonth: string;  // YYYY-MM (prior year)
  metrics: Record<string, { current: number | null; prior: number | null; changePercent: number | null }>;
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

// Re-export MessageParam so pipeline modules can use it without importing the SDK directly
export type { MessageParam };
