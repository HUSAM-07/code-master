import { appEnv } from "@/lib/env";
import { github } from "@/lib/github";
import { body, field } from "@/lib/http";
import {
  checkOrigin,
  createSession,
  encrypt,
  getUser,
  jsonError,
  revokeSession,
} from "@/lib/security";

export async function GET(request: Request) {
  try {
    const user = await getUser(appEnv, request);
    return Response.json({
      billing_ready: Boolean(
        appEnv.DODO_API_KEY &&
          appEnv.DODO_PRODUCT_ID &&
          appEnv.DODO_WEBHOOK_KEY &&
          ["test", "live"].includes(appEnv.DODO_MODE || ""),
      ),
      user: user
        ? {
            id: user.id,
            login: user.login,
            name: user.name,
            avatar_url: user.avatar_url,
            plan: user.plan,
          }
        : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { token } = await body<{ token: string }>(request);
    const pat = field(token, 500);
    let profile: {
      id: number;
      login: string;
      name: string | null;
      avatar_url: string | null;
    };
    try {
      profile = await github(pat, "/user");
    } catch {
      throw new Response("GitHub rejected that token", { status: 401 });
    }
    const encrypted = await encrypt(appEnv, pat);
    const id = String(profile.id);
    await appEnv.DB.prepare(
      "INSERT INTO users(id,login,name,avatar_url,pat_iv,pat_ciphertext) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login,name=excluded.name,avatar_url=excluded.avatar_url,pat_iv=excluded.pat_iv,pat_ciphertext=excluded.pat_ciphertext",
    )
      .bind(
        id,
        profile.login,
        profile.name,
        profile.avatar_url,
        encrypted.iv,
        encrypted.ciphertext,
      )
      .run();
    const cookie = await createSession(appEnv, id, request);
    return Response.json(
      {
        user: {
          id,
          login: profile.login,
          name: profile.name,
          avatar_url: profile.avatar_url,
        },
      },
      { headers: { "Set-Cookie": cookie } },
    );
  } catch (error) {
    return jsonError(error);
  }
}
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    await revokeSession(appEnv, request);
    return Response.json(
      { ok: true },
      {
        headers: {
          "Set-Cookie":
            "foundry_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        },
      },
    );
  } catch (error) {
    return jsonError(error);
  }
}
