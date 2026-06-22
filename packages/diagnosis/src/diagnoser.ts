import type {
  DiagnosticContextPack,
  ProblemPattern,
  RenderStage,
  SymbolRecord,
  SourceSnippet,
  Edge,
  IssueRecord,
  DiagnosisMatch,
} from "@cesium-nexus/shared";
import type { SymbolRepo, CallGraphRepo, IssueRepo } from "@cesium-nexus/storage";
import { matchProblemPatterns } from "./matcher.js";
import { truncateDiagnosticPack } from "./token-budget.js";

const DEFAULT_LIMIT = 5;
const DEFAULT_BUDGET = 6000;
const ISSUE_LIMIT_PER_QUERY = 3;

export interface DiagnoseOptions {
  query: string;
  patterns: ProblemPattern[];
  stages: RenderStage[];
  symbolRepo: SymbolRepo;
  callGraphRepo: CallGraphRepo;
  issueRepo: IssueRepo;
  limit?: number;
  budget?: number;
}

export async function diagnoseProblem(
  options: DiagnoseOptions,
): Promise<DiagnosticContextPack> {
  const {
    query,
    patterns,
    stages,
    symbolRepo,
    callGraphRepo,
    issueRepo,
    limit = DEFAULT_LIMIT,
    budget = DEFAULT_BUDGET,
  } = options;

  // 1. Match problem patterns
  const matchedPatterns: DiagnosisMatch[] = matchProblemPatterns(
    query,
    patterns,
    limit,
  );

  if (matchedPatterns.length === 0) {
    return {
      kind: "diagnosis",
      query,
      matchedPatterns: [],
      renderStages: [],
      relatedSymbols: [],
      relatedSource: [],
      callgraph: [],
      relatedIssues: [],
      investigationSteps: [],
      fixSuggestions: [],
      metadata: { totalTokens: 0, truncated: false, tokenBudget: budget },
    };
  }

  // 2. Merge related stage IDs and resolve render stages
  const stageIdSet = new Set<string>();
  for (const m of matchedPatterns) {
    for (const sid of m.pattern.relatedStages) {
      stageIdSet.add(sid);
    }
  }
  const renderStages = stages.filter((s) => stageIdSet.has(s.id));

  // 3. Merge related symbol names and resolve
  const symbolNameSet = new Set<string>();
  for (const m of matchedPatterns) {
    for (const name of m.pattern.relatedSymbols) {
      symbolNameSet.add(name);
    }
  }
  const relatedSymbols: SymbolRecord[] = [];
  for (const name of symbolNameSet) {
    const found = symbolRepo.findByName(name);
    for (const sym of found) {
      if (!relatedSymbols.some((s) => s.id === sym.id)) {
        relatedSymbols.push(sym);
      }
    }
  }

  // 4. Get source snippets for resolved symbols
  const relatedSource: SourceSnippet[] = [];
  for (const sym of relatedSymbols) {
    const source = symbolRepo.getSourceBySymbolId(sym.id);
    if (source) {
      relatedSource.push({
        symbol: source.name,
        file: source.filePath,
        lineStart: source.startLine,
        lineEnd: source.endLine,
        code: source.code,
      });
    }
  }

  // 5. Get callgraph edges for resolved symbols
  const edgeSet = new Set<string>();
  const callgraph: Edge[] = [];
  for (const sym of relatedSymbols) {
    const downstream = callGraphRepo.getDownstream(sym.id, 1);
    for (const e of downstream) {
      const key = `${e.sourceId}->${e.targetId}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        callgraph.push({ source: e.sourceName, target: e.targetName });
      }
    }
  }

  // 6. Search issues using issueQueries from matched patterns
  const relatedIssues: IssueRecord[] = [];
  const issueIdSet = new Set<number>();
  for (const m of matchedPatterns) {
    for (const q of m.pattern.issueQueries) {
      const results = issueRepo.searchFts(q, { limit: ISSUE_LIMIT_PER_QUERY });
      for (const r of results) {
        if (!issueIdSet.has(r.issue.id)) {
          issueIdSet.add(r.issue.id);
          relatedIssues.push(r.issue);
        }
      }
    }
  }

  // 7. Merge investigation steps (deduplicated, preserve order)
  const stepSet = new Set<string>();
  const investigationSteps: string[] = [];
  for (const m of matchedPatterns) {
    for (const step of m.pattern.investigationSteps) {
      if (!stepSet.has(step)) {
        stepSet.add(step);
        investigationSteps.push(step);
      }
    }
  }

  // 8. Merge fix suggestions (deduplicated, preserve order)
  const fixSet = new Set<string>();
  const fixSuggestions: string[] = [];
  for (const m of matchedPatterns) {
    for (const fix of m.pattern.fixSuggestions) {
      if (!fixSet.has(fix)) {
        fixSet.add(fix);
        fixSuggestions.push(fix);
      }
    }
  }

  // 9. Assemble pack and truncate
  const pack: DiagnosticContextPack = {
    kind: "diagnosis",
    query,
    matchedPatterns,
    renderStages,
    relatedSymbols,
    relatedSource,
    callgraph,
    relatedIssues,
    investigationSteps,
    fixSuggestions,
    metadata: { totalTokens: 0, truncated: false, tokenBudget: budget },
  };

  return truncateDiagnosticPack(pack, budget);
}

export function queryRenderStages(options: {
  stageId?: string;
  problemId?: string;
  patterns: ProblemPattern[];
  stages: RenderStage[];
}): RenderStage[] {
  const { stageId, problemId, patterns, stages } = options;

  // Query by stageId
  if (stageId) {
    return stages.filter((s) => s.id === stageId);
  }

  // Query by problemId — find the pattern, return its related stages
  if (problemId) {
    const pattern = patterns.find((p) => p.id === problemId);
    if (!pattern) return [];
    const stageIdSet = new Set(pattern.relatedStages);
    return stages.filter((s) => stageIdSet.has(s.id));
  }

  return [];
}
