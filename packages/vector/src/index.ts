export {
  embedText,
  embedBatch,
  EMBEDDING_DIM,
} from "./embedding.js";

export {
  getQdrantClient,
  nodeIdToQdrantId,
  buildExperiencePayload,
  upsertExperienceEmbeddings,
  semanticSearch,
  deleteExperienceEmbeddings,
  findSimilarNodes,
} from "./qdrant-client.js";
export type { UpsertPoint } from "./qdrant-client.js";

export {
  embedAllExperienceNodes,
  embedSingleNode,
} from "./embed-experience.js";

export {
  searchExperienceSemantic,
  buildReferencesEdges,
} from "./semantic-search.js";

export type {
  VectorSearchResult,
  EmbedExperienceResult,
  BuildReferencesResult,
  QdrantExperiencePayload,
} from "./types.js";
