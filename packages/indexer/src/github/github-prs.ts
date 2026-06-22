import type { PullRequestRecord } from "@cesium-nexus/shared";
import { githubFetch } from "./github-issues.js";
import type { GitHubFetchOptions } from "./github-issues.js";

interface GitHubPRItem {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  merged_at: string | null;
  user: { login: string } | null;
  labels: Array<{ name: string } | string>;
  review_comments: number;
  changed_files: number;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export function mapGitHubPR(
  item: GitHubPRItem,
  repo: string,
): PullRequestRecord {
  const closingRefs: number[] = [];
  const body = item.body ?? "";
  const closePattern = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*#(\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = closePattern.exec(body)) !== null) {
    closingRefs.push(parseInt(match[1], 10));
  }

  return {
    id: item.id,
    repo,
    number: item.number,
    title: item.title,
    body,
    state: item.state,
    mergedAt: item.merged_at ?? null,
    author: item.user?.login ?? "",
    labels: item.labels.map((l) =>
      typeof l === "string" ? l : l.name,
    ),
    reviewComments: item.review_comments,
    filesChanged: item.changed_files,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    htmlUrl: item.html_url,
    closingIssueReferences: closingRefs,
  };
}

export interface SyncPRsOptions {
  owner: string;
  repo: string;
  token?: string;
  since?: string | null;
}

export interface SyncPRsResult {
  prs: PullRequestRecord[];
  totalPages: number;
  maxUpdatedAt: string | null;
}

export async function syncPRs(opts: SyncPRsOptions): Promise<SyncPRsResult> {
  const { owner, repo, token, since } = opts;
  const repoSlug = `${owner}/${repo}`;

  const params = new URLSearchParams({
    state: "closed",
    per_page: "100",
    sort: "updated",
    direction: "asc",
  });
  if (since) {
    params.set("since", since);
  }

  const baseUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?${params}`;

  const prs: PullRequestRecord[] = [];
  let totalPages = 0;
  let maxUpdatedAt: string | null = null;
  let nextUrl: string | null = baseUrl;

  while (nextUrl) {
    totalPages++;
    console.log(`Fetching PR page ${totalPages}...`);

    const { data, headers } = await githubFetch({ url: nextUrl, token });
    const items = data as GitHubPRItem[];

    for (const item of items) {
      if (!item.merged_at) continue;

      const record = mapGitHubPR(item, repoSlug);
      prs.push(record);

      if (!maxUpdatedAt || record.updatedAt > maxUpdatedAt) {
        maxUpdatedAt = record.updatedAt;
      }
    }

    console.log(`Indexed ${prs.length} PRs...`);

    const linkHeader = headers.get("Link");
    nextUrl = null;
    if (linkHeader) {
      const parts = linkHeader.split(",");
      for (const part of parts) {
        const m = part.match(/<([^>]+)>;\s*rel="next"/);
        if (m) {
          nextUrl = m[1];
          break;
        }
      }
    }
  }

  console.log("PR sync complete.");
  return { prs, totalPages, maxUpdatedAt };
}
