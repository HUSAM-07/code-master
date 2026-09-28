"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  RiAddLine,
  RiArrowRightLine,
  RiExternalLinkLine,
  RiGithubLine,
  RiGitPullRequestLine,
  RiPlayLine,
  RiRefreshLine,
  RiShieldKeyholeLine,
  RiSparkling2Line,
} from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badge";
import { Input } from "@/components/base/input/input";
import { Textarea } from "@/components/base/textarea/textarea";
import { Tab, TabList, TabPanel, Tabs } from "@/components/base/tabs/tabs";
import { cx } from "@/utils/cx";

type User = { id: string; login: string; name: string | null; plan: string };
type Project = {
  id: string;
  name: string;
  repo: string;
  brief: string;
  interval_minutes: number;
  enabled: number;
  last_swept_at: number | null;
};
type Run = {
  id: string;
  status: string;
  title: string | null;
  issue_url: string | null;
  pr_url: string | null;
  error: string | null;
  created_at: string;
};
type Channel = { id: string; kind: string; name: string; channel_ref: string };
type Detail = {
  project: Project;
  runs: Run[];
  channels: Channel[];
  secrets: { name: string }[];
  context: { id: string; content: string; created_at: string }[];
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok)
    throw new Error(
      (await response.text()) || `Request failed (${response.status})`,
    );
  return response.json();
}
const send = <T,>(path: string, value: unknown, method = "POST") =>
  api<T>(path, { method, body: JSON.stringify(value) });
const when = (value: string) =>
  new Date(
    value.replace(" ", "T") + (value.endsWith("Z") ? "" : "Z"),
  ).toLocaleString();
function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        "rounded-3xl border border-border-button-default bg-background-primary-default shadow-sm",
        className,
      )}
    >
      {children}
    </section>
  );
}
function Label({ children }: { children: ReactNode }) {
  return (
    <p className="text-caption-1-semibold uppercase tracking-widest text-text-tertiary">
      {children}
    </p>
  );
}
function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-10 items-center justify-center rounded-xl bg-accent-600 text-text-white">
        <RiSparkling2Line className="size-5" aria-hidden />
      </span>
      <span className="text-headline-medium text-text-primary">foundry</span>
    </div>
  );
}
function Empty({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border-button-default bg-background-secondary-default p-8 text-center">
      <RiSparkling2Line
        className="mx-auto size-6 text-foreground-icon-tertiary"
        aria-hidden
      />
      <p className="mt-3 text-headline-medium text-text-primary">{title}</p>
      <p className="mt-2 text-body-regular text-text-secondary">
        {description}
      </p>
    </div>
  );
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [pat, setPat] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [creating, setCreating] = useState(false);
  const [newProject, setNewProject] = useState({
    name: "",
    repo: "",
    brief: "",
  });
  const [note, setNote] = useState("");
  const [secret, setSecret] = useState({ name: "AI_API_KEY", value: "" });
  const [channel, setChannel] = useState({
    kind: "slack",
    name: "",
    channel_ref: "",
  });
  const [settings, setSettings] = useState({
    name: "",
    brief: "",
    interval_minutes: 60,
    enabled: true,
  });
  const refreshProjects = useCallback(async () => {
    const result = await api<{ projects: Project[] }>("/api/projects");
    setProjects(result.projects);
    setSelected((id) =>
      id && result.projects.some((p) => p.id === id)
        ? id
        : result.projects[0]?.id || null,
    );
  }, []);
  const refreshDetail = useCallback(async (id: string) => {
    const result = await api<Detail>(`/api/projects/${id}`);
    setDetail(result);
    setSettings({
      name: result.project.name,
      brief: result.project.brief,
      interval_minutes: result.project.interval_minutes,
      enabled: Boolean(result.project.enabled),
    });
  }, []);
  useEffect(() => {
    api<{ user: User | null }>("/api/session")
      .then(async ({ user }) => {
        setUser(user);
        if (user) await refreshProjects();
      })
      .catch((e) => setNotice(e.message))
      .finally(() => setLoading(false));
  }, [refreshProjects]);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    refreshDetail(selected).catch((e) => setNotice(e.message));
    const timer = setInterval(
      () => refreshDetail(selected).catch(() => {}),
      15000,
    );
    return () => clearInterval(timer);
  }, [selected, refreshDetail]);
  async function act(action: () => Promise<void>, success: string) {
    setBusy(true);
    setNotice("");
    try {
      await action();
      setNotice(success);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Something went wrong",
      );
    } finally {
      setBusy(false);
    }
  }
  const base = `/api/projects/${selected}`;
  async function upgrade() {
    await act(async () => {
      const { url } = await send<{ url: string }>("/api/billing/checkout", {});
      location.href = url;
    }, "Opening checkout…");
  }

  if (loading)
    return (
      <main className="grid min-h-screen place-items-center bg-background-full text-body-medium text-text-secondary">
        <Brand />
      </main>
    );
  if (!user)
    return (
      <main className="min-h-screen bg-background-full">
        <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-6 sm:px-8">
          <Brand />
          <span className="hidden text-caption-1-semibold text-text-tertiary sm:block">
            PRODUCT ENGINEERING, CONTINUOUSLY
          </span>
        </header>
        <div className="mx-auto grid max-w-7xl gap-12 px-5 pb-16 pt-10 sm:px-8 lg:grid-cols-2 lg:items-center lg:pt-20">
          <div className="flex flex-col gap-7">
            <span className="w-fit rounded-full border border-border-button-default bg-background-primary-default px-4 py-2 text-caption-1-semibold text-accent-600">
              YOUR PRODUCT BUILDER
            </span>
            <h1 className="text-title-1-medium text-text-primary">
              Turn conversations into shipped software.
            </h1>
            <p className="max-w-xl text-body-regular text-text-secondary">
              Give Foundry a product brief, a GitHub repository, and an AI key.
              It collects context, opens focused issues, and proposes code as
              draft pull requests.
            </p>
            <div className="hidden gap-3 sm:grid sm:grid-cols-3">
              {[
                ["01", "Connect", "Link GitHub and AI."],
                ["02", "Listen", "Capture team signals."],
                ["03", "Ship", "Review draft PRs."],
              ].map(([n, title, copy]) => (
                <Card key={n} className="p-5">
                  <span className="text-caption-1-semibold text-accent-600">
                    {n}
                  </span>
                  <h2 className="mt-4 text-headline-medium text-text-primary">
                    {title}
                  </h2>
                  <p className="mt-2 text-body-regular text-text-secondary">
                    {copy}
                  </p>
                </Card>
              ))}
            </div>
          </div>
          <Card className="p-6 sm:p-9">
            <div className="mb-8 flex items-start justify-between">
              <div>
                <Label>YOUR WORKSPACE</Label>
                <h2 className="mt-2 text-title-3-semibold text-text-primary">
                  Get started
                </h2>
                <p className="mt-2 text-body-regular text-text-secondary">
                  Sign in with a GitHub personal access token.
                </p>
              </div>
              <RiGithubLine
                className="size-7 text-foreground-icon-secondary"
                aria-hidden
              />
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                act(async () => {
                  const result = await send<{ user: User }>("/api/session", {
                    token: pat,
                  });
                  setUser(result.user);
                  setPat("");
                  await refreshProjects();
                }, "Welcome to Foundry.");
              }}
              className="flex flex-col gap-5"
            >
              <Input
                label="GitHub personal access token"
                type="password"
                autoComplete="off"
                value={pat}
                onChange={setPat}
                placeholder="github_pat_…"
                hint="Grant Contents, Issues, and Pull requests write access to the repositories you want to build."
                isRequired
              />
              <Button
                type="submit"
                trailingIcon={RiArrowRightLine}
                disabled={busy || !pat}
              >
                Continue to workspace
              </Button>
            </form>
            <div className="mt-6 flex gap-3 rounded-xl bg-background-secondary-default p-4">
              <RiShieldKeyholeLine
                className="size-5 shrink-0 text-foreground-icon-secondary"
                aria-hidden
              />
              <p className="text-caption-1-regular text-text-secondary">
                Your token is encrypted before storage. Foundry only opens draft
                PRs; you decide what merges.
              </p>
            </div>
            {notice && (
              <p
                role="status"
                className="mt-4 text-body-regular text-text-error-primary"
              >
                {notice}
              </p>
            )}
          </Card>
        </div>
        <footer className="mx-auto max-w-7xl border-t border-separator-border px-5 py-6 text-caption-1-regular text-text-tertiary sm:px-8">
          Built on Cloudflare Workers · D1 · Queues
        </footer>
      </main>
    );

  return (
    <main className="min-h-screen bg-background-full">
      <header className="sticky top-0 z-20 border-b border-separator-border bg-background-primary-default/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <Brand />
          <div className="flex items-center gap-3">
            <Badge color={user.plan === "pro" ? "primary" : "neutral"}>
              {user.plan === "pro" ? "Pro" : "Free"}
            </Badge>
            <span className="hidden text-body-medium text-text-secondary sm:block">
              @{user.login}
            </span>
            <Button
              variant="ghost"
              size="small"
              onClick={() =>
                act(async () => {
                  await api("/api/session", { method: "DELETE" });
                  setUser(null);
                  setProjects([]);
                  setSelected(null);
                }, "Signed out.")
              }
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-7 sm:px-8 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-8 lg:py-10">
        <aside className="flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <Label>PROJECTS</Label>
            <Button
              variant="ghost"
              size="small"
              iconOnly
              aria-label="New project"
              leadingIcon={RiAddLine}
              onClick={() => setCreating(true)}
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 lg:flex-col">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => {
                  setCreating(false);
                  setSelected(project.id);
                }}
                className={cx(
                  "min-w-44 rounded-xl border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-border-focus-ring lg:w-full",
                  selected === project.id && !creating
                    ? "border-border-button-hover bg-background-primary-default shadow-sm"
                    : "border-transparent hover:bg-background-secondary-default",
                )}
              >
                <p className="truncate text-body-medium text-text-primary">
                  {project.name}
                </p>
                <p className="mt-1 truncate text-caption-1-regular text-text-tertiary">
                  {project.repo}
                </p>
              </button>
            ))}
          </div>
          <Button
            variant="secondary"
            size="small"
            leadingIcon={RiAddLine}
            onClick={() => setCreating(true)}
          >
            New project
          </Button>
          <Card className="p-5">
            <Label>YOUR PLAN</Label>
            <p className="mt-3 text-headline-medium text-text-primary">
              {user.plan === "pro" ? "Keep building" : "Build at your pace"}
            </p>
            <p className="mt-2 text-body-regular text-text-secondary">
              {user.plan === "pro"
                ? "Unlimited projects and scheduled sweeps."
                : "One project and three runs each month. Upgrade for scheduled sweeps."}
            </p>
            {user.plan !== "pro" ? (
              <Button className="mt-4 w-full" size="small" onClick={upgrade}>
                Upgrade to Pro
              </Button>
            ) : (
              <Button
                className="mt-4 w-full"
                size="small"
                variant="secondary"
                onClick={() =>
                  act(async () => {
                    const { url } = await send<{ url: string }>(
                      "/api/billing/portal",
                      {},
                    );
                    location.href = url;
                  }, "Opening billing portal…")
                }
              >
                Manage billing
              </Button>
            )}
          </Card>
        </aside>
        <div className="min-w-0">
          {notice && (
            <div
              role="status"
              className="mb-5 rounded-xl border border-border-button-default bg-background-primary-default px-4 py-3 text-body-regular text-text-secondary"
            >
              {notice}
            </div>
          )}
          {creating || !selected ? (
            <div className="flex flex-col gap-6">
              <div>
                <Label>NEW PROJECT</Label>
                <h1 className="mt-2 text-title-2-medium text-text-primary">
                  Give your next product a home.
                </h1>
                <p className="mt-2 text-body-regular text-text-secondary">
                  Start with a repository and a clear brief. Connect your AI key
                  and channels next.
                </p>
              </div>
              <Card className="max-w-2xl p-6 sm:p-8">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(async () => {
                      const result = await send<{ id: string }>(
                        "/api/projects",
                        newProject,
                      );
                      await refreshProjects();
                      setSelected(result.id);
                      setCreating(false);
                      setNewProject({ name: "", repo: "", brief: "" });
                    }, "Project created. Add your AI key in Secrets.");
                  }}
                  className="flex flex-col gap-5"
                >
                  <Input
                    label="Project name"
                    value={newProject.name}
                    onChange={(name) => setNewProject({ ...newProject, name })}
                    placeholder="Customer portal"
                    isRequired
                  />
                  <Input
                    label="GitHub repository"
                    value={newProject.repo}
                    onChange={(repo) => setNewProject({ ...newProject, repo })}
                    placeholder="owner/repository"
                    hint="The repository needs an initial commit and your token needs write access."
                    isRequired
                  />
                  <Textarea
                    label="Product brief"
                    value={newProject.brief}
                    onChange={(brief) =>
                      setNewProject({ ...newProject, brief })
                    }
                    placeholder="What are you building, who is it for, and what matters most?"
                    rows={6}
                    isRequired
                  />
                  <div className="flex justify-end gap-2">
                    {projects.length > 0 && (
                      <Button
                        variant="ghost"
                        onClick={() => setCreating(false)}
                      >
                        Cancel
                      </Button>
                    )}
                    <Button type="submit" disabled={busy}>
                      Create project
                    </Button>
                  </div>
                </form>
              </Card>
            </div>
          ) : detail ? (
            <div className="flex flex-col gap-7">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <Label>PRODUCT WORKSPACE</Label>
                  <h1 className="mt-2 text-title-2-medium text-text-primary">
                    {detail.project.name}
                  </h1>
                  <a
                    href={`https://github.com/${detail.project.repo}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-body-regular text-text-secondary hover:text-accent-600"
                  >
                    <RiGithubLine className="size-4" aria-hidden />
                    {detail.project.repo}
                    <RiExternalLinkLine className="size-4" aria-hidden />
                  </a>
                </div>
                <Button
                  leadingIcon={RiPlayLine}
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await send(`${base}/runs`, {});
                      await refreshDetail(selected);
                    }, "Run queued. Activity will update shortly.")
                  }
                >
                  Run now
                </Button>
              </div>
              <Tabs defaultSelectedKey="overview" key={selected}>
                <TabList aria-label="Project sections">
                  <Tab id="overview">Overview</Tab>
                  <Tab id="activity">Activity</Tab>
                  <Tab id="channels">Channels</Tab>
                  <Tab id="secrets">Secrets</Tab>
                  <Tab id="settings">Settings</Tab>
                </TabList>
                <TabPanel id="overview">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Card className="p-5">
                      <Label>RUNS</Label>
                      <p className="mt-3 text-title-2-medium text-text-primary">
                        {detail.runs.length}
                      </p>
                      <p className="mt-2 text-caption-1-regular text-text-secondary">
                        Latest 30 runs
                      </p>
                    </Card>
                    <Card className="p-5">
                      <Label>CHANNELS</Label>
                      <p className="mt-3 text-title-2-medium text-text-primary">
                        {detail.channels.length}
                      </p>
                      <p className="mt-2 text-caption-1-regular text-text-secondary">
                        Connected sources
                      </p>
                    </Card>
                    <Card className="p-5">
                      <Label>AUTOMATION</Label>
                      <p className="mt-3 text-headline-medium text-text-primary">
                        {user.plan !== "pro"
                          ? "Manual"
                          : detail.project.enabled
                            ? `Every ${detail.project.interval_minutes}m`
                            : "Paused"}
                      </p>
                      <p className="mt-2 text-caption-1-regular text-text-secondary">
                        {user.plan === "pro"
                          ? "Scheduled sweep"
                          : "Pro unlocks sweeps"}
                      </p>
                    </Card>
                  </div>
                  <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                    <Card className="p-6">
                      <Label>PRODUCT BRIEF</Label>
                      <h2 className="mt-2 text-headline-medium text-text-primary">
                        What Foundry is building
                      </h2>
                      <p className="mt-5 whitespace-pre-wrap text-body-regular text-text-secondary">
                        {detail.project.brief}
                      </p>
                    </Card>
                    <Card className="p-6">
                      <Label>THE LOOP</Label>
                      {[
                        ["1", "Capture context"],
                        ["2", "Plan a GitHub issue"],
                        ["3", "Open a draft PR"],
                      ].map(([n, title]) => (
                        <div className="mt-5 flex items-center gap-3" key={n}>
                          <span className="flex size-7 items-center justify-center rounded-full bg-accent-50 text-caption-1-semibold text-accent-700">
                            {n}
                          </span>
                          <p className="text-body-medium text-text-primary">
                            {title}
                          </p>
                        </div>
                      ))}
                    </Card>
                  </div>
                  <Card className="mt-6 p-6">
                    <div className="mb-5 flex items-center justify-between">
                      <div>
                        <Label>FRESH SIGNALS</Label>
                        <h2 className="mt-2 text-headline-medium text-text-primary">
                          Add context
                        </h2>
                      </div>
                      <Badge color="neutral">{detail.context.length}</Badge>
                    </div>
                    <Textarea
                      aria-label="Add product context"
                      value={note}
                      onChange={setNote}
                      placeholder="A customer request, an idea, or something your team discussed…"
                      rows={3}
                    />
                    <div className="mt-3 flex justify-end">
                      <Button
                        size="small"
                        disabled={busy || !note.trim()}
                        onClick={() =>
                          act(async () => {
                            await send(`${base}/context`, { content: note });
                            setNote("");
                            await refreshDetail(selected);
                          }, "Context added.")
                        }
                      >
                        Add note
                      </Button>
                    </div>
                    {detail.context.length > 0 && (
                      <div className="mt-5 divide-y divide-separator-border border-t border-separator-border">
                        {detail.context.slice(0, 4).map((item) => (
                          <div key={item.id} className="py-4">
                            <p className="line-clamp-2 text-body-regular text-text-primary">
                              {item.content}
                            </p>
                            <p className="mt-2 text-caption-1-regular text-text-tertiary">
                              {when(item.created_at)}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </TabPanel>
                <TabPanel id="activity">
                  <Card className="p-6">
                    <div className="mb-6 flex items-center justify-between">
                      <div>
                        <Label>ENGINEERING FEED</Label>
                        <h2 className="mt-2 text-headline-medium text-text-primary">
                          Runs and changes
                        </h2>
                      </div>
                      <Button
                        size="small"
                        variant="ghost"
                        iconOnly
                        leadingIcon={RiRefreshLine}
                        aria-label="Refresh activity"
                        onClick={() => refreshDetail(selected)}
                      />
                    </div>
                    {detail.runs.length ? (
                      <div className="divide-y divide-separator-border">
                        {detail.runs.map((run) => (
                          <div
                            key={run.id}
                            className="flex flex-col gap-3 py-5 first:pt-0 sm:flex-row sm:justify-between"
                          >
                            <div className="flex gap-3">
                              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background-secondary-default">
                                <RiGitPullRequestLine
                                  className="size-5 text-foreground-icon-secondary"
                                  aria-hidden
                                />
                              </div>
                              <div>
                                <p className="text-body-medium text-text-primary">
                                  {run.title || "Sweeping for product work"}
                                </p>
                                <p className="mt-1 text-caption-1-regular text-text-tertiary">
                                  {when(run.created_at)} · {run.status}
                                </p>
                                {run.error && (
                                  <p className="mt-2 text-caption-1-regular text-text-error-primary">
                                    {run.error}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-3 pl-12 sm:pl-0">
                              {run.issue_url && (
                                <a
                                  className="text-caption-1-semibold text-accent-600"
                                  target="_blank"
                                  rel="noreferrer"
                                  href={run.issue_url}
                                >
                                  Issue ↗
                                </a>
                              )}
                              {run.pr_url && (
                                <a
                                  className="text-caption-1-semibold text-accent-600"
                                  target="_blank"
                                  rel="noreferrer"
                                  href={run.pr_url}
                                >
                                  Draft PR ↗
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        title="No runs yet"
                        description="Add your AI key in Secrets, then start a run. Foundry will open an issue and draft PR."
                      />
                    )}
                  </Card>
                </TabPanel>
                <TabPanel id="channels">
                  <div className="grid gap-6 xl:grid-cols-2">
                    <Card className="p-6">
                      <Label>CONTEXT SOURCES</Label>
                      <h2 className="mt-2 text-headline-medium text-text-primary">
                        Connect a conversation
                      </h2>
                      <p className="mt-2 text-body-regular text-text-secondary">
                        Slack and Telegram are polled on each sweep. WhatsApp
                        uses verified webhooks.
                      </p>
                      <div className="mt-5 flex flex-wrap gap-2">
                        {["slack", "telegram", "whatsapp"].map((kind) => (
                          <Button
                            key={kind}
                            variant={
                              channel.kind === kind ? "primary" : "secondary"
                            }
                            size="small"
                            onClick={() => setChannel({ ...channel, kind })}
                          >
                            {kind[0].toUpperCase() + kind.slice(1)}
                          </Button>
                        ))}
                      </div>
                      <form
                        className="mt-5 flex flex-col gap-4"
                        onSubmit={(e) => {
                          e.preventDefault();
                          act(async () => {
                            await send(`${base}/channels`, channel);
                            setChannel({
                              ...channel,
                              name: "",
                              channel_ref: "",
                            });
                            await refreshDetail(selected);
                          }, "Channel connected.");
                        }}
                      >
                        <Input
                          label="Name"
                          value={channel.name}
                          onChange={(name) => setChannel({ ...channel, name })}
                          placeholder="Product feedback"
                          isRequired
                        />
                        <Input
                          label={
                            channel.kind === "whatsapp"
                              ? "Phone number ID"
                              : "Channel or chat ID"
                          }
                          value={channel.channel_ref}
                          onChange={(channel_ref) =>
                            setChannel({ ...channel, channel_ref })
                          }
                          placeholder="Channel ID"
                          isRequired
                        />
                        <Button type="submit" disabled={busy}>
                          Connect channel
                        </Button>
                      </form>
                    </Card>
                    <Card className="p-6">
                      <Label>SETUP</Label>
                      <h2 className="mt-2 text-headline-medium text-text-primary">
                        Required credentials
                      </h2>
                      <div className="mt-5 flex flex-col gap-4 text-body-regular text-text-secondary">
                        <p>
                          <strong className="text-text-primary">Slack:</strong>{" "}
                          save <code>SLACK_BOT_TOKEN</code> in Secrets and
                          invite the bot to the channel. Grant history access.
                        </p>
                        <p>
                          <strong className="text-text-primary">
                            Telegram:
                          </strong>{" "}
                          save <code>TELEGRAM_BOT_TOKEN</code> and add the bot
                          to the chat. Disable bot privacy for full group
                          context.
                        </p>
                        <p>
                          <strong className="text-text-primary">
                            WhatsApp:
                          </strong>{" "}
                          save <code>WHATSAPP_APP_SECRET</code> and{" "}
                          <code>WHATSAPP_VERIFY_TOKEN</code>. Register the
                          callback URL shown below for the connected channel.
                        </p>
                      </div>
                    </Card>
                  </div>
                  <Card className="mt-6 p-6">
                    <Label>CONNECTED CHANNELS</Label>
                    <div className="mt-4">
                      {detail.channels.length ? (
                        detail.channels.map((item) => (
                          <div
                            key={item.id}
                            className="flex flex-wrap items-center justify-between gap-3 border-t border-separator-border py-3"
                          >
                            <div>
                              <p className="text-body-medium text-text-primary">
                                {item.name}
                              </p>
                              <p className="text-caption-1-regular text-text-tertiary">
                                {item.kind} · {item.channel_ref}
                              </p>
                              {item.kind === "whatsapp" && (
                                <p className="max-w-md break-all text-caption-1-regular text-text-secondary">
                                  {typeof window !== "undefined"
                                    ? window.location.origin
                                    : ""}
                                  /api/webhooks/whatsapp/{item.id}
                                </p>
                              )}
                            </div>
                            <Button
                              size="small"
                              variant="ghost"
                              onClick={() =>
                                act(async () => {
                                  await send(
                                    `${base}/channels`,
                                    { channelId: item.id },
                                    "DELETE",
                                  );
                                  await refreshDetail(selected);
                                }, "Channel removed.")
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        ))
                      ) : (
                        <Empty
                          title="No channels yet"
                          description="You can add context manually while setting up a channel."
                        />
                      )}
                    </div>
                  </Card>
                </TabPanel>
                <TabPanel id="secrets">
                  <div className="grid gap-6 xl:grid-cols-2">
                    <Card className="p-6">
                      <Label>ENCRYPTED VAULT</Label>
                      <h2 className="mt-2 text-headline-medium text-text-primary">
                        Project secrets
                      </h2>
                      <p className="mt-2 text-body-regular text-text-secondary">
                        Values are encrypted before storage and never shown
                        again. Save the same name to replace a value.
                      </p>
                      <form
                        className="mt-6 flex flex-col gap-4"
                        onSubmit={(e) => {
                          e.preventDefault();
                          act(async () => {
                            await send(`${base}/secrets`, secret, "PUT");
                            setSecret({ ...secret, value: "" });
                            await refreshDetail(selected);
                          }, "Secret saved.");
                        }}
                      >
                        <Input
                          label="Secret name"
                          value={secret.name}
                          onChange={(name) => setSecret({ ...secret, name })}
                          placeholder="AI_API_KEY"
                          isRequired
                        />
                        <Input
                          label="Value"
                          type="password"
                          autoComplete="off"
                          value={secret.value}
                          onChange={(value) => setSecret({ ...secret, value })}
                          placeholder="Enter value"
                          isRequired
                        />
                        <Button type="submit" disabled={busy}>
                          Save secret
                        </Button>
                      </form>
                      <div className="mt-5 rounded-xl bg-background-secondary-default p-4 text-caption-1-regular text-text-secondary">
                        <p className="text-caption-1-semibold text-text-primary">
                          To run the agent, add:
                        </p>
                        <p className="mt-2">
                          <code>AI_PROVIDER</code> = <code>openai</code> or{" "}
                          <code>anthropic</code>
                        </p>
                        <p>
                          <code>AI_API_KEY</code> = your provider key
                        </p>
                        <p>
                          Optional: <code>AI_MODEL</code> = model name
                        </p>
                      </div>
                    </Card>
                    <Card className="p-6">
                      <Label>STORED NAMES</Label>
                      <h2 className="mt-2 text-headline-medium text-text-primary">
                        Available to this project
                      </h2>
                      <div className="mt-5">
                        {detail.secrets.length ? (
                          detail.secrets.map((item) => (
                            <div
                              key={item.name}
                              className="flex items-center justify-between gap-3 border-t border-separator-border py-3"
                            >
                              <span className="flex items-center gap-2 text-body-medium text-text-primary">
                                <RiShieldKeyholeLine
                                  className="size-4 text-foreground-icon-tertiary"
                                  aria-hidden
                                />
                                {item.name}
                              </span>
                              <Button
                                variant="ghost"
                                size="small"
                                onClick={() =>
                                  act(async () => {
                                    await send(
                                      `${base}/secrets`,
                                      { name: item.name },
                                      "DELETE",
                                    );
                                    await refreshDetail(selected);
                                  }, "Secret removed.")
                                }
                              >
                                Remove
                              </Button>
                            </div>
                          ))
                        ) : (
                          <Empty
                            title="Vault is empty"
                            description="Add your AI provider and API key to start building."
                          />
                        )}
                      </div>
                    </Card>
                  </div>
                </TabPanel>
                <TabPanel id="settings">
                  <Card className="max-w-2xl p-6 sm:p-8">
                    <Label>PROJECT SETTINGS</Label>
                    <h2 className="mt-2 text-headline-medium text-text-primary">
                      Shape the work
                    </h2>
                    <div className="mt-6 flex flex-col gap-5">
                      <Input
                        label="Name"
                        value={settings.name}
                        onChange={(name) => setSettings({ ...settings, name })}
                      />
                      <Textarea
                        label="Product brief"
                        value={settings.brief}
                        onChange={(brief) =>
                          setSettings({ ...settings, brief })
                        }
                        rows={6}
                      />
                      <div>
                        <p className="mb-3 text-body-medium text-text-primary">
                          Sweep interval
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {[
                            [15, "15m"],
                            [30, "30m"],
                            [60, "1h"],
                            [360, "6h"],
                            [1440, "1d"],
                          ].map(([minutes, title]) => (
                            <Button
                              key={minutes}
                              size="small"
                              variant={
                                settings.interval_minutes === minutes
                                  ? "primary"
                                  : "secondary"
                              }
                              onClick={() =>
                                setSettings({
                                  ...settings,
                                  interval_minutes: Number(minutes),
                                })
                              }
                            >
                              {title}
                            </Button>
                          ))}
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          setSettings({
                            ...settings,
                            enabled: !settings.enabled,
                          })
                        }
                      >
                        {settings.enabled
                          ? "Automation enabled · click to pause"
                          : "Automation paused · click to resume"}
                      </Button>
                      <div className="flex justify-end">
                        <Button
                          disabled={busy}
                          onClick={() =>
                            act(async () => {
                              await send(base, settings, "PATCH");
                              await refreshDetail(selected);
                              await refreshProjects();
                            }, "Settings saved.")
                          }
                        >
                          Save changes
                        </Button>
                      </div>
                    </div>
                  </Card>
                </TabPanel>
              </Tabs>
            </div>
          ) : (
            <Card className="grid min-h-80 place-items-center p-8 text-body-regular text-text-secondary">
              Loading project…
            </Card>
          )}
        </div>
      </div>
      <footer className="mx-auto flex max-w-7xl flex-wrap justify-between gap-3 border-t border-separator-border px-5 py-6 text-caption-1-regular text-text-tertiary sm:px-8">
        <span>Foundry · Product work, continuously</span>
        <span>Cloudflare Workers · D1 · Queues</span>
      </footer>
    </main>
  );
}
