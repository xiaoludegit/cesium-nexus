export * from "./types.js";

// discovery
export { CosineThresholdClusterer, cosineSimilarity } from "./discovery/cosine-clusterer.js";
export {
  buildCanonicalProblems,
  resetCanonicalSeq,
} from "./discovery/canonical-problem.js";
export { QdrantEmbeddingProvider } from "./discovery/qdrant-embedding-provider.js";

// drafting
export {
  buildCandidate,
  resetCandidateSeq,
} from "./drafting/candidate-factory.js";
export { Drafter } from "./drafting/drafter.js";
export type { DrafterOptions } from "./drafting/drafter.js";
export { Scorer } from "./drafting/scorer.js";
export type { ScorerConfig, TextEmbedder } from "./drafting/scorer.js";
export { OllamaBackend, OpenAICompatibleBackend } from "./drafting/llm-backend.js";
export type { LLMBackend, LLMOptions } from "./drafting/llm-backend.js";

// review
export { MiningStore } from "./review/mining-store.js";

// promotion
export {
  promoteCandidate,
  buildGeneratedPattern,
  loadGeneratedPatterns,
  diffGenerated,
} from "./promotion/promoter.js";
export type { GeneratedPattern, PromoteInput } from "./promotion/promoter.js";

// pipeline
export { MiningPipeline } from "./pipeline.js";
export type { MiningPipelineOptions, PipelineResult } from "./pipeline.js";
