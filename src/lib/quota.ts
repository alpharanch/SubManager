import type { Mode } from '../types';

// YouTube quota resets at midnight Pacific Time, so usage is tracked per Pacific date.
// This is an estimate: only requests made from this browser are counted.
const pacificDate = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const keyFor = (mode: Mode) => `submanager:${mode}:quota`;

export function readQuota(mode: Mode): number {
  try {
    const raw = localStorage.getItem(keyFor(mode));
    if (!raw) return 0;
    const saved = JSON.parse(raw) as { date: string; used: number };
    return saved.date === pacificDate() ? saved.used : 0;
  } catch {
    return 0;
  }
}

export function addQuota(mode: Mode, units: number): number {
  const used = readQuota(mode) + units;
  try {
    localStorage.setItem(keyFor(mode), JSON.stringify({ date: pacificDate(), used }));
  } catch {
    // Storage unavailable: the in-memory counter still updates.
  }
  return used;
}
