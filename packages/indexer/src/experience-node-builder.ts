import type {
  ExperienceNode,
  IssueRecord,
  PullRequestRecord,
  ForumPost,
} from "@cesium-nexus/shared";
import type {
  IssueRepo,
  PullRequestRepo,
  ForumRepo,
  ExperienceRepo,
} from "@cesium-nexus/storage";
import { buildExperienceNode } from "@cesium-nexus/storage";

function extractSymbolsFromText(text: string): string[] {
  const symbols = new Set<string>();
  const capitalPattern = /[A-Z][a-zA-Z]{2,}/g;
  let match: RegExpExecArray | null;
  while ((match = capitalPattern.exec(text)) !== null) {
    symbols.add(match[0]);
  }
  return [...symbols];
}

export function buildExperienceNodesFromIssues(
  issues: IssueRecord[],
): ExperienceNode[] {
  return issues.map((issue) => {
    const text = `${issue.title} ${issue.body}`;
    const symbols = extractSymbolsFromText(text);
    return buildExperienceNode("issue", {
      id: issue.id,
      title: issue.title,
      body: issue.body,
      url: issue.htmlUrl,
      labels: issue.labels,
      qualityScore: issue.comments > 5 ? 0.7 : 0.5,
      publishedAt: issue.createdAt,
      repo: issue.repo,
    }, symbols);
  });
}

export function buildExperienceNodesFromPRs(
  prs: PullRequestRecord[],
): ExperienceNode[] {
  return prs
    .filter((pr) => pr.state === "closed" && pr.mergedAt)
    .map((pr) => {
      const text = `${pr.title} ${pr.body}`;
      const symbols = extractSymbolsFromText(text);
      return buildExperienceNode("pr_review", {
        id: pr.id,
        title: pr.title,
        body: pr.body,
        url: pr.htmlUrl,
        labels: pr.labels,
        qualityScore: pr.reviewComments > 3 ? 0.8 : 0.6,
        publishedAt: pr.createdAt,
        repo: pr.repo,
      }, [...symbols, ...pr.closingIssueReferences.map(String)]);
    });
}

export function buildExperienceNodesFromForum(
  posts: ForumPost[],
): ExperienceNode[] {
  return posts.map((post) => {
    const text = `${post.title} ${post.body}`;
    const symbols = extractSymbolsFromText(text);
    return buildExperienceNode("forum", {
      id: post.id,
      title: post.title,
      body: post.body,
      url: post.url,
      tags: post.tags,
      qualityScore: post.qualityScore,
      publishedAt: post.createdAt,
      repo: "community-forum",
    }, symbols);
  });
}

export function rebuildExperienceIndex(
  issueRepo: IssueRepo,
  prRepo: PullRequestRepo,
  forumRepo: ForumRepo,
  experienceRepo: ExperienceRepo,
): { issues: number; prs: number; forum: number; total: number } {
  experienceRepo.clear();

  const allIssues = issueRepo.searchFts("", { limit: 0 });
  const issues = allIssues.map((r) => r.issue);
  const issueNodes = buildExperienceNodesFromIssues(issues);

  const allPRs = prRepo.searchFts("", { limit: 0 });
  const prs = allPRs.map((r) => r.pr);
  const prNodes = buildExperienceNodesFromPRs(prs);

  const allForum = forumRepo.searchFts("", { limit: 0 });
  const forumPosts = allForum.map((r) => r.post);
  const forumNodes = buildExperienceNodesFromForum(forumPosts);

  const allNodes = [...issueNodes, ...prNodes, ...forumNodes];
  if (allNodes.length > 0) {
    experienceRepo.upsertMany(allNodes);
  }

  return {
    issues: issueNodes.length,
    prs: prNodes.length,
    forum: forumNodes.length,
    total: allNodes.length,
  };
}
