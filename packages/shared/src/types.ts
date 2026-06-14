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

export interface IssueRecord {
  id: number;
  title: string;
  state: string;
  labels: string[];
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContextPack {
  symbol: SymbolRecord;
  source: SourceSnippet[];
  callgraph: Edge[];
  issues: IssueRecord[];
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
