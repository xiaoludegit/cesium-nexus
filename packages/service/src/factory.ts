/**
 * Service Factory
 *
 * Creates service instances with proper dependency injection.
 */

import type { Database } from "@cesium-nexus/storage";
import {
  SnapshotBuilder,
  SymbolDiffEngine,
  BreakingChangeDetector,
  SnapshotRepo,
  ShaderIndexBuilder,
} from "@cesium-nexus/intelligence";
import { EvidenceCollector, DiagnosisReasoner } from "@cesium-nexus/reasoner";
import type {
  MigrationService,
  ShaderService,
  VersionService,
  DiagnosisService,
} from "./types.js";
import { MigrationServiceImpl } from "./migration-service.js";
import { ShaderServiceImpl } from "./shader-service.js";
import { VersionServiceImpl } from "./version-service.js";
import { DiagnosisServiceImpl } from "./diagnosis-service.js";

export interface Services {
  migration: MigrationService;
  shader: ShaderService;
  version: VersionService;
  diagnosis: DiagnosisService;
}

/**
 * Create all services from a database connection.
 */
export function createServices(db: Database): Services {
  // Create intelligence components
  const snapshotRepo = new SnapshotRepo(db);
  const snapshotBuilder = new SnapshotBuilder(db);
  const symbolDiffEngine = new SymbolDiffEngine(snapshotRepo);
  const breakingChangeDetector = new BreakingChangeDetector(snapshotRepo);
  const shaderIndexBuilder = new ShaderIndexBuilder(db);

  // Create reasoner components
  const evidenceCollector = new EvidenceCollector(db, shaderIndexBuilder);
  const diagnosisReasoner = new DiagnosisReasoner(evidenceCollector);

  // Create services
  const migration = new MigrationServiceImpl(
    symbolDiffEngine,
    breakingChangeDetector
  );

  const shader = new ShaderServiceImpl(shaderIndexBuilder);

  const version = new VersionServiceImpl(
    snapshotBuilder,
    symbolDiffEngine,
    breakingChangeDetector
  );

  const diagnosis = new DiagnosisServiceImpl(diagnosisReasoner);

  return {
    migration,
    shader,
    version,
    diagnosis,
  };
}
