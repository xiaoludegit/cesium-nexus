/**
 * Shader Repository
 *
 * Manages shader_symbol table.
 */

import type { Database } from "@cesium-nexus/storage";
import type { ShaderSymbol, ShaderSymbolType, ShaderFilters, ShaderIndexStats } from "./shader-types.js";

/**
 * Initialize shader schema.
 */
export function initShaderSchema(db: Database): void {
  db.exec(`
    -- Shader symbols from GLSL files
    CREATE TABLE IF NOT EXISTS shader_symbol (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      file TEXT NOT NULL,
      source TEXT NOT NULL,
      related_js_symbols TEXT DEFAULT '[]',
      related_render_stage TEXT,
      doc_comment TEXT,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_shader_name ON shader_symbol(name);
    CREATE INDEX IF NOT EXISTS idx_shader_type ON shader_symbol(type);
    CREATE INDEX IF NOT EXISTS idx_shader_file ON shader_symbol(file);
    CREATE INDEX IF NOT EXISTS idx_shader_stage ON shader_symbol(related_render_stage);
  `);
}

export class ShaderRepo {
  constructor(private db: Database) {}

  upsertShader(shader: ShaderSymbol): void {
    this.db
      .prepare(
        `INSERT INTO shader_symbol (id, name, type, file, source, related_js_symbols, related_render_stage, doc_comment, start_line, end_line, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         type = excluded.type,
         file = excluded.file,
         source = excluded.source,
         related_js_symbols = excluded.related_js_symbols,
         related_render_stage = excluded.related_render_stage,
         doc_comment = excluded.doc_comment,
         start_line = excluded.start_line,
         end_line = excluded.end_line`
      )
      .run(
        shader.id,
        shader.name,
        shader.type,
        shader.file,
        shader.source,
        JSON.stringify(shader.relatedJsSymbols),
        shader.relatedRenderStage ?? null,
        shader.docComment ?? null,
        shader.startLine,
        shader.endLine,
        Date.now()
      );
  }

  upsertShaders(shaders: ShaderSymbol[]): number {
    const stmt = this.db.prepare(
      `INSERT INTO shader_symbol (id, name, type, file, source, related_js_symbols, related_render_stage, doc_comment, start_line, end_line, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         type = excluded.type,
         file = excluded.file,
         source = excluded.source,
         related_js_symbols = excluded.related_js_symbols,
         related_render_stage = excluded.related_render_stage,
         doc_comment = excluded.doc_comment,
         start_line = excluded.start_line,
         end_line = excluded.end_line`
    );

    const insert = this.db.transaction((items: ShaderSymbol[]) => {
      let count = 0;
      for (const s of items) {
        stmt.run(
          s.id,
          s.name,
          s.type,
          s.file,
          s.source,
          JSON.stringify(s.relatedJsSymbols),
          s.relatedRenderStage ?? null,
          s.docComment ?? null,
          s.startLine,
          s.endLine,
          Date.now()
        );
        count++;
      }
      return count;
    });

    return insert(shaders);
  }

  getShader(id: string): ShaderSymbol | null {
    const row = this.db
      .prepare(`SELECT * FROM shader_symbol WHERE id = ?`)
      .get(id) as any;

    if (!row) return null;
    return this.rowToShader(row);
  }

  getByName(name: string): ShaderSymbol | null {
    const row = this.db
      .prepare(`SELECT * FROM shader_symbol WHERE name = ?`)
      .get(name) as any;

    if (!row) return null;
    return this.rowToShader(row);
  }

  searchByName(pattern: string): ShaderSymbol[] {
    const rows = this.db
      .prepare(`SELECT * FROM shader_symbol WHERE name LIKE ? ORDER BY name`)
      .all(`%${pattern}%`) as any[];

    return rows.map((r) => this.rowToShader(r));
  }

  getByType(type: ShaderSymbolType): ShaderSymbol[] {
    const rows = this.db
      .prepare(`SELECT * FROM shader_symbol WHERE type = ? ORDER BY name`)
      .all(type) as any[];

    return rows.map((r) => this.rowToShader(r));
  }

  getByFile(filePattern: string): ShaderSymbol[] {
    const rows = this.db
      .prepare(`SELECT * FROM shader_symbol WHERE file LIKE ? ORDER BY name`)
      .all(`%${filePattern}%`) as any[];

    return rows.map((r) => this.rowToShader(r));
  }

  getByRenderStage(stage: string): ShaderSymbol[] {
    const rows = this.db
      .prepare(`SELECT * FROM shader_symbol WHERE related_render_stage = ? ORDER BY name`)
      .all(stage) as any[];

    return rows.map((r) => this.rowToShader(r));
  }

  getByRelatedJs(jsSymbolId: string): ShaderSymbol[] {
    const rows = this.db
      .prepare(`SELECT * FROM shader_symbol WHERE related_js_symbols LIKE ?`)
      .all(`%${jsSymbolId}%`) as any[];

    return rows.filter((r) => {
      const related = JSON.parse(r.related_js_symbols || "[]");
      return related.includes(jsSymbolId);
    }).map((r) => this.rowToShader(r));
  }

  getAll(): ShaderSymbol[] {
    const rows = this.db
      .prepare(`SELECT * FROM shader_symbol ORDER BY name`)
      .all() as any[];

    return rows.map((r) => this.rowToShader(r));
  }

  search(filters: ShaderFilters): ShaderSymbol[] {
    let query = `SELECT * FROM shader_symbol WHERE 1=1`;
    const params: any[] = [];

    if (filters.type) {
      query += ` AND type = ?`;
      params.push(filters.type);
    }

    if (filters.file) {
      query += ` AND file LIKE ?`;
      params.push(`%${filters.file}%`);
    }

    if (filters.renderStage) {
      query += ` AND related_render_stage = ?`;
      params.push(filters.renderStage);
    }

    query += ` ORDER BY name`;

    const rows = this.db.prepare(query).all(...params) as any[];
    let results = rows.map((r) => this.rowToShader(r));

    // Filter by relatedJsSymbol (JSON array search)
    if (filters.relatedJsSymbol) {
      results = results.filter((s) =>
        s.relatedJsSymbols.includes(filters.relatedJsSymbol!)
      );
    }

    return results;
  }

  getStats(): ShaderIndexStats {
    const total = (
      this.db.prepare(`SELECT COUNT(*) as count FROM shader_symbol`).get() as any
    ).count;

    const byTypeRows = this.db
      .prepare(`SELECT type, COUNT(*) as count FROM shader_symbol GROUP BY type`)
      .all() as any[];

    const byType: Record<string, number> = {};
    for (const row of byTypeRows) {
      byType[row.type] = row.count;
    }

    const byFileRows = this.db
      .prepare(`SELECT file, COUNT(*) as count FROM shader_symbol GROUP BY file`)
      .all() as any[];

    const byFile: Record<string, number> = {};
    for (const row of byFileRows) {
      byFile[row.file] = row.count;
    }

    // Count relatable symbols (uniforms, varyings, functions that typically have JS counterparts)
    const relatableTypes = ["uniform", "varying", "function"];
    const relatable = (
      this.db
        .prepare(
          `SELECT COUNT(*) as count FROM shader_symbol WHERE type IN (?, ?, ?)`
        )
        .get(...relatableTypes) as any
    ).count;

    // Count symbols with JS relations
    const related = (
      this.db
        .prepare(
          `SELECT COUNT(*) as count FROM shader_symbol WHERE related_js_symbols != '[]'`
        )
        .get() as any
    ).count;

    return {
      totalSymbols: total,
      byType: byType as Record<ShaderSymbolType, number>,
      byFile,
      relatableSymbols: relatable,
      relatedSymbols: related,
      relationSuccessRate: relatable > 0 ? related / relatable : 0,
    };
  }

  clear(): void {
    this.db.exec(`DELETE FROM shader_symbol`);
  }

  private rowToShader(row: any): ShaderSymbol {
    return {
      id: row.id,
      name: row.name,
      type: row.type as ShaderSymbolType,
      file: row.file,
      source: row.source,
      relatedJsSymbols: JSON.parse(row.related_js_symbols || "[]"),
      relatedRenderStage: row.related_render_stage,
      docComment: row.doc_comment,
      startLine: row.start_line,
      endLine: row.end_line,
    };
  }
}
