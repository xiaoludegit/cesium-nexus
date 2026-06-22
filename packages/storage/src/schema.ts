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

    -- Call graph edges
    CREATE TABLE IF NOT EXISTS call_edges (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      source_name TEXT NOT NULL,
      target_name TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      weight REAL DEFAULT 1,
      PRIMARY KEY (source_id, target_id, edge_type)
    );

    CREATE INDEX IF NOT EXISTS idx_call_source ON call_edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_call_target ON call_edges(target_id);

    -- Pull requests table
    CREATE TABLE IF NOT EXISTS pull_requests (
      id INTEGER PRIMARY KEY,
      repo TEXT NOT NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      state TEXT,
      merged_at TEXT,
      author TEXT,
      labels TEXT,
      review_comments INTEGER,
      files_changed INTEGER,
      created_at TEXT,
      updated_at TEXT,
      html_url TEXT,
      closing_issue_refs TEXT,
      UNIQUE(repo, number)
    );

    CREATE INDEX IF NOT EXISTS idx_prs_state ON pull_requests(state);
    CREATE INDEX IF NOT EXISTS idx_prs_updated ON pull_requests(updated_at);

    CREATE VIRTUAL TABLE IF NOT EXISTS prs_fts
      USING fts5(title, body, content='pull_requests', content_rowid='id');

    CREATE TRIGGER IF NOT EXISTS prs_fts_ai AFTER INSERT ON pull_requests BEGIN
      INSERT INTO prs_fts(rowid, title, body)
      VALUES (new.id, new.title, new.body);
    END;

    CREATE TRIGGER IF NOT EXISTS prs_fts_ad AFTER DELETE ON pull_requests BEGIN
      INSERT INTO prs_fts(prs_fts, rowid, title, body)
      VALUES ('delete', old.id, old.title, old.body);
    END;

    CREATE TRIGGER IF NOT EXISTS prs_fts_au AFTER UPDATE ON pull_requests BEGIN
      INSERT INTO prs_fts(prs_fts, rowid, title, body)
      VALUES ('delete', old.id, old.title, old.body);
      INSERT INTO prs_fts(rowid, title, body)
      VALUES (new.id, new.title, new.body);
    END;

    -- Forum posts table
    CREATE TABLE IF NOT EXISTS forum_posts (
      id INTEGER PRIMARY KEY,
      topic_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      author TEXT,
      replies_count INTEGER,
      views_count INTEGER,
      has_solution INTEGER,
      tags TEXT,
      created_at TEXT,
      updated_at TEXT,
      url TEXT,
      quality_score REAL
    );

    CREATE INDEX IF NOT EXISTS idx_forum_quality ON forum_posts(quality_score);

    CREATE VIRTUAL TABLE IF NOT EXISTS forum_fts
      USING fts5(title, body, content='forum_posts', content_rowid='id');

    CREATE TRIGGER IF NOT EXISTS forum_fts_ai AFTER INSERT ON forum_posts BEGIN
      INSERT INTO forum_fts(rowid, title, body)
      VALUES (new.id, new.title, new.body);
    END;

    CREATE TRIGGER IF NOT EXISTS forum_fts_ad AFTER DELETE ON forum_posts BEGIN
      INSERT INTO forum_fts(forum_fts, rowid, title, body)
      VALUES ('delete', old.id, old.title, old.body);
    END;

    CREATE TRIGGER IF NOT EXISTS forum_fts_au AFTER UPDATE ON forum_posts BEGIN
      INSERT INTO forum_fts(forum_fts, rowid, title, body)
      VALUES ('delete', old.id, old.title, old.body);
      INSERT INTO forum_fts(rowid, title, body)
      VALUES (new.id, new.title, new.body);
    END;

    -- Experience node table (unified Issue/PR/Forum search)
    CREATE TABLE IF NOT EXISTS experience_node (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      source TEXT,
      summary TEXT,
      related_symbols TEXT,
      tags TEXT,
      quality_score REAL,
      published_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_exp_type ON experience_node(type);
    CREATE INDEX IF NOT EXISTS idx_exp_quality ON experience_node(quality_score);

    CREATE VIRTUAL TABLE IF NOT EXISTS experience_fts
      USING fts5(title, summary, content='experience_node', content_rowid='rowid');

    CREATE TRIGGER IF NOT EXISTS experience_fts_ai AFTER INSERT ON experience_node BEGIN
      INSERT INTO experience_fts(rowid, title, summary)
      VALUES (new.rowid, new.title, new.summary);
    END;

    CREATE TRIGGER IF NOT EXISTS experience_fts_ad AFTER DELETE ON experience_node BEGIN
      INSERT INTO experience_fts(experience_fts, rowid, title, summary)
      VALUES ('delete', old.rowid, old.title, old.summary);
    END;

    CREATE TRIGGER IF NOT EXISTS experience_fts_au AFTER UPDATE ON experience_node BEGIN
      INSERT INTO experience_fts(experience_fts, rowid, title, summary)
      VALUES ('delete', old.rowid, old.title, old.summary);
      INSERT INTO experience_fts(rowid, title, summary)
      VALUES (new.rowid, new.title, new.summary);
    END;

    -- Experience edge table (graph edges between experience nodes)
    CREATE TABLE IF NOT EXISTS experience_edge (
      id TEXT PRIMARY KEY,
      source_node_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_edge_source ON experience_edge(source_node_id);
    CREATE INDEX IF NOT EXISTS idx_edge_target ON experience_edge(target_node_id);
    CREATE INDEX IF NOT EXISTS idx_edge_type ON experience_edge(edge_type);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_edge_unique
      ON experience_edge(source_node_id, target_node_id, edge_type);
  `);
}
