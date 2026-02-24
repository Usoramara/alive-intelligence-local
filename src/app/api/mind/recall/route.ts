import { NextResponse } from 'next/server';
import { LOCAL_USER_ID } from '@/lib/local-user';
import { searchMemories } from '@/lib/memory/manager';
import { z } from 'zod';

const recallSchema = z.object({
  query: z.string().min(1).max(10_000),
  limit: z.number().int().min(1).max(50).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const userId = LOCAL_USER_ID;

  let body: z.infer<typeof recallSchema>;
  try {
    const raw = await request.json();
    const result = recallSchema.safeParse(raw);
    if (!result.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    body = result.data;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const results = await searchMemories(userId, body.query, body.limit ?? 10);

  return NextResponse.json({
    ranked: results.map(r => ({
      id: r.id,
      content: r.content,
      relevance: r.similarity ?? 0,
      type: r.type,
    })),
  });
}
