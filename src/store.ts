import { create } from 'zustand';
import type {
  Account,
  Backup,
  ChannelActivity,
  ChannelStats,
  Group,
  Mode,
  Subscription,
  UnsubLogEntry,
} from './types';
import { GOOGLE_CLIENT_ID, SUBS_AUTO_SYNC_MS } from './config';
import { ApiError, AuthError, isFatal, setCostListener, uploadsPlaylistFor, type Prompt, type YouTubeApi } from './lib/api';
import { initAuth } from './lib/auth';
import { db } from './lib/db';
import { demoApi, demoGroups, resetDemo } from './lib/demo';
import { formatNumber } from './lib/format';
import { addQuota, readQuota } from './lib/quota';
import { liveApi } from './lib/youtube';

export const ALL = '__all';
export const UNGROUPED = '__ungrouped';

export const GROUP_COLORS = ['#e5484d', '#f76b15', '#d4a017', '#30a46c', '#12a594', '#0090ff', '#6e56cf', '#d6409f'];

export interface Task {
  label: string;
  done: number;
  total: number;
  cancel?: () => void;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

/** Everything saved per account in IndexedDB. */
interface Data {
  subs: Subscription[];
  subsSyncedAt: number | null;
  stats: Record<string, ChannelStats>;
  activity: Record<string, ChannelActivity>;
  groups: Group[];
  feedSeen: Record<string, number>;
  unsubLog: UnsubLogEntry[];
}

type DataKey = keyof Data;
const DATA_KEYS: DataKey[] = ['subs', 'subsSyncedAt', 'stats', 'activity', 'groups', 'feedSeen', 'unsubLog'];

const emptyData = (): Data => ({
  subs: [],
  subsSyncedAt: null,
  stats: {},
  activity: {},
  groups: [],
  feedSeen: {},
  unsubLog: [],
});

export interface State extends Data {
  mode: Mode;
  ready: boolean;
  initError: string | null;
  account: Account | null;
  authed: boolean;
  quotaUsed: number;
  task: Task | null;
  toasts: Toast[];
  view: 'channels' | 'feed';
  groupKey: string;

  init(mode: Mode): Promise<void>;
  signIn(prompt?: Prompt): Promise<void>;
  signOut(): void;
  forgetAccount(): Promise<void>;
  checkAuth(): void;
  syncSubscriptions(): Promise<void>;
  scanActivity(channelIds: string[], label: string): Promise<void>;
  unsubscribe(channelIds: string[]): Promise<void>;
  resubscribe(channelId: string): Promise<void>;
  createGroup(name: string, channelIds?: string[]): string | null;
  renameGroup(id: string, name: string): void;
  deleteGroup(id: string): void;
  addToGroup(id: string, channelIds: string[]): void;
  removeFromGroup(id: string, channelIds: string[]): void;
  toggleInGroup(id: string, channelId: string): void;
  markFeedSeen(key: string): void;
  exportBackup(): Backup;
  importBackup(backup: Backup): void;
  setView(view: State['view']): void;
  setGroupKey(key: string): void;
  toast(text: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
}

interface JobControl {
  cancelled(): boolean;
  progress(done: number, total?: number, label?: string): void;
}

let api: YouTubeApi = liveApi;
let toastSeq = 0;

const namespace = (mode: Mode, account: Account) => `${mode}:${account.channelId ?? 'default'}`;

export const useStore = create<State>()((set, get) => {
  const toast = (text: string, kind: Toast['kind'] = 'info') => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 4500);
  };

  const persist = (...keys: DataKey[]) => {
    const s = get();
    if (!s.account) return;
    const ns = namespace(s.mode, s.account);
    db.setMany(keys.map((k) => [`${ns}:${k}`, s[k]])).catch(() =>
      toast('브라우저에 데이터를 저장하지 못했어요. 저장 공간이나 사생활 보호 모드를 확인해 주세요.', 'error'),
    );
  };

  const rememberAccount = (account: Account) => {
    db.set(`${get().mode}:lastAccount`, account).catch(() => {});
  };

  const loadAccount = async (account: Account) => {
    const ns = namespace(get().mode, account);
    const values = await db.getMany(DATA_KEYS.map((k) => `${ns}:${k}`)).catch((): unknown[] => []);
    const data = emptyData();
    DATA_KEYS.forEach((k, i) => {
      if (values[i] !== undefined) Object.assign(data, { [k]: values[i] });
    });
    set({ ...data, account, groupKey: ALL });
    rememberAccount(account);
  };

  const handleError = (e: unknown) => {
    if (e instanceof AuthError) {
      if (e.code === 'superseded') return;
      if (e.code === 'expired') set({ authed: false });
      toast(e.message, e.code === 'popup_closed' ? 'info' : 'error');
      return;
    }
    if (e instanceof ApiError) {
      toast(e.message, 'error');
      return;
    }
    console.error(e);
    toast(`예상하지 못한 오류가 났어요: ${e instanceof Error ? e.message : String(e)}`, 'error');
  };

  /**
   * Makes sure there is a valid token and knows which channel it belongs to.
   * Call it before any other await in a click handler so the login popup may open.
   * Resolves true when the login switched to another channel.
   */
  const authorize = async (prompt: Prompt = ''): Promise<boolean> => {
    const fresh = await api.ensureAuth(prompt);
    set({ authed: true });
    const previous = get().account;
    if (!fresh && previous) return false;
    const account = await api.fetchMyChannel();
    if (previous && previous.channelId === account.channelId) {
      set({ account });
      rememberAccount(account);
      return false;
    }
    await loadAccount(account);
    if (previous) toast(`'${account.title}' 계정으로 로그인해서 이 계정의 데이터로 바꿨어요.`);
    return previous !== null;
  };

  /** Runs one job at a time behind the progress strip. */
  const runTask = async (
    label: string,
    job: (ctl: JobControl) => Promise<void>,
    options: { total?: number; cancellable?: boolean } = {},
  ) => {
    if (get().task) {
      toast('진행 중인 작업이 끝난 뒤에 다시 시도해 주세요.');
      return;
    }
    let cancelled = false;
    const cancel = options.cancellable ? () => void (cancelled = true) : undefined;
    set({ task: { label, done: 0, total: options.total ?? 0, cancel } });
    try {
      await job({
        cancelled: () => cancelled,
        progress: (done, total, nextLabel) =>
          set((s) => ({
            task: s.task && { ...s.task, done, total: total ?? s.task.total, label: nextLabel ?? s.task.label },
          })),
      });
    } catch (e) {
      handleError(e);
    } finally {
      set({ task: null });
    }
  };

  return {
    ...emptyData(),
    mode: 'live',
    ready: false,
    initError: null,
    account: null,
    authed: false,
    quotaUsed: 0,
    task: null,
    toasts: [],
    view: 'channels',
    groupKey: ALL,

    async init(mode) {
      api = mode === 'demo' ? demoApi : liveApi;
      setCostListener((units) => set({ quotaUsed: addQuota(mode, units) }));
      set({ mode, quotaUsed: readQuota(mode), authed: api.hasValidToken() });
      const last = await db.get<Account>(`${mode}:lastAccount`).catch(() => undefined);
      if (last) await loadAccount(last);
      if (mode === 'live' && GOOGLE_CLIENT_ID) {
        try {
          await initAuth(GOOGLE_CLIENT_ID);
        } catch (e) {
          set({ initError: e instanceof Error ? e.message : String(e) });
        }
      }
      set({ ready: true });
      if (mode === 'demo' && !last) await get().signIn();
    },

    async signIn(prompt = '') {
      try {
        await authorize(prompt);
      } catch (e) {
        handleError(e);
        return;
      }
      const s = get();
      if (s.mode === 'demo' && !s.subsSyncedAt) {
        await get().syncSubscriptions();
        if (!get().groups.length) {
          set({ groups: demoGroups() });
          persist('groups');
        }
        return;
      }
      if (!s.subsSyncedAt || Date.now() - s.subsSyncedAt > SUBS_AUTO_SYNC_MS) await get().syncSubscriptions();
    },

    signOut() {
      api.signOut();
      set({ authed: false });
      toast('로그아웃했어요. 불러온 목록과 그룹은 이 브라우저에 남아 있어요.');
    },

    async forgetAccount() {
      const s = get();
      api.signOut();
      if (s.account) {
        const ns = namespace(s.mode, s.account);
        await db.delMany([...DATA_KEYS.map((k) => `${ns}:${k}`), `${s.mode}:lastAccount`]).catch(() => {});
      }
      set({ ...emptyData(), account: null, authed: api.hasValidToken(), view: 'channels', groupKey: ALL });
      // The sample has no login screen, so start it over.
      if (s.mode === 'demo') {
        resetDemo();
        await get().signIn();
      }
    },

    checkAuth() {
      const authed = api.hasValidToken();
      if (authed !== get().authed) set({ authed });
    },

    syncSubscriptions: () =>
      runTask('구독 목록을 불러오는 중', async ({ progress }) => {
        await authorize();
        const { items, total } = await api.fetchSubscriptions((done, t) => progress(done, t));
        progress(0, items.length, '채널 정보를 불러오는 중');
        const stats = await api.fetchChannelStats(
          items.map((i) => i.channelId),
          (done, t) => progress(done, t),
        );
        const ids = new Set(items.map((i) => i.channelId));
        set((s) => ({
          subs: items,
          subsSyncedAt: Date.now(),
          stats: { ...s.stats, ...stats },
          groups: s.groups.map((g) => ({ ...g, channelIds: g.channelIds.filter((id) => ids.has(id)) })),
        }));
        persist('subs', 'subsSyncedAt', 'stats', 'groups');
        toast(`구독 채널 ${formatNumber(items.length)}개를 불러왔어요.`, 'success');
        if (total - items.length > 5) {
          toast(`YouTube가 알려준 구독 수보다 ${total - items.length}개 적게 불러왔어요. 정지됐거나 비공개로 바뀐 채널일 수 있어요.`);
        }
      }),

    scanActivity: (channelIds, label) =>
      runTask(
        label,
        async ({ cancelled, progress }) => {
          if (await authorize()) return;
          const subscribed = new Set(get().subs.map((s) => s.channelId));
          const ids = channelIds.filter((id) => subscribed.has(id));
          const run = { next: 0, done: 0, failed: 0, fatal: null as unknown };
          let batch: Record<string, ChannelActivity> = {};
          const flush = () => {
            const b = batch;
            batch = {};
            if (Object.keys(b).length) set((s) => ({ activity: { ...s.activity, ...b } }));
          };
          const worker = async () => {
            while (!cancelled() && run.fatal === null && run.next < ids.length) {
              const id = ids[run.next++];
              const playlist = get().stats[id]?.uploadsPlaylistId ?? uploadsPlaylistFor(id);
              try {
                // Await first: `batch[id] = await ...` would write into the batch captured before a flush.
                const result = await api.fetchActivity(id, playlist);
                batch[id] = result;
              } catch (e) {
                if (isFatal(e)) {
                  run.fatal = e;
                  return;
                }
                run.failed++;
              }
              run.done++;
              if (run.done % 10 === 0) {
                flush();
                progress(run.done, ids.length);
              }
            }
          };
          progress(0, ids.length);
          await Promise.all(Array.from({ length: Math.min(5, ids.length) }, worker));
          flush();
          persist('activity');
          if (run.fatal !== null) throw run.fatal;
          if (cancelled()) toast(`중지했어요. 채널 ${run.done}개를 확인했어요.`);
          if (run.failed) toast(`채널 ${run.failed}개는 확인하지 못했어요.`, 'error');
        },
        { total: channelIds.length, cancellable: true },
      ),

    unsubscribe: (channelIds) =>
      runTask(
        '구독을 취소하는 중',
        async ({ cancelled, progress }) => {
          if (await authorize()) return;
          const wanted = new Set(channelIds);
          const targets = get().subs.filter((s) => wanted.has(s.channelId));
          const removed = new Set<string>();
          const logs: UnsubLogEntry[] = [];
          let failed = 0;
          let fatal: unknown = null;
          for (const [i, sub] of targets.entries()) {
            if (cancelled()) break;
            try {
              await api.deleteSubscription(sub.subscriptionId);
              removed.add(sub.channelId);
              logs.push({
                channelId: sub.channelId,
                title: sub.title,
                thumbnail: sub.thumbnail,
                subscribedAt: sub.subscribedAt,
                unsubscribedAt: new Date().toISOString(),
                groupIds: get()
                  .groups.filter((g) => g.channelIds.includes(sub.channelId))
                  .map((g) => g.id),
              });
            } catch (e) {
              if (e instanceof ApiError && e.reason === 'subscriptionNotFound') {
                removed.add(sub.channelId);
              } else if (isFatal(e)) {
                fatal = e;
                break;
              } else {
                failed++;
              }
            }
            progress(i + 1, targets.length);
          }
          // Save what succeeded even when the batch stopped early.
          if (removed.size) {
            set((s) => ({
              subs: s.subs.filter((x) => !removed.has(x.channelId)),
              groups: s.groups.map((g) => ({ ...g, channelIds: g.channelIds.filter((id) => !removed.has(id)) })),
              unsubLog: [...logs.reverse(), ...s.unsubLog].slice(0, 500),
            }));
            persist('subs', 'groups', 'unsubLog');
            toast(`채널 ${removed.size}개의 구독을 취소했어요.`, 'success');
          }
          if (failed) toast(`채널 ${failed}개는 구독을 취소하지 못했어요.`, 'error');
          if (fatal !== null) throw fatal;
        },
        { total: channelIds.length, cancellable: true },
      ),

    resubscribe: (channelId) =>
      runTask(
        '다시 구독하는 중',
        async () => {
          if (await authorize()) return;
          const entry = get().unsubLog.find((l) => l.channelId === channelId);
          let added: Subscription | null = null;
          try {
            added = await api.insertSubscription(channelId);
          } catch (e) {
            if (!(e instanceof ApiError && e.reason === 'subscriptionDuplicate')) throw e;
          }
          const sub = added;
          set((s) => ({
            subs: sub && !s.subs.some((x) => x.channelId === channelId) ? [...s.subs, sub] : s.subs,
            unsubLog: s.unsubLog.filter((l) => l.channelId !== channelId),
            groups: s.groups.map((g) =>
              entry?.groupIds.includes(g.id) && !g.channelIds.includes(channelId)
                ? { ...g, channelIds: [...g.channelIds, channelId] }
                : g,
            ),
          }));
          persist('subs', 'unsubLog', 'groups');
          toast(sub ? `'${sub.title}' 채널을 다시 구독했어요.` : '이미 구독 중인 채널이라 기록에서 지웠어요.', 'success');
        },
        { total: 1 },
      ),

    createGroup(name, channelIds = []) {
      const trimmed = name.trim().slice(0, 40);
      if (!trimmed) return null;
      const existing = get().groups.find((g) => g.name === trimmed);
      if (existing) {
        if (channelIds.length) get().addToGroup(existing.id, channelIds);
        return existing.id;
      }
      const groups = get().groups;
      const used = new Set(groups.map((g) => g.color));
      const color = GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[groups.length % GROUP_COLORS.length];
      const id = `g_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      set({ groups: [...groups, { id, name: trimmed, color, channelIds: [...new Set(channelIds)] }] });
      persist('groups');
      return id;
    },

    renameGroup(id, name) {
      const trimmed = name.trim().slice(0, 40);
      if (!trimmed) return;
      set((s) => ({ groups: s.groups.map((g) => (g.id === id ? { ...g, name: trimmed } : g)) }));
      persist('groups');
    },

    deleteGroup(id) {
      set((s) => {
        const feedSeen = { ...s.feedSeen };
        delete feedSeen[id];
        return {
          groups: s.groups.filter((g) => g.id !== id),
          feedSeen,
          groupKey: s.groupKey === id ? ALL : s.groupKey,
        };
      });
      persist('groups', 'feedSeen');
    },

    addToGroup(id, channelIds) {
      set((s) => ({
        groups: s.groups.map((g) =>
          g.id === id ? { ...g, channelIds: [...new Set([...g.channelIds, ...channelIds])] } : g,
        ),
      }));
      persist('groups');
    },

    removeFromGroup(id, channelIds) {
      const drop = new Set(channelIds);
      set((s) => ({
        groups: s.groups.map((g) => (g.id === id ? { ...g, channelIds: g.channelIds.filter((c) => !drop.has(c)) } : g)),
      }));
      persist('groups');
    },

    toggleInGroup(id, channelId) {
      const group = get().groups.find((g) => g.id === id);
      if (!group) return;
      if (group.channelIds.includes(channelId)) get().removeFromGroup(id, [channelId]);
      else get().addToGroup(id, [channelId]);
    },

    markFeedSeen(key) {
      set((s) => ({ feedSeen: { ...s.feedSeen, [key]: Date.now() } }));
      persist('feedSeen');
    },

    exportBackup() {
      const s = get();
      return {
        app: 'SubManager',
        version: 1,
        exportedAt: new Date().toISOString(),
        account: s.account,
        groups: s.groups,
        unsubLog: s.unsubLog,
        feedSeen: s.feedSeen,
      };
    },

    importBackup(backup) {
      set({ groups: backup.groups, unsubLog: backup.unsubLog, feedSeen: backup.feedSeen, groupKey: ALL });
      persist('groups', 'unsubLog', 'feedSeen');
      toast(`백업에서 그룹 ${backup.groups.length}개를 가져왔어요.`, 'success');
    },

    setView: (view) => set({ view }),
    setGroupKey: (groupKey) => set({ groupKey }),
    toast,
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  };
});
