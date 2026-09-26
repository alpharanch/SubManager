import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Play, RefreshCw } from 'lucide-react';
import type { Video } from '../types';
import { FEED_AUTO_LIMIT, FEED_TTL_MS } from '../config';
import { videoUrl } from '../lib/api';
import { formatNumber, hueOf, timeAgo } from '../lib/format';
import { channelIdsFor, groupLabel } from '../selectors';
import { ALL, useStore } from '../store';
import { EmptyState } from './ui';

const PAGE = 48;

function VideoCard({ video, channelTitle, isNew }: { video: Video; channelTitle: string; isNew: boolean }) {
  return (
    <a className="video" href={videoUrl(video.videoId)} target="_blank" rel="noreferrer">
      <div className="video-thumb">
        {video.thumbnail ? (
          <img src={video.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <div className="thumb-ph" style={{ '--h': hueOf(video.channelId) } as CSSProperties}>
            <Play size={28} aria-hidden="true" />
          </div>
        )}
        {isNew && <span className="badge-new">새 영상</span>}
      </div>
      <div className="video-title">{video.title}</div>
      <div className="video-sub">
        <span className="video-channel">{channelTitle}</span>
        <span aria-hidden="true">·</span>
        <span>{timeAgo(video.publishedAt)}</span>
      </div>
    </a>
  );
}

export function FeedView() {
  const subs = useStore((s) => s.subs);
  const groups = useStore((s) => s.groups);
  const groupKey = useStore((s) => s.groupKey);
  const activity = useStore((s) => s.activity);
  const authed = useStore((s) => s.authed);
  const busy = useStore((s) => s.task !== null);
  const scanActivity = useStore((s) => s.scanActivity);
  const markFeedSeen = useStore((s) => s.markFeedSeen);
  const setView = useStore((s) => s.setView);
  const setGroupKey = useStore((s) => s.setGroupKey);

  const [limit, setLimit] = useState(PAGE);
  const [seenBefore, setSeenBefore] = useState<number | undefined>(undefined);
  const lastMarked = useRef<string | null>(null);
  const autoTried = useRef(new Set<string>());

  const channelIds = useMemo(() => channelIdsFor(groupKey, subs, groups), [groupKey, subs, groups]);
  const titles = useMemo(() => new Map(subs.map((s) => [s.channelId, s.title])), [subs]);

  const { staleIds, checkedAt } = useMemo(() => {
    const now = Date.now();
    const stale = channelIds.filter((id) => {
      const a = activity[id];
      return !a || now - a.fetchedAt > FEED_TTL_MS;
    });
    const fetched = channelIds.map((id) => activity[id]?.fetchedAt).filter((t): t is number => t !== undefined);
    return { staleIds: stale, checkedAt: fetched.length ? Math.min(...fetched) : null };
  }, [channelIds, activity]);

  const videos = useMemo(() => {
    const all = channelIds.flatMap((id) => activity[id]?.videos ?? []);
    return all.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  }, [channelIds, activity]);

  // Remember when this feed was last opened; videos newer than that get a badge.
  useEffect(() => {
    if (lastMarked.current === groupKey) return;
    lastMarked.current = groupKey;
    setSeenBefore(useStore.getState().feedSeen[groupKey]);
    markFeedSeen(groupKey);
    setLimit(PAGE);
  }, [groupKey, markFeedSeen]);

  // Small feeds refresh by themselves; large ones wait for the button so quota is not spent by surprise.
  useEffect(() => {
    if (!authed || busy || !staleIds.length || staleIds.length > FEED_AUTO_LIMIT) return;
    if (autoTried.current.has(groupKey)) return;
    autoTried.current.add(groupKey);
    scanActivity(staleIds, '새 영상을 확인하는 중');
  }, [authed, busy, staleIds, groupKey, scanActivity]);

  const refresh = () => scanActivity(staleIds, '새 영상을 확인하는 중');
  const title = groupLabel(groupKey, groups);

  if (!channelIds.length) {
    return (
      <EmptyState
        title={groupKey === ALL ? '구독 중인 채널이 없어요' : '이 그룹에 아직 채널이 없어요'}
        action={
          groupKey !== ALL && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setGroupKey(ALL);
                setView('channels');
              }}
            >
              채널을 그룹에 넣으러 가기
            </button>
          )
        }
      />
    );
  }

  return (
    <div className="feed">
      <div className="feed-head">
        <p className="list-meta">
          {title} · 채널 {formatNumber(channelIds.length)}개
          {checkedAt ? ` · 확인 ${timeAgo(checkedAt)}` : ' · 아직 확인하지 않음'}
        </p>
        <button
          type="button"
          className="btn"
          onClick={refresh}
          disabled={busy || !staleIds.length}
          title={staleIds.length ? `채널 ${staleIds.length}개의 새 영상을 확인해요 (API 약 ${staleIds.length} 사용)` : undefined}
        >
          <RefreshCw size={15} /> {staleIds.length ? `새로고침 · API 약 ${formatNumber(staleIds.length)}` : '최신 상태'}
        </button>
      </div>

      {videos.length === 0 ? (
        <EmptyState
          title={staleIds.length ? '새 영상을 아직 불러오지 않았어요' : '최근 영상이 없어요'}
          action={
            staleIds.length > 0 && (
              <button type="button" className="btn btn-primary" onClick={refresh} disabled={busy}>
                <RefreshCw size={15} /> 새 영상 불러오기 · API 약 {formatNumber(staleIds.length)}
              </button>
            )
          }
        >
          {staleIds.length > FEED_AUTO_LIMIT && `채널이 ${FEED_AUTO_LIMIT}개보다 많은 목록은 API 사용량을 아끼려고 직접 불러와요.`}
        </EmptyState>
      ) : (
        <div className="video-grid">
          {videos.slice(0, limit).map((v) => (
            <VideoCard
              key={v.videoId}
              video={v}
              channelTitle={titles.get(v.channelId) ?? ''}
              isNew={seenBefore !== undefined && Date.parse(v.publishedAt) > seenBefore}
            />
          ))}
        </div>
      )}

      {videos.length > limit && (
        <button type="button" className="btn more" onClick={() => setLimit((l) => l + PAGE)}>
          더 보기
        </button>
      )}
    </div>
  );
}
