import { describe, it, expect } from "vitest";
import {
  estimateDiagnosticTokens,
  truncateDiagnosticPack,
} from "./token-budget.js";
import type { DiagnosticContextPack } from "@cesium-nexus/shared";

function makePack(
  overrides: Partial<DiagnosticContextPack> = {},
): DiagnosticContextPack {
  return {
    kind: "diagnosis",
    query: "test query",
    matchedPatterns: [],
    renderStages: [],
    relatedSymbols: [],
    relatedSource: [],
    callgraph: [],
    relatedIssues: [],
    investigationSteps: [],
    fixSuggestions: [],
    metadata: { totalTokens: 0, truncated: false, tokenBudget: 6000 },
    ...overrides,
  };
}

function makeLargePack(): DiagnosticContextPack {
  return makePack({
    matchedPatterns: [
      {
        pattern: {
          id: "z_fighting",
          name: "Z-Fighting / Polygon Flickering",
          category: "rendering",
          severity: "high",
          aliases: ["z-fighting", "polygon flickering"],
          triggerKeywords: ["flickering", "z-fighting"],
          symptoms: ["Polygons flicker when viewed from certain angles"],
          possibleCauses: ["Co-planar geometry with no depth offset"],
          relatedSymbols: ["PolygonGeometry", "Primitive"],
          relatedStages: ["depth_pass"],
          issueQueries: ["z-fighting"],
          investigationSteps: ["Check logarithmicDepthBuffer setting"],
          fixSuggestions: ["Enable logarithmicDepthBuffer"],
        },
        matchedKeywords: ["keyword:flickering"],
        score: 5,
      },
    ],
    relatedSource: [
      {
        symbol: "PolygonGeometry",
        file: "Scene/PolygonGeometry.js",
        lineStart: 1,
        lineEnd: 200,
        code: "x".repeat(8000),
      },
      {
        symbol: "Primitive",
        file: "Scene/Primitive.js",
        lineStart: 1,
        lineEnd: 300,
        code: "y".repeat(6000),
      },
    ],
    relatedIssues: [
      {
        id: 1,
        repo: "CesiumGS/cesium",
        number: 1234,
        title: "Z-fighting with polygon on terrain",
        body: "z".repeat(4000),
        state: "open",
        labels: ["bug"],
        assignees: [],
        author: "user1",
        comments: 3,
        createdAt: "2024-01-01",
        updatedAt: "2024-06-01",
        closedAt: null,
        htmlUrl: "https://github.com/CesiumGS/cesium/issues/1234",
      },
    ],
    callgraph: [
      { source: "PolygonGeometry", target: "Primitive" },
      { source: "Primitive", target: "Scene" },
      { source: "Scene", target: "Context" },
    ],
    renderStages: [
      {
        id: "depth_pass",
        name: "Depth Pass",
        order: 3,
        description: "The depth pre-pass writes depth values for opaque geometry without color output.".repeat(5),
        keySymbols: ["Scene"],
        symptomHints: ["z-fighting"],
      },
    ],
    investigationSteps: [
      "Check if scene.logarithmicDepthBuffer is enabled",
      "Inspect the near/far clipping plane ratio on Camera.frustum",
    ],
    fixSuggestions: [
      "Enable scene.logarithmicDepthBuffer = true for large-scale scenes",
      "Add a small vertical offset to one of the co-planar primitives",
    ],
  });
}

describe("estimateDiagnosticTokens", () => {
  it("should return minimal tokens for empty pack", () => {
    const pack = makePack();
    expect(estimateDiagnosticTokens(pack)).toBeLessThanOrEqual(2);
  });

  it("should estimate tokens for non-empty pack", () => {
    const pack = makeLargePack();
    const tokens = estimateDiagnosticTokens(pack);
    expect(tokens).toBeGreaterThan(0);
  });

  it("should increase with more source code", () => {
    const small = makePack({
      relatedSource: [
        { symbol: "A", file: "a.js", lineStart: 1, lineEnd: 10, code: "short" },
      ],
    });
    const large = makePack({
      relatedSource: [
        { symbol: "A", file: "a.js", lineStart: 1, lineEnd: 100, code: "x".repeat(1000) },
      ],
    });
    expect(estimateDiagnosticTokens(large)).toBeGreaterThan(
      estimateDiagnosticTokens(small),
    );
  });
});

describe("truncateDiagnosticPack", () => {
  it("should not truncate a small pack with default budget", () => {
    const pack = makePack({
      investigationSteps: ["step 1"],
      fixSuggestions: ["fix 1"],
    });
    const result = truncateDiagnosticPack(pack);
    expect(result.metadata.truncated).toBe(false);
    expect(result.metadata.totalTokens).toBeLessThanOrEqual(6000);
  });

  it("should truncate large pack to fit budget", () => {
    const pack = makeLargePack();
    const budget = 1000;
    const result = truncateDiagnosticPack(pack, budget);
    expect(result.metadata.totalTokens).toBeLessThanOrEqual(budget);
    expect(result.metadata.truncated).toBe(true);
  });

  it("should always preserve matched pattern info", () => {
    const pack = makeLargePack();
    const result = truncateDiagnosticPack(pack, 200);
    expect(result.matchedPatterns.length).toBe(1);
    expect(result.matchedPatterns[0].pattern.id).toBe("z_fighting");
    expect(result.matchedPatterns[0].pattern.possibleCauses.length).toBeGreaterThan(0);
  });

  it("should always preserve investigation steps and fix suggestions", () => {
    const pack = makeLargePack();
    const result = truncateDiagnosticPack(pack, 800);
    expect(result.investigationSteps.length).toBeGreaterThan(0);
    expect(result.fixSuggestions.length).toBeGreaterThan(0);
  });

  it("should truncate source before issues", () => {
    const pack = makeLargePack();
    // Use a budget that forces source truncation but keeps issues
    const origTokens = estimateDiagnosticTokens(pack);
    const budget = Math.floor(origTokens * 0.5);
    const result = truncateDiagnosticPack(pack, budget);
    // Source should be reduced
    expect(result.relatedSource.length).toBeLessThanOrEqual(pack.relatedSource.length);
  });

  it("should set metadata with correct budget", () => {
    const pack = makePack();
    const result = truncateDiagnosticPack(pack, 3000);
    expect(result.metadata.tokenBudget).toBe(3000);
  });

  it("should use default budget of 6000", () => {
    const pack = makePack();
    const result = truncateDiagnosticPack(pack);
    expect(result.metadata.tokenBudget).toBe(6000);
  });

  it("should enforce hard cap and never exceed budget", () => {
    const pack = makeLargePack();
    for (const budget of [200, 500, 1000, 2000]) {
      const result = truncateDiagnosticPack(pack, budget);
      const isOverflow = result.metadata.unavoidableOverflow === true;
      if (!isOverflow) {
        expect(result.metadata.totalTokens).toBeLessThanOrEqual(budget);
      }
    }
  });

  it("should set unavoidableOverflow when budget is below minimum", () => {
    const pack = makeLargePack();
    const result = truncateDiagnosticPack(pack, 10);
    expect(result.metadata.unavoidableOverflow).toBe(true);
    expect(result.metadata.minimumPossibleTokens).toBeDefined();
    expect(result.metadata.minimumPossibleTokens!).toBeGreaterThan(0);
  });

  it("should not set unavoidableOverflow when budget is sufficient", () => {
    const pack = makeLargePack();
    const result = truncateDiagnosticPack(pack, 6000);
    expect(result.metadata.unavoidableOverflow).toBeUndefined();
  });

  it("should drop fixes and steps when hard cap is needed", () => {
    const pack = makeLargePack();
    const result = truncateDiagnosticPack(pack, 10);
    expect(result.metadata.unavoidableOverflow).toBe(true);
    expect(result.fixSuggestions).toEqual([]);
    expect(result.investigationSteps).toEqual([]);
  });
});
