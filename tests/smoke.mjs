import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes, createHash, webcrypto } from "node:crypto";

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

  let response = await request(`/api/projects/${project}`, ownerSession);
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
  let status = "queued";
  for (let attempt = 0; attempt < 20 && status === "queued"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const run = await request(`/api/projects/${project}`, ownerSession);
    status = (await run.json()).runs.find((item) => item.id === runId)?.status;
  }
  assert.equal(status, "failed", "The queue consumer must process the run");
  response = await request(`/api/projects/${project}/context`, ownerSession, {
    method: "POST",
    headers: { Origin: "https://evil.example" },
    body: JSON.stringify({ content: "CSRF" }),
  });
  assert.equal(response.status, 403, "Cross-origin mutations must be rejected");
  console.log(
    "Smoke check passed: tenant isolation, vault, context, queue, CSRF",
  );
} finally {
  await sql("DELETE FROM projects WHERE id=?", [project]);
  await sql("DELETE FROM sessions WHERE user_id IN (?,?)", [owner, other]);
  await sql("DELETE FROM users WHERE id IN (?,?)", [owner, other]);
}
