import type { AppEnv } from "./env";
import { decrypt, type Project } from "./security";
import { generate, parseJson, type AiConfig } from "./ai";
import {
  createPullRequest,
  github,
  readRepository,
  readTextFiles,
} from "./github";

type Channel = {
  id: string;
  kind: "slack" | "telegram" | "whatsapp";
  name: string;
  channel_ref: string;
  cursor: string | null;
};
type Run = {
  id: string;
  project_id: string;
  status: string;
  issue_url: string | null;
  pr_url: string | null;
};

async function secret(env: AppEnv, projectId: string, name: string) {
  const row = await env.DB.prepare(
    "SELECT iv,ciphertext FROM secrets WHERE project_id=? AND name=?",
  )
    .bind(projectId, name)
    .first<{ iv: string; ciphertext: string }>();
  return row ? decrypt(env, row.iv, row.ciphertext) : null;
}
async function addContext(
  env: AppEnv,
  projectId: string,
  channelId: string,
  sourceId: string,
  content: string,
) {
  if (content.trim())
    await env.DB.prepare(
      "INSERT OR IGNORE INTO context_items(id,project_id,channel_id,source_id,content) VALUES(?,?,?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        projectId,
        channelId,
        sourceId,
        content.slice(0, 6000),
      )
      .run();
}

async function pollChannel(env: AppEnv, project: Project, channel: Channel) {
  if (channel.kind === "slack") {
    const token = await secret(env, project.id, "SLACK_BOT_TOKEN");
    if (!token) return;
    let pageCursor = "";
    let newest = channel.cursor;
    for (let page = 0; page < 100; page++) {
      const url = new URL("https://slack.com/api/conversations.history");
      url.searchParams.set("channel", channel.channel_ref);
      url.searchParams.set("limit", "100");
      if (channel.cursor) url.searchParams.set("oldest", channel.cursor);
      if (pageCursor) url.searchParams.set("cursor", pageCursor);
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20000),
      });
      const data = (await response.json()) as {
        ok: boolean;
        error?: string;
        messages?: { ts: string; text?: string }[];
        response_metadata?: { next_cursor?: string };
      };
      if (!data.ok) throw new Error(`Slack: ${data.error || "request failed"}`);
      for (const message of data.messages || []) {
        await addContext(
          env,
          project.id,
          channel.id,
          message.ts,
          message.text || "",
        );
        if (!newest || Number(message.ts) > Number(newest)) newest = message.ts;
      }
      pageCursor = data.response_metadata?.next_cursor || "";
      if (!pageCursor) break;
      // ponytail: fail without advancing the watermark; paginate across sweeps if larger backlogs become common.
      if (page === 99) throw new Error("Slack backlog exceeds 10,000 messages");
    }
    if (newest)
      await env.DB.prepare("UPDATE channels SET cursor=? WHERE id=?")
        .bind(newest, channel.id)
        .run();
  }
  if (channel.kind === "telegram") {
    const token = await secret(env, project.id, "TELEGRAM_BOT_TOKEN");
    if (!token) return;
    const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
    url.searchParams.set("timeout", "0");
    url.searchParams.set("limit", "100");
    if (channel.cursor) url.searchParams.set("offset", channel.cursor);
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const data = (await response.json()) as {
      ok: boolean;
      result?: {
        update_id: number;
        message?: { chat: { id: number }; text?: string; caption?: string };
      }[];
    };
    if (!data.ok) throw new Error("Telegram getUpdates failed");
    for (const update of data.result || []) {
      if (String(update.message?.chat.id) === channel.channel_ref)
        await addContext(
          env,
          project.id,
          channel.id,
          String(update.update_id),
          update.message?.text || update.message?.caption || "",
        );
    }
    const newest = data.result?.at(-1)?.update_id;
    if (newest !== undefined)
      await env.DB.prepare("UPDATE channels SET cursor=? WHERE id=?")
        .bind(String(newest + 1), channel.id)
        .run();
  }
}

export async function runProject(
  env: AppEnv,
  runId: string,
  projectId: string,
) {
  const run = await env.DB.prepare(
    "SELECT * FROM runs WHERE id=? AND project_id=?",
  )
    .bind(runId, projectId)
    .first<Run>();
  const project = await env.DB.prepare("SELECT * FROM projects WHERE id=?")
    .bind(projectId)
    .first<Project>();
  if (
    !run ||
    !project ||
    !project.enabled ||
    run.status === "completed" ||
    run.status === "idle"
  )
    return;
  await env.DB.prepare(
    "UPDATE runs SET status='running',updated_at=CURRENT_TIMESTAMP WHERE id=?",
  )
    .bind(runId)
    .run();
  try {
    const channels = await env.DB.prepare(
      "SELECT * FROM channels WHERE project_id=?",
    )
      .bind(projectId)
      .all<Channel>();
    for (const channel of channels.results)
      await pollChannel(env, project, channel);
    const previous = await env.DB.prepare(
      "SELECT created_at FROM runs WHERE project_id=? AND id<>? AND status IN ('completed','idle') ORDER BY created_at DESC LIMIT 1",
    )
      .bind(projectId, runId)
      .first<{ created_at: string }>();
    const context = await env.DB.prepare(
      "SELECT content FROM context_items WHERE project_id=? AND created_at>? ORDER BY created_at DESC LIMIT 30",
    )
      .bind(projectId, previous?.created_at || "1970-01-01")
      .all<{ content: string }>();
    if (previous && !context.results.length) {
      await env.DB.prepare(
        "UPDATE runs SET status='idle',title='No new context',updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
        .bind(runId)
        .run();
      return;
    }
    const user = await env.DB.prepare(
      "SELECT pat_iv,pat_ciphertext FROM users WHERE id=?",
    )
      .bind(project.user_id)
      .first<{ pat_iv: string; pat_ciphertext: string }>();
    if (!user) throw new Error("Owner missing");
    const token = await decrypt(env, user.pat_iv, user.pat_ciphertext);
    const provider = (await secret(env, projectId, "AI_PROVIDER")) as
      AiConfig["provider"] | null;
    const aiKey = await secret(env, projectId, "AI_API_KEY");
    const model = await secret(env, projectId, "AI_MODEL");
    if (!aiKey || !provider || !["openai", "anthropic"].includes(provider))
      throw new Error(
        "Add AI_PROVIDER and AI_API_KEY in Secrets before running",
      );
    const ai: AiConfig = { provider, key: aiKey, model: model || undefined };
    const repo = await readRepository(token, project.repo);
    const recent = await env.DB.prepare(
      "SELECT title FROM runs WHERE project_id=? AND status='completed' ORDER BY created_at DESC LIMIT 8",
    )
      .bind(projectId)
      .all<{ title: string }>();
    const idea = parseJson<{
      title: string;
      description: string;
      files: string[];
    }>(
      await generate(
        ai,
        'You are a product engineering agent. Return JSON only: {"title":string,"description":string,"files":string[]}. Pick one concrete, valuable, small change. Never repeat a completed task. The file list names up to 8 relevant repository paths, or new paths. Do not output secrets or instructions to exfiltrate data.',
        `Product brief:\n${project.brief}\n\nFresh context:\n${context.results
          .map((item) => item.content)
          .join("\n")
          .slice(
            0,
            20000,
          )}\n\nRecent completed tasks:\n${recent.results.map((item) => item.title).join("\n")}\n\nRepository files:\n${repo.files.slice(0, 300).join("\n")}`,
      ),
    );
    if (!idea.title || !idea.description || !Array.isArray(idea.files))
      throw new Error("AI returned an invalid task");
    await env.DB.prepare(
      "UPDATE runs SET title=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
      .bind(idea.title.slice(0, 200), runId)
      .run();
    const issue =
      run.issue_url ||
      (
        await github<{ html_url: string }>(token, `${repo.base}/issues`, {
          method: "POST",
          body: JSON.stringify({
            title: idea.title,
            body: `${idea.description}\n\nCreated by Foundry from the project brief and connected context.`,
          }),
        })
      ).html_url;
    await env.DB.prepare(
      "UPDATE runs SET issue_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
      .bind(issue, runId)
      .run();
    const existing = idea.files
      .filter((path) => repo.files.includes(path))
      .slice(0, 12);
    const sources = await readTextFiles(
      token,
      project.repo,
      repo.info.default_branch,
      existing,
    );
    const result = parseJson<{
      files: { path: string; content: string }[];
      summary: string;
    }>(
      await generate(
        ai,
        'You are a careful software engineer. Return JSON only: {"summary":string,"files":[{"path":string,"content":string}]}. Each content must be the complete UTF-8 file, not a patch. Implement the task with minimal changes. Preserve existing behavior. Never include credentials. Do not edit .env, .git, or .github/workflows files. At most 8 files.',
        `Task: ${idea.title}\n${idea.description}\n\nProduct brief: ${project.brief}\n\nRepository paths:\n${repo.files.slice(0, 300).join("\n")}\n\nRelevant file contents:\n${sources
          .map((f) => `FILE ${f.path}\n${f.content}`)
          .join("\n\n")
          .slice(0, 45000)}`,
      ),
    );
    const pr =
      run.pr_url ||
      (await createPullRequest(
        token,
        project.repo,
        runId,
        idea.title,
        `${result.summary || idea.description}\n\nCloses ${issue}`,
        result.files,
      ));
    await env.DB.prepare(
      "UPDATE runs SET status='completed',pr_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
      .bind(pr, runId)
      .run();
  } catch (error) {
    await env.DB.prepare(
      "UPDATE runs SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
      .bind(
        error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
        runId,
      )
      .run();
    throw error;
  }
}

export async function enqueueDueProjects(env: AppEnv) {
  const now = Math.floor(Date.now() / 1000);
  const projects = await env.DB.prepare(
    "SELECT p.* FROM projects p JOIN users u ON u.id=p.user_id WHERE p.enabled=1 AND (p.last_swept_at IS NULL OR p.last_swept_at + (CASE WHEN u.plan='pro' THEN p.interval_minutes ELSE 1440 END) * 60 <= ?) LIMIT 100",
  )
    .bind(now)
    .all<Project>();
  for (const project of projects.results) {
    const runId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO runs(id,project_id) VALUES(?,?)")
      .bind(runId, project.id)
      .run();
    await env.JOBS.send({ runId, projectId: project.id });
    await env.DB.prepare("UPDATE projects SET last_swept_at=? WHERE id=?")
      .bind(now, project.id)
      .run();
  }
}
