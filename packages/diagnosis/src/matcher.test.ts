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

  describe("hybrid matching (vector scores)", () => {
    it("should add vector score to total score", () => {
      const withoutVector = matchProblemPatterns("flickering polygon", patterns);
      const withVector = matchProblemPatterns("flickering polygon", patterns, undefined, {
        z_fighting: 0.9,
      });

      const baseScore = withoutVector.find((r) => r.pattern.id === "z_fighting");
      const hybridScore = withVector.find((r) => r.pattern.id === "z_fighting");

      expect(baseScore).toBeDefined();
      expect(hybridScore).toBeDefined();
      expect(hybridScore!.score).toBeGreaterThan(baseScore!.score);
      expect(hybridScore!.vectorScore).toBe(0.9);
    });

    it("should satisfy hasStrong gate when vector >= 0.75", () => {
      // "random unrelated words" normally wouldn't match anything
      const results = matchProblemPatterns("camera moves strangely", patterns, undefined, {
        tiles_jitter: 0.85,
      });

      const match = results.find((r) => r.pattern.id === "tiles_jitter");
      expect(match).toBeDefined();
      expect(match!.matchedKeywords).toContain("vector:0.850");
    });

    it("should NOT satisfy hasStrong gate when vector < 0.75 alone", () => {
      const results = matchProblemPatterns("completely unrelated query", patterns, undefined, {
        z_fighting: 0.5,
      });

      const match = results.find((r) => r.pattern.id === "z_fighting");
      expect(match).toBeUndefined();
    });

    it("should include vector keyword in matchedKeywords", () => {
      const results = matchProblemPatterns("flickering", patterns, undefined, {
        z_fighting: 0.88,
      });

      const match = results.find((r) => r.pattern.id === "z_fighting");
      expect(match).toBeDefined();
      expect(match!.matchedKeywords.some((k) => k.startsWith("vector:"))).toBe(true);
    });

    it("should not affect results when vectorScores is undefined", () => {
      const withUndefined = matchProblemPatterns("polygon flickering", patterns, undefined, undefined);
      const without = matchProblemPatterns("polygon flickering", patterns);

      expect(withUndefined.length).toBe(without.length);
      for (let i = 0; i < withUndefined.length; i++) {
        expect(withUndefined[i].score).toBe(without[i].score);
        expect(withUndefined[i].vectorScore).toBeUndefined();
      }
    });
  });
});
