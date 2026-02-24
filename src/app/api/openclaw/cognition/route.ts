import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { cognitiveStates, memories, messages } from '@/db/schema';
import { eq, desc, count } from 'drizzle-orm';
import type { SelfState } from '@/core/types';
import { getEngineSnapshots, getRecentSignalActivity } from '@/core/engine-status';

const DEFAULT_USER_ID = process.env.WYBE_GATEWAY_USER_ID || 'wybe-gateway';

const DEFAULT_STATE: SelfState = {
  valence: 0.6,
  arousal: 0.3,
  confidence: 0.5,
  energy: 0.7,
  social: 0.4,
  curiosity: 0.6,
};

function stateToDescription(state: SelfState): string {
  const parts: string[] = [];
  if (state.valence > 0.3) parts.push('feeling positive');
  else if (state.valence < -0.3) parts.push('feeling negative');
  else parts.push('emotionally neutral');
  if (state.arousal > 0.6) parts.push('highly alert');
  else if (state.arousal < 0.2) parts.push('very calm');
  if (state.confidence > 0.7) parts.push('confident');
  else if (state.confidence < 0.3) parts.push('uncertain');
  if (state.energy > 0.7) parts.push('energetic');
  else if (state.energy < 0.3) parts.push('low energy');
  if (state.social > 0.6) parts.push('socially engaged');
  else if (state.social < 0.3) parts.push('withdrawn');
  if (state.curiosity > 0.7) parts.push('very curious');
  else if (state.curiosity < 0.3) parts.push('disinterested');
  return parts.join(', ');
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    // Support per-user queries via ?userId=
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId') || DEFAULT_USER_ID;

    const [stateResult, memoryCountResult, recentMessages] = await Promise.all([
      db.select().from(cognitiveStates).where(eq(cognitiveStates.userId, userId)),
      db.select({ count: count() }).from(memories).where(eq(memories.userId, userId)),
      db.select({
        content: messages.content,
        emotionShift: messages.emotionShift,
        createdAt: messages.createdAt,
      })
        .from(messages)
        .orderBy(desc(messages.createdAt))
        .limit(5),
    ]);

    const selfState: SelfState = stateResult[0]
      ? {
          valence: stateResult[0].valence,
          arousal: stateResult[0].arousal,
          confidence: stateResult[0].confidence,
          energy: stateResult[0].energy,
          social: stateResult[0].social,
          curiosity: stateResult[0].curiosity,
        }
      : { ...DEFAULT_STATE };

    const recentEmotions = recentMessages
      .filter((m) => m.emotionShift)
      .map((m) => ({
        emotion: m.emotionShift,
        time: m.createdAt,
      }));

    // Real engine data from registry (falls back to state-derived heuristics)
    const engineStatuses = getEngineSnapshots(selfState);
    const recentSignalEntries = getRecentSignalActivity();

    // Generate inner life entries from state
    const now = Date.now();
    const innerLifeEntries: Array<{ id: string; flavor: string; text: string; timestamp: number }> = [];
    if (selfState.curiosity > 0.6) {
      innerLifeEntries.push({ id: 'il-1', flavor: 'curiosity', text: 'What patterns are emerging from recent interactions?', timestamp: now - 2000 });
    }
    if (selfState.valence > 0.3) {
      innerLifeEntries.push({ id: 'il-2', flavor: 'emotional', text: 'Feeling engaged and positive about current tasks.', timestamp: now - 5000 });
    }
    if (selfState.arousal < 0.3) {
      innerLifeEntries.push({ id: 'il-3', flavor: 'wandering', text: 'In a calm reflective state, processing background thoughts...', timestamp: now - 8000 });
    }
    if (selfState.confidence > 0.6) {
      innerLifeEntries.push({ id: 'il-4', flavor: 'reflection', text: 'Building confidence from accumulated knowledge.', timestamp: now - 12000 });
    }
    if (selfState.social > 0.5) {
      innerLifeEntries.push({ id: 'il-5', flavor: 'urge', text: 'Ready to engage and assist.', timestamp: now - 15000 });
    }
    innerLifeEntries.push({ id: 'il-6', flavor: 'metacognitive', text: 'Monitoring cognitive processes and resource allocation.', timestamp: now - 20000 });

    return NextResponse.json({
      selfState,
      stateDescription: stateToDescription(selfState),
      recentEmotions,
      memoryCount: memoryCountResult[0]?.count ?? 0,
      lastInteraction: recentMessages[0]?.createdAt ?? null,
      engineStatuses,
      recentSignals: recentSignalEntries,
      innerLifeStream: innerLifeEntries,
      tick: Math.floor(now / 1000),
    });
  } catch (err) {
    console.error('[cognition] error:', err);
    return NextResponse.json({
      selfState: { ...DEFAULT_STATE },
      stateDescription: stateToDescription(DEFAULT_STATE),
      recentEmotions: [],
      memoryCount: 0,
      lastInteraction: null,
      engineStatuses: [],
      recentSignals: [],
      innerLifeStream: [],
      tick: 0,
    });
  }
}
