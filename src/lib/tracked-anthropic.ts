import { getDb } from '@/db';
import { usageRecords, users } from '@/db/schema';
import { eq, and, gte, sql } from 'drizzle-orm';
import { getProviderMode } from '@/lib/llm';

// Cost per million tokens (in cents) — cloud models
const COST_PER_MTK: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 300, output: 1500 },
  'claude-haiku-4-5-20251001': { input: 100, output: 500 },
};

// Local models have zero cost
const LOCAL_COST = { input: 0, output: 0 };

// Tier limits (tokens per month)
const TIER_LIMITS: Record<string, number> = {
  free: 500_000,
  pro: 5_000_000,
  enterprise: Infinity,
  local: Infinity, // No limits for local mode
};

// Rate limits (messages per hour)
const TIER_RATE_LIMITS: Record<string, number> = {
  free: 20,
  pro: 100,
  enterprise: 1000,
  local: Infinity,
};

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
  monthlyLimit: number;
  remaining: number;
  tier: string;
}

/**
 * Log a usage record for an API call.
 * Works for both cloud (Anthropic) and local (Ollama) providers.
 */
export async function logUsage(
  userId: string,
  endpoint: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  const db = getDb();
  const isLocal = getProviderMode() === 'local';
  const costs = isLocal ? LOCAL_COST : (COST_PER_MTK[model] ?? { input: 300, output: 1500 });
  const costCents = (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;

  await db.insert(usageRecords).values({
    userId,
    endpoint,
    model,
    inputTokens,
    outputTokens,
    costCents,
  });
}

/**
 * Track usage from a provider CompletionResult.
 */
export async function trackProviderUsage(
  userId: string,
  endpoint: string,
  model: string,
  usage: { inputTokens: number; outputTokens: number },
): Promise<void> {
  await logUsage(userId, endpoint, model, usage.inputTokens, usage.outputTokens);
}

/**
 * Get usage summary for the current month.
 */
export async function getUsageSummary(userId: string): Promise<UsageSummary> {
  const db = getDb();
  const isLocal = getProviderMode() === 'local';

  // Get user tier
  const [user] = await db.select({ tier: users.tier }).from(users).where(eq(users.id, userId));
  const tier = isLocal ? 'local' : (user?.tier ?? 'free');

  // Aggregate usage for current month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [usage] = await db
    .select({
      inputTokens: sql<number>`coalesce(sum(${usageRecords.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${usageRecords.outputTokens}), 0)`,
      costCents: sql<number>`coalesce(sum(${usageRecords.costCents}), 0)`,
    })
    .from(usageRecords)
    .where(
      and(
        eq(usageRecords.userId, userId),
        gte(usageRecords.createdAt, startOfMonth),
      ),
    );

  const totalTokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  const monthlyLimit = TIER_LIMITS[tier] ?? TIER_LIMITS.free;

  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    totalTokens,
    costCents: usage?.costCents ?? 0,
    monthlyLimit,
    remaining: Math.max(0, monthlyLimit - totalTokens),
    tier,
  };
}

/**
 * Check if user is within their usage limits.
 * Local mode always allows usage.
 */
export async function checkUsageLimit(userId: string): Promise<{ allowed: boolean; reason?: string }> {
  if (getProviderMode() === 'local') {
    return { allowed: true };
  }

  const summary = await getUsageSummary(userId);

  if (summary.remaining <= 0 && summary.monthlyLimit !== Infinity) {
    return {
      allowed: false,
      reason: `Monthly token limit reached (${summary.monthlyLimit.toLocaleString()} tokens). Upgrade to Pro for more.`,
    };
  }

  return { allowed: true };
}
