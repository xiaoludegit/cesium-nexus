/**
 * Phase 3A1: Version Intelligence Types
 */

// RC-002: Symbol Identity
export interface SymbolIdentity {
  kind: "class" | "function" | "method" | "enum" | "constant";
  fullyQualifiedName: string; // e.g., "Scene.Camera.update"
}

// Symbol Snapshot for version tracking
export interface SymbolSnapshot {
  id: string; // snapshot/{version}/{symbolId}
  version: string; // e.g., "1.118"
  symbolId: string; // SHA1(kind + fullyQualifiedName)
  name: string;
  kind: "class" | "function" | "method" | "enum" | "constant";
  filePath: string;
  startLine: number;
  endLine: number;
  docComment?: string;
  sourceHash: string; // RC-001: SHA1(source_code) instead of storing source
  snapshotAt: number;
}

// Breaking Change detection
export interface BreakingChange {
  id: string;
  fromVersion: string;
  toVersion: string;
  symbolId: string;
  symbolName: string;
  changeType:
    | "removed"
    | "renamed"
    | "signature_changed"
    | "behavior_changed"
    | "added";
  description: string;
  migrationGuide?: string;
  createdAt: number;
}

// Version Diff result
export interface VersionDiff {
  fromVersion: string;
  toVersion: string;
  added: SymbolSnapshot[];
  removed: SymbolSnapshot[];
  modified: {
    before: SymbolSnapshot;
    after: SymbolSnapshot;
    changeType: "signature" | "implementation" | "doc" | "location";
  }[];
  breakingChanges: BreakingChange[];
  stats: {
    totalFrom: number;
    totalTo: number;
    addedCount: number;
    removedCount: number;
    modifiedCount: number;
    breakingCount: number;
  };
}

// Snapshot Builder options
export interface SnapshotBuilderOptions {
  version: string;
  cesiumRoot: string; // path to cesium submodule
  dbPath?: string;
}

// Version Diff options
export interface VersionDiffOptions {
  fromVersion: string;
  toVersion: string;
  cesiumRoot: string;
  symbolFilter?: string;
  breakingOnly?: boolean;
}

// Identity stability metrics
export interface IdentityStabilityMetrics {
  totalSymbolsV1: number;
  totalSymbolsV2: number;
  matchedSymbols: number;
  stableIdentities: number;
  stabilityRate: number; // stableIdentities / matchedSymbols ≥ 95%
}
