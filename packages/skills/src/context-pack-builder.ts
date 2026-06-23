import type {
  SkillContextPack,
  SkillConfig,
  ProblemPattern,
  RenderStage,
  SymbolRecord,
  SourceSnippet,
  Edge,
  IssueRecord,
  ForumPost,
  ExperienceNode,
  DiagnosisResult,
} from "@cesium-nexus/shared";
import type {
  SymbolRepo,
  CallGraphRepo,
  IssueRepo,
  PullRequestRepo,
  ForumRepo,
  ExperienceRepo,
} from "@cesium-nexus/storage";
import { diagnoseProblem } from "@cesium-nexus/diagnosis";
import { dispatchSkill } from "./skill-router.js";
import { truncateSkillPack } from "./token-budget.js";

export interface BuildSkillPackOptions {
  query: string;
  symbolRepo: SymbolRepo;
  callGraphRepo: CallGraphRepo;
  issueRepo: IssueRepo;
  prRepo: PullRequestRepo;
  forumRepo: ForumRepo;
  experienceRepo: ExperienceRepo;
  patterns: ProblemPattern[];
  stages: RenderStage[];
  configs: SkillConfig[];
  budget?: number;
}

export async function buildSkillContextPack(
  options: BuildSkillPackOptions,
): Promise<SkillContextPack> {
  const {
    query,
    symbolRepo,
    callGraphRepo,
    issueRepo,
    forumRepo,
    experienceRepo,
    patterns,
    stages,
    configs,
    budget,
  } = options;

  const dispatch = dispatchSkill(query, configs, {
    symbolRepo,
    stages,
    patterns,
  });

  const skill = dispatch.skill;
  const config =
    configs.find((c) => c.id === skill) ??
    configs.find((c) => c.id === "general")!;
  const tokenBudget = budget ?? config.tokenBudget;
  const hasSection = (s: string) => config.sections.includes(s as never);

  let symbol: SymbolRecord | undefined;
  const source: SourceSnippet[] = [];
  const callgraph: Edge[] = [];
  let issues: IssueRecord[] = [];
  let renderStages: RenderStage[] | undefined;
  let diagnosis: DiagnosisResult | undefined;
  let forum: ForumPost[] | undefined;
  let experience: ExperienceNode[] | undefined;
  let fixSuggestions: string[] | undefined;

  const symbolEntity = dispatch.extractedEntities.find(
    (e) => e.type === "symbol",
  );
  if (symbolEntity) {
    const found = symbolRepo.findByName(symbolEntity.value);
    if (found.length > 0) {
      symbol = found[0];
    }
  }

  if (symbol) {
    const src = symbolRepo.getSourceBySymbolId(symbol.id);
    if (src) {
      source.push({
        symbol: src.name,
        file: src.filePath,
        lineStart: src.startLine,
        lineEnd: src.endLine,
        code: src.code,
      });
    }
  }

  if (symbol) {
    const depth = config.retrieval.callgraphDepth;
    const downstream = callGraphRepo.getDownstream(symbol.id, depth);
    const seen = new Set<string>();
    for (const e of downstream) {
      const key = `${e.sourceId}->${e.targetId}`;
      if (!seen.has(key)) {
        seen.add(key);
        callgraph.push({ source: e.sourceName, target: e.targetName });
      }
    }
  }

  if (hasSection("issues")) {
    const issueResults = issueRepo.searchFts(query, {
      limit: config.retrieval.issueLimit,
    });
    issues = issueResults.map((r) => r.issue);
  }

  if (config.retrieval.includeDiagnosis) {
    const diagResult = await diagnoseProblem({
      query,
      patterns,
      stages,
      symbolRepo,
      callGraphRepo,
      issueRepo,
      budget: tokenBudget,
    });
    diagnosis = diagResult;
    fixSuggestions = diagResult.fixSuggestions;

    if (config.retrieval.includeRenderStages && diagResult.renderStages.length > 0) {
      renderStages = diagResult.renderStages;
    }
  }

  if (config.retrieval.includeRenderStages && !renderStages) {
    const stageEntity = dispatch.extractedEntities.find(
      (e) => e.type === "stage",
    );
    if (stageEntity) {
      renderStages = stages.filter((s) => s.id === stageEntity.value);
    }
  }

  if (config.retrieval.includeForum && config.retrieval.forumLimit > 0) {
    const forumResults = forumRepo.searchFts(query, {
      limit: config.retrieval.forumLimit,
    });
    forum = forumResults.map((r) => r.post);
  }

  if (config.retrieval.includeExperience) {
    const expResults = experienceRepo.searchFts(query, {
      limit: 3,
      symbol: symbol?.name,
    });
    experience = expResults.map((r) => r.node);
  }

  const pack: SkillContextPack = {
    kind: "skill",
    skill,
    query,
    dispatch,
    symbol,
    source,
    callgraph,
    issues,
    renderStages,
    diagnosis,
    forum,
    experience,
    fixSuggestions,
    metadata: {
      skill,
      totalTokens: 0,
      truncated: false,
      tokenBudget,
      sectionsIncluded: config.sections,
      symbolResolved: symbol?.name,
    },
  };

  return truncateSkillPack(pack, tokenBudget, skill);
}
