const ACTIVITY_TYPE_MAP: Record<string, string> = {
  'HKWorkoutActivityTypeRunning': 'running',
  'HKWorkoutActivityTypeCycling': 'cycling',
  'HKWorkoutActivityTypeSwimming': 'swimming',
  'HKWorkoutActivityTypeWalking': 'walking',
  'HKWorkoutActivityTypeHiking': 'hiking',
  'HKWorkoutActivityTypeYoga': 'yoga',
  'HKWorkoutActivityTypeStrengthTraining': 'strength_training',
  'HKWorkoutActivityTypeHighIntensityIntervalTraining': 'hiit',
  'HKWorkoutActivityTypeElliptical': 'elliptical',
  'HKWorkoutActivityTypeRowing': 'rowing',
  'HKWorkoutActivityTypeCoreTraining': 'core_training',
  'HKWorkoutActivityTypeFunctionalStrengthTraining': 'functional_strength',
  'HKWorkoutActivityTypeDance': 'dance',
  'HKWorkoutActivityTypeCooldown': 'cooldown',
  'HKWorkoutActivityTypeSocialDance': 'social_dance',
  'HKWorkoutActivityTypePickleball': 'pickleball',
  'HKWorkoutActivityTypeTennis': 'tennis',
  'HKWorkoutActivityTypeBarre': 'barre',
  'HKWorkoutActivityTypePilates': 'pilates',
  'HKWorkoutActivityTypeMindAndBody': 'mind_and_body',
};

export function normalizeActivityType(raw: string): string {
  return ACTIVITY_TYPE_MAP[raw]
    ?? raw.replace('HKWorkoutActivityType', '').toLowerCase();
}
