import BetterSqlite3 from "better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";

export type Database = BetterSqlite3.Database;

export function openDatabase(dbPath: string): Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new BetterSqlite3(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  return db;
}

export function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS symbols (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER,
      end_line INTEGER,
      doc_comment TEXT,
      exports TEXT,
      imports TEXT,
      parent_class TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
    CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
    CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);

    CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts
      USING fts5(name, doc_comment, content=symbols, content_rowid=rowid);

    CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
      INSERT INTO symbols_fts(rowid, name, doc_comment)
      VALUES (new.rowid, new.name, new.doc_comment);
    END;

    CREATE TRIGGER IF NOT EXISTS symbols_ad AFTER DELETE ON symbols BEGIN
      INSERT INTO symbols_fts(symbols_fts, rowid, name, doc_comment)
      VALUES ('delete', old.rowid, old.name, old.doc_comment);
    END;

    CREATE TRIGGER IF NOT EXISTS symbols_au AFTER UPDATE ON symbols BEGIN
      INSERT INTO symbols_fts(symbols_fts, rowid, name, doc_comment)
      VALUES ('delete', old.rowid, old.name, old.doc_comment);
      INSERT INTO symbols_fts(rowid, name, doc_comment)
      VALUES (new.rowid, new.name, new.doc_comment);
    END;
  `);
}
