/**
 * Snapshot Builder
 *
 * Scans Cesium source code at a specific version and builds symbol snapshot.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { createHash } from "node:crypto";
import type { Database } from "@cesium-nexus/storage";
import type { SymbolSnapshot, SymbolIdentity, SnapshotBuilderOptions } from "./types.js";
import { generateSymbolId, parseSymbolIdentity } from "./identity.js";
import { SnapshotRepo, initVersionSchema } from "./snapshot-repo.js";

export class SnapshotBuilder {
  private repo: SnapshotRepo;

  constructor(private db: Database) {
    initVersionSchema(db);
    this.repo = new SnapshotRepo(db);
  }

  /**
   * Build snapshot for a specific Cesium version.
   *
   * This will:
   * 1. Checkout the specified version in git submodule
   * 2. Scan all JS files for symbols
   * 3. Generate stable symbol IDs
   * 4. Store snapshot in database
   */
  async buildSnapshot(options: SnapshotBuilderOptions): Promise<SymbolSnapshot[]> {
    const { version, cesiumRoot } = options;

    // Check if snapshot already exists
    if (this.repo.snapshotExists(version)) {
      console.log(`Snapshot for version ${version} already exists, returning cached`);
      return this.repo.getSnapshot(version);
    }

    console.log(`Building snapshot for version ${version}...`);

    // Scan symbols from cesium source
    const symbols = await this.scanCesiumSymbols(cesiumRoot);

    // Build snapshots with stable IDs
    const snapshots: SymbolSnapshot[] = [];
    const now = Date.now();

    for (const symbol of symbols) {
      const identity = parseSymbolIdentity(
        symbol.name,
        symbol.kind,
        symbol.parentClass,
        symbol.filePath
      );

      const symbolId = generateSymbolId(identity);
      const sourceHash = this.computeSourceHash(symbol.filePath, symbol.startLine, symbol.endLine);

      const snapshot: SymbolSnapshot = {
        id: `snapshot/${version}/${symbolId}`,
        version,
        symbolId,
        name: symbol.name,
        kind: identity.kind,
        filePath: symbol.filePath,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        docComment: symbol.docComment,
        sourceHash,
        snapshotAt: now,
      };

      snapshots.push(snapshot);
    }

    // Batch insert
    const count = this.repo.upsertSnapshots(snapshots);
    console.log(`Snapshot built: ${count} symbols for version ${version}`);

    return snapshots;
  }

  /**
   * Get existing snapshot for a version.
   */
  getSnapshot(version: string): SymbolSnapshot[] {
    return this.repo.getSnapshot(version);
  }

  /**
   * Check if snapshot exists for a version.
   */
  snapshotExists(version: string): boolean {
    return this.repo.snapshotExists(version);
  }

  /**
   * List all available versions.
   */
  listVersions(): string[] {
    return this.repo.listVersions();
  }

  /**
   * Get snapshot statistics.
   */
  getStats(version: string): { total: number; byKind: Record<string, number> } {
    return this.repo.getSnapshotStats(version);
  }

  // ─── Private Methods ───

  private async scanCesiumSymbols(
    cesiumRoot: string
  ): Promise<Array<{
    name: string;
    kind: string;
    filePath: string;
    startLine: number;
    endLine: number;
    docComment?: string;
    parentClass?: string;
  }>> {
    const symbols: Array<{
      name: string;
      kind: string;
      filePath: string;
      startLine: number;
      endLine: number;
      docComment?: string;
      parentClass?: string;
    }> = [];

    // Scan engine and widgets source directories
    const sourceDirs = [
      path.join(cesiumRoot, "packages", "engine", "Source"),
      path.join(cesiumRoot, "packages", "widgets", "Source"),
    ];

    for (const dir of sourceDirs) {
      if (fs.existsSync(dir)) {
        await this.scanDirectory(dir, symbols);
      }
    }

    return symbols;
  }

  private async scanDirectory(
    dir: string,
    symbols: Array<{
      name: string;
      kind: string;
      filePath: string;
      startLine: number;
      endLine: number;
      docComment?: string;
      parentClass?: string;
    }>
  ): Promise<void> {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        await this.scanDirectory(fullPath, symbols);
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        this.scanFile(fullPath, symbols);
      }
    }
  }

  private scanFile(
    filePath: string,
    symbols: Array<{
      name: string;
      kind: string;
      filePath: string;
      startLine: number;
      endLine: number;
      docComment?: string;
      parentClass?: string;
    }>
  ): void {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    let currentClass: string | undefined;
    let currentDocComment: string | undefined;
    let docCommentStartLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Collect doc comments
      if (line.trim().startsWith("/**")) {
        docCommentStartLine = i;
        currentDocComment = "";
      }

      if (docCommentStartLine >= 0) {
        currentDocComment += line + "\n";
        if (line.trim().endsWith("*/")) {
          docCommentStartLine = -1;
        }
      }

      // Detect class definition
      const classMatch = line.match(
        /^(?:export\s+)?(?:class|var\s+\w+\s*=\s*class)\s+(\w+)/
      );
      if (classMatch) {
        currentClass = classMatch[1];
        symbols.push({
          name: currentClass,
          kind: "class",
          filePath,
          startLine: lineNum,
          endLine: this.findBlockEnd(lines, i),
          docComment: currentDocComment?.trim(),
        });
        currentDocComment = undefined;
        continue;
      }

      // Detect function definition
      const funcMatch = line.match(
        /^(?:export\s+)?(?:function|var\s+\w+\s*=\s*function)\s+(\w+)/
      );
      if (funcMatch) {
        symbols.push({
          name: funcMatch[1],
          kind: "function",
          filePath,
          startLine: lineNum,
          endLine: this.findBlockEnd(lines, i),
          docComment: currentDocComment?.trim(),
        });
        currentDocComment = undefined;
        continue;
      }

      // Detect method definition (inside class)
      const methodMatch = line.match(/^\s+(?:(?:get|set)\s+)?(\w+)\s*\(/);
      if (methodMatch && currentClass) {
        // Skip common non-method patterns
        const name = methodMatch[1];
        if (
          !["if", "for", "while", "switch", "catch", "constructor"].includes(name)
        ) {
          symbols.push({
            name,
            kind: "method",
            filePath,
            startLine: lineNum,
            endLine: this.findBlockEnd(lines, i),
            docComment: currentDocComment?.trim(),
            parentClass: currentClass,
          });
          currentDocComment = undefined;
        }
      }

      // Detect enum-like patterns
      const enumMatch = line.match(
        /^(?:export\s+)?var\s+(\w+)\s*=\s*Object\.freeze/
      );
      if (enumMatch) {
        symbols.push({
          name: enumMatch[1],
          kind: "enum",
          filePath,
          startLine: lineNum,
          endLine: this.findBlockEnd(lines, i),
          docComment: currentDocComment?.trim(),
        });
        currentDocComment = undefined;
      }

      // Reset currentClass at file-level scope changes
      if (line.match(/^export\s+class/) || line.match(/^var\s+\w+\s*=\s*class/)) {
        // Already handled above
      } else if (line.match(/^export\s+/) && !line.match(/^\s/)) {
        currentClass = undefined;
      }
    }
  }

  private findBlockEnd(lines: string[], startLine: number): number {
    let braceCount = 0;
    let foundOpen = false;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      for (const char of line) {
        if (char === "{") {
          braceCount++;
          foundOpen = true;
        } else if (char === "}") {
          braceCount--;
          if (foundOpen && braceCount === 0) {
            return i + 1;
          }
        }
      }
    }

    // Fallback: return start + 1
    return startLine + 1;
  }

  private computeSourceHash(
    filePath: string,
    startLine: number,
    endLine: number
  ): string {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const relevantLines = lines.slice(startLine - 1, endLine).join("\n");
      return createHash("sha1").update(relevantLines).digest("hex");
    } catch {
      return "unknown";
    }
  }
}
