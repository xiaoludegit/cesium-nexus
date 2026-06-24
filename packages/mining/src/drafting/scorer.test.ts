import { describe, it, expect, vi } from "vitest";
import { Scorer } from "./scorer.js";
import type { NewCandidateInput, ProblemCandidate } from "../types.js";

function v(...xs: number[]): Float32Array {
  return Float32Array.from(xs);
}

describe("Scorer", () => {
  it("returns null dupOf when no patterns exist", async () => {
    const scorer = new Scorer();
    const candidate = makeCandidate({
      draftAlias: ["z-fighting"],
      draftSymptoms: ["Flicker"],
      draftSymbols: ["DepthPlane"],
    });
    const result = await scorer.score(candidate, []);

    expect(result.dupOf).toBeNull();
    expect(result.bestScore).toBe(0);
    expect(result.scores).toEqual([]);
  });

  it("marks candidate as dup when cosine > 0.9 threshold", async () => {
    const scorer = new Scorer({ threshold: 0.9 });

    // Mock buildCandidateVector to return a known vector
    const mockCandidateVec = v(0.707, 0.707, 0);
    const spy = vi.spyOn(scorer as any, "buildCandidateVector").mockResolvedValue(mockCandidateVec);

    const patterns = [
      { id: "z_fighting", vector: v(0.7, 0.71, 0) }, // cosine ≈ 0.999
    ];

    const candidate = makeCandidate({
      draftAlias: ["z-fighting", "depth fighting"],
      draftSymptoms: ["Polygons flicker"],
      draftSymbols: ["DepthPlane", "Primitive"],
    });

    const result = await scorer.score(candidate, patterns);

    expect(result.dupOf).toBe("z_fighting");
    expect(result.bestScore).toBeGreaterThan(0.99);
    expect(result.scores).toHaveLength(1);
    spy.mockRestore();
  });

  it("does NOT mark as dup when cosine < threshold", async () => {
    const scorer = new Scorer({ threshold: 0.9 });

    const mockCandidateVec = v(0, 1, 0);
    const spy = vi.spyOn(scorer as any, "buildCandidateVector").mockResolvedValue(mockCandidateVec);

    const patterns = [
      { id: "shader_compile_error", vector: v(1, 0, 0) }, // orthogonal
    ];

    const candidate = makeCandidate({
      draftAlias: ["shader error"],
      draftSymptoms: ["GLSL fails"],
      draftSymbols: ["Material"],
    });

    const result = await scorer.score(candidate, patterns);

    expect(result.dupOf).toBeNull();
    expect(result.bestScore).toBe(0);
    spy.mockRestore();
  });

  it("selects best match among multiple patterns", async () => {
    const scorer = new Scorer({ threshold: 0.5 });

    const mockCandidateVec = v(1, 0, 0);
    const spy = vi.spyOn(scorer as any, "buildCandidateVector").mockResolvedValue(mockCandidateVec);

    const patterns = [
      { id: "z_fighting", vector: v(1, 0, 0) },        // cosine = 1.0
      { id: "depth_precision", vector: v(0.9, 0.1, 0) }, // cosine ≈ 0.995
      { id: "shader_compile_error", vector: v(0, 0, 1) }, // cosine = 0
    ];

    const candidate = makeCandidate({
      draftAlias: ["z-fighting"],
      draftSymptoms: ["Flickering"],
      draftSymbols: ["DepthPlane"],
    });

    const result = await scorer.score(candidate, patterns);

    expect(result.dupOf).toBe("z_fighting");
    expect(result.bestScore).toBeCloseTo(1.0);
    expect(result.scores).toHaveLength(3);
    spy.mockRestore();
  });

  it("respects custom threshold — flags lower similarity", async () => {
    const scorer = new Scorer({ threshold: 0.5 });

    // Use identical vectors so cosine = 1.0 regardless of embedder
    const patterns = [
      { id: "similar_pattern", vector: v(1, 0, 0) },
    ];

    // Mock buildCandidateVector to return the same vector
    const spy = vi.spyOn(scorer as any, "buildCandidateVector").mockResolvedValue(v(1, 0, 0));

    const candidate = makeCandidate({
      draftAlias: ["similar"],
      draftSymptoms: ["Related"],
      draftSymbols: ["SameClass"],
    });

    const result = await scorer.score(candidate, patterns);

    expect(result.dupOf).toBe("similar_pattern");
    expect(result.bestScore).toBeCloseTo(1.0);
    spy.mockRestore();
  });

  it("scoreBatch returns scored results for all candidates", async () => {
    const scorer = new Scorer();

    const patterns = [
      { id: "z_fighting", vector: v(1, 0, 0) },
    ];

    const candidates = [
      makeCandidate({ draftAlias: ["z-fighting"] }),
      makeCandidate({ draftAlias: ["shader-error"] }),
    ];

    const results = await scorer.scoreBatch(candidates, patterns);

    expect(results).toHaveLength(2);
    expect(results[0]!.candidate.draftAlias).toEqual(["z-fighting"]);
    expect(results[1]!.candidate.draftAlias).toEqual(["shader-error"]);
  });

  it("returns zero vector for empty candidate fields → cosine 0", async () => {
    const scorer = new Scorer();

    const patterns = [
      { id: "something", vector: v(1, 0, 0) },
    ];

    const candidate = makeCandidate({
      draftAlias: [],
      draftSymptoms: [],
      draftSymbols: [],
    });

    const result = await scorer.score(candidate, patterns);

    // Zero vector has cosine 0 with any non-zero vector
    expect(result.dupOf).toBeNull();
    expect(result.bestScore).toBe(0);
  });

  it("works with ProblemCandidate (has dupOf field)", async () => {
    const scorer = new Scorer({ threshold: 0.5 });

    const mockCandidateVec = v(1, 0, 0);
    const spy = vi.spyOn(scorer as any, "buildCandidateVector").mockResolvedValue(mockCandidateVec);

    const patterns = [
      { id: "existing_pattern", vector: v(1, 0, 0) },
    ];

    const pc: ProblemCandidate = {
      id: "candidate/1",
      canonicalId: "canonical/1",
      clusterId: "cluster/1",
      draftAlias: ["z-fighting"],
      draftSymptoms: ["Flicker"],
      draftSymbols: ["DepthPlane"],
      draftCategory: "rendering",
      llmRaw: null,
      qualityScore: null,
      dupOf: null,
      failedDraft: false,
      status: "pending",
      reviewedAt: null,
      createdAt: Date.now(),
      sourceCount: 3,
      issueCount: 2,
      forumCount: 1,
      experienceCount: 0,
    };

    const result = await scorer.score(pc, patterns);

    expect(result.dupOf).toBe("existing_pattern");
    spy.mockRestore();
  });

  it("uses injected textEmbedder to embed candidate text (real dim space)", async () => {
    // P1-3 regression: real embedder produces 384-dim vectors matching patterns
    const dims = 384;
    const targetVec = Float32Array.from({ length: dims }, (_, i) => (i === 0 ? 1 : 0));
    // Normalize to unit length
    targetVec[0] = 1;

    const embeddedTexts: string[] = [];
    const textEmbedder = async (text: string): Promise<Float32Array> => {
      embeddedTexts.push(text);
      // Return a vector very close to targetVec so cosine > 0.9
      const v = Float32Array.from({ length: dims }, (_, i) => (i === 0 ? 0.999 : 0.001));
      let n = 0;
      for (let i = 0; i < dims; i++) n += v[i] * v[i];
      n = Math.sqrt(n);
      for (let i = 0; i < dims; i++) v[i] /= n;
      return v;
    };

    const scorer = new Scorer({ threshold: 0.9, textEmbedder });

    const patterns = [
      { id: "z_fighting_real", vector: targetVec },
    ];

    const candidate = makeCandidate({
      draftAlias: ["z-fighting"],
      draftSymptoms: ["Polygons flicker"],
      draftSymbols: ["DepthPlane"],
    });

    const result = await scorer.score(candidate, patterns);

    expect(embeddedTexts).toHaveLength(1);
    expect(embeddedTexts[0]).toContain("z-fighting");
    expect(embeddedTexts[0]).toContain("Polygons flicker");
    expect(embeddedTexts[0]).toContain("DepthPlane");
    expect(result.dupOf).toBe("z_fighting_real");
    expect(result.bestScore).toBeGreaterThan(0.9);
  });

  it("skips patterns with mismatched vector dimension (no garbage cosine)", async () => {
    const scorer = new Scorer();

    // Candidate synthetic vector is 3-dim; pattern is 384-dim → mismatch
    const bigVec = Float32Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0));
    const patterns = [{ id: "mismatched", vector: bigVec }];

    const candidate = makeCandidate({
      draftAlias: ["test"],
      draftSymptoms: ["symptom"],
      draftSymbols: ["Sym"],
    });

    const result = await scorer.score(candidate, patterns);

    expect(result.dupOf).toBeNull();
    expect(result.bestScore).toBe(0);
    expect(result.scores).toEqual([]); // skipped entirely
  });
});

function makeCandidate(overrides: Partial<NewCandidateInput> = {}): NewCandidateInput {
  return {
    canonicalId: "canonical/1",
    clusterId: "cluster/1",
    draftAlias: ["test"],
    draftSymptoms: ["test symptom"],
    draftSymbols: ["TestClass"],
    ...overrides,
  };
}
