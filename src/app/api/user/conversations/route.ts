import { NextResponse } from 'next/server';
import { LOCAL_USER_ID } from '@/lib/local-user';
import { getDb } from '@/db';
import { conversations } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET(): Promise<NextResponse> {
  const userId = LOCAL_USER_ID;

  const db = getDb();
  const results = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt))
    .limit(50);

  return NextResponse.json({ conversations: results });
}

export async function POST(request: Request): Promise<NextResponse> {
  const userId = LOCAL_USER_ID;

  const body = await request.json();
  const db = getDb();

  const [conversation] = await db
    .insert(conversations)
    .values({
      userId,
      title: body.title ?? 'New conversation',
    })
    .returning();

  return NextResponse.json({ conversation });
}
