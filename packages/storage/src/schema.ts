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

    -- Source code backing table
    CREATE TABLE IF NOT EXISTS source_code (
      symbol_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER,
      end_line INTEGER,
      code TEXT NOT NULL
    );

    -- FTS5 index on source code for full-text search
    CREATE VIRTUAL TABLE IF NOT EXISTS source_fts
      USING fts5(code, content=source_code, content_rowid=rowid, tokenize='unicode61');

    CREATE TRIGGER IF NOT EXISTS source_fts_ai AFTER INSERT ON source_code BEGIN
      INSERT INTO source_fts(rowid, code) VALUES (new.rowid, new.code);
    END;

    CREATE TRIGGER IF NOT EXISTS source_fts_ad AFTER DELETE ON source_code BEGIN
      INSERT INTO source_fts(source_fts, rowid, code) VALUES ('delete', old.rowid, old.code);
    END;

    CREATE TRIGGER IF NOT EXISTS source_fts_au AFTER UPDATE ON source_code BEGIN
      INSERT INTO source_fts(source_fts, rowid, code) VALUES ('delete', old.rowid, old.code);
      INSERT INTO source_fts(rowid, code) VALUES (new.rowid, new.code);
    END;

    -- Issues table
    CREATE TABLE IF NOT EXISTS issues (
      id INTEGER PRIMARY KEY,
      repo TEXT NOT NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      state TEXT,
      labels TEXT,
      assignees TEXT,
      author TEXT,
      comments INTEGER,
      created_at TEXT,
      updated_at TEXT,
      closed_at TEXT,
      html_url TEXT,
      UNIQUE(repo, number)
    );

    CREATE INDEX IF NOT EXISTS idx_issues_state ON issues(state);
    CREATE INDEX IF NOT EXISTS idx_issues_updated ON issues(updated_at);

    -- FTS5 index on issues for full-text search
    CREATE VIRTUAL TABLE IF NOT EXISTS issues_fts
      USING fts5(title, body, content='issues', content_rowid='id');

    CREATE TRIGGER IF NOT EXISTS issues_fts_ai AFTER INSERT ON issues BEGIN
      INSERT INTO issues_fts(rowid, title, body)
      VALUES (new.id, new.title, new.body);
    END;

    CREATE TRIGGER IF NOT EXISTS issues_fts_ad AFTER DELETE ON issues BEGIN
      INSERT INTO issues_fts(issues_fts, rowid, title, body)
      VALUES ('delete', old.id, old.title, old.body);
    END;

    CREATE TRIGGER IF NOT EXISTS issues_fts_au AFTER UPDATE ON issues BEGIN
      INSERT INTO issues_fts(issues_fts, rowid, title, body)
      VALUES ('delete', old.id, old.title, old.body);
      INSERT INTO issues_fts(rowid, title, body)
      VALUES (new.id, new.title, new.body);
    END;

    -- Meta table for sync cursors and other key-value metadata
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}
