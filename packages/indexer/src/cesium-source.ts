import { SymbolExtractor } from "@cesium-nexus/parser";
import { openDatabase, initSchema, SymbolRepo } from "@cesium-nexus/storage";
import type { SourceFtsEntry } from "@cesium-nexus/storage";
import type { SymbolRecord, SymbolKind, IndexSummary } from "@cesium-nexus/shared";
import { glob } from "tinyglobby";
import { readFileSync } from "node:fs";
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
    console.log(`[indexer] Found ${files.length} source files`);

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

      // Progress output every 100 files or at the end
      if (parsedFiles % 100 === 0 || parsedFiles === files.length) {
        const pct = Math.round((parsedFiles / files.length) * 100);
        process.stdout.write(`\r[indexer] Parsing: ${parsedFiles}/${files.length} (${pct}%) — ${allSymbols.length} symbols`);
      }
    }
    console.log(""); // newline after progress

    // 4. Batch insert symbols into SQLite
    const inserted = repo.insertMany(allSymbols);

    // 5. Build source FTS index — read source code snippets for each symbol
    console.log("[indexer] Building source code FTS index...");
    repo.clearSourceFts();
    const sourceEntries = this.buildSourceFtsEntries(allSymbols, cesiumRoot);
    const sourceInserted = repo.insertSourceFts(sourceEntries);
    console.log(`[indexer] Indexed ${sourceInserted} source code snippets`);

    // 6. Summary
    const duration = Date.now() - startTime;
    const summary: IndexSummary = {
      totalFiles: parsedFiles,
      totalSymbols: inserted,
      byKind,
      duration,
    };

    this.printSummary(summary);

    db.close();
    return summary;
  }

  private buildSourceFtsEntries(symbols: SymbolRecord[], cesiumRoot: string): SourceFtsEntry[] {
    const fileCache = new Map<string, string[]>();
    const entries: SourceFtsEntry[] = [];

    for (const sym of symbols) {
      const absPath = path.join(cesiumRoot, sym.filePath);
      let lines: string[];

      if (fileCache.has(sym.filePath)) {
        lines = fileCache.get(sym.filePath)!;
      } else {
        try {
          const content = readFileSync(absPath, "utf-8");
          lines = content.split("\n");
          fileCache.set(sym.filePath, lines);
        } catch {
          continue; // Skip symbols whose files can't be read
        }
      }

      // Extract code lines for this symbol (0-indexed)
      const start = Math.max(0, sym.startLine - 1);
      const end = Math.min(lines.length, sym.endLine);
      const code = lines.slice(start, end).join("\n");

      if (code.trim()) {
        entries.push({
          symbolId: sym.id,
          name: sym.name,
          filePath: sym.filePath,
          startLine: sym.startLine,
          endLine: sym.endLine,
          code,
        });
      }
    }

    return entries;
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
