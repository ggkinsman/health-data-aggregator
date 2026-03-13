import { createReadStream, existsSync } from 'fs';
import sax from 'sax';
import type {
  AppleHealthRecord,
  AppleHealthWorkout,
  WorkoutStatistic,
  ParseSummary,
} from './types.js';

const RECORD_TYPES = new Set([
  'HKCategoryTypeIdentifierSleepAnalysis',
  'HKQuantityTypeIdentifierHeartRate',
  'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  'HKQuantityTypeIdentifierRestingHeartRate',
]);

const DEFAULT_BATCH_SIZE = 5000;
const PROGRESS_INTERVAL = 50000;

/**
 * Normalize Apple Health timestamp format to ISO 8601.
 * Input:  "2024-01-15 08:30:00 -0500"
 * Output: "2024-01-15T13:30:00.000Z"
 */
export function normalizeTimestamp(raw: string | undefined): string {
  if (!raw) return '';
  const match = raw.match(
    /^(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}:\d{2})\s([+-]\d{4})$/
  );
  if (!match) {
    return raw;
  }
  const [, date, time, tz] = match;
  const tzFormatted = tz.slice(0, 3) + ':' + tz.slice(3);
  return new Date(`${date}T${time}${tzFormatted}`).toISOString();
}

/**
 * Extract the timezone offset from an Apple Health timestamp.
 * Input:  "2024-01-15 08:30:00 -0500"
 * Output: "-0500"
 */
export function extractTimezoneOffset(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/([+-]\d{4})$/);
  return match ? match[1] : undefined;
}

/**
 * Stream-parse an Apple Health export.xml, emitting batches of records and workouts.
 */
export function parseAppleHealthExport(
  filePath: string,
  onRecordBatch: (records: AppleHealthRecord[]) => void,
  onWorkoutBatch: (workouts: AppleHealthWorkout[]) => void,
  options?: { batchSize?: number }
): Promise<ParseSummary> {
  if (!existsSync(filePath)) {
    return Promise.reject(new Error(`File not found: ${filePath}`));
  }
  if (!filePath.endsWith('.xml')) {
    return Promise.reject(new Error(`File must be .xml: ${filePath}`));
  }

  const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
  const startTime = Date.now();

  let totalProcessed = 0;
  const recordCounts: Record<string, number> = {};
  let workoutCount = 0;

  let recordBatch: AppleHealthRecord[] = [];
  let workoutBatch: AppleHealthWorkout[] = [];

  // Workout parsing state
  let currentWorkout: AppleHealthWorkout | null = null;

  return new Promise((resolve, reject) => {
    const saxStream = sax.createStream(true);
    const fileStream = createReadStream(filePath);

    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      fileStream.destroy();
      reject(err);
    };

    saxStream.on('opentag', (node) => {
      try {
        if (node.name === 'Record') {
          totalProcessed++;
          if (totalProcessed % PROGRESS_INTERVAL === 0) {
            console.log(`Progress: ${totalProcessed.toLocaleString()} records processed...`);
          }

          const type = node.attributes.type as string;
          if (!RECORD_TYPES.has(type)) return;

          recordCounts[type] = (recordCounts[type] ?? 0) + 1;

          // Capture raw startDate before normalization (for timezone extraction)
          const rawStartDate = node.attributes.startDate as string;

          const record: AppleHealthRecord = {
            type,
            sourceName: node.attributes.sourceName as string,
            startDate: normalizeTimestamp(rawStartDate),
            endDate: normalizeTimestamp(node.attributes.endDate as string),
          };
          if (node.attributes.sourceVersion) record.sourceVersion = node.attributes.sourceVersion as string;
          if (node.attributes.unit) record.unit = node.attributes.unit as string;
          if (node.attributes.value) record.value = node.attributes.value as string;
          if (node.attributes.device) record.device = node.attributes.device as string;
          if (node.attributes.creationDate) record.creationDate = normalizeTimestamp(node.attributes.creationDate as string);
          const tzOffset = extractTimezoneOffset(rawStartDate);
          if (tzOffset) record.timezoneOffset = tzOffset;

          recordBatch.push(record);
          if (recordBatch.length >= batchSize) {
            onRecordBatch(recordBatch);
            recordBatch = [];
          }
        } else if (node.name === 'Workout') {
          totalProcessed++;

          currentWorkout = {
            activityType: node.attributes.workoutActivityType as string,
            sourceName: node.attributes.sourceName as string,
            startDate: normalizeTimestamp(node.attributes.startDate as string),
            endDate: normalizeTimestamp(node.attributes.endDate as string),
            statistics: [],
            events: [],
          };
          if (node.attributes.duration) currentWorkout.duration = parseFloat(node.attributes.duration as string);
          if (node.attributes.durationUnit) currentWorkout.durationUnit = node.attributes.durationUnit as string;
          if (node.attributes.totalDistance) currentWorkout.totalDistance = parseFloat(node.attributes.totalDistance as string);
          if (node.attributes.totalDistanceUnit) currentWorkout.totalDistanceUnit = node.attributes.totalDistanceUnit as string;
          if (node.attributes.totalEnergyBurned) currentWorkout.totalEnergyBurned = parseFloat(node.attributes.totalEnergyBurned as string);
          if (node.attributes.totalEnergyBurnedUnit) currentWorkout.totalEnergyBurnedUnit = node.attributes.totalEnergyBurnedUnit as string;
        } else if (node.name === 'WorkoutStatistics' && currentWorkout) {
          const stat: WorkoutStatistic = {
            type: node.attributes.type as string,
          };
          if (node.attributes.sum) stat.sum = node.attributes.sum as string;
          if (node.attributes.average) stat.average = node.attributes.average as string;
          if (node.attributes.minimum) stat.minimum = node.attributes.minimum as string;
          if (node.attributes.maximum) stat.maximum = node.attributes.maximum as string;
          if (node.attributes.unit) stat.unit = node.attributes.unit as string;
          currentWorkout.statistics.push(stat);
        } else if (node.name === 'WorkoutEvent' && currentWorkout) {
          currentWorkout.events.push({
            type: node.attributes.type as string,
            startDate: normalizeTimestamp(node.attributes.startDate as string),
            endDate: normalizeTimestamp(node.attributes.endDate as string),
          });
        }
      } catch (err) {
        fail(err as Error);
      }
    });

    saxStream.on('closetag', (name) => {
      try {
        if (name === 'Workout' && currentWorkout) {
          workoutCount++;
          workoutBatch.push(currentWorkout);
          currentWorkout = null;
          if (workoutBatch.length >= batchSize) {
            onWorkoutBatch(workoutBatch);
            workoutBatch = [];
          }
        }
      } catch (err) {
        fail(err as Error);
      }
    });

    saxStream.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        // Flush remaining batches
        if (recordBatch.length > 0) onRecordBatch(recordBatch);
        if (workoutBatch.length > 0) onWorkoutBatch(workoutBatch);

        resolve({
          totalProcessed,
          recordCounts,
          workoutCount,
          durationMs: Date.now() - startTime,
        });
      } catch (err) {
        reject(err as Error);
      }
    });

    saxStream.on('error', (err) => fail(err));
    fileStream.on('error', (err) => fail(err));
    fileStream.pipe(saxStream);
  });
}
