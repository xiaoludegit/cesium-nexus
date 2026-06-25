import { describe, it, expect, vi } from "vitest";
import { LLMClassifier } from "./llm-classifier.js";
import type { LLMBackend } from "../drafting/llm-backend.js";
import type { IntentClassification } from "./intent-classifier.js";

function makeMockLlm(response: string): LLMBackend {
  return {
    complete: async () => response,
  };
}

describe("LLMClassifier", () => {
  // ─── classifyAsync ──────────────────────────────────────────────

  it("parses valid JSON response from LLM", async () => {
    const llm = makeMockLlm(JSON.stringify({
      intent: "bug",
      confidence: 0.9,
      reason: "Title mentions crash",
    }));

    const classifier = new LLMClassifier({ llm });
    const result = await classifier.classifyAsync({
      title: "Scene crashes on load",
    });

    expect(result.intent).toBe("bug");
    expect(result.confidence).toBe(0.9);
    expect(result.method).toBe("llm");
    expect(result.reason).toBe("Title mentions crash");
  });

  it("handles markdown fence wrapping in LLM response", async () => {
    const llm = makeMockLlm('```json\n{"intent": "feature_request", "confidence": 0.8, "reason": "Asking for new feature"}\n```');

    const classifier = new LLMClassifier({ llm });
    const result = await classifier.classifyAsync({
      title: "Add WebGPU support",
    });

    expect(result.intent).toBe("feature_request");
    expect(result.confidence).toBe(0.8);
  });

  it("returns unknown for invalid JSON response", async () => {
    const llm = makeMockLlm("This is not JSON, just prose about bugs.");

    const classifier = new LLMClassifier({ llm });
    const result = await classifier.classifyAsync({
      title: "Some issue",
    });

    expect(result.intent).toBe("bug"); // keyword extraction
    expect(result.method).toBe("llm");
  });

  it("returns unknown with low confidence for unparseable response", async () => {
    const llm = makeMockLlm("Random text with no keywords");

    const classifier = new LLMClassifier({ llm });
    const result = await classifier.classifyAsync({
      title: "Some issue",
    });

    expect(result.intent).toBe("unknown");
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("handles LLM errors gracefully", async () => {
    const llm: LLMBackend = {
      complete: async () => { throw new Error("LLM timeout"); },
    };

    const classifier = new LLMClassifier({ llm });
    const result = await classifier.classifyAsync({
      title: "Some issue",
    });

    expect(result.intent).toBe("unknown");
    expect(result.confidence).toBe(0.1);
    expect(result.reason).toContain("LLM timeout");
  });

  it("sends correct prompt structure to LLM", async () => {
    let capturedPrompt = "";
    const llm: LLMBackend = {
      complete: async (prompt: string) => {
        capturedPrompt = prompt;
        return JSON.stringify({ intent: "bug", confidence: 0.9 });
      },
    };

    const classifier = new LLMClassifier({ llm });
    await classifier.classifyAsync({
      title: "Test title",
      body: "Test body",
      labels: ["bug", "p1"],
    });

    expect(capturedPrompt).toContain("Test title");
    expect(capturedPrompt).toContain("Test body");
    expect(capturedPrompt).toContain("bug, p1");
  });

  // ─── classifyBatchAsync ─────────────────────────────────────────

  it("classifies batch of issues", async () => {
    let callCount = 0;
    const responses = [
      JSON.stringify({ intent: "bug", confidence: 0.9 }),
      JSON.stringify({ intent: "feature_request", confidence: 0.8 }),
    ];

    const llm: LLMBackend = {
      complete: async () => responses[callCount++]!,
    };

    const classifier = new LLMClassifier({ llm });
    const results = await classifier.classifyBatchAsync([
      { title: "Bug issue" },
      { title: "Feature issue" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]!.intent).toBe("bug");
    expect(results[1]!.intent).toBe("feature_request");
  });

  // ─── classifyWithFallback ───────────────────────────────────────

  it("returns rule-based result when confidence is high", async () => {
    const llm: LLMBackend = {
      complete: async () => { throw new Error("Should not be called"); },
    };

    const classifier = new LLMClassifier({ llm, fallbackThreshold: 0.6 });

    const ruleResult: IntentClassification = {
      intent: "bug",
      confidence: 0.95,
      method: "rule",
      reason: "Label 'bug' matches",
    };

    const result = await classifier.classifyWithFallback(
      { title: "Some issue", labels: ["bug"] },
      ruleResult,
    );

    expect(result.intent).toBe("bug");
    expect(result.method).toBe("rule");
  });

  it("uses LLM when rule-based confidence is below threshold", async () => {
    const llm = makeMockLlm(JSON.stringify({
      intent: "bug",
      confidence: 0.85,
      reason: "LLM confirms bug",
    }));

    const classifier = new LLMClassifier({ llm, fallbackThreshold: 0.6 });

    const ruleResult: IntentClassification = {
      intent: "unknown",
      confidence: 0.3,
      method: "rule",
      reason: "No matching keywords",
    };

    const result = await classifier.classifyWithFallback(
      { title: "Ambiguous issue" },
      ruleResult,
    );

    expect(result.intent).toBe("bug");
    expect(result.method).toBe("llm");
  });

  // ─── classifyBatchWithFallback ──────────────────────────────────

  it("batch fallback uses LLM only for low-confidence issues", async () => {
    let llmCallCount = 0;
    const llm: LLMBackend = {
      complete: async () => {
        llmCallCount++;
        return JSON.stringify({ intent: "enhancement", confidence: 0.7 });
      },
    };

    const classifier = new LLMClassifier({ llm, fallbackThreshold: 0.6 });

    const ruleResults: IntentClassification[] = [
      { intent: "bug", confidence: 0.95, method: "rule" },      // high → skip LLM
      { intent: "unknown", confidence: 0.3, method: "rule" },   // low → use LLM
      { intent: "feature_request", confidence: 0.8, method: "rule" }, // high → skip LLM
    ];

    const results = await classifier.classifyBatchWithFallback(
      [
        { title: "Bug issue" },
        { title: "Ambiguous issue" },
        { title: "Feature issue" },
      ],
      ruleResults,
    );

    expect(results).toHaveLength(3);
    expect(results[0]!.method).toBe("rule");   // kept rule-based
    expect(results[1]!.method).toBe("llm");     // used LLM
    expect(results[2]!.method).toBe("rule");   // kept rule-based
    expect(llmCallCount).toBe(1); // only 1 LLM call
  });

  // ─── Edge cases ─────────────────────────────────────────────────

  it("clamps confidence to 0..1 range", async () => {
    const llm = makeMockLlm(JSON.stringify({
      intent: "bug",
      confidence: 1.5, // over 1.0
    }));

    const classifier = new LLMClassifier({ llm });
    const result = await classifier.classifyAsync({ title: "Test" });

    expect(result.confidence).toBe(1);
  });

  it("handles missing confidence in response", async () => {
    const llm = makeMockLlm(JSON.stringify({
      intent: "bug",
      // no confidence field
    }));

    const classifier = new LLMClassifier({ llm });
    const result = await classifier.classifyAsync({ title: "Test" });

    expect(result.confidence).toBe(0.5); // default
  });

  it("handles invalid intent value", async () => {
    const llm = makeMockLlm(JSON.stringify({
      intent: "invalid_type",
      confidence: 0.9,
    }));

    const classifier = new LLMClassifier({ llm });
    const result = await classifier.classifyAsync({ title: "Test" });

    expect(result.intent).toBe("unknown");
  });
});
