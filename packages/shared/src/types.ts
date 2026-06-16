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
