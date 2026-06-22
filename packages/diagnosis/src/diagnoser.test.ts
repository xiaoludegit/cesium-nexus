import { describe, it, expect, vi, beforeAll } from "vitest";
import { diagnoseProblem, queryRenderStages } from "./diagnoser.js";
import { loadProblemPatterns, loadRenderStages } from "./knowledge-loader.js";
import type {
  ProblemPattern,
  RenderStage,
  SymbolRecord,
  CallEdge,
  IssueRecord,
  IssueSearchResult,
} from "@cesium-nexus/shared";
import type { SymbolRepo, CallGraphRepo, IssueRepo } from "@cesium-nexus/storage";

function makeMockRepos() {
  const symbolRepo = {
    findByName: vi.fn((name: string): SymbolRecord[] => {
      if (name === "PolygonGeometry") {
        return [
          {
            id: "sym-polygon",
            name: "PolygonGeometry",
            kind: "class",
            filePath: "Scene/PolygonGeometry.js",
            startLine: 1,
            endLine: 100,
            docComment: "Polygon geometry",
            exports: [],
            imports: [],
          },
        ];
      }
      if (name === "Scene") {
        return [
          {
            id: "sym-scene",
            name: "Scene",
            kind: "class",
            filePath: "Scene/Scene.js",
            startLine: 1,
            endLine: 500,
            docComment: "The Scene",
            exports: [],
            imports: [],
          },
        ];
      }
      return [];
    }),
    getSourceBySymbolId: vi.fn((id: string) => {
      if (id === "sym-polygon") {
        return {
          symbolId: "sym-polygon",
          name: "PolygonGeometry",
          filePath: "Scene/PolygonGeometry.js",
          startLine: 1,
          endLine: 100,
          code: "function PolygonGeometry(options) { this.width = options.width; }",
        };
      }
      return undefined;
    }),
  } as unknown as SymbolRepo;

  const callGraphRepo = {
    getDownstream: vi.fn((_id: string, _depth?: number): CallEdge[] => {
      if (_id === "sym-polygon") {
        return [
          {
            sourceId: "sym-polygon",
            targetId: "sym-scene",
            sourceName: "PolygonGeometry",
            targetName: "Scene",
            edgeType: "call",
          },
        ];
      }
      return [];
    }),
  } as unknown as CallGraphRepo;

  const issueRepo = {
    searchFts: vi.fn((_query: string, _opts?: object): IssueSearchResult[] => {
      const issue: IssueRecord = {
        id: 100,
        repo: "CesiumGS/cesium",
        number: 9999,
        title: "Z-fighting on polygon geometry",
        body: "Polygons flicker when overlapping terrain.",
        state: "open",
        labels: ["bug"],
        assignees: [],
        author: "user",
        comments: 2,
        createdAt: "2024-01-01",
        updatedAt: "2024-06-01",
        closedAt: null,
        htmlUrl: "https://github.com/CesiumGS/cesium/issues/9999",
      };
      return [{ issue, score: -1.5 }];
    }),
  } as unknown as IssueRepo;

  return { symbolRepo, callGraphRepo, issueRepo };
}

describe("diagnoseProblem", () => {
  let patterns: ProblemPattern[];
  let stages: RenderStage[];

  beforeAll(async () => {
    patterns = await loadProblemPatterns();
    stages = await loadRenderStages();
  });

  it("should return empty pack for no-match query", async () => {
    const repos = makeMockRepos();
    const result = await diagnoseProblem({
      query: "what is the weather today",
      patterns,
      stages,
      ...repos,
    });
    expect(result.kind).toBe("diagnosis");
    expect(result.matchedPatterns).toEqual([]);
    expect(result.relatedSymbols).toEqual([]);
  });

  it("should diagnose polygon flickering", async () => {
    const repos = makeMockRepos();
    const result = await diagnoseProblem({
      query: "polygon flickering",
      patterns,
      stages,
      ...repos,
    });

    expect(result.matchedPatterns.length).toBeGreaterThan(0);
    expect(result.matchedPatterns[0].pattern.id).toBe("z_fighting");
    expect(result.relatedSymbols.length).toBeGreaterThan(0);
    expect(result.investigationSteps.length).toBeGreaterThan(0);
    expect(result.fixSuggestions.length).toBeGreaterThan(0);
    expect(result.renderStages.length).toBeGreaterThan(0);
    expect(result.metadata.tokenBudget).toBe(6000);
  });

  it("should resolve symbols from patterns", async () => {
    const repos = makeMockRepos();
    await diagnoseProblem({
      query: "polygon flickering",
      patterns,
      stages,
      ...repos,
    });

    // findByName should have been called for pattern related symbols
    expect(repos.symbolRepo.findByName).toHaveBeenCalled();
    expect(repos.symbolRepo.findByName).toHaveBeenCalledWith("PolygonGeometry");
  });

  it("should get callgraph edges", async () => {
    const repos = makeMockRepos();
    const result = await diagnoseProblem({
      query: "polygon flickering",
      patterns,
      stages,
      ...repos,
    });

    expect(repos.callGraphRepo.getDownstream).toHaveBeenCalled();
    // PolygonGeometry has downstream to Scene
    if (result.relatedSymbols.some((s) => s.name === "PolygonGeometry")) {
      expect(result.callgraph.length).toBeGreaterThan(0);
    }
  });

  it("should search issues from issueQueries", async () => {
    const repos = makeMockRepos();
    const result = await diagnoseProblem({
      query: "polygon flickering",
      patterns,
      stages,
      ...repos,
    });

    expect(repos.issueRepo.searchFts).toHaveBeenCalled();
    expect(result.relatedIssues.length).toBeGreaterThan(0);
  });

  it("should deduplicate investigation steps and fix suggestions", async () => {
    const repos = makeMockRepos();
    const result = await diagnoseProblem({
      query: "polygon flickering depth precision",
      patterns,
      stages,
      ...repos,
    });

    const uniqueSteps = new Set(result.investigationSteps);
    expect(uniqueSteps.size).toBe(result.investigationSteps.length);

    const uniqueFixes = new Set(result.fixSuggestions);
    expect(uniqueFixes.size).toBe(result.fixSuggestions.length);
  });
});

describe("queryRenderStages", () => {
  let patterns: ProblemPattern[];
  let stages: RenderStage[];

  beforeAll(async () => {
    patterns = await loadProblemPatterns();
    stages = await loadRenderStages();
  });

  it("should query by stageId", () => {
    const result = queryRenderStages({
      stageId: "depth_pass",
      patterns,
      stages,
    });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("depth_pass");
  });

  it("should query by problemId", () => {
    const result = queryRenderStages({
      problemId: "z_fighting",
      patterns,
      stages,
    });
    expect(result.length).toBeGreaterThan(0);
    const ids = result.map((s) => s.id);
    expect(ids).toContain("depth_pass");
  });

  it("should return empty for unknown stageId", () => {
    const result = queryRenderStages({
      stageId: "nonexistent",
      patterns,
      stages,
    });
    expect(result).toEqual([]);
  });

  it("should return empty for unknown problemId", () => {
    const result = queryRenderStages({
      problemId: "nonexistent",
      patterns,
      stages,
    });
    expect(result).toEqual([]);
  });

  it("should return empty when neither stageId nor problemId provided", () => {
    const result = queryRenderStages({ patterns, stages });
    expect(result).toEqual([]);
  });
});
