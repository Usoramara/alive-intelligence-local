import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Rate limiting (local single-user, keyed by IP)
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 600;

const hits = new Map<string, { count: number; resetAt: number }>();

let lastCleanup = Date.now();
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < WINDOW_MS) return;
  lastCleanup = now;
  for (const [key, entry] of hits) {
    if (now > entry.resetAt) {
      hits.delete(key);
    }
  }
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

function rateLimit(key: string, maxRequests: number): NextResponse | null {
  cleanup();

  const now = Date.now();
  let entry = hits.get(key);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    hits.set(key, entry);
  }

  entry.count++;

  if (entry.count > maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfter) },
      },
    );
  }

  return null;
}

export default function middleware(request: NextRequest): NextResponse {
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/mind') ||
    request.nextUrl.pathname.startsWith('/api/user');

  if (isApiRoute) {
    const rateLimitKey = `ip:${getClientIp(request)}`;
    const rateLimitResponse = rateLimit(rateLimitKey, MAX_REQUESTS);
    if (rateLimitResponse) return rateLimitResponse;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
