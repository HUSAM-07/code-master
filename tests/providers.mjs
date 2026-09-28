import assert from "node:assert/strict";
import { generate, parseJson } from "../lib/ai.ts";

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url, request: JSON.parse(init.body) });
  return Response.json(
    String(url).includes("anthropic")
      ? { content: [{ type: "text", text: '{"ok":true}' }] }
      : { choices: [{ message: { content: '{"ok":true}' } }] },
  );
};
try {
  assert.deepEqual(parseJson(await generate({ provider: "openai", key: "test" }, "system", "user")), { ok: true });
  assert.deepEqual(parseJson(await generate({ provider: "anthropic", key: "test" }, "system", "user")), { ok: true });
  assert.equal(calls[0].request.model, "gpt-4.1");
  assert.equal(calls[1].request.model, "claude-sonnet-5");
  console.log("Provider check passed: OpenAI and Anthropic request/response shapes");
} finally {
  globalThis.fetch = originalFetch;
}
