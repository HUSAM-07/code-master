import type { AppEnv } from "./env";

const encoder = new TextEncoder();
const COOKIE = "foundry_session";
const WEEK = 7 * 24 * 60 * 60;

function b64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}
function unb64(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
async function key(env: AppEnv) {
  const raw = unb64(env.APP_ENCRYPTION_KEY);
  if (raw.byteLength !== 32)
    throw new Error("APP_ENCRYPTION_KEY must be a base64 encoded 32-byte key");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function encrypt(env: AppEnv, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(env),
    encoder.encode(value),
  );
  return { iv: b64(iv), ciphertext: b64(new Uint8Array(ciphertext)) };
}
export async function decrypt(env: AppEnv, iv: string, ciphertext: string) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv) },
    await key(env),
    unb64(ciphertext),
  );
  return new TextDecoder().decode(plain);
}
async function hash(value: string) {
  return b64(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  );
}
export async function createSession(
  env: AppEnv,
  userId: string,
  request: Request,
) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
  )
    .bind(await hash(token), userId, Math.floor(Date.now() / 1000) + WEEK)
    .run();
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${WEEK}${secure}`;
}
export async function getUser(env: AppEnv, request: Request) {
  const cookie = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)foundry_session=([^;]+)/)?.[1];
  if (!cookie) return null;
  let token: string;
  try {
    token = decodeURIComponent(cookie);
  } catch {
    return null;
  }
  return env.DB.prepare(
    "SELECT u.id,u.login,u.name,u.avatar_url,u.plan,u.pat_iv,u.pat_ciphertext FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
  )
    .bind(await hash(token), Math.floor(Date.now() / 1000))
    .first<{
      id: string;
      login: string;
      name: string | null;
      avatar_url: string | null;
      plan: string;
      pat_iv: string;
      pat_ciphertext: string;
    }>();
}
export async function requireUser(env: AppEnv, request: Request) {
  const user = await getUser(env, request);
  if (!user) throw new Response("Sign in required", { status: 401 });
  return user;
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new Response("Invalid origin", { status: 403 });
}
export async function revokeSession(env: AppEnv, request: Request) {
  const cookie = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)foundry_session=([^;]+)/)?.[1];
  if (cookie)
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?")
      .bind(await hash(decodeURIComponent(cookie)))
      .run();
}
export async function projectForUser(env: AppEnv, id: string, userId: string) {
  const project = await env.DB.prepare(
    "SELECT * FROM projects WHERE id=? AND user_id=?",
  )
    .bind(id, userId)
    .first<Project>();
  if (!project) throw new Response("Project not found", { status: 404 });
  return project;
}
export type Project = {
  id: string;
  user_id: string;
  name: string;
  repo: string;
  brief: string;
  interval_minutes: number;
  enabled: number;
  last_swept_at: number | null;
  created_at: string;
};
export function jsonError(error: unknown) {
  if (error instanceof Response) return error;
  console.error(error);
  return Response.json({ error: "Request failed" }, { status: 500 });
}
