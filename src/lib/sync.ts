import type { Group, UnsubLogEntry } from '../types';

/** The part of an account's data that is shared between devices through Drive. */
export interface SyncData {
  groups: Group[];
  /** Group ID → deletion time, so a deleted group does not come back from another device. */
  deletedGroups: Record<string, number>;
  unsubLog: UnsubLogEntry[];
  /** Channel ID → time it left the log (re-subscribed). */
  removedLog: Record<string, number>;
  feedSeen: Record<string, number>;
}

export interface SyncDoc extends SyncData {
  app: 'SubManager';
  version: 1;
  updatedAt: number;
}

type Stamps = Record<string, number>;

const DAY = 86_400_000;
const TOMBSTONE_DAYS = 180;
const LOG_LIMIT = 500;

function latest(a: Stamps, b: Stamps): Stamps {
  const out: Stamps = { ...a };
  for (const [key, time] of Object.entries(b)) {
    if (!(out[key] >= time)) out[key] = time;
  }
  return out;
}

function recent(stamps: Stamps, now: number): Stamps {
  return Object.fromEntries(Object.entries(stamps).filter(([, time]) => now - time < TOMBSTONE_DAYS * DAY));
}

/**
 * Combines this browser's data with the Drive copy. The newer edit wins per group and per log
 * entry, and a deletion wins over any edit made before it. Local group order is kept.
 */
export function mergeSyncData(local: SyncData, remote: SyncData, now = Date.now()): SyncData {
  const deletedGroups = recent(latest(local.deletedGroups, remote.deletedGroups), now);
  const removedLog = recent(latest(local.removedLog, remote.removedLog), now);

  const newest = new Map<string, Group>();
  const order: string[] = [];
  for (const g of [...local.groups, ...remote.groups]) {
    const current = newest.get(g.id);
    if (!current) order.push(g.id);
    if (!current || (g.updatedAt ?? 0) > (current.updatedAt ?? 0)) newest.set(g.id, g);
  }
  const groups = order
    .map((id) => newest.get(id)!)
    .filter((g) => !((deletedGroups[g.id] ?? -1) >= (g.updatedAt ?? 0)));

  const newestLog = new Map<string, UnsubLogEntry>();
  for (const entry of [...local.unsubLog, ...remote.unsubLog]) {
    const current = newestLog.get(entry.channelId);
    if (!current || entry.unsubscribedAt > current.unsubscribedAt) newestLog.set(entry.channelId, entry);
  }
  const unsubLog = [...newestLog.values()]
    .filter((e) => !((removedLog[e.channelId] ?? -1) >= Date.parse(e.unsubscribedAt)))
    .sort((a, b) => (a.unsubscribedAt < b.unsubscribedAt ? 1 : -1))
    .slice(0, LOG_LIMIT);

  // Keys starting with "__" are the built-in "all" and "ungrouped" feeds.
  const groupIds = new Set(groups.map((g) => g.id));
  const feedSeen = Object.fromEntries(
    Object.entries(latest(local.feedSeen, remote.feedSeen)).filter(([key]) => key.startsWith('__') || groupIds.has(key)),
  );

  return { groups, deletedGroups, unsubLog, removedLog, feedSeen };
}

const sortedStamps = (stamps: Stamps) => Object.fromEntries(Object.entries(stamps).sort(([a], [b]) => (a < b ? -1 : 1)));

function canonical(d: SyncData): string {
  return JSON.stringify({
    groups: d.groups.map((g) => [g.id, g.name, g.color, [...g.channelIds].sort(), g.updatedAt ?? 0]),
    deletedGroups: sortedStamps(d.deletedGroups),
    unsubLog: d.unsubLog.map((e) => [e.channelId, e.title, e.thumbnail, e.subscribedAt, e.unsubscribedAt, e.groupIds]),
    removedLog: sortedStamps(d.removedLog),
    feedSeen: sortedStamps(d.feedSeen),
  });
}

export function sameSyncData(a: SyncData, b: SyncData): boolean {
  return canonical(a) === canonical(b);
}

export function toSyncDoc(data: SyncData, now = Date.now()): SyncDoc {
  return { app: 'SubManager', version: 1, updatedAt: now, ...data };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function stamps(v: unknown): Stamps {
  if (!isRecord(v)) return {};
  return Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === 'number'));
}

/** Reads a Drive file defensively; returns null when it is not a SubManager sync file. */
export function parseSyncDoc(raw: unknown): SyncData | null {
  if (!isRecord(raw) || raw.app !== 'SubManager') return null;
  const groups = (Array.isArray(raw.groups) ? raw.groups : [])
    .filter((g): g is Group => isRecord(g) && typeof g.id === 'string' && typeof g.name === 'string' && Array.isArray(g.channelIds))
    .map((g) => ({
      id: g.id,
      name: g.name,
      color: typeof g.color === 'string' ? g.color : '#0090ff',
      channelIds: g.channelIds.filter((id) => typeof id === 'string'),
      updatedAt: typeof g.updatedAt === 'number' ? g.updatedAt : 0,
    }));
  const unsubLog = (Array.isArray(raw.unsubLog) ? raw.unsubLog : []).filter(
    (e): e is UnsubLogEntry =>
      isRecord(e) && typeof e.channelId === 'string' && typeof e.unsubscribedAt === 'string' && typeof e.title === 'string',
  );
  return {
    groups,
    deletedGroups: stamps(raw.deletedGroups),
    unsubLog: unsubLog.map((e) => ({ ...e, groupIds: Array.isArray(e.groupIds) ? e.groupIds : [] })),
    removedLog: stamps(raw.removedLog),
    feedSeen: stamps(raw.feedSeen),
  };
}
