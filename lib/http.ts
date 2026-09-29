import type { AppEnv } from "./env";
import {
  checkOrigin,
  jsonError,
  projectForUser,
  requireUser,
} from "./security";

export async function rawBody(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length") || 0) > 64000)
    throw new Response("Request too large", { status: 413 });
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64000) {
        await reader.cancel();
        throw new Response("Request too large", { status: 413 });
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  }
  return text;
}
export async function body<T>(request: Request): Promise<T> {
  const text = await rawBody(request);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Response("Invalid JSON", { status: 400 });
  }
}
export async function authed<T>(
  env: AppEnv,
  request: Request,
  action: (user: Awaited<ReturnType<typeof requireUser>>) => Promise<T>,
) {
  try {
    if (request.method !== "GET") checkOrigin(request);
    return await action(await requireUser(env, request));
  } catch (error) {
    return jsonError(error);
  }
}
export async function owned<T>(
  env: AppEnv,
  request: Request,
  id: string,
  action: (
    project: Awaited<ReturnType<typeof projectForUser>>,
    user: Awaited<ReturnType<typeof requireUser>>,
  ) => Promise<T>,
) {
  return authed(env, request, async (user) =>
    action(await projectForUser(env, id, user.id), user),
  );
}
export function field(value: unknown, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Response("Invalid field", { status: 400 });
  return value.trim();
}
