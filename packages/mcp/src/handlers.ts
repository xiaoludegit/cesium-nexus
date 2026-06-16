import type { SymbolRepo } from "@cesium-nexus/storage";
import type { IssueRepo } from "@cesium-nexus/storage";
import type { CallGraphRepo } from "@cesium-nexus/storage";
import { resolveSymbolId } from "@cesium-nexus/storage";
import { buildContextPack } from "@cesium-nexus/context-pack";

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
