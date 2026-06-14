import type { SymbolRecord, SymbolKind } from "@cesium-nexus/shared";
import type BetterSqlite3 from "better-sqlite3";
import type { Database } from "./schema.js";

interface SymbolRow {
  id: string;
  name: string;
  kind: string;
  file_path: string;
  start_line: number;
  end_line: number;
  doc_comment: string | null;
  exports: string;
  imports: string;
  parent_class: string | null;
}

export interface SourceFtsEntry {
  symbolId: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  code: string;
}

export interface SourceSearchResult {
  symbolId: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  snippet: string;
}

export class SymbolRepo {
  private insertStmt: BetterSqlite3.Statement;
  private findByNameStmt: BetterSqlite3.Statement;
  private findByIdStmt: BetterSqlite3.Statement;
  private findByFilePathStmt: BetterSqlite3.Statement;
  private countByKindStmt: BetterSqlite3.Statement;
  private totalCountStmt: BetterSqlite3.Statement;

  constructor(private db: Database) {
    this.insertStmt = db.prepare(`
      INSERT OR REPLACE INTO symbols (id, name, kind, file_path, start_line, end_line, doc_comment, exports, imports, parent_class)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.findByNameStmt = db.prepare(`SELECT * FROM symbols WHERE name = ?`);
    this.findByIdStmt = db.prepare(`SELECT * FROM symbols WHERE id = ?`);
    this.findByFilePathStmt = db.prepare(`SELECT * FROM symbols WHERE file_path = ?`);
    this.countByKindStmt = db.prepare(`SELECT kind, COUNT(*) as count FROM symbols GROUP BY kind`);
    this.totalCountStmt = db.prepare(`SELECT COUNT(*) as count FROM symbols`);
  }

  insertMany(symbols: SymbolRecord[]): number {
    const tx = this.db.transaction((items: SymbolRecord[]) => {
      let count = 0;
      for (const s of items) {
        this.insertStmt.run(
          s.id,
          s.name,
          s.kind,
          s.filePath,
          s.startLine,
          s.endLine,
          s.docComment ?? null,
          JSON.stringify(s.exports),
          JSON.stringify(s.imports),
          s.parentClass ?? null,
        );
        count++;
      }
      return count;
    });
    return tx(symbols);
  }

  findByName(name: string): SymbolRecord[] {
    const rows = this.findByNameStmt.all(name) as SymbolRow[];
    return rows.map(this.rowToRecord);
  }

  findById(id: string): SymbolRecord | undefined {
    const row = this.findByIdStmt.get(id) as SymbolRow | undefined;
    return row ? this.rowToRecord(row) : undefined;
  }

  searchFts(query: string, limit = 20): SymbolRecord[] {
    // FTS5 match query — sanitize: tokenize and quote to prevent special
    // characters (. * ^ etc.) from being interpreted as FTS5 operators
    const tokens = query.match(/[\w]+/g);
    if (!tokens || tokens.length === 0) return [];
    const safeQuery = tokens.map((t) => `"${t}"`).join(" ");

    const stmt = this.db.prepare(`
      SELECT s.* FROM symbols s
      JOIN symbols_fts f ON s.rowid = f.rowid
      WHERE symbols_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    const rows = stmt.all(safeQuery, limit) as SymbolRow[];
    return rows.map(this.rowToRecord);
  }

  findByFilePath(filePath: string): SymbolRecord[] {
    const rows = this.findByFilePathStmt.all(filePath) as SymbolRow[];
    return rows.map(this.rowToRecord);
  }

  countByKind(): Record<string, number> {
    const rows = this.countByKindStmt.all() as { kind: string; count: number }[];
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.kind] = row.count;
    }
    return result;
  }

  totalCount(): number {
    const row = this.totalCountStmt.get() as { count: number };
    return row.count;
  }

  insertSourceFts(entries: SourceFtsEntry[]): number {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO source_code (symbol_id, name, file_path, start_line, end_line, code)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction((items: SourceFtsEntry[]) => {
      let count = 0;
      for (const e of items) {
        stmt.run(e.symbolId, e.name, e.filePath, e.startLine, e.endLine, e.code);
        count++;
      }
      return count;
    });
    return tx(entries);
  }

  searchSource(query: string, limit = 20): SourceSearchResult[] {
    // Sanitize: split into alphanumeric tokens, quote each to prevent FTS5
    // special characters (. * ^ etc.) from being interpreted as operators
    const tokens = query.match(/[\w]+/g);
    if (!tokens || tokens.length === 0) return [];
    const safeQuery = tokens.map((t) => `"${t}"`).join(" ");

    const stmt = this.db.prepare(`
      SELECT sc.symbol_id, sc.name, sc.file_path, sc.start_line, sc.end_line,
             snippet(source_fts, 0, '>>>', '<<<', '...', 20) AS snippet
      FROM source_fts
      JOIN source_code sc ON source_fts.rowid = sc.rowid
      WHERE source_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    const rows = stmt.all(safeQuery, limit) as {
      symbol_id: string;
      name: string;
      file_path: string;
      start_line: number;
      end_line: number;
      snippet: string;
    }[];
    return rows.map((r) => ({
      symbolId: r.symbol_id,
      name: r.name,
      filePath: r.file_path,
      startLine: r.start_line,
      endLine: r.end_line,
      snippet: r.snippet ?? "",
    }));
  }

  clearSourceFts(): void {
    this.db.exec(`DELETE FROM source_code`);
  }

  private rowToRecord(row: SymbolRow): SymbolRecord {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind as SymbolKind,
      filePath: row.file_path,
      startLine: row.start_line,
      endLine: row.end_line,
      docComment: row.doc_comment ?? undefined,
      exports: JSON.parse(row.exports || "[]"),
      imports: JSON.parse(row.imports || "[]"),
      parentClass: row.parent_class ?? undefined,
    };
  }
}
