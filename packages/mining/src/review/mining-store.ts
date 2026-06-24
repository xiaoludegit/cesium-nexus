import type BetterSqlite3 from "better-sqlite3";
import type { CanonicalProblem, CandidateStatus, ProblemCandidate } from "../types.js";

type Database = BetterSqlite3.Database;

export class MiningStore {
  constructor(private db: Database) {
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS canonical_problem (
        id                       TEXT PRIMARY KEY,
        title                    TEXT NOT NULL,
        aliases                  TEXT NOT NULL,
        representative_issue_id  INTEGER,
        cluster_ids              TEXT NOT NULL,
        experience_ids           TEXT NOT NULL,
        confidence               REAL NOT NULL,
        status                   TEXT DEFAULT 'candidate',
        created_at               INTEGER NOT NULL,
        reviewed_at              INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_canonical_status ON canonical_problem(status);

      CREATE TABLE IF NOT EXISTS problem_candidate (
        id                 TEXT PRIMARY KEY,
        canonical_id       TEXT NOT NULL,
        cluster_id         TEXT NOT NULL,
        draft_alias        TEXT NOT NULL,
        draft_symptoms     TEXT NOT NULL,
        draft_symbols      TEXT NOT NULL,
        draft_category     TEXT,
        llm_raw            TEXT,
        quality_score      REAL,
        dup_of             TEXT,
        failed_draft       INTEGER NOT NULL DEFAULT 0,
        status             TEXT DEFAULT 'pending',
        reviewed_at        INTEGER,
        created_at         INTEGER NOT NULL,
        source_count       INTEGER NOT NULL DEFAULT 0,
        issue_count        INTEGER NOT NULL DEFAULT 0,
        forum_count        INTEGER NOT NULL DEFAULT 0,
        experience_count   INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_candidate_status ON problem_candidate(status);
      CREATE INDEX IF NOT EXISTS idx_candidate_canonical ON problem_candidate(canonical_id);
    `);
  }

  // ─── canonical_problem ────────────────────────────────────────

  upsertCanonical(p: CanonicalProblem): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO canonical_problem
          (id, title, aliases, representative_issue_id, cluster_ids, experience_ids,
           confidence, status, created_at, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        p.id,
        p.title,
        JSON.stringify(p.aliases),
        p.representativeIssueId,
        JSON.stringify(p.clusterIds),
        JSON.stringify(p.experienceIds),
        p.confidence,
        p.status,
        p.createdAt,
        p.reviewedAt,
      );
  }

  upsertCanonicalMany(items: CanonicalProblem[]): void {
    const tx = this.db.transaction((list: CanonicalProblem[]) => {
      for (const p of list) this.upsertCanonical(p);
    });
    tx(items);
  }

  listCanonical(status?: CanonicalProblem["status"]): CanonicalProblem[] {
    const sql = status
      ? `SELECT * FROM canonical_problem WHERE status = ? ORDER BY created_at DESC`
      : `SELECT * FROM canonical_problem ORDER BY created_at DESC`;
    const rows = (status
      ? this.db.prepare(sql).all(status)
      : this.db.prepare(sql).all()) as CanonicalRow[];
    return rows.map(fromCanonicalRow);
  }

  getCanonical(id: string): CanonicalProblem | null {
    const row = this.db
      .prepare(`SELECT * FROM canonical_problem WHERE id = ?`)
      .get(id) as CanonicalRow | undefined;
    return row ? fromCanonicalRow(row) : null;
  }

  // ─── problem_candidate ────────────────────────────────────────

  upsertCandidate(c: ProblemCandidate): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO problem_candidate
          (id, canonical_id, cluster_id, draft_alias, draft_symptoms, draft_symbols,
           draft_category, llm_raw, quality_score, dup_of, failed_draft, status, reviewed_at,
           created_at, source_count, issue_count, forum_count, experience_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.id,
        c.canonicalId,
        c.clusterId,
        JSON.stringify(c.draftAlias),
        JSON.stringify(c.draftSymptoms),
        JSON.stringify(c.draftSymbols),
        c.draftCategory,
        c.llmRaw,
        c.qualityScore,
        c.dupOf,
        c.failedDraft ? 1 : 0,
        c.status,
        c.reviewedAt,
        c.createdAt,
        c.sourceCount,
        c.issueCount,
        c.forumCount,
        c.experienceCount,
      );
  }

  upsertCandidateMany(items: ProblemCandidate[]): void {
    const tx = this.db.transaction((list: ProblemCandidate[]) => {
      for (const c of list) this.upsertCandidate(c);
    });
    tx(items);
  }

  listCandidates(status?: CandidateStatus): ProblemCandidate[] {
    const sql = status
      ? `SELECT * FROM problem_candidate WHERE status = ? ORDER BY created_at DESC`
      : `SELECT * FROM problem_candidate ORDER BY created_at DESC`;
    const rows = (status
      ? this.db.prepare(sql).all(status)
      : this.db.prepare(sql).all()) as CandidateRow[];
    return rows.map(fromCandidateRow);
  }

  listCandidatesByStatus(
    status: CandidateStatus,
    limit: number,
    offset = 0,
  ): ProblemCandidate[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM problem_candidate
         WHERE status = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(status, limit, offset) as CandidateRow[];
    return rows.map(fromCandidateRow);
  }

  countCandidates(status?: CandidateStatus): number {
    const row = status
      ? (this.db
          .prepare(
            `SELECT COUNT(*) AS n FROM problem_candidate WHERE status = ?`,
          )
          .get(status) as { n: number } | undefined)
      : (this.db
          .prepare(`SELECT COUNT(*) AS n FROM problem_candidate`)
          .get() as { n: number } | undefined);
    return row?.n ?? 0;
  }

  getCandidate(id: string): ProblemCandidate | null {
    const row = this.db
      .prepare(`SELECT * FROM problem_candidate WHERE id = ?`)
      .get(id) as CandidateRow | undefined;
    return row ? fromCandidateRow(row) : null;
  }

  setStatus(id: string, status: CandidateStatus): void {
    this.db
      .prepare(
        `UPDATE problem_candidate SET status = ?, reviewed_at = ? WHERE id = ?`,
      )
      .run(status, Date.now(), id);
  }

  setCanonicalStatus(
    id: string,
    status: CanonicalProblem["status"],
  ): void {
    this.db
      .prepare(
        `UPDATE canonical_problem SET status = ?, reviewed_at = ? WHERE id = ?`,
      )
      .run(status, Date.now(), id);
  }

  stats(): {
    canonical: Record<CanonicalProblem["status"], number>;
    candidates: Record<CandidateStatus, number>;
  } {
    const canonical = { candidate: 0, reviewed: 0, accepted: 0 } as Record<
      CanonicalProblem["status"],
      number
    >;
    const candidates = { pending: 0, approved: 0, rejected: 0 } as Record<
      CandidateStatus,
      number
    >;

    for (const r of this.db
      .prepare(`SELECT status, COUNT(*) AS n FROM canonical_problem GROUP BY status`)
      .all() as Array<{ status: CanonicalProblem["status"]; n: number }>) {
      canonical[r.status] = r.n;
    }
    for (const r of this.db
      .prepare(`SELECT status, COUNT(*) AS n FROM problem_candidate GROUP BY status`)
      .all() as Array<{ status: CandidateStatus; n: number }>) {
      candidates[r.status] = r.n;
    }

    return { canonical, candidates };
  }
}

// ─── Row types + mappers ────────────────────────────────────────

interface CanonicalRow {
  id: string;
  title: string;
  aliases: string;
  representative_issue_id: number | null;
  cluster_ids: string;
  experience_ids: string;
  confidence: number;
  status: CanonicalProblem["status"];
  created_at: number;
  reviewed_at: number | null;
}

interface CandidateRow {
  id: string;
  canonical_id: string;
  cluster_id: string;
  draft_alias: string;
  draft_symptoms: string;
  draft_symbols: string;
  draft_category: string | null;
  llm_raw: string | null;
  quality_score: number | null;
  dup_of: string | null;
  failed_draft: number;
  status: CandidateStatus;
  reviewed_at: number | null;
  created_at: number;
  source_count: number;
  issue_count: number;
  forum_count: number;
  experience_count: number;
}

function fromCanonicalRow(r: CanonicalRow): CanonicalProblem {
  return {
    id: r.id,
    title: r.title,
    aliases: JSON.parse(r.aliases) as string[],
    representativeIssueId: r.representative_issue_id,
    clusterIds: JSON.parse(r.cluster_ids) as string[],
    experienceIds: JSON.parse(r.experience_ids) as string[],
    confidence: r.confidence,
    status: r.status,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
  };
}

function fromCandidateRow(r: CandidateRow): ProblemCandidate {
  return {
    id: r.id,
    canonicalId: r.canonical_id,
    clusterId: r.cluster_id,
    draftAlias: JSON.parse(r.draft_alias) as string[],
    draftSymptoms: JSON.parse(r.draft_symptoms) as string[],
    draftSymbols: JSON.parse(r.draft_symbols) as string[],
    draftCategory: r.draft_category,
    llmRaw: r.llm_raw,
    qualityScore: r.quality_score,
    dupOf: r.dup_of,
    failedDraft: r.failed_draft !== 0,
    status: r.status,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at,
    sourceCount: r.source_count,
    issueCount: r.issue_count,
    forumCount: r.forum_count,
    experienceCount: r.experience_count,
  };
}
