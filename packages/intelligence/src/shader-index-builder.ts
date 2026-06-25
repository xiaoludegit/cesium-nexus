/**
 * Shader Index Builder
 *
 * Builds and manages the shader index for fast lookups.
 */

import * as path from "node:path";
import type { Database } from "@cesium-nexus/storage";
import type { ShaderSymbol, ShaderIndex, ShaderSymbolType, ShaderFilters, ShaderIndexStats } from "./shader-types.js";
import { ShaderRepo, initShaderSchema } from "./shader-repo.js";
import { GlslScanner } from "./glsl-scanner.js";
import { ShaderJsLinker } from "./shader-js-linker.js";

export class ShaderIndexBuilder {
  private repo: ShaderRepo;
  private scanner: GlslScanner;
  private linker: ShaderJsLinker;

  constructor(private db: Database) {
    initShaderSchema(db);
    this.repo = new ShaderRepo(db);
    this.scanner = new GlslScanner();
    this.linker = new ShaderJsLinker();
  }

  /**
   * Build shader index from Cesium source.
   */
  async build(cesiumRoot: string): Promise<ShaderIndex> {
    console.log("Building shader index...");

    // Scan GLSL files
    const shadersDir = path.join(cesiumRoot, "packages", "engine", "Source", "Shaders");
    let symbols = await this.scanner.scanDirectory(shadersDir);

    // Also scan for inline GLSL in JS files (e.g., *.glsl.js)
    const sourceDir = path.join(cesiumRoot, "packages", "engine", "Source");
    const inlineSymbols = await this.scanInlineGlsl(sourceDir);
    symbols = [...symbols, ...inlineSymbols];

    console.log(`Found ${symbols.length} shader symbols`);

    // Store in database
    this.repo.clear();
    const count = this.repo.upsertShaders(symbols);
    console.log(`Stored ${count} shader symbols`);

    // Build in-memory index
    return this.buildIndex(symbols);
  }

  /**
   * Build index from existing database records.
   */
  buildFromDb(): ShaderIndex {
    const symbols = this.repo.getAll();
    return this.buildIndex(symbols);
  }

  /**
   * Link shader symbols to JS symbols.
   */
  async linkJsSymbols(
    cesiumRoot: string,
    jsSymbols: Array<{ id: string; name: string; filePath: string }>
  ): Promise<number> {
    const symbols = this.repo.getAll();
    const linked = await this.linker.link(symbols, jsSymbols, cesiumRoot);

    // Update database with linked symbols
    let count = 0;
    for (const symbol of linked) {
      if (symbol.relatedJsSymbols.length > 0) {
        this.repo.upsertShader(symbol);
        count++;
      }
    }

    console.log(`Linked ${count} shader symbols to JS symbols`);
    return count;
  }

  /**
   * Get shader by ID.
   */
  getById(id: string): ShaderSymbol | null {
    return this.repo.getShader(id);
  }

  /**
   * Get shader by name.
   */
  getByName(name: string): ShaderSymbol | null {
    return this.repo.getByName(name);
  }

  /**
   * Search shaders by name pattern.
   */
  searchByName(pattern: string): ShaderSymbol[] {
    return this.repo.searchByName(pattern);
  }

  /**
   * Get shaders by type.
   */
  getByType(type: ShaderSymbolType): ShaderSymbol[] {
    return this.repo.getByType(type);
  }

  /**
   * Get shaders by file.
   */
  getByFile(filePattern: string): ShaderSymbol[] {
    return this.repo.getByFile(filePattern);
  }

  /**
   * Get shaders by render stage.
   */
  getByRenderStage(stage: string): ShaderSymbol[] {
    return this.repo.getByRenderStage(stage);
  }

  /**
   * Get shaders related to a JS symbol.
   */
  getByRelatedJs(jsSymbolId: string): ShaderSymbol[] {
    return this.repo.getByRelatedJs(jsSymbolId);
  }

  /**
   * Search shaders with filters.
   */
  search(filters: ShaderFilters): ShaderSymbol[] {
    return this.repo.search(filters);
  }

  /**
   * Get index statistics.
   */
  getStats(): ShaderIndexStats {
    return this.repo.getStats();
  }

  /**
   * Check if index exists.
   */
  exists(): boolean {
    const stats = this.repo.getStats();
    return stats.totalSymbols > 0;
  }

  // ─── Private Methods ───

  private buildIndex(symbols: ShaderSymbol[]): ShaderIndex {
    const index: ShaderIndex = {
      symbols: new Map(),
      byName: new Map(),
      byType: new Map(),
      byFile: new Map(),
      byRelatedJs: new Map(),
      byRenderStage: new Map(),
    };

    for (const symbol of symbols) {
      // By ID
      index.symbols.set(symbol.id, symbol);

      // By name
      index.byName.set(symbol.name, symbol);

      // By type
      const byType = index.byType.get(symbol.type) || [];
      byType.push(symbol);
      index.byType.set(symbol.type, byType);

      // By file
      const byFile = index.byFile.get(symbol.file) || [];
      byFile.push(symbol);
      index.byFile.set(symbol.file, byFile);

      // By related JS symbols
      for (const jsId of symbol.relatedJsSymbols) {
        const byJs = index.byRelatedJs.get(jsId) || [];
        byJs.push(symbol);
        index.byRelatedJs.set(jsId, byJs);
      }

      // By render stage
      if (symbol.relatedRenderStage) {
        const byStage = index.byRenderStage.get(symbol.relatedRenderStage) || [];
        byStage.push(symbol);
        index.byRenderStage.set(symbol.relatedRenderStage, byStage);
      }
    }

    return index;
  }

  private async scanInlineGlsl(sourceDir: string): Promise<ShaderSymbol[]> {
    const symbols: ShaderSymbol[] = [];

    // Scan for .glsl.js files that contain inline GLSL
    const scanDir = async (dir: string) => {
      if (!fs.existsSync(dir)) return;

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          await scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".glsl.js")) {
          const fileSymbols = this.scanner.scanFile(fullPath);
          symbols.push(...fileSymbols);
        }
      }
    };

    await scanDir(sourceDir);
    return symbols;
  }
}

// Need to import fs for the private method
import * as fs from "node:fs";
