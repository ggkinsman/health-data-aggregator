import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadMemory, saveMemory, pruneMemory } from '../session-memory.js';
import type { SessionMemory } from '../types.js';

const TEST_DIR = join(import.meta.dirname, '__fixtures__', 'memory-test');
const MEMORY_PATH = join(TEST_DIR, 'memory.json');

describe('session-memory', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns empty memory when file does not exist', () => {
    const mem = loadMemory(MEMORY_PATH);
    expect(mem.recentFindings).toHaveLength(0);
    expect(mem.openQuestions).toHaveLength(0);
    expect(mem.goals).toHaveLength(0);
  });

  it('saves and loads memory', () => {
    const mem: SessionMemory = {
      lastUpdated: '2026-03-13',
      recentFindings: [{
        date: '2026-03-13',
        insight: 'Deep sleep trending down',
        status: 'open',
        followUp: 'Check next week',
      }],
      openQuestions: ['Does weekend timing affect Monday readiness?'],
      userConcerns: [],
      goals: [],
      baselineSnapshots: { restingHR_90day: 54 },
    };

    saveMemory(MEMORY_PATH, mem);
    const loaded = loadMemory(MEMORY_PATH);
    expect(loaded.recentFindings).toHaveLength(1);
    expect(loaded.recentFindings[0].insight).toBe('Deep sleep trending down');
    expect(loaded.baselineSnapshots['restingHR_90day']).toBe(54);
  });

  it('prunes old resolved findings', () => {
    const mem: SessionMemory = {
      lastUpdated: '2026-03-13',
      recentFindings: [
        { date: '2025-12-01', insight: 'Old finding', status: 'resolved', followUp: '' },
        { date: '2026-03-10', insight: 'Recent finding', status: 'open', followUp: '' },
      ],
      openQuestions: [],
      userConcerns: [],
      goals: [
        {
          goal: 'Old achieved goal',
          setDate: '2025-11-01',
          status: 'achieved',
          baselineValue: '', targetValue: '',
          lastChecked: '2026-01-01',
          progress: 'done',
        },
        {
          goal: 'Active goal',
          setDate: '2026-03-01',
          status: 'active',
          baselineValue: '', targetValue: '',
          lastChecked: '2026-03-13',
          progress: 'in progress',
        },
      ],
      baselineSnapshots: {},
    };

    const pruned = pruneMemory(mem, '2026-03-13');
    expect(pruned.recentFindings).toHaveLength(1);
    expect(pruned.recentFindings[0].insight).toBe('Recent finding');
    expect(pruned.goals).toHaveLength(1);
    expect(pruned.goals[0].goal).toBe('Active goal');
  });

  it('handles corrupted memory file gracefully', () => {
    writeFileSync(MEMORY_PATH, 'not valid json{{{');
    const mem = loadMemory(MEMORY_PATH);
    expect(mem.recentFindings).toHaveLength(0);
  });
});
