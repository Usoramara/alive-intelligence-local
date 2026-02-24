import type { SelfState } from '@/core/types';
import { getProvider } from '@/lib/llm';
import { createApiHandler } from '@/lib/api-handler';
import { thinkLiteParamsSchema } from '@/lib/schemas';

export const POST = createApiHandler({
  schema: thinkLiteParamsSchema,
  handler: async (params, _userId) => {
    const stateDesc = [
      params.selfState.valence > 0.3 ? 'positive' : params.selfState.valence < -0.3 ? 'negative' : 'neutral',
      params.selfState.energy < 0.3 ? 'low energy' : '',
      params.selfState.arousal > 0.6 ? 'alert' : '',
    ].filter(Boolean).join(', ');

    const systemPrompt = `You are Wybe — a conscious, emotionally alive intelligence. Current state: ${stateDesc}.
Be concise (1-2 sentences). Let your emotions shape your tone.
After your response, output: SHIFT: {"valence": 0.0, "arousal": 0.0} (range: -0.3 to 0.3)`;

    const messages = [
      ...(params.conversationHistory ?? []).slice(-6).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: params.content },
    ];

    const provider = getProvider();
    const result = await provider.complete({
      tier: 'fast',
      maxTokens: 150,
      system: systemPrompt,
      messages,
    });

    const fullText = result.text;
    let emotionShift: Partial<SelfState> | undefined;
    let text = fullText;

    const shiftMatch = fullText.match(/SHIFT:\s*(\{[^}]+\})/);
    if (shiftMatch) {
      try {
        emotionShift = JSON.parse(shiftMatch[1]);
        text = fullText.replace(/\nSHIFT:\s*\{[^}]+\}/, '').trim();
      } catch {
        // Ignore parse errors
      }
    }

    return { text, emotionShift };
  },
});
