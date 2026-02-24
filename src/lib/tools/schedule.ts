// Scheduling tool — stores jobs in Neon PostgreSQL
// Jobs are checked by a Vercel Cron endpoint every minute

import { getDb } from '@/db';
import { scheduledJobs } from '@/db/schema';
import { eq, and, lte } from 'drizzle-orm';

export interface ScheduleTaskOutput {
  id: string;
  description: string;
  next_run_at: string;
  cron?: string;
  status: string;
}

function parseCronToNextRun(cronExpr: string, timezone?: string): Date {
  // Simple next-run calculator for common cron patterns
  // For production, use the croner library
  const now = new Date();
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: ${cronExpr}. Expected 5 fields (minute hour day month weekday).`);
  }
  // Default: run 1 minute from now (the cron endpoint will handle recurring)
  return new Date(now.getTime() + 60_000);
}

export async function scheduleTask(params: {
  description: string;
  run_at?: string;
  cron?: string;
  timezone?: string;
  userId?: string;
}): Promise<ScheduleTaskOutput> {
  if (!params.run_at && !params.cron) {
    throw new Error('Either run_at (ISO datetime) or cron (cron expression) is required.');
  }

  let nextRunAt: Date;
  if (params.run_at) {
    nextRunAt = new Date(params.run_at);
    if (isNaN(nextRunAt.getTime())) {
      throw new Error(`Invalid datetime: ${params.run_at}`);
    }
  } else {
    nextRunAt = parseCronToNextRun(params.cron!, params.timezone);
  }

  const db = getDb();
  const [job] = await db
    .insert(scheduledJobs)
    .values({
      userId: params.userId ?? 'system',
      description: params.description,
      cronExpr: params.cron ?? null,
      nextRunAt: nextRunAt.toISOString(),
      timezone: params.timezone ?? 'UTC',
      status: 'active',
      payload: JSON.stringify({ type: 'reminder', message: params.description }),
    })
    .returning();

  return {
    id: job.id,
    description: params.description,
    next_run_at: nextRunAt.toISOString(),
    cron: params.cron,
    status: 'active',
  };
}

export async function listSchedules(params: {
  userId?: string;
}): Promise<{ schedules: ScheduleTaskOutput[]; count: number }> {
  if (!params.userId) {
    return { schedules: [], count: 0 };
  }

  const db = getDb();
  const jobs = await db
    .select()
    .from(scheduledJobs)
    .where(and(
      eq(scheduledJobs.userId, params.userId),
      eq(scheduledJobs.status, 'active'),
    ));

  const schedules = jobs.map(j => ({
    id: j.id,
    description: j.description,
    next_run_at: j.nextRunAt,
    cron: j.cronExpr ?? undefined,
    status: j.status,
  }));

  return { schedules, count: schedules.length };
}

export async function cancelSchedule(params: {
  schedule_id: string;
  userId?: string;
}): Promise<{ success: boolean; message: string }> {
  const db = getDb();

  const conditions = [eq(scheduledJobs.id, params.schedule_id)];
  if (params.userId) {
    conditions.push(eq(scheduledJobs.userId, params.userId));
  }

  const updated = await db
    .update(scheduledJobs)
    .set({ status: 'cancelled', updatedAt: new Date().toISOString() })
    .where(and(...conditions))
    .returning();

  if (updated.length === 0) {
    return { success: false, message: 'Schedule not found or already cancelled.' };
  }

  return { success: true, message: `Schedule ${params.schedule_id} cancelled.` };
}

/**
 * Process due jobs — called by the cron endpoint.
 * Returns jobs that are ready to fire.
 */
export async function processDueJobs(): Promise<Array<{ id: string; userId: string; description: string; payload: string }>> {
  const db = getDb();
  const now = new Date().toISOString();

  const dueJobs = await db
    .select()
    .from(scheduledJobs)
    .where(and(
      eq(scheduledJobs.status, 'active'),
      lte(scheduledJobs.nextRunAt, now),
    ));

  const results = [];

  for (const job of dueJobs) {
    results.push({
      id: job.id,
      userId: job.userId,
      description: job.description,
      payload: job.payload ?? '{}',
    });

    if (job.cronExpr) {
      // Recurring: calculate next run
      const nextRun = parseCronToNextRun(job.cronExpr, job.timezone ?? 'UTC');
      await db
        .update(scheduledJobs)
        .set({ nextRunAt: nextRun.toISOString(), updatedAt: new Date().toISOString() })
        .where(eq(scheduledJobs.id, job.id));
    } else {
      // One-time: mark as completed
      await db
        .update(scheduledJobs)
        .set({ status: 'completed', updatedAt: new Date().toISOString() })
        .where(eq(scheduledJobs.id, job.id));
    }
  }

  return results;
}
