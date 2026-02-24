import { NextResponse } from 'next/server';
import { LOCAL_USER_ID } from '@/lib/local-user';
import { getDb } from '@/db';
import { messages, conversations } from '@/db/schema';
import { eq, and, asc } from 'drizzle-orm';

export async function GET(request: Request): Promise<NextResponse> {
  const userId = LOCAL_USER_ID;

  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get('conversationId');
  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId required' }, { status: 400 });
  }

  const db = getDb();

  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));

  if (!conv) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  const results = await db
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      emotionShift: messages.emotionShift,
      metadata: messages.metadata,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
    .limit(200);

  return NextResponse.json({ messages: results });
}

export async function POST(request: Request): Promise<NextResponse> {
  const userId = LOCAL_USER_ID;

  const body = await request.json();
  const { conversationId, role, content, emotionShift, metadata } = body;

  if (!conversationId || !role || !content) {
    return NextResponse.json({ error: 'conversationId, role, content required' }, { status: 400 });
  }

  const db = getDb();

  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));

  if (!conv) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  const [message] = await db
    .insert(messages)
    .values({
      conversationId,
      role,
      content,
      emotionShift: emotionShift ? JSON.stringify(emotionShift) : null,
      metadata: metadata ? JSON.stringify(metadata) : null,
    })
    .returning();

  await db
    .update(conversations)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(conversations.id, conversationId));

  return NextResponse.json({ message });
}
