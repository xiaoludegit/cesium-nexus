/**
 * Version Service Implementation
 *
 * Provides version-related operations through Version Intelligence.
 */

import type {
  SnapshotBuilder,
  SymbolDiffEngine,
  BreakingChangeDetector,
  SymbolSnapshot,
  VersionDiff,
  BreakingChange,
} from "@cesium-nexus/intelligence";
import type { VersionService } from "./types.js";

export class VersionServiceImpl implements VersionService {
  constructor(
    private snapshotBuilder: SnapshotBuilder,
    private symbolDiffEngine: SymbolDiffEngine,
    private breakingChangeDetector: BreakingChangeDetector
  ) {}

  async snapshot(version: string): Promise<SymbolSnapshot[]> {
    if (this.snapshotBuilder.snapshotExists(version)) {
      return this.snapshotBuilder.getSnapshot(version);
    }
    // If snapshot doesn't exist, we can't build it without cesium root
    // Return empty array - caller should build snapshot first
    return [];
  }

  async diff(from: string, to: string, symbol?: string): Promise<VersionDiff> {
    return this.symbolDiffEngine.diff(from, to, symbol);
  }

  async listVersions(): Promise<string[]> {
    return this.snapshotBuilder.listVersions();
  }

  async getBreakingChanges(from: string, to: string): Promise<BreakingChange[]> {
    const diff = await this.diff(from, to);
    return diff.breakingChanges;
  }
}
