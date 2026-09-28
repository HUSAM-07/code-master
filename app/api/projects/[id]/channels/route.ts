import { appEnv } from "@/lib/env";
import { body, field, owned } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return owned(appEnv, request, id, async () => {
    const input = await body<{
      kind: string;
      name: string;
      channel_ref: string;
    }>(request);
    if (!["slack", "telegram", "whatsapp"].includes(input.kind))
      throw new Response("Invalid channel type", { status: 400 });
    const channelId = crypto.randomUUID();
    await appEnv.DB.prepare(
      "INSERT INTO channels(id,project_id,kind,name,channel_ref) VALUES(?,?,?,?,?)",
    )
      .bind(
        channelId,
        id,
        input.kind,
        field(input.name, 100),
        field(input.channel_ref, 200),
      )
      .run();
    return Response.json({ id: channelId }, { status: 201 });
  });
}
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return owned(appEnv, request, id, async () => {
    const input = await body<{ channelId: string }>(request);
    await appEnv.DB.prepare("DELETE FROM channels WHERE project_id=? AND id=?")
      .bind(id, field(input.channelId, 100))
      .run();
    return Response.json({ ok: true });
  });
}
