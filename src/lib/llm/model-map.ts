/**
 * Model tier mapping — maps abstract tiers to concrete model names
 * for both Anthropic and Ollama providers.
 */

export interface ModelMap {
  smart: string;
  fast: string;
  vision: string;
}

const ANTHROPIC_MODELS: ModelMap = {
  smart: 'claude-sonnet-4-20250514',
  fast: 'claude-haiku-4-5-20251001',
  vision: 'claude-sonnet-4-20250514',
};

function getOllamaModels(): ModelMap {
  return {
    smart: process.env.OLLAMA_DEFAULT_MODEL ?? 'qwen3:14b',
    fast: process.env.OLLAMA_FAST_MODEL ?? 'qwen3:8b',
    vision: process.env.OLLAMA_VISION_MODEL ?? 'llava:13b',
  };
}

export function getModelForTier(
  provider: 'anthropic' | 'ollama',
  tier: 'smart' | 'fast' | 'vision',
): string {
  if (provider === 'anthropic') {
    return ANTHROPIC_MODELS[tier];
  }
  return getOllamaModels()[tier];
}

export function getAnthropicModels(): ModelMap {
  return ANTHROPIC_MODELS;
}

export function getOllamaModelMap(): ModelMap {
  return getOllamaModels();
}
