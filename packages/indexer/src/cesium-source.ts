import { SymbolExtractor } from "@cesium-nexus/parser";
import { openDatabase, initSchema, SymbolRepo } from "@cesium-nexus/storage";
import type { SymbolRecord, SymbolKind, IndexSummary } from "@cesium-nexus/shared";
import { glob } from "tinyglobby";
import * as path from "node:path";

const SCAN_PATTERNS = [
  "packages/engine/Source/**/*.js",
  "packages/widgets/Source/**/*.js",
];

const EXCLUDE_PATTERNS = [
  "**/ThirdParty/**",
  "**/Shaders/**",
  "**/Workers/**",
  "**/Specs/**",
  "**/Assets/**",
];

export class CesiumIndexer {
  private extractor: SymbolExtractor;
  private verbose: boolean;

  constructor(verbose = false) {
    this.extractor = new SymbolExtractor();
    this.verbose = verbose;
  }

  async index(cesiumRoot: string, dbPath: string): Promise<IndexSummary> {
    const startTime = Date.now();

    // 1. Discover files
    const files = await this.discoverFiles(cesiumRoot);
    if (this.verbose) {
      console.log(`[indexer] Found ${files.length} source files`);
    }

    // 2. Open database and init schema
    const db = openDatabase(dbPath);
    initSchema(db);
    const repo = new SymbolRepo(db);

    // 3. Parse each file and collect symbols
    const allSymbols: SymbolRecord[] = [];
    const byKind: Record<SymbolKind, number> = {
      class: 0,
      function: 0,
      method: 0,
      enum: 0,
      constant: 0,
    };

    let parsedFiles = 0;
    for (const file of files) {
      const symbols = this.extractor.extractFile(file, cesiumRoot);
      allSymbols.push(...symbols);
      parsedFiles++;

      for (const s of symbols) {
        byKind[s.kind] = (byKind[s.kind] || 0) + 1;
      }

      if (this.verbose && parsedFiles % 100 === 0) {
        console.log(`[indexer] Parsed ${parsedFiles}/${files.length} files (${allSymbols.length} symbols)`);
      }
    }

    // 4. Batch insert into SQLite
    const inserted = repo.insertMany(allSymbols);

    // 5. Summary
    const duration = Date.now() - startTime;
    const summary: IndexSummary = {
      totalFiles: parsedFiles,
      totalSymbols: inserted,
      byKind,
      duration,
    };

    if (this.verbose) {
      this.printSummary(summary);
    }

    db.close();
    return summary;
  }

  private async discoverFiles(cesiumRoot: string): Promise<string[]> {
    const absRoot = path.resolve(cesiumRoot);
    const patterns = SCAN_PATTERNS.map((p) => path.join(absRoot, p).replace(/\\/g, "/"));
    const exclude = EXCLUDE_PATTERNS.map((p) => p.replace(/\*\*/g, "**"));

    const files = await glob(patterns, {
      ignore: exclude,
      absolute: true,
      onlyFiles: true,
    });

    return files.sort();
  }

  private printSummary(summary: IndexSummary): void {
    console.log("\n╔══════════════════════════════════════╗");
    console.log("║       Cesium Symbol Index Summary    ║");
    console.log("╠══════════════════════════════════════╣");
    console.log(`║  Files scanned:  ${String(summary.totalFiles).padStart(8)}         ║`);
    console.log(`║  Total symbols:  ${String(summary.totalSymbols).padStart(8)}         ║`);
    console.log("║                                      ║");
    console.log(`║  Classes:        ${String(summary.byKind.class || 0).padStart(8)}         ║`);
    console.log(`║  Functions:      ${String(summary.byKind.function || 0).padStart(8)}         ║`);
    console.log(`║  Methods:        ${String(summary.byKind.method || 0).padStart(8)}         ║`);
    console.log(`║  Enums:          ${String(summary.byKind.enum || 0).padStart(8)}         ║`);
    console.log(`║  Constants:      ${String(summary.byKind.constant || 0).padStart(8)}         ║`);
    console.log("║                                      ║");
    console.log(`║  Duration:       ${String(summary.duration + "ms").padStart(8)}         ║`);
    console.log("╚══════════════════════════════════════╝\n");
  }
}
