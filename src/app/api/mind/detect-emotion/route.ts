import { getProvider } from '@/lib/llm';
import { createApiHandler } from '@/lib/api-handler';
import { detectEmotionParamsSchema } from '@/lib/schemas';
import { extractJSON } from '@/lib/extract-json';

export const POST = createApiHandler({
  schema: detectEmotionParamsSchema,
  handler: async ({ text, context }, _userId) => {
    const provider = getProvider();
    const result = await provider.complete({
      tier: 'fast',
      maxTokens: 150,
      system: `You are an emotion detection system. Analyze the user's text for emotional content.
Return ONLY valid JSON with this exact structure:
{"emotions": ["emotion1", "emotion2"], "valence": 0.0, "arousal": 0.0, "confidence": 0.0}

- emotions: array of detected emotions (grief, joy, anger, fear, sadness, surprise, love, anxiety, loneliness, gratitude, hope, confusion, shame, guilt, pride, awe, disgust, contempt, jealousy, nostalgia)
- valence: -1.0 (very negative) to 1.0 (very positive)
- arousal: 0.0 (calm) to 1.0 (intense)
- confidence: 0.0 to 1.0 how confident you are

Consider sarcasm, context, implicit emotions, and tone. "Fine." after bad news = suppressed pain, not contentment.`,
      messages: [
        {
          role: 'user',
          content: context
            ? `Context: ${context}\n\nText to analyze: "${text}"`
            : `Text to analyze: "${text}"`,
        },
      ],
    });

    return JSON.parse(extractJSON(result.text));
  },
});
