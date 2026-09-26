const DAY = 86_400_000;
const compact = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat('ko-KR');

export function formatCount(n: number | null | undefined): string {
  if (n == null) return '—';
  return n < 10_000 ? plain.format(n) : compact.format(n);
}

export const formatNumber = (n: number) => plain.format(n);

const pad = (n: number) => String(n).padStart(2, '0');

/** 2021.03.05 in local time. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

/** 2021-03-05 in local time, for CSV and file names. */
export function isoDate(value: string | number | Date = new Date()): string {
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function daysSince(iso: string, now = Date.now()): number {
  return (now - Date.parse(iso)) / DAY;
}

export function timeAgo(value: string | number | null | undefined, now = Date.now()): string {
  if (value == null) return '—';
  const t = typeof value === 'number' ? value : Date.parse(value);
  const minutes = Math.max(0, now - t) / 60_000;
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${Math.floor(minutes)}분 전`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}시간 전`;
  const days = hours / 24;
  if (days < 7) return `${Math.floor(days)}일 전`;
  if (days < 30) return `${Math.floor(days / 7)}주 전`;
  if (days < 365) return `${Math.floor(days / 30)}개월 전`;
  return `${Math.floor(days / 365)}년 전`;
}

/** Stable hue for placeholder avatars and thumbnails (FNV-1a, so near-identical IDs still differ). */
export function hueOf(text: string): number {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}
