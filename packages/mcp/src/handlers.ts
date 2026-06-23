import type { SymbolRepo } from "@cesium-nexus/storage";
import type { IssueRepo } from "@cesium-nexus/storage";
import type { CallGraphRepo } from "@cesium-nexus/storage";
import type { PullRequestRepo } from "@cesium-nexus/storage";
import type { ForumRepo } from "@cesium-nexus/storage";
import type { ExperienceRepo } from "@cesium-nexus/storage";
import type { ExperienceEdgeRepo } from "@cesium-nexus/storage";
import { resolveSymbolId } from "@cesium-nexus/storage";
import { buildContextPack } from "@cesium-nexus/context-pack";
import {
  loadProblemPatterns,
  loadRenderStages,
  diagnoseProblem,
  queryRenderStages,
} from "@cesium-nexus/diagnosis";
import {
  loadSkillConfigs,
  dispatchSkill,
  buildSkillContextPack,
} from "@cesium-nexus/skills";
import { getExperienceChain } from "@cesium-nexus/indexer";

export interface ToolResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ─── search_symbol ─────────────────────────────────────────

export async function handleSearchSymbol(
  symbolRepo: SymbolRepo,
  input: { query: string; limit?: number },
): Promise<ToolResponse> {
  try {
    const limit = input.limit ?? 10;
    const results = symbolRepo.searchFts(input.query, limit);
    return {
      success: true,
      data: {
        query: input.query,
        count: results.length,
        results: results.map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.kind,
          filePath: s.filePath,
          startLine: s.startLine,
          endLine: s.endLine,
          docComment: s.docComment ?? null,
          parentClass: s.parentClass ?? null,
        })),
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── get_source ────────────────────────────────────────────

export async function handleGetSource(
  symbolRepo: SymbolRepo,
  input: { symbol_id: string },
): Promise<ToolResponse> {
  try {
    const symbol = symbolRepo.findById(input.symbol_id);
    if (!symbol) {
      return { success: false, error: `Symbol not found: ${input.symbol_id}` };
    }

    const source = symbolRepo.getSourceBySymbolId(input.symbol_id);
    if (!source) {
      return {
        success: false,
        error: `Source code not available for symbol: ${symbol.name}`,
      };
    }

    return {
      success: true,
      data: {
        symbolId: source.symbolId,
        name: source.name,
        filePath: source.filePath,
        startLine: source.startLine,
        endLine: source.endLine,
        code: source.code,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── search_issue ──────────────────────────────────────────

export async function handleSearchIssue(
  issueRepo: IssueRepo,
  input: { query: string; limit?: number; state?: "open" | "closed" },
): Promise<ToolResponse> {
  try {
    const limit = input.limit ?? 10;
    const results = issueRepo.searchFts(input.query, {
      limit,
      state: input.state,
    });
    return {
      success: true,
      data: {
        query: input.query,
        count: results.length,
        results: results.map((r) => ({
          id: r.issue.id,
          repo: r.issue.repo,
          number: r.issue.number,
          title: r.issue.title,
          state: r.issue.state,
          labels: r.issue.labels,
          author: r.issue.author,
          comments: r.issue.comments,
          createdAt: r.issue.createdAt,
          updatedAt: r.issue.updatedAt,
          htmlUrl: r.issue.htmlUrl,
          score: r.score,
        })),
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── trace_callgraph ───────────────────────────────────────

export async function handleTraceCallgraph(
  symbolRepo: SymbolRepo,
  callGraphRepo: CallGraphRepo,
  input: { symbol: string; direction?: "down" | "up"; depth?: number },
): Promise<ToolResponse> {
  try {
    const direction = input.direction ?? "down";
    const depth = input.depth ?? 2;

    const resolved = resolveSymbolId(input.symbol, symbolRepo);
    if (!resolved) {
      return { success: false, error: `Symbol not found: ${input.symbol}` };
    }

    const edges =
      direction === "down"
        ? callGraphRepo.getDownstream(resolved.id, depth)
        : callGraphRepo.getUpstream(resolved.id, depth);

    return {
      success: true,
      data: {
        symbol: resolved.displayName,
        direction,
        depth,
        count: edges.length,
        edges: edges.map((e) => ({
          sourceId: e.sourceId,
          targetId: e.targetId,
          sourceName: e.sourceName,
          targetName: e.targetName,
          edgeType: e.edgeType,
          weight: e.weight,
        })),
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── build_context_pack ─────────────────────────────────────

export async function handleBuildContextPack(
  symbolRepo: SymbolRepo,
  callGraphRepo: CallGraphRepo,
  issueRepo: IssueRepo,
  input: { symbol: string; depth?: number; budget?: number },
): Promise<ToolResponse> {
  try {
    const result = buildContextPack(symbolRepo, callGraphRepo, issueRepo, {
      symbol: input.symbol,
      depth: input.depth,
      tokenBudget: input.budget,
    });

    if ("error" in result) {
      return { success: false, error: result.error };
    }

    return { success: true, data: result };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── diagnose_problem ──────────────────────────────────────

export async function handleDiagnoseProblem(
  symbolRepo: SymbolRepo,
  callGraphRepo: CallGraphRepo,
  issueRepo: IssueRepo,
  input: { problem: string; limit?: number; budget?: number },
): Promise<ToolResponse> {
  try {
    const patterns = await loadProblemPatterns();
    const stages = await loadRenderStages();

    const result = await diagnoseProblem({
      query: input.problem,
      patterns,
      stages,
      symbolRepo,
      callGraphRepo,
      issueRepo,
      limit: input.limit,
      budget: input.budget,
    });

    return { success: true, data: result };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── search_forum ─────────────────────────────────────────

export async function handleSearchForum(
  forumRepo: ForumRepo,
  input: { query: string; limit?: number; minQuality?: number },
): Promise<ToolResponse> {
  try {
    const limit = input.limit ?? 10;
    const results = forumRepo.searchFts(input.query, {
      limit,
      minQuality: input.minQuality,
    });
    return {
      success: true,
      data: {
        query: input.query,
        count: results.length,
        results: results.map((r) => ({
          id: r.post.id,
          topicId: r.post.topicId,
          title: r.post.title,
          author: r.post.author,
          repliesCount: r.post.repliesCount,
          viewsCount: r.post.viewsCount,
          hasSolution: r.post.hasSolution,
          tags: r.post.tags,
          url: r.post.url,
          qualityScore: r.post.qualityScore,
          score: r.score,
        })),
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── search_experience ────────────────────────────────────

export async function handleSearchExperience(
  experienceRepo: ExperienceRepo,
  input: {
    query: string;
    limit?: number;
    type?: "issue" | "pr_review" | "forum";
    symbol?: string;
    minQuality?: number;
  },
): Promise<ToolResponse> {
  try {
    const limit = input.limit ?? 10;
    const results = experienceRepo.searchFts(input.query, {
      limit,
      type: input.type,
      symbol: input.symbol,
      minQuality: input.minQuality,
    });
    return {
      success: true,
      data: {
        query: input.query,
        count: results.length,
        results: results.map((r) => ({
          id: r.node.id,
          type: r.node.type,
          title: r.node.title,
          url: r.node.url,
          source: r.node.source,
          summary: r.node.summary,
          relatedSymbols: r.node.relatedSymbols,
          tags: r.node.tags,
          qualityScore: r.node.qualityScore,
          score: r.score,
        })),
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── dispatch_skill ───────────────────────────────────────

export async function handleDispatchSkill(
  symbolRepo: SymbolRepo,
  input: { query: string },
): Promise<ToolResponse> {
  try {
    const configs = await loadSkillConfigs();
    const patterns = await loadProblemPatterns();
    const stages = await loadRenderStages();

    const result = dispatchSkill(input.query, configs, {
      symbolRepo,
      stages,
      patterns,
    });

    return { success: true, data: result };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── build_skill_pack ─────────────────────────────────────

export async function handleBuildSkillPack(
  symbolRepo: SymbolRepo,
  callGraphRepo: CallGraphRepo,
  issueRepo: IssueRepo,
  prRepo: PullRequestRepo,
  forumRepo: ForumRepo,
  experienceRepo: ExperienceRepo,
  input: { query: string; budget?: number },
): Promise<ToolResponse> {
  try {
    const configs = await loadSkillConfigs();
    const patterns = await loadProblemPatterns();
    const stages = await loadRenderStages();

    const result = await buildSkillContextPack({
      query: input.query,
      symbolRepo,
      callGraphRepo,
      issueRepo,
      prRepo,
      forumRepo,
      experienceRepo,
      patterns,
      stages,
      configs,
      budget: input.budget,
    });

    return { success: true, data: result };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function handleQueryRenderStage(
  input: { stageId?: string; problemId?: string },
): Promise<ToolResponse> {
  try {
    const patterns = await loadProblemPatterns();
    const stages = await loadRenderStages();

    const result = queryRenderStages({
      stageId: input.stageId,
      problemId: input.problemId,
      patterns,
      stages,
    });

    return {
      success: true,
      data: {
        count: result.length,
        stages: result,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── get_experience_chain ─────────────────────────────────

export async function handleGetExperienceChain(
  experienceRepo: ExperienceRepo,
  edgeRepo: ExperienceEdgeRepo,
  input: { nodeId: string; maxDepth?: number },
): Promise<ToolResponse> {
  try {
    const maxDepth = input.maxDepth ?? 3;
    const chain = getExperienceChain(
      input.nodeId,
      experienceRepo,
      edgeRepo,
      maxDepth,
    );

    return {
      success: true,
      data: {
        rootId: chain.rootId,
        nodeCount: chain.nodes.length,
        edgeCount: chain.edges.length,
        depth: chain.depth,
        truncated: chain.truncated,
        nodes: chain.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          url: n.url,
          qualityScore: n.qualityScore,
        })),
        edges: chain.edges.map((e) => ({
          id: e.id,
          sourceNodeId: e.sourceNodeId,
          targetNodeId: e.targetNodeId,
          edgeType: e.edgeType,
          confidence: e.confidence,
        })),
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── semantic_search_experience ───────────────────────────

export async function handleSemanticSearchExperience(
  input: { query: string; limit?: number; minScore?: number; type?: string },
): Promise<ToolResponse> {
  try {
    const { getQdrantClient, searchExperienceSemantic } = await import(
      "@cesium-nexus/vector"
    );
    const client = getQdrantClient();
    const results = await searchExperienceSemantic(input.query, client, {
      limit: input.limit,
      minScore: input.minScore,
      type: input.type,
    });

    return {
      success: true,
      data: {
        query: input.query,
        count: results.length,
        results: results.map((r) => ({
          nodeId: r.nodeId,
          nodeType: r.nodeType,
          title: r.title,
          url: r.url,
          score: r.score,
        })),
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
