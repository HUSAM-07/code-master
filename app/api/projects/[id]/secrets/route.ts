import { appEnv } from "@/lib/env";
import { body, field, owned } from "@/lib/http";
import { encrypt } from "@/lib/security";

type Params = { params: Promise<{ id: string }> };
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  return owned(appEnv, request, id, async () => {
    const input = await body<{ name: string; value: string }>(request);
    const name = field(input.name, 80).toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(name))
      throw new Response("Invalid secret name", { status: 400 });
    const value = field(input.value, 20000);
    if (name === "AI_PROVIDER" && !["openai", "anthropic"].includes(value))
      throw new Response("AI_PROVIDER must be openai or anthropic", {
        status: 400,
      });
    const { iv, ciphertext } = await encrypt(appEnv, value);
    await appEnv.DB.prepare(
      "INSERT INTO secrets(project_id,name,iv,ciphertext) VALUES(?,?,?,?) ON CONFLICT(project_id,name) DO UPDATE SET iv=excluded.iv,ciphertext=excluded.ciphertext,updated_at=CURRENT_TIMESTAMP",
    )
      .bind(id, name, iv, ciphertext)
      .run();
    return Response.json({ ok: true });
  });
}
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return owned(appEnv, request, id, async () => {
    const { name } = await body<{ name: string }>(request);
    await appEnv.DB.prepare("DELETE FROM secrets WHERE project_id=? AND name=?")
      .bind(id, field(name, 80).toUpperCase())
      .run();
    return Response.json({ ok: true });
  });
}
