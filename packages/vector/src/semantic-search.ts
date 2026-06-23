import type { ExperienceEdge } from "@cesium-nexus/shared";
import type { ExperienceRepo, ExperienceEdgeRepo } from "@cesium-nexus/storage";
import type { QdrantClient } from "@qdrant/js-client-rest";
import { embedText } from "./embedding.js";
import { semanticSearch, findSimilarNodes } from "./qdrant-client.js";
import type { VectorSearchResult, BuildReferencesResult } from "./types.js";

export async function searchExperienceSemantic(
  query: string,
  client: QdrantClient,
  options?: {
    limit?: number;
    minScore?: number;
    type?: string;
  },
): Promise<VectorSearchResult[]> {
  const queryEmbedding = await embedText(query);
  return semanticSearch(client, queryEmbedding, options);
}

export async function buildReferencesEdges(
  experienceRepo: ExperienceRepo,
  client: QdrantClient,
  edgeRepo: ExperienceEdgeRepo,
  threshold = 0.85,
): Promise<BuildReferencesResult> {
  const nodes = experienceRepo.getAll();
  if (nodes.length === 0) {
    return { totalEdges: 0, threshold };
  }

  const edges: ExperienceEdge[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    const text = `${node.title} ${node.summary}`;
    const embedding = await embedText(text);

    const similar = await findSimilarNodes(
      client,
      embedding,
      node.id,
      5,
      threshold,
    );

    for (const match of similar) {
      const edgeId = `references:${node.id}:${match.nodeId}`;
      const reverseEdgeId = `references:${match.nodeId}:${node.id}`;

      if (seen.has(edgeId) || seen.has(reverseEdgeId)) continue;
      seen.add(edgeId);

      edges.push({
        id: edgeId,
        sourceNodeId: node.id,
        targetNodeId: match.nodeId,
        edgeType: "references",
        confidence: match.score,
        createdAt: new Date().toISOString(),
      });
    }
  }

  if (edges.length > 0) {
    edgeRepo.upsertMany(edges);
  }

  return { totalEdges: edges.length, threshold };
}
