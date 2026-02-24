import { createApiHandler } from '@/lib/api-handler';
import { bodyExecuteSchema } from '@/lib/schemas';
import { getTaskManager, initBodyHal } from '@/lib/body-hal-stub';
import type { BodyIntent } from '@/core/hal/types';

export const POST = createApiHandler({
  schema: bodyExecuteSchema,
  handler: async (params) => {
    await initBodyHal();
    const taskManager = getTaskManager();

    const result = await taskManager.submit(params.intent as BodyIntent, params.bodyId);

    if (result.error && !result.taskId) {
      return { error: result.error };
    }

    return {
      taskId: result.taskId,
      error: result.error,
    };
  },
});
