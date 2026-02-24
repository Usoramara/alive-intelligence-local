/**
 * Ollama LLM provider — uses native fetch to Ollama's OpenAI-compatible API.
 * No additional npm dependencies needed.
 */
import { getModelForTier } from './model-map';
import type {
  LLMProvider,
  CompletionParams,
  CompletionResult,
  StreamDelta,
  ToolCallResult,
  ChatMessage,
  ContentBlock,
  ToolDefinition,
} from './provider';

function getBaseUrl(): string {
  return process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
}

function resolveModel(params: CompletionParams): string {
  if (params.model) return params.model;
  return getModelForTier('ollama', params.tier ?? 'smart');
}

// Models known to support function calling via Ollama
const TOOL_CAPABLE_MODELS = [
  'qwen3', 'qwen2.5', 'llama3.1', 'llama3.2', 'llama3.3',
  'mistral', 'mistral-nemo', 'command-r', 'firefunction',
  'hermes', 'nemotron',
];

// Models known to support vision
const VISION_MODELS = [
  'llava', 'llama3.2-vision', 'moondream', 'bakllava',
  'minicpm-v', 'llava-llama3', 'llava-phi3',
];

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

function toOpenAIMessages(
  system: string,
  messages: ChatMessage[],
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [{ role: 'system', content: system }];

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role, content: msg.content });
    } else {
      // Content block array — flatten to text for Ollama
      const blocks = msg.content as ContentBlock[];
      const textParts: string[] = [];
      const toolResults: OpenAIMessage[] = [];

      for (const block of blocks) {
        if (block.type === 'text') {
          textParts.push(block.text);
        } else if (block.type === 'tool_use') {
          // This is from assistant — convert to tool_calls format
          // Will be handled separately
        } else if (block.type === 'tool_result') {
          toolResults.push({
            role: 'tool',
            content: block.content,
            tool_call_id: block.tool_use_id,
          });
        }
      }

      // Check if this message has tool_use blocks (assistant response with tool calls)
      const toolUseBlocks = blocks.filter(b => b.type === 'tool_use');
      if (msg.role === 'assistant' && toolUseBlocks.length > 0) {
        result.push({
          role: 'assistant',
          content: textParts.join('') || null,
          tool_calls: toolUseBlocks.map(b => {
            if (b.type !== 'tool_use') throw new Error('unreachable');
            return {
              id: b.id,
              type: 'function' as const,
              function: {
                name: b.name,
                arguments: JSON.stringify(b.input),
              },
            };
          }),
        });
      } else if (toolResults.length > 0) {
        // User message containing tool results
        for (const tr of toolResults) {
          result.push(tr);
        }
      } else if (textParts.length > 0) {
        result.push({ role: msg.role, content: textParts.join('') });
      }
    }
  }

  return result;
}

function toOpenAITools(tools?: ToolDefinition[]): OpenAITool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

export class OllamaProvider implements LLMProvider {
  name = 'ollama' as const;
  private _cachedModels: string[] | null = null;
  private _cachedModelsAt = 0;

  async complete(params: CompletionParams): Promise<CompletionResult> {
    const model = resolveModel(params);
    const openaiMessages = toOpenAIMessages(params.system, params.messages);
    const tools = toOpenAITools(params.tools);

    const body: Record<string, unknown> = {
      model,
      messages: openaiMessages,
      max_tokens: params.maxTokens,
      stream: false,
    };
    if (tools && this.modelSupportsTools(model)) {
      body.tools = tools;
    }

    const response = await fetch(`${getBaseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const message = choice?.message;

    const toolCalls: ToolCallResult[] = (message?.tool_calls ?? []).map(
      (tc: OpenAIToolCall) => ({
        id: tc.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
        name: tc.function.name,
        input: safeParseJson(tc.function.arguments),
      }),
    );

    const hasToolCalls = toolCalls.length > 0;

    return {
      text: message?.content ?? '',
      toolCalls,
      stopReason: hasToolCalls ? 'tool_use' : 'end_turn',
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }

  async *stream(params: CompletionParams): AsyncIterable<StreamDelta> {
    const model = resolveModel(params);
    const openaiMessages = toOpenAIMessages(params.system, params.messages);
    const tools = toOpenAITools(params.tools);

    const body: Record<string, unknown> = {
      model,
      messages: openaiMessages,
      max_tokens: params.maxTokens,
      stream: true,
    };
    if (tools && this.modelSupportsTools(model)) {
      body.tools = tools;
    }

    const response = await fetch(`${getBaseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      yield { type: 'error', error: `Ollama error ${response.status}: ${errorText}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            yield { type: 'done' };
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            // Handle tool calls in streaming
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.function?.name) {
                  yield {
                    type: 'tool_start',
                    toolId: tc.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
                    toolName: tc.function.name,
                  };
                }
                if (tc.function?.arguments) {
                  yield {
                    type: 'tool_input',
                    toolId: tc.id,
                    partialJson: tc.function.arguments,
                  };
                }
              }
            }

            // Handle text content
            if (delta.content) {
              yield { type: 'text', text: delta.content };
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'done' };
  }

  supportsVision(): boolean {
    const visionModel = getModelForTier('ollama', 'vision');
    // Check if a vision-capable model is configured
    return VISION_MODELS.some(prefix => visionModel.startsWith(prefix));
  }

  supportsToolUse(): boolean {
    const smartModel = getModelForTier('ollama', 'smart');
    return this.modelSupportsTools(smartModel);
  }

  async listModels(): Promise<string[]> {
    // Cache for 30 seconds
    if (this._cachedModels && Date.now() - this._cachedModelsAt < 30_000) {
      return this._cachedModels;
    }

    try {
      const response = await fetch(`${getBaseUrl()}/api/tags`);
      if (!response.ok) return [];

      const data = await response.json();
      const models = (data.models ?? []).map(
        (m: { name: string }) => m.name,
      );
      this._cachedModels = models;
      this._cachedModelsAt = Date.now();
      return models;
    } catch {
      return [];
    }
  }

  private modelSupportsTools(model: string): boolean {
    const lower = model.toLowerCase();
    return TOOL_CAPABLE_MODELS.some(prefix => lower.startsWith(prefix));
  }
}

function safeParseJson(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}
