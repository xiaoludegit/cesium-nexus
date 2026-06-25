/**
 * Service Layer Types
 *
 * MCP/CLI → Service → Intelligence/Reasoner
 */

import type {
  BreakingChange,
  ShaderSymbol,
  ShaderIndexStats,
  SymbolSnapshot,
  VersionDiff,
  ShaderSymbolType,
} from "@cesium-nexus/intelligence";
import type {
  DiagnosisResult,
  DiagnosisOptions,
  Evidence,
} from "@cesium-nexus/reasoner";

// Service interfaces following RC-005
export interface MigrationService {
  getBreakingChanges(from: string, to: string): Promise<BreakingChange[]>;
  getMigrationGuide(from: string, to: string): Promise<string>;
  searchBySymbol(symbol: string, from: string, to: string): Promise<BreakingChange[]>;
}

export interface ShaderService {
  search(query: string, filters?: ShaderFilters): Promise<ShaderSymbol[]>;
  getById(id: string): Promise<ShaderSymbol | null>;
  getByName(name: string): Promise<ShaderSymbol | null>;
  getByType(type: string): Promise<ShaderSymbol[]>;
  getByRenderStage(stage: string): Promise<ShaderSymbol[]>;
  getStats(): Promise<ShaderIndexStats>;
}

export interface VersionService {
  snapshot(version: string): Promise<SymbolSnapshot[]>;
  diff(from: string, to: string, symbol?: string): Promise<VersionDiff>;
  listVersions(): Promise<string[]>;
  getBreakingChanges(from: string, to: string): Promise<BreakingChange[]>;
}

export interface DiagnosisService {
  diagnose(query: string, options?: DiagnosisOptions): Promise<DiagnosisResult>;
  collectEvidence(query: string): Promise<Evidence[]>;
  explain(result: DiagnosisResult): Promise<string>;
}

export interface ShaderFilters {
  type?: ShaderSymbolType;
  relatedJsSymbol?: string;
  renderStage?: string;
  file?: string;
}
