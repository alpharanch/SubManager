import type { Backup, ChannelActivity, ChannelStats, Group, Subscription } from '../types';
import { channelUrl } from './api';
import { isoDate } from './format';

export function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (v: string | number | null | undefined) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function subscriptionsCsv(
  subs: Subscription[],
  stats: Record<string, ChannelStats>,
  activity: Record<string, ChannelActivity>,
  groups: Group[],
): string {
  const header = ['채널', '채널 주소', '구독 시작일', '마지막 업로드', '구독자 수', '영상 수', '그룹'];
  const lines = subs.map((s) => {
    const act = activity[s.channelId];
    const st = stats[s.channelId];
    const lastUpload = act ? (act.lastUploadAt ? isoDate(act.lastUploadAt) : '영상 없음') : '';
    const groupNames = groups.filter((g) => g.channelIds.includes(s.channelId)).map((g) => g.name);
    return [s.title, channelUrl(s.channelId), isoDate(s.subscribedAt), lastUpload, st?.subscriberCount, st?.videoCount, groupNames.join(', ')]
      .map(csvCell)
      .join(',');
  });
  // The BOM makes Excel open the Korean text as UTF-8.
  return '﻿' + [header.join(','), ...lines].join('\r\n');
}

/** Returns the backup, or null when the file is not a SubManager backup. */
export function parseBackup(text: string): Backup | null {
  try {
    const data = JSON.parse(text) as Partial<Backup>;
    if (data.app !== 'SubManager' || !Array.isArray(data.groups)) return null;
    const groupsOk = data.groups.every(
      (g) => typeof g?.id === 'string' && typeof g.name === 'string' && Array.isArray(g.channelIds),
    );
    if (!groupsOk) return null;
    return {
      app: 'SubManager',
      version: 1,
      exportedAt: data.exportedAt ?? '',
      account: data.account ?? null,
      groups: data.groups,
      unsubLog: Array.isArray(data.unsubLog) ? data.unsubLog : [],
      feedSeen: data.feedSeen && typeof data.feedSeen === 'object' ? data.feedSeen : {},
    };
  } catch {
    return null;
  }
}
