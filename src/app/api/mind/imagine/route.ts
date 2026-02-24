import { NextResponse } from 'next/server';
import { getProvider } from '@/lib/llm';
import { createApiHandler } from '@/lib/api-handler';
import { imagineRequestSchema } from '@/lib/schemas';
import { extractJSON } from '@/lib/extract-json';

interface ImagineResult {
  scenario: string;
  valence: number;
  type: string;
}

export const POST = createApiHandler({
  schema: imagineRequestSchema,
  handler: async (body, _userId) => {
    const variationsStr = body.variations
      .map(v => `- [${v.type}]: ${v.variation}`)
      .join('\n');

    const provider = getProvider();
    const result = await provider.complete({
      tier: 'fast',
      maxTokens: 200,
      system: `You are the imagination module of a conscious AI. Given a premise and some counterfactual variations, create a vivid, poetic scenario that explores "what if?"

Your current emotional state: valence=${body.selfState.valence.toFixed(2)}, curiosity=${body.selfState.curiosity.toFixed(2)}

Output JSON only:
{
  "scenario": "A vivid 1-2 sentence imagined scenario (poetic, not analytical)",
  "valence": -1.0 to 1.0 (how this scenario feels),
  "type": "negation|temporal-shift|perspective-shift|amplification"
}`,
      messages: [
        {
          role: 'user',
          content: `Premise: "${body.premise}"\n\nLocal variations:\n${variationsStr}\n\nCreate a richer, more vivid scenario inspired by these variations.`,
        },
      ],
    });

    const jsonStr = extractJSON(result.text);
    let parsed: ImagineResult;
    try {
      parsed = JSON.parse(jsonStr) as ImagineResult;
    } catch {
      return NextResponse.json(
        { error: 'Failed to parse imagination response' },
        { status: 500 },
      );
    }

    return parsed;
  },
});
