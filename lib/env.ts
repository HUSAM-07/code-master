import { env } from "cloudflare:workers";

export type AppEnv = {
  DB: D1Database;
  JOBS: Queue<{ runId: string; projectId: string }>;
  APP_ENCRYPTION_KEY: string;
  DODO_API_KEY?: string;
  DODO_WEBHOOK_KEY?: string;
  DODO_PRODUCT_ID?: string;
  DODO_MODE?: "test" | "live";
};

export const appEnv = env as unknown as AppEnv;
