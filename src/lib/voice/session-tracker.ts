import { getDb } from '@/db';
import { conversations } from '@/db/schema';
import { eq, and, desc, gte } from 'drizzle-orm';

const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

interface VoiceSession {
  conversationId: string;
  lastActivityAt: number;
}

// In-memory session map — re-derived from DB on cold start
const sessions = new Map<string, VoiceSession>();

/**
 * Get or create a voice conversation session for a user.
 *
 * Groups individual ElevenLabs turns into conversation sessions:
 * - If an active session exists (within 10-min timeout), reuse it
 * - On cold start, re-derive from DB (last voice conversation within timeout)
 * - If no active session, create a new conversation row
 *
 * All DB operations are fire-and-forget safe — caller should catch errors.
 */
export async function getOrCreateVoiceSession(userId: string): Promise<string> {
  // 1. Check in-memory cache
  const cached = sessions.get(userId);
  if (cached && Date.now() - cached.lastActivityAt < SESSION_TIMEOUT_MS) {
    cached.lastActivityAt = Date.now();
    return cached.conversationId;
  }

  // 2. Cold start — try to recover from DB
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - SESSION_TIMEOUT_MS).toISOString();
    const [recent] = await db
      .select({ id: conversations.id, updatedAt: conversations.updatedAt })
      .from(conversations)
      .where(
        and(
          eq(conversations.userId, userId),
          eq(conversations.channel, 'voice'),
          gte(conversations.updatedAt, cutoff),
        ),
      )
      .orderBy(desc(conversations.updatedAt))
      .limit(1);

    if (recent) {
      sessions.set(userId, {
        conversationId: recent.id,
        lastActivityAt: Date.now(),
      });
      return recent.id;
    }
  } catch (err) {
    console.error('[voice-session] DB recovery failed:', err);
  }

  // 3. No active session — create new conversation
  const db = getDb();
  const [row] = await db
    .insert(conversations)
    .values({
      userId,
      title: 'Voice conversation',
      channel: 'voice',
    })
    .returning({ id: conversations.id });

  sessions.set(userId, {
    conversationId: row.id,
    lastActivityAt: Date.now(),
  });

  console.log(`[voice-session] New voice session created: ${row.id}`);
  return row.id;
}

/**
 * Touch a session's last activity timestamp (called after each turn).
 * Also updates the conversation's updatedAt in DB for cold-start recovery.
 */
export async function touchSession(userId: string, conversationId: string): Promise<void> {
  const cached = sessions.get(userId);
  if (cached && cached.conversationId === conversationId) {
    cached.lastActivityAt = Date.now();
  }

  try {
    const db = getDb();
    await db
      .update(conversations)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(conversations.id, conversationId));
  } catch {
    // Non-critical — session still works from memory
  }
}
