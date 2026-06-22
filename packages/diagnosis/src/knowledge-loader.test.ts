import { describe, it, expect } from "vitest";
import {
  loadProblemPatterns,
  loadRenderStages,
  validateProblemPatterns,
  validateRenderStages,
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
    expect(stages.length).toBeGreaterThanOrEqual(8);
    expect(stages.every((s) => s.id)).toBe(true);
  });

  it("should include depth_pass stage", async () => {
    const stages = await loadRenderStages();
    const dp = stages.find((s) => s.id === "depth_pass");
    expect(dp).toBeDefined();
    expect(dp!.order).toBe(3);
  });
});
