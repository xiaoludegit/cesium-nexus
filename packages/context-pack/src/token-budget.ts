import type { ContextPack } from "@cesium-nexus/shared";

/**
 * Estimate token count from text length.
 * English: ~4 chars per token. This is a simple heuristic.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within maxTokens.
 * Returns truncated text and whether truncation occurred.
 */
export function truncateText(
  text: string,
  maxTokens: number,
): { text: string; truncated: boolean } {
  if (maxTokens <= 0) {
    return { text: "", truncated: text.length > 0 };
  }
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, maxChars) + "\n... [truncated]",
    truncated: true,
  };
}

/**
 * Estimate total tokens for a complete ContextPack.
 */
export function estimatePackTokens(pack: ContextPack): number {
  let total = 0;

  // symbol section
  total += estimateTokens(JSON.stringify(pack.symbol));

  // source section
  for (const s of pack.source) {
    total += estimateTokens(s.code) + 20; // 20 tokens overhead for metadata
  }

  // callgraph section
  total += estimateTokens(JSON.stringify(pack.callgraph));

  // issues section
  for (const i of pack.issues) {
    total += estimateTokens(i.title) + estimateTokens(i.body) + 30;
  }

  return total;
}

// ─── Section budgets ───────────────────────────────────────

const SECTION_BUDGETS = {
  symbol: 500,
  source: 3000,
  callgraph: 500,
  issues: 1000,
};

/**
 * Truncate a ContextPack to fit within the total token budget.
 *
 * Priority: source > issues > callgraph > symbol
 * Symbol is always kept (truncated docComment only).
 * Source is truncated from downstream snippets first.
 */
export function truncateContextPack(
  pack: ContextPack,
  budget: number,
): ContextPack {
  let truncated = false;

  // ── 1. Symbol section (budget: 500) ────────────────────
  const symbolJson = JSON.stringify(pack.symbol);
  if (estimateTokens(symbolJson) > SECTION_BUDGETS.symbol) {
    const sym = { ...pack.symbol };
    if (sym.docComment) {
      const result = truncateText(sym.docComment, SECTION_BUDGETS.symbol - 50);
      sym.docComment = result.text;
      if (result.truncated) truncated = true;
    }
    pack = { ...pack, symbol: sym };
  }

  // ── 2. Source section (budget: 3000) ───────────────────
  // Keep main symbol source, truncate downstream from last to first
  let sourceTokens = 0;
  const keptSources = [];

  for (let i = 0; i < pack.source.length; i++) {
    const snippet = pack.source[i];
    const snippetTokens = estimateTokens(snippet.code) + 20;

    if (i === 0) {
      // Main symbol source — always keep, but truncate if huge
      if (snippetTokens > SECTION_BUDGETS.source) {
        const result = truncateText(snippet.code, SECTION_BUDGETS.source - 20);
        keptSources.push({ ...snippet, code: result.text });
        truncated = true;
      } else {
        keptSources.push(snippet);
      }
      sourceTokens += Math.min(snippetTokens, SECTION_BUDGETS.source);
    } else {
      // Downstream source — only add if within budget
      if (sourceTokens + snippetTokens <= SECTION_BUDGETS.source) {
        keptSources.push(snippet);
        sourceTokens += snippetTokens;
      } else {
        // Try truncating this downstream source
        const remaining = SECTION_BUDGETS.source - sourceTokens;
        if (remaining > 100) {
          const result = truncateText(snippet.code, remaining - 20);
          keptSources.push({ ...snippet, code: result.text });
          sourceTokens += remaining;
        }
        truncated = true;
      }
    }
  }

  pack = { ...pack, source: keptSources };

  // ── 3. Callgraph section (budget: 500) ─────────────────
  const callgraphJson = JSON.stringify(pack.callgraph);
  if (estimateTokens(callgraphJson) > SECTION_BUDGETS.callgraph) {
    // Reduce edges
    const edges = [...pack.callgraph];
    while (
      edges.length > 0 &&
      estimateTokens(JSON.stringify(edges)) > SECTION_BUDGETS.callgraph
    ) {
      edges.pop();
    }
    pack = { ...pack, callgraph: edges };
    truncated = true;
  }

  // ── 4. Issues section (budget: 1000) ───────────────────
  let issueTokens = 0;
  const keptIssues = [];

  for (const issue of pack.issues) {
    const thisIssueTokens =
      estimateTokens(issue.title) + estimateTokens(issue.body) + 30;

    if (issueTokens + thisIssueTokens <= SECTION_BUDGETS.issues) {
      keptIssues.push(issue);
      issueTokens += thisIssueTokens;
    } else {
      // Try truncating body
      const remaining = SECTION_BUDGETS.issues - issueTokens;
      if (remaining > 100) {
        const result = truncateText(issue.body, remaining - 30);
        keptIssues.push({ ...issue, body: result.text });
        issueTokens += remaining;
      }
      truncated = true;
    }
  }

  pack = { ...pack, issues: keptIssues };

  // ── Phase 2: Total budget enforcement ──────────────────
  // Section-level truncation above uses fixed section budgets (~5000 tokens).
  // If the caller passed a smaller budget, we need to keep trimming until
  // estimatePackTokens(pack) <= budget.
  //
  // Trimming order (least valuable first):
  //   1. Drop downstream source snippets (keep index 0)
  //   2. Truncate main source code
  //   3. Drop issues (from last to first)
  //   4. Drop callgraph edges (from last to first)
  //   5. Shrink symbol docComment

  let totalTokens = estimatePackTokens(pack);

  if (totalTokens > budget) {
    truncated = true;

    // 1. Drop downstream sources (index > 0), last first
    const sources = [...pack.source];
    while (sources.length > 1 && estimatePackTokens({ ...pack, source: sources }) > budget) {
      sources.pop();
      pack = { ...pack, source: sources };
    }
    totalTokens = estimatePackTokens(pack);

    // 2. Truncate main source code
    if (totalTokens > budget && pack.source.length > 0) {
      const main = pack.source[0];
      const overheadTokens = totalTokens - (estimateTokens(main.code) + 20);
      const maxMainTokens = Math.max(0, budget - overheadTokens);
      if (maxMainTokens < estimateTokens(main.code) + 20) {
        const result = truncateText(main.code, Math.max(0, maxMainTokens));
        pack = { ...pack, source: [{ ...main, code: result.text }] };
        totalTokens = estimatePackTokens(pack);
      }
    }

    // 3. Drop issues (from last to first)
    const issues = [...pack.issues];
    while (issues.length > 0 && estimatePackTokens({ ...pack, issues }) > budget) {
      issues.pop();
      pack = { ...pack, issues };
    }
    totalTokens = estimatePackTokens(pack);

    // 4. Drop callgraph edges (from last to first)
    const edges = [...pack.callgraph];
    while (edges.length > 0 && estimatePackTokens({ ...pack, callgraph: edges }) > budget) {
      edges.pop();
      pack = { ...pack, callgraph: edges };
    }
    totalTokens = estimatePackTokens(pack);

    // 5. Shrink symbol docComment
    if (totalTokens > budget && pack.symbol.docComment) {
      const symOverhead = totalTokens - estimateTokens(pack.symbol.docComment);
      const maxDocTokens = Math.max(0, budget - symOverhead);
      const result = truncateText(pack.symbol.docComment, maxDocTokens);
      pack = { ...pack, symbol: { ...pack.symbol, docComment: result.text } };
      totalTokens = estimatePackTokens(pack);
    }

    // 6. Strip optional symbol fields (exports, imports, parentClass)
    if (totalTokens > budget) {
      const sym = { ...pack.symbol, exports: [], imports: [], parentClass: undefined, docComment: undefined };
      pack = { ...pack, symbol: sym };
      totalTokens = estimatePackTokens(pack);
    }
  }

  // Attach metadata
  const finalTokens = estimatePackTokens(pack);
  const unavoidableOverflow = finalTokens > budget;

  return {
    ...pack,
    metadata: {
      totalTokens: finalTokens,
      truncated,
      symbolResolved: pack.symbol.parentClass
        ? `${pack.symbol.parentClass}.${pack.symbol.name}`
        : pack.symbol.name,
      tokenBudget: budget,
      ...(unavoidableOverflow && {
        unavoidableOverflow: true,
        minimumPossibleTokens: finalTokens,
      }),
    },
  };
}
