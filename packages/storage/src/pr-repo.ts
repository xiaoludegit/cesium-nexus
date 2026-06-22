import type { PullRequestRecord, PRSearchResult } from "@cesium-nexus/shared";
import type BetterSqlite3 from "better-sqlite3";
import type { Database } from "./schema.js";

interface PRRow {
  id: number;
  repo: string;
  number: number;
  title: string;
  body: string | null;
  state: string | null;
  merged_at: string | null;
  author: string | null;
  labels: string | null;
  review_comments: number | null;
  files_changed: number | null;
  created_at: string | null;
  updated_at: string | null;
  html_url: string | null;
  closing_issue_refs: string | null;
}

export class PullRequestRepo {
  private upsertStmt: BetterSqlite3.Statement;
  private totalCountStmt: BetterSqlite3.Statement;

  constructor(private db: Database) {
    this.upsertStmt = db.prepare(`
      INSERT OR REPLACE INTO pull_requests
        (id, repo, number, title, body, state, merged_at, author, labels, review_comments, files_changed, created_at, updated_at, html_url, closing_issue_refs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.totalCountStmt = db.prepare(`SELECT COUNT(*) as count FROM pull_requests`);
  }

  upsertMany(prs: PullRequestRecord[]): number {
    const tx = this.db.transaction((items: PullRequestRecord[]) => {
      let count = 0;
      for (const pr of items) {
        this.upsertStmt.run(
          pr.id,
          pr.repo,
          pr.number,
          pr.title,
          pr.body,
          pr.state,
          pr.mergedAt,
          pr.author,
          JSON.stringify(pr.labels),
          pr.reviewComments,
          pr.filesChanged,
          pr.createdAt,
          pr.updatedAt,
          pr.htmlUrl,
          JSON.stringify(pr.closingIssueReferences),
        );
        count++;
      }
      return count;
    });
    return tx(prs);
  }

  searchFts(
    keyword: string,
    options?: { limit?: number },
  ): PRSearchResult[] {
    const tokens = keyword.match(/[\w]+/g);
    if (!tokens || tokens.length === 0) return [];
    const safeQuery = tokens.map((t) => `"${t}"`).join(" ");

    const limit = options?.limit ?? 20;

    const sql = `
      SELECT p.id, p.repo, p.number, p.title, p.body, p.state,
             p.merged_at, p.author, p.labels, p.review_comments,
             p.files_changed, p.created_at, p.updated_at, p.html_url,
             p.closing_issue_refs,
             bm25(prs_fts) AS score
      FROM prs_fts
      JOIN pull_requests p ON prs_fts.rowid = p.id
      WHERE prs_fts MATCH ?
      ORDER BY score
      LIMIT ?
    `;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(safeQuery, limit) as (PRRow & { score: number })[];
    return rows.map((r) => ({
      pr: this.rowToRecord(r),
      score: r.score,
    }));
  }

  totalCount(): number {
    const row = this.totalCountStmt.get() as { count: number };
    return row.count;
  }

  getAllWithClosingRefs(): PullRequestRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM pull_requests
      WHERE merged_at IS NOT NULL
        AND closing_issue_refs IS NOT NULL
        AND closing_issue_refs != '[]'
    `);
    const rows = stmt.all() as PRRow[];
    return rows
      .map((r) => this.rowToRecord(r))
      .filter((pr) => pr.closingIssueReferences.length > 0);
  }

  getSyncCursor(repo: string): string | null {
    const stmt = this.db.prepare(
      `SELECT value FROM meta WHERE key = ?`,
    );
    const row = stmt.get(`github_prs_last_sync:${repo}`) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setSyncCursor(repo: string, timestamp: string): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`,
    );
    stmt.run(`github_prs_last_sync:${repo}`, timestamp);
  }

  clear(repo?: string): void {
    if (repo) {
      this.db.prepare(`DELETE FROM pull_requests WHERE repo = ?`).run(repo);
      this.db
        .prepare(`DELETE FROM meta WHERE key = ?`)
        .run(`github_prs_last_sync:${repo}`);
    } else {
      this.db.exec(`DELETE FROM pull_requests`);
      this.db.exec(
        `DELETE FROM meta WHERE key LIKE 'github_prs_last_sync:%'`,
      );
    }
  }

  private rowToRecord(row: PRRow): PullRequestRecord {
    return {
      id: row.id,
      repo: row.repo,
      number: row.number,
      title: row.title,
      body: row.body ?? "",
      state: row.state ?? "",
      mergedAt: row.merged_at ?? null,
      author: row.author ?? "",
      labels: JSON.parse(row.labels || "[]"),
      reviewComments: row.review_comments ?? 0,
      filesChanged: row.files_changed ?? 0,
      createdAt: row.created_at ?? "",
      updatedAt: row.updated_at ?? "",
      htmlUrl: row.html_url ?? "",
      closingIssueReferences: JSON.parse(row.closing_issue_refs || "[]"),
    };
  }
}
