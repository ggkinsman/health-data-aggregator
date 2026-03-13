export const VIEW_UNIFIED_HEART_RATE = `
CREATE VIEW IF NOT EXISTS v_unified_heart_rate AS
SELECT
  'oura' AS source,
  timestamp,
  bpm,
  source AS context
FROM oura_heart_rate

UNION ALL

SELECT
  'apple_health' AS source,
  start_date AS timestamp,
  CAST(value AS INTEGER) AS bpm,
  'watch' AS context
FROM apple_health_records
WHERE type = 'HKQuantityTypeIdentifierHeartRate';
`;

export const VIEW_UNIFIED_WORKOUTS = `
CREATE VIEW IF NOT EXISTS v_unified_workouts AS
SELECT
  'oura' AS source,
  json_extract(raw_json, '$.activity') AS activity_type,
  json_extract(raw_json, '$.start_datetime') AS start_date,
  json_extract(raw_json, '$.end_datetime') AS end_date,
  ROUND(
    (julianday(json_extract(raw_json, '$.end_datetime'))
     - julianday(json_extract(raw_json, '$.start_datetime'))) * 1440,
    1
  ) AS duration_minutes,
  json_extract(raw_json, '$.distance') AS distance_meters,
  json_extract(raw_json, '$.calories') AS calories,
  json_extract(raw_json, '$.heart_rate.average') AS avg_hr,
  json_extract(raw_json, '$.heart_rate.maximum') AS max_hr
FROM oura_workouts

UNION ALL

SELECT
  'apple_health' AS source,
  activity_type,
  start_date,
  end_date,
  duration AS duration_minutes,
  total_distance AS distance_meters,
  total_energy_burned AS calories,
  NULL AS avg_hr,
  NULL AS max_hr
FROM apple_health_workouts;
`;

export const VIEW_UNIFIED_SLEEP = `
CREATE VIEW IF NOT EXISTS v_unified_sleep AS
SELECT
  'oura' AS source,
  day,
  json_extract(raw_json, '$.bedtime_start') AS bedtime_start,
  json_extract(raw_json, '$.bedtime_end') AS bedtime_end,
  ROUND(json_extract(raw_json, '$.total_sleep_duration') / 60.0) AS total_sleep_minutes,
  ROUND(json_extract(raw_json, '$.deep_sleep_duration') / 60.0) AS deep_sleep_minutes,
  ROUND(json_extract(raw_json, '$.rem_sleep_duration') / 60.0) AS rem_sleep_minutes,
  ROUND(json_extract(raw_json, '$.light_sleep_duration') / 60.0) AS light_sleep_minutes,
  json_extract(raw_json, '$.average_heart_rate') AS avg_hr,
  json_extract(raw_json, '$.average_hrv') AS avg_hrv,
  json_extract(raw_json, '$.score') AS score
FROM oura_sleep_sessions

UNION ALL

SELECT
  'apple_health' AS source,
  DATE(start_date) AS day,
  start_date AS bedtime_start,
  end_date AS bedtime_end,
  ROUND((julianday(end_date) - julianday(start_date)) * 1440) AS total_sleep_minutes,
  NULL AS deep_sleep_minutes,
  NULL AS rem_sleep_minutes,
  NULL AS light_sleep_minutes,
  NULL AS avg_hr,
  NULL AS avg_hrv,
  NULL AS score
FROM apple_health_records
WHERE type = 'HKCategoryTypeIdentifierSleepAnalysis'
  AND value = 'HKCategoryValueSleepAnalysisInBed';
`;

export const VIEW_UNIFIED_HRV = `
CREATE VIEW IF NOT EXISTS v_unified_hrv AS
SELECT
  'oura' AS source,
  day,
  json_extract(raw_json, '$.average_hrv') AS hrv_ms
FROM oura_sleep_sessions
WHERE json_extract(raw_json, '$.average_hrv') IS NOT NULL

UNION ALL

SELECT
  'apple_health' AS source,
  DATE(start_date) AS day,
  CAST(value AS REAL) AS hrv_ms
FROM apple_health_records
WHERE type = 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN';
`;
