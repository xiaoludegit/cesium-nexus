export type SymbolKind = "class" | "function" | "method" | "enum" | "constant";

export interface SymbolRecord {
  id: string;
  name: string;
  kind: SymbolKind;
  filePath: string;
  startLine: number;
  endLine: number;
  docComment?: string;
  exports: string[];
  imports: string[];
  parentClass?: string;
}

export interface Edge {
  source: string;
  target: string;
}

export type CallEdgeType = "call" | "construct" | "static_call";

export interface CallEdge {
  sourceId: string;
  targetId: string;
  sourceName: string;
  targetName: string;
  edgeType: CallEdgeType;
  weight?: number;
}

export interface IssueRecord {
  id: number;
  repo: string;
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  assignees: string[];
  author: string;
  comments: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  htmlUrl: string;
}

export interface IssueSearchResult {
  issue: IssueRecord;
  score: number;
}

export interface ContextPackMetadata {
  totalTokens: number;
  truncated: boolean;
  symbolResolved: string;
  tokenBudget: number;
  unavoidableOverflow?: boolean;
  minimumPossibleTokens?: number;
}

export interface ContextPack {
  symbol: SymbolRecord;
  source: SourceSnippet[];
  callgraph: Edge[];
  issues: IssueRecord[];
  metadata?: ContextPackMetadata;
}

export interface SourceSnippet {
  symbol: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  code: string;
}

export interface IndexSummary {
  totalFiles: number;
  totalSymbols: number;
  byKind: Record<SymbolKind, number>;
  duration: number;
}

/* ────────────────────────────────────────────
 *  Phase 2A — Problem Diagnosis Types
 * ──────────────────────────────────────────── */

export type ProblemCategory =
  | "debug"
  | "performance"
  | "rendering"
  | "terrain"
  | "tiles"
  | "shader";

export type ProblemSeverity = "low" | "medium" | "high";

export interface ProblemPattern {
  id: string;
  name: string;
  category: ProblemCategory;
  severity: ProblemSeverity;
  aliases: string[];
  triggerKeywords: string[];
  symptoms: string[];
  possibleCauses: string[];
  relatedSymbols: string[];
  relatedStages: string[];
  issueQueries: string[];
  investigationSteps: string[];
  fixSuggestions: string[];
}

export interface RenderStage {
  id: string;
  name: string;
  order: number;
  description: string;
  keySymbols: string[];
  symptomHints: string[];
  dependsOn: string[];
  perfHotspot?: boolean;
  isOptional?: boolean;
}

export type StageRelation = "sequential" | "conditional" | "parallel";

export interface RenderStageEdge {
  from: string;
  to: string;
  relation: StageRelation;
}

export interface RenderPipelineGraph {
  stages: RenderStage[];
  edges: RenderStageEdge[];
}

export interface DiagnosisMatch {
  pattern: ProblemPattern;
  matchedKeywords: string[];
  score: number;
}

export interface DiagnosisMetadata {
  totalTokens: number;
  truncated: boolean;
  tokenBudget: number;
  unavoidableOverflow?: boolean;
  minimumPossibleTokens?: number;
}

export interface DiagnosisResult {
  query: string;
  matchedPatterns: DiagnosisMatch[];
  renderStages: RenderStage[];
  relatedSymbols: SymbolRecord[];
  relatedSource: SourceSnippet[];
  callgraph: Edge[];
  relatedIssues: IssueRecord[];
  investigationSteps: string[];
  fixSuggestions: string[];
  metadata: DiagnosisMetadata;
}

export interface DiagnosticContextPack extends DiagnosisResult {
  kind: "diagnosis";
}

/* ────────────────────────────────────────────
 *  Phase 2B — Render Pipeline Intelligence Types
 * ──────────────────────────────────────────── */

export type SkillId = "api" | "debug" | "performance" | "shader" | "general";

export type SkillSection =
  | "symbol"
  | "source"
  | "callgraph"
  | "issues"
  | "render_stage"
  | "diagnosis"
  | "forum"
  | "experience"
  | "fixes";

export interface ExtractedEntity {
  type: "symbol" | "version" | "stage" | "problem";
  value: string;
}

export interface SkillDispatchResult {
  skill: SkillId;
  confidence: number;
  matchedKeywords: string[];
  extractedEntities: ExtractedEntity[];
}

export interface SkillRetrievalHints {
  includeDiagnosis: boolean;
  includeRenderStages: boolean;
  includeForum: boolean;
  includeExperience: boolean;
  callgraphDepth: number;
  issueLimit: number;
  forumLimit: number;
}

export interface SkillConfig {
  id: SkillId;
  name: string;
  description: string;
  triggerKeywords: string[];
  tokenBudget: number;
  sections: SkillSection[];
  retrieval: SkillRetrievalHints;
}

export interface ForumPost {
  id: number;
  topicId: number;
  title: string;
  body: string;
  author: string;
  repliesCount: number;
  viewsCount: number;
  hasSolution: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  url: string;
  qualityScore: number;
}

export interface ForumSearchResult {
  post: ForumPost;
  score: number;
}

export interface PullRequestRecord {
  id: number;
  repo: string;
  number: number;
  title: string;
  body: string;
  state: string;
  mergedAt: string | null;
  author: string;
  labels: string[];
  reviewComments: number;
  filesChanged: number;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  closingIssueReferences: number[];
}

export interface PRSearchResult {
  pr: PullRequestRecord;
  score: number;
}

export type ExperienceNodeType = "issue" | "pr_review" | "forum";

export interface ExperienceNode {
  id: string;
  type: ExperienceNodeType;
  title: string;
  url: string;
  source: string;
  summary: string;
  relatedSymbols: string[];
  tags: string[];
  qualityScore: number;
  publishedAt: string;
}

export interface ExperienceSearchResult {
  node: ExperienceNode;
  score: number;
}

export interface SkillContextPackMetadata {
  skill: SkillId;
  totalTokens: number;
  truncated: boolean;
  tokenBudget: number;
  sectionsIncluded: SkillSection[];
  symbolResolved?: string;
  unavoidableOverflow?: boolean;
  minimumPossibleTokens?: number;
}

export interface SkillContextPack {
  kind: "skill";
  skill: SkillId;
  query: string;
  dispatch: SkillDispatchResult;
  symbol?: SymbolRecord;
  source: SourceSnippet[];
  callgraph: Edge[];
  issues: IssueRecord[];
  renderStages?: RenderStage[];
  diagnosis?: DiagnosisResult;
  forum?: ForumPost[];
  experience?: ExperienceNode[];
  fixSuggestions?: string[];
  metadata: SkillContextPackMetadata;
}

/* ────────────────────────────────────────────
 *  Phase 2C — Experience Graph Types
 * ──────────────────────────────────────────── */

export type ExperienceEdgeType = "fixes" | "references";

export interface ExperienceEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: ExperienceEdgeType;
  confidence: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ExperienceChain {
  rootId: string;
  nodes: ExperienceNode[];
  edges: ExperienceEdge[];
  depth: number;
  truncated: boolean;
}

export interface ExperienceEdgeStats {
  totalEdges: number;
  byType: Record<ExperienceEdgeType, number>;
  connectedNodes: number;
  orphanNodes: number;
  totalNodes: number;
}
