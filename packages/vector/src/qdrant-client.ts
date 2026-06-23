import { QdrantClient } from "@qdrant/js-client-rest";
import type {
  ProblemPattern,
  ProblemSeverity,
  RenderStage,
} from "@cesium-nexus/shared";
import type {
  VectorSearchResult,
  QdrantExperiencePayload,
  QdrantProblemPatternPayload,
  QdrantRenderStagePayload,
} from "./types.js";

const DEFAULT_QDRANT_URL = "http://localhost:6333";
const COLLECTION_NAME = "eng-knowledge";

let _client: QdrantClient | null = null;

export function getQdrantClient(url?: string): QdrantClient {
  if (!_client) {
    _client = new QdrantClient({ url: url ?? DEFAULT_QDRANT_URL });
  }
  return _client;
}

export function nodeIdToQdrantId(nodeId: string): string {
  let hash = 0;
  for (let i = 0; i < nodeId.length; i++) {
    const ch = nodeId.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return `cn-${Math.abs(hash).toString(36)}`;
}

export function buildExperiencePayload(
  nodeId: string,
  nodeType: string,
  title: string,
  url: string,
  repo: string,
  tags: string[],
  qualityScore: number,
): QdrantExperiencePayload {
  return {
    type: "cesium-experience",
    project: "cesium-nexus",
    tags,
    importance: qualityScore,
    status: "active",
    node_id: nodeId,
    node_type: nodeType,
    title,
    url,
    repo,
  };
}

export interface UpsertPoint {
  nodeId: string;
  embedding: number[];
  payload: QdrantExperiencePayload;
}

export async function upsertExperienceEmbeddings(
  client: QdrantClient,
  points: UpsertPoint[],
): Promise<void> {
  if (points.length === 0) return;

  await client.upsert(COLLECTION_NAME, {
    wait: true,
    points: points.map((p) => ({
      id: nodeIdToQdrantId(p.nodeId),
      vector: p.embedding,
      payload: p.payload as unknown as Record<string, unknown>,
    })),
  });
}

export async function semanticSearch(
  client: QdrantClient,
  queryEmbedding: number[],
  options?: {
    limit?: number;
    minScore?: number;
    type?: string;
    nodeType?: string;
  },
): Promise<VectorSearchResult[]> {
  const limit = options?.limit ?? 10;

  const must: Record<string, unknown>[] = [
    { key: "project", match: { value: "cesium-nexus" } },
  ];

  if (options?.type) {
    must.push({ key: "type", match: { value: options.type } });
  }

  if (options?.nodeType) {
    must.push({ key: "node_type", match: { value: options.nodeType } });
  }

  const results = await client.search(COLLECTION_NAME, {
    vector: queryEmbedding,
    limit,
    filter: { must },
    with_payload: true,
    score_threshold: options?.minScore,
  });

  return results.map((r) => {
    const payload = r.payload as Record<string, unknown>;
    return {
      nodeId: String(payload.node_id ?? payload.pattern_id ?? payload.stage_id ?? ""),
      nodeType: String(payload.node_type ?? payload.type ?? ""),
      title: String(payload.title ?? ""),
      url: String(payload.url ?? ""),
      score: r.score ?? 0,
    };
  });
}

export async function deleteExperienceEmbeddings(
  client: QdrantClient,
  nodeIds: string[],
): Promise<void> {
  if (nodeIds.length === 0) return;

  await client.delete(COLLECTION_NAME, {
    wait: true,
    points: nodeIds.map((id) => nodeIdToQdrantId(id)),
  });
}

export async function findSimilarNodes(
  client: QdrantClient,
  embedding: number[],
  excludeNodeId: string,
  limit: number,
  minScore: number,
): Promise<VectorSearchResult[]> {
  const must: Record<string, unknown>[] = [
    { key: "project", match: { value: "cesium-nexus" } },
  ];

  const mustNot: Record<string, unknown>[] = [
    { has_id: [nodeIdToQdrantId(excludeNodeId)] },
  ];

  const results = await client.search(COLLECTION_NAME, {
    vector: embedding,
    limit,
    filter: { must, must_not: mustNot },
    with_payload: true,
    score_threshold: minScore,
  });

  return results.map((r) => {
    const payload = r.payload as Record<string, unknown>;
    return {
      nodeId: String(payload.node_id ?? payload.pattern_id ?? payload.stage_id ?? ""),
      nodeType: String(payload.node_type ?? payload.type ?? ""),
      title: String(payload.title ?? ""),
      url: String(payload.url ?? ""),
      score: r.score ?? 0,
    };
  });
}

const SEVERITY_SCORE: Record<ProblemSeverity, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export function buildProblemPatternPayload(
  pattern: ProblemPattern,
): QdrantProblemPatternPayload {
  return {
    type: "cesium-problem-pattern",
    project: "cesium-nexus",
    tags: pattern.relatedSymbols,
    importance: SEVERITY_SCORE[pattern.severity] ?? 1,
    status: "active",
    pattern_id: pattern.id,
    category: pattern.category,
    title: pattern.name,
  };
}

export function buildRenderStagePayload(
  stage: RenderStage,
): QdrantRenderStagePayload {
  return {
    type: "cesium-render-stage",
    project: "cesium-nexus",
    tags: stage.keySymbols,
    importance: stage.perfHotspot ? 3 : 1,
    status: "active",
    stage_id: stage.id,
    order: stage.order,
    title: stage.name,
  };
}

export interface GenericUpsertPoint {
  id: string;
  embedding: number[];
  payload: Record<string, unknown>;
}

export async function upsertPoints(
  client: QdrantClient,
  points: GenericUpsertPoint[],
): Promise<void> {
  if (points.length === 0) return;

  await client.upsert(COLLECTION_NAME, {
    wait: true,
    points: points.map((p) => ({
      id: nodeIdToQdrantId(p.id),
      vector: p.embedding,
      payload: p.payload,
    })),
  });
}
