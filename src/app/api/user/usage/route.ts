import { NextResponse } from 'next/server';
import { LOCAL_USER_ID } from '@/lib/local-user';
import { getUsageSummary } from '@/lib/tracked-anthropic';

export async function GET(): Promise<NextResponse> {
  const userId = LOCAL_USER_ID;

  try {
    const summary = await getUsageSummary(userId);
    return NextResponse.json(summary);
  } catch {
    return NextResponse.json({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costCents: 0,
      monthlyLimit: 500_000,
      remaining: 500_000,
      tier: 'free',
    });
  }
}
