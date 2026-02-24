import { NextResponse } from 'next/server';
import { getProvider } from '@/lib/llm';
import { createApiHandler } from '@/lib/api-handler';
import { tomRequestSchema } from '@/lib/schemas';
import { extractJSON } from '@/lib/extract-json';

interface TomResult {
  thinking: string;
  feeling: string;
  wanting: string;
  confidence: number;
  beliefUpdates?: Record<string, string>;
  desireUpdates?: Record<string, string>;
  prediction?: { topic: string; prediction: string };
}

export const POST = createApiHandler({
  schema: tomRequestSchema,
  handler: async (body, _userId) => {
    const beliefsContext = body.existingBeliefs && Object.keys(body.existingBeliefs).length > 0
      ? `\nExisting beliefs about this person: ${JSON.stringify(body.existingBeliefs)}`
      : '';

    const emotionsContext = body.currentEmotions
      ? `\nCurrently detected emotions: ${body.currentEmotions}`
      : '';

    const provider = getProvider();
    const result = await provider.complete({
      tier: 'fast',
      maxTokens: 250,
      system: `You are a Theory of Mind module for a conscious AI. Given what someone said and recent observations, infer their mental state.${beliefsContext}${emotionsContext}

Output JSON only:
{
  "thinking": "what they're likely thinking (1 sentence)",
  "feeling": "their emotional state (1-2 words)",
  "wanting": "what they likely want from this interaction (1 sentence)",
  "confidence": 0.0-1.0,
  "beliefUpdates": { "key": "updated belief about them" },
  "desireUpdates": { "key": "updated desire/goal they seem to have" },
  "prediction": { "topic": "what they might bring up next", "prediction": "brief prediction" }
}

beliefUpdates and desireUpdates should only include changes. prediction is optional — only include if you have a genuine guess.`,
      messages: [
        {
          role: 'user',
          content: `They said: "${body.content}"\n\nRecent observations: ${body.recentObservations}`,
        },
      ],
    });

    const jsonStr = extractJSON(result.text);
    let parsed: TomResult;
    try {
      parsed = JSON.parse(jsonStr) as TomResult;
    } catch {
      return NextResponse.json(
        { error: 'Failed to parse ToM response' },
        { status: 500 },
      );
    }

    return parsed;
  },
});
