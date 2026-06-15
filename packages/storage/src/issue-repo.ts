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

  getSyncCursor(): string | null {
    const stmt = this.db.prepare(
      `SELECT value FROM meta WHERE key = ?`,
    );
    const row = stmt.get("github_issues_last_sync") as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setSyncCursor(timestamp: string): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`,
    );
    stmt.run("github_issues_last_sync", timestamp);
  }

  clear(): void {
    this.db.exec(`DELETE FROM issues`);
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
