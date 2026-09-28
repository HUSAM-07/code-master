import { appEnv } from "@/lib/env";
import { decrypt } from "@/lib/security";

type Params = { params: Promise<{ id: string }> };
async function channel(id: string) {
  return appEnv.DB.prepare(
    "SELECT c.id,c.project_id,c.channel_ref FROM channels c WHERE c.id=? AND c.kind='whatsapp'",
  )
    .bind(id)
    .first<{ id: string; project_id: string; channel_ref: string }>();
}
async function secret(projectId: string, name: string) {
  const row = await appEnv.DB.prepare(
    "SELECT iv,ciphertext FROM secrets WHERE project_id=? AND name=?",
  )
    .bind(projectId, name)
    .first<{ iv: string; ciphertext: string }>();
  return row ? decrypt(appEnv, row.iv, row.ciphertext) : null;
}
export async function GET(request: Request, { params }: Params) {
  const source = await channel((await params).id);
  if (!source) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const token = await secret(source.project_id, "WHATSAPP_VERIFY_TOKEN");
  if (
    url.searchParams.get("hub.mode") !== "subscribe" ||
    !token ||
    url.searchParams.get("hub.verify_token") !== token
  )
    return new Response("Forbidden", { status: 403 });
  return new Response(url.searchParams.get("hub.challenge") || "");
}
export async function POST(request: Request, { params }: Params) {
  const source = await channel((await params).id);
  if (!source) return new Response("Not found", { status: 404 });
  const appSecret = await secret(source.project_id, "WHATSAPP_APP_SECRET");
  const signature = request.headers
    .get("x-hub-signature-256")
    ?.replace(/^sha256=/, "");
  if (!appSecret || !signature || !/^[a-f0-9]{64}$/i.test(signature))
    return new Response("Forbidden", { status: 403 });
  const raw = await request.text();
  if (raw.length > 64000) return new Response("Too large", { status: 413 });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = Array.from(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++)
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  if (mismatch) return new Response("Forbidden", { status: 403 });
  const payload = JSON.parse(raw) as {
    entry?: {
      changes?: {
        value?: {
          metadata?: { phone_number_id?: string };
          messages?: { id: string; text?: { body?: string }; type?: string }[];
        };
      }[];
    }[];
  };
  for (const entry of payload.entry || [])
    for (const change of entry.changes || []) {
      if (change.value?.metadata?.phone_number_id !== source.channel_ref)
        continue;
      for (const message of change.value.messages || [])
        if (message.type === "text" && message.text?.body) {
          await appEnv.DB.prepare(
            "INSERT OR IGNORE INTO context_items(id,project_id,channel_id,source_id,content) VALUES(?,?,?,?,?)",
          )
            .bind(
              crypto.randomUUID(),
              source.project_id,
              source.id,
              message.id,
              message.text.body.slice(0, 6000),
            )
            .run();
        }
    }
  return Response.json({ ok: true });
}
