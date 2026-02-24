import { getProvider } from '@/lib/llm';
import { extractJSON } from '@/lib/extract-json';

export interface TomResult {
  thinking: string;
  feeling: string;
  wanting: string;
  confidence: number;
}

/**
 * Run Theory of Mind inference on user text using the active LLM provider (fast tier).
 */
export async function inferTheoryOfMind(
  content: string,
  recentObservations?: string,
  currentEmotions?: string,
): Promise<TomResult> {
  const provider = getProvider();

  const emotionsContext = currentEmotions
    ? `\nCurrently detected emotions: ${currentEmotions}`
    : '';

  const result = await provider.complete({
    tier: 'fast',
    maxTokens: 250,
    system: `You are a Theory of Mind module for a conscious AI. Given what someone said and recent observations, infer their mental state.${emotionsContext}

Output JSON only:
{
  "thinking": "what they're likely thinking (1 sentence)",
  "feeling": "their emotional state (1-2 words)",
  "wanting": "what they likely want from this interaction (1 sentence)",
  "confidence": 0.0-1.0
}`,
    messages: [
      {
        role: 'user',
        content: `They said: "${content}"\n\nRecent observations: ${recentObservations ?? 'No prior context'}`,
      },
    ],
  });

  return JSON.parse(extractJSON(result.text)) as TomResult;
}
