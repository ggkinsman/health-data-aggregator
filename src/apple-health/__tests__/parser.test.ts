import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseAppleHealthExport, normalizeTimestamp, extractTimezoneOffset } from '../parser.js';
import type { AppleHealthRecord, AppleHealthWorkout } from '../types.js';

function writeTempXml(content: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-test-'));
  const filePath = path.join(tmpDir, 'export.xml');
  fs.writeFileSync(filePath, content);
  return filePath;
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n<HealthData>\n';
const XML_FOOTER = '\n</HealthData>';

function wrapXml(body: string): string {
  return XML_HEADER + body + XML_FOOTER;
}

describe('normalizeTimestamp', () => {
  it('converts Apple Health format to ISO 8601', () => {
    expect(normalizeTimestamp('2024-01-15 08:30:00 -0500'))
      .toBe('2024-01-15T13:30:00.000Z');
  });

  it('handles UTC offset', () => {
    expect(normalizeTimestamp('2024-06-01 12:00:00 +0000'))
      .toBe('2024-06-01T12:00:00.000Z');
  });

  it('handles positive offset', () => {
    expect(normalizeTimestamp('2024-03-15 22:00:00 +0530'))
      .toBe('2024-03-15T16:30:00.000Z');
  });

  it('returns raw string if format is unrecognized', () => {
    expect(normalizeTimestamp('2024-01-15T08:30:00Z'))
      .toBe('2024-01-15T08:30:00Z');
  });
});

describe('extractTimezoneOffset', () => {
  it('extracts offset from Apple Health timestamp', () => {
    expect(extractTimezoneOffset('2024-01-15 08:30:00 -0500')).toBe('-0500');
    expect(extractTimezoneOffset('2024-06-20 14:00:00 +0100')).toBe('+0100');
  });

  it('returns undefined for missing or invalid input', () => {
    expect(extractTimezoneOffset(undefined)).toBeUndefined();
    expect(extractTimezoneOffset('')).toBeUndefined();
    expect(extractTimezoneOffset('2024-01-15T08:30:00Z')).toBeUndefined();
  });
});

describe('parseAppleHealthExport', () => {
  it('rejects if file does not exist', async () => {
    await expect(
      parseAppleHealthExport('/nonexistent.xml', () => {}, () => {})
    ).rejects.toThrow('File not found');
  });

  it('rejects if file is not .xml', async () => {
    const tmpFile = path.join(os.tmpdir(), 'test.json');
    fs.writeFileSync(tmpFile, '{}');
    try {
      await expect(
        parseAppleHealthExport(tmpFile, () => {}, () => {})
      ).rejects.toThrow('File must be .xml');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('parses Record attributes correctly', async () => {
    const xml = wrapXml(`
      <Record type="HKQuantityTypeIdentifierHeartRate"
              sourceName="Apple Watch"
              sourceVersion="10.0"
              unit="count/min"
              value="72"
              startDate="2024-01-15 08:30:00 -0500"
              endDate="2024-01-15 08:30:00 -0500"
              creationDate="2024-01-15 08:30:05 -0500"
              device="Apple Watch"/>
    `);
    const filePath = writeTempXml(xml);

    const records: AppleHealthRecord[] = [];
    await parseAppleHealthExport(
      filePath,
      (batch) => records.push(...batch),
      () => {}
    );

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      type: 'HKQuantityTypeIdentifierHeartRate',
      sourceName: 'Apple Watch',
      sourceVersion: '10.0',
      unit: 'count/min',
      value: '72',
      startDate: '2024-01-15T13:30:00.000Z',
      endDate: '2024-01-15T13:30:00.000Z',
      creationDate: '2024-01-15T13:30:05.000Z',
      device: 'Apple Watch',
    });
  });

  it('filters records by type', async () => {
    const xml = wrapXml(`
      <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Watch" startDate="2024-01-15 08:00:00 -0500" endDate="2024-01-15 08:00:00 -0500" value="72" unit="count/min"/>
      <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Phone" startDate="2024-01-15 09:00:00 -0500" endDate="2024-01-15 09:00:00 -0500" value="100" unit="count"/>
      <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Watch" startDate="2024-01-15 10:00:00 -0500" endDate="2024-01-15 10:00:00 -0500" value="45" unit="ms"/>
    `);
    const filePath = writeTempXml(xml);

    const records: AppleHealthRecord[] = [];
    await parseAppleHealthExport(
      filePath,
      (batch) => records.push(...batch),
      () => {}
    );

    expect(records).toHaveLength(2);
    expect(records.map((r) => r.type)).toEqual([
      'HKQuantityTypeIdentifierHeartRate',
      'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
    ]);
  });

  it('parses Workout with child elements', async () => {
    const xml = wrapXml(`
      <Workout workoutActivityType="HKWorkoutActivityTypeRunning"
               sourceName="Apple Watch"
               startDate="2024-01-15 07:00:00 -0500"
               endDate="2024-01-15 07:45:00 -0500"
               duration="45.23"
               durationUnit="min"
               totalDistance="5.12"
               totalDistanceUnit="km"
               totalEnergyBurned="350"
               totalEnergyBurnedUnit="Cal">
        <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="145" minimum="110" maximum="175" unit="count/min"/>
        <WorkoutEvent type="HKWorkoutEventTypePause" startDate="2024-01-15 07:20:00 -0500" endDate="2024-01-15 07:22:00 -0500"/>
      </Workout>
    `);
    const filePath = writeTempXml(xml);

    const workouts: AppleHealthWorkout[] = [];
    await parseAppleHealthExport(
      filePath,
      () => {},
      (batch) => workouts.push(...batch)
    );

    expect(workouts).toHaveLength(1);
    const w = workouts[0];
    expect(w.activityType).toBe('HKWorkoutActivityTypeRunning');
    expect(w.duration).toBeCloseTo(45.23);
    expect(w.totalDistance).toBeCloseTo(5.12);
    expect(w.totalEnergyBurned).toBe(350);
    expect(w.statistics).toHaveLength(1);
    expect(w.statistics[0]).toMatchObject({
      type: 'HKQuantityTypeIdentifierHeartRate',
      average: '145',
      minimum: '110',
      maximum: '175',
    });
    expect(w.events).toHaveLength(1);
    expect(w.events[0].type).toBe('HKWorkoutEventTypePause');
    expect(w.events[0].startDate).toBe('2024-01-15T12:20:00.000Z');
  });

  it('emits batches at correct size', async () => {
    const records = Array.from({ length: 12 }, (_, i) =>
      `<Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Watch" startDate="2024-01-15 0${Math.floor(i / 10)}:${String(i % 60).padStart(2, '0')}:00 -0500" endDate="2024-01-15 0${Math.floor(i / 10)}:${String(i % 60).padStart(2, '0')}:00 -0500" value="${60 + i}" unit="count/min"/>`
    ).join('\n');
    const filePath = writeTempXml(wrapXml(records));

    const batchSizes: number[] = [];
    await parseAppleHealthExport(
      filePath,
      (batch) => batchSizes.push(batch.length),
      () => {},
      { batchSize: 5 }
    );

    // 12 records with batchSize 5: batches of 5, 5, 2
    expect(batchSizes).toEqual([5, 5, 2]);
  });

  it('returns accurate ParseSummary', async () => {
    const xml = wrapXml(`
      <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Watch" startDate="2024-01-15 08:00:00 -0500" endDate="2024-01-15 08:00:00 -0500" value="72" unit="count/min"/>
      <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Phone" startDate="2024-01-15 23:00:00 -0500" endDate="2024-01-16 07:00:00 -0500" value="HKCategoryValueSleepAnalysisAsleepCore"/>
      <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Phone" startDate="2024-01-15 09:00:00 -0500" endDate="2024-01-15 09:00:00 -0500" value="500" unit="count"/>
      <Workout workoutActivityType="HKWorkoutActivityTypeRunning" sourceName="Watch" startDate="2024-01-15 07:00:00 -0500" endDate="2024-01-15 07:30:00 -0500"/>
    `);
    const filePath = writeTempXml(xml);

    const summary = await parseAppleHealthExport(
      filePath,
      () => {},
      () => {}
    );

    // 3 Records + 1 Workout = 4 totalProcessed
    expect(summary.totalProcessed).toBe(4);
    expect(summary.recordCounts).toEqual({
      HKQuantityTypeIdentifierHeartRate: 1,
      HKCategoryTypeIdentifierSleepAnalysis: 1,
    });
    expect(summary.workoutCount).toBe(1);
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });
});
