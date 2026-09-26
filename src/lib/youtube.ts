import type { Account, ChannelStats, Subscription, Video } from '../types';
import { WRITE_COST } from '../config';
import { ApiError, AuthError, reportCost, type YouTubeApi } from './api';
import * as auth from './auth';

const BASE = 'https://www.googleapis.com/youtube/v3';

type Params = Record<string, string | number | boolean | undefined>;
type Thumbs = Partial<Record<'default' | 'medium' | 'high' | 'standard' | 'maxres', { url: string }>>;

interface ListResponse<T> {
  items?: T[];
  nextPageToken?: string;
  pageInfo?: { totalResults?: number };
}

interface SubscriptionResource {
  id: string;
  snippet: {
    publishedAt: string;
    title: string;
    description?: string;
    resourceId: { channelId: string };
    thumbnails?: Thumbs;
  };
}

interface ChannelResource {
  id: string;
  snippet?: { title: string; thumbnails?: Thumbs };
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean; videoCount?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
  topicDetails?: { topicCategories?: string[] };
}

interface PlaylistItemResource {
  snippet?: { title?: string; thumbnails?: Thumbs };
  contentDetails?: { videoId?: string; videoPublishedAt?: string };
}

const AVATAR: (keyof Thumbs)[] = ['default', 'medium', 'high'];
const VIDEO_THUMB: (keyof Thumbs)[] = ['medium', 'high', 'default'];

const MESSAGES: Record<string, string> = {
  quotaExceeded: '오늘 YouTube API 사용량(10,000)을 모두 썼어요. 한국 시간 오후 4~5시에 초기화돼요.',
  dailyLimitExceeded: '오늘 YouTube API 사용량을 모두 썼어요. 한국 시간 오후 4~5시에 초기화돼요.',
  rateLimitExceeded: '요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요.',
  userRateLimitExceeded: '요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요.',
  insufficientPermissions: 'YouTube 권한이 부족해요. 다시 로그인해서 권한을 모두 허용해 주세요.',
  accessNotConfigured: 'Google Cloud 프로젝트에서 YouTube Data API v3가 사용 설정되지 않았어요.',
  SERVICE_DISABLED: 'Google Cloud 프로젝트에서 YouTube Data API v3가 사용 설정되지 않았어요.',
  subscriptionNotFound: '이미 구독이 취소된 채널이에요.',
  subscriptionDuplicate: '이미 구독 중인 채널이에요.',
  subscriptionForbidden: '이 채널은 구독할 수 없어요.',
};

function pickThumb(thumbs: Thumbs | undefined, order: (keyof Thumbs)[]): string {
  for (const key of order) {
    const url = thumbs?.[key]?.url;
    if (url) return url;
  }
  return '';
}

const toNumber = (v: string | undefined) => (v == null ? null : Number(v));

/** Topic categories come as Wikipedia URLs, e.g. https://en.wikipedia.org/wiki/Video_game_culture. */
const topicName = (url: string) => decodeURIComponent(url.split('/').pop() ?? url).replace(/_/g, ' ');

function toSubscription(it: SubscriptionResource): Subscription {
  return {
    subscriptionId: it.id,
    channelId: it.snippet.resourceId.channelId,
    title: it.snippet.title,
    description: (it.snippet.description ?? '').slice(0, 300),
    thumbnail: pickThumb(it.snippet.thumbnails, AVATAR),
    subscribedAt: it.snippet.publishedAt,
  };
}

function expired(): AuthError {
  return new AuthError('expired', '로그인이 만료됐어요. 다시 로그인해 주세요.');
}

async function call<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  params: Params,
  cost: number,
  body?: unknown,
): Promise<T> {
  const token = auth.accessToken();
  if (!token) throw expired();

  const url = new URL(`${BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  // Google charges quota for failed requests too, so count before sending.
  reportCost(cost);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', '네트워크 오류로 YouTube에 연결하지 못했어요.');
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) {
      auth.invalidateToken();
      throw expired();
    }
    const error = data?.error;
    const reason: string = error?.errors?.[0]?.reason ?? error?.status ?? 'unknown';
    throw new ApiError(res.status, reason, MESSAGES[reason] ?? `YouTube API 오류가 났어요 (${res.status} ${reason}).`);
  }
  return data as T;
}

export const liveApi: YouTubeApi = {
  async ensureAuth(prompt = '', force = false) {
    if (!force && !prompt && auth.hasValidToken()) return false;
    await auth.requestToken(prompt);
    return true;
  },

  hasValidToken: auth.hasValidToken,
  signOut: auth.invalidateToken,

  async fetchMyChannel(): Promise<Account> {
    const r = await call<ListResponse<ChannelResource>>('GET', 'channels', { part: 'snippet', mine: true }, 1);
    const channel = r.items?.[0];
    if (!channel) return { channelId: null, title: '채널이 없는 계정', thumbnail: '' };
    return {
      channelId: channel.id,
      title: channel.snippet?.title ?? '내 채널',
      thumbnail: pickThumb(channel.snippet?.thumbnails, AVATAR),
    };
  },

  async fetchSubscriptions(onProgress) {
    // Keyed by channel so a page overlap can never produce duplicates.
    const byChannel = new Map<string, Subscription>();
    let pageToken: string | undefined;
    let total = 0;
    do {
      const r = await call<ListResponse<SubscriptionResource>>(
        'GET',
        'subscriptions',
        { part: 'snippet', mine: true, maxResults: 50, order: 'alphabetical', pageToken },
        1,
      );
      for (const item of r.items ?? []) {
        const sub = toSubscription(item);
        byChannel.set(sub.channelId, sub);
      }
      total = r.pageInfo?.totalResults ?? byChannel.size;
      onProgress(byChannel.size, total);
      pageToken = r.nextPageToken;
    } while (pageToken);
    return { items: [...byChannel.values()], total };
  },

  async fetchChannelStats(channelIds, onProgress) {
    const out: Record<string, ChannelStats> = {};
    for (let i = 0; i < channelIds.length; i += 50) {
      const batch = channelIds.slice(i, i + 50);
      const r = await call<ListResponse<ChannelResource>>(
        'GET',
        'channels',
        { part: 'statistics,contentDetails,topicDetails', id: batch.join(','), maxResults: 50 },
        1,
      );
      for (const c of r.items ?? []) {
        out[c.id] = {
          subscriberCount: c.statistics?.hiddenSubscriberCount ? null : toNumber(c.statistics?.subscriberCount),
          videoCount: toNumber(c.statistics?.videoCount),
          uploadsPlaylistId: c.contentDetails?.relatedPlaylists?.uploads ?? null,
          topics: (c.topicDetails?.topicCategories ?? []).map(topicName),
        };
      }
      onProgress(Math.min(i + 50, channelIds.length), channelIds.length);
    }
    return out;
  },

  async fetchActivity(channelId, uploadsPlaylistId) {
    try {
      const r = await call<ListResponse<PlaylistItemResource>>(
        'GET',
        'playlistItems',
        { part: 'snippet,contentDetails', playlistId: uploadsPlaylistId, maxResults: 10 },
        1,
      );
      const videos: Video[] = [];
      for (const item of r.items ?? []) {
        const videoId = item.contentDetails?.videoId;
        const publishedAt = item.contentDetails?.videoPublishedAt;
        const thumbnail = pickThumb(item.snippet?.thumbnails, VIDEO_THUMB);
        // Private and deleted videos come back without a publish date or thumbnails.
        if (!videoId || !publishedAt || !thumbnail) continue;
        videos.push({ videoId, channelId, title: item.snippet?.title ?? '', thumbnail, publishedAt });
      }
      videos.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
      return { fetchedAt: Date.now(), lastUploadAt: videos[0]?.publishedAt ?? null, videos };
    } catch (e) {
      // A channel that never uploaded has no uploads playlist.
      if (e instanceof ApiError && e.status === 404) return { fetchedAt: Date.now(), lastUploadAt: null, videos: [] };
      throw e;
    }
  },

  async deleteSubscription(subscriptionId) {
    await call<void>('DELETE', 'subscriptions', { id: subscriptionId }, WRITE_COST);
  },

  async insertSubscription(channelId) {
    const item = await call<SubscriptionResource>('POST', 'subscriptions', { part: 'snippet' }, WRITE_COST, {
      snippet: { resourceId: { kind: 'youtube#channel', channelId } },
    });
    return toSubscription(item);
  },
};
