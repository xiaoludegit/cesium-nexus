import { describe, it, expect, beforeAll } from "vitest";
import { loadProblemPatterns, loadRenderStages } from "./knowledge-loader.js";
import { matchProblemPatterns } from "./matcher.js";
import type { ProblemPattern, RenderStage } from "@cesium-nexus/shared";
import { readFileSync } from "node:fs";

interface EvaluationCase {
  query: string;
  expectedPatterns: string[];
  expectedSymbols: string[];
}

const dataDir = new URL("../../../data/evaluation/", import.meta.url);
const evalCases: EvaluationCase[] = JSON.parse(
  readFileSync(new URL("phase2a-diagnosis-cases.json", dataDir), "utf-8"),
);

describe("Phase 2A Evaluation Dataset", () => {
  let patterns: ProblemPattern[];
  let stages: RenderStage[];

  beforeAll(async () => {
    patterns = await loadProblemPatterns();
    stages = await loadRenderStages();
  });

  it("should have at least 10 evaluation cases", () => {
    expect(evalCases.length).toBeGreaterThanOrEqual(10);
  });

  it.each(evalCases.map((c) => [c.query, c]))(
    "should match expected patterns for: %s",
    (_query, evalCase) => {
      const { query, expectedPatterns } = evalCase as EvaluationCase;
      const results = matchProblemPatterns(query, patterns);

      const matchedIds = results.map((r) => r.pattern.id);
      for (const expected of expectedPatterns) {
        expect(matchedIds).toContain(expected);
      }
    },
  );

  it.each(evalCases.map((c) => [c.query, c]))(
    "should include expected symbols for: %s",
    (_query, evalCase) => {
      const { query, expectedSymbols } = evalCase as EvaluationCase;
      const results = matchProblemPatterns(query, patterns);

      // Collect all related symbols from matched patterns
      const allSymbols = new Set<string>();
      for (const match of results) {
        for (const sym of match.pattern.relatedSymbols) {
          allSymbols.add(sym);
        }
      }

      for (const expected of expectedSymbols) {
        expect(allSymbols).toContain(expected);
      }
    },
  );

  it("all patterns should have valid stage references", () => {
    const stageIds = new Set(stages.map((s) => s.id));
    for (const pattern of patterns) {
      for (const stageRef of pattern.relatedStages) {
        expect(stageIds.has(stageRef)).toBe(true);
      }
    }
  });

  it("all patterns should have unique IDs", () => {
    const ids = patterns.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all stages should have unique IDs", () => {
    const ids = stages.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all stages should be ordered by order field", () => {
    const sorted = [...stages].sort((a, b) => a.order - b.order);
    for (let i = 0; i < stages.length; i++) {
      expect(stages[i].id).toBe(sorted[i].id);
    }
  });
});
