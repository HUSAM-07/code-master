import { appEnv } from "@/lib/env";
import { body, field, owned } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return owned(appEnv, request, id, async (project) => {
    const [runs, channels, secrets, context] = await Promise.all([
      appEnv.DB.prepare(
        "SELECT * FROM runs WHERE project_id=? ORDER BY created_at DESC LIMIT 30",
      )
        .bind(id)
        .all(),
      appEnv.DB.prepare(
        "SELECT id,kind,name,channel_ref,created_at FROM channels WHERE project_id=? ORDER BY created_at DESC",
      )
        .bind(id)
        .all(),
      appEnv.DB.prepare(
        "SELECT name,updated_at FROM secrets WHERE project_id=? ORDER BY name",
      )
        .bind(id)
        .all(),
      appEnv.DB.prepare(
        "SELECT id,content,created_at FROM context_items WHERE project_id=? ORDER BY created_at DESC LIMIT 30",
      )
        .bind(id)
        .all(),
    ]);
    return Response.json({
      project,
      runs: runs.results,
      channels: channels.results,
      secrets: secrets.results,
      context: context.results,
    });
  });
}
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return owned(appEnv, request, id, async (project) => {
    const input = await body<{
      name?: string;
      brief?: string;
      enabled?: boolean;
      interval_minutes?: number;
    }>(request);
    const interval = input.interval_minutes ?? project.interval_minutes;
    if (![15, 30, 60, 360, 1440].includes(interval))
      throw new Response("Invalid schedule", { status: 400 });
    await appEnv.DB.prepare(
      "UPDATE projects SET name=?,brief=?,enabled=?,interval_minutes=? WHERE id=?",
    )
      .bind(
        input.name === undefined ? project.name : field(input.name, 100),
        input.brief === undefined ? project.brief : field(input.brief, 10000),
        input.enabled === undefined ? project.enabled : Number(input.enabled),
        interval,
        id,
      )
      .run();
    return Response.json({ ok: true });
  });
}
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return owned(appEnv, request, id, async () => {
    await appEnv.DB.prepare("DELETE FROM projects WHERE id=?").bind(id).run();
    return Response.json({ ok: true });
  });
}
