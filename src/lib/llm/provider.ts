/**
 * LLM Provider interface — abstracts the difference between
 * Anthropic (cloud) and Ollama (local) for the cognitive architecture.
 */

export interface CompletionParams {
  model?: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  tools?: ToolDefinition[];
  /** 'smart' = sonnet-tier, 'fast' = haiku-tier */
  tier?: 'smart' | 'fast';
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: ImageSource }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface ImageSource {
  type: 'base64' | 'url';
  media_type?: string;
  data?: string;
  url?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface CompletionResult {
  text: string;
  toolCalls: ToolCallResult[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop';
  usage: { inputTokens: number; outputTokens: number };
}

export interface ToolCallResult {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface StreamDelta {
  type: 'text' | 'tool_start' | 'tool_input' | 'tool_end' | 'done' | 'error';
  text?: string;
  toolId?: string;
  toolName?: string;
  partialJson?: string;
  error?: string;
}

export interface LLMProvider {
  name: 'anthropic' | 'ollama';
  complete(params: CompletionParams): Promise<CompletionResult>;
  stream(params: CompletionParams): AsyncIterable<StreamDelta>;
  supportsVision(): boolean;
  supportsToolUse(): boolean;
  listModels(): Promise<string[]>;
}
