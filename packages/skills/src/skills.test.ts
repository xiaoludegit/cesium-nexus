import { describe, it, expect } from "vitest";
import type {
  SkillConfig,
  SkillId,
  SkillContextPack,
  RenderStage,
  ProblemPattern,
} from "@cesium-nexus/shared";
import {
  validateSkillConfigs,
  dispatchSkill,
} from "./skill-router.js";
import { extractEntities } from "./entity-extractor.js";
import {
  estimateSkillTokens,
  truncateSkillPack,
} from "./token-budget.js";

// ─── Test Fixtures ──────────────────────────────────────────

function makeConfig(overrides: Partial<SkillConfig> = {}): SkillConfig {
  return {
    id: "general",
    name: "General",
    description: "Fallback skill",
    triggerKeywords: [],
    tokenBudget: 4000,
    sections: ["symbol", "source", "issues"],
    retrieval: {
      includeDiagnosis: false,
      includeRenderStages: false,
      includeForum: false,
      includeExperience: false,
      callgraphDepth: 1,
      issueLimit: 3,
      forumLimit: 0,
    },
    ...overrides,
  };
}

function makeTestConfigs(): SkillConfig[] {
  return [
    makeConfig({
      id: "api",
      name: "API Skill",
      triggerKeywords: ["api", "how to use", "parameter", "method", "class"],
      tokenBudget: 4000,
      sections: ["symbol", "source", "callgraph"],
    }),
    makeConfig({
      id: "debug",
      name: "Debug Skill",
      triggerKeywords: ["bug", "error", "flickering", "not working", "fix"],
      tokenBudget: 6000,
      sections: ["diagnosis", "render_stage", "symbol", "source", "issues", "fixes", "forum", "experience"],
      retrieval: {
        includeDiagnosis: true,
        includeRenderStages: true,
        includeForum: true,
        includeExperience: true,
        callgraphDepth: 1,
        issueLimit: 5,
        forumLimit: 3,
      },
    }),
    makeConfig({
      id: "performance",
      name: "Performance Skill",
      triggerKeywords: ["performance", "slow", "fps", "optimize", "memory"],
      tokenBudget: 6000,
      sections: ["render_stage", "callgraph", "symbol", "source", "issues", "forum", "experience"],
      retrieval: {
        includeDiagnosis: false,
        includeRenderStages: true,
        includeForum: true,
        includeExperience: true,
        callgraphDepth: 2,
        issueLimit: 5,
        forumLimit: 3,
      },
    }),
    makeConfig({
      id: "shader",
      name: "Shader Skill",
      triggerKeywords: ["shader", "glsl", "fragment", "vertex", "material"],
      tokenBudget: 5000,
      sections: ["render_stage", "symbol", "source", "issues", "forum"],
    }),
    makeConfig(), // general fallback
  ];
}

function makeStage(overrides: Partial<RenderStage> = {}): RenderStage {
  return {
    id: "test_stage",
    name: "Test Stage",
    order: 1,
    description: "A test stage",
    keySymbols: ["TestSymbol"],
    symptomHints: ["flickering"],
    dependsOn: [],
    ...overrides,
  };
}

function makePattern(overrides: Partial<ProblemPattern> = {}): ProblemPattern {
  return {
    id: "z_fighting",
    name: "Z-Fighting",
    category: "visual_artifact",
    severity: "medium",
    aliases: ["z-fighting", "polygon flickering"],
    triggerKeywords: ["flickering", "z-fighting", "flashing", "polygon"],
    symptoms: ["polygons flicker or flash"],
    possibleCauses: ["depth buffer precision issues"],
    relatedSymbols: ["Viewer", "Scene"],
    relatedStages: ["render_pass"],
    issueQueries: ["z-fighting"],
    investigationSteps: ["Check depth buffer settings"],
    fixSuggestions: ["Use logarithmic depth buffer"],
    ...overrides,
  };
}

function makePack(overrides: Partial<SkillContextPack> = {}): SkillContextPack {
  return {
    kind: "skill",
    skill: "general",
    query: "test query",
    dispatch: {
      skill: "general",
      confidence: 0,
      matchedKeywords: [],
      extractedEntities: [],
    },
    source: [],
    callgraph: [],
    issues: [],
    metadata: {
      skill: "general",
      totalTokens: 0,
      truncated: false,
      tokenBudget: 4000,
      sectionsIncluded: ["symbol", "source", "issues"],
    },
    ...overrides,
  };
}

// ─── validateSkillConfigs ──────────────────────────────────────

describe("validateSkillConfigs", () => {
  it("accepts valid configs with general fallback", () => {
    const configs = makeTestConfigs();
    const result = validateSkillConfigs(configs);
    expect(result).toHaveLength(5);
  });

  it("rejects duplicate ids", () => {
    const configs = [makeConfig({ id: "api" }), makeConfig({ id: "api" })];
    expect(() => validateSkillConfigs(configs)).toThrow(/Duplicate/);
  });

  it("rejects empty id", () => {
    const configs = [makeConfig({ id: "" as SkillId })];
    expect(() => validateSkillConfigs(configs)).toThrow(/empty id/);
  });

  it("rejects missing general fallback", () => {
    const configs = [makeConfig({ id: "api" })];
    expect(() => validateSkillConfigs(configs)).toThrow(/general/);
  });

  it("rejects non-positive tokenBudget", () => {
    const configs = [makeConfig({ tokenBudget: 0 })];
    expect(() => validateSkillConfigs(configs)).toThrow(/tokenBudget/);
  });
});

// ─── dispatchSkill ─────────────────────────────────────────────

describe("dispatchSkill", () => {
  const configs = makeTestConfigs();

  it("dispatches API query to api skill", () => {
    const result = dispatchSkill("How to use the Viewer class API?", configs);
    expect(result.skill).toBe("api");
    expect(result.matchedKeywords.length).toBeGreaterThan(0);
  });

  it("dispatches bug report to debug skill", () => {
    const result = dispatchSkill("My scene is flickering and not working", configs);
    expect(result.skill).toBe("debug");
    expect(result.matchedKeywords.some((k) => k === "flickering" || k === "not working")).toBe(true);
  });

  it("dispatches performance query to performance skill", () => {
    const result = dispatchSkill("FPS is slow, need to optimize performance", configs);
    expect(result.skill).toBe("performance");
  });

  it("dispatches shader query to shader skill", () => {
    const result = dispatchSkill("How to write a custom GLSL fragment shader?", configs);
    expect(result.skill).toBe("shader");
  });

  it("falls back to general for unmatched queries", () => {
    const result = dispatchSkill("What is the weather today?", configs);
    expect(result.skill).toBe("general");
  });

  it("boosts debug score when problem pattern is matched", () => {
    const patterns = [makePattern()];
    const result = dispatchSkill("polygon flickering issue", configs, { patterns });
    expect(result.skill).toBe("debug");
    expect(result.extractedEntities.some((e) => e.type === "problem")).toBe(true);
  });

  it("boosts api score when symbol entity is found", () => {
    const result = dispatchSkill("How to use the Viewer.method API?", configs);
    expect(result.matchedKeywords.some((k) => k.startsWith("symbol:") || k === "api" || k === "how to use" || k === "method")).toBe(true);
  });

  it("returns confidence between 0 and 1", () => {
    const result = dispatchSkill("shader fragment glsl material", configs);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("extracts version entities", () => {
    const result = dispatchSkill("Bug in version 1.104", configs);
    expect(result.extractedEntities.some((e) => e.type === "version" && e.value === "1.104")).toBe(true);
  });
});

// ─── extractEntities ───────────────────────────────────────────

describe("extractEntities", () => {
  it("extracts version numbers", () => {
    const entities = extractEntities("Cesium 1.104 has a bug");
    expect(entities).toContainEqual({ type: "version", value: "1.104" });
  });

  it("extracts dotted symbol names", () => {
    const entities = extractEntities("Check Viewer.render and Scene.update");
    expect(entities).toContainEqual({ type: "symbol", value: "Viewer" });
    expect(entities).toContainEqual({ type: "symbol", value: "Scene" });
  });

  it("extracts stages by name match", () => {
    const stages = [makeStage({ id: "update_stage", name: "Update Stage" })];
    const entities = extractEntities("The Update Stage is slow", { stages });
    expect(entities).toContainEqual({ type: "stage", value: "update_stage" });
  });

  it("extracts stages by symptomHints", () => {
    const stages = [makeStage({ id: "render_pass", symptomHints: ["flickering"] })];
    const entities = extractEntities("The scene keeps flickering", { stages });
    expect(entities).toContainEqual({ type: "stage", value: "render_pass" });
  });

  it("extracts problem patterns", () => {
    const patterns = [makePattern()];
    const entities = extractEntities("z-fighting polygon flickering", { patterns });
    expect(entities.some((e) => e.type === "problem" && e.value === "z_fighting")).toBe(true);
  });

  it("deduplicates entities", () => {
    const entities = extractEntities("1.104 and 1.104 again");
    const versions = entities.filter((e) => e.type === "version" && e.value === "1.104");
    expect(versions).toHaveLength(1);
  });

  it("returns empty for no matches", () => {
    const entities = extractEntities("hello world");
    expect(entities).toHaveLength(0);
  });
});

// ─── estimateSkillTokens ───────────────────────────────────────

describe("estimateSkillTokens", () => {
  it("estimates tokens for minimal pack", () => {
    const pack = makePack();
    const tokens = estimateSkillTokens(pack);
    expect(tokens).toBeGreaterThan(0);
  });

  it("estimates more tokens for larger content", () => {
    const small = makePack();
    const large = makePack({
      source: [
        { symbol: "A", file: "a.js", lineStart: 1, lineEnd: 100, code: "x".repeat(4000) },
      ],
      issues: [
        {
          id: 1,
          repo: "r",
          number: 1,
          title: "Issue title",
          body: "y".repeat(2000),
          state: "open",
          labels: [],
          assignees: [],
          author: "a",
          comments: 0,
          createdAt: "",
          updatedAt: "",
          closedAt: null,
          htmlUrl: "",
        },
      ],
    });
    expect(estimateSkillTokens(large)).toBeGreaterThan(estimateSkillTokens(small));
  });

  it("includes diagnosis tokens when present", () => {
    const pack = makePack({
      diagnosis: {
        query: "test",
        matchedPatterns: [],
        renderStages: [],
        relatedSymbols: [],
        relatedSource: [],
        callgraph: [],
        relatedIssues: [],
        investigationSteps: ["Step 1", "Step 2"],
        fixSuggestions: ["Fix A", "Fix B"],
        metadata: { totalTokens: 0, truncated: false, tokenBudget: 6000 },
      },
    });
    const tokens = estimateSkillTokens(pack);
    expect(tokens).toBeGreaterThan(estimateSkillTokens(makePack()));
  });
});

// ─── truncateSkillPack ─────────────────────────────────────────

describe("truncateSkillPack", () => {
  it("does not truncate when under budget", () => {
    const pack = makePack();
    const result = truncateSkillPack(pack, 10000, "general");
    expect(result.metadata.truncated).toBe(false);
  });

  it("truncates when over budget", () => {
    const pack = makePack({
      source: [
        { symbol: "A", file: "a.js", lineStart: 1, lineEnd: 100, code: "x".repeat(8000) },
        { symbol: "B", file: "b.js", lineStart: 1, lineEnd: 50, code: "y".repeat(4000) },
      ],
      callgraph: Array.from({ length: 20 }, (_, i) => ({
        source: `fn${i}`,
        target: `fn${i + 1}`,
      })),
      issues: Array.from({ length: 10 }, (_, i) => ({
        id: i,
        repo: "r",
        number: i,
        title: `Issue ${i}`,
        body: "body ".repeat(200),
        state: "open" as const,
        labels: [],
        assignees: [],
        author: "a",
        comments: 0,
        createdAt: "",
        updatedAt: "",
        closedAt: null,
        htmlUrl: "",
      })),
    });
    const result = truncateSkillPack(pack, 500, "general");
    expect(result.metadata.truncated).toBe(true);
    expect(result.metadata.totalTokens).toBeLessThanOrEqual(500 + 200); // some tolerance for minimum pack
  });

  it("drops experience before forum", () => {
    const pack = makePack({
      experience: [
        { id: "e1", type: "issue", title: "Exp1", summary: "s".repeat(1000), symbols: [], qualityScore: 0.5, createdAt: "", sourceUrl: "" },
      ],
      forum: [
        { id: 1, topicId: 1, title: "Forum1", body: "b".repeat(500), author: "a", repliesCount: 5, viewsCount: 100, hasSolution: true, tags: [], createdAt: "", updatedAt: "", url: "", qualityScore: 0.8 },
      ],
      source: [{ symbol: "X", file: "x.js", lineStart: 1, lineEnd: 10, code: "z".repeat(8000) }],
    });
    const result = truncateSkillPack(pack, 500, "general");
    expect(result.experience).toHaveLength(0);
  });

  it("preserves metadata skill and budget", () => {
    const pack = makePack({ skill: "debug" });
    const result = truncateSkillPack(pack, 2000, "debug");
    expect(result.metadata.skill).toBe("debug");
    expect(result.metadata.tokenBudget).toBe(2000);
  });
});
