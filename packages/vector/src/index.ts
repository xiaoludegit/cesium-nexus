export {
  embedText,
  embedBatch,
  EMBEDDING_DIM,
} from "./embedding.js";

export {
  getQdrantClient,
  nodeIdToQdrantId,
  buildExperiencePayload,
  buildProblemPatternPayload,
  buildRenderStagePayload,
  upsertExperienceEmbeddings,
  upsertPoints,
  semanticSearch,
  deleteExperienceEmbeddings,
  findSimilarNodes,
} from "./qdrant-client.js";
export type { UpsertPoint, GenericUpsertPoint } from "./qdrant-client.js";

export {
  embedAllExperienceNodes,
  embedSingleNode,
} from "./embed-experience.js";

export {
  embedProblemPatterns,
  embedRenderStages,
  embedAllPKB,
  buildPatternEmbedText,
  buildStageEmbedText,
} from "./embed-pkb.js";

export {
  searchExperienceSemantic,
  searchKnowledgeBase,
  buildReferencesEdges,
} from "./semantic-search.js";

export type {
  VectorSearchResult,
  EmbedExperienceResult,
  BuildReferencesResult,
  EmbedPKBResult,
  QdrantExperiencePayload,
  QdrantProblemPatternPayload,
  QdrantRenderStagePayload,
} from "./types.js";
