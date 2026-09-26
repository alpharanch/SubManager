import type { Account, ChannelActivity, ChannelStats, Subscription } from '../types';

export type Progress = (done: number, total: number) => void;
export type Prompt = '' | 'select_account';

/** Shared by the real YouTube client and the sample-data client. */
export interface YouTubeApi {
  /** Resolves true when a new token was obtained (the account may have changed). */
  ensureAuth(prompt?: Prompt): Promise<boolean>;
  hasValidToken(): boolean;
  signOut(): void;
  fetchMyChannel(): Promise<Account>;
  fetchSubscriptions(onProgress: Progress): Promise<{ items: Subscription[]; total: number }>;
  fetchChannelStats(channelIds: string[], onProgress: Progress): Promise<Record<string, ChannelStats>>;
  fetchActivity(channelId: string, uploadsPlaylistId: string): Promise<ChannelActivity>;
  deleteSubscription(subscriptionId: string): Promise<void>;
  insertSubscription(channelId: string): Promise<Subscription>;
}

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const FATAL_REASONS = new Set([
  'quotaExceeded',
  'dailyLimitExceeded',
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'insufficientPermissions',
  'accessNotConfigured',
  'SERVICE_DISABLED',
]);

/** Errors that should stop a batch instead of skipping a single channel. */
export function isFatal(e: unknown): boolean {
  if (e instanceof ApiError) return e.status === 0 || FATAL_REASONS.has(e.reason);
  return true;
}

let costListener: (units: number) => void = () => {};

export function setCostListener(fn: (units: number) => void) {
  costListener = fn;
}

export function reportCost(units: number) {
  costListener(units);
}

/** Every channel's uploads playlist is its channel ID with UC replaced by UU. */
export function uploadsPlaylistFor(channelId: string): string {
  return channelId.startsWith('UC') ? `UU${channelId.slice(2)}` : channelId;
}

export const channelUrl = (channelId: string) => `https://www.youtube.com/channel/${channelId}`;
export const videoUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;
