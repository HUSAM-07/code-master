import { appEnv } from "@/lib/env";
import { body, field, owned } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return owned(appEnv, request, id, async () => {
    const { content } = await body<{ content: string }>(request);
    await appEnv.DB.prepare(
      "INSERT INTO context_items(id,project_id,content) VALUES(?,?,?)",
    )
      .bind(crypto.randomUUID(), id, field(content, 6000))
      .run();
    return Response.json({ ok: true }, { status: 201 });
  });
}
