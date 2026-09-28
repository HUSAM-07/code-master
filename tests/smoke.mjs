import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes, createHash, createHmac, webcrypto } from "node:crypto";

const base = "http://localhost:5173";
const databases = await (
  await fetch(`${base}/cdn-cgi/local/explorer/api/d1/database`)
).json();
const dbId = databases.result?.find((item) => item.name === "DB")?.uuid;
assert.ok(dbId, "The local Worker needs a DB binding");
const db = `${base}/cdn-cgi/local/explorer/api/d1/database/${encodeURIComponent(dbId)}/raw`;
const keyText = readFileSync(".dev.vars", "utf8").match(
  /^APP_ENCRYPTION_KEY=(.+)$/m,
)?.[1];
assert.ok(keyText, "Create .dev.vars with APP_ENCRYPTION_KEY first");
const key = await webcrypto.subtle.importKey(
  "raw",
  Buffer.from(keyText, "base64"),
  "AES-GCM",
  false,
  ["encrypt"],
);
const iv = randomBytes(12);
const ciphertext = Buffer.from(
  await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    Buffer.from("local-test-token"),
  ),
).toString("base64");
async function sql(query, params = []) {
  const response = await fetch(db, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql: query, params: params.map(String) }),
  });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.equal(data.success, true, JSON.stringify(data));
  return data;
}
const suffix = randomBytes(6).toString("hex");
const owner = `test-owner-${suffix}`;
const other = `test-other-${suffix}`;
const project = `test-project-${suffix}`;
const ownerSession = randomBytes(32).toString("base64");
const otherSession = randomBytes(32).toString("base64");
const sessionHash = (token) =>
  createHash("sha256").update(token).digest("base64");
async function request(path, token, init) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      Cookie: `foundry_session=${encodeURIComponent(token)}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
}
async function waitRun(id) {
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const response = await request(`/api/projects/${project}`, ownerSession);
    const status = (await response.json()).runs.find((item) => item.id === id)?.status;
    if (status !== "queued" && status !== "running") return status;
  }
  return "timed out";
}
try {
  for (const id of [owner, other])
    await sql(
      "INSERT INTO users(id,login,pat_iv,pat_ciphertext) VALUES(?,?,?,?)",
      [id, id, iv.toString("base64"), ciphertext],
    );
  await sql(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
    [sessionHash(ownerSession), owner, Math.floor(Date.now() / 1000) + 3600],
  );
  await sql(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
    [sessionHash(otherSession), other, Math.floor(Date.now() / 1000) + 3600],
  );
  await sql(
    "INSERT INTO projects(id,user_id,name,repo,brief) VALUES(?,?,?,?,?)",
    [project, owner, "Local smoke", "example/repo", "A test project"],
  );

  let response = await request("/api/session", ownerSession);
  assert.equal((await response.json()).billing_ready, false, "Checkout must report unconfigured billing");
  response = await request(`/api/projects/${project}`, ownerSession);
  assert.equal(response.status, 200);
  response = await request(`/api/projects/${project}`, otherSession);
  assert.equal(response.status, 404, "Another user must not read this project");
  response = await request(`/api/projects/${project}/secrets`, ownerSession, {
    method: "PUT",
    body: JSON.stringify({ name: "AI_PROVIDER", value: "openai" }),
  });
  assert.equal(response.status, 200);
  response = await request(`/api/projects/${project}/context`, ownerSession, {
    method: "POST",
    body: JSON.stringify({ content: "Build the onboarding page" }),
  });
  assert.equal(response.status, 201);
  response = await request(`/api/projects/${project}`, ownerSession);
  const detail = await response.json();
  assert.ok(detail.secrets.some((item) => item.name === "AI_PROVIDER"));
  assert.ok(
    !JSON.stringify(detail).includes("ciphertext"),
    "Secret values must stay hidden",
  );
  assert.ok(
    detail.context.some((item) => item.content === "Build the onboarding page"),
  );
  response = await request(`/api/projects/${project}/runs`, ownerSession, {
    method: "POST",
    body: "{}",
  });
  assert.equal(response.status, 202, "A manual run must enter the queue");
  const { id: runId } = await response.json();
  assert.equal(await waitRun(runId), "failed", "The queue consumer must process the run");
  await sql("UPDATE context_items SET created_at='2020-01-01' WHERE project_id=?", [project]);
  await sql(
    "INSERT INTO runs(id,project_id,kind,status,created_at) VALUES(?,?,'scheduled','completed','2025-01-01')",
    [`completed-${suffix}`, project],
  );
  response = await request(`/api/projects/${project}/runs`, ownerSession, {
    method: "POST",
    body: "{}",
  });
  assert.equal(response.status, 202);
  assert.equal(await waitRun((await response.json()).id), "failed", "Work must continue without new context");
  const scheduled = `${base}/cdn-cgi/local/scheduled?cron=${encodeURIComponent("*/15 * * * *")}`;
  response = await fetch(scheduled);
  assert.equal(response.status, 200, "The cron handler must run");
  let scheduledRuns = (await (await request(`/api/projects/${project}`, ownerSession)).json()).runs;
  assert.equal(scheduledRuns.length, 3, "Projects without an AI key must not sweep");
  await sql("UPDATE projects SET last_swept_at=? WHERE id=?", [Math.floor(Date.now() / 1000), project]);
  response = await request(`/api/projects/${project}/secrets`, ownerSession, {
    method: "PUT",
    body: JSON.stringify({ name: "AI_API_KEY", value: "test-key" }),
  });
  assert.equal(response.status, 200);
  const sweep = await sql("SELECT last_swept_at FROM projects WHERE id=?", [project]);
  assert.equal(sweep.result[0].results.rows[0][0], null, "Adding an AI key must make the next sweep due");
  response = await fetch(scheduled);
  assert.equal(response.status, 200);
  scheduledRuns = (await (await request(`/api/projects/${project}`, ownerSession)).json()).runs;
  assert.equal(scheduledRuns.length, 4, "Free projects must get a daily sweep");
  response = await fetch(scheduled);
  assert.equal(response.status, 200);
  scheduledRuns = (await (await request(`/api/projects/${project}`, ownerSession)).json()).runs;
  assert.equal(scheduledRuns.length, 4, "Cron must respect the daily interval");
  response = await request(`/api/projects/${project}/runs`, ownerSession, {
    method: "POST",
    body: "{}",
  });
  assert.equal(response.status, 202, "Scheduled work must not use manual quota");
  response = await request(`/api/projects/${project}/runs`, ownerSession, {
    method: "POST",
    body: "{}",
  });
  assert.equal(response.status, 402, "The fourth manual run must be limited");
  response = await request(`/api/projects/${project}/channels`, ownerSession, {
    method: "POST",
    body: JSON.stringify({ kind: "whatsapp", name: "Test chat", channel_ref: "12345" }),
  });
  assert.equal(response.status, 201);
  const { id: channelId } = await response.json();
  for (const [name, value] of [["WHATSAPP_APP_SECRET", "local-app-secret"], ["WHATSAPP_VERIFY_TOKEN", "local-verify"]]) {
    response = await request(`/api/projects/${project}/secrets`, ownerSession, {
      method: "PUT",
      body: JSON.stringify({ name, value }),
    });
    assert.equal(response.status, 200);
  }
  const webhook = `${base}/api/webhooks/whatsapp/${channelId}`;
  response = await fetch(`${webhook}?hub.mode=subscribe&hub.verify_token=local-verify&hub.challenge=verified`);
  assert.equal(await response.text(), "verified", "Meta verification must work");
  const message = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "12345" }, messages: [{ id: `wa-${suffix}`, type: "text", text: { body: "Customer wants dark mode" } }] } }] }] });
  const signature = createHmac("sha256", "local-app-secret").update(message).digest("hex");
  response = await fetch(webhook, { method: "POST", headers: { "x-hub-signature-256": `sha256=${signature}` }, body: message });
  assert.equal(response.status, 200, "Signed WhatsApp messages must be accepted");
  response = await fetch(webhook, { method: "POST", headers: { "x-hub-signature-256": "sha256=" + "0".repeat(64) }, body: message });
  assert.equal(response.status, 403, "Unsigned WhatsApp messages must be rejected");
  response = await request(`/api/projects/${project}`, ownerSession);
  assert.ok((await response.json()).context.some((item) => item.content === "Customer wants dark mode"));
  response = await request(`/api/projects/${project}/context`, ownerSession, {
    method: "POST",
    headers: { Origin: "https://evil.example" },
    body: JSON.stringify({ content: "CSRF" }),
  });
  assert.equal(response.status, 403, "Cross-origin mutations must be rejected");
  const oversized = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ content: "x".repeat(65000) })));
      controller.close();
    },
  });
  response = await request(`/api/projects/${project}/context`, ownerSession, {
    method: "POST",
    body: oversized,
    duplex: "half",
  });
  assert.equal(response.status, 413, "Chunked requests must respect the body limit");
  console.log(
    "Smoke check passed: tenant isolation, vault, context, continuous cron, key onboarding, manual quota, WhatsApp signature, CSRF, body limit",
  );
} finally {
  await sql("DELETE FROM projects WHERE id=?", [project]);
  await sql("DELETE FROM sessions WHERE user_id IN (?,?)", [owner, other]);
  await sql("DELETE FROM users WHERE id IN (?,?)", [owner, other]);
}
