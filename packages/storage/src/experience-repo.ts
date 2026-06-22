import type {
  ExperienceNode,
  ExperienceNodeType,
  ExperienceSearchResult,
} from "@cesium-nexus/shared";
import type BetterSqlite3 from "better-sqlite3";
import type { Database } from "./schema.js";

interface ExperienceRow {
  id: string;
  type: string;
  title: string;
  url: string | null;
  source: string | null;
  summary: string | null;
  related_symbols: string | null;
  tags: string | null;
  quality_score: number | null;
  published_at: string | null;
}

export class ExperienceRepo {
  private upsertStmt: BetterSqlite3.Statement;
  private totalCountStmt: BetterSqlite3.Statement;
  private getByIdStmt: BetterSqlite3.Statement;

  constructor(private db: Database) {
    this.upsertStmt = db.prepare(`
      INSERT OR REPLACE INTO experience_node
        (id, type, title, url, source, summary, related_symbols, tags, quality_score, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.totalCountStmt = db.prepare(
      `SELECT COUNT(*) as count FROM experience_node`,
    );
    this.getByIdStmt = db.prepare(
      `SELECT * FROM experience_node WHERE id = ?`,
    );
  }

  upsertMany(nodes: ExperienceNode[]): number {
    const tx = this.db.transaction((items: ExperienceNode[]) => {
      let count = 0;
      for (const n of items) {
        this.upsertStmt.run(
          n.id,
          n.type,
          n.title,
          n.url,
          n.source,
          n.summary,
          JSON.stringify(n.relatedSymbols),
          JSON.stringify(n.tags),
          n.qualityScore,
          n.publishedAt,
        );
        count++;
      }
      return count;
    });
    return tx(nodes);
  }

  searchFts(
    keyword: string,
    options?: {
      limit?: number;
      type?: ExperienceNodeType;
      symbol?: string;
      minQuality?: number;
    },
  ): ExperienceSearchResult[] {
    const tokens = keyword.match(/[\w]+/g);
    if (!tokens || tokens.length === 0) return [];
    const safeQuery = tokens.map((t) => `"${t}"`).join(" ");

    const limit = options?.limit ?? 20;
    const conditions: string[] = ["experience_fts MATCH ?"];
    const params: (string | number)[] = [safeQuery];

    if (options?.type) {
      conditions.push("e.type = ?");
      params.push(options.type);
    }
    if (options?.minQuality && options.minQuality > 0) {
      conditions.push("e.quality_score >= ?");
      params.push(options.minQuality);
    }

    let sql = `
      SELECT e.id, e.type, e.title, e.url, e.source, e.summary,
             e.related_symbols, e.tags, e.quality_score, e.published_at,
             bm25(experience_fts) AS score
      FROM experience_fts
      JOIN experience_node e ON experience_fts.rowid = e.rowid
      WHERE ${conditions.join(" AND ")}
      ORDER BY score
      LIMIT ?
    `;
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as (ExperienceRow & {
      score: number;
      rowid: number;
    })[];

    let results = rows.map((r) => ({
      node: this.rowToRecord(r),
      score: r.score,
    }));

    if (options?.symbol) {
      results = results.filter((r) =>
        r.node.relatedSymbols.includes(options.symbol!),
      );
    }

    return results;
  }

  totalCount(): number {
    const row = this.totalCountStmt.get() as { count: number };
    return row.count;
  }

  findByIds(ids: string[]): ExperienceNode[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const stmt = this.db.prepare(
      `SELECT * FROM experience_node WHERE id IN (${placeholders})`,
    );
    const rows = stmt.all(...ids) as ExperienceRow[];
    return rows.map((r) => this.rowToRecord(r));
  }

  getAll(): ExperienceNode[] {
    const stmt = this.db.prepare(`SELECT * FROM experience_node`);
    const rows = stmt.all() as ExperienceRow[];
    return rows.map((r) => this.rowToRecord(r));
  }

  getById(id: string): ExperienceNode | null {
    const row = this.getByIdStmt.get(id) as ExperienceRow | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  countByType(): Record<ExperienceNodeType, number> {
    const stmt = this.db.prepare(
      `SELECT type, COUNT(*) as count FROM experience_node GROUP BY type`,
    );
    const rows = stmt.all() as { type: string; count: number }[];
    const result: Record<ExperienceNodeType, number> = {
      issue: 0,
      pr_review: 0,
      forum: 0,
    };
    for (const row of rows) {
      if (row.type in result) {
        result[row.type as ExperienceNodeType] = row.count;
      }
    }
    return result;
  }

  clear(): void {
    this.db.exec(`DELETE FROM experience_node`);
  }

  private rowToRecord(row: ExperienceRow): ExperienceNode {
    return {
      id: row.id,
      type: row.type as ExperienceNodeType,
      title: row.title,
      url: row.url ?? "",
      source: row.source ?? "",
      summary: row.summary ?? "",
      relatedSymbols: JSON.parse(row.related_symbols || "[]"),
      tags: JSON.parse(row.tags || "[]"),
      qualityScore: row.quality_score ?? 0,
      publishedAt: row.published_at ?? "",
    };
  }
}

export function buildExperienceNode(
  type: ExperienceNodeType,
  source: {
    id: number | string;
    title: string;
    body: string;
    url: string;
    author?: string;
    labels?: string[];
    tags?: string[];
    relatedSymbols?: string[];
    qualityScore?: number;
    publishedAt?: string;
    repo?: string;
  },
  relatedSymbols?: string[],
): ExperienceNode {
  const summary = source.body.length > 500
    ? source.body.slice(0, 500) + "..."
    : source.body;

  return {
    id: `${type}:${source.id}`,
    type,
    title: source.title,
    url: source.url,
    source: source.repo ?? "",
    summary,
    relatedSymbols: relatedSymbols ?? source.relatedSymbols ?? [],
    tags: source.tags ?? source.labels ?? [],
    qualityScore: source.qualityScore ?? 0.5,
    publishedAt: source.publishedAt ?? "",
  };
}
