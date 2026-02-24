/**
 * DB-backed channel conversation history with LRU cache.
 *
 * Replaces the in-memory Map in handler.ts so history survives server restarts.
 * Uses a simple LRU cache (64 entries) to avoid hitting the DB on every message.
 */

import { getDb } from '@/db';
import { channelConversations } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

export type HistoryMessage = { role: 'user' | 'assistant'; content: string };

const MAX_HISTORY = 20;
const LRU_CAPACITY = 64;

// ── LRU Cache ──

interface CacheEntry {
  key: string;
  messages: HistoryMessage[];
  dirty: boolean;
}

class LRUCache {
  private map = new Map<string, CacheEntry>();
  private order: string[] = [];

  get(key: string): CacheEntry | undefined {
    const entry = this.map.get(key);
    if (entry) {
      // Move to end (most recent)
      this.order = this.order.filter((k) => k !== key);
      this.order.push(key);
    }
    return entry;
  }

  set(key: string, messages: HistoryMessage[], dirty: boolean): void {
    if (this.map.has(key)) {
      this.order = this.order.filter((k) => k !== key);
    }
    this.map.set(key, { key, messages, dirty });
    this.order.push(key);

    // Evict if over capacity
    while (this.order.length > LRU_CAPACITY) {
      const evictKey = this.order.shift()!;
      const evicted = this.map.get(evictKey);
      if (evicted?.dirty) {
        // Fire-and-forget flush
        flushToDB(evictKey, evicted.messages).catch(() => {});
      }
      this.map.delete(evictKey);
    }
  }

  markDirty(key: string): void {
    const entry = this.map.get(key);
    if (entry) entry.dirty = true;
  }

  /** Flush all dirty entries (call on shutdown) */
  async flushAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const entry of this.map.values()) {
      if (entry.dirty) {
        promises.push(flushToDB(entry.key, entry.messages));
        entry.dirty = false;
      }
    }
    await Promise.allSettled(promises);
  }
}

const cache = new LRUCache();

// ── DB Operations ──

/** Parse cache key back to userId + channelKey */
function parseKey(key: string): { userId: string; channelKey: string } {
  const idx = key.indexOf('|');
  return { userId: key.slice(0, idx), channelKey: key.slice(idx + 1) };
}

function makeKey(userId: string, channelType: string, channelUserId: string): string {
  return `${userId}|${channelType}:${channelUserId}`;
}

async function flushToDB(key: string, messages: HistoryMessage[]): Promise<void> {
  try {
    const { userId, channelKey } = parseKey(key);
    const [channelType, channelUserId] = channelKey.split(':');
    const db = getDb();
    await db
      .insert(channelConversations)
      .values({
        userId,
        channelType,
        channelUserId,
        messages: JSON.stringify(messages),
      })
      .onConflictDoUpdate({
        target: [channelConversations.userId, channelConversations.channelType, channelConversations.channelUserId],
        set: { messages: JSON.stringify(messages), updatedAt: new Date().toISOString() },
      });
  } catch (err) {
    console.error('[history-store] flush error:', err);
  }
}

async function loadFromDB(userId: string, channelType: string, channelUserId: string): Promise<HistoryMessage[]> {
  try {
    const db = getDb();
    const [row] = await db
      .select()
      .from(channelConversations)
      .where(
        and(
          eq(channelConversations.userId, userId),
          eq(channelConversations.channelType, channelType),
          eq(channelConversations.channelUserId, channelUserId),
        ),
      );
    if (row?.messages) {
      const parsed = typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages;
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    // DB unavailable — start fresh
  }
  return [];
}

// ── Public API ──

/**
 * Get conversation history for a channel user.
 * Checks LRU cache first, falls back to DB.
 */
export async function getHistory(
  userId: string,
  channelType: string,
  channelUserId: string,
): Promise<HistoryMessage[]> {
  const key = makeKey(userId, channelType, channelUserId);
  const cached = cache.get(key);
  if (cached) return cached.messages;

  const messages = await loadFromDB(userId, channelType, channelUserId);
  cache.set(key, messages, false);
  return messages;
}

/**
 * Append a message to the conversation history.
 * Updates cache and marks for lazy DB flush.
 */
export async function appendMessage(
  userId: string,
  channelType: string,
  channelUserId: string,
  message: HistoryMessage,
): Promise<HistoryMessage[]> {
  const key = makeKey(userId, channelType, channelUserId);
  let messages = (cache.get(key))?.messages;
  if (!messages) {
    messages = await loadFromDB(userId, channelType, channelUserId);
  }

  messages.push(message);
  // Trim to max history (keeping pairs)
  if (messages.length > MAX_HISTORY * 2) {
    messages = messages.slice(-MAX_HISTORY * 2);
  }

  cache.set(key, messages, true);

  // Flush to DB on every assistant reply (every other message)
  if (message.role === 'assistant') {
    flushToDB(key, messages).catch(() => {});
  }

  return messages;
}

/** Flush all pending writes (call during graceful shutdown) */
export async function flushAllHistory(): Promise<void> {
  await cache.flushAll();
}
