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
