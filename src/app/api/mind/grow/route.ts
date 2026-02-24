import { getProvider } from '@/lib/llm';
import { createApiHandler } from '@/lib/api-handler';
import { growParamsSchema } from '@/lib/schemas';
import { extractJSON } from '@/lib/extract-json';

export const POST = createApiHandler({
  schema: growParamsSchema,
  handler: async ({ exchanges, emotionalTrajectory }, _userId) => {
    const conversationSummary = exchanges
      .map(e => `${e.role === 'user' ? 'User' : 'Wybe'}: ${e.content}`)
      .join('\n');

    const provider = getProvider();
    const result = await provider.complete({
      tier: 'fast',
      maxTokens: 300,
      system: `You are Wybe's self-reflection system. After a conversation ends, analyze what happened and extract growth insights.
Return ONLY valid JSON:
{
  "keyTakeaway": "One sentence about what was learned or what mattered",
  "emotionalInsight": "One sentence about the emotional dynamics",
  "whatWentWell": "Brief note on what worked",
  "whatToImprove": "Brief note on what could be better next time",
  "relationshipNote": "Brief note about the relationship with this person"
}
Be honest and specific. Don't be generic.`,
      messages: [
        {
          role: 'user',
          content: `Conversation (${exchanges.length} exchanges):
${conversationSummary}

Emotional trajectory: started at valence ${emotionalTrajectory.start.toFixed(2)}, ended at ${emotionalTrajectory.end.toFixed(2)}
Emotional peaks: ${emotionalTrajectory.peaks.join(', ') || 'none notable'}

Analyze this conversation:`,
        },
      ],
    });

    return JSON.parse(extractJSON(result.text));
  },
});
