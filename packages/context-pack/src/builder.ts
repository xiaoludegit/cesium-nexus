import type {
  ContextPack,
  SourceSnippet,
  Edge,
  IssueRecord,
} from "@cesium-nexus/shared";
import {
  SymbolRepo,
  CallGraphRepo,
  IssueRepo,
  resolveSymbolId,
} from "@cesium-nexus/storage";
import { truncateContextPack } from "./token-budget.js";

export interface BuildOptions {
  /** User input symbol name (e.g. "Primitive.update" or "Viewer") */
  symbol: string;
  /** Call graph traversal depth (default: 2) */
  depth?: number;
  /** Max number of related issues (default: 5) */
  issueLimit?: number;
  /** Max downstream source snippets to include (default: 3) */
  maxDownstreamSources?: number;
  /** Total token budget (default: 5000) */
  tokenBudget?: number;
}

export interface BuildError {
  error: string;
}

/**
 * Build a Context Pack for a given Cesium symbol.
 *
 * Assembles 4 sections: symbol metadata, source code, call graph edges,
 * and related GitHub issues. Applies token budget truncation.
 */
export function buildContextPack(
  symbolRepo: SymbolRepo,
  callGraphRepo: CallGraphRepo,
  issueRepo: IssueRepo,
  options: BuildOptions,
): ContextPack | BuildError {
  const {
    symbol,
    depth = 2,
    issueLimit = 5,
    maxDownstreamSources = 3,
    tokenBudget = 5000,
  } = options;

  // ── 1. Resolve symbol ────────────────────────────────────
  const resolved = resolveSymbolId(symbol, symbolRepo);
  if (!resolved) {
    return { error: `Symbol not found: ${symbol}` };
  }

  const symbolRecord = symbolRepo.findById(resolved.id);
  if (!symbolRecord) {
    return { error: `Symbol record missing: ${resolved.id}` };
  }

  // ── 2. Collect source code ───────────────────────────────
  const sources: SourceSnippet[] = [];

  // Main symbol source
  const mainSource = symbolRepo.getSourceBySymbolId(resolved.id);
  if (mainSource) {
    sources.push({
      symbol: resolved.displayName,
      file: mainSource.filePath,
      lineStart: mainSource.startLine,
      lineEnd: mainSource.endLine,
      code: mainSource.code,
    });
  }

  // ── 3. Collect call graph ────────────────────────────────
  const edges = callGraphRepo.getDownstream(resolved.id, depth);
  const callgraph: Edge[] = edges.map((e) => ({
    source: e.sourceName,
    target: e.targetName,
  }));

  // Downstream sources (unique targets)
  const seenTargetIds = new Set<string>();
  let downstreamCount = 0;

  for (const edge of edges) {
    if (
      downstreamCount >= maxDownstreamSources ||
      seenTargetIds.has(edge.targetId)
    ) {
      continue;
    }
    seenTargetIds.add(edge.targetId);

    const targetSource = symbolRepo.getSourceBySymbolId(edge.targetId);
    if (targetSource) {
      sources.push({
        symbol: edge.targetName,
        file: targetSource.filePath,
        lineStart: targetSource.startLine,
        lineEnd: targetSource.endLine,
        code: targetSource.code,
      });
      downstreamCount++;
    }
  }

  // ── 4. Search related issues ─────────────────────────────
  const searchQuery = symbolRecord.parentClass ?? symbolRecord.name;
  const issueResults = issueRepo.searchFts(searchQuery, {
    limit: issueLimit,
  });
  const issues: IssueRecord[] = issueResults.map((r) => r.issue);

  // ── 5. Assemble and truncate ─────────────────────────────
  const rawPack: ContextPack = {
    symbol: symbolRecord,
    source: sources,
    callgraph,
    issues,
  };

  return truncateContextPack(rawPack, tokenBudget);
}
