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
    const Database = require("better-sqlite3");
    db = new Database(":memory:");
    store = new MiningStore(db);

    provider = new FakeProvider();
    drafter = new Drafter({ llm: makeFakeLlm("{}") });
    scorer = new Scorer({ threshold: 0.9 });
  });

  it("runs full pipeline and stores results", async () => {
    // Set up vectors: 3 similar (cluster A) + 2 similar (cluster B)
    provider.setVectors([
      { id: "issue:1", vector: v(1, 0, 0), payload: { title: "Z-fighting on terrain" } },
      { id: "issue:2", vector: v(0.99, 0.1, 0), payload: { title: "Polygon flickering" } },
      { id: "issue:3", vector: v(0.98, 0.12, 0), payload: { title: "Depth fighting" } },
      { id: "issue:4", vector: v(0, 1, 0), payload: { title: "Shader compile fail" } },
      { id: "issue:5", vector: v(0.1, 0.99, 0), payload: { title: "GLSL error" } },
    ]);

    const pipeline = new MiningPipeline({
      provider,
      clustererConfig: { threshold: 0.9, minClusterSize: 2, maxClusterSize: 10 },
      drafter,
      scorer,
      store,
      db,
    });

    const result = await pipeline.run();

    // Should have 2 clusters
    expect(result.clusters.length).toBe(2);
    // Each cluster has correct member count
    const sizes = result.clusters.map((c) => c.memberIds.length).sort();
    expect(sizes).toEqual([2, 3]);

    // Canonical problems match clusters
    expect(result.canonicalProblems.length).toBe(2);

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
    });

    await expect(pipeline.run()).rejects.toThrow("No vectors found");
  });

  it("handles single cluster with minimal members", async () => {
    provider.setVectors([
      { id: "issue:1", vector: v(1, 0, 0), payload: { title: "One issue" } },
      { id: "issue:2", vector: v(1, 0.01, 0), payload: { title: "Another issue" } },
    ]);

    const pipeline = new MiningPipeline({
      provider,
      clustererConfig: { threshold: 0.9, minClusterSize: 2, maxClusterSize: 10 },
      drafter,
      scorer,
      store,
      db,
    });

    const result = await pipeline.run();
    expect(result.clusters.length).toBe(1);
    expect(result.candidates.length).toBe(1);
  });

  it("drops noise points below minClusterSize", async () => {
    provider.setVectors([
      { id: "issue:1", vector: v(1, 0, 0), payload: { title: "A" } },
      { id: "issue:2", vector: v(0.99, 0.1, 0), payload: { title: "B" } },
      { id: "issue:3", vector: v(0, 0, 1), payload: { title: "Noise" } },
    ]);

    const pipeline = new MiningPipeline({
      provider,
      clustererConfig: { threshold: 0.9, minClusterSize: 2, maxClusterSize: 10 },
      drafter,
      scorer,
      store,
      db,
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
      { id: "issue:42", vector: v(1, 0, 0), payload: { title: "Real issue title" } },
      { id: "issue:43", vector: v(0.99, 0.1, 0), payload: { title: "Another issue" } },
    ]);

    const trackingDrafter = new Drafter({ llm: trackingLlm });

    const pipeline = new MiningPipeline({
      provider,
      clustererConfig: { threshold: 0.9, minClusterSize: 2, maxClusterSize: 10 },
      drafter: trackingDrafter,
      scorer,
      store,
      db,
    });

    await pipeline.run();

    expect(capturedPrompts.length).toBe(1);
    expect(capturedPrompts[0]).toContain("Real issue title");
  });
});
