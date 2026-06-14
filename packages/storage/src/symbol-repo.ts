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

export class SymbolRepo {
  private insertStmt: BetterSqlite3.Statement;
  private findByNameStmt: BetterSqlite3.Statement;
  private findByFilePathStmt: BetterSqlite3.Statement;
  private countByKindStmt: BetterSqlite3.Statement;
  private totalCountStmt: BetterSqlite3.Statement;

  constructor(private db: Database) {
    this.insertStmt = db.prepare(`
      INSERT OR REPLACE INTO symbols (id, name, kind, file_path, start_line, end_line, doc_comment, exports, imports, parent_class)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.findByNameStmt = db.prepare(`SELECT * FROM symbols WHERE name = ?`);
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

  searchFts(query: string, limit = 20): SymbolRecord[] {
    // FTS5 match query — sanitize to prevent injection
    const safeQuery = query.replace(/[^\w\s.]/g, " ").trim();
    if (!safeQuery) return [];

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
