import { describe, it, expect } from "vitest";
import { RuleBasedClassifier } from "./rule-based-classifier.js";
import type { IssueInput } from "./intent-classifier.js";

describe("RuleBasedClassifier", () => {
  const classifier = new RuleBasedClassifier();

  // ─── Label-based classification ─────────────────────────────────

  it("classifies as bug when label 'bug' present", () => {
    const result = classifier.classify({
      title: "Some issue",
      labels: ["bug"],
    });
    expect(result.intent).toBe("bug");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.method).toBe("rule");
  });

  it("classifies as bug when label 'type: bug' present", () => {
    const result = classifier.classify({
      title: "Some issue",
      labels: ["type: bug"],
    });
    expect(result.intent).toBe("bug");
  });

  it("classifies as feature_request when label 'feature' present", () => {
    const result = classifier.classify({
      title: "Some issue",
      labels: ["feature"],
    });
    expect(result.intent).toBe("feature_request");
  });

  it("classifies as enhancement when label 'enhancement' present", () => {
    const result = classifier.classify({
      title: "Some issue",
      labels: ["enhancement"],
    });
    expect(result.intent).toBe("enhancement");
  });

  it("classifies as refactor when label 'refactor' present", () => {
    const result = classifier.classify({
      title: "Some issue",
      labels: ["refactor"],
    });
    expect(result.intent).toBe("refactor");
  });

  // ─── Keyword-based classification ───────────────────────────────

  it("classifies as bug from title keyword 'crash'", () => {
    const result = classifier.classify({
      title: "Scene crashes when loading 3D tiles",
    });
    expect(result.intent).toBe("bug");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("classifies as bug from title keyword 'flickering'", () => {
    const result = classifier.classify({
      title: "Polygon flickering on terrain",
    });
    expect(result.intent).toBe("bug");
  });

  it("classifies as bug from title keyword 'error'", () => {
    const result = classifier.classify({
      title: "Shader compile error on Safari",
    });
    expect(result.intent).toBe("bug");
  });

  it("classifies as bug from body keyword 'not working'", () => {
    const result = classifier.classify({
      title: "Camera control",
      body: "The camera is not working properly after update",
    });
    expect(result.intent).toBe("bug");
  });

  it("classifies as feature_request from title keyword 'feature request'", () => {
    const result = classifier.classify({
      title: "Feature request: add support for glTF extensions",
    });
    expect(result.intent).toBe("feature_request");
  });

  it("classifies as feature_request from title keyword 'implement'", () => {
    const result = classifier.classify({
      title: "Implement WebGPU renderer backend",
    });
    expect(result.intent).toBe("feature_request");
  });

  it("classifies as feature_request from 'create reference implementation'", () => {
    const result = classifier.classify({
      title: "Create reference implementation for Bentley glTF",
    });
    expect(result.intent).toBe("feature_request");
  });

  it("classifies as enhancement from title keyword 'performance'", () => {
    const result = classifier.classify({
      title: "Performance improvement for label rendering",
    });
    expect(result.intent).toBe("enhancement");
  });

  it("classifies as refactor from title keyword 'refactor'", () => {
    const result = classifier.classify({
      title: "Refactor primitive update logic",
    });
    expect(result.intent).toBe("refactor");
  });

  // ─── Edge cases ─────────────────────────────────────────────────

  it("returns unknown when no labels or keywords match", () => {
    const result = classifier.classify({
      title: "Question about API usage",
    });
    expect(result.intent).toBe("unknown");
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("returns unknown for empty title", () => {
    const result = classifier.classify({
      title: "",
    });
    expect(result.intent).toBe("unknown");
  });

  it("labels take priority over keywords", () => {
    const result = classifier.classify({
      title: "Feature request: add new renderer",
      labels: ["bug"], // label says bug, title says feature
    });
    expect(result.intent).toBe("bug");
    expect(result.reason).toContain("Label");
  });

  it("handles multiple labels, first matching rule wins (by rule order)", () => {
    const result = classifier.classify({
      title: "Some issue",
      labels: ["enhancement", "bug"], // bug rule has higher priority in LABEL_RULES
    });
    // "bug" rule matches before "enhancement" rule
    expect(result.intent).toBe("bug");
  });

  // ─── Batch classification ───────────────────────────────────────

  it("classifyBatch returns classifications for all issues", () => {
    const issues: IssueInput[] = [
      { title: "Bug: crash on load", labels: ["bug"] },
      { title: "Feature: add WebGPU", labels: ["feature"] },
      { title: "How to use Camera?", labels: [] },
    ];

    const results = classifier.classifyBatch(issues);

    expect(results).toHaveLength(3);
    expect(results[0]!.intent).toBe("bug");
    expect(results[1]!.intent).toBe("feature_request");
    expect(results[2]!.intent).toBe("unknown");
  });

  // ─── Confidence calibration ─────────────────────────────────────

  it("label-based classification has higher confidence than keyword-based", () => {
    const labelResult = classifier.classify({
      title: "Some issue",
      labels: ["bug"],
    });
    const keywordResult = classifier.classify({
      title: "Something is broken",
    });

    expect(labelResult.confidence).toBeGreaterThan(keywordResult.confidence);
  });

  it("more keyword matches increase confidence", () => {
    const singleKw = classifier.classify({
      title: "Bug in camera",
    });
    const multiKw = classifier.classify({
      title: "Bug: crash and error in camera",
      body: "Not working, fails on load, broken after update",
    });

    // Both should be bug, but multi-keyword should have higher confidence
    expect(singleKw.intent).toBe("bug");
    expect(multiKw.intent).toBe("bug");
    expect(multiKw.confidence).toBeGreaterThanOrEqual(singleKw.confidence);
  });
});
