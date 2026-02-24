/**
 * Anthropic (Claude) LLM provider — wraps the existing Anthropic SDK client.
 */
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '@/lib/anthropic';
import { getModelForTier } from './model-map';
import type {
  LLMProvider,
  CompletionParams,
  CompletionResult,
  StreamDelta,
  ToolCallResult,
} from './provider';

function resolveModel(params: CompletionParams): string {
  if (params.model) return params.model;
  return getModelForTier('anthropic', params.tier ?? 'smart');
}

function toAnthropicMessages(messages: CompletionParams['messages']): Anthropic.MessageParam[] {
  return messages.map(m => ({
    role: m.role,
    content: m.content as string | Anthropic.ContentBlockParam[],
  }));
}

function toAnthropicTools(tools?: CompletionParams['tools']): Anthropic.Tool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
  }));
}

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic' as const;

  async complete(params: CompletionParams): Promise<CompletionResult> {
    const client = getAnthropicClient();
    const model = resolveModel(params);
    const tools = toAnthropicTools(params.tools);

    const response = await client.messages.create({
      model,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: toAnthropicMessages(params.messages),
      ...(tools ? { tools } : {}),
    });

    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    const toolCalls: ToolCallResult[] = toolUseBlocks.map(b => ({
      id: b.id,
      name: b.name,
      input: b.input as Record<string, unknown>,
    }));

    return {
      text: textBlocks.map(b => b.text).join(''),
      toolCalls,
      stopReason: response.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  async *stream(params: CompletionParams): AsyncIterable<StreamDelta> {
    const client = getAnthropicClient();
    const model = resolveModel(params);
    const tools = toAnthropicTools(params.tools);

    const stream = client.messages.stream({
      model,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: toAnthropicMessages(params.messages),
      ...(tools ? { tools } : {}),
    });

    let currentToolId = '';
    let currentToolName = '';

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          currentToolId = event.content_block.id;
          currentToolName = event.content_block.name;
          yield {
            type: 'tool_start',
            toolId: currentToolId,
            toolName: currentToolName,
          };
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text };
        } else if (event.delta.type === 'input_json_delta') {
          yield {
            type: 'tool_input',
            toolId: currentToolId,
            toolName: currentToolName,
            partialJson: event.delta.partial_json,
          };
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolId) {
          yield { type: 'tool_end', toolId: currentToolId, toolName: currentToolName };
          currentToolId = '';
          currentToolName = '';
        }
      }
    }

    yield { type: 'done' };
  }

  supportsVision(): boolean {
    return true;
  }

  supportsToolUse(): boolean {
    return true;
  }

  async listModels(): Promise<string[]> {
    return [
      'claude-sonnet-4-20250514',
      'claude-haiku-4-5-20251001',
    ];
  }
}
