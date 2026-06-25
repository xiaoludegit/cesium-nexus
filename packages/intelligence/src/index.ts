/**
 * @cesium-nexus/intelligence
 *
 * Code Intelligence: Version Index, Shader Index, Symbol Identity
 */

// Types
export type {
  SymbolIdentity,
  SymbolSnapshot,
  BreakingChange,
  VersionDiff,
  SnapshotBuilderOptions,
  VersionDiffOptions,
  IdentityStabilityMetrics,
} from "./types.js";

// Identity (RC-002)
export {
  generateSymbolId,
  buildFullyQualifiedName,
  parseSymbolIdentity,
  identitiesMatch,
  calculateIdentityStability,
} from "./identity.js";

// Snapshot Repository
export { SnapshotRepo, initVersionSchema } from "./snapshot-repo.js";

// Snapshot Builder
export { SnapshotBuilder } from "./snapshot-builder.js";

// Symbol Diff Engine
export { SymbolDiffEngine } from "./symbol-diff-engine.js";

// Breaking Change Detector
export { BreakingChangeDetector } from "./breaking-change-detector.js";
