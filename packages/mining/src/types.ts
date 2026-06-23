export type CanonicalProblemStatus = "candidate" | "reviewed" | "accepted";

export interface CanonicalProblem {
  id: string;
  title: string;
  aliases: string[];
  representativeIssueId: number | null;
  clusterIds: string[];
  experienceIds: string[];
  confidence: number;
  status: CanonicalProblemStatus;
  createdAt: number;
  reviewedAt: number | null;
}

export type CandidateStatus = "pending" | "approved" | "rejected";

export interface ProblemCandidate {
  id: string;
  canonicalId: string;
  clusterId: string;

  draftAlias: string[];
  draftSymptoms: string[];
  draftSymbols: string[];
  draftCategory: string | null;

  llmRaw: string | null;
  qualityScore: number | null;
  dupOf: string | null;

  status: CandidateStatus;
  reviewedAt: number | null;
  createdAt: number;

  sourceCount: number;
  issueCount: number;
  forumCount: number;
  experienceCount: number;
}

export interface ClusterConfig {
  threshold: number;
  minClusterSize: number;
  maxClusterSize: number;
}

export interface Cluster {
  id: string;
  memberIds: string[];
  centroid?: Float32Array;
  score?: number;
}

export interface VectorRecord {
  id: string;
  vector: Float32Array;
  payload: Record<string, unknown>;
}

export interface EmbeddingQuery {
  text?: string;
  vector?: Float32Array;
  topK: number;
  minScore?: number;
  filter?: Record<string, unknown>;
}

export interface EmbeddingHit {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

export type VectorScope =
  | { entityType: "experience"; since?: number }
  | { entityType: "issue"; since?: number }
  | { entityType: "pattern" }
  | { entityType: "stage" };

export interface EmbeddingSearchProvider {
  search(query: EmbeddingQuery): Promise<EmbeddingHit[]>;
  listVectors(scope: VectorScope): Promise<VectorRecord[]>;
  embedText(text: string): Promise<Float32Array>;
}

export interface MiningRunStats {
  totalVectors: number;
  totalClusters: number;
  totalCanonicalProblems: number;
  totalCandidates: number;
  durationMs: number;
  threshold: number;
}
