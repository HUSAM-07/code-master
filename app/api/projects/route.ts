import { appEnv } from "@/lib/env";
import { github, repoPath, type Repo } from "@/lib/github";
import { authed, body, field } from "@/lib/http";
import { decrypt, encrypt, type Project } from "@/lib/security";

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
      ai_provider?: string;
      ai_key?: string;
    }>(request);
    const name = field(input.name, 100);
    const repo = field(input.repo, 200);
    const brief = field(input.brief, 10000);
    const provider = input.ai_provider === undefined ? null : field(input.ai_provider, 20);
    const aiKey = input.ai_key === undefined ? null : field(input.ai_key, 20000);
    if (Boolean(provider) !== Boolean(aiKey) || (provider && !["openai", "anthropic"].includes(provider)))
      throw new Response("Choose an AI provider and add its API key", { status: 400 });
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
    const runId = aiKey ? crypto.randomUUID() : null;
    const statements = [
      appEnv.DB.prepare(
        "INSERT INTO projects(id,user_id,name,repo,brief,interval_minutes,last_swept_at) VALUES(?,?,?,?,?,?,?)",
      ).bind(
        id,
        user.id,
        name,
        info.full_name,
        brief,
        interval,
        runId ? Math.floor(Date.now() / 1000) : null,
      ),
    ];
    if (provider && aiKey && runId) {
      for (const [secretName, value] of [["AI_PROVIDER", provider], ["AI_API_KEY", aiKey]]) {
        const { iv, ciphertext } = await encrypt(appEnv, value);
        statements.push(
          appEnv.DB.prepare(
            "INSERT INTO secrets(project_id,name,iv,ciphertext) VALUES(?,?,?,?)",
          ).bind(id, secretName, iv, ciphertext),
        );
      }
      statements.push(
        appEnv.DB.prepare("INSERT INTO runs(id,project_id,kind) VALUES(?,?,'scheduled')").bind(runId, id),
      );
    }
    await appEnv.DB.batch(statements);
    if (runId) {
      try {
        await appEnv.JOBS.send({ runId, projectId: id });
      } catch (error) {
        await appEnv.DB.prepare("DELETE FROM projects WHERE id=?").bind(id).run();
        throw error;
      }
    }
    return Response.json({ id, runId }, { status: 201 });
  });
}
