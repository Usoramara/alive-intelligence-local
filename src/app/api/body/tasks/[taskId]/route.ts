import { NextResponse } from 'next/server';
import { getTaskManager, initBodyHal } from '@/lib/body-hal-stub';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  const { taskId } = await params;
  await initBodyHal();
  const taskManager = getTaskManager();

  const task = taskManager.getTask(taskId);
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: task.id,
    intent: task.intent,
    bodyId: task.bodyId,
    status: task.status,
    steps: task.steps.map((step) => ({
      id: step.id,
      command: step.command,
      params: step.params,
      result: task.stepResults.get(step.id) ?? null,
    })),
    error: task.error,
    timestamps: task.timestamps,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  const { taskId } = await params;
  await initBodyHal();
  const taskManager = getTaskManager();

  const aborted = taskManager.abort(taskId);
  if (!aborted) {
    return NextResponse.json({ error: 'Task not found or already completed' }, { status: 404 });
  }

  return NextResponse.json({ aborted: true, taskId });
}
