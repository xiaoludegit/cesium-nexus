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

// Shader Types
export type {
  ShaderSymbol,
  ShaderSymbolType,
  ShaderIndex,
  ShaderFilters,
  ShaderIndexStats,
} from "./shader-types.js";

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

// Shader Repository
export { ShaderRepo, initShaderSchema } from "./shader-repo.js";

// GLSL Scanner
export { GlslScanner } from "./glsl-scanner.js";

// Shader Index Builder
export { ShaderIndexBuilder } from "./shader-index-builder.js";

// Shader-JS Linker
export { ShaderJsLinker } from "./shader-js-linker.js";
