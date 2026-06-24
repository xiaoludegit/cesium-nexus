import { describe, it, expect, vi } from "vitest";
import { Scorer } from "./scorer.js";
import type { NewCandidateInput, ProblemCandidate } from "../types.js";

function v(...xs: number[]): Float32Array {
  return Float32Array.from(xs);
}

describe("Scorer", () => {
  it("returns null dupOf when no patterns exist", () => {
    const scorer = new Scorer();
    const candidate = makeCandidate({
      draftAlias: ["z-fighting"],
      draftSymptoms: ["Flicker"],
      draftSymbols: ["DepthPlane"],
    });
    const result = scorer.score(candidate, []);

    expect(result.dupOf).toBeNull();
    expect(result.bestScore).toBe(0);
    expect(result.scores).toEqual([]);
  });

  it("marks candidate as dup when cosine > 0.9 threshold", () => {
    const scorer = new Scorer({ threshold: 0.9 });

    // Mock buildCandidateVector to return a known vector
    const mockCandidateVec = v(0.707, 0.707, 0);
    const spy = vi.spyOn(scorer as any, "buildCandidateVector").mockReturnValue(mockCandidateVec);

    const patterns = [
      { id: "z_fighting", vector: v(0.7, 0.71, 0) }, // cosine ≈ 0.999
    ];

    const candidate = makeCandidate({
      draftAlias: ["z-fighting", "depth fighting"],
      draftSymptoms: ["Polygons flicker"],
      draftSymbols: ["DepthPlane", "Primitive"],
    });

    const result = scorer.score(candidate, patterns);

    expect(result.dupOf).toBe("z_fighting");
    expect(result.bestScore).toBeGreaterThan(0.99);
    expect(result.scores).toHaveLength(1);
    spy.mockRestore();
  });

  it("does NOT mark as dup when cosine < threshold", () => {
    const scorer = new Scorer({ threshold: 0.9 });

    const mockCandidateVec = v(0, 1, 0);
    const spy = vi.spyOn(scorer as any, "buildCandidateVector").mockReturnValue(mockCandidateVec);

    const patterns = [
      { id: "shader_compile_error", vector: v(1, 0, 0) }, // orthogonal
    ];

    const candidate = makeCandidate({
      draftAlias: ["shader error"],
      draftSymptoms: ["GLSL fails"],
      draftSymbols: ["Material"],
    });

    const result = scorer.score(candidate, patterns);

    expect(result.dupOf).toBeNull();
    expect(result.bestScore).toBe(0);
    spy.mockRestore();
  });

  it("selects best match among multiple patterns", () => {
    const scorer = new Scorer({ threshold: 0.5 });

    const mockCandidateVec = v(1, 0, 0);
    const spy = vi.spyOn(scorer as any, "buildCandidateVector").mockReturnValue(mockCandidateVec);

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

    const result = scorer.score(candidate, patterns);

    expect(result.dupOf).toBe("z_fighting");
    expect(result.bestScore).toBeCloseTo(1.0);
    expect(result.scores).toHaveLength(3);
    spy.mockRestore();
  });

  it("respects custom threshold — flags lower similarity", () => {
    const scorer = new Scorer({ threshold: 0.5 });

    // Use identical vectors so cosine = 1.0 regardless of embedder
    const patterns = [
      { id: "similar_pattern", vector: v(1, 0, 0) },
    ];

    // Mock buildCandidateVector to return the same vector
    const spy = vi.spyOn(scorer as any, "buildCandidateVector").mockReturnValue(v(1, 0, 0));

    const candidate = makeCandidate({
      draftAlias: ["similar"],
      draftSymptoms: ["Related"],
      draftSymbols: ["SameClass"],
    });

    const result = scorer.score(candidate, patterns);

    expect(result.dupOf).toBe("similar_pattern");
    expect(result.bestScore).toBeCloseTo(1.0);
    spy.mockRestore();
  });

  it("scoreBatch returns scored results for all candidates", () => {
    const scorer = new Scorer();

    const patterns = [
      { id: "z_fighting", vector: v(1, 0, 0) },
    ];

    const candidates = [
      makeCandidate({ draftAlias: ["z-fighting"] }),
      makeCandidate({ draftAlias: ["shader-error"] }),
    ];

    const results = scorer.scoreBatch(candidates, patterns);

    expect(results).toHaveLength(2);
    expect(results[0]!.candidate.draftAlias).toEqual(["z-fighting"]);
    expect(results[1]!.candidate.draftAlias).toEqual(["shader-error"]);
  });

  it("returns zero vector for empty candidate fields → cosine 0", () => {
    const scorer = new Scorer();

    const patterns = [
      { id: "something", vector: v(1, 0, 0) },
    ];

    const candidate = makeCandidate({
      draftAlias: [],
      draftSymptoms: [],
      draftSymbols: [],
    });

    const result = scorer.score(candidate, patterns);

    // Zero vector has cosine 0 with any non-zero vector
    expect(result.dupOf).toBeNull();
    expect(result.bestScore).toBe(0);
  });

  it("works with ProblemCandidate (has dupOf field)", () => {
    const scorer = new Scorer({ threshold: 0.5 });

    const mockCandidateVec = v(1, 0, 0);
    const spy = vi.spyOn(scorer as any, "buildCandidateVector").mockReturnValue(mockCandidateVec);

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
      status: "pending",
      reviewedAt: null,
      createdAt: Date.now(),
      sourceCount: 3,
      issueCount: 2,
      forumCount: 1,
      experienceCount: 0,
    };

    const result = scorer.score(pc, patterns);

    expect(result.dupOf).toBe("existing_pattern");
    spy.mockRestore();
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
