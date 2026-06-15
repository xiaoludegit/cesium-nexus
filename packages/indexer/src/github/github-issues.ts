import type { IssueRecord } from "@cesium-nexus/shared";

// ---------------------------------------------------------------------------
// githubFetch — unified fetch wrapper with auth, User-Agent, rate limit
// ---------------------------------------------------------------------------

export interface GitHubFetchOptions {
  url: string;
  token?: string;
}

interface GitHubResponse {
  data: unknown;
  headers: Headers;
}

export class GitHubRateLimitError extends Error {
  constructor(
    public resetAt: Date,
    public remaining: number,
  ) {
    const minutes = Math.ceil((resetAt.getTime() - Date.now()) / 60_000);
    super(
      `GitHub rate limit exceeded. Reset in ${minutes} minutes (${resetAt.toISOString()}).`,
    );
    this.name = "GitHubRateLimitError";
  }
}

export class GitHubApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(`GitHub API error (${status}): ${message}`);
    this.name = "GitHubApiError";
  }
}

export async function githubFetch(opts: GitHubFetchOptions): Promise<GitHubResponse> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "cesium-nexus/0.1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }

  const response = await fetch(opts.url, { headers });

  // Rate limit check
  const remaining = response.headers.get("X-RateLimit-Remaining");
  const resetEpoch = response.headers.get("X-RateLimit-Reset");

  if (response.status === 403 || response.status === 429) {
    const resetAt = resetEpoch
      ? new Date(parseInt(resetEpoch, 10) * 1000)
      : new Date(Date.now() + 60 * 60 * 1000);
    throw new GitHubRateLimitError(resetAt, remaining ? parseInt(remaining, 10) : 0);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new GitHubApiError(response.status, body.slice(0, 200));
  }

  const data = await response.json();
  return { data, headers: response.headers };
}

// ---------------------------------------------------------------------------
// Link header pagination parser
// ---------------------------------------------------------------------------

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",");
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// GitHub Issue -> IssueRecord mapper
// ---------------------------------------------------------------------------

interface GitHubIssueItem {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: Array<{ name: string } | string>;
  assignees: Array<{ login: string }> | null;
  user: { login: string } | null;
  comments: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  html_url: string;
  pull_request?: unknown;
}

export function mapGitHubIssue(item: GitHubIssueItem, repo: string): IssueRecord {
  return {
    id: item.id,
    repo,
    number: item.number,
    title: item.title,
    body: item.body ?? "",
    state: item.state,
    labels: item.labels.map((l) => (typeof l === "string" ? l : l.name)),
    assignees: (item.assignees ?? []).map((a) => a.login),
    author: item.user?.login ?? "",
    comments: item.comments,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    closedAt: item.closed_at,
    htmlUrl: item.html_url,
  };
}

// ---------------------------------------------------------------------------
// syncIssues — fetch issues from GitHub with pagination + PR filtering
// ---------------------------------------------------------------------------

export interface SyncIssuesOptions {
  owner: string;
  repo: string;
  token?: string;
  since?: string | null;
}

export interface SyncResult {
  issues: IssueRecord[];
  totalPages: number;
  prsFiltered: number;
}

export async function syncIssues(opts: SyncIssuesOptions): Promise<SyncResult> {
  const { owner, repo, token, since } = opts;
  const repoSlug = `${owner}/${repo}`;

  const params = new URLSearchParams({
    state: "all",
    per_page: "100",
    sort: "updated",
    direction: "asc",
  });
  if (since) {
    params.set("since", since);
  }

  const baseUrl = `https://api.github.com/repos/${owner}/${repo}/issues?${params}`;

  const issues: IssueRecord[] = [];
  let prsFiltered = 0;
  let totalPages = 0;
  let nextUrl: string | null = baseUrl;

  while (nextUrl) {
    totalPages++;
    console.log(`Fetching page ${totalPages}...`);

    const { data, headers } = await githubFetch({ url: nextUrl, token });
    const items = data as GitHubIssueItem[];

    for (const item of items) {
      // Filter out pull requests
      if (item.pull_request) {
        prsFiltered++;
        continue;
      }
      issues.push(mapGitHubIssue(item, repoSlug));
    }

    console.log(`Indexed ${issues.length} issues...`);

    // Parse Link header for next page
    nextUrl = parseNextLink(headers.get("Link"));
  }

  console.log("Issue sync complete.");

  return { issues, totalPages, prsFiltered };
}
