/**
 * Breaking Change Detector
 *
 * Detects breaking changes between symbol snapshots.
 */

import { createHash } from "node:crypto";
import type { SymbolSnapshot, BreakingChange, VersionDiff } from "./types.js";
import { SnapshotRepo } from "./snapshot-repo.js";

export class BreakingChangeDetector {
  constructor(private repo: SnapshotRepo) {}

  /**
   * Detect breaking changes from a version diff.
   */
  detect(diff: VersionDiff): BreakingChange[] {
    const changes: BreakingChange[] = [];
    const now = Date.now();

    // Removed symbols are breaking changes
    for (const removed of diff.removed) {
      changes.push({
        id: this.generateBreakingChangeId(diff.fromVersion, diff.toVersion, removed.symbolId),
        fromVersion: diff.fromVersion,
        toVersion: diff.toVersion,
        symbolId: removed.symbolId,
        symbolName: removed.name,
        changeType: "removed",
        description: `Symbol '${removed.name}' was removed`,
        migrationGuide: `Check if '${removed.name}' was renamed or replaced by another symbol`,
        createdAt: now,
      });
    }

    // Signature changes are breaking changes
    for (const mod of diff.modified) {
      if (mod.changeType === "signature") {
        changes.push({
          id: this.generateBreakingChangeId(
            diff.fromVersion,
            diff.toVersion,
            mod.after.symbolId
          ),
          fromVersion: diff.fromVersion,
          toVersion: diff.toVersion,
          symbolId: mod.after.symbolId,
          symbolName: mod.after.name,
          changeType: "signature_changed",
          description: `Symbol '${mod.after.name}' signature changed`,
          migrationGuide: `Review the new signature of '${mod.after.name}' and update your code`,
          createdAt: now,
        });
      }

      // Location changes may indicate renaming
      if (mod.changeType === "location") {
        changes.push({
          id: this.generateBreakingChangeId(
            diff.fromVersion,
            diff.toVersion,
            mod.after.symbolId
          ),
          fromVersion: diff.fromVersion,
          toVersion: diff.toVersion,
          symbolId: mod.after.symbolId,
          symbolName: mod.after.name,
          changeType: "renamed",
          description: `Symbol '${mod.after.name}' moved from ${mod.before.filePath} to ${mod.after.filePath}`,
          migrationGuide: `Update imports for '${mod.after.name}' to new location`,
          createdAt: now,
        });
      }
    }

    // Store breaking changes
    for (const change of changes) {
      this.repo.upsertBreakingChange(change);
    }

    return changes;
  }

  /**
   * Generate migration guide for a breaking change.
   */
  generateMigrationGuide(change: BreakingChange): string {
    switch (change.changeType) {
      case "removed":
        return [
          `## Symbol Removed: ${change.symbolName}`,
          "",
          `The symbol '${change.symbolName}' was removed in version ${change.toVersion}.`,
          "",
          "### Migration Steps",
          "1. Search for the symbol in the new version to find its replacement",
          "2. Update your code to use the new symbol",
          "3. Check the CHANGES.md file for detailed migration instructions",
          "",
          "### Example",
          "```javascript",
          `// Before (v${change.fromVersion})`,
          `const result = ${change.symbolName}.someMethod();`,
          "",
          `// After (v${change.toVersion})`,
          "// Find the replacement symbol and update accordingly",
          "```",
        ].join("\n");

      case "signature_changed":
        return [
          `## Signature Changed: ${change.symbolName}`,
          "",
          `The signature of '${change.symbolName}' changed in version ${change.toVersion}.`,
          "",
          "### Migration Steps",
          "1. Review the new signature in the documentation",
          "2. Update all call sites to match the new signature",
          "3. Test your code thoroughly after the update",
          "",
          "### Example",
          "```javascript",
          `// Before (v${change.fromVersion})`,
          `const result = ${change.symbolName}(oldParam1, oldParam2);`,
          "",
          `// After (v${change.toVersion})`,
          `const result = ${change.symbolName}(newParam1, newParam2, newParam3);`,
          "```",
        ].join("\n");

      case "renamed":
        return [
          `## Symbol Moved: ${change.symbolName}`,
          "",
          `The symbol '${change.symbolName}' was moved to a new location in version ${change.toVersion}.`,
          "",
          "### Migration Steps",
          "1. Update your import statements",
          "2. The symbol API should remain compatible",
          "",
          "### Example",
          "```javascript",
          `// Before (v${change.fromVersion})`,
          `import { ${change.symbolName} } from 'old/module/path';`,
          "",
          `// After (v${change.toVersion})`,
          `import { ${change.symbolName} } from 'new/module/path';`,
          "```",
        ].join("\n");

      default:
        return `Review changes to '${change.symbolName}' in version ${change.toVersion}.`;
    }
  }

  // ─── Private Methods ───

  private generateBreakingChangeId(
    fromVersion: string,
    toVersion: string,
    symbolId: string
  ): string {
    const payload = `${fromVersion}:${toVersion}:${symbolId}`;
    const hash = createHash("sha1").update(payload).digest("hex");
    return `breaking/${hash}`;
  }
}
