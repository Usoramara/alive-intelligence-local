import { getDb } from '@/db';
import { cognitiveStates } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { SelfState } from '@/core/types';

/**
 * Parse SHIFT data from Wybe's response text.
 * Returns the emotion shift and the cleaned text with SHIFT line removed.
 */
export function parseShiftFromText(text: string): {
  cleanText: string;
  emotionShift?: Partial<SelfState>;
} {
  const shiftMatch = text.match(/\nSHIFT:\s*(\{[^}]+\})/);
  if (!shiftMatch) {
    return { cleanText: text };
  }

  try {
    const emotionShift = JSON.parse(shiftMatch[1]) as Partial<SelfState>;
    const cleanText = text.replace(/\nSHIFT:\s*\{[^}]+\}/, '').trim();
    return { cleanText, emotionShift };
  } catch {
    return { cleanText: text };
  }
}

/**
 * Update cognitive state in the DB after a response.
 * Applies emotion shift deltas to the current state, clamped to valid ranges.
 *
 * Runs as fire-and-forget — errors are silently swallowed since
 * state updates are non-critical to the response flow.
 */
export async function updateCognitiveState(
  userId: string,
  currentState: SelfState,
  emotionShift: Partial<SelfState>,
): Promise<void> {
  try {
    const db = getDb();
    const newState = { ...currentState };

    for (const [key, value] of Object.entries(emotionShift)) {
      if (key in newState) {
        (newState as Record<string, number>)[key] = Math.max(
          -1,
          Math.min(1, (newState as Record<string, number>)[key] + (value as number)),
        );
      }
    }

    await db
      .insert(cognitiveStates)
      .values({ userId, ...newState })
      .onConflictDoUpdate({
        target: cognitiveStates.userId,
        set: { ...newState, updatedAt: new Date().toISOString() },
      });
  } catch {
    // Non-critical — state update failure doesn't affect the response
  }
}
