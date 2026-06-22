import type { ForumPost, ForumSearchResult } from "@cesium-nexus/shared";
import type BetterSqlite3 from "better-sqlite3";
import type { Database } from "./schema.js";

interface ForumRow {
  id: number;
  topic_id: number;
  title: string;
  body: string | null;
  author: string | null;
  replies_count: number | null;
  views_count: number | null;
  has_solution: number | null;
  tags: string | null;
  created_at: string | null;
  updated_at: string | null;
  url: string | null;
  quality_score: number | null;
}

export class ForumRepo {
  private upsertStmt: BetterSqlite3.Statement;
  private totalCountStmt: BetterSqlite3.Statement;

  constructor(private db: Database) {
    this.upsertStmt = db.prepare(`
      INSERT OR REPLACE INTO forum_posts
        (id, topic_id, title, body, author, replies_count, views_count, has_solution, tags, created_at, updated_at, url, quality_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.totalCountStmt = db.prepare(`SELECT COUNT(*) as count FROM forum_posts`);
  }

  upsertMany(posts: ForumPost[]): number {
    const tx = this.db.transaction((items: ForumPost[]) => {
      let count = 0;
      for (const p of items) {
        this.upsertStmt.run(
          p.id,
          p.topicId,
          p.title,
          p.body,
          p.author,
          p.repliesCount,
          p.viewsCount,
          p.hasSolution ? 1 : 0,
          JSON.stringify(p.tags),
          p.createdAt,
          p.updatedAt,
          p.url,
          p.qualityScore,
        );
        count++;
      }
      return count;
    });
    return tx(posts);
  }

  searchFts(
    keyword: string,
    options?: { limit?: number; minQuality?: number },
  ): ForumSearchResult[] {
    const tokens = keyword.match(/[\w]+/g);
    if (!tokens || tokens.length === 0) return [];
    const safeQuery = tokens.map((t) => `"${t}"`).join(" ");

    const limit = options?.limit ?? 20;
    const minQuality = options?.minQuality ?? 0;

    let sql: string;
    let params: (string | number)[];

    if (minQuality > 0) {
      sql = `
        SELECT f.id, f.topic_id, f.title, f.body, f.author,
               f.replies_count, f.views_count, f.has_solution,
               f.tags, f.created_at, f.updated_at, f.url, f.quality_score,
               bm25(forum_fts) AS score
        FROM forum_fts
        JOIN forum_posts f ON forum_fts.rowid = f.id
        WHERE forum_fts MATCH ?
          AND f.quality_score >= ?
        ORDER BY score
        LIMIT ?
      `;
      params = [safeQuery, minQuality, limit];
    } else {
      sql = `
        SELECT f.id, f.topic_id, f.title, f.body, f.author,
               f.replies_count, f.views_count, f.has_solution,
               f.tags, f.created_at, f.updated_at, f.url, f.quality_score,
               bm25(forum_fts) AS score
        FROM forum_fts
        JOIN forum_posts f ON forum_fts.rowid = f.id
        WHERE forum_fts MATCH ?
        ORDER BY score
        LIMIT ?
      `;
      params = [safeQuery, limit];
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as (ForumRow & { score: number })[];
    return rows.map((r) => ({
      post: this.rowToRecord(r),
      score: r.score,
    }));
  }

  totalCount(): number {
    const row = this.totalCountStmt.get() as { count: number };
    return row.count;
  }

  getSyncCursor(key: string): string | null {
    const stmt = this.db.prepare(
      `SELECT value FROM meta WHERE key = ?`,
    );
    const row = stmt.get(`forum_last_sync:${key}`) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setSyncCursor(key: string, value: string): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`,
    );
    stmt.run(`forum_last_sync:${key}`, value);
  }

  clear(): void {
    this.db.exec(`DELETE FROM forum_posts`);
    this.db.exec(
      `DELETE FROM meta WHERE key LIKE 'forum_last_sync:%'`,
    );
  }

  private rowToRecord(row: ForumRow): ForumPost {
    return {
      id: row.id,
      topicId: row.topic_id,
      title: row.title,
      body: row.body ?? "",
      author: row.author ?? "",
      repliesCount: row.replies_count ?? 0,
      viewsCount: row.views_count ?? 0,
      hasSolution: (row.has_solution ?? 0) === 1,
      tags: JSON.parse(row.tags || "[]"),
      createdAt: row.created_at ?? "",
      updatedAt: row.updated_at ?? "",
      url: row.url ?? "",
      qualityScore: row.quality_score ?? 0,
    };
  }
}
