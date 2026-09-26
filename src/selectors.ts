import type { Group, Subscription } from './types';
import { ALL, UNGROUPED } from './store';

/** Subscribed channel IDs shown for the selected entry in the group list. */
export function channelIdsFor(groupKey: string, subs: Subscription[], groups: Group[]): string[] {
  if (groupKey === ALL) return subs.map((s) => s.channelId);
  if (groupKey === UNGROUPED) {
    const grouped = new Set(groups.flatMap((g) => g.channelIds));
    return subs.filter((s) => !grouped.has(s.channelId)).map((s) => s.channelId);
  }
  const group = groups.find((g) => g.id === groupKey);
  if (!group) return [];
  const subscribed = new Set(subs.map((s) => s.channelId));
  return group.channelIds.filter((id) => subscribed.has(id));
}

export function groupLabel(groupKey: string, groups: Group[]): string {
  if (groupKey === ALL) return '전체';
  if (groupKey === UNGROUPED) return '그룹 없음';
  return groups.find((g) => g.id === groupKey)?.name ?? '그룹';
}

export function groupsByChannel(groups: Group[]): Map<string, Group[]> {
  const map = new Map<string, Group[]>();
  for (const g of groups) {
    for (const id of g.channelIds) {
      const list = map.get(id);
      if (list) list.push(g);
      else map.set(id, [g]);
    }
  }
  return map;
}
