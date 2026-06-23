import { describe, it, expect, beforeEach } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { MiningStore } from "./mining-store.js";
import type { CanonicalProblem, ProblemCandidate } from "../types.js";

function makeCanonical(id: string, overrides: Partial<CanonicalProblem> = {}): CanonicalProblem {
  return {
    id,
    title: "Z-Fighting Cluster",
    aliases: ["z-fighting", "depth fighting"],
    representativeIssueId: 1001,
    clusterIds: ["cluster/1"],
    experienceIds: ["e1", "e2"],
    confidence: 0.75,
    status: "candidate",
    createdAt: Date.now(),
    reviewedAt: null,
    ...overrides,
  };
}

function makeCandidate(
  id: string,
  canonicalId: string,
  overrides: Partial<ProblemCandidate> = {},
): ProblemCandidate {
  return {
    id,
    canonicalId,
    clusterId: "cluster/1",
    draftAlias: ["z-fighting"],
    draftSymptoms: ["Polygons flicker when viewed from afar"],
    draftSymbols: ["DepthPlane"],
    draftCategory: "rendering",
    llmRaw: null,
    qualityScore: 0.8,
    dupOf: null,
    status: "pending",
    reviewedAt: null,
    createdAt: Date.now(),
    sourceCount: 5,
    issueCount: 3,
    forumCount: 1,
    experienceCount: 1,
    ...overrides,
  };
}

describe("MiningStore", () => {
  let db: BetterSqlite3.Database;
  let store: MiningStore;

  beforeEach(() => {
    db = new BetterSqlite3(":memory:");
    store = new MiningStore(db);
  });

  it("initializes schema idempotently", () => {
    // calling constructor twice should not throw
    new MiningStore(db);
    new MiningStore(db);
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_problem' OR name LIKE '%_candidate'`,
      )
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name).sort();
    expect(names).toContain("canonical_problem");
    expect(names).toContain("problem_candidate");
  });

  it("upserts and retrieves canonical problems", () => {
    const p = makeCanonical("canonical/1");
    store.upsertCanonical(p);

    const got = store.getCanonical("canonical/1");
    expect(got).not.toBeNull();
    expect(got!.title).toBe("Z-Fighting Cluster");
    expect(got!.aliases).toEqual(["z-fighting", "depth fighting"]);
    expect(got!.clusterIds).toEqual(["cluster/1"]);
    expect(got!.representativeIssueId).toBe(1001);
  });

  it("upsertCanonical is idempotent (replace on conflict)", () => {
    store.upsertCanonical(makeCanonical("canonical/1", { title: "A" }));
    store.upsertCanonical(makeCanonical("canonical/1", { title: "B" }));

    const list = store.listCanonical();
    expect(list.length).toBe(1);
    expect(list[0]!.title).toBe("B");
  });

  it("upsertCanonicalMany wraps in a transaction", () => {
    store.upsertCanonicalMany([
      makeCanonical("canonical/1"),
      makeCanonical("canonical/2"),
      makeCanonical("canonical/3"),
    ]);
    expect(store.listCanonical().length).toBe(3);
  });

  it("listCanonical filters by status", () => {
    store.upsertCanonical(makeCanonical("canonical/1", { status: "candidate" }));
    store.upsertCanonical(makeCanonical("canonical/2", { status: "reviewed" }));
    store.upsertCanonical(makeCanonical("canonical/3", { status: "accepted" }));

    expect(store.listCanonical("candidate").length).toBe(1);
    expect(store.listCanonical("reviewed").length).toBe(1);
    expect(store.listCanonical("accepted").length).toBe(1);
    expect(store.listCanonical().length).toBe(3);
  });

  it("setCanonicalStatus updates status and reviewed_at", () => {
    store.upsertCanonical(makeCanonical("canonical/1"));
    const before = Date.now();
    store.setCanonicalStatus("canonical/1", "reviewed");
    const after = Date.now();

    const got = store.getCanonical("canonical/1");
    expect(got!.status).toBe("reviewed");
    expect(got!.reviewedAt).toBeGreaterThanOrEqual(before);
    expect(got!.reviewedAt).toBeLessThanOrEqual(after);
  });

  it("upserts and retrieves candidates with source stats", () => {
    store.upsertCanonical(makeCanonical("canonical/1"));
    const c = makeCandidate("candidate/1", "canonical/1");
    store.upsertCandidate(c);

    const got = store.getCandidate("candidate/1");
    expect(got).not.toBeNull();
    expect(got!.draftSymbols).toEqual(["DepthPlane"]);
    expect(got!.sourceCount).toBe(5);
    expect(got!.issueCount).toBe(3);
    expect(got!.forumCount).toBe(1);
    expect(got!.experienceCount).toBe(1);
  });

  it("setStatus transitions pending → approved / rejected", () => {
    store.upsertCanonical(makeCanonical("canonical/1"));
    store.upsertCandidate(makeCandidate("candidate/1", "canonical/1"));
    store.upsertCandidate(makeCandidate("candidate/2", "canonical/1"));

    store.setStatus("candidate/1", "approved");
    store.setStatus("candidate/2", "rejected");

    expect(store.listCandidates("pending").length).toBe(0);
    expect(store.listCandidates("approved").length).toBe(1);
    expect(store.listCandidates("rejected").length).toBe(1);
    expect(store.getCandidate("candidate/1")!.reviewedAt).not.toBeNull();
  });

  it("stats returns counts grouped by status", () => {
    store.upsertCanonical(makeCanonical("canonical/1", { status: "candidate" }));
    store.upsertCanonical(makeCanonical("canonical/2", { status: "accepted" }));
    store.upsertCandidate(makeCandidate("candidate/1", "canonical/1", { status: "pending" }));
    store.upsertCandidate(makeCandidate("candidate/2", "canonical/1", { status: "approved" }));
    store.upsertCandidate(makeCandidate("candidate/3", "canonical/2", { status: "approved" }));
    store.upsertCandidate(makeCandidate("candidate/4", "canonical/2", { status: "rejected" }));

    const s = store.stats();
    expect(s.canonical).toEqual({ candidate: 1, reviewed: 0, accepted: 1 });
    expect(s.candidates).toEqual({ pending: 1, approved: 2, rejected: 1 });
  });

  it("getCandidate returns null for missing id", () => {
    expect(store.getCandidate("nope")).toBeNull();
  });

  it("getCanonical returns null for missing id", () => {
    expect(store.getCanonical("nope")).toBeNull();
  });
});
