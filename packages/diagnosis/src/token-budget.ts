import type { DiagnosticContextPack } from "@cesium-nexus/shared";

const DEFAULT_BUDGET = 6000;

/**
 * Estimate token count from text length. ~4 chars per token.
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function truncateText(
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
 * Estimate total tokens for a DiagnosticContextPack.
 */
export function estimateDiagnosticTokens(
  pack: DiagnosticContextPack,
): number {
  let total = 0;

  // matched patterns (always kept)
  for (const m of pack.matchedPatterns) {
    total += estimateTokens(JSON.stringify(m.pattern.id)) + 10;
    total += estimateTokens(m.pattern.name);
    total += estimateTokens(JSON.stringify(m.pattern.possibleCauses));
    total += 10; // overhead
  }

  // related symbols (names always kept)
  for (const s of pack.relatedSymbols) {
    total += estimateTokens(s.name) + estimateTokens(s.kind) + 10;
  }

  // related source
  for (const s of pack.relatedSource) {
    total += estimateTokens(s.code) + 20;
  }

  // related issues
  for (const i of pack.relatedIssues) {
    total += estimateTokens(i.title) + estimateTokens(i.body) + 30;
  }

  // callgraph
  total += estimateTokens(JSON.stringify(pack.callgraph));

  // render stages
  for (const r of pack.renderStages) {
    total += estimateTokens(r.name) + estimateTokens(r.description) + 10;
  }

  // investigation steps
  for (const step of pack.investigationSteps) {
    total += estimateTokens(step);
  }

  // fix suggestions
  for (const fix of pack.fixSuggestions) {
    total += estimateTokens(fix);
  }

  return total;
}

/**
 * Truncate a DiagnosticContextPack to fit within the token budget.
 *
 * Truncation order (least valuable first):
 *   1. related source
 *   2. related issue bodies
 *   3. callgraph
 *   4. render stage descriptions
 *   5. fix suggestions (truncate text, keep count)
 *   6. investigation steps (truncate text, keep count)
 *
 * Always preserved: matched pattern id/name/possibleCauses,
 * related symbol names, investigation steps, fix suggestions, metadata.
 */
export function truncateDiagnosticPack(
  pack: DiagnosticContextPack,
  budget: number = DEFAULT_BUDGET,
): DiagnosticContextPack {
  let truncated = false;
  let result = { ...pack };

  // ── 1. Truncate related source (drop from last) ──────────
  if (estimateDiagnosticTokens(result) > budget && result.relatedSource.length > 0) {
    const sources = [...result.relatedSource];
    while (sources.length > 0 && estimateDiagnosticTokens({ ...result, relatedSource: sources }) > budget) {
      sources.pop();
    }
    if (sources.length < result.relatedSource.length) truncated = true;
    result = { ...result, relatedSource: sources };
  }

  // ── 2. Truncate issue bodies ──────────────────────────────
  if (estimateDiagnosticTokens(result) > budget && result.relatedIssues.length > 0) {
    const issues = result.relatedIssues.map((issue) => {
      const bodyTokens = estimateTokens(issue.body);
      const overhead = estimateTokens(issue.title) + 30;
      const maxBody = Math.max(0, Math.floor(budget / result.relatedIssues.length) - overhead);
      if (bodyTokens > maxBody && maxBody > 0) {
        truncated = true;
        const r = truncateText(issue.body, maxBody);
        return { ...issue, body: r.text };
      }
      return issue;
    });
    result = { ...result, relatedIssues: issues };
  }

  // ── 2b. Drop issues from last ─────────────────────────────
  if (estimateDiagnosticTokens(result) > budget && result.relatedIssues.length > 0) {
    const issues = [...result.relatedIssues];
    while (issues.length > 0 && estimateDiagnosticTokens({ ...result, relatedIssues: issues }) > budget) {
      issues.pop();
    }
    if (issues.length < result.relatedIssues.length) truncated = true;
    result = { ...result, relatedIssues: issues };
  }

  // ── 3. Truncate callgraph (drop edges from last) ──────────
  if (estimateDiagnosticTokens(result) > budget && result.callgraph.length > 0) {
    const edges = [...result.callgraph];
    while (edges.length > 0 && estimateDiagnosticTokens({ ...result, callgraph: edges }) > budget) {
      edges.pop();
    }
    if (edges.length < result.callgraph.length) truncated = true;
    result = { ...result, callgraph: edges };
  }

  // ── 4. Truncate render stage descriptions ─────────────────
  if (estimateDiagnosticTokens(result) > budget && result.renderStages.length > 0) {
    const stages = result.renderStages.map((stage) => {
      const descTokens = estimateTokens(stage.description);
      if (descTokens > 50) {
        truncated = true;
        const r = truncateText(stage.description, 50);
        return { ...stage, description: r.text };
      }
      return stage;
    });
    result = { ...result, renderStages: stages };
  }

  // ── 4b. Drop render stages from last ──────────────────────
  if (estimateDiagnosticTokens(result) > budget && result.renderStages.length > 0) {
    const stages = [...result.renderStages];
    while (stages.length > 0 && estimateDiagnosticTokens({ ...result, renderStages: stages }) > budget) {
      stages.pop();
    }
    if (stages.length < result.renderStages.length) truncated = true;
    result = { ...result, renderStages: stages };
  }

  // ── 5. Truncate fix suggestion text ───────────────────────
  if (estimateDiagnosticTokens(result) > budget && result.fixSuggestions.length > 0) {
    const fixes = result.fixSuggestions.map((fix) => {
      const fixTokens = estimateTokens(fix);
      if (fixTokens > 40) {
        truncated = true;
        const r = truncateText(fix, 40);
        return r.text;
      }
      return fix;
    });
    result = { ...result, fixSuggestions: fixes };
  }

  // ── 6. Truncate investigation step text ───────────────────
  if (estimateDiagnosticTokens(result) > budget && result.investigationSteps.length > 0) {
    const steps = result.investigationSteps.map((step) => {
      const stepTokens = estimateTokens(step);
      if (stepTokens > 40) {
        truncated = true;
        const r = truncateText(step, 40);
        return r.text;
      }
      return step;
    });
    result = { ...result, investigationSteps: steps };
  }

  // ── 7. Final hard-cap enforcement ───────────────────────────
  // If still over budget, progressively drop optional sections.
  if (estimateDiagnosticTokens(result) > budget) {
    if (result.fixSuggestions.length > 0) {
      truncated = true;
      result = { ...result, fixSuggestions: [] };
    }
  }
  if (estimateDiagnosticTokens(result) > budget) {
    if (result.investigationSteps.length > 0) {
      truncated = true;
      result = { ...result, investigationSteps: [] };
    }
  }

  // Compute minimum possible tokens (pattern info + symbol names only)
  const minimumPack: DiagnosticContextPack = {
    ...result,
    relatedSource: [],
    relatedIssues: [],
    callgraph: [],
    renderStages: [],
    investigationSteps: [],
    fixSuggestions: [],
    metadata: { totalTokens: 0, truncated: false, tokenBudget: budget },
  };
  const minimumPossibleTokens = estimateDiagnosticTokens(minimumPack);
  const finalTokens = estimateDiagnosticTokens(result);
  const unavoidableOverflow = finalTokens > budget;

  return {
    ...result,
    metadata: {
      totalTokens: finalTokens,
      truncated,
      tokenBudget: budget,
      ...(unavoidableOverflow ? { unavoidableOverflow: true, minimumPossibleTokens } : {}),
    },
  };
}
