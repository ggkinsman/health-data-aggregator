export interface DailySummary {
  day: string;

  // Oura scores (0-100)
  readiness_score: number | null;
  sleep_score: number | null;
  activity_score: number | null;

  // Sleep (from Oura sleep sessions)
  total_sleep_minutes: number | null;
  deep_sleep_minutes: number | null;
  rem_sleep_minutes: number | null;
  sleep_efficiency: number | null;

  // Heart rate
  avg_resting_hr: number | null;
  min_hr: number | null;
  max_hr: number | null;

  // HRV
  avg_hrv: number | null;

  // Activity (from Oura daily activity)
  steps: number | null;
  active_calories: number | null;

  // Workouts (merged across sources)
  workout_count: number | null;
  workout_minutes: number | null;

  // CPAP (from cpap_sessions, populated by import:cpap + build:summaries)
  cpap_hours: number | null;
  cpap_ahi: number | null;
  cpap_pressure_50: number | null;
  cpap_resp_rate: number | null;
  cpap_cai: number | null;
  cpap_csr_flagged: number | null;  // 0 or 1

  // Travel / location
  timezone_offset: string | null;
  timezone_change: number | null;
  location_label: string | null;

  // Metadata
  sources: string;
  built_at: string;
}

export interface UnifiedHeartRateRow {
  source: string;
  timestamp: string;
  bpm: number;
  context: string;
}

export interface UnifiedWorkoutRow {
  source: string;
  activity_type: string;
  start_date: string;
  end_date: string;
  duration_minutes: number | null;
  distance_meters: number | null;
  calories: number | null;
  avg_hr: number | null;
  max_hr: number | null;
}

export interface UnifiedSleepRow {
  source: string;
  day: string;
  bedtime_start: string | null;
  bedtime_end: string | null;
  total_sleep_minutes: number | null;
  deep_sleep_minutes: number | null;
  rem_sleep_minutes: number | null;
  light_sleep_minutes: number | null;
  avg_hr: number | null;
  avg_hrv: number | null;
  score: number | null;
}

export interface UnifiedHrvRow {
  source: string;
  day: string;
  hrv_ms: number;
}
