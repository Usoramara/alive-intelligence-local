/**
 * Stub for OpenClaw body-hal extension.
 * The original imports from an external openclaw/ directory that doesn't exist
 * in this standalone repo. This stub provides no-op implementations.
 */

interface StubTask {
  id: string;
  intent: string;
  bodyId: string;
  status: string;
  steps: { id: string; command: string; params: unknown }[];
  stepResults: Map<string, { status: string; data?: unknown }>;
  error: string | null;
  timestamps: Record<string, string>;
}

export async function initBodyHal(): Promise<void> {
  // No-op — body HAL not available in standalone mode
}

export function getBodyRegistry() {
  return {
    getManifest: () => null as Record<string, unknown> | null,
    getStatus: () => ({ connected: false }),
    getActive: () => null as { adapter?: { constructor?: { name?: string } } } | null,
  };
}

export function getTaskManager() {
  return {
    getTask: (_id: string): StubTask | null => null,
    listTasks: (): StubTask[] => [],
    listAllTasks: (): StubTask[] => [],
    listActiveTasks: (): StubTask[] => [],
    createTask: () => ({ id: 'stub', status: 'unsupported' }),
    submit: async (_intent: unknown, _bodyId?: string) => ({ taskId: null as string | null, error: 'Body HAL not available' }),
    abort: (_id: string) => false,
  };
}
