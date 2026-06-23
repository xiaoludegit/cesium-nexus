import { describe, it, expect } from "vitest";
import {
  CosineThresholdClusterer,
  cosineSimilarity,
} from "./cosine-clusterer.js";
import type { EmbeddingSearchProvider, VectorRecord } from "../types.js";

function v(...xs: number[]): Float32Array {
  return Float32Array.from(xs);
}

class FakeProvider implements EmbeddingSearchProvider {
  async embedText(): Promise<Float32Array> {
    return v(0);
  }
  async search() {
    return [];
  }
  async listVectors() {
    return [];
  }
}

function makeRecord(id: string, vector: Float32Array): VectorRecord {
  return { id, vector, payload: {} };
}

describe("cosineSimilarity", () => {
  it("returns 1 for identical normalized vectors", () => {
    expect(cosineSimilarity(v(1, 0, 0), v(1, 0, 0))).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity(v(1, 0), v(0, 1))).toBeCloseTo(0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity(v(1, 0), v(-1, 0))).toBeCloseTo(-1);
  });

  it("returns 0 for zero-length inputs", () => {
    expect(cosineSimilarity(v(0, 0), v(1, 0))).toBe(0);
  });

  it("returns 0 for mismatched lengths", () => {
    expect(cosineSimilarity(v(1, 0), v(1, 0, 0))).toBe(0);
  });
});

describe("CosineThresholdClusterer", () => {
  it("groups near-duplicate vectors together", async () => {
    const clusterer = new CosineThresholdClusterer({
      provider: new FakeProvider(),
      config: { threshold: 0.95, minClusterSize: 2, maxClusterSize: 10 },
    });

    const vectors: VectorRecord[] = [
      makeRecord("a", v(1, 0, 0)),
      makeRecord("b", v(0.99, 0.05, 0)),
      makeRecord("c", v(0.98, 0.1, 0)),
      makeRecord("d", v(0, 1, 0)),
      makeRecord("e", v(0.05, 0.99, 0)),
    ];

    const clusters = await clusterer.cluster(vectors);

    expect(clusters.length).toBe(2);
    const idSets = clusters.map((c) => c.memberIds.slice().sort()).sort();
    expect(idSets).toEqual([
      ["a", "b", "c"],
      ["d", "e"],
    ]);
  });

  it("drops singleton noise points when below minClusterSize", async () => {
    const clusterer = new CosineThresholdClusterer({
      provider: new FakeProvider(),
      config: { threshold: 0.9, minClusterSize: 3, maxClusterSize: 10 },
    });

    const vectors: VectorRecord[] = [
      makeRecord("a", v(1, 0)),
      makeRecord("b", v(0.99, 0.05)),
      makeRecord("noise", v(0, 1)),
    ];

    const clusters = await clusterer.cluster(vectors);

    expect(clusters.length).toBe(0);
  });

  it("enforces maxClusterSize by spilling extra members", async () => {
    const clusterer = new CosineThresholdClusterer({
      provider: new FakeProvider(),
      config: { threshold: 0.9, minClusterSize: 2, maxClusterSize: 2 },
    });

    const vectors: VectorRecord[] = [
      makeRecord("a", v(1, 0)),
      makeRecord("b", v(0.99, 0.05)),
      makeRecord("c", v(0.98, 0.1)),
    ];

    const clusters = await clusterer.cluster(vectors);

    expect(clusters.length).toBe(1);
    expect(clusters[0]!.memberIds.length).toBe(2);
  });

  it("returns empty for empty input", async () => {
    const clusterer = new CosineThresholdClusterer({
      provider: new FakeProvider(),
      config: { threshold: 0.9, minClusterSize: 2, maxClusterSize: 10 },
    });
    expect(await clusterer.cluster([])).toEqual([]);
  });

  it("each cluster has a centroid and pairwise score", async () => {
    const clusterer = new CosineThresholdClusterer({
      provider: new FakeProvider(),
      config: { threshold: 0.9, minClusterSize: 2, maxClusterSize: 10 },
    });

    const vectors: VectorRecord[] = [
      makeRecord("a", v(1, 0, 0)),
      makeRecord("b", v(0.99, 0.05, 0)),
    ];

    const clusters = await clusterer.cluster(vectors);
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.centroid).toBeInstanceOf(Float32Array);
    expect(clusters[0]!.centroid!.length).toBe(3);
    expect(clusters[0]!.score).toBeGreaterThan(0.9);
  });
});
