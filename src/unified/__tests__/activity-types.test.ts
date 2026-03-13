import { describe, it, expect } from 'vitest';
import { normalizeActivityType } from '../activity-types.js';

describe('normalizeActivityType', () => {
  it('maps known HK workout types to readable names', () => {
    expect(normalizeActivityType('HKWorkoutActivityTypeRunning')).toBe('running');
    expect(normalizeActivityType('HKWorkoutActivityTypeStrengthTraining')).toBe('strength_training');
    expect(normalizeActivityType('HKWorkoutActivityTypeHighIntensityIntervalTraining')).toBe('hiit');
    expect(normalizeActivityType('HKWorkoutActivityTypePickleball')).toBe('pickleball');
  });

  it('falls back to stripping prefix and lowercasing for unknown types', () => {
    expect(normalizeActivityType('HKWorkoutActivityTypeSkateboarding')).toBe('skateboarding');
    expect(normalizeActivityType('HKWorkoutActivityTypeArchery')).toBe('archery');
  });

  it('passes through Oura activity types unchanged', () => {
    expect(normalizeActivityType('running')).toBe('running');
    expect(normalizeActivityType('cycling')).toBe('cycling');
    expect(normalizeActivityType('walking')).toBe('walking');
  });
});
