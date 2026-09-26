export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim();

/** Needed for subscriptions.delete / insert; the read-only scope cannot unsubscribe. */
export const YT_SCOPE = 'https://www.googleapis.com/auth/youtube';

/** Default YouTube Data API quota per Google Cloud project per day. */
export const DAILY_QUOTA = 10_000;
export const WRITE_COST = 50;

/** Feed data older than this is refetched when a group feed is opened. */
export const FEED_TTL_MS = 30 * 60 * 1000;
/** "Last upload" data older than this counts as unchecked in the channel list. */
export const SCAN_TTL_MS = 24 * 60 * 60 * 1000;
/** A group feed refreshes by itself only when it costs at most this many units. */
export const FEED_AUTO_LIMIT = 50;
/** On login, the subscription list is refetched when older than this. */
export const SUBS_AUTO_SYNC_MS = 6 * 60 * 60 * 1000;
