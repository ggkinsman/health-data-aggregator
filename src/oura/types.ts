/**
 * Oura API OAuth2 types
 */

export interface OuraOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface OuraTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
  tokenType: string;
  scope: string;
}

export interface OuraTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds until expiration
  token_type: string;
  scope: string;
}

export type OuraScope =
  | 'personal'
  | 'daily'
  | 'heartrate'
  | 'workout'
  | 'tag'
  | 'session'
  | 'spo2';

export const ALL_OURA_SCOPES: OuraScope[] = [
  'personal',
  'daily',
  'heartrate',
  'workout',
  'tag',
  'session',
  'spo2',
];

export interface OuraAuthError {
  error: string;
  error_description?: string;
}

export class OuraAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public errorCode?: string
  ) {
    super(message);
    this.name = 'OuraAPIError';
  }
}

export class OuraMembershipError extends OuraAPIError {
  constructor(message: string = 'Oura membership required to access API') {
    super(message, 403, 'membership_required');
    this.name = 'OuraMembershipError';
  }
}

export class OuraTokenExpiredError extends OuraAPIError {
  constructor(message: string = 'Access token has expired') {
    super(message, 401, 'token_expired');
    this.name = 'OuraTokenExpiredError';
  }
}

/**
 * Oura API v2 Data Types
 */

export interface DateRangeQuery {
  start_date?: string; // YYYY-MM-DD
  end_date?: string; // YYYY-MM-DD
}

// Daily Readiness
export interface DailyReadinessContributors {
  activity_balance?: number;
  body_temperature?: number;
  hrv_balance?: number;
  previous_day_activity?: number;
  previous_night?: number;
  recovery_index?: number;
  resting_heart_rate?: number;
  sleep_balance?: number;
}

export interface DailyReadiness {
  id: string;
  day: string; // YYYY-MM-DD
  score?: number;
  temperature_deviation?: number;
  temperature_trend_deviation?: number;
  contributors?: DailyReadinessContributors;
}

export interface DailyReadinessResponse {
  data: DailyReadiness[];
}

// Daily Sleep
export interface DailySleepContributors {
  deep_sleep?: number;
  efficiency?: number;
  latency?: number;
  rem_sleep?: number;
  restfulness?: number;
  timing?: number;
  total_sleep?: number;
}

export interface DailySleep {
  id: string;
  day: string; // YYYY-MM-DD
  score?: number;
  contributors?: DailySleepContributors;
}

export interface DailySleepResponse {
  data: DailySleep[];
}

// Daily Activity
export interface DailyActivity {
  id: string;
  class_5_min?: string;
  score?: number;
  active_calories?: number;
  average_met_minutes?: number;
  contributors?: {
    meet_daily_targets?: number;
    move_every_hour?: number;
    recovery_time?: number;
    stay_active?: number;
    training_frequency?: number;
    training_volume?: number;
  };
  equivalent_walking_distance?: number;
  high_activity_met_minutes?: number;
  high_activity_time?: number;
  inactivity_alierts?: number;
  low_activity_met_minutes?: number;
  low_activity_time?: number;
  medium_activity_met_minutes?: number;
  medium_activity_time?: number;
  met?: {
    interval: number;
    items: number[];
    timestamp: string;
  };
  meters_to_target?: number;
  resting_time?: number;
  sedentary_met_minutes?: number;
  sedentary_time?: number;
  steps?: number;
  target_calories?: number;
  target_meters?: number;
  target_steps?: number;
  total_calories?: number;
  day: string; // YYYY-MM-DD
}

export interface DailyActivityResponse {
  data: DailyActivity[];
}

// Sleep Session (Detailed)
export interface SleepHeartRate {
  interval: number;
  items: number[];
  timestamp: string;
}

export interface SleepHRV {
  interval: number;
  items: number[];
  timestamp: string;
}

export interface SleepSession {
  id: string;
  contributors?: {
    deep_sleep?: number;
    efficiency?: number;
    latency?: number;
    rem_sleep?: number;
    restfulness?: number;
    timing?: number;
    total_sleep?: number;
  };
  day: string; // YYYY-MM-DD
  score?: number;
  timestamp: string;
  bedtime_start?: string;
  bedtime_end?: string;
  time_in_bed?: number;
  total_sleep_duration?: number;
  awake_time?: number;
  light_sleep_duration?: number;
  rem_sleep_duration?: number;
  deep_sleep_duration?: number;
  restless_periods?: number;
  average_breath?: number;
  average_heart_rate?: number;
  lowest_heart_rate?: number;
  highest_heart_rate?: number;
  average_hrv?: number;
  temperature_deviation?: number;
  bedtime_start_delta?: number;
  bedtime_end_delta?: number;
  midpoint_time_delta?: number;
  temperature_trend_deviation?: number;
  sleep_phase_5_min?: string;
  heart_rate?: SleepHeartRate;
  hrv?: SleepHRV;
}

export interface SleepSessionResponse {
  data: SleepSession[];
}

// Heart Rate
export interface HeartRate {
  bpm: number;
  source: 'awake' | 'rest' | 'session' | 'workout';
  timestamp: string;
}

export interface HeartRateResponse {
  data: HeartRate[];
}

// Workout
export interface Workout {
  id: string;
  activity: string;
  calories?: number;
  day: string; // YYYY-MM-DD
  distance?: number;
  end_datetime?: string;
  intensity?: 'easy' | 'moderate' | 'hard';
  label?: string;
  source: 'manual' | 'autodetected' | 'confirmed';
  start_datetime: string;
  heart_rate?: {
    average?: number;
    maximum?: number;
    resting?: number;
  };
}

export interface WorkoutResponse {
  data: Workout[];
}

// Session
export interface Session {
  id: string;
  day: string; // YYYY-MM-DD
  start_datetime: string;
  end_datetime?: string;
  type: 'breathing' | 'meditation' | 'nap' | 'relaxation' | 'rest' | 'body_status';
  heart_rate?: {
    interval: number;
    items: number[];
    timestamp: string;
  };
  heart_rate_variability?: {
    interval: number;
    items: number[];
    timestamp: string;
  };
  mood?: 'bad' | 'worse' | 'same' | 'good' | 'great';
  movement?: number;
}

export interface SessionResponse {
  data: Session[];
}

// Tag
export interface Tag {
  id: string;
  day: string; // YYYY-MM-DD
  text: string;
  tags: string[];
}

export interface TagResponse {
  data: Tag[];
}

// Personal Info
export interface PersonalInfo {
  age?: number;
  weight?: number;
  height?: number;
  biological_sex?: 'male' | 'female' | 'other' | 'not_specified';
  email?: string;
}

export interface PersonalInfoResponse {
  data: PersonalInfo;
}
