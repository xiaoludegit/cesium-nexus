/**
 * Symbol Diff Engine
 *
 * Compares symbol snapshots between two versions and detects changes.
 */

import type { SymbolSnapshot, VersionDiff, IdentityStabilityMetrics } from "./types.js";
import { SnapshotRepo } from "./snapshot-repo.js";
import { generateSymbolId, parseSymbolIdentity, calculateIdentityStability } from "./identity.js";

export class SymbolDiffEngine {
  constructor(private repo: SnapshotRepo) {}

  /**
   * Compute diff between two versions.
   */
  diff(fromVersion: string, toVersion: string, symbolFilter?: string): VersionDiff {
    const fromSnapshots = this.repo.getSnapshot(fromVersion);
    const toSnapshots = this.repo.getSnapshot(toVersion);

    // Build lookup maps by symbolId
    const fromById = new Map<string, SymbolSnapshot>();
    const toById = new Map<string, SymbolSnapshot>();

    for (const s of fromSnapshots) {
      if (!symbolFilter || s.name.includes(symbolFilter)) {
        fromById.set(s.symbolId, s);
      }
    }

    for (const s of toSnapshots) {
      if (!symbolFilter || s.name.includes(symbolFilter)) {
        toById.set(s.symbolId, s);
      }
    }

    // Find added, removed, and modified
    const added: SymbolSnapshot[] = [];
    const removed: SymbolSnapshot[] = [];
    const modified: VersionDiff["modified"] = [];

    // Find added and modified
    for (const [symbolId, toSnap] of toById) {
      const fromSnap = fromById.get(symbolId);

      if (!fromSnap) {
        added.push(toSnap);
      } else {
        const changeType = this.detectChangeType(fromSnap, toSnap);
        if (changeType) {
          modified.push({
            before: fromSnap,
            after: toSnap,
            changeType,
          });
        }
      }
    }

    // Find removed
    for (const [symbolId, fromSnap] of fromById) {
      if (!toById.has(symbolId)) {
        removed.push(fromSnap);
      }
    }

    // Get breaking changes
    const breakingChanges = this.repo.getBreakingChanges(fromVersion, toVersion);

    return {
      fromVersion,
      toVersion,
      added,
      removed,
      modified,
      breakingChanges,
      stats: {
        totalFrom: fromSnapshots.length,
        totalTo: toSnapshots.length,
        addedCount: added.length,
        removedCount: removed.length,
        modifiedCount: modified.length,
        breakingCount: breakingChanges.length,
      },
    };
  }

  /**
   * Calculate identity stability between two versions.
   */
  calculateStability(fromVersion: string, toVersion: string): IdentityStabilityMetrics {
    const fromSnapshots = this.repo.getSnapshot(fromVersion);
    const toSnapshots = this.repo.getSnapshot(toVersion);

    const fromIdentities = fromSnapshots.map((s) => ({
      id: s.id,
      identity: parseSymbolIdentity(s.name, s.kind),
    }));

    const toIdentities = toSnapshots.map((s) => ({
      id: s.id,
      identity: parseSymbolIdentity(s.name, s.kind),
    }));

    const result = calculateIdentityStability(fromIdentities, toIdentities);

    return {
      totalSymbolsV1: result.totalV1,
      totalSymbolsV2: result.totalV2,
      matchedSymbols: result.matched,
      stableIdentities: result.stable,
      stabilityRate: result.stabilityRate,
    };
  }

  /**
   * Get summary of changes for a specific symbol.
   */
  getSymbolChanges(
    symbolName: string,
    fromVersion: string,
    toVersion: string
  ): {
    found: boolean;
    changes: VersionDiff["modified"];
    breakingChanges: VersionDiff["breakingChanges"];
  } {
    const diff = this.diff(fromVersion, toVersion, symbolName);

    return {
      found: diff.added.length > 0 || diff.removed.length > 0 || diff.modified.length > 0,
      changes: diff.modified,
      breakingChanges: diff.breakingChanges,
    };
  }

  // ─── Private Methods ───

  private detectChangeType(
    before: SymbolSnapshot,
    after: SymbolSnapshot
  ): "signature" | "implementation" | "doc" | "location" | null {
    // Check if file moved
    if (before.filePath !== after.filePath) {
      return "location";
    }

    // Check if line numbers changed significantly (potential signature change)
    const lineDelta = Math.abs(
      (after.endLine - after.startLine) - (before.endLine - before.startLine)
    );

    // Check if doc comment changed
    if (before.docComment !== after.docComment) {
      // If only doc changed, it's a doc update
      if (before.sourceHash !== after.sourceHash && lineDelta === 0) {
        return "doc";
      }
    }

    // Check if source hash changed
    if (before.sourceHash !== after.sourceHash) {
      // If lines changed significantly, likely signature change
      if (lineDelta > 2) {
        return "signature";
      }
      return "implementation";
    }

    // No change detected
    return null;
  }
}
