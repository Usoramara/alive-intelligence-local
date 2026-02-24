import { getProvider } from '@/lib/llm';
import { createApiHandler } from '@/lib/api-handler';
import { bodyDecomposeSchema } from '@/lib/schemas';

export const POST = createApiHandler({
  schema: bodyDecomposeSchema,
  handler: async (params) => {
    const provider = getProvider();
    const result = await provider.complete({
      tier: 'fast',
      maxTokens: 1024,
      system: params.systemPrompt,
      messages: [{ role: 'user', content: params.userPrompt }],
    });

    const text = result.text;

    // Parse JSON response
    try {
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, text];
      const json = JSON.parse(jsonMatch[1]!.trim());
      return json;
    } catch {
      const intent = params.intent as Record<string, unknown>;
      return {
        error: 'decomposition_parse_error',
        raw: text,
        steps: [{
          command: `body.${intent.type}`,
          params: intent,
          timeout: 15000,
          dependsOn: [],
        }],
        reasoning: 'Fallback: response could not be parsed, using direct intent',
      };
    }
  },
});
