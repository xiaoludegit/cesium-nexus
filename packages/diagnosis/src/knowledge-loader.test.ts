import { describe, it, expect } from "vitest";
import {
  loadProblemPatterns,
  loadRenderStages,
  validateProblemPatterns,
  validateRenderStages,
  buildRenderPipelineGraph,
  validatePipelineDAG,
  getStageDependencies,
  getDownstreamStages,
} from "./knowledge-loader.js";
import type { ProblemPattern, RenderStage } from "@cesium-nexus/shared";

function makePattern(overrides: Partial<ProblemPattern> = {}): ProblemPattern {
  return {
    id: "test_pattern",
    name: "Test Pattern",
    category: "rendering",
    severity: "medium",
    aliases: ["test"],
    triggerKeywords: ["test"],
    symptoms: ["test symptom"],
    possibleCauses: ["test cause"],
    relatedSymbols: ["Scene"],
    relatedStages: ["depth_pass"],
    issueQueries: ["test"],
    investigationSteps: ["step 1"],
    fixSuggestions: ["fix 1"],
    ...overrides,
  };
}

function makeStage(overrides: Partial<RenderStage> = {}): RenderStage {
  return {
    id: "test_stage",
    name: "Test Stage",
    order: 1,
    description: "A test stage",
    keySymbols: ["Scene"],
    symptomHints: ["test hint"],
    dependsOn: [],
    ...overrides,
  };
}

describe("validateProblemPatterns", () => {
  it("should accept valid patterns", () => {
    const patterns = [makePattern()];
    expect(validateProblemPatterns(patterns)).toEqual(patterns);
  });

  it("should reject empty id", () => {
    expect(() => validateProblemPatterns([makePattern({ id: "" })])).toThrow(
      "empty id",
    );
  });

  it("should reject duplicate ids", () => {
    expect(() =>
      validateProblemPatterns([makePattern(), makePattern()]),
    ).toThrow("Duplicate");
  });

  it("should reject empty triggerKeywords", () => {
    expect(() =>
      validateProblemPatterns([makePattern({ triggerKeywords: [] })]),
    ).toThrow("triggerKeywords");
  });

  it("should reject empty symptoms", () => {
    expect(() =>
      validateProblemPatterns([makePattern({ symptoms: [] })]),
    ).toThrow("symptoms");
  });

  it("should reject empty possibleCauses", () => {
    expect(() =>
      validateProblemPatterns([makePattern({ possibleCauses: [] })]),
    ).toThrow("possibleCauses");
  });

  it("should reject empty relatedSymbols", () => {
    expect(() =>
      validateProblemPatterns([makePattern({ relatedSymbols: [] })]),
    ).toThrow("relatedSymbols");
  });

  it("should reject empty relatedStages", () => {
    expect(() =>
      validateProblemPatterns([makePattern({ relatedStages: [] })]),
    ).toThrow("relatedStages");
  });

  it("should reject empty investigationSteps", () => {
    expect(() =>
      validateProblemPatterns([makePattern({ investigationSteps: [] })]),
    ).toThrow("investigationSteps");
  });

  it("should reject empty fixSuggestions", () => {
    expect(() =>
      validateProblemPatterns([makePattern({ fixSuggestions: [] })]),
    ).toThrow("fixSuggestions");
  });
});

describe("validateRenderStages", () => {
  it("should accept valid stages", () => {
    const stages = [makeStage()];
    expect(validateRenderStages(stages)).toEqual(stages);
  });

  it("should reject empty id", () => {
    expect(() => validateRenderStages([makeStage({ id: "" })])).toThrow(
      "empty id",
    );
  });

  it("should reject duplicate ids", () => {
    expect(() => validateRenderStages([makeStage(), makeStage()])).toThrow(
      "Duplicate",
    );
  });

  it("should reject empty name", () => {
    expect(() => validateRenderStages([makeStage({ name: "" })])).toThrow(
      "name must not be empty",
    );
  });

  it("should reject dependsOn referencing unknown stage", () => {
    expect(() =>
      validateRenderStages([makeStage({ dependsOn: ["nonexistent"] })]),
    ).toThrow('dependsOn references unknown stage "nonexistent"');
  });

  it("should accept valid dependsOn references", () => {
    const stages = [
      makeStage({ id: "a" }),
      makeStage({ id: "b", dependsOn: ["a"] }),
    ];
    expect(validateRenderStages(stages)).toEqual(stages);
  });
});

describe("loadProblemPatterns", () => {
  it("should load and validate the real KB data", async () => {
    const patterns = await loadProblemPatterns();
    expect(patterns.length).toBeGreaterThanOrEqual(10);
    expect(patterns.every((p) => p.id)).toBe(true);
  });

  it("should include z_fighting pattern", async () => {
    const patterns = await loadProblemPatterns();
    const zf = patterns.find((p) => p.id === "z_fighting");
    expect(zf).toBeDefined();
    expect(zf!.relatedSymbols).toContain("PolygonGeometry");
  });
});

describe("loadRenderStages", () => {
  it("should load and validate the real KB data", async () => {
    const stages = await loadRenderStages();
    expect(stages.length).toBeGreaterThanOrEqual(12);
    expect(stages.every((s) => s.id)).toBe(true);
  });

  it("should include depth_pass stage", async () => {
    const stages = await loadRenderStages();
    const dp = stages.find((s) => s.id === "depth_pass");
    expect(dp).toBeDefined();
    expect(dp!.order).toBe(4);
  });

  it("should include dependsOn in all stages", async () => {
    const stages = await loadRenderStages();
    for (const s of stages) {
      expect(Array.isArray(s.dependsOn)).toBe(true);
    }
  });
});

describe("buildRenderPipelineGraph", () => {
  it("should build edges from dependsOn", () => {
    const stages = [
      makeStage({ id: "a" }),
      makeStage({ id: "b", dependsOn: ["a"] }),
      makeStage({ id: "c", dependsOn: ["a", "b"] }),
    ];
    const graph = buildRenderPipelineGraph(stages);
    expect(graph.stages).toEqual(stages);
    expect(graph.edges).toHaveLength(3);
    expect(graph.edges).toContainEqual({
      from: "a",
      to: "b",
      relation: "sequential",
    });
    expect(graph.edges).toContainEqual({
      from: "a",
      to: "c",
      relation: "sequential",
    });
    expect(graph.edges).toContainEqual({
      from: "b",
      to: "c",
      relation: "sequential",
    });
  });

  it("should produce empty edges for independent stages", () => {
    const stages = [makeStage({ id: "x" }), makeStage({ id: "y" })];
    const graph = buildRenderPipelineGraph(stages);
    expect(graph.edges).toHaveLength(0);
  });
});

describe("validatePipelineDAG", () => {
  it("should return true for valid DAG", () => {
    const stages = [
      makeStage({ id: "a" }),
      makeStage({ id: "b", dependsOn: ["a"] }),
      makeStage({ id: "c", dependsOn: ["b"] }),
    ];
    const graph = buildRenderPipelineGraph(stages);
    expect(validatePipelineDAG(graph)).toBe(true);
  });

  it("should return true for diamond DAG", () => {
    const stages = [
      makeStage({ id: "a" }),
      makeStage({ id: "b", dependsOn: ["a"] }),
      makeStage({ id: "c", dependsOn: ["a"] }),
      makeStage({ id: "d", dependsOn: ["b", "c"] }),
    ];
    const graph = buildRenderPipelineGraph(stages);
    expect(validatePipelineDAG(graph)).toBe(true);
  });

  it("should detect cycle", () => {
    const stages = [
      makeStage({ id: "a", dependsOn: ["c"] }),
      makeStage({ id: "b", dependsOn: ["a"] }),
      makeStage({ id: "c", dependsOn: ["b"] }),
    ];
    const graph = buildRenderPipelineGraph(stages);
    expect(validatePipelineDAG(graph)).toBe(false);
  });
});

describe("getStageDependencies", () => {
  const stages = [
    makeStage({ id: "a" }),
    makeStage({ id: "b", dependsOn: ["a"] }),
    makeStage({ id: "c", dependsOn: ["b"] }),
    makeStage({ id: "d", dependsOn: ["a", "c"] }),
  ];

  it("should return empty for root stage", () => {
    expect(getStageDependencies("a", stages)).toEqual([]);
  });

  it("should return direct dependency", () => {
    const deps = getStageDependencies("b", stages);
    expect(deps.map((s) => s.id)).toEqual(["a"]);
  });

  it("should return transitive dependencies", () => {
    const deps = getStageDependencies("d", stages);
    const ids = deps.map((s) => s.id).sort();
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("should return empty for unknown stage", () => {
    expect(getStageDependencies("nonexistent", stages)).toEqual([]);
  });
});

describe("getDownstreamStages", () => {
  const stages = [
    makeStage({ id: "a" }),
    makeStage({ id: "b", dependsOn: ["a"] }),
    makeStage({ id: "c", dependsOn: ["b"] }),
    makeStage({ id: "d", dependsOn: ["a"] }),
  ];

  it("should return empty for leaf stage", () => {
    expect(getDownstreamStages("c", stages)).toEqual([]);
  });

  it("should return all downstream stages", () => {
    const ds = getDownstreamStages("a", stages);
    const ids = ds.map((s) => s.id).sort();
    expect(ids).toEqual(["b", "c", "d"]);
  });

  it("should return transitive downstream", () => {
    const ds = getDownstreamStages("b", stages);
    expect(ds.map((s) => s.id)).toEqual(["c"]);
  });
});
