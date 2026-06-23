import { describe, it, expect, beforeEach } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import {
  initSchema,
  IssueRepo,
  PullRequestRepo,
  ExperienceRepo,
  ExperienceEdgeRepo,
} from "@cesium-nexus/storage";
import type { Database } from "@cesium-nexus/storage";
import type {
  IssueRecord,
  PullRequestRecord,
  ExperienceNode,
} from "@cesium-nexus/shared";
import {
  buildFixesEdges,
  getExperienceChain,
} from "./experience-edge-builder.js";

function makeIssue(overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    id: 1001,
    repo: "CesiumGS/cesium",
    number: 101,
    title: "Terrain clipping issue",
    body: "Clipping planes not working near terrain.",
    state: "closed",
    labels: ["bug"],
    assignees: [],
    author: "user1",
    comments: 2,
    createdAt: "2024-01-10T10:00:00Z",
    updatedAt: "2024-02-15T14:00:00Z",
    closedAt: "2024-02-15T14:00:00Z",
    htmlUrl: "https://github.com/CesiumGS/cesium/issues/101",
    ...overrides,
  };
}

function makePR(overrides: Partial<PullRequestRecord> = {}): PullRequestRecord {
  return {
    id: 2001,
    repo: "CesiumGS/cesium",
    number: 201,
    title: "Fix terrain clipping",
    body: "Fixes #101",
    state: "closed",
    mergedAt: "2024-02-15T12:00:00Z",
    author: "dev1",
    labels: ["fix"],
    reviewComments: 2,
    filesChanged: 3,
    createdAt: "2024-02-10T10:00:00Z",
    updatedAt: "2024-02-15T12:00:00Z",
    htmlUrl: "https://github.com/CesiumGS/cesium/pull/201",
    closingIssueReferences: [101],
    ...overrides,
  };
}

function makeExperienceNode(
  id: string,
  overrides: Partial<ExperienceNode> = {},
): ExperienceNode {
  return {
    id,
    type: id.startsWith("pr_review") ? "pr_review" : "issue",
    title: "Test node",
    summary: "Test summary",
    url: `https://example.com/${id}`,
    symbols: [],
    tags: [],
    qualityScore: 0.5,
    publishedAt: "2024-01-01T00:00:00Z",
    repo: "CesiumGS/cesium",
    ...overrides,
  };
}

describe("experience-edge-builder", () => {
  let db: Database;
  let issueRepo: IssueRepo;
  let prRepo: PullRequestRepo;
  let experienceRepo: ExperienceRepo;
  let edgeRepo: ExperienceEdgeRepo;

  beforeEach(() => {
    db = new BetterSqlite3(":memory:");
    db.pragma("journal_mode = WAL");
    initSchema(db);
    issueRepo = new IssueRepo(db);
    prRepo = new PullRequestRepo(db);
    experienceRepo = new ExperienceRepo(db);
    edgeRepo = new ExperienceEdgeRepo(db);
  });

  describe("buildFixesEdges", () => {
    it("should build a fixes edge from PR closingIssueReferences", () => {
      const issue = makeIssue({ id: 1001, number: 101 });
      const pr = makePR({ id: 2001, closingIssueReferences: [101] });

      issueRepo.upsertMany([issue]);
      prRepo.upsertMany([pr]);
      experienceRepo.upsertMany([
        makeExperienceNode("issue:1001"),
        makeExperienceNode("pr_review:2001", { type: "pr_review" }),
      ]);

      const edges = buildFixesEdges(prRepo, issueRepo, experienceRepo);
      expect(edges).toHaveLength(1);
      expect(edges[0].id).toBe("fixes:pr_review:2001:issue:1001");
      expect(edges[0].sourceNodeId).toBe("pr_review:2001");
      expect(edges[0].targetNodeId).toBe("issue:1001");
      expect(edges[0].edgeType).toBe("fixes");
      expect(edges[0].confidence).toBe(1.0);
    });

    it("should skip edges when PR node does not exist in experience_node", () => {
      const issue = makeIssue({ id: 1001, number: 101 });
      const pr = makePR({ id: 2001, closingIssueReferences: [101] });

      issueRepo.upsertMany([issue]);
      prRepo.upsertMany([pr]);
      experienceRepo.upsertMany([makeExperienceNode("issue:1001")]);
      // pr_review:2001 not in experience_node

      const edges = buildFixesEdges(prRepo, issueRepo, experienceRepo);
      expect(edges).toHaveLength(0);
    });

    it("should skip edges when issue node does not exist in experience_node", () => {
      const issue = makeIssue({ id: 1001, number: 101 });
      const pr = makePR({ id: 2001, closingIssueReferences: [101] });

      issueRepo.upsertMany([issue]);
      prRepo.upsertMany([pr]);
      experienceRepo.upsertMany([
        makeExperienceNode("pr_review:2001", { type: "pr_review" }),
      ]);
      // issue:1001 not in experience_node

      const edges = buildFixesEdges(prRepo, issueRepo, experienceRepo);
      expect(edges).toHaveLength(0);
    });

    it("should skip when issue number is not found in issue repo", () => {
      const pr = makePR({ id: 2001, closingIssueReferences: [999] });

      prRepo.upsertMany([pr]);
      experienceRepo.upsertMany([
        makeExperienceNode("pr_review:2001", { type: "pr_review" }),
      ]);

      const edges = buildFixesEdges(prRepo, issueRepo, experienceRepo);
      expect(edges).toHaveLength(0);
    });

    it("should return empty array when no PRs have closing refs", () => {
      const pr = makePR({ id: 2001, closingIssueReferences: [] });
      prRepo.upsertMany([pr]);

      const edges = buildFixesEdges(prRepo, issueRepo, experienceRepo);
      expect(edges).toHaveLength(0);
    });

    it("should build multiple edges from one PR fixing multiple issues", () => {
      const issue1 = makeIssue({ id: 1001, number: 101 });
      const issue2 = makeIssue({ id: 1002, number: 102, title: "Another bug" });
      const pr = makePR({ id: 2001, closingIssueReferences: [101, 102] });

      issueRepo.upsertMany([issue1, issue2]);
      prRepo.upsertMany([pr]);
      experienceRepo.upsertMany([
        makeExperienceNode("issue:1001"),
        makeExperienceNode("issue:1002"),
        makeExperienceNode("pr_review:2001", { type: "pr_review" }),
      ]);

      const edges = buildFixesEdges(prRepo, issueRepo, experienceRepo);
      expect(edges).toHaveLength(2);
    });

    it("should produce distinct edges for different PRs fixing the same issue", () => {
      const issue = makeIssue({ id: 1001, number: 101 });
      const pr1 = makePR({ id: 2001, number: 201, closingIssueReferences: [101] });
      const pr2 = makePR({ id: 2002, number: 202, closingIssueReferences: [101] });

      issueRepo.upsertMany([issue]);
      prRepo.upsertMany([pr1, pr2]);
      experienceRepo.upsertMany([
        makeExperienceNode("issue:1001"),
        makeExperienceNode("pr_review:2001", { type: "pr_review" }),
        makeExperienceNode("pr_review:2002", { type: "pr_review" }),
      ]);

      const edges = buildFixesEdges(prRepo, issueRepo, experienceRepo);
      expect(edges).toHaveLength(2);
      expect(edges[0].sourceNodeId).not.toBe(edges[1].sourceNodeId);
      expect(edges[0].targetNodeId).toBe(edges[1].targetNodeId);
    });
  });

  describe("getExperienceChain", () => {
    it("should return connected nodes and edges", () => {
      const issue = makeIssue({ id: 1001, number: 101 });
      const pr = makePR({ id: 2001, closingIssueReferences: [101] });

      issueRepo.upsertMany([issue]);
      prRepo.upsertMany([pr]);
      experienceRepo.upsertMany([
        makeExperienceNode("issue:1001"),
        makeExperienceNode("pr_review:2001", { type: "pr_review" }),
      ]);

      const edges = buildFixesEdges(prRepo, issueRepo, experienceRepo);
      edgeRepo.upsertMany(edges);

      const chain = getExperienceChain(
        "issue:1001",
        experienceRepo,
        edgeRepo,
      );
      expect(chain.rootId).toBe("issue:1001");
      expect(chain.nodes).toHaveLength(2);
      expect(chain.edges).toHaveLength(1);
      expect(chain.edges[0].edgeType).toBe("fixes");
    });

    it("should return empty chain for orphan node", () => {
      experienceRepo.upsertMany([makeExperienceNode("issue:9999")]);

      const chain = getExperienceChain(
        "issue:9999",
        experienceRepo,
        edgeRepo,
      );
      expect(chain.rootId).toBe("issue:9999");
      expect(chain.nodes).toHaveLength(1);
      expect(chain.edges).toHaveLength(0);
    });

    it("should traverse bidirectionally", () => {
      const issue = makeIssue({ id: 1001, number: 101 });
      const pr = makePR({ id: 2001, closingIssueReferences: [101] });

      issueRepo.upsertMany([issue]);
      prRepo.upsertMany([pr]);
      experienceRepo.upsertMany([
        makeExperienceNode("issue:1001"),
        makeExperienceNode("pr_review:2001", { type: "pr_review" }),
      ]);

      const edges = buildFixesEdges(prRepo, issueRepo, experienceRepo);
      edgeRepo.upsertMany(edges);

      const chainFromPR = getExperienceChain(
        "pr_review:2001",
        experienceRepo,
        edgeRepo,
      );
      expect(chainFromPR.nodes).toHaveLength(2);
      expect(chainFromPR.edges).toHaveLength(1);
    });
  });
});
