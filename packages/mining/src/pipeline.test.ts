import { describe, it, expect, vi, beforeEach } from "vitest";
import { MiningPipeline } from "./pipeline.js";
import {
  CosineThresholdClusterer,
  cosineSimilarity,
} from "./discovery/cosine-clusterer.js";
import { MiningStore } from "./review/mining-store.js";
import { Drafter } from "./drafting/drafter.js";
import { Scorer } from "./drafting/scorer.js";
import { resetCandidateSeq, resetCanonicalSeq } from "./index.js";
import type {
  EmbeddingSearchProvider,
  VectorRecord,
  EmbeddingHit,
  EmbeddingQuery,
} from "./types.js";
import type { NewCandidateInput } from "./drafting/candidate-factory.js";
import type BetterSqlite3 from "better-sqlite3";
import Database from "better-sqlite3";

function v(...xs: number[]): Float32Array {
  return Float32Array.from(xs);
}

// ─── Fake provider for in-memory testing ──────────────────────────

class FakeProvider implements EmbeddingSearchProvider {
  vectors: VectorRecord[] = [];

  setVectors(vectors: VectorRecord[]): void {
    this.vectors = vectors;
  }

  async search(_query: EmbeddingQuery): Promise<EmbeddingHit[]> {
    return [];
  }

  async listVectors(): Promise<VectorRecord[]> {
    return this.vectors;
  }

  async embedText(): Promise<Float32Array> {
    return v(0);
  }
}

// ─── Fake LLM backend ─────────────────────────────────────────────

function makeFakeLlm(response: string) {
  return {
    complete: async () => response,
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe("MiningPipeline", () => {
  let db: BetterSqlite3.Database;
  let store: MiningStore;
  let provider: FakeProvider;
  let drafter: Drafter;
  let scorer: Scorer;

  beforeEach(() => {
    resetCandidateSeq(0);
    resetCanonicalSeq(0);

    // In-memory SQLite
    db = new Database(":memory:");
    store = new MiningStore(db);

    provider = new FakeProvider();
    drafter = new Drafter({ llm: makeFakeLlm("{}") });
    scorer = new Scorer({ threshold: 0.9 });
  });

  it("runs full pipeline and stores results", async () => {
    // Set up vectors: 3 similar (cluster A) + 2 similar (cluster B)
    // Use realistic vector IDs: Qdrant point id is a hash, payload.node_id is logical id.
    provider.setVectors([
      { id: "cn-a1", vector: v(1, 0, 0), payload: { node_id: "github-issue/101", title: "Z-fighting on terrain" } },
      { id: "cn-a2", vector: v(0.99, 0.1, 0), payload: { node_id: "github-issue/102", title: "Polygon flickering" } },
      { id: "cn-a3", vector: v(0.98, 0.12, 0), payload: { node_id: "github-issue/103", title: "Depth fighting" } },
      { id: "cn-b1", vector: v(0, 1, 0), payload: { node_id: "github-issue/201", title: "Shader compile fail" } },
      { id: "cn-b2", vector: v(0.1, 0.99, 0), payload: { node_id: "github-issue/202", title: "GLSL error" } },
    ]);

    const pipeline = new MiningPipeline({
      provider,
      clustererConfig: { threshold: 0.9, minClusterSize: 2, maxClusterSize: 10 },
      drafter,
      scorer,
      store,
      db,
      intentFilter: "unknown", // skip classification for pipeline tests
    });

    const result = await pipeline.run();

    // Should have 2 clusters
    expect(result.clusters.length).toBe(2);
    // Each cluster has correct member count
    const sizes = result.clusters.map((c) => c.memberIds.length).sort();
    expect(sizes).toEqual([2, 3]);

    // Canonical problems match clusters
    expect(result.canonicalProblems.length).toBe(2);

    // representativeIssueId is resolved from payload.node_id (P1-4 regression)
    const repIds = result.canonicalProblems
      .map((cp) => cp.representativeIssueId)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(repIds.some((id) => id != null)).toBe(true);

    // Candidates created from drafts
    expect(result.candidates.length).toBe(2);
    expect(result.candidates[0]!.status).toBe("pending");

    // Stats
    expect(result.stats.totalVectors).toBe(5);
    expect(result.stats.totalClusters).toBe(2);
    expect(result.stats.durationMs).toBeGreaterThan(0);

    // Store has data
    const storedCandidates = store.listCandidates();
    expect(storedCandidates.length).toBe(2);
  });

  it("throws when no vectors available", async () => {
    provider.setVectors([]);

    const pipeline = new MiningPipeline({
      provider,
      clustererConfig: { threshold: 0.9, minClusterSize: 2, maxClusterSize: 10 },
      drafter,
      scorer,
      store,
      db,
      intentFilter: "unknown",
    });

    await expect(pipeline.run()).rejects.toThrow("No vectors found");
  });

  it("handles single cluster with minimal members", async () => {
    provider.setVectors([
      { id: "cn-x1", vector: v(1, 0, 0), payload: { node_id: "github-issue/1", title: "One issue" } },
      { id: "cn-x2", vector: v(1, 0.01, 0), payload: { node_id: "github-issue/2", title: "Another issue" } },
    ]);

    const pipeline = new MiningPipeline({
      provider,
      clustererConfig: { threshold: 0.9, minClusterSize: 2, maxClusterSize: 10 },
      drafter,
      scorer,
      store,
      db,
      intentFilter: "unknown",
    });

    const result = await pipeline.run();
    expect(result.clusters.length).toBe(1);
    expect(result.candidates.length).toBe(1);
  });

  it("drops noise points below minClusterSize", async () => {
    provider.setVectors([
      { id: "cn-p1", vector: v(1, 0, 0), payload: { node_id: "github-issue/10", title: "A" } },
      { id: "cn-p2", vector: v(0.99, 0.1, 0), payload: { node_id: "github-issue/11", title: "B" } },
      { id: "cn-p3", vector: v(0, 0, 1), payload: { node_id: "github-issue/99", title: "Noise" } },
    ]);

    const pipeline = new MiningPipeline({
      provider,
      clustererConfig: { threshold: 0.9, minClusterSize: 2, maxClusterSize: 10 },
      drafter,
      scorer,
      store,
      db,
      intentFilter: "unknown",
    });

    const result = await pipeline.run();
    expect(result.clusters.length).toBe(1);
    expect(result.candidates.length).toBe(1);
  });

  it("passes member summaries to drafter", async () => {
    const capturedPrompts: string[] = [];
    const trackingLlm = {
      complete: async (prompt: string) => {
        capturedPrompts.push(prompt);
        return JSON.stringify({
          draftAlias: ["test"],
          draftSymptoms: ["test"],
          draftSymbols: ["Test"],
          draftCategory: "debug",
        });
      },
    };

    provider.setVectors([
      { id: "cn-m42", vector: v(1, 0, 0), payload: { node_id: "github-issue/42", title: "Real issue title" } },
      { id: "cn-m43", vector: v(0.99, 0.1, 0), payload: { node_id: "github-issue/43", title: "Another issue" } },
    ]);

    const trackingDrafter = new Drafter({ llm: trackingLlm });

    const pipeline = new MiningPipeline({
      provider,
      clustererConfig: { threshold: 0.9, minClusterSize: 2, maxClusterSize: 10 },
      drafter: trackingDrafter,
      scorer,
      store,
      db,
      intentFilter: "unknown",
    });

    await pipeline.run();

    expect(capturedPrompts.length).toBe(1);
    expect(capturedPrompts[0]).toContain("Real issue title");
  });

  it("throws clear error when canonical problem is missing for a cluster (P1-2 regression)", async () => {
    const canonicalModule = await import("./discovery/canonical-problem.js");
    const spy = vi.spyOn(canonicalModule, "buildCanonicalProblems").mockReturnValue([]);

    provider.setVectors([
      { id: "cn-orphan1", vector: v(1, 0, 0), payload: { node_id: "github-issue/700", title: "Orphan A" } },
      { id: "cn-orphan2", vector: v(0.99, 0.1, 0), payload: { node_id: "github-issue/701", title: "Orphan B" } },
    ]);

    const pipeline = new MiningPipeline({
      provider,
      clustererConfig: { threshold: 0.9, minClusterSize: 2, maxClusterSize: 10 },
      drafter,
      scorer,
      store,
      db,
      intentFilter: "unknown",
    });

    await expect(pipeline.run()).rejects.toThrow(/Pipeline invariant violated/);
    spy.mockRestore();
  });
});
