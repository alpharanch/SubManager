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
import { GOOGLE_CLIENT_ID, SUBS_AUTO_SYNC_MS, SYNC_DEBOUNCE_MS, SYNC_STALE_MS } from './config';
import { ApiError, AuthError, isFatal, setCostListener, uploadsPlaylistFor, type Prompt, type YouTubeApi } from './lib/api';
import { hasDriveAccess, initAuth } from './lib/auth';
import { db } from './lib/db';
import { demoApi, demoGroups, resetDemo } from './lib/demo';
import { DriveError, createAppFile, findAppFile, readAppFile, updateAppFile } from './lib/drive';
import { formatNumber } from './lib/format';
import { addQuota, readQuota } from './lib/quota';
import { mergeSyncData, parseSyncDoc, sameSyncData, toSyncDoc, type SyncData } from './lib/sync';
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

export interface SyncMeta {
  fileId: string | null;
  /** Edits not yet saved to Drive. */
  dirty: boolean;
  lastSyncAt: number | null;
}

/** Everything saved per account in IndexedDB. */
interface Data {
  subs: Subscription[];
  subsSyncedAt: number | null;
  stats: Record<string, ChannelStats>;
  activity: Record<string, ChannelActivity>;
  groups: Group[];
  deletedGroups: Record<string, number>;
  feedSeen: Record<string, number>;
  unsubLog: UnsubLogEntry[];
  removedLog: Record<string, number>;
  syncMeta: SyncMeta;
}

type DataKey = keyof Data;
const DATA_KEYS: DataKey[] = [
  'subs',
  'subsSyncedAt',
  'stats',
  'activity',
  'groups',
  'deletedGroups',
  'feedSeen',
  'unsubLog',
  'removedLog',
  'syncMeta',
];
/** Keys shared between devices through Drive; the rest can be refetched from YouTube. */
const SYNCED_KEYS: DataKey[] = ['groups', 'deletedGroups', 'feedSeen', 'unsubLog', 'removedLog'];

const emptyData = (): Data => ({
  subs: [],
  subsSyncedAt: null,
  stats: {},
  activity: {},
  groups: [],
  deletedGroups: {},
  feedSeen: {},
  unsubLog: [],
  removedLog: {},
  syncMeta: { fileId: null, dirty: false, lastSyncAt: null },
});

const syncDataOf = (d: Data): SyncData => ({
  groups: d.groups,
  deletedGroups: d.deletedGroups,
  unsubLog: d.unsubLog,
  removedLog: d.removedLog,
  feedSeen: d.feedSeen,
});

export interface State extends Data {
  mode: Mode;
  ready: boolean;
  initError: string | null;
  account: Account | null;
  authed: boolean;
  /** The token also carries the Drive permission. */
  driveAccess: boolean;
  syncRunning: boolean;
  syncError: string | null;
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
  connectDrive(): Promise<void>;
  syncNow(): Promise<void>;
  syncIfStale(): void;
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
  // Counts local edits to synced data, so a sync can tell whether more edits arrived while it ran.
  let editSeq = 0;
  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  let syncing = false;
  let syncAgain = false;

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

  const canSync = () => {
    const s = get();
    return s.mode === 'live' && s.account !== null && hasDriveAccess();
  };

  const scheduleSync = () => {
    clearTimeout(syncTimer);
    if (canSync()) syncTimer = setTimeout(() => void get().syncNow(), SYNC_DEBOUNCE_MS);
  };

  /** Saves changed keys; edits to groups and the log are also sent to Drive shortly after. */
  const commit = (...keys: DataKey[]) => {
    if (!keys.some((k) => SYNCED_KEYS.includes(k))) {
      persist(...keys);
      return;
    }
    editSeq++;
    set((s) => ({ syncMeta: { ...s.syncMeta, dirty: true } }));
    persist(...keys, 'syncMeta');
    scheduleSync();
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
    set({ ...data, account, groupKey: ALL, syncError: null });
    rememberAccount(account);
  };

  const handleError = (e: unknown) => {
    if (e instanceof AuthError) {
      if (e.code === 'superseded') return;
      if (e.code === 'expired') set({ authed: false, driveAccess: false });
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
  const authorize = async (prompt: Prompt = '', force = false): Promise<boolean> => {
    const fresh = await api.ensureAuth(prompt, force);
    set({ authed: true, driveAccess: get().mode === 'live' && hasDriveAccess() });
    const previous = get().account;
    if (!fresh && previous) return false;
    const account = await api.fetchMyChannel();
    if (previous && previous.channelId === account.channelId) {
      set({ account });
      rememberAccount(account);
      void get().syncNow();
      return false;
    }
    await loadAccount(account);
    void get().syncNow();
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

  const withGroup = (id: string, change: (g: Group) => Group) =>
    set((s) => ({ groups: s.groups.map((g) => (g.id === id ? change(g) : g)) }));

  return {
    ...emptyData(),
    mode: 'live',
    ready: false,
    initError: null,
    account: null,
    authed: false,
    driveAccess: false,
    syncRunning: false,
    syncError: null,
    quotaUsed: 0,
    task: null,
    toasts: [],
    view: 'channels',
    groupKey: ALL,

    async init(mode) {
      api = mode === 'demo' ? demoApi : liveApi;
      setCostListener((units) => set({ quotaUsed: addQuota(mode, units) }));
      set({
        mode,
        quotaUsed: readQuota(mode),
        authed: api.hasValidToken(),
        driveAccess: mode === 'live' && hasDriveAccess(),
      });
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
      // A token kept from earlier in this tab: pick up edits made on other devices.
      void get().syncNow();
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
          commit('groups');
        }
        return;
      }
      if (!s.subsSyncedAt || Date.now() - s.subsSyncedAt > SUBS_AUTO_SYNC_MS) await get().syncSubscriptions();
    },

    signOut() {
      api.signOut();
      clearTimeout(syncTimer);
      set({ authed: false, driveAccess: false });
      toast('로그아웃했어요. 불러온 목록과 그룹은 이 브라우저에 남아 있어요.');
    },

    async forgetAccount() {
      const s = get();
      api.signOut();
      clearTimeout(syncTimer);
      if (s.account) {
        const ns = namespace(s.mode, s.account);
        await db.delMany([...DATA_KEYS.map((k) => `${ns}:${k}`), `${s.mode}:lastAccount`]).catch(() => {});
      }
      set({
        ...emptyData(),
        account: null,
        authed: api.hasValidToken(),
        driveAccess: false,
        syncError: null,
        view: 'channels',
        groupKey: ALL,
      });
      // The sample has no login screen, so start it over.
      if (s.mode === 'demo') {
        resetDemo();
        await get().signIn();
      }
    },

    checkAuth() {
      const authed = api.hasValidToken();
      const driveAccess = get().mode === 'live' && hasDriveAccess();
      if (authed !== get().authed || driveAccess !== get().driveAccess) set({ authed, driveAccess });
    },

    async connectDrive() {
      try {
        // A new token request: the consent screen then asks for the missing Drive permission.
        await authorize('', true);
      } catch (e) {
        handleError(e);
        return;
      }
      if (!hasDriveAccess()) {
        toast('드라이브 권한이 허용되지 않았어요. 권한 요청 화면에서 드라이브 항목에 체크해 주세요.', 'error');
      }
    },

    async syncNow() {
      if (!canSync()) return;
      if (syncing) {
        syncAgain = true;
        return;
      }
      syncing = true;
      clearTimeout(syncTimer);
      set({ syncRunning: true });
      const account = get().account!;
      const name = `submanager-${account.channelId ?? 'default'}.json`;
      const sameAccount = () => get().account?.channelId === account.channelId;
      try {
        let fileId = get().syncMeta.fileId;
        let remote: SyncData | null = null;
        if (fileId) {
          try {
            remote = parseSyncDoc(await readAppFile(fileId));
          } catch (e) {
            if (!(e instanceof DriveError && e.status === 404)) throw e;
            fileId = null;
          }
        }
        if (!fileId) {
          fileId = await findAppFile(name);
          if (fileId) remote = parseSyncDoc(await readAppFile(fileId));
        }
        if (!sameAccount()) return;

        // Merge with what is in the browser right now, so edits made during the requests are kept.
        const seq = editSeq;
        const local = syncDataOf(get());
        const merged = remote ? mergeSyncData(local, remote) : local;
        if (!sameSyncData(merged, local)) {
          set((s) => ({
            ...merged,
            groupKey: s.groupKey.startsWith('__') || merged.groups.some((g) => g.id === s.groupKey) ? s.groupKey : ALL,
          }));
          persist(...SYNCED_KEYS);
        }
        if (!remote || !sameSyncData(merged, remote)) {
          const doc = toSyncDoc(merged);
          if (fileId) await updateAppFile(fileId, doc);
          else fileId = await createAppFile(name, doc);
        }
        if (!sameAccount()) return;
        set({ syncError: null, syncMeta: { fileId, dirty: editSeq !== seq, lastSyncAt: Date.now() } });
        persist('syncMeta');
      } catch (e) {
        if (e instanceof DriveError && e.status === 401) set({ authed: false, driveAccess: false });
        if (e instanceof DriveError && e.reason === 'insufficientPermissions') set({ driveAccess: false });
        set({ syncError: e instanceof Error ? e.message : String(e) });
      } finally {
        syncing = false;
        set({ syncRunning: false });
        if (syncAgain) {
          syncAgain = false;
          void get().syncNow();
        }
      }
    },

    syncIfStale() {
      const { syncMeta } = get();
      if (!canSync()) return;
      if (syncMeta.dirty || !syncMeta.lastSyncAt || Date.now() - syncMeta.lastSyncAt > SYNC_STALE_MS) {
        void get().syncNow();
      }
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
        // Groups keep channels that are no longer subscribed; lists only show subscribed ones.
        set((s) => ({ subs: items, subsSyncedAt: Date.now(), stats: { ...s.stats, ...stats } }));
        persist('subs', 'subsSyncedAt', 'stats');
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
            const now = Date.now();
            set((s) => ({
              subs: s.subs.filter((x) => !removed.has(x.channelId)),
              groups: s.groups.map((g) =>
                g.channelIds.some((id) => removed.has(id))
                  ? { ...g, channelIds: g.channelIds.filter((id) => !removed.has(id)), updatedAt: now }
                  : g,
              ),
              unsubLog: [...logs.reverse(), ...s.unsubLog].slice(0, 500),
            }));
            commit('subs', 'groups', 'unsubLog');
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
          const now = Date.now();
          set((s) => ({
            subs: sub && !s.subs.some((x) => x.channelId === channelId) ? [...s.subs, sub] : s.subs,
            unsubLog: s.unsubLog.filter((l) => l.channelId !== channelId),
            removedLog: { ...s.removedLog, [channelId]: now },
            groups: s.groups.map((g) =>
              entry?.groupIds.includes(g.id) && !g.channelIds.includes(channelId)
                ? { ...g, channelIds: [...g.channelIds, channelId], updatedAt: now }
                : g,
            ),
          }));
          commit('subs', 'unsubLog', 'removedLog', 'groups');
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
      set({
        groups: [...groups, { id, name: trimmed, color, channelIds: [...new Set(channelIds)], updatedAt: Date.now() }],
      });
      commit('groups');
      return id;
    },

    renameGroup(id, name) {
      const trimmed = name.trim().slice(0, 40);
      if (!trimmed) return;
      withGroup(id, (g) => (g.name === trimmed ? g : { ...g, name: trimmed, updatedAt: Date.now() }));
      commit('groups');
    },

    deleteGroup(id) {
      set((s) => {
        const feedSeen = { ...s.feedSeen };
        delete feedSeen[id];
        return {
          groups: s.groups.filter((g) => g.id !== id),
          deletedGroups: { ...s.deletedGroups, [id]: Date.now() },
          feedSeen,
          groupKey: s.groupKey === id ? ALL : s.groupKey,
        };
      });
      commit('groups', 'deletedGroups', 'feedSeen');
    },

    addToGroup(id, channelIds) {
      withGroup(id, (g) => {
        const next = [...new Set([...g.channelIds, ...channelIds])];
        return next.length === g.channelIds.length ? g : { ...g, channelIds: next, updatedAt: Date.now() };
      });
      commit('groups');
    },

    removeFromGroup(id, channelIds) {
      const drop = new Set(channelIds);
      withGroup(id, (g) => {
        const next = g.channelIds.filter((c) => !drop.has(c));
        return next.length === g.channelIds.length ? g : { ...g, channelIds: next, updatedAt: Date.now() };
      });
      commit('groups');
    },

    toggleInGroup(id, channelId) {
      const group = get().groups.find((g) => g.id === id);
      if (!group) return;
      if (group.channelIds.includes(channelId)) get().removeFromGroup(id, [channelId]);
      else get().addToGroup(id, [channelId]);
    },

    markFeedSeen(key) {
      set((s) => ({ feedSeen: { ...s.feedSeen, [key]: Date.now() } }));
      commit('feedSeen');
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
      const now = Date.now();
      set((s) => {
        // The backup replaces the groups: current groups missing from it count as deleted now,
        // and imported groups count as edited now so they win on other devices too.
        const incoming = new Set(backup.groups.map((g) => g.id));
        const deletedGroups: Record<string, number> = {};
        for (const g of s.groups) if (!incoming.has(g.id)) deletedGroups[g.id] = now;
        const imported: SyncData = {
          groups: backup.groups.map((g) => ({ ...g, updatedAt: now })),
          deletedGroups,
          unsubLog: backup.unsubLog,
          removedLog: {},
          feedSeen: backup.feedSeen,
        };
        return { ...mergeSyncData(syncDataOf(s), imported, now), groupKey: ALL };
      });
      commit(...SYNCED_KEYS);
      toast(`백업에서 그룹 ${backup.groups.length}개를 가져왔어요.`, 'success');
    },

    setView: (view) => set({ view }),
    setGroupKey: (groupKey) => set({ groupKey }),
    toast,
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  };
});
