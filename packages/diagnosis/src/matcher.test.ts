import { describe, it, expect, beforeAll } from "vitest";
import { normalizeQuery, matchProblemPatterns } from "./matcher.js";
import { loadProblemPatterns } from "./knowledge-loader.js";
import type { ProblemPattern } from "@cesium-nexus/shared";

describe("normalizeQuery", () => {
  it("should lowercase and split on whitespace", () => {
    expect(normalizeQuery("Hello World")).toEqual(["hello", "world"]);
  });

  it("should handle special characters", () => {
    expect(normalizeQuery("why does Polygon flicker?")).toEqual([
      "polygon",
      "flicker",
    ]);
  });

  it("should preserve hyphens in tokens", () => {
    expect(normalizeQuery("z-fighting issue")).toEqual([
      "z-fighting",
      "issue",
    ]);
  });

  it("should return empty array for empty input", () => {
    expect(normalizeQuery("")).toEqual([]);
  });
});

describe("matchProblemPatterns", () => {
  let patterns: ProblemPattern[];

  beforeAll(async () => {
    patterns = await loadProblemPatterns();
  });

  it("should match 'polygon flickering' to z_fighting", () => {
    const results = matchProblemPatterns("polygon flickering", patterns);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].pattern.id).toBe("z_fighting");
  });

  it("should match 'z-fighting on overlapping geometry' to z_fighting", () => {
    const results = matchProblemPatterns(
      "z-fighting on overlapping geometry",
      patterns,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].pattern.id).toBe("z_fighting");
  });

  it("should match 'primitive performance slow' to primitive_performance", () => {
    const results = matchProblemPatterns(
      "primitive performance slow",
      patterns,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].pattern.id).toBe("primitive_performance");
  });

  it("should match 'label disappears' to label_visibility", () => {
    const results = matchProblemPatterns("label disappears", patterns);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].pattern.id).toBe("label_visibility");
  });

  it("should match '3D Tiles jitter' to tiles_jitter", () => {
    const results = matchProblemPatterns("3D Tiles jitter", patterns);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].pattern.id).toBe("tiles_jitter");
  });

  it("should match 'shader compile error' to shader_compile_error", () => {
    const results = matchProblemPatterns("shader compile error", patterns);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].pattern.id).toBe("shader_compile_error");
  });

  it("should return empty for irrelevant input", () => {
    const results = matchProblemPatterns("what is the weather today", patterns);
    expect(results).toEqual([]);
  });

  it("should respect limit parameter", () => {
    const results = matchProblemPatterns(
      "polygon flickering depth precision",
      patterns,
      1,
    );
    expect(results.length).toBe(1);
  });

  it("should sort results by score descending", () => {
    const results = matchProblemPatterns(
      "polygon flickering depth precision",
      patterns,
    );
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("should include matchedKeywords explaining hits", () => {
    const results = matchProblemPatterns("polygon flickering", patterns);
    expect(results[0].matchedKeywords.length).toBeGreaterThan(0);
  });

  it("should return empty for weak query 'camera' (symbol-only match)", () => {
    const results = matchProblemPatterns("camera", patterns);
    expect(results).toEqual([]);
  });

  it("should not return multiple diagnoses for generic word 'tiles'", () => {
    const results = matchProblemPatterns("tiles", patterns);
    for (const r of results) {
      const hasStrong = r.matchedKeywords.some(
        (k) => k.startsWith("alias:") || k.startsWith("keyword:") || k.startsWith("symptom:"),
      );
      expect(hasStrong).toBe(true);
    }
  });

  it("should still match strong symptom queries after threshold fix", () => {
    const results = matchProblemPatterns("scene.pick returns undefined", patterns);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].pattern.id).toBe("picking_failure");
  });
});
