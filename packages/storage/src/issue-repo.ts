import type { IssueRecord, IssueSearchResult } from "@cesium-nexus/shared";
import type BetterSqlite3 from "better-sqlite3";
import type { Database } from "./schema.js";

interface IssueRow {
  id: number;
  repo: string;
  number: number;
  title: string;
  body: string | null;
  state: string | null;
  labels: string | null;
  assignees: string | null;
  author: string | null;
  comments: number | null;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  html_url: string | null;
}

export class IssueRepo {
  private upsertStmt: BetterSqlite3.Statement;
  private totalCountStmt: BetterSqlite3.Statement;

  constructor(private db: Database) {
    this.upsertStmt = db.prepare(`
      INSERT OR REPLACE INTO issues
        (id, repo, number, title, body, state, labels, assignees, author, comments, created_at, updated_at, closed_at, html_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.totalCountStmt = db.prepare(`SELECT COUNT(*) as count FROM issues`);
  }

  upsertMany(issues: IssueRecord[]): number {
    const tx = this.db.transaction((items: IssueRecord[]) => {
      let count = 0;
      for (const i of items) {
        this.upsertStmt.run(
          i.id,
          i.repo,
          i.number,
          i.title,
          i.body,
          i.state,
          JSON.stringify(i.labels),
          JSON.stringify(i.assignees),
          i.author,
          i.comments,
          i.createdAt,
          i.updatedAt,
          i.closedAt,
          i.htmlUrl,
        );
        count++;
      }
      return count;
    });
    return tx(issues);
  }

  searchFts(
    keyword: string,
    options?: { limit?: number; state?: "open" | "closed" },
  ): IssueSearchResult[] {
    const tokens = keyword.match(/[\w]+/g);
    if (!tokens || tokens.length === 0) return [];
    const safeQuery = tokens.map((t) => `"${t}"`).join(" ");

    const limit = options?.limit ?? 20;
    const state = options?.state;

    let sql: string;
    let params: (string | number)[];

    if (state) {
      sql = `
        SELECT i.id, i.repo, i.number, i.title, i.body, i.state,
               i.labels, i.assignees, i.author, i.comments,
               i.created_at, i.updated_at, i.closed_at, i.html_url,
               bm25(issues_fts) AS score
        FROM issues_fts
        JOIN issues i ON issues_fts.rowid = i.id
        WHERE issues_fts MATCH ?
          AND i.state = ?
        ORDER BY score
        LIMIT ?
      `;
      params = [safeQuery, state, limit];
    } else {
      sql = `
        SELECT i.id, i.repo, i.number, i.title, i.body, i.state,
               i.labels, i.assignees, i.author, i.comments,
               i.created_at, i.updated_at, i.closed_at, i.html_url,
               bm25(issues_fts) AS score
        FROM issues_fts
        JOIN issues i ON issues_fts.rowid = i.id
        WHERE issues_fts MATCH ?
        ORDER BY score
        LIMIT ?
      `;
      params = [safeQuery, limit];
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as (IssueRow & { score: number })[];
    return rows.map((r) => ({
      issue: this.rowToRecord(r),
      score: r.score,
    }));
  }

  totalCount(): number {
    const row = this.totalCountStmt.get() as { count: number };
    return row.count;
  }

  findByNumber(repo: string, number: number): IssueRecord | null {
    const stmt = this.db.prepare(
      `SELECT * FROM issues WHERE repo = ? AND number = ?`,
    );
    const row = stmt.get(repo, number) as IssueRow | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  listRecent(
    repo: string,
    options?: { since?: string; limit?: number },
  ): IssueRecord[] {
    const since = options?.since;
    const limit = options?.limit;

    let sql: string;
    let params: (string | number)[];

    if (since && limit) {
      sql = `SELECT * FROM issues WHERE repo = ? AND updated_at >= ? ORDER BY updated_at DESC LIMIT ?`;
      params = [repo, since, limit];
    } else if (since) {
      sql = `SELECT * FROM issues WHERE repo = ? AND updated_at >= ? ORDER BY updated_at DESC`;
      params = [repo, since];
    } else if (limit) {
      sql = `SELECT * FROM issues WHERE repo = ? ORDER BY updated_at DESC LIMIT ?`;
      params = [repo, limit];
    } else {
      sql = `SELECT * FROM issues WHERE repo = ? ORDER BY updated_at DESC`;
      params = [repo];
    }

    const rows = this.db.prepare(sql).all(...params) as IssueRow[];
    return rows.map((r) => this.rowToRecord(r));
  }

  getSyncCursor(repo: string): string | null {
    const stmt = this.db.prepare(
      `SELECT value FROM meta WHERE key = ?`,
    );
    const row = stmt.get(`github_issues_last_sync:${repo}`) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setSyncCursor(repo: string, timestamp: string): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`,
    );
    stmt.run(`github_issues_last_sync:${repo}`, timestamp);
  }

  clear(repo?: string): void {
    if (repo) {
      // Clear only this repo's issues and its sync cursor
      this.db.prepare(`DELETE FROM issues WHERE repo = ?`).run(repo);
      this.db
        .prepare(`DELETE FROM meta WHERE key = ?`)
        .run(`github_issues_last_sync:${repo}`);
    } else {
      // Clear all issues and all issue sync cursors
      this.db.exec(`DELETE FROM issues`);
      this.db.exec(
        `DELETE FROM meta WHERE key LIKE 'github_issues_last_sync:%'`,
      );
    }
  }

  private rowToRecord(row: IssueRow): IssueRecord {
    return {
      id: row.id,
      repo: row.repo,
      number: row.number,
      title: row.title,
      body: row.body ?? "",
      state: row.state ?? "",
      labels: JSON.parse(row.labels || "[]"),
      assignees: JSON.parse(row.assignees || "[]"),
      author: row.author ?? "",
      comments: row.comments ?? 0,
      createdAt: row.created_at ?? "",
      updatedAt: row.updated_at ?? "",
      closedAt: row.closed_at ?? null,
      htmlUrl: row.html_url ?? "",
    };
  }
}
