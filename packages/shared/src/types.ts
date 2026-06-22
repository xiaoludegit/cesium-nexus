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
