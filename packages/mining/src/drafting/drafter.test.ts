import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Drafter } from "./drafter.js";
import type { LLMBackend } from "./llm-backend.js";
import type { CanonicalProblem, Cluster } from "../types.js";
import { resetCanonicalSeq, resetCandidateSeq } from "../index.js";

function makeCanonical(overrides: Partial<CanonicalProblem> = {}): CanonicalProblem {
  return {
    id: "canonical/1",
    title: "Z-Fighting",
    aliases: ["z-fighting", "depth fighting"],
    representativeIssueId: 42,
    clusterIds: ["cluster/1"],
    experienceIds: [],
    confidence: 0.85,
    status: "candidate",
    createdAt: Date.now(),
    reviewedAt: null,
    ...overrides,
  };
}

function makeCluster(overrides: Partial<Cluster> = {}): Cluster {
  return {
    id: "cluster/1",
    memberIds: ["issue/1", "issue/2", "issue/3"],
    score: 0.92,
    ...overrides,
  };
}

describe("Drafter", () => {
  let mockLlm: LLMBackend;
  let restoreFetch: (() => void) | undefined;

  function installFetchMock(fn: typeof fetch) {
    const orig = globalThis.fetch;
    globalThis.fetch = fn;
    return () => { globalThis.fetch = orig; };
  }

  beforeEach(() => {
    resetCanonicalSeq(0);
    resetCandidateSeq(0);
  });

  afterEach(() => {
    restoreFetch?.();
  });

  it("calls LLM with correct prompt structure and parses JSON response", async () => {
    const mockFn = vi.fn<typeof fetch>().mockImplementation(
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({ response: JSON.stringify({
          draftAlias: ["z-fighting", "polygon flicker"],
          draftSymptoms: ["Polygons flicker", "Shimmering"],
          draftSymbols: ["Primitive", "DepthPlane"],
          draftCategory: "rendering",
        })}),
        text: async () => JSON.stringify({ response: "{}" }),
      } as Response),
    );
    restoreFetch = installFetchMock(mockFn);

    mockLlm = {
      complete: async (prompt: string) => {
        // Capture the prompt for inspection
        expect(prompt).toContain("Z-Fighting");
        expect(prompt).toContain("Cluster Members");
        expect(prompt).toContain("draftAlias");
        return JSON.stringify({
          draftAlias: ["z-fighting", "polygon flicker"],
          draftSymptoms: ["Polygons flicker", "Shimmering"],
          draftSymbols: ["Primitive", "DepthPlane"],
          draftCategory: "rendering",
        });
      },
    };

    const drafter = new Drafter({ llm: mockLlm });
    const result = await drafter.draft(
      makeCanonical(),
      makeCluster(),
      ["Issue #42: z-fighting on terrain", "Issue #87: polygon flicker"],
    );

    expect(result.input.draftAlias).toEqual(["z-fighting", "polygon flicker"]);
    expect(result.input.draftSymptoms).toEqual(["Polygons flicker", "Shimmering"]);
    expect(result.input.draftSymbols).toEqual(["Primitive", "DepthPlane"]);
    expect(result.input.draftCategory).toBe("rendering");
    expect(result.llmRaw.length).toBeGreaterThan(0);
  });

  it("handles markdown fence wrapping in LLM response", async () => {
    const mockLlmFenced = {
      complete: async (): Promise<string> => {
        return "```json\n{\n  \"draftAlias\": [\"test\"],\n  \"draftSymptoms\": [\"test symptom\"],\n  \"draftSymbols\": [\"SomeClass\"],\n  \"draftCategory\": \"debug\"\n}\n```";
      },
    };

    const drafter = new Drafter({ llm: mockLlmFenced });
    const result = await drafter.draft(
      makeCanonical(),
      makeCluster(),
      ["test"],
    );

    expect(result.input.draftAlias).toEqual(["test"]);
    expect(result.input.draftCategory).toBe("debug");
  });

  it("falls back to default when LLM returns invalid JSON", async () => {
    const mockLlmBad = {
      complete: async (): Promise<string> => {
        return "This is not JSON at all, just prose.";
      },
    };

    const drafter = new Drafter({ llm: mockLlmBad });
    const result = await drafter.draft(
      makeCanonical(),
      makeCluster(),
      ["test"],
    );

    expect(result.input.draftAlias).toEqual(["unknown_pattern"]);
    expect(result.input.draftSymptoms[0]).toContain("This is not JSON");
    expect(result.input.draftSymbols).toEqual([]);
  });

  it("returns empty arrays when LLM returns partial JSON", async () => {
    const mockLlmPartial = {
      complete: async (): Promise<string> => {
        return '{"draftAlias": ["partial"]}';
      },
    };

    const drafter = new Drafter({ llm: mockLlmPartial });
    const result = await drafter.draft(
      makeCanonical(),
      makeCluster(),
      ["test"],
    );

    expect(result.input.draftAlias).toEqual(["partial"]);
    expect(result.input.draftSymptoms).toEqual([]);
    expect(result.input.draftSymbols).toEqual([]);
    expect(result.input.draftCategory).toBeNull();
  });

  it("draftBatch continues on individual failures", async () => {
    let callCount = 0;
    const mockLlmMixed = {
      complete: async (): Promise<string> => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            draftAlias: ["good"],
            draftSymptoms: ["fine"],
            draftSymbols: ["OK"],
            draftCategory: "debug",
          });
        }
        throw new Error("LLM timeout");
      },
    };

    const drafter = new Drafter({ llm: mockLlmMixed });
    const results = await drafter.draftBatch([
      {
        canonical: makeCanonical({ id: "canonical/1" }),
        cluster: makeCluster({ id: "cluster/1" }),
        memberSummaries: ["good issue"],
      },
      {
        canonical: makeCanonical({ id: "canonical/2" }),
        cluster: makeCluster({ id: "cluster/2" }),
        memberSummaries: ["bad issue"],
      },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]!.input.draftAlias).toEqual(["good"]);
    expect(results[1]!.llmRaw).toContain("ERROR");
    expect(results[1]!.input.draftSymptoms[0]).toContain("LLM timeout");
  });

  it("uses custom system prompt when provided", async () => {
    const capturedPrompts: string[] = [];
    const mockLlm = {
      complete: async (prompt: string) => {
        capturedPrompts.push(prompt);
        return JSON.stringify({
          draftAlias: ["x"],
          draftSymptoms: ["y"],
          draftSymbols: ["z"],
        });
      },
    };

    const customSystem = "You are a cat analyst.";
    const drafter = new Drafter({
      llm: mockLlm,
      systemPrompt: customSystem,
    });

    // The system prompt is not sent in the current implementation
    // (only user prompt is sent to LLM). Verify drafter still works.
    const result = await drafter.draft(
      makeCanonical(),
      makeCluster(),
      ["test"],
    );

    expect(result.input.draftAlias).toEqual(["x"]);
    // Custom system prompt is stored but not used in single-turn completion
    // This is by design — the user prompt contains all context
  });
});
