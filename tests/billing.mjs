import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const temp = mkdtempSync(join(tmpdir(), "foundry-billing-"));
const statements = [];
const secret = "whsec_local_test";
globalThis.__billingTestEnv = {
  STRIPE_WEBHOOK_SECRET: secret,
  DB: {
    prepare: (sql) => ({
      bind: (...values) => ({ run: async () => { statements.push({ sql, values }); } }),
    }),
  },
};
const source = readFileSync("app/api/billing/webhook/route.ts", "utf8").replace(
  'import { appEnv } from "@/lib/env";',
  "const appEnv = globalThis.__billingTestEnv;",
);
writeFileSync(join(temp, "webhook.ts"), source);
const { POST } = await import(pathToFileURL(join(temp, "webhook.ts")));
async function deliver(event, valid = true) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return POST(new Request("https://foundry.example/api/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": `t=${timestamp},v1=${"0".repeat(64)},v1=${valid ? signature : "1".repeat(64)}` },
    body,
  }));
}
try {
  let response = await deliver({
    type: "checkout.session.completed",
    data: { object: { client_reference_id: "user-1", customer: "cus_1", payment_status: "paid" } },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(statements[0].values, ["cus_1", "paid", "user-1"]);
  response = await deliver({
    type: "customer.subscription.updated",
    data: { object: { customer: "cus_1", status: "active" } },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(statements[1].values, ["pro", "cus_1"]);
  response = await deliver({
    type: "customer.subscription.deleted",
    data: { object: { customer: "cus_1", status: "canceled" } },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(statements[2].values, ["free", "cus_1"]);
  response = await deliver({ type: "customer.subscription.updated", data: { object: { customer: "cus_1", status: "active" } } }, false);
  assert.equal(response.status, 400);
  assert.equal(statements.length, 3, "Invalid signatures must not change billing state");
  console.log("Billing check passed: signed checkout, upgrade, cancellation, invalid signature");
} finally {
  delete globalThis.__billingTestEnv;
  rmSync(temp, { recursive: true, force: true });
}
