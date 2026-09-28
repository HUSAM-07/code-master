import handler from "vinext/server/fetch-handler";
import { enqueueDueProjects, runProject } from "../lib/agent";
import type { AppEnv } from "../lib/env";

export default {
  fetch: handler.fetch,
  async scheduled(_event: ScheduledController, env: AppEnv) {
    await enqueueDueProjects(env);
  },
  async queue(
    batch: MessageBatch<{ runId: string; projectId: string }>,
    env: AppEnv,
  ) {
    for (const message of batch.messages) {
      try {
        await runProject(env, message.body.runId, message.body.projectId);
        message.ack();
      } catch (error) {
        console.error("Run failed", error);
        message.retry();
      }
    }
  },
};
