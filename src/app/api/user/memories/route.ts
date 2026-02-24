import { NextResponse } from 'next/server';
import { LOCAL_USER_ID } from '@/lib/local-user';
import { searchMemories, saveMemoryWithEmbedding, getRecentMemories } from '@/lib/memory/manager';

export async function GET(request: Request): Promise<NextResponse> {
  const userId = LOCAL_USER_ID;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '10'), 50);

  if (query) {
    const results = await searchMemories(userId, query, limit);
    return NextResponse.json({ memories: results });
  }

  const results = await getRecentMemories(userId, limit);
  return NextResponse.json({ memories: results });
}

export async function POST(request: Request): Promise<NextResponse> {
  const userId = LOCAL_USER_ID;

  const body = await request.json();
  const { type, content, significance, tags } = body;

  if (!content || typeof content !== 'string') {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  const id = await saveMemoryWithEmbedding({
    userId,
    type: type ?? 'episodic',
    content,
    significance: significance ?? 0.5,
    tags: tags ?? [],
  });

  return NextResponse.json({ id });
}
