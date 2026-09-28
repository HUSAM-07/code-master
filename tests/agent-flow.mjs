import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const base = "http://localhost:5173";
const originalFetch = globalThis.fetch;
const dbList = await (await originalFetch(`${base}/cdn-cgi/local/explorer/api/d1/database`)).json();
const dbId = dbList.result.find((item) => item.name === "DB")?.uuid;
assert.ok(dbId);
const dbUrl = `${base}/cdn-cgi/local/explorer/api/d1/database/${encodeURIComponent(dbId)}/raw`;
async function sql(statement, params = []) {
  const response = await originalFetch(dbUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql: statement, params: params.map(String) }),
  });
  const data = await response.json();
  assert.equal(data.success, true, JSON.stringify(data));
  const result = data.result[0];
  assert.equal(result.success, true, JSON.stringify(data));
  const columns = result.results.columns;
  return result.results.rows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index]])),
  );
}
function prepare(statement, values = []) {
  return {
    bind: (...params) => prepare(statement, params),
    first: async () => (await sql(statement, values))[0] || null,
    all: async () => ({ results: await sql(statement, values) }),
    run: async () => { await sql(statement, values); },
  };
}

const temp = mkdtempSync(join(tmpdir(), "foundry-agent-"));
for (const name of ["security", "ai", "github", "agent"]) {
  const source = readFileSync(`lib/${name}.ts`, "utf8");
  writeFileSync(
    join(temp, `${name}.ts`),
    source.replace(/from "\.\/([a-z]+)"/g, 'from "./$1.ts"'),
  );
}
const { encrypt } = await import(pathToFileURL(join(temp, "security.ts")));
const { runProject } = await import(pathToFileURL(join(temp, "agent.ts")));
const key = readFileSync(".dev.vars", "utf8").match(/^APP_ENCRYPTION_KEY=(.+)$/m)?.[1];
assert.ok(key);
const env = { APP_ENCRYPTION_KEY: key, DB: { prepare } };
const id = crypto.randomUUID();
const userId = `flow-${id}`;
const runId = crypto.randomUUID();
const pat = await encrypt(env, "test-github-pat");
const provider = await encrypt(env, "openai");
const aiKey = await encrypt(env, "test-ai-key");
let aiCalls = 0;
let issueCreates = 0;
let pullCreates = 0;
let sawDraft = false;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  const method = init.method || "GET";
  const reply = (value, status = 200) => Response.json(value, { status });
  if (url.hostname === "api.openai.com") {
    aiCalls++;
    const payload = aiCalls === 1
      ? { title: "Add greeting", description: "Update the greeting", files: ["src/app.ts"] }
      : { summary: "Updated greeting", files: [{ path: "src/app.ts", content: "export const greeting = 'Hello';" }] };
    return reply({ choices: [{ message: { content: JSON.stringify(payload) } }] });
  }
  assert.equal(url.hostname, "api.github.com", `Unexpected host: ${url}`);
  const path = url.pathname;
  if (path === "/repos/octo/app" && method === "GET")
    return reply({ full_name: "octo/app", default_branch: "main", permissions: { push: true } });
  if (path.endsWith("/git/ref/heads/main")) return reply({ object: { sha: "head" } });
  if (path.endsWith("/git/commits/head")) return reply({ tree: { sha: "root" } });
  if (path.endsWith("/git/trees/root"))
    return reply({ tree: [{ path: "src/app.ts", type: "blob", size: 32 }] });
  if (path.endsWith("/contents/src/app.ts"))
    return reply({ encoding: "base64", content: Buffer.from("export const greeting = 'Hi';").toString("base64") });
  if (path.endsWith("/issues") && method === "POST") {
    issueCreates++;
    return reply({ html_url: "https://github.com/octo/app/issues/1" }, 201);
  }
  if (path.endsWith("/git/blobs")) return reply({ sha: "blob" }, 201);
  if (path.endsWith("/git/trees") && method === "POST") return reply({ sha: "new-tree" }, 201);
  if (path.endsWith("/git/commits") && method === "POST") return reply({ sha: "new-commit" }, 201);
  if (path.endsWith("/git/refs") && method === "POST") return reply({ ref: `refs/heads/foundry/${runId.slice(0, 12)}` }, 201);
  if (path.endsWith("/pulls") && method === "GET") return reply([]);
  if (path.endsWith("/pulls") && method === "POST") {
    pullCreates++;
    sawDraft = JSON.parse(init.body).draft === true;
    return reply({ html_url: "https://github.com/octo/app/pull/1" }, 201);
  }
  throw new Error(`Unexpected GitHub request: ${method} ${url}`);
};

try {
  await sql("INSERT INTO users(id,login,pat_iv,pat_ciphertext) VALUES(?,?,?,?)", [userId, userId, pat.iv, pat.ciphertext]);
  await sql("INSERT INTO projects(id,user_id,name,repo,brief) VALUES(?,?,?,?,?)", [id, userId, "Flow test", "octo/app", "A useful product"]);
  await sql("INSERT INTO secrets(project_id,name,iv,ciphertext) VALUES(?,?,?,?)", [id, "AI_PROVIDER", provider.iv, provider.ciphertext]);
  await sql("INSERT INTO secrets(project_id,name,iv,ciphertext) VALUES(?,?,?,?)", [id, "AI_API_KEY", aiKey.iv, aiKey.ciphertext]);
  await sql("INSERT INTO runs(id,project_id) VALUES(?,?)", [runId, id]);
  await runProject(env, runId, id);
  const [run] = await sql("SELECT status,issue_url,pr_url FROM runs WHERE id=?", [runId]);
  assert.deepEqual(run, {
    status: "completed",
    issue_url: "https://github.com/octo/app/issues/1",
    pr_url: "https://github.com/octo/app/pull/1",
  });
  assert.equal(aiCalls, 2);
  assert.equal(issueCreates, 1);
  assert.equal(pullCreates, 1);
  assert.equal(sawDraft, true);
  await runProject(env, runId, id);
  assert.equal(pullCreates, 1, "Completed runs must not create duplicate PRs");
  console.log("Agent flow passed: brief → AI plan → GitHub issue → file commit → draft PR");
} finally {
  globalThis.fetch = originalFetch;
  await sql("DELETE FROM projects WHERE id=?", [id]);
  await sql("DELETE FROM users WHERE id=?", [userId]);
  rmSync(temp, { recursive: true, force: true });
}
