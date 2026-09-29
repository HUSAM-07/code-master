import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { Webhook } from "standardwebhooks";

const temp = mkdtempSync(join(tmpdir(), "foundry-billing-"));
const secret = `whsec_${Buffer.from("local-test-secret").toString("base64")}`;
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE users(id TEXT PRIMARY KEY, dodo_customer_id TEXT, dodo_subscription_id TEXT, dodo_event_at INTEGER, plan TEXT NOT NULL DEFAULT 'free'); INSERT INTO users(id) VALUES('user-1')");
globalThis.__billingTestEnv = {
  DODO_WEBHOOK_KEY: secret,
  DODO_PRODUCT_ID: "pdt_pro",
  DB: {
    prepare: (sql) => ({
      bind: (...values) => ({
        first: async () => db.prepare(sql).get(...values),
        run: async () => db.prepare(sql).run(...values),
      }),
    }),
  },
};
globalThis.__billingVerifier = Webhook;
const source = readFileSync("app/api/billing/webhook/route.ts", "utf8")
  .replace('import { Webhook } from "standardwebhooks";', "const Webhook = globalThis.__billingVerifier;")
  .replace('import { appEnv } from "@/lib/env";', "const appEnv = globalThis.__billingTestEnv;")
  .replace('import { rawBody } from "@/lib/http";', "const rawBody = (request) => request.text();")
  .replace('import { jsonError } from "@/lib/security";', "const jsonError = (error) => error instanceof Response ? error : new Response('Error', { status: 500 });");
writeFileSync(join(temp, "webhook.ts"), source);
const { POST } = await import(pathToFileURL(join(temp, "webhook.ts")));
const now = Date.now();
let delivery = 0;
function event(status, offset, subscription = "sub_1", product = "pdt_pro") {
  return {
    type: `subscription.${status}`,
    timestamp: new Date(now + offset).toISOString(),
    data: {
      subscription_id: subscription,
      product_id: product,
      status,
      customer: { customer_id: "cus_1" },
      metadata: { foundry_user_id: "user-1" },
      past_due_ends_at: new Date(now + 86400000).toISOString(),
    },
  };
}
async function deliver(payload, valid = true) {
  const body = JSON.stringify(payload);
  const id = `msg_${++delivery}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = new Webhook(secret).sign(id, new Date(timestamp * 1000), body);
  return POST(new Request("https://foundry.example/api/billing/webhook", {
    method: "POST",
    headers: {
      "webhook-id": id,
      "webhook-timestamp": String(timestamp),
      "webhook-signature": valid ? signature : "v1,invalid",
    },
    body,
  }));
}
function account() {
  return db.prepare("SELECT plan,dodo_customer_id,dodo_subscription_id FROM users WHERE id='user-1'").get();
}
try {
  assert.equal((await deliver(event("active", 0))).status, 200);
  assert.deepEqual({ ...account() }, { plan: "pro", dodo_customer_id: "cus_1", dodo_subscription_id: "sub_1" });
  assert.equal((await deliver(event("past_due", 1000))).status, 200);
  assert.equal(account().plan, "pro", "Past due accounts keep access during grace");
  assert.equal((await deliver(event("cancelled", -1000))).status, 200);
  assert.equal(account().plan, "pro", "Older events must not undo a newer state");
  assert.equal((await deliver(event("cancelled", 2000))).status, 200);
  assert.equal(account().plan, "free");
  assert.equal((await deliver(event("active", 3000, "sub_2"))).status, 200);
  assert.equal(account().dodo_subscription_id, "sub_2");
  assert.equal((await deliver(event("cancelled", 4000, "sub_1"))).status, 200);
  assert.equal(account().plan, "pro", "An old subscription must not cancel the new one");
  assert.equal((await deliver(event("active", 5000, "sub_3", "pdt_other"))).status, 200);
  assert.equal(account().plan, "pro", "Other products must not change Foundry Pro");
  assert.equal((await deliver(event("cancelled", 6000), false)).status, 400);
  assert.equal(account().plan, "pro", "Invalid signatures must not change billing state");
  console.log("Billing check passed: signed Dodo events, grace, ordering, cancellation, product isolation");
} finally {
  db.close();
  delete globalThis.__billingTestEnv;
  delete globalThis.__billingVerifier;
  rmSync(temp, { recursive: true, force: true });
}
