/**
 * Version Intelligence CLI Commands
 *
 * Implements:
 * - cesium snapshot --version <ver> [--cesium-root <path>]
 * - cesium snapshot --list
 * - cesium diff --from <v1> --to <v2> [--symbol <name>] [--breaking] [--format <fmt>]
 */

import type { Command } from "commander";
import { openDatabase, initSchema } from "@cesium-nexus/storage";
import {
  SnapshotBuilder,
  SnapshotRepo,
  initVersionSchema,
  SymbolDiffEngine,
  BreakingChangeDetector,
} from "@cesium-nexus/intelligence";
import * as path from "node:path";

export function registerVersionCommands(program: Command): void {
  // ─── Snapshot Command ───
  program
    .command("snapshot")
    .description("Manage version snapshots for symbol tracking")
    .option("--version <ver>", "Cesium version to snapshot")
    .option("--cesium-root <path>", "Path to Cesium submodule", "./data/cesium")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .option("--list", "List all available snapshot versions")
    .option("--stats", "Show snapshot statistics for a version")
    .action(
      async (opts: {
        version?: string;
        cesiumRoot: string;
        db: string;
        list?: boolean;
        stats?: boolean;
      }) => {
        const dbPath = path.resolve(opts.db);
        const db = openDatabase(dbPath);
        initSchema(db);
        initVersionSchema(db);

        const repo = new SnapshotRepo(db);

        // List versions
        if (opts.list) {
          const versions = repo.listVersions();
          if (versions.length === 0) {
            console.log("No snapshots available. Run: cesium snapshot --version <ver>");
          } else {
            console.log("Available versions:");
            for (const v of versions) {
              const stats = repo.getSnapshotStats(v);
              console.log(`  ${v}: ${stats.total} symbols`);
            }
          }
          db.close();
          return;
        }

        // Show stats
        if (opts.stats && opts.version) {
          const stats = repo.getSnapshotStats(opts.version);
          console.log(`Version: ${opts.version}`);
          console.log(`Total symbols: ${stats.total}`);
          console.log("By kind:");
          for (const [kind, count] of Object.entries(stats.byKind)) {
            console.log(`  ${kind}: ${count}`);
          }
          db.close();
          return;
        }

        // Build snapshot
        if (opts.version) {
          const cesiumRoot = path.resolve(opts.cesiumRoot);
          console.log(`Building snapshot for version ${opts.version}...`);
          console.log(`Cesium root: ${cesiumRoot}`);

          const builder = new SnapshotBuilder(db);
          const snapshots = await builder.buildSnapshot({
            version: opts.version,
            cesiumRoot,
          });

          console.log(`\nSnapshot built successfully!`);
          console.log(`Total symbols: ${snapshots.length}`);

          // Show breakdown by kind
          const byKind: Record<string, number> = {};
          for (const s of snapshots) {
            byKind[s.kind] = (byKind[s.kind] || 0) + 1;
          }
          console.log("By kind:");
          for (const [kind, count] of Object.entries(byKind)) {
            console.log(`  ${kind}: ${count}`);
          }
        } else {
          console.error("Error: --version <ver> or --list is required");
          process.exit(1);
        }

        db.close();
      }
    );

  // ─── Diff Command ───
  program
    .command("diff")
    .description("Compare symbols between two Cesium versions")
    .option("--from <ver>", "Source version")
    .option("--to <ver>", "Target version")
    .option("--symbol <name>", "Filter by symbol name")
    .option("--breaking", "Show only breaking changes", false)
    .option("--format <fmt>", "Output format: text, json, markdown", "text")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .action(
      async (opts: {
        from?: string;
        to?: string;
        symbol?: string;
        breaking: boolean;
        format: string;
        db: string;
      }) => {
        if (!opts.from || !opts.to) {
          console.error("Error: --from and --to are required");
          process.exit(1);
        }

        const dbPath = path.resolve(opts.db);
        const db = openDatabase(dbPath);
        initSchema(db);
        initVersionSchema(db);

        const repo = new SnapshotRepo(db);
        const diffEngine = new SymbolDiffEngine(repo);
        const breakingDetector = new BreakingChangeDetector(repo);

        // Check if snapshots exist
        if (!repo.snapshotExists(opts.from)) {
          console.error(`Error: No snapshot for version ${opts.from}`);
          console.error(`Run: cesium snapshot --version ${opts.from}`);
          process.exit(1);
        }
        if (!repo.snapshotExists(opts.to)) {
          console.error(`Error: No snapshot for version ${opts.to}`);
          console.error(`Run: cesium snapshot --version ${opts.to}`);
          process.exit(1);
        }

        // Compute diff
        const diff = diffEngine.diff(opts.from, opts.to, opts.symbol);

        // Detect breaking changes if not already computed
        if (diff.breakingChanges.length === 0 && diff.stats.removedCount + diff.stats.modifiedCount > 0) {
          const breakingChanges = breakingDetector.detect(diff);
          diff.breakingChanges = breakingChanges;
          diff.stats.breakingCount = breakingChanges.length;
        }

        // Filter for breaking only
        if (opts.breaking) {
          outputBreakingChanges(diff, opts.format);
        } else {
          outputDiff(diff, opts.format, opts.symbol);
        }

        db.close();
      }
    );
}

function outputDiff(
  diff: ReturnType<SymbolDiffEngine["diff"]>,
  format: string,
  symbolFilter?: string
): void {
  if (format === "json") {
    console.log(JSON.stringify(diff, null, 2));
    return;
  }

  if (format === "markdown") {
    outputDiffMarkdown(diff, symbolFilter);
    return;
  }

  // Default text format
  console.log(`\nSymbol Diff: ${diff.fromVersion} → ${diff.toVersion}`);
  console.log("─".repeat(50));
  console.log(`Total symbols: ${diff.stats.totalFrom} → ${diff.stats.totalTo}`);
  console.log(`Added: ${diff.stats.addedCount}`);
  console.log(`Removed: ${diff.stats.removedCount}`);
  console.log(`Modified: ${diff.stats.modifiedCount}`);
  console.log(`Breaking Changes: ${diff.stats.breakingCount}`);

  if (symbolFilter) {
    console.log(`\nFilter: ${symbolFilter}`);
  }

  // Added symbols
  if (diff.added.length > 0) {
    console.log(`\n✅ Added (${diff.added.length}):`);
    for (const s of diff.added.slice(0, 20)) {
      console.log(`  + ${s.name} (${s.kind}) - ${s.filePath}`);
    }
    if (diff.added.length > 20) {
      console.log(`  ... and ${diff.added.length - 20} more`);
    }
  }

  // Removed symbols
  if (diff.removed.length > 0) {
    console.log(`\n❌ Removed (${diff.removed.length}):`);
    for (const s of diff.removed.slice(0, 20)) {
      console.log(`  - ${s.name} (${s.kind}) - ${s.filePath}`);
    }
    if (diff.removed.length > 20) {
      console.log(`  ... and ${diff.removed.length - 20} more`);
    }
  }

  // Modified symbols
  if (diff.modified.length > 0) {
    console.log(`\n🔄 Modified (${diff.modified.length}):`);
    for (const m of diff.modified.slice(0, 20)) {
      console.log(`  ~ ${m.after.name} (${m.changeType}) - ${m.after.filePath}`);
    }
    if (diff.modified.length > 20) {
      console.log(`  ... and ${diff.modified.length - 20} more`);
    }
  }

  // Breaking changes
  if (diff.breakingChanges.length > 0) {
    console.log(`\n⚠️  Breaking Changes (${diff.breakingChanges.length}):`);
    for (const bc of diff.breakingChanges) {
      console.log(`  ! ${bc.symbolName} (${bc.changeType})`);
      console.log(`    ${bc.description}`);
    }
  }
}

function outputBreakingChanges(
  diff: ReturnType<SymbolDiffEngine["diff"]>,
  format: string
): void {
  if (format === "json") {
    console.log(JSON.stringify(diff.breakingChanges, null, 2));
    return;
  }

  console.log(`\nBreaking Changes: ${diff.fromVersion} → ${diff.toVersion}`);
  console.log("─".repeat(50));

  if (diff.breakingChanges.length === 0) {
    console.log("No breaking changes detected.");
    return;
  }

  for (const bc of diff.breakingChanges) {
    console.log(`\n⚠️  ${bc.symbolName}`);
    console.log(`   Type: ${bc.changeType}`);
    console.log(`   ${bc.description}`);
    if (bc.migrationGuide) {
      console.log(`   Migration: ${bc.migrationGuide}`);
    }
  }
}

function outputDiffMarkdown(
  diff: ReturnType<SymbolDiffEngine["diff"]>,
  symbolFilter?: string
): void {
  let md = `# Symbol Diff: ${diff.fromVersion} → ${diff.toVersion}\n\n`;

  md += `## Summary\n\n`;
  md += `| Metric | Count |\n`;
  md += `|--------|-------|\n`;
  md += `| Total (from) | ${diff.stats.totalFrom} |\n`;
  md += `| Total (to) | ${diff.stats.totalTo} |\n`;
  md += `| Added | ${diff.stats.addedCount} |\n`;
  md += `| Removed | ${diff.stats.removedCount} |\n`;
  md += `| Modified | ${diff.stats.modifiedCount} |\n`;
  md += `| Breaking | ${diff.stats.breakingCount} |\n\n`;

  if (symbolFilter) {
    md += `**Filter:** ${symbolFilter}\n\n`;
  }

  if (diff.breakingChanges.length > 0) {
    md += `## ⚠️ Breaking Changes\n\n`;
    md += `| Symbol | Change Type | Description |\n`;
    md += `|--------|-------------|-------------|\n`;
    for (const bc of diff.breakingChanges) {
      md += `| ${bc.symbolName} | ${bc.changeType} | ${bc.description} |\n`;
    }
    md += `\n`;
  }

  if (diff.added.length > 0) {
    md += `## ✅ Added Symbols\n\n`;
    md += `| Name | Kind | File |\n`;
    md += `|------|------|------|\n`;
    for (const s of diff.added.slice(0, 50)) {
      md += `| ${s.name} | ${s.kind} | ${s.filePath} |\n`;
    }
    md += `\n`;
  }

  if (diff.removed.length > 0) {
    md += `## ❌ Removed Symbols\n\n`;
    md += `| Name | Kind | File |\n`;
    md += `|------|------|------|\n`;
    for (const s of diff.removed.slice(0, 50)) {
      md += `| ${s.name} | ${s.kind} | ${s.filePath} |\n`;
    }
    md += `\n`;
  }

  console.log(md);
}
