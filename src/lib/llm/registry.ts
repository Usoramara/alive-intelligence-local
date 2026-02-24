/**
 * Provider registry — singleton that manages the active LLM provider.
 * Reads mode from environment variable, with runtime toggle support.
 */
import type { LLMProvider } from './provider';
import { AnthropicProvider } from './anthropic-provider';
import { OllamaProvider } from './ollama-provider';

export type ProviderMode = 'cloud' | 'local';

let _mode: ProviderMode | null = null;
let _anthropicProvider: AnthropicProvider | null = null;
let _ollamaProvider: OllamaProvider | null = null;

function getDefaultMode(): ProviderMode {
  // If no Anthropic key is set, default to local
  if (!process.env.ANTHROPIC_API_KEY) return 'local';
  // If explicitly set via env, respect it
  const envMode = process.env.LLM_PROVIDER_MODE;
  if (envMode === 'local' || envMode === 'cloud') return envMode;
  // Default to local for this fork
  return 'local';
}

export function getProviderMode(): ProviderMode {
  if (!_mode) {
    _mode = getDefaultMode();
  }
  return _mode;
}

export function setProviderMode(mode: ProviderMode): void {
  _mode = mode;
}

export function getProvider(): LLMProvider {
  const mode = getProviderMode();

  if (mode === 'cloud') {
    if (!_anthropicProvider) {
      _anthropicProvider = new AnthropicProvider();
    }
    return _anthropicProvider;
  }

  if (!_ollamaProvider) {
    _ollamaProvider = new OllamaProvider();
  }
  return _ollamaProvider;
}

/**
 * Get a specific provider regardless of current mode.
 * Useful for the voice endpoint which uses raw fetch to Anthropic.
 */
export function getAnthropicProviderInstance(): AnthropicProvider {
  if (!_anthropicProvider) {
    _anthropicProvider = new AnthropicProvider();
  }
  return _anthropicProvider;
}

export function getOllamaProviderInstance(): OllamaProvider {
  if (!_ollamaProvider) {
    _ollamaProvider = new OllamaProvider();
  }
  return _ollamaProvider;
}

/**
 * Check if Ollama is reachable.
 */
export async function checkOllamaHealth(): Promise<{
  connected: boolean;
  models: string[];
  error?: string;
}> {
  try {
    const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return { connected: false, models: [], error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    const models = (data.models ?? []).map((m: { name: string }) => m.name);
    return { connected: true, models };
  } catch (err) {
    return {
      connected: false,
      models: [],
      error: err instanceof Error ? err.message : 'Connection failed',
    };
  }
}
