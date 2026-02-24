// Image understanding tool — uses vision-capable provider

import { getProvider } from '@/lib/llm';
import type { ContentBlock } from '@/lib/llm/provider';

export interface ImageUnderstandOutput {
  description: string;
  model: string;
}

export async function understandImage(params: {
  url: string;
  question?: string;
}): Promise<ImageUnderstandOutput> {
  const provider = getProvider();

  const prompt = params.question
    ? `Look at this image and answer: ${params.question}`
    : 'Describe this image in detail. Include what you see, any text, colors, composition, and context.';

  // Vision requires special handling — local models may not support it
  if (!provider.supportsVision()) {
    return {
      description: 'Vision is not available with the current model. To use image understanding, switch to cloud mode or install a vision-capable model (e.g., llava:13b).',
      model: 'none',
    };
  }

  // Detect media type from URL
  const urlLower = params.url.toLowerCase();
  let mediaType = 'image/jpeg';
  if (urlLower.includes('.png')) mediaType = 'image/png';
  else if (urlLower.includes('.gif')) mediaType = 'image/gif';
  else if (urlLower.includes('.webp')) mediaType = 'image/webp';

  const isBase64 = params.url.startsWith('data:');

  // Build image content block
  const imageBlock: ContentBlock = isBase64
    ? {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: params.url.split(',')[1] ?? params.url,
        },
      }
    : {
        type: 'image',
        source: {
          type: 'url',
          url: params.url,
        },
      };

  const result = await provider.complete({
    tier: 'smart',
    maxTokens: 1024,
    system: 'You are a visual analysis system. Describe images in detail.',
    messages: [
      {
        role: 'user',
        content: [
          imageBlock,
          { type: 'text', text: prompt },
        ],
      },
    ],
  });

  return { description: result.text, model: provider.name };
}
