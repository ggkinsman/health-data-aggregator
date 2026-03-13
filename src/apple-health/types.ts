export interface AppleHealthRecord {
  type: string;
  sourceName: string;
  sourceVersion?: string;
  unit?: string;
  value?: string;
  startDate: string;
  endDate: string;
  device?: string;
  creationDate?: string;
  timezoneOffset?: string;
}

export interface AppleHealthWorkout {
  activityType: string;
  sourceName: string;
  startDate: string;
  endDate: string;
  duration?: number;
  durationUnit?: string;
  totalDistance?: number;
  totalDistanceUnit?: string;
  totalEnergyBurned?: number;
  totalEnergyBurnedUnit?: string;
  statistics: WorkoutStatistic[];
  events: WorkoutEvent[];
}

export interface WorkoutStatistic {
  type: string;
  sum?: string;
  average?: string;
  minimum?: string;
  maximum?: string;
  unit?: string;
}

export interface WorkoutEvent {
  type: string;
  startDate: string;
  endDate: string;
}

export interface ParseSummary {
  totalProcessed: number;
  recordCounts: Record<string, number>;
  workoutCount: number;
  durationMs: number;
}
