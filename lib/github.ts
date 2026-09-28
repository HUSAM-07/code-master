export type Repo = {
  full_name: string;
  default_branch: string;
  permissions?: { push?: boolean };
};
type Tree = {
  sha: string;
  tree: { path: string; type: string; size?: number }[];
};

export async function github<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Foundry-Product-Builder",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(
      `GitHub request failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
    );
  return response.json() as Promise<T>;
}

export function repoPath(repo: string) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || repo.split("/").some((part) => part === "." || part === ".."))
    throw new Response("Repository must be owner/name", { status: 400 });
  return `/repos/${repo}`;
}

export async function readRepository(token: string, repo: string) {
  const base = repoPath(repo);
  const info = await github<Repo>(token, base);
  if (!info.permissions?.push)
    throw new Response("Your token needs repository write access", {
      status: 403,
    });
  const ref = await github<{ object: { sha: string } }>(
    token,
    `${base}/git/ref/heads/${encodeURIComponent(info.default_branch)}`,
  );
  const commit = await github<{ tree: { sha: string } }>(
    token,
    `${base}/git/commits/${ref.object.sha}`,
  );
  const tree = await github<Tree>(
    token,
    `${base}/git/trees/${commit.tree.sha}?recursive=1`,
  );
  return {
    base,
    info,
    headSha: ref.object.sha,
    treeSha: commit.tree.sha,
    files: tree.tree
      .filter((f) => f.type === "blob" && (f.size ?? 0) < 60000)
      .map((f) => f.path),
  };
}

export async function readTextFiles(
  token: string,
  repo: string,
  branch: string,
  paths: string[],
) {
  const files: { path: string; content: string }[] = [];
  for (const path of paths.slice(0, 12)) {
    const response = await github<{ content: string; encoding: string }>(
      token,
      `${repoPath(repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`,
    );
    if (response.encoding === "base64")
      files.push({
        path,
        content: new TextDecoder().decode(
          Uint8Array.from(atob(response.content.replace(/\s/g, "")), (char) =>
            char.charCodeAt(0),
          ),
        ),
      });
  }
  return files;
}

const blocked =
  /(^|\/)(\.git|\.env[^/]*|node_modules)(\/|$)|^\.github\/workflows\//;
export function validateFiles(files: { path: string; content: string }[]) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 8)
    throw new Error("The agent must return 1–8 files");
  for (const file of files) {
    if (
      typeof file.path !== "string" ||
      typeof file.content !== "string" ||
      file.content.length > 100000 ||
      file.path.startsWith("/") ||
      file.path.split("/").includes("..") ||
      blocked.test(file.path)
    ) {
      throw new Error("The agent returned an unsafe file path or size");
    }
  }
}

export async function createPullRequest(
  token: string,
  repo: string,
  runId: string,
  title: string,
  body: string,
  files: { path: string; content: string }[],
) {
  validateFiles(files);
  const snapshot = await readRepository(token, repo);
  const branch = `foundry/${runId.slice(0, 12)}`;
  const blobs = await Promise.all(
    files.map(async (file) => ({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: (
        await github<{ sha: string }>(token, `${snapshot.base}/git/blobs`, {
          method: "POST",
          body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
        })
      ).sha,
    })),
  );
  const newTree = await github<{ sha: string }>(
    token,
    `${snapshot.base}/git/trees`,
    {
      method: "POST",
      body: JSON.stringify({ base_tree: snapshot.treeSha, tree: blobs }),
    },
  );
  if (newTree.sha === snapshot.treeSha) return null;
  const commit = await github<{ sha: string }>(
    token,
    `${snapshot.base}/git/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        message: `Foundry: ${title}`,
        tree: newTree.sha,
        parents: [snapshot.headSha],
      }),
    },
  );
  try {
    await github(token, `${snapshot.base}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("(422)"))
      throw error;
    // ponytail: retry reuses the first branch commit; add branch reconciliation if runs can edit after a partial failure.
  }
  const pr = await github<{ html_url: string }>(
    token,
    `${snapshot.base}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({
        title,
        body,
        head: branch,
        base: snapshot.info.default_branch,
        draft: true,
      }),
    },
  );
  return pr.html_url;
}
