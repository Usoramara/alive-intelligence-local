import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { ENGINE_ZONES, SIGNAL_PATHS } from '@/core/constants';
import type { Zone } from '@/core/constants';
import { getBodyRegistry, getTaskManager, initBodyHal } from '@/lib/body-hal-stub';

function parseIdentity(content: string) {
  const get = (key: string) => {
    const match = content.match(new RegExp(`^[-*]\\s*\\*?\\*?${key}\\*?\\*?\\s*[:：]\\s*(.+)`, 'mi'));
    return match?.[1]?.trim() ?? null;
  };
  return {
    name: get('Name') ?? get('name'),
    creature: get('Creature') ?? get('creature') ?? get('Species'),
    vibe: get('Vibe') ?? get('vibe') ?? get('Personality'),
    emoji: get('Emoji') ?? get('emoji'),
  };
}

export async function GET() {
  // Identity
  let identity: Record<string, string | null> | null = null;
  try {
    const idPath = join(homedir(), '.openclaw', 'workspace', 'IDENTITY.md');
    const content = await readFile(idPath, 'utf-8');
    identity = parseIdentity(content);
  } catch {
    identity = null;
  }

  // Tools — check env vars (never expose values)
  const tools = {
    search: {
      brave: !!process.env.BRAVE_API_KEY,
      perplexity: !!process.env.PERPLEXITY_API_KEY,
      grok: !!process.env.XAI_API_KEY,
    },
    voice: {
      elevenlabs: !!process.env.ELEVENLABS_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      deepgram: !!process.env.DEEPGRAM_API_KEY,
      edgeTts: true, // always available (node package)
    },
    codeExec: {
      e2b: !!process.env.E2B_API_KEY,
    },
    web: {
      firecrawl: !!process.env.FIRECRAWL_API_KEY,
      browserless: !!process.env.BROWSERLESS_API_KEY,
    },
    email: {
      resend: !!process.env.RESEND_API_KEY,
      gmail: !!process.env.GMAIL_ACCESS_TOKEN,
    },
    imageGen: {
      openai: !!process.env.OPENAI_API_KEY,
    },
  };

  // Channels
  const channels = {
    discord: !!process.env.DISCORD_BOT_TOKEN,
    slack: !!process.env.SLACK_BOT_TOKEN,
    telegram: !!process.env.TELEGRAM_BOT_TOKEN,
    whatsapp: !!process.env.WHATSAPP_ACCESS_TOKEN,
  };

  // Body HAL
  let body: { adapter: string | null; manifest: unknown; activeTasks: number } = {
    adapter: null,
    manifest: null,
    activeTasks: 0,
  };
  try {
    await initBodyHal();
    const registry = getBodyRegistry();
    const active = registry.getActive();
    body = {
      adapter: active?.adapter?.constructor?.name ?? null,
      manifest: registry.getManifest() ?? null,
      activeTasks: getTaskManager().listActiveTasks().length,
    };
  } catch {
    // body stays null
  }

  // Engines (static counts from constants)
  const zoneCounts: Record<Zone, number> = { outer: 0, inner: 0, thalamus: 0, body: 0 };
  for (const zone of Object.values(ENGINE_ZONES)) {
    zoneCounts[zone]++;
  }
  const engines = {
    total: Object.keys(ENGINE_ZONES).length,
    byZone: zoneCounts,
    signalPaths: SIGNAL_PATHS.length,
  };

  // Security
  const security = {
    encryption: !!process.env.ENCRYPTION_KEY,
    cronSecret: !!process.env.CRON_SECRET,
    clerkAuth:
      !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
      !!process.env.CLERK_SECRET_KEY,
  };

  // Database
  let database = { connected: false };
  try {
    const db = getDb();
    db.get(sql`SELECT 1`);
    database = { connected: true };
  } catch {
    database = { connected: false };
  }

  return NextResponse.json({
    identity,
    tools,
    channels,
    body,
    engines,
    security,
    database,
  });
}
