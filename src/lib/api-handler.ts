import { NextResponse } from 'next/server';
import { LOCAL_USER_ID } from '@/lib/local-user';
import type { ZodSchema, ZodError } from 'zod';

const isDev = process.env.NODE_ENV === 'development';

interface ApiHandlerOptions<T> {
  schema: ZodSchema<T>;
  handler: (body: T, userId: string | null) => Promise<NextResponse | object>;
  requireAuth?: boolean;
}

export function createApiHandler<T>({ schema, handler }: ApiHandlerOptions<T>) {
  return async function POST(request: Request): Promise<NextResponse> {
    // Local mode: always use the local user
    const userId: string = LOCAL_USER_ID;

    // Parse and validate body
    let body: T;
    try {
      const raw = await request.json();
      const result = schema.safeParse(raw);
      if (!result.success) {
        const message = isDev
          ? formatZodError(result.error)
          : 'Invalid request body';
        return NextResponse.json({ error: message }, { status: 400 });
      }
      body = result.data;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // Execute handler
    try {
      const result = await handler(body, userId);
      if (result instanceof NextResponse) {
        return result;
      }
      return NextResponse.json(result);
    } catch (error) {
      console.error('API handler error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 },
      );
    }
  };
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .join('; ');
}
