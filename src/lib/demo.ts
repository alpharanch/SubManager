import type { ChannelActivity, ChannelStats, Group, Subscription, Video } from '../types';
import { WRITE_COST } from '../config';
import { ApiError, reportCost, type YouTubeApi } from './api';

// Fictional channels so the whole UI can be tried without a Google Cloud setup.
type Topic = 'cook' | 'dev' | 'game' | 'music' | 'life' | 'science';

const CHANNELS: [string, Topic][] = [
  ['오늘의 집밥', 'cook'], ['코딩하는 고양이', 'dev'], ['레트로 게임 박물관', 'game'], ['기타 한 줄', 'music'],
  ['느린 여행자', 'life'], ['밤하늘 탐험대', 'science'], ['자취생 밥상', 'cook'], ['타입스크립트 교실', 'dev'],
  ['인디게임 탐방', 'game'], ['스트릿 피아노', 'music'], ['캠핑 한 스푼', 'life'], ['매일 과학', 'science'],
  ['홈카페 레시피', 'cook'], ['리액트 한 스푼', 'dev'], ['보드게임 한 판', 'game'], ['Lo-fi Study Room', 'music'],
  ['러닝 크루 일지', 'life'], ['우주 뉴스 요약', 'science'], ['10분 요리 교실', 'cook'], ['Rust 산책', 'dev'],
  ['Pixel Forge', 'game'], ['Synth Lab', 'music'], ['식물 집사', 'life'], ['Deep Space Daily', 'science'],
  ['Tiny Kitchen', 'cook'], ['Retro Circuits', 'dev'], ['스피드런 연구회', 'game'], ['재즈 입문', 'music'],
  ['책 읽는 밤', 'life'], ['역사 한 장면', 'science'], ['빵 굽는 토요일', 'cook'], ['알고리즘 야식', 'dev'],
  ['퍼즐 게임 해설', 'game'], ['작곡 일기', 'music'], ['미니멀 살림', 'life'], ['경제 쉽게 읽기', 'science'],
  ['국물 연구소', 'cook'], ['서버 이야기', 'dev'], ['전략 게임 교실', 'game'], ['드럼 연습실', 'music'],
  ['Morning Run Club', 'life'], ['영어 한 문장', 'science'], ['도시락 한 칸', 'cook'], ['픽셀 셰이더 노트', 'dev'],
  ['동네 산책 기록', 'life'], ['뇌과학 카페', 'science'], ['종이접기 공방', 'life'], ['고양이와 할머니', 'life'],
];

const TITLES: Record<Topic, string[]> = {
  cook: ['10분이면 끝나는 {x}', '실패 없는 {x} 황금 비율', '냉장고 털어서 만드는 {x}', '초보도 쉬운 {x}', '{x}, 이렇게 해 보세요'],
  dev: ['{x} 제대로 이해하기', '{x} 30분 만에 정리', '실무에서 쓰는 {x}', '{x} 흔한 실수 5가지', '처음 배우는 {x}'],
  game: ['{x} 처음부터 끝까지', '{x} 숨은 요소 총정리', '{x} 공략 1편', '요즘 빠진 {x}', '{x} 리뷰'],
  music: ['{x} 연주해 봤어요', '{x} 한 시간 듣기', '{x} 쉽게 배우기', '{x} 커버', '비 오는 날의 {x}'],
  life: ['{x} 브이로그', '{x} 일주일 기록', '{x} 준비물 정리', '{x}에서 보낸 하루', '{x} 시작하는 법'],
  science: ['{x} 5분 요약', '{x}는 왜 그럴까', '{x} 최신 소식', '{x} 쉽게 설명하기', '{x}의 모든 것'],
};

const WORDS: Record<Topic, string[]> = {
  cook: ['김치찌개', '크림 파스타', '계란말이', '떡볶이', '된장국', '카레', '샌드위치', '볶음밥'],
  dev: ['타입 시스템', '비동기 처리', '상태 관리', '캐시 전략', '테스트 코드', '정규식', '메모리 구조', 'Git 브랜치'],
  game: ['도트 RPG', '로그라이크', '퍼즐 어드벤처', '레이싱 게임', '카드 게임', '생존 게임', '리듬 게임', '고전 명작'],
  music: ['재즈 스탠더드', '영화 음악', '시티팝', '보사노바', '피아노 소품', '신스 웨이브', '어쿠스틱 발라드', '로파이 비트'],
  life: ['제주도', '캠핑', '새벽 러닝', '베란다 정원', '동네 책방', '미니멀 살림', '주말 산책', '손뜨개'],
  science: ['블랙홀', '양자역학', '인공지능', '기후 변화', '로마 제국', '금리', '수면 과학', '화성 탐사'],
};

const TOPIC_NAMES: Record<Topic, string> = {
  cook: 'Food',
  dev: 'Technology',
  game: 'Video game culture',
  music: 'Music',
  life: 'Lifestyle (sociology)',
  science: 'Knowledge',
};

const DAY = 86_400_000;
const DELETED_KEY = 'submanager:demo:deleted';

function seeded(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DemoChannel {
  id: string;
  title: string;
  topic: Topic;
  subscribedAt: string;
  stats: ChannelStats;
  /** Days ago of the newest upload, or null for a channel without uploads. */
  lastUploadDaysAgo: number | null;
  gapDays: [number, number];
}

const channels: DemoChannel[] = CHANNELS.map(([title, topic], i) => {
  const rand = seeded(i * 7919 + 17);
  const id = `UCdemo${String(i).padStart(18, '0')}`;
  // Mostly active channels, some slowing down, some long dormant, a few without uploads.
  const p = rand();
  let lastUploadDaysAgo: number | null = null;
  let gapDays: [number, number] = [0, 0];
  if (p < 0.55) {
    lastUploadDaysAgo = 0.05 + rand() * 12;
    gapDays = [1, 5];
  } else if (p < 0.75) {
    lastUploadDaysAgo = 20 + rand() * 180;
    gapDays = [7, 30];
  } else if (p < 0.93) {
    lastUploadDaysAgo = 400 + rand() * 1600;
    gapDays = [20, 60];
  }
  const start = Date.UTC(2013, 0, 1);
  const end = Date.now() - 3 * DAY;
  return {
    id,
    title,
    topic,
    subscribedAt: new Date(start + rand() * (end - start)).toISOString(),
    stats: {
      subscriberCount: rand() < 0.08 ? null : Math.round(10 ** (3 + rand() * 3.5)),
      videoCount: lastUploadDaysAgo === null ? 0 : Math.round(20 + rand() * 900),
      uploadsPlaylistId: `UU${id.slice(2)}`,
      topics: [TOPIC_NAMES[topic]],
    },
    lastUploadDaysAgo,
    gapDays,
  };
});

const byId = new Map(channels.map((c) => [c.id, c]));

function deletedIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DELETED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function saveDeleted(ids: Set<string>) {
  try {
    localStorage.setItem(DELETED_KEY, JSON.stringify([...ids]));
  } catch {
    // Sample data only.
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toSubscription(c: DemoChannel, subscribedAt = c.subscribedAt): Subscription {
  return {
    subscriptionId: `sub-${c.id}`,
    channelId: c.id,
    title: c.title,
    description: `${c.title} 채널의 샘플 설명이에요.`,
    thumbnail: '',
    subscribedAt,
  };
}

function videosFor(c: DemoChannel): Video[] {
  if (c.lastUploadDaysAgo === null) return [];
  // Anchored to the hour so repeated fetches return the same videos.
  const anchor = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const rand = seeded(Number(c.id.slice(-6)) * 104_729 + 3);
  const [minGap, maxGap] = c.gapDays;
  let daysAgo = c.lastUploadDaysAgo;
  return Array.from({ length: 10 }, (_, n) => {
    const titles = TITLES[c.topic];
    const words = WORDS[c.topic];
    const title = titles[Math.floor(rand() * titles.length)].replace('{x}', words[Math.floor(rand() * words.length)]);
    const video: Video = {
      videoId: `${c.id.slice(-6)}v${n}`,
      channelId: c.id,
      title,
      thumbnail: '',
      publishedAt: new Date(anchor - daysAgo * DAY).toISOString(),
    };
    daysAgo += minGap + rand() * (maxGap - minGap);
    return video;
  });
}

export const demoApi: YouTubeApi = {
  async ensureAuth() {
    return false;
  },
  hasValidToken: () => true,
  signOut() {},

  async fetchMyChannel() {
    reportCost(1);
    await wait(150);
    return { channelId: 'UCdemo-account', title: '샘플 계정', thumbnail: '' };
  },

  async fetchSubscriptions(onProgress) {
    const deleted = deletedIds();
    const items = channels.filter((c) => !deleted.has(c.id)).map((c) => toSubscription(c));
    for (let i = 0; i < items.length; i += 50) {
      reportCost(1);
      await wait(250);
      onProgress(Math.min(i + 50, items.length), items.length);
    }
    return { items, total: items.length };
  },

  async fetchChannelStats(channelIds, onProgress) {
    const out: Record<string, ChannelStats> = {};
    for (let i = 0; i < channelIds.length; i += 50) {
      reportCost(1);
      await wait(200);
      for (const id of channelIds.slice(i, i + 50)) {
        const c = byId.get(id);
        if (c) out[id] = c.stats;
      }
      onProgress(Math.min(i + 50, channelIds.length), channelIds.length);
    }
    return out;
  },

  async fetchActivity(channelId): Promise<ChannelActivity> {
    reportCost(1);
    await wait(40 + Math.random() * 120);
    const c = byId.get(channelId);
    const videos = c ? videosFor(c) : [];
    return { fetchedAt: Date.now(), lastUploadAt: videos[0]?.publishedAt ?? null, videos };
  },

  async deleteSubscription(subscriptionId) {
    reportCost(WRITE_COST);
    await wait(250);
    const id = subscriptionId.replace(/^sub-/, '');
    const deleted = deletedIds();
    if (!byId.has(id) || deleted.has(id)) {
      throw new ApiError(404, 'subscriptionNotFound', '이미 구독이 취소된 채널이에요.');
    }
    deleted.add(id);
    saveDeleted(deleted);
  },

  async insertSubscription(channelId) {
    reportCost(WRITE_COST);
    await wait(250);
    const c = byId.get(channelId);
    const deleted = deletedIds();
    if (!c) throw new ApiError(404, 'publisherNotFound', '채널을 찾을 수 없어요.');
    if (!deleted.has(channelId)) throw new ApiError(400, 'subscriptionDuplicate', '이미 구독 중인 채널이에요.');
    deleted.delete(channelId);
    saveDeleted(deleted);
    return toSubscription(c, new Date().toISOString());
  },
};

/** Brings back every sample channel, including ones unsubscribed in the sample. */
export function resetDemo() {
  try {
    localStorage.removeItem(DELETED_KEY);
  } catch {
    // Sample data only.
  }
}

/** Two starter groups so the sample shows how grouping works. */
export function demoGroups(): Group[] {
  const pick = (topic: Topic, count: number) =>
    channels.filter((c) => c.topic === topic).slice(0, count).map((c) => c.id);
  const now = Date.now();
  return [
    { id: 'g_demo_cook', name: '요리', color: '#f76b15', channelIds: pick('cook', 5), updatedAt: now },
    { id: 'g_demo_dev', name: '개발 공부', color: '#0090ff', channelIds: pick('dev', 6), updatedAt: now },
  ];
}
