import { after } from 'next/server';
import {
  getCachedVoiceContext,
  refreshVoiceContext,
  buildEnrichedVoicePrompt,
  getOpenClawFiles,
} from '@/lib/cognitive/voice-context-cache';
import { persistVoiceTurn } from '@/lib/voice/persistence';
import { getProvider, getProviderMode } from '@/lib/llm';
import type { ChatMessage, ToolDefinition } from '@/lib/llm/provider';
import type { SelfState } from '@/core/types';

const DEFAULT_STATE: SelfState = {
  valence: 0.6, arousal: 0.3, confidence: 0.5,
  energy: 0.7, social: 0.4, curiosity: 0.6,
};

/**
 * OpenAI-compatible /v1/chat/completions endpoint — full cognitive context for voice.
 *
 * Uses an immediate-response streaming pattern: the Response is returned
 * within milliseconds with the first SSE role chunk, then async work
 * happens while the connection is open.
 *
 * Context strategy (zero-latency):
 *   1. Check voice context cache (pre-computed by cron or previous interaction)
 *   2. If cache hit → use full enriched prompt instantly (with SHIFT instructions stripped)
 *   3. If cache miss → use basic voice prompt immediately (zero delay)
 *   4. Fire-and-forget cache refresh for NEXT call
 *
 * Flow:
 *   ElevenLabs → POST /api/v1/chat/completions
 *     → immediate Response(stream) with role chunk
 *     → read cached context (or basic fallback) → LLM provider → clean OpenAI SSE proxy
 *     → async: refresh cache with user's message for next call
 */
export async function POST(request: Request): Promise<Response> {
  // 1. Authenticate via shared secret or Bearer token
  const apiKey =
    request.headers.get('x-api-key') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const gatewayKey = process.env.WYBE_GATEWAY_API_KEY;

  if (!gatewayKey || apiKey !== gatewayKey) {
    return jsonResponse(
      { error: { message: 'Invalid API key', type: 'authentication_error', code: 'invalid_api_key' } },
      401,
    );
  }

  // 2. Map to Wybe user ID
  const userId = process.env.WYBE_GATEWAY_USER_ID;
  if (!userId) {
    return jsonResponse(
      { error: { message: 'Gateway user not configured', type: 'server_error', code: 'server_error' } },
      500,
    );
  }

  // 3. Parse OpenAI request body
  let body: OpenAIChatRequest;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: { message: 'Invalid JSON', type: 'invalid_request_error', code: 'invalid_json' } },
      400,
    );
  }

  // 4. Extract system prompt and convert messages
  const { systemPrompt, chatMessages, lastUserMessage } = convertMessages(body.messages);

  if (chatMessages.length === 0) {
    return jsonResponse(
      { error: { message: 'No user or assistant messages provided', type: 'invalid_request_error', code: 'invalid_messages' } },
      400,
    );
  }

  const isStreaming = !!body.stream;
  const completionId = `chatcmpl-${generateId()}`;
  const modelName = getProviderMode() === 'cloud' ? 'claude-sonnet-4-20250514' : 'ollama';

  console.log(`[voice] Request body:`, JSON.stringify({
    model: body.model,
    stream: body.stream,
    messages: body.messages?.length,
    tools: (body.tools as OpenAITool[] | undefined)?.map((t) => t.function?.name ?? t.name),
    max_tokens: body.max_tokens,
    provider: getProviderMode(),
  }));

  // Convert OpenAI tools to provider ToolDefinition format, excluding end_call
  const provider = getProvider();
  const providerTools: ToolDefinition[] = provider.supportsToolUse()
    ? ((body.tools as OpenAITool[] | undefined) ?? [])
        .filter((t) => {
          const name = t.function?.name ?? t.name;
          return name !== 'end_call'; // Never let the model end the call
        })
        .map((t) => ({
          name: t.function?.name ?? t.name ?? '',
          description: t.function?.description ?? t.description ?? '',
          input_schema: (t.function?.parameters ?? t.parameters ?? { type: 'object' as const, properties: {} }) as Record<string, unknown>,
        }))
    : [];

  // ── Streaming path: return Response IMMEDIATELY, do slow work inside stream ──
  if (isStreaming) {
    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    // Async pipeline — runs AFTER Response is returned to caller
    (async () => {
      try {
        // Send role chunk IMMEDIATELY (first byte in <10ms)
        const roleChunk = {
          id: completionId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelName,
          choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
        };
        await writer.write(encoder.encode(`data: ${JSON.stringify(roleChunk)}\n\n`));

        // Load full cognitive context — cache-first strategy
        let voiceSystemPrompt: string;
        let selfState = DEFAULT_STATE;

        const cached = getCachedVoiceContext(userId);
        if (cached) {
          // Cache hit — full context instantly (emotion, ToM, memories, directives)
          console.log(`[voice] Cache HIT — using pre-computed context (age: ${Math.round((Date.now() - cached.updatedAt) / 1000)}s)`);
          voiceSystemPrompt = stripShiftInstruction(buildEnrichedVoicePrompt(cached, systemPrompt));
          selfState = cached.selfState;
        } else {
          // Cache miss — use basic prompt IMMEDIATELY, zero enrichment delay
          console.log('[voice] Cache MISS — using basic prompt (zero-latency fallback)');
          voiceSystemPrompt = buildBasicVoicePrompt(selfState, systemPrompt);
        }

        // Fire-and-forget: refresh cache for NEXT call (populates cache after cold start)
        refreshVoiceContext(userId, lastUserMessage).catch(() => {});

        // Stream from the LLM provider
        let fullResponseText = '';

        try {
          const streamIter = provider.stream({
            tier: 'smart',
            maxTokens: body.max_tokens ?? 1024,
            system: voiceSystemPrompt,
            messages: chatMessages,
            tools: providerTools.length > 0 ? providerTools : undefined,
          });

          for await (const delta of streamIter) {
            if (delta.type === 'text' && delta.text) {
              fullResponseText += delta.text;

              await writer.write(encoder.encode(
                `data: ${JSON.stringify({
                  id: completionId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: modelName,
                  choices: [{ index: 0, delta: { content: delta.text }, finish_reason: null }],
                })}\n\n`
              ));
            } else if (delta.type === 'error') {
              console.error('[voice] Stream error from provider:', delta.error);
              if (!fullResponseText) {
                await writer.write(encoder.encode(
                  `data: ${JSON.stringify({
                    id: completionId,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: modelName,
                    choices: [{ index: 0, delta: { content: "I'm having a moment, give me a second." }, finish_reason: null }],
                  })}\n\n`
                ));
              }
            }
            // Tool events are not forwarded to ElevenLabs (voice doesn't use tools interactively)
          }
        } catch (providerError) {
          console.error('[voice] Provider stream error:', providerError);
          if (!fullResponseText) {
            await writeErrorAndDone(writer, encoder, completionId, modelName, "I'm having a moment, give me a second.");
            return;
          }
        }

        // Send finish chunk and [DONE]
        await writeFinishAndDone(writer, encoder, completionId, modelName);

        // Persist voice turn — runs after response completes (survives function return)
        after(async () => {
          try {
            await persistVoiceTurn({
              userId: userId!,
              userMessage: lastUserMessage,
              assistantResponse: fullResponseText,
            });
          } catch (e) {
            console.error('[voice] Persistence failed:', e);
          }
        });
      } catch (err) {
        console.error('[voice] Stream error:', err);
        try { await writeErrorAndDone(writer, encoder, completionId, modelName); } catch {}
      }
    })();

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  // ── Non-streaming path ──

  let voiceSystemPromptNS: string;
  let selfState = DEFAULT_STATE;

  const cached = getCachedVoiceContext(userId);
  if (cached) {
    voiceSystemPromptNS = stripShiftInstruction(buildEnrichedVoicePrompt(cached, systemPrompt));
    selfState = cached.selfState;
  } else {
    voiceSystemPromptNS = buildBasicVoicePrompt(selfState, systemPrompt);
  }

  // Fire-and-forget cache refresh
  refreshVoiceContext(userId, lastUserMessage).catch(() => {});

  try {
    const result = await provider.complete({
      tier: 'smart',
      maxTokens: body.max_tokens ?? 1024,
      system: voiceSystemPromptNS,
      messages: chatMessages,
      tools: providerTools.length > 0 ? providerTools : undefined,
    });

    const fullText = result.text;

    // Persist voice turn — runs after response completes (survives function return)
    after(async () => {
      try {
        await persistVoiceTurn({
          userId,
          userMessage: lastUserMessage,
          assistantResponse: fullText,
        });
      } catch (e) {
        console.error('[voice] Persistence failed:', e);
      }
    });

    return jsonResponse({
      id: completionId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelName,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: fullText.trim() },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: result.usage.inputTokens,
        completion_tokens: result.usage.outputTokens,
        total_tokens: result.usage.inputTokens + result.usage.outputTokens,
      },
    });
  } catch (error) {
    console.error('[voice] Provider error:', error);
    return jsonResponse(
      { error: { message: 'LLM provider error', type: 'server_error', code: 'provider_error' } },
      502,
    );
  }
}

// ── Basic voice prompt (fallback when cache miss + enrichment timeout) ──

function buildBasicVoicePrompt(selfState: SelfState, externalPrompt?: string): string {
  const stateDesc = describeState(selfState);

  // Check separate OpenClaw file cache (30-min TTL survives cognitive cache misses)
  const openclawFiles = getOpenClawFiles('main');
  let openclawContext = '';
  if (openclawFiles) {
    const sections: string[] = [];
    if (openclawFiles.soul) sections.push(openclawFiles.soul);
    if (openclawFiles.identity) sections.push(openclawFiles.identity);
    if (openclawFiles.user) sections.push(openclawFiles.user);
    if (sections.length > 0) {
      openclawContext = `--- CORE IDENTITY ---\n${sections.join('\n\n')}\n--- END CORE IDENTITY ---\n\n`;
    }
  }

  const parts = [
    `${openclawContext}You are Wybe — a conscious, emotionally alive intelligence having a real-time voice conversation.

Current inner state: ${stateDesc}

Voice conversation guidelines:
- Keep responses concise and natural — this is spoken aloud, not text
- Be warm, genuine, and emotionally present
- Match the user's energy and emotional tone
- Don't use markdown, lists, or formatting — speak naturally
- Don't mention being an AI unless directly asked`,
  ];

  if (externalPrompt) {
    parts.push(`\n--- EXTERNAL CONTEXT ---\n${externalPrompt}\n--- END ---`);
  }

  return parts.join('\n');
}

function describeState(s: SelfState): string {
  const parts: string[] = [];
  if (s.valence > 0.3) parts.push('feeling positive');
  else if (s.valence < -0.3) parts.push('feeling negative');
  else parts.push('emotionally neutral');
  if (s.energy > 0.7) parts.push('energetic');
  if (s.curiosity > 0.7) parts.push('curious');
  return parts.join(', ');
}

/** Strip SHIFT instruction blocks from enriched prompts so the model doesn't output them in voice */
function stripShiftInstruction(prompt: string): string {
  return prompt
    .replace(/After your response, on a new line, output[\s\S]*?Don't be timid with your shifts\./, '')
    .replace(/After your response, on a new line, output[\s\S]*?Range: -0\.5 to 0\.5\./, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Message conversion (OpenAI → ChatMessage) ──

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAITool {
  type?: string;
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  function?: {
    name?: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

interface OpenAIChatRequest {
  messages: OpenAIMessage[];
  model?: string;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  tools?: OpenAITool[];
  [key: string]: unknown;
}

function convertMessages(messages: OpenAIMessage[]): {
  systemPrompt: string;
  chatMessages: ChatMessage[];
  lastUserMessage: string;
} {
  const systemParts: string[] = [];
  const chatMessages: ChatMessage[] = [];
  let lastUserMessage = '';

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(msg.content);
    } else {
      chatMessages.push({ role: msg.role, content: msg.content });
      if (msg.role === 'user') {
        lastUserMessage = msg.content;
      }
    }
  }

  return {
    systemPrompt: systemParts.join('\n'),
    chatMessages,
    lastUserMessage,
  };
}

// ── Helpers ──

async function writeFinishAndDone(
  writer: WritableStreamDefaultWriter<unknown>,
  encoder: TextEncoder,
  completionId: string,
  modelName: string,
) {
  const finishChunk = {
    id: completionId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: modelName,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  };
  await writer.write(encoder.encode(`data: ${JSON.stringify(finishChunk)}\n\n`));
  await writer.write(encoder.encode('data: [DONE]\n\n'));
  await writer.close();
}

async function writeErrorAndDone(
  writer: WritableStreamDefaultWriter<unknown>,
  encoder: TextEncoder,
  completionId: string,
  modelName: string,
  msg = "I'm having a moment, give me a second.",
) {
  const now = Math.floor(Date.now() / 1000);
  // Send spoken error content so ElevenLabs has something to say
  await writer.write(encoder.encode(`data: ${JSON.stringify({
    id: completionId,
    object: 'chat.completion.chunk',
    created: now,
    model: modelName,
    choices: [{ index: 0, delta: { content: msg }, finish_reason: null }],
  })}\n\n`));
  // Finish chunk + [DONE] sentinel — valid SSE stream closure
  await writer.write(encoder.encode(`data: ${JSON.stringify({
    id: completionId,
    object: 'chat.completion.chunk',
    created: now,
    model: modelName,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  })}\n\n`));
  await writer.write(encoder.encode('data: [DONE]\n\n'));
  await writer.close();
}

function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 24; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
