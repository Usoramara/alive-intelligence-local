import { getDb } from '@/db';
import { memories } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { embed } from './embeddings';

export interface MemoryInput {
  userId: string;
  type: 'episodic' | 'semantic' | 'procedural' | 'person';
  content: string;
  significance: number;
  tags?: string[];
}

export interface MemoryResult {
  id: string;
  type: string;
  content: string;
  significance: number;
  tags: string[] | null;
  similarity?: number;
  createdAt: Date;
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

/**
 * Save a memory with its vector embedding.
 * Embedding is stored as JSON text in SQLite.
 */
export async function saveMemoryWithEmbedding(input: MemoryInput): Promise<string> {
  const db = getDb();
  const embeddingVec = await embed(input.content);

  const [row] = await db.insert(memories).values({
    userId: input.userId,
    type: input.type,
    content: input.content,
    significance: input.significance,
    tags: JSON.stringify(input.tags ?? []),
    embedding: JSON.stringify(embeddingVec),
  }).returning({ id: memories.id });

  return row.id;
}

/**
 * Semantic search using cosine similarity computed in JavaScript.
 * Loads all user memories with embeddings, computes similarity, and ranks.
 * Efficient enough for single-user local use (<10k memories).
 */
export async function searchMemories(
  userId: string,
  query: string,
  limit = 10,
  minSimilarity = 0.3,
): Promise<MemoryResult[]> {
  const db = getDb();
  const queryEmbedding = await embed(query);

  // Fetch all memories with embeddings for this user
  const allMemories = await db
    .select({
      id: memories.id,
      type: memories.type,
      content: memories.content,
      significance: memories.significance,
      tags: memories.tags,
      createdAt: memories.createdAt,
      embedding: memories.embedding,
    })
    .from(memories)
    .where(eq(memories.userId, userId));

  // Compute cosine similarity for each memory
  const scored = allMemories
    .filter(m => m.embedding) // Only memories with embeddings
    .map(m => {
      const embeddingVec = JSON.parse(m.embedding!) as number[];
      const similarity = cosineSimilarity(queryEmbedding, embeddingVec);
      return {
        id: m.id,
        type: m.type,
        content: m.content,
        significance: m.significance,
        tags: m.tags ? (JSON.parse(m.tags) as string[]) : null,
        createdAt: new Date(m.createdAt),
        similarity,
      };
    })
    .filter(m => m.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return scored;
}

/**
 * Get recent memories for a user (no semantic search, just chronological).
 */
export async function getRecentMemories(
  userId: string,
  limit = 20,
): Promise<MemoryResult[]> {
  const db = getDb();

  const results = await db
    .select({
      id: memories.id,
      type: memories.type,
      content: memories.content,
      significance: memories.significance,
      tags: memories.tags,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(eq(memories.userId, userId))
    .orderBy(desc(memories.createdAt))
    .limit(limit);

  return results.map(m => ({
    ...m,
    tags: m.tags ? (JSON.parse(m.tags) as string[]) : null,
    createdAt: new Date(m.createdAt),
  }));
}
