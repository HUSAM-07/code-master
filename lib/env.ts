import { env } from "cloudflare:workers";

export type AppEnv = {
  DB: D1Database;
  JOBS: Queue<{ runId: string; projectId: string }>;
  APP_ENCRYPTION_KEY: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
};

export const appEnv = env as unknown as AppEnv;
