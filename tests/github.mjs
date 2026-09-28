import assert from "node:assert/strict";
import { createPullRequest, validateFiles } from "../lib/github.ts";

const originalFetch = globalThis.fetch;
let pullCreates = 0;
let branchCreates = 0;
let sameTree = false;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  const path = url.pathname;
  const method = init.method || "GET";
  const reply = (value, status = 200) => Response.json(value, { status });
  if (path === "/repos/octo/app" && method === "GET")
    return reply({ full_name: "octo/app", default_branch: "main", permissions: { push: true } });
  if (path.endsWith("/git/ref/heads/main")) return reply({ object: { sha: "head" } });
  if (path.endsWith("/git/commits/head")) return reply({ tree: { sha: "root" } });
  if (path.endsWith("/git/trees/root")) return reply({ tree: [] });
  if (path.endsWith("/git/blobs")) return reply({ sha: "blob" });
  if (path.endsWith("/git/trees") && method === "POST")
    return reply({ sha: sameTree ? "root" : "new-tree" });
  if (path.endsWith("/git/commits") && method === "POST")
    return reply({ sha: "new-commit" });
  if (path.endsWith("/git/refs") && method === "POST") {
    branchCreates++;
    return reply(branchCreates === 1 ? { ref: "foundry/run123" } : { message: "exists" }, branchCreates === 1 ? 201 : 422);
  }
  if (path.endsWith("/pulls") && method === "GET")
    return reply(pullCreates ? [{ html_url: "https://github.com/octo/app/pull/1" }] : []);
  if (path.endsWith("/pulls") && method === "POST") {
    pullCreates++;
    return reply({ html_url: "https://github.com/octo/app/pull/1" }, 201);
  }
  throw new Error(`Unexpected GitHub request: ${method} ${url}`);
};

try {
  const args = ["test-token", "octo/app", "run123", "Small fix", "Closes #1", [{ path: "src/new.ts", content: "export const n = 1;" }]];
  assert.equal(await createPullRequest(...args), "https://github.com/octo/app/pull/1");
  assert.equal(await createPullRequest(...args), "https://github.com/octo/app/pull/1");
  assert.equal(pullCreates, 1, "A retried run must reuse its existing PR");
  sameTree = true;
  await assert.rejects(createPullRequest(...args), /no file changes/);
  assert.throws(() => validateFiles([{ path: "../secret", content: "x" }]));
  assert.throws(() => validateFiles([{ path: "src/app.ts", content: "a" }, { path: "src/app.ts", content: "b" }]));
  console.log("GitHub check passed: draft PR creation, retry reuse, no-op rejection");
} finally {
  globalThis.fetch = originalFetch;
}
