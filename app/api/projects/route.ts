import { appEnv } from "@/lib/env";
import { github, repoPath, type Repo } from "@/lib/github";
import { authed, body, field } from "@/lib/http";
import { decrypt, type Project } from "@/lib/security";

export async function GET(request: Request) {
  return authed(appEnv, request, async (user) => {
    const projects = await appEnv.DB.prepare(
      "SELECT p.*, (SELECT COUNT(*) FROM runs r WHERE r.project_id=p.id) AS run_count FROM projects p WHERE user_id=? ORDER BY created_at DESC",
    )
      .bind(user.id)
      .all<Project & { run_count: number }>();
    return Response.json({ projects: projects.results });
  });
}
export async function POST(request: Request) {
  return authed(appEnv, request, async (user) => {
    const input = await body<{
      name: string;
      repo: string;
      brief: string;
      interval_minutes?: number;
    }>(request);
    const name = field(input.name, 100);
    const repo = field(input.repo, 200);
    const brief = field(input.brief, 10000);
    const interval = Number(input.interval_minutes || 60);
    if (![15, 30, 60, 360, 1440].includes(interval))
      throw new Response("Invalid schedule", { status: 400 });
    if (user.plan !== "pro") {
      const count = await appEnv.DB.prepare(
        "SELECT COUNT(*) AS n FROM projects WHERE user_id=?",
      )
        .bind(user.id)
        .first<{ n: number }>();
      if ((count?.n || 0) >= 1)
        throw new Response("Free plan supports one project", { status: 402 });
    }
    const token = await decrypt(appEnv, user.pat_iv, user.pat_ciphertext);
    const info = await github<Repo>(token, repoPath(repo));
    if (!info.permissions?.push)
      throw new Response("GitHub token needs write access to this repository", {
        status: 403,
      });
    const id = crypto.randomUUID();
    await appEnv.DB.prepare(
      "INSERT INTO projects(id,user_id,name,repo,brief,interval_minutes) VALUES(?,?,?,?,?,?)",
    )
      .bind(id, user.id, name, info.full_name, brief, interval)
      .run();
    return Response.json({ id }, { status: 201 });
  });
}
