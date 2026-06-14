import type { Command } from "commander";
import { CesiumIndexer } from "@cesium-nexus/indexer";
import * as path from "node:path";

export function registerIndexCommand(program: Command): void {
  program
    .command("index:symbols")
    .description("Scan Cesium source and build symbol database")
    .option("--cesium-root <path>", "Path to Cesium source directory", "./data/cesium")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .option("--verbose", "Show per-file progress", false)
    .action(async (opts: { cesiumRoot: string; db: string; verbose: boolean }) => {
      const resolvedRoot = path.resolve(opts.cesiumRoot);
      const resolvedDb = path.resolve(opts.db);

      console.log(`Cesium root: ${resolvedRoot}`);
      console.log(`Database:    ${resolvedDb}`);
      console.log("Indexing symbols...\n");

      try {
        const indexer = new CesiumIndexer(opts.verbose);
        const summary = await indexer.index(resolvedRoot, resolvedDb);

        console.log(`\n✓ Indexed ${summary.totalSymbols} symbols from ${summary.totalFiles} files in ${summary.duration}ms`);
        console.log(`  Classes: ${summary.byKind.class || 0}  Functions: ${summary.byKind.function || 0}  Methods: ${summary.byKind.method || 0}  Enums: ${summary.byKind.enum || 0}  Constants: ${summary.byKind.constant || 0}`);
      } catch (err) {
        console.error("Indexing failed:", (err as Error).message);
        process.exit(1);
      }
    });
}
