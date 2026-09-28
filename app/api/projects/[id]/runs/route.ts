import { appEnv } from "@/lib/env";
import { owned } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return owned(appEnv, request, id, async (_project, user) => {
    if (user.plan !== "pro") {
      const used = await appEnv.DB.prepare(
        "SELECT COUNT(*) AS n FROM runs r JOIN projects p ON p.id=r.project_id WHERE p.user_id=? AND r.kind='manual' AND r.created_at >= date('now','start of month')",
      )
        .bind(user.id)
        .first<{ n: number }>();
      if ((used?.n || 0) >= 3)
        throw new Response("Free plan includes three runs per month", {
          status: 402,
        });
    }
    const runId = crypto.randomUUID();
    await appEnv.DB.prepare("INSERT INTO runs(id,project_id) VALUES(?,?)")
      .bind(runId, id)
      .run();
    await appEnv.JOBS.send({ runId, projectId: id });
    return Response.json({ id: runId }, { status: 202 });
  });
}
