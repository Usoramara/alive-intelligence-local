/**
 * Server-side channel message handler.
 * Processes incoming channel messages through Wybe's cognitive pipeline
 * (think() with tools) and returns the response.
 *
 * Enhanced with media attachment processing: images are described via
 * Claude Vision, audio is transcribed, and the results are included
 * in the think() context.
 *
 * Conversation histories are persisted to DB with LRU cache (survives restarts).
 */

import { think, type ThinkParams } from '@/lib/claude';
import { getDb } from '@/db';
import { cognitiveStates } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { IncomingMessage, OutgoingMessage, ChannelAdapter, Attachment } from './adapter';
import { getHistory, appendMessage } from './history-store';

// Default self state for channel-only users
const DEFAULT_STATE = {
  valence: 0.6,
  arousal: 0.3,
  confidence: 0.5,
  energy: 0.7,
  social: 0.4,
  curiosity: 0.6,
};

/**
 * Process media attachments and generate text descriptions.
 */
async function processAttachments(attachments: Attachment[]): Promise<string[]> {
  const descriptions: string[] = [];

  for (const attachment of attachments) {
    try {
      switch (attachment.type) {
        case 'image': {
          if (attachment.url || attachment.data_base64) {
            const { understandImage } = await import('@/lib/tools/image-understand');
            const imageUrl = attachment.url ?? `data:${attachment.mime_type ?? 'image/jpeg'};base64,${attachment.data_base64}`;
            const result = await understandImage({ url: imageUrl });
            descriptions.push(`[Image: ${result.description}]`);
          }
          break;
        }
        case 'audio': {
          if (attachment.url || attachment.data_base64) {
            const { transcribeAudio } = await import('@/lib/tools/transcribe');
            const audioUrl = attachment.url ?? `data:${attachment.mime_type ?? 'audio/mpeg'};base64,${attachment.data_base64}`;
            const result = await transcribeAudio({ url: audioUrl });
            descriptions.push(`[Audio transcription: ${result.text}]`);
          }
          break;
        }
        case 'document': {
          if (attachment.url && attachment.mime_type?.includes('pdf')) {
            const { readPdf } = await import('@/lib/tools/pdf-read');
            const result = await readPdf({ url: attachment.url, max_pages: 5 });
            descriptions.push(`[PDF content (${result.pages} pages): ${result.text.slice(0, 2000)}]`);
          } else {
            descriptions.push(`[Document: ${attachment.filename ?? 'unnamed'} (${attachment.mime_type ?? 'unknown type'})]`);
          }
          break;
        }
        case 'video': {
          descriptions.push(`[Video attachment: ${attachment.filename ?? 'unnamed'}]`);
          break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      descriptions.push(`[Failed to process ${attachment.type}: ${msg}]`);
    }
  }

  return descriptions;
}

/**
 * Process an incoming channel message through Wybe's think() pipeline.
 */
export async function handleChannelMessage(
  message: IncomingMessage,
  userId: string,
  adapter: ChannelAdapter,
): Promise<void> {
  // Get user's cognitive state
  let selfState = DEFAULT_STATE;
  try {
    const db = getDb();
    const [state] = await db
      .select()
      .from(cognitiveStates)
      .where(eq(cognitiveStates.userId, userId));
    if (state) {
      selfState = {
        valence: state.valence,
        arousal: state.arousal,
        confidence: state.confidence,
        energy: state.energy,
        social: state.social,
        curiosity: state.curiosity,
      };
    }
  } catch {
    // Database not available — use defaults
  }

  // Process media attachments if present
  let messageText = message.text;
  if (message.attachments?.length) {
    const mediaDescriptions = await processAttachments(message.attachments);
    if (mediaDescriptions.length > 0) {
      messageText = [messageText, ...mediaDescriptions].filter(Boolean).join('\n');
    }
  }

  // Get conversation history from DB-backed store (with LRU cache)
  const history = await getHistory(userId, message.channelType, message.channelUserId);

  // Add user message to history
  await appendMessage(userId, message.channelType, message.channelUserId, {
    role: 'user',
    content: messageText,
  });

  // Build think params
  const params: ThinkParams = {
    content: messageText,
    context: [`Channel: ${message.channelType}`],
    selfState,
    conversationHistory: history, // Previous messages (before this one)
  };

  // Process through Wybe's cognitive pipeline
  const result = await think(params, undefined, userId);

  // Add assistant response to history (persists to DB)
  await appendMessage(userId, message.channelType, message.channelUserId, {
    role: 'assistant',
    content: result.text,
  });

  // Update cognitive state if there was an emotion shift
  if (result.emotionShift) {
    try {
      const db = getDb();
      const newState = { ...selfState };
      for (const [key, value] of Object.entries(result.emotionShift)) {
        if (key in newState) {
          (newState as Record<string, number>)[key] = Math.max(-1, Math.min(1,
            (newState as Record<string, number>)[key] + (value as number)
          ));
        }
      }
      await db
        .insert(cognitiveStates)
        .values({ userId, ...newState })
        .onConflictDoUpdate({
          target: cognitiveStates.userId,
          set: { ...newState, updatedAt: new Date().toISOString() },
        });
    } catch {
      // Non-critical — state update failure doesn't affect the response
    }
  }

  // Send response back through the channel
  const response: OutgoingMessage = {
    text: result.text,
    metadata: result.toolActivities ? { toolActivities: result.toolActivities } : undefined,
  };

  await adapter.sendMessage(message.channelUserId, response);
}
