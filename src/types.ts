export type Mode = 'live' | 'demo';

export interface Account {
  channelId: string | null;
  title: string;
  thumbnail: string;
}

export interface Subscription {
  subscriptionId: string;
  channelId: string;
  title: string;
  description: string;
  thumbnail: string;
  /** When the subscription was created (a re-subscription resets it). */
  subscribedAt: string;
}

export interface ChannelStats {
  /** null when the channel hides its subscriber count. */
  subscriberCount: number | null;
  videoCount: number | null;
  uploadsPlaylistId: string | null;
  /** YouTube's topic categories for the channel, e.g. "Music", "Video game culture". */
  topics?: string[];
}

export interface Video {
  videoId: string;
  channelId: string;
  title: string;
  thumbnail: string;
  publishedAt: string;
}

export interface ChannelActivity {
  fetchedAt: number;
  /** null when the channel has no public uploads. */
  lastUploadAt: string | null;
  /** Newest first. */
  videos: Video[];
}

export interface Group {
  id: string;
  name: string;
  color: string;
  channelIds: string[];
  /** Last edit time; the newer copy wins when two devices changed the same group. Missing in old data. */
  updatedAt?: number;
}

export interface UnsubLogEntry {
  channelId: string;
  title: string;
  thumbnail: string;
  subscribedAt: string;
  unsubscribedAt: string;
  /** Groups the channel belonged to, restored on re-subscribe. */
  groupIds: string[];
}

export interface Backup {
  app: 'SubManager';
  version: 1;
  exportedAt: string;
  account: Account | null;
  groups: Group[];
  unsubLog: UnsubLogEntry[];
  feedSeen: Record<string, number>;
}
