export interface VectorSearchResult {
  nodeId: string;
  nodeType: string;
  title: string;
  url: string;
  score: number;
}

export interface EmbedExperienceResult {
  totalNodes: number;
  embedded: number;
  skipped: number;
}

export interface BuildReferencesResult {
  totalEdges: number;
  threshold: number;
}

export interface QdrantExperiencePayload {
  type: "cesium-experience";
  project: "cesium-nexus";
  tags: string[];
  importance: number;
  status: "active";
  node_id: string;
  node_type: string;
  title: string;
  url: string;
  repo: string;
}

export interface QdrantProblemPatternPayload {
  type: "cesium-problem-pattern";
  project: "cesium-nexus";
  tags: string[];
  importance: number;
  status: "active";
  pattern_id: string;
  category: string;
  title: string;
}

export interface QdrantRenderStagePayload {
  type: "cesium-render-stage";
  project: "cesium-nexus";
  tags: string[];
  importance: number;
  status: "active";
  stage_id: string;
  order: number;
  title: string;
}

export interface QdrantIssuePayload {
  type: "cesium-issue";
  project: "cesium-nexus";
  tags: string[];
  importance: number;
  status: string;
  node_id: string;
  node_type: "github-issue";
  title: string;
  url: string;
  repo: string;
  issue_number: number;
  state: string;
  created_at: string;
  updated_at: string;
}

export interface EmbedPKBResult {
  totalPatterns: number;
  totalStages: number;
}
