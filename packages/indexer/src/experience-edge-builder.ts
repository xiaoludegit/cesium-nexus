import type {
  ExperienceEdge,
  ExperienceChain,
} from "@cesium-nexus/shared";
import type {
  IssueRepo,
  PullRequestRepo,
  ForumRepo,
  ExperienceRepo,
  ExperienceEdgeRepo,
} from "@cesium-nexus/storage";
import { rebuildExperienceIndex } from "./experience-node-builder.js";

export function buildFixesEdges(
  prRepo: PullRequestRepo,
  issueRepo: IssueRepo,
  experienceRepo: ExperienceRepo,
): ExperienceEdge[] {
  const prs = prRepo.getAllWithClosingRefs();
  const allNodes = experienceRepo.getAll();
  const nodeIdSet = new Set(allNodes.map((n) => n.id));

  const edges: ExperienceEdge[] = [];
  const seen = new Set<string>();

  for (const pr of prs) {
    const sourceNodeId = `pr_review:${pr.id}`;
    if (!nodeIdSet.has(sourceNodeId)) continue;

    for (const issueNumber of pr.closingIssueReferences) {
      const issue = issueRepo.findByNumber(pr.repo, issueNumber);
      if (!issue) continue;

      const targetNodeId = `issue:${issue.id}`;
      if (!nodeIdSet.has(targetNodeId)) continue;

      const edgeId = `fixes:${sourceNodeId}:${targetNodeId}`;
      if (seen.has(edgeId)) continue;
      seen.add(edgeId);

      edges.push({
        id: edgeId,
        sourceNodeId,
        targetNodeId,
        edgeType: "fixes",
        confidence: 1.0,
        createdAt: new Date().toISOString(),
      });
    }
  }

  return edges;
}

export function rebuildExperienceGraph(
  issueRepo: IssueRepo,
  prRepo: PullRequestRepo,
  forumRepo: ForumRepo,
  experienceRepo: ExperienceRepo,
  edgeRepo: ExperienceEdgeRepo,
): { nodes: number; edges: number } {
  const nodeStats = rebuildExperienceIndex(
    issueRepo,
    prRepo,
    forumRepo,
    experienceRepo,
  );

  edgeRepo.clear();
  const edges = buildFixesEdges(prRepo, issueRepo, experienceRepo);
  if (edges.length > 0) {
    edgeRepo.upsertMany(edges);
  }

  return { nodes: nodeStats.total, edges: edges.length };
}

export function getExperienceChain(
  nodeId: string,
  experienceRepo: ExperienceRepo,
  edgeRepo: ExperienceEdgeRepo,
  maxDepth = 3,
): ExperienceChain {
  const edges = edgeRepo.getConnected(nodeId, maxDepth);

  const connectedIds = new Set<string>();
  connectedIds.add(nodeId);
  for (const e of edges) {
    connectedIds.add(e.sourceNodeId);
    connectedIds.add(e.targetNodeId);
  }

  const nodes = experienceRepo.findByIds([...connectedIds]);

  return {
    rootId: nodeId,
    nodes,
    edges,
    depth: maxDepth,
    truncated: false,
  };
}
