/**
 * Phase 3B/3C End-to-End Validation
 *
 * 10 real-world Cesium problems.
 * Acceptance criteria: ≥ 8/10 correct root cause, ≥ 1 evidence/result, < 3s each.
 *
 * Note: Problem patterns loaded from data/problem-kb/problem-patterns.json
 * via loadProblemPatterns(). No database seeding needed for pattern matching.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase, initSchema } from "@cesium-nexus/storage";
import type { Database } from "@cesium-nexus/storage";
import { EvidenceCollector, DiagnosisReasoner } from "../src/index.js";

/**
 * 10 acceptance queries with expected primary pattern IDs.
 */
const ACCEPTANCE_QUERIES: Array<{
  query: string;
  expectedPatternId: string;
  description: string;
}> = [
  {
    query: "polygon flickering when overlapping",
    expectedPatternId: "z_fighting",
    description: "Z-Fighting / Polygon Flickering",
  },
  {
    query: "z-fighting on overlapping geometry",
    expectedPatternId: "z_fighting",
    description: "Z-Fighting variant",
  },
  {
    query: "depth buffer precision loss at far distances",
    expectedPatternId: "depth_precision",
    description: "Depth Precision Loss",
  },
  {
    query: "terrain and ground primitive conflict",
    expectedPatternId: "terrain_conflict",
    description: "Terrain and GroundPrimitive Conflict",
  },
  {
    query: "too many primitives causing frame drop",
    expectedPatternId: "primitive_performance",
    description: "Primitive Performance Degradation",
  },
  {
    query: "label disappears or not visible",
    expectedPatternId: "label_visibility",
    description: "Label Disappears or Not Visible",
  },
  {
    query: "3D Tiles jitter or oscillation",
    expectedPatternId: "tiles_jitter",
    description: "3D Tiles Jitter",
  },
  {
    query: "tiles loading problem with blank area",
    expectedPatternId: "tiles_loading",
    description: "3D Tiles Loading Failure",
  },
  {
    query: "shader compile error in GLSL",
    expectedPatternId: "shader_compile_error",
    description: "Shader Compile Error",
  },
  {
    query: "LOD popping level of detail artifacts",
    expectedPatternId: "lod_popping",
    description: "LOD Popping",
  },
];

describe("Phase 3 End-to-End Validation (10 problems)", () => {
  let db: Database;
  let reasoner: DiagnosisReasoner;

  beforeEach(() => {
    db = openDatabase(":memory:");
    initSchema(db);

    const collector = new EvidenceCollector(db);
    reasoner = new DiagnosisReasoner(collector);
  });

  // Test each query individually
  for (const { query, expectedPatternId, description } of ACCEPTANCE_QUERIES) {
    it(`should diagnose: ${description}`, async () => {
      const start = performance.now();
      const result = await reasoner.diagnose(query);
      const elapsed = performance.now() - start;

      // 1. Should return a result
      expect(result).toBeDefined();
      expect(result.query).toBe(query);

      // 2. Should have ≥ 1 evidence (pattern match)
      expect(result.evidence.length).toBeGreaterThanOrEqual(1);

      // 3. Top evidence should match expected pattern
      const topPattern = result.evidence.find((e) => e.type === "pattern");
      expect(topPattern).toBeDefined();
      expect(topPattern!.source).toBe(expectedPatternId);

      // 4. Explanation should be human-readable
      expect(result.explanation.summary.length).toBeGreaterThan(10);
      expect(result.explanation.primaryCause.length).toBeGreaterThan(5);

      // 5. Confidence should be > 0
      expect(result.confidence).toBeGreaterThan(0);

      // 6. Should have suggested actions
      expect(result.explanation.suggestedActions.length).toBeGreaterThanOrEqual(1);

      // 7. Performance: < 3s
      expect(elapsed, `${description}: ${elapsed.toFixed(0)}ms`).toBeLessThan(3000);
    });
  }

  it("should have ≥ 8/10 queries returning correct pattern evidence", async () => {
    let successCount = 0;

    for (const { query, expectedPatternId } of ACCEPTANCE_QUERIES) {
      const result = await reasoner.diagnose(query);
      const topPattern = result.evidence.find((e) => e.type === "pattern");
      if (topPattern && topPattern.source === expectedPatternId) {
        successCount++;
      }
    }

    expect(successCount).toBeGreaterThanOrEqual(8);
  });

  it("should return ranked evidence with scores", async () => {
    const result = await reasoner.diagnose("polygon flickering");

    expect(result.rankedEvidence.length).toBeGreaterThanOrEqual(1);
    for (const re of result.rankedEvidence) {
      expect(re.score).toBeGreaterThanOrEqual(0);
      expect(re.explanation.length).toBeGreaterThan(0);
    }
  });

  it("explanation should have all required fields", async () => {
    const result = await reasoner.diagnose("shader compile error");

    expect(result.explanation.summary).toBeDefined();
    expect(result.explanation.primaryCause).toBeDefined();
    expect(result.explanation.contributingFactors).toBeDefined();
    expect(result.explanation.evidenceSummary).toBeDefined();
    expect(result.explanation.suggestedActions).toBeDefined();
  });
});
