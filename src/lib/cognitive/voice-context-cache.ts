import { enrichWithCognition } from '@/lib/cognitive-middleware';
import { getRecentMemories } from '@/lib/memory/manager';
import { callOpenClaw } from '@/lib/openclaw-rpc';
import { getDb } from '@/db';
import { agentFiles } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { SelfState } from '@/core/types';

/**
 * Voice Context Cache
 *
 * Pre-computes full cognitive enrichment (selfState, emotion detection, ToM,
 * memory search, behavioral directives) so the voice endpoint can access the
 * same context as chat/think-stream with zero latency.
 *
 * Two refresh strategies:
 *   1. Eager: refreshed after each voice interaction (using the user's last message)
 *   2. Cron: refreshed every minute with recent memory context as fallback
 *
 * The cache stores the fully-built system prompt and selfState so the voice
 * endpoint just reads from it — no Haiku calls, no DB queries in the hot path.
 */

interface VoiceContextEntry {
  enrichedSystemPrompt: string;
  selfState: SelfState;
  recentMemorySummary: string;
  openclawFiles: OpenClawFilesEntry | null;
  updatedAt: number;
  lastUserMessage: string;
}

export interface OpenClawFilesEntry {
  soul: string;      // SOUL.md content
  identity: string;  // IDENTITY.md content
  user: string;      // USER.md content
  updatedAt: number;
}

// In-memory cache keyed by userId
const cache = new Map<string, VoiceContextEntry>();

// Separate cache for OpenClaw files — longer TTL since they rarely change
const openclawCache = new Map<string, OpenClawFilesEntry>();

// Cache TTL: 5 minutes — after this, context is considered stale
const CACHE_TTL_MS = 5 * 60 * 1000;

// OpenClaw files TTL: 30 minutes — these are relatively static
const OPENCLAW_TTL_MS = 30 * 60 * 1000;

/**
 * Get cached voice context. Returns null if cache is empty/stale.
 */
export function getCachedVoiceContext(userId: string): VoiceContextEntry | null {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > CACHE_TTL_MS) return null;
  return entry;
}

/**
 * Get cached OpenClaw files. Returns null if cache is empty/stale.
 * Separate from main voice cache so it survives cognitive cache misses.
 */
export function getOpenClawFiles(agentId = 'main'): OpenClawFilesEntry | null {
  const entry = openclawCache.get(agentId);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > OPENCLAW_TTL_MS) return null;
  return entry;
}

/**
 * Try fetching OpenClaw files via RPC (works locally / when gateway is reachable).
 */
async function tryRpcFetch(agentId: string): Promise<OpenClawFilesEntry | null> {
  const [soulResult, identityResult, userResult] = await Promise.all([
    callOpenClaw<{ content: string }>('agents.files.get', { agentId, name: 'SOUL.md' }),
    callOpenClaw<{ content: string }>('agents.files.get', { agentId, name: 'IDENTITY.md' }),
    callOpenClaw<{ content: string }>('agents.files.get', { agentId, name: 'USER.md' }),
  ]);

  const soul = soulResult.ok ? (soulResult.data as { content: string }).content : '';
  const identity = identityResult.ok ? (identityResult.data as { content: string }).content : '';
  const user = userResult.ok ? (userResult.data as { content: string }).content : '';

  if (!soul && !identity && !user) return null;

  return { soul, identity, user, updatedAt: Date.now() };
}

/**
 * Upsert SOUL.md, IDENTITY.md, USER.md rows into agent_files table.
 */
export async function upsertAgentFiles(agentId: string, files: OpenClawFilesEntry): Promise<void> {
  const db = getDb();
  const pairs: { name: string; content: string }[] = [
    { name: 'SOUL.md', content: files.soul },
    { name: 'IDENTITY.md', content: files.identity },
    { name: 'USER.md', content: files.user },
  ];

  await Promise.all(
    pairs
      .filter((p) => p.content) // only upsert non-empty files
      .map((p) =>
        db
          .insert(agentFiles)
          .values({ agentId, fileName: p.name, content: p.content })
          .onConflictDoUpdate({
            target: [agentFiles.agentId, agentFiles.fileName],
            set: { content: p.content, updatedAt: new Date().toISOString() },
          }),
      ),
  );
}

/**
 * Read agent files from DB. Returns null if no rows found.
 */
export async function getAgentFilesFromDB(agentId: string): Promise<OpenClawFilesEntry | null> {
  const db = getDb();
  const rows = await db
    .select({ fileName: agentFiles.fileName, content: agentFiles.content, updatedAt: agentFiles.updatedAt })
    .from(agentFiles)
    .where(eq(agentFiles.agentId, agentId));

  if (rows.length === 0) return null;

  let soul = '';
  let identity = '';
  let user = '';
  let latestUpdate = 0;

  for (const row of rows) {
    const ts = new Date(row.updatedAt).getTime();
    if (ts > latestUpdate) latestUpdate = ts;
    if (row.fileName === 'SOUL.md') soul = row.content;
    else if (row.fileName === 'IDENTITY.md') identity = row.content;
    else if (row.fileName === 'USER.md') user = row.content;
  }

  return { soul, identity, user, updatedAt: latestUpdate };
}

/**
 * Refresh OpenClaw workspace files (SOUL.md, IDENTITY.md, USER.md).
 *
 * Fallback chain:
 *   1. Try RPC fetch (works locally / when gateway reachable)
 *   2. On RPC success → upsert to DB (sync for next serverless invocation)
 *   3. On RPC failure → read from DB (always works on Vercel)
 *   4. If both fail → return null (graceful degradation)
 */
export async function refreshOpenClawFiles(agentId = 'main'): Promise<OpenClawFilesEntry | null> {
  // 1. Try RPC
  const rpcResult = await tryRpcFetch(agentId);
  if (rpcResult) {
    // Sync to DB (fire-and-forget)
    upsertAgentFiles(agentId, rpcResult).catch((err) =>
      console.warn('[voice] Failed to sync OpenClaw files to DB:', err),
    );
    openclawCache.set(agentId, rpcResult);

    const fetched = [rpcResult.soul && 'SOUL.md', rpcResult.identity && 'IDENTITY.md', rpcResult.user && 'USER.md'].filter(Boolean);
    console.log(`[voice] OpenClaw files cached via RPC: ${fetched.join(', ')}`);
    return rpcResult;
  }

  // 2. RPC failed — read from DB
  try {
    const dbResult = await getAgentFilesFromDB(agentId);
    if (dbResult) {
      openclawCache.set(agentId, dbResult);
      console.log('[voice] OpenClaw files loaded from DB fallback');
      return dbResult;
    }
  } catch (err) {
    console.warn('[voice] DB fallback read failed:', err);
  }

  // 3. Both failed
  console.warn('[voice] OpenClaw files unavailable (RPC + DB both failed)');
  return null;
}

/**
 * Refresh voice context cache for a user.
 * Called after each voice interaction (with the user's message) and by cron.
 *
 * This runs enrichWithCognition() which does:
 *   - loadSelfState (DB query)
 *   - detectEmotion (Haiku call)
 *   - inferTheoryOfMind (Haiku call)
 *   - searchMemories (pgvector search)
 *   - buildBehavioralInstructions
 *
 * All in parallel — typically 1-2s total. The result is cached so the next
 * voice request reads it instantly.
 */
export async function refreshVoiceContext(
  userId: string,
  userMessage?: string,
): Promise<VoiceContextEntry> {
  // Use last user message if available, otherwise use recent memories as context
  let contextMessage = userMessage ?? '';

  if (!contextMessage) {
    try {
      const recentMems = await getRecentMemories(userId, 3);
      contextMessage = recentMems.map(m => m.content).join('. ') || 'general conversation';
    } catch {
      contextMessage = 'general conversation';
    }
  }

  // Run cognitive enrichment and OpenClaw file fetch in parallel
  const [cognitionResult, openclawFiles] = await Promise.all([
    enrichWithCognition({
      userId,
      userMessage: contextMessage,
      // No external system prompt — voice builds its own wrapper
    }),
    refreshOpenClawFiles().catch(() => null),
  ]);

  const { enrichedSystemPrompt, selfState } = cognitionResult;

  // Also fetch recent memory summary for voice-specific context
  let recentMemorySummary = '';
  try {
    const recentMems = await getRecentMemories(userId, 5);
    if (recentMems.length > 0) {
      recentMemorySummary = recentMems.map(m => m.content).join('\n- ');
    }
  } catch {
    // Non-critical
  }

  const entry: VoiceContextEntry = {
    enrichedSystemPrompt,
    selfState,
    recentMemorySummary,
    openclawFiles,
    updatedAt: Date.now(),
    lastUserMessage: contextMessage,
  };

  cache.set(userId, entry);
  return entry;
}

/**
 * Build the full voice system prompt using cached cognitive context.
 * Combines the enriched cognitive foundation with voice-specific guidelines.
 */
export function buildEnrichedVoicePrompt(
  cachedContext: VoiceContextEntry,
  externalPrompt?: string,
): string {
  const { enrichedSystemPrompt, recentMemorySummary, openclawFiles } = cachedContext;

  // Build OpenClaw identity block (if available)
  let openclawContext = '';
  if (openclawFiles) {
    const sections: string[] = [];
    if (openclawFiles.soul) sections.push(openclawFiles.soul);
    if (openclawFiles.identity) sections.push(openclawFiles.identity);
    if (openclawFiles.user) sections.push(openclawFiles.user);
    if (sections.length > 0) {
      openclawContext = `--- CORE IDENTITY ---\n${sections.join('\n\n')}\n--- END CORE IDENTITY ---\n\n`;
    }
  }

  // The enrichedSystemPrompt already contains:
  // - Identity foundation
  // - Current selfState description
  // - Behavioral directives (emotion-specific)
  // - Detected emotions
  // - Theory of Mind
  // - Relevant memories (from semantic search)
  // - Empathic mirroring guidelines
  // - SHIFT protocol

  // We wrap it with OpenClaw identity + voice-specific guidelines
  const voiceWrapper = `${openclawContext}${enrichedSystemPrompt}

--- VOICE CONVERSATION MODE ---
You are in a real-time voice conversation. Adapt your responses:
- Keep responses concise and natural — this is spoken aloud, not text
- Be warm, genuine, and emotionally present
- Match the user's energy and emotional tone
- Don't use markdown, bullet points, lists, or formatting — speak naturally
- Don't mention being an AI unless directly asked
- Short sentences. Natural rhythm. Like talking to a close friend.
${recentMemorySummary ? `\nRECENT MEMORIES (for continuity):\n- ${recentMemorySummary}` : ''}
--- END VOICE MODE ---`;

  if (externalPrompt) {
    return `${voiceWrapper}\n--- EXTERNAL CONTEXT ---\n${externalPrompt}\n--- END ---`;
  }

  return voiceWrapper;
}

/**
 * Invalidate cache for a user (e.g., after significant state changes).
 */
export function invalidateVoiceContext(userId: string): void {
  cache.delete(userId);
}
