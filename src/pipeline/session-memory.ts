import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import type { SessionMemory } from './types.js';

const LOCK_TIMEOUT_MS = 5000;

function emptyMemory(): SessionMemory {
  return {
    lastUpdated: '',
    recentFindings: [],
    openQuestions: [],
    userConcerns: [],
    goals: [],
    baselineSnapshots: {},
  };
}

export function loadMemory(filePath: string): SessionMemory {
  if (!existsSync(filePath)) return emptyMemory();

  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as SessionMemory;
  } catch {
    return emptyMemory();
  }
}

export function saveMemory(filePath: string, memory: SessionMemory): boolean {
  const lockPath = filePath + '.lock';

  // Simple file lock to prevent concurrent writes from multiple pipeline runs
  if (existsSync(lockPath)) {
    const lockStat = readFileSync(lockPath, 'utf-8');
    const lockTime = parseInt(lockStat, 10);
    if (Date.now() - lockTime < LOCK_TIMEOUT_MS) {
      return false;
    }
    unlinkSync(lockPath);
  }

  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(lockPath, String(Date.now()));
    writeFileSync(filePath, JSON.stringify(memory, null, 2));
    return true;
  } finally {
    try { unlinkSync(lockPath); } catch {}
  }
}

export function pruneMemory(memory: SessionMemory, today: string): SessionMemory {
  const ninetyDaysAgo = offsetDay(today, -90);
  const thirtyDaysAgo = offsetDay(today, -30);

  return {
    ...memory,
    recentFindings: memory.recentFindings.filter(f => {
      // Drop resolved findings older than 90 days — they're no longer actionable
      if (f.status === 'resolved' && f.date < ninetyDaysAgo) return false;
      return true;
    }),
    goals: memory.goals.filter(g => {
      // Drop achieved/abandoned goals older than 30 days to keep memory compact
      if ((g.status === 'achieved' || g.status === 'abandoned') && g.lastChecked < thirtyDaysAgo) return false;
      return true;
    }),
  };
}

function offsetDay(base: string, offset: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}
