import type { SkillContextPack, SkillId } from "@cesium-nexus/shared";

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateSkillTokens(pack: SkillContextPack): number {
  let total = 0;

  total += estimateTokens(pack.query) + 20;
  total += estimateTokens(JSON.stringify(pack.dispatch)) + 10;

  if (pack.symbol) {
    total += estimateTokens(JSON.stringify(pack.symbol));
  }

  for (const s of pack.source) {
    total += estimateTokens(s.code) + 20;
  }

  total += estimateTokens(JSON.stringify(pack.callgraph));

  for (const i of pack.issues) {
    total += estimateTokens(i.title) + estimateTokens(i.body) + 30;
  }

  if (pack.renderStages) {
    for (const r of pack.renderStages) {
      total += estimateTokens(r.name) + estimateTokens(r.description) + 10;
    }
  }

  if (pack.diagnosis) {
    total += estimateTokens(JSON.stringify(pack.diagnosis.matchedPatterns));
    for (const step of pack.diagnosis.investigationSteps) {
      total += estimateTokens(step);
    }
    for (const fix of pack.diagnosis.fixSuggestions) {
      total += estimateTokens(fix);
    }
  }

  if (pack.forum) {
    for (const f of pack.forum) {
      total += estimateTokens(f.title) + estimateTokens(f.body) + 30;
    }
  }

  if (pack.experience) {
    for (const e of pack.experience) {
      total += estimateTokens(e.title) + estimateTokens(e.summary) + 20;
    }
  }

  if (pack.fixSuggestions) {
    for (const fix of pack.fixSuggestions) {
      total += estimateTokens(fix);
    }
  }

  return total;
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

export function truncateSkillPack(
  pack: SkillContextPack,
  budget: number,
  _skill: SkillId,
): SkillContextPack {
  let truncated = false;
  let result = { ...pack };

  // 1. Drop experience
  if (estimateSkillTokens(result) > budget && result.experience && result.experience.length > 0) {
    truncated = true;
    result = { ...result, experience: [] };
  }

  // 2. Drop forum
  if (estimateSkillTokens(result) > budget && result.forum && result.forum.length > 0) {
    truncated = true;
    result = { ...result, forum: [] };
  }

  // 3. Truncate callgraph
  if (estimateSkillTokens(result) > budget && result.callgraph.length > 0) {
    const edges = [...result.callgraph];
    while (edges.length > 0 && estimateSkillTokens({ ...result, callgraph: edges }) > budget) {
      edges.pop();
    }
    if (edges.length < result.callgraph.length) truncated = true;
    result = { ...result, callgraph: edges };
  }

  // 4. Truncate issues
  if (estimateSkillTokens(result) > budget && result.issues.length > 0) {
    const issues = [...result.issues];
    while (issues.length > 0 && estimateSkillTokens({ ...result, issues }) > budget) {
      issues.pop();
    }
    if (issues.length < result.issues.length) truncated = true;
    result = { ...result, issues };
  }

  // 5. Truncate source (keep first)
  if (estimateSkillTokens(result) > budget && result.source.length > 0) {
    const sources = [...result.source];
    while (sources.length > 1 && estimateSkillTokens({ ...result, source: sources }) > budget) {
      sources.pop();
    }
    if (sources.length < result.source.length) truncated = true;
    // Truncate remaining source code text
    if (estimateSkillTokens({ ...result, source: sources }) > budget) {
      const truncatedSources = sources.map((s) => {
        const r = truncateText(s.code, 100);
        if (r.truncated) truncated = true;
        return { ...s, code: r.text };
      });
      result = { ...result, source: truncatedSources };
    } else {
      result = { ...result, source: sources };
    }
  }

  // 6. Truncate render stage descriptions
  if (estimateSkillTokens(result) > budget && result.renderStages && result.renderStages.length > 0) {
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

  // 7. Drop render stages
  if (estimateSkillTokens(result) > budget && result.renderStages && result.renderStages.length > 0) {
    const stages = [...result.renderStages];
    while (stages.length > 0 && estimateSkillTokens({ ...result, renderStages: stages }) > budget) {
      stages.pop();
    }
    if (stages.length < (result.renderStages?.length ?? 0)) truncated = true;
    result = { ...result, renderStages: stages };
  }

  // 8. Drop fix suggestions
  if (estimateSkillTokens(result) > budget && result.fixSuggestions && result.fixSuggestions.length > 0) {
    truncated = true;
    result = { ...result, fixSuggestions: [] };
  }

  // 9. Drop diagnosis
  if (estimateSkillTokens(result) > budget && result.diagnosis) {
    truncated = true;
    result = { ...result, diagnosis: undefined };
  }

  // Final minimum check
  const minimumPack: SkillContextPack = {
    ...result,
    source: [],
    callgraph: [],
    issues: [],
    renderStages: undefined,
    diagnosis: undefined,
    forum: undefined,
    experience: undefined,
    fixSuggestions: undefined,
    metadata: {
      skill: result.skill,
      totalTokens: 0,
      truncated: false,
      tokenBudget: budget,
      sectionsIncluded: [],
    },
  };
  const minimumPossibleTokens = estimateSkillTokens(minimumPack);
  const finalTokens = estimateSkillTokens(result);
  const unavoidableOverflow = finalTokens > budget;

  return {
    ...result,
    metadata: {
      skill: result.skill,
      totalTokens: finalTokens,
      truncated,
      tokenBudget: budget,
      sectionsIncluded: result.metadata.sectionsIncluded,
      symbolResolved: result.metadata.symbolResolved,
      ...(unavoidableOverflow
        ? { unavoidableOverflow: true, minimumPossibleTokens }
        : {}),
    },
  };
}
