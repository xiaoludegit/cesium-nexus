/**
 * Migration Service Implementation
 *
 * Provides migration-related operations through Version Intelligence.
 */

import type {
  BreakingChange,
  BreakingChangeDetector,
  SymbolDiffEngine,
} from "@cesium-nexus/intelligence";
import type { MigrationService } from "./types.js";

export class MigrationServiceImpl implements MigrationService {
  constructor(
    private symbolDiffEngine: SymbolDiffEngine,
    private breakingChangeDetector: BreakingChangeDetector
  ) {}

  async getBreakingChanges(from: string, to: string): Promise<BreakingChange[]> {
    const diff = this.symbolDiffEngine.diff(from, to);
    return diff.breakingChanges;
  }

  async getMigrationGuide(from: string, to: string): Promise<string> {
    const breakingChanges = await this.getBreakingChanges(from, to);

    if (breakingChanges.length === 0) {
      return `No breaking changes found between ${from} and ${to}.`;
    }

    const guides = breakingChanges.map((bc) =>
      this.breakingChangeDetector.generateMigrationGuide(bc)
    );

    return [
      `# Migration Guide: ${from} → ${to}`,
      "",
      `Found ${breakingChanges.length} breaking change(s):`,
      "",
      ...guides,
    ].join("\n");
  }

  async searchBySymbol(
    symbol: string,
    from: string,
    to: string
  ): Promise<BreakingChange[]> {
    const breakingChanges = await this.getBreakingChanges(from, to);
    return breakingChanges.filter(
      (bc) =>
        bc.symbolName.toLowerCase().includes(symbol.toLowerCase())
    );
  }
}
