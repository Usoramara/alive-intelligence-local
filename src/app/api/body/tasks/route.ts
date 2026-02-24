import { NextResponse } from 'next/server';
import { getTaskManager, initBodyHal } from '@/lib/body-hal-stub';

export async function GET(): Promise<NextResponse> {
  await initBodyHal();
  const taskManager = getTaskManager();

  const tasks = taskManager.listAllTasks().map((task) => ({
    id: task.id,
    intent: task.intent,
    bodyId: task.bodyId,
    status: task.status,
    stepCount: task.steps.length,
    completedSteps: [...task.stepResults.values()].filter((r) => r.status === 'completed').length,
    error: task.error,
    timestamps: task.timestamps,
  }));

  return NextResponse.json({ tasks });
}
