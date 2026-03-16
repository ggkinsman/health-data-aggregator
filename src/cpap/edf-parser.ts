import * as fs from 'node:fs';
import type { CPAPSession } from './types.js';

// ResMed stores dates as days since Unix epoch (1970-01-01)
const RESMED_EPOCH = new Date('1970-01-01T00:00:00Z').getTime();
const MS_PER_DAY = 86400000;

/**
 * Parse a ResMed STR.edf file and return one CPAPSession per valid night.
 * A valid night has usage_minutes > 0.
 */
export function parseSTREdf(filePath: string): CPAPSession[] {
  const buf = fs.readFileSync(filePath);

  // --- File header (256 bytes) ---
  const numRecords  = parseInt(buf.subarray(236, 244).toString('ascii').trim(), 10);
  const numSignals  = parseInt(buf.subarray(252, 256).toString('ascii').trim(), 10);
  const headerBytes = parseInt(buf.subarray(184, 192).toString('ascii').trim(), 10);

  // --- Signal headers ---
  // Field sizes per signal (label, transducer, phys_dim, phys_min, phys_max,
  // dig_min, dig_max, prefilter, num_samples, reserved):
  const fieldSizes = [16, 80, 8, 8, 8, 8, 8, 80, 8, 32];
  const fieldStarts: number[] = [0];
  for (const size of fieldSizes) {
    fieldStarts.push(fieldStarts[fieldStarts.length - 1] + size * numSignals);
  }

  const sigHeader = buf.subarray(256, headerBytes);

  function getField(fieldIdx: number, fieldLen: number): string[] {
    const start = fieldStarts[fieldIdx];
    return Array.from({ length: numSignals }, (_, i) =>
      sigHeader
        .subarray(start + i * fieldLen, start + (i + 1) * fieldLen)
        .toString('ascii')
        .trim()
    );
  }

  const labels   = getField(0, 16);
  const physMins = getField(3, 8).map(Number);
  const physMaxs = getField(4, 8).map(Number);
  const digMins  = getField(5, 8).map(Number);
  const digMaxs  = getField(6, 8).map(Number);
  const numSamps = getField(8, 8).map(Number);

  // Scale factor: maps raw int16 → physical value
  const gains = physMins.map((pMin, i) => {
    const dRange = digMaxs[i] - digMins[i];
    return dRange !== 0 ? (physMaxs[i] - pMin) / dRange : 1;
  });
  const offsets = physMins.map((pMin, i) => pMin - gains[i] * digMins[i]);

  // --- Read all records ---
  const sessions: CPAPSession[] = [];
  let pos = headerBytes;

  for (let r = 0; r < numRecords; r++) {
    const record: Record<string, number> = {};

    for (let i = 0; i < numSignals; i++) {
      const n = numSamps[i];
      if (n === 0) continue;
      // Read first sample (STR.edf daily summaries use n=1 for scalar signals)
      const raw = buf.readInt16LE(pos);
      record[labels[i]] = gains[i] * raw + offsets[i];
      pos += n * 2;
    }

    const dateVal = record['Date'];
    if (!dateVal || dateVal <= 0) {
      console.warn(`Skipping record ${r}: invalid date value (${dateVal})`);
      continue;
    }

    const usageMinutes = Math.round(record['Duration'] ?? 0);
    if (usageMinutes <= 0) continue;

    const dayMs = RESMED_EPOCH + Math.round(dateVal) * MS_PER_DAY;
    const day = new Date(dayMs).toISOString().split('T')[0];

    sessions.push({
      day,
      usage_minutes:    usageMinutes,
      ahi:              +(record['AHI']          ?? 0).toFixed(2),
      oai:              +(record['OAI']          ?? 0).toFixed(2),
      cai:              +(record['CAI']          ?? 0).toFixed(2),
      hi:               +(record['HI']           ?? 0).toFixed(2),
      uai:              +(record['UAI']          ?? 0).toFixed(2),
      rin:              +(record['RIN']          ?? 0).toFixed(2),
      mask_pressure_50: +(record['MaskPress.50'] ?? 0).toFixed(2),
      mask_pressure_95: +(record['MaskPress.95'] ?? 0).toFixed(2),
      leak_50:          +((record['Leak.50'] ?? 0) * 60).toFixed(2),
      leak_95:          +((record['Leak.95'] ?? 0) * 60).toFixed(2),
      leak_max:         +((record['Leak.Max'] ?? 0) * 60).toFixed(2),
      resp_rate_50:     +(record['RespRate.50']  ?? 0).toFixed(1),
      tidal_vol_50:     +(record['TidVol.50']    ?? 0).toFixed(3),
      min_vent_50:      +(record['MinVent.50']   ?? 0).toFixed(2),
      csr_minutes:      Math.round(record['CSR'] ?? 0),
      mask_events:      Math.round(record['MaskEvents'] ?? 0),
    });
  }

  return sessions;
}
