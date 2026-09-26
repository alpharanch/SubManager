import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Activity, FolderMinus, FolderPlus, Info, RefreshCw, Search, UserMinus, X } from 'lucide-react';
import type { ChannelActivity, ChannelStats, Group, Subscription } from '../types';
import { DAILY_QUOTA, SCAN_TTL_MS, WRITE_COST } from '../config';
import { channelUrl } from '../lib/api';
import { daysSince, formatCount, formatDate, formatNumber, timeAgo } from '../lib/format';
import { channelIdsFor, groupsByChannel } from '../selectors';
import { ALL, UNGROUPED, useStore } from '../store';
import { BulkGroupMenu, ChannelGroupPicker } from './GroupMenus';
import { Avatar, Dialog, EmptyState, Popover } from './ui';

type SortKey = 'subscribed-desc' | 'subscribed-asc' | 'upload-desc' | 'upload-asc' | 'subscribers' | 'name';
type ActivityFilter = 'all' | '6m' | '1y' | '2y' | 'none' | 'unknown';

const SORTS: [SortKey, string][] = [
  ['subscribed-desc', '구독 시작일 · 최근 순'],
  ['subscribed-asc', '구독 시작일 · 오래된 순'],
  ['upload-desc', '마지막 업로드 · 최근 순'],
  ['upload-asc', '마지막 업로드 · 오래된 순'],
  ['subscribers', '구독자 많은 순'],
  ['name', '이름 순'],
];

const FILTERS: [ActivityFilter, string][] = [
  ['all', '모든 채널'],
  ['6m', '6개월 넘게 새 영상 없음'],
  ['1y', '1년 넘게 새 영상 없음'],
  ['2y', '2년 넘게 새 영상 없음'],
  ['none', '영상이 없는 채널'],
  ['unknown', '업로드 확인 전'],
];

const INACTIVE_DAYS: Record<'6m' | '1y' | '2y', number> = { '6m': 182, '1y': 365, '2y': 730 };
const PAGE = 150;
const NO_GROUPS: Group[] = [];

interface Row {
  sub: Subscription;
  stats?: ChannelStats;
  act?: ChannelActivity;
  groups: Group[];
}

function matchesFilter(act: ChannelActivity | undefined, filter: ActivityFilter, now: number): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'unknown':
      return !act;
    case 'none':
      return !!act && act.lastUploadAt === null;
    default:
      return !!act && (act.lastUploadAt === null || daysSince(act.lastUploadAt, now) > INACTIVE_DAYS[filter]);
  }
}

/** Unchecked channels sort last; channels without uploads count as the oldest. */
const uploadTime = (r: Row) => (r.act ? (r.act.lastUploadAt ? Date.parse(r.act.lastUploadAt) : 0) : null);

function byUpload(dir: 1 | -1) {
  return (a: Row, b: Row) => {
    const x = uploadTime(a);
    const y = uploadTime(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return (x - y) * dir;
  };
}

const COMPARE: Record<SortKey, (a: Row, b: Row) => number> = {
  'subscribed-desc': (a, b) => (a.sub.subscribedAt < b.sub.subscribedAt ? 1 : -1),
  'subscribed-asc': (a, b) => (a.sub.subscribedAt > b.sub.subscribedAt ? 1 : -1),
  'upload-desc': byUpload(-1),
  'upload-asc': byUpload(1),
  subscribers: (a, b) => (b.stats?.subscriberCount ?? -1) - (a.stats?.subscriberCount ?? -1),
  name: (a, b) => a.sub.title.localeCompare(b.sub.title, 'ko'),
};

function uploadInfo(act: ChannelActivity | undefined): { text: string; tone: string } {
  if (!act) return { text: '확인 전', tone: 'is-muted' };
  if (!act.lastUploadAt) return { text: '영상 없음', tone: 'is-warn' };
  const days = daysSince(act.lastUploadAt);
  return { text: timeAgo(act.lastUploadAt), tone: days > 365 ? 'is-warn' : days > 182 ? 'is-soft' : '' };
}

const ChannelRow = memo(function ChannelRow({
  row,
  selected,
  onToggle,
}: {
  row: Row;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const { sub, stats, act, groups } = row;
  const upload = uploadInfo(act);
  return (
    <div className={`row${selected ? ' is-selected' : ''}`}>
      <label className="cell-check">
        <input type="checkbox" checked={selected} onChange={() => onToggle(sub.channelId)} aria-label={`${sub.title} 선택`} />
      </label>
      <div className="cell-channel">
        <Avatar src={sub.thumbnail} name={sub.title} />
        <div className="channel-text">
          <a className="channel-name" href={channelUrl(sub.channelId)} target="_blank" rel="noreferrer" title={sub.description || sub.title}>
            {sub.title}
          </a>
          {groups.length > 0 && (
            <div className="chips">
              {groups.map((g) => (
                <span key={g.id} className="chip" style={{ '--c': g.color } as CSSProperties}>
                  {g.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="cell-meta">
        <div className="cell-date" data-label="구독">
          {formatDate(sub.subscribedAt)}
          <span className="cell-sub">{timeAgo(sub.subscribedAt)}</span>
        </div>
        <div className={`cell-upload ${upload.tone}`} data-label="업로드">
          {upload.text}
        </div>
        <div className="cell-num" data-label="구독자">
          {formatCount(stats?.subscriberCount)}
        </div>
        <div className="cell-num" data-label="영상">
          {formatCount(stats?.videoCount)}
        </div>
      </div>
      <div className="cell-action">
        <ChannelGroupPicker channelId={sub.channelId} title={sub.title} />
      </div>
    </div>
  );
});

function UnsubscribeDialog({
  channelIds,
  onClose,
  onConfirm,
}: {
  channelIds: string[] | null;
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
}) {
  const subs = useStore((s) => s.subs);
  const activity = useStore((s) => s.activity);
  const quotaUsed = useStore((s) => s.quotaUsed);
  const mode = useStore((s) => s.mode);

  const items = useMemo(() => {
    const wanted = new Set(channelIds ?? []);
    return subs.filter((s) => wanted.has(s.channelId));
  }, [subs, channelIds]);

  const cost = items.length * WRITE_COST;
  const remaining = Math.max(0, DAILY_QUOTA - quotaUsed);

  return (
    <Dialog
      open={channelIds !== null}
      onClose={onClose}
      title={`채널 ${items.length}개의 구독을 취소할까요?`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            돌아가기
          </button>
          <button type="button" className="btn btn-danger" onClick={() => onConfirm(items.map((s) => s.channelId))}>
            구독 취소하기
          </button>
        </>
      }
    >
      <ul className="dialog-list">
        {items.map((s) => (
          <li key={s.channelId}>
            <Avatar src={s.thumbnail} name={s.title} size={28} />
            <span className="grow">{s.title}</span>
            <span className="muted">{uploadInfo(activity[s.channelId]).text}</span>
          </li>
        ))}
      </ul>
      <div className="note">
        <p>
          API 사용량: {items.length}개 × {WRITE_COST} = <strong>{formatNumber(cost)}</strong> (오늘 남은 양 약 {formatNumber(remaining)})
        </p>
        {cost > remaining && (
          <p className="is-warn">오늘 남은 사용량으로는 약 {Math.floor(remaining / WRITE_COST)}개까지만 취소할 수 있어요.</p>
        )}
        <p>구독을 취소하면 원래 구독 시작일은 사라져요. 다시 구독하면 그날 날짜로 새로 기록돼요.</p>
        <p>취소한 채널은 오른쪽 위 메뉴의 ‘구독 취소 기록’에서 다시 구독할 수 있어요.</p>
        {mode === 'demo' && <p>샘플 데이터라서 실제 YouTube 구독은 바뀌지 않아요.</p>}
      </div>
    </Dialog>
  );
}

function BulkBar({
  channelIds,
  groupKey,
  onClear,
  onUnsubscribe,
}: {
  channelIds: string[];
  groupKey: string;
  onClear: () => void;
  onUnsubscribe: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const removeFromGroup = useStore((s) => s.removeFromGroup);
  const busy = useStore((s) => s.task !== null);
  const inGroup = groupKey !== ALL && groupKey !== UNGROUPED;

  return (
    <div className="bulkbar" role="toolbar" aria-label="선택한 채널">
      <span className="bulkbar-count">{channelIds.length}개 선택</span>
      <Popover
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        placement="top"
        align="start"
        trigger={
          <button type="button" className="btn btn-sm" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen}>
            <FolderPlus size={15} /> 그룹에 넣기
          </button>
        }
      >
        <BulkGroupMenu
          channelIds={channelIds}
          onDone={() => {
            setMenuOpen(false);
            onClear();
          }}
        />
      </Popover>
      {inGroup && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            removeFromGroup(groupKey, channelIds);
            onClear();
          }}
        >
          <FolderMinus size={15} /> 그룹에서 빼기
        </button>
      )}
      <button type="button" className="btn btn-sm btn-danger" onClick={onUnsubscribe} disabled={busy}>
        <UserMinus size={15} /> 구독 취소
      </button>
      <button type="button" className="icon-btn" onClick={onClear} aria-label="선택 해제" title="선택 해제">
        <X size={17} />
      </button>
    </div>
  );
}

export function ChannelsView() {
  const subs = useStore((s) => s.subs);
  const stats = useStore((s) => s.stats);
  const activity = useStore((s) => s.activity);
  const groups = useStore((s) => s.groups);
  const groupKey = useStore((s) => s.groupKey);
  const subsSyncedAt = useStore((s) => s.subsSyncedAt);
  const busy = useStore((s) => s.task !== null);
  const syncSubscriptions = useStore((s) => s.syncSubscriptions);
  const scanActivity = useStore((s) => s.scanActivity);
  const unsubscribe = useStore((s) => s.unsubscribe);
  const setGroupKey = useStore((s) => s.setGroupKey);

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('subscribed-desc');
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [limit, setLimit] = useState(PAGE);
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);

  const scopeIds = useMemo(() => channelIdsFor(groupKey, subs, groups), [groupKey, subs, groups]);
  const groupMap = useMemo(() => groupsByChannel(groups), [groups]);
  const subById = useMemo(() => new Map(subs.map((s) => [s.channelId, s])), [subs]);

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('ko');
    const now = Date.now();
    const list: Row[] = [];
    for (const id of scopeIds) {
      const sub = subById.get(id);
      if (!sub) continue;
      if (q && !sub.title.toLocaleLowerCase('ko').includes(q)) continue;
      const act = activity[id];
      if (!matchesFilter(act, filter, now)) continue;
      list.push({ sub, stats: stats[id], act, groups: groupMap.get(id) ?? NO_GROUPS });
    }
    return list.sort(COMPARE[sort]);
  }, [scopeIds, subById, query, activity, filter, stats, groupMap, sort]);

  const { staleIds, uncheckedCount } = useMemo(() => {
    const now = Date.now();
    const stale = scopeIds.filter((id) => {
      const a = activity[id];
      return !a || now - a.fetchedAt > SCAN_TTL_MS;
    });
    return { staleIds: stale, uncheckedCount: scopeIds.filter((id) => !activity[id]).length };
  }, [scopeIds, activity]);

  // Keep the selection inside the visible list so hidden channels are never acted on.
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const visible = new Set(rows.map((r) => r.sub.channelId));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  useEffect(() => setLimit(PAGE), [groupKey, query, filter, sort]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const scan = () => scanActivity(staleIds, '마지막 업로드를 확인하는 중');
  const syncCost = Math.ceil(subs.length / 50) * 2 + 1;

  if (!subs.length) {
    return subsSyncedAt ? (
      <EmptyState title="구독 중인 채널이 없어요" />
    ) : (
      <EmptyState
        title="구독 목록을 아직 불러오지 않았어요"
        action={
          <button type="button" className="btn btn-primary" onClick={() => syncSubscriptions()} disabled={busy}>
            <RefreshCw size={15} /> 구독 목록 불러오기
          </button>
        }
      />
    );
  }

  return (
    <div className="channels">
      <div className="toolbar">
        <label className="search">
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="채널 이름 검색" aria-label="채널 이름 검색" />
        </label>
        <select className="select" value={filter} onChange={(e) => setFilter(e.target.value as ActivityFilter)} aria-label="활동 필터">
          {FILTERS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="정렬">
          {SORTS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <div className="toolbar-actions">
          <button
            type="button"
            className="btn"
            onClick={scan}
            disabled={busy || !staleIds.length}
            title={`채널마다 최근 영상을 확인해요 (API 약 ${staleIds.length} 사용)`}
          >
            <Activity size={15} /> {staleIds.length ? `업로드 확인 (${formatNumber(staleIds.length)})` : '업로드 확인 완료'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => syncSubscriptions()}
            disabled={busy}
            title={`구독 목록과 채널 정보를 다시 불러와요 (API 약 ${syncCost} 사용)`}
          >
            <RefreshCw size={15} /> 목록 새로고침
          </button>
        </div>
      </div>

      {uncheckedCount > 0 && (
        <div className="banner">
          <Info size={16} aria-hidden="true" />
          <span>
            채널 {formatNumber(uncheckedCount)}개는 마지막 업로드 날짜를 아직 확인하지 않았어요. 확인하면 오래 활동이 없는 채널을 찾을 수 있어요.
          </span>
          <button type="button" className="btn btn-sm btn-primary" onClick={scan} disabled={busy}>
            확인하기 · API 약 {formatNumber(staleIds.length)}
          </button>
        </div>
      )}

      <p className="list-meta">
        채널 {formatNumber(rows.length)}개{rows.length !== scopeIds.length && ` (전체 ${formatNumber(scopeIds.length)}개 중)`}
        {subsSyncedAt && ` · 목록 갱신 ${timeAgo(subsSyncedAt)}`}
      </p>

      {scopeIds.length === 0 ? (
        <EmptyState
          title="이 그룹에 아직 채널이 없어요"
          action={
            <button type="button" className="btn" onClick={() => setGroupKey(ALL)}>
              전체 채널에서 고르기
            </button>
          }
        >
          채널 옆의 그룹 버튼을 누르거나, 여러 채널을 선택해서 이 그룹에 넣을 수 있어요.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title="조건에 맞는 채널이 없어요">
          {filter !== 'all' && filter !== 'unknown' && uncheckedCount > 0
            ? '업로드를 확인하지 않은 채널은 이 필터에 나오지 않아요.'
            : '검색어나 필터를 바꿔 보세요.'}
        </EmptyState>
      ) : (
        <div className="list">
          <div className="row list-head">
            <label className="cell-check">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = selected.size > 0 && !allSelected;
                }}
                onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.sub.channelId)))}
                aria-label="모두 선택"
              />
            </label>
            <div className="cell-channel">채널</div>
            <div className="cell-meta">
              <div className="cell-date">구독 시작일</div>
              <div className="cell-upload">마지막 업로드</div>
              <div className="cell-num">구독자</div>
              <div className="cell-num">영상</div>
            </div>
            <div className="cell-action" />
          </div>
          {rows.slice(0, limit).map((row) => (
            <ChannelRow key={row.sub.channelId} row={row} selected={selected.has(row.sub.channelId)} onToggle={toggle} />
          ))}
        </div>
      )}

      {rows.length > limit && (
        <button type="button" className="btn more" onClick={() => setLimit((l) => l + PAGE)}>
          더 보기 ({formatNumber(rows.length - limit)}개 남음)
        </button>
      )}

      {selected.size > 0 && (
        <BulkBar
          channelIds={[...selected]}
          groupKey={groupKey}
          onClear={() => setSelected(new Set())}
          onUnsubscribe={() => setConfirmIds([...selected])}
        />
      )}

      <UnsubscribeDialog
        channelIds={confirmIds}
        onClose={() => setConfirmIds(null)}
        onConfirm={(ids) => {
          setConfirmIds(null);
          setSelected(new Set());
          unsubscribe(ids);
        }}
      />
    </div>
  );
}
