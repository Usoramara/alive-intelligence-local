import { getDb } from '@/db';
import { messages, conversations } from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { getProvider } from '@/lib/llm';
import { extractJSON } from '@/lib/extract-json';
import { webSearch } from '@/lib/tools/web-search';
import { saveMemoryWithEmbedding } from '@/lib/memory/manager';
import { invalidateVoiceContext } from '@/lib/cognitive/voice-context-cache';

const MAX_TURNS = 10;
const MAX_RESEARCH_QUERIES = 3;
const MAX_MEMORIES = 5;

interface TopicExtractionResult {
  topics: string[];
  searchQueries: string[];
  memorableStatements: string[];
}

/**
 * Process unprocessed voice turns: extract topics, run research, create memories.
 */
export async function processUnprocessedVoiceTurns(userId: string): Promise<{
  processed: number;
  memoriesCreated: number;
  researchQueries: number;
}> {
  const stats = { processed: 0, memoriesCreated: 0, researchQueries: 0 };

  const db = getDb();
  const unprocessed = await db
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      conversationId: messages.conversationId,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.userId, userId),
        eq(conversations.channel, 'voice'),
        eq(messages.enriched, false),
      ),
    )
    .orderBy(messages.createdAt)
    .limit(MAX_TURNS);

  if (unprocessed.length === 0) return stats;

  const transcript = unprocessed
    .map(m => `${m.role === 'user' ? 'Human' : 'Wybe'}: ${m.content}`)
    .join('\n');

  const messageIds = unprocessed.map(m => m.id);

  // Step 1: Topic extraction
  let extraction: TopicExtractionResult | null = null;
  try {
    extraction = await extractTopics(transcript);
  } catch (err) {
    console.error('[voice-enrich] Topic extraction failed:', err);
  }

  // Step 2: Research execution
  const researchResults: Array<{ query: string; summary: string }> = [];
  if (extraction?.searchQueries?.length) {
    const queries = extraction.searchQueries.slice(0, MAX_RESEARCH_QUERIES);
    for (const query of queries) {
      try {
        const result = await webSearch({ query, count: 3 });
        const summary = result.results
          .map(r => `${r.title}: ${r.description}`)
          .join('\n');
        researchResults.push({ query, summary });
        stats.researchQueries++;
      } catch (err) {
        console.error(`[voice-enrich] Research failed for "${query}":`, err);
      }
    }
  }

  // Step 3: Memory creation
  let memoriesCreated = 0;

  if (extraction?.memorableStatements?.length) {
    for (const statement of extraction.memorableStatements.slice(0, MAX_MEMORIES)) {
      try {
        await saveMemoryWithEmbedding({
          userId,
          type: 'episodic',
          content: statement,
          significance: 0.6,
          tags: ['voice'],
        });
        memoriesCreated++;
      } catch (err) {
        console.error('[voice-enrich] Failed to save episodic memory:', err);
      }
    }
  }

  if (researchResults.length > 0) {
    try {
      const researchSummary = await summarizeResearch(researchResults);
      if (researchSummary) {
        await saveMemoryWithEmbedding({
          userId,
          type: 'semantic',
          content: researchSummary,
          significance: 0.7,
          tags: ['research', 'voice-derived'],
        });
        memoriesCreated++;
      }
    } catch (err) {
      console.error('[voice-enrich] Failed to save research memory:', err);
    }
  }

  stats.memoriesCreated = memoriesCreated;

  // Step 4: Mark messages as enriched
  try {
    await db
      .update(messages)
      .set({ enriched: true })
      .where(inArray(messages.id, messageIds));
    stats.processed = messageIds.length;
  } catch (err) {
    console.error('[voice-enrich] Failed to mark messages as enriched:', err);
  }

  // Step 5: Invalidate voice cache
  if (memoriesCreated > 0) {
    invalidateVoiceContext(userId);
  }

  console.log(`[voice-enrich] Processed ${stats.processed} messages, created ${stats.memoriesCreated} memories, ran ${stats.researchQueries} searches`);
  return stats;
}

async function extractTopics(transcript: string): Promise<TopicExtractionResult> {
  const provider = getProvider();

  const result = await provider.complete({
    tier: 'fast',
    maxTokens: 500,
    system: `You analyze voice conversation transcripts and extract structured intelligence.
Return ONLY valid JSON with this structure:
{
  "topics": ["topic1", "topic2"],
  "searchQueries": ["query to research"],
  "memorableStatements": ["key fact or statement worth remembering"]
}

- topics: Key subjects discussed (2-5)
- searchQueries: Questions worth researching for future conversations (0-3). Only include if the human expressed genuine curiosity or asked about something factual.
- memorableStatements: Important facts, preferences, experiences, or opinions shared by the human (0-5). Write these as third-person observations about the user, e.g. "User mentioned they enjoy hiking in Norway" or "User is working on a robotics project"`,
    messages: [
      {
        role: 'user',
        content: `Analyze this voice conversation:\n\n${transcript}`,
      },
    ],
  });

  return JSON.parse(extractJSON(result.text));
}

async function summarizeResearch(
  results: Array<{ query: string; summary: string }>,
): Promise<string | null> {
  if (results.length === 0) return null;

  const provider = getProvider();

  const researchText = results
    .map(r => `Query: ${r.query}\nFindings: ${r.summary}`)
    .join('\n\n');

  const result = await provider.complete({
    tier: 'fast',
    maxTokens: 300,
    system: `You summarize research findings into a concise memory entry.
Write a single paragraph (2-4 sentences) that captures the key findings.
Be factual and specific. This will be stored as a memory for future conversations.`,
    messages: [
      {
        role: 'user',
        content: `Summarize these research findings:\n\n${researchText}`,
      },
    ],
  });

  return result.text.trim() || null;
}
