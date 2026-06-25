/**
 * Version Snapshot Repository
 *
 * Manages symbol_snapshot and breaking_change tables.
 */

import type { Database } from "@cesium-nexus/storage";
import type { SymbolSnapshot, BreakingChange } from "./types.js";

/**
 * Initialize version intelligence schema.
 */
export function initVersionSchema(db: Database): void {
  db.exec(`
    -- Symbol snapshots for version tracking
    CREATE TABLE IF NOT EXISTS symbol_snapshot (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      symbol_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      doc_comment TEXT,
      source_hash TEXT NOT NULL,
      snapshot_at INTEGER NOT NULL,
      UNIQUE(version, symbol_id)
    );

    CREATE INDEX IF NOT EXISTS idx_snapshot_version ON symbol_snapshot(version);
    CREATE INDEX IF NOT EXISTS idx_snapshot_symbol ON symbol_snapshot(symbol_id);
    CREATE INDEX IF NOT EXISTS idx_snapshot_name ON symbol_snapshot(name);
    CREATE INDEX IF NOT EXISTS idx_snapshot_kind ON symbol_snapshot(kind);

    -- Breaking changes between versions
    CREATE TABLE IF NOT EXISTS breaking_change (
      id TEXT PRIMARY KEY,
      from_version TEXT NOT NULL,
      to_version TEXT NOT NULL,
      symbol_id TEXT NOT NULL,
      symbol_name TEXT NOT NULL,
      change_type TEXT NOT NULL,
      description TEXT NOT NULL,
      migration_guide TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_breaking_version ON breaking_change(from_version, to_version);
    CREATE INDEX IF NOT EXISTS idx_breaking_symbol ON breaking_change(symbol_id);
  `);
}

export class SnapshotRepo {
  constructor(private db: Database) {}

  // ─── Snapshot Operations ───

  upsertSnapshot(snapshot: SymbolSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO symbol_snapshot (id, version, symbol_id, name, kind, file_path, start_line, end_line, doc_comment, source_hash, snapshot_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         kind = excluded.kind,
         file_path = excluded.file_path,
         start_line = excluded.start_line,
         end_line = excluded.end_line,
         doc_comment = excluded.doc_comment,
         source_hash = excluded.source_hash,
         snapshot_at = excluded.snapshot_at`
      )
      .run(
        snapshot.id,
        snapshot.version,
        snapshot.symbolId,
        snapshot.name,
        snapshot.kind,
        snapshot.filePath,
        snapshot.startLine,
        snapshot.endLine,
        snapshot.docComment ?? null,
        snapshot.sourceHash,
        snapshot.snapshotAt
      );
  }

  upsertSnapshots(snapshots: SymbolSnapshot[]): number {
    const stmt = this.db.prepare(
      `INSERT INTO symbol_snapshot (id, version, symbol_id, name, kind, file_path, start_line, end_line, doc_comment, source_hash, snapshot_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         kind = excluded.kind,
         file_path = excluded.file_path,
         start_line = excluded.start_line,
         end_line = excluded.end_line,
         doc_comment = excluded.doc_comment,
         source_hash = excluded.source_hash,
         snapshot_at = excluded.snapshot_at`
    );

    const insert = this.db.transaction((items: SymbolSnapshot[]) => {
      let count = 0;
      for (const s of items) {
        stmt.run(
          s.id,
          s.version,
          s.symbolId,
          s.name,
          s.kind,
          s.filePath,
          s.startLine,
          s.endLine,
          s.docComment ?? null,
          s.sourceHash,
          s.snapshotAt
        );
        count++;
      }
      return count;
    });

    return insert(snapshots);
  }

  getSnapshot(version: string): SymbolSnapshot[] {
    return this.db
      .prepare(
        `SELECT * FROM symbol_snapshot WHERE version = ? ORDER BY name`
      )
      .all(version) as SymbolSnapshot[];
  }

  getSnapshotSymbol(version: string, symbolId: string): SymbolSnapshot | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM symbol_snapshot WHERE version = ? AND symbol_id = ?`
        )
        .get(version, symbolId) as SymbolSnapshot | undefined) ?? null
    );
  }

  snapshotExists(version: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM symbol_snapshot WHERE version = ? LIMIT 1`)
      .get(version);
    return row !== undefined;
  }

  listVersions(): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT version FROM symbol_snapshot ORDER BY version DESC`
      )
      .all() as { version: string }[];
    return rows.map((r) => r.version);
  }

  getSnapshotStats(version: string): {
    total: number;
    byKind: Record<string, number>;
  } {
    const total = (
      this.db
        .prepare(`SELECT COUNT(*) as count FROM symbol_snapshot WHERE version = ?`)
        .get(version) as { count: number }
    ).count;

    const byKindRows = this.db
      .prepare(
        `SELECT kind, COUNT(*) as count FROM symbol_snapshot WHERE version = ? GROUP BY kind`
      )
      .all(version) as { kind: string; count: number }[];

    const byKind: Record<string, number> = {};
    for (const row of byKindRows) {
      byKind[row.kind] = row.count;
    }

    return { total, byKind };
  }

  searchByName(version: string, namePattern: string): SymbolSnapshot[] {
    return this.db
      .prepare(
        `SELECT * FROM symbol_snapshot
         WHERE version = ? AND name LIKE ?
         ORDER BY name`
      )
      .all(version, `%${namePattern}%`) as SymbolSnapshot[];
  }

  // ─── Breaking Change Operations ───

  upsertBreakingChange(change: BreakingChange): void {
    this.db
      .prepare(
        `INSERT INTO breaking_change (id, from_version, to_version, symbol_id, symbol_name, change_type, description, migration_guide, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         change_type = excluded.change_type,
         description = excluded.description,
         migration_guide = excluded.migration_guide`
      )
      .run(
        change.id,
        change.fromVersion,
        change.toVersion,
        change.symbolId,
        change.symbolName,
        change.changeType,
        change.description,
        change.migrationGuide ?? null,
        change.createdAt
      );
  }

  getBreakingChanges(fromVersion: string, toVersion: string): BreakingChange[] {
    return this.db
      .prepare(
        `SELECT * FROM breaking_change
         WHERE from_version = ? AND to_version = ?
         ORDER BY symbol_name`
      )
      .all(fromVersion, toVersion) as BreakingChange[];
  }

  getBreakingChangesForSymbol(
    symbolId: string,
    fromVersion?: string,
    toVersion?: string
  ): BreakingChange[] {
    if (fromVersion && toVersion) {
      return this.db
        .prepare(
          `SELECT * FROM breaking_change
           WHERE symbol_id = ? AND from_version = ? AND to_version = ?`
        )
        .all(symbolId, fromVersion, toVersion) as BreakingChange[];
    }
    return this.db
      .prepare(`SELECT * FROM breaking_change WHERE symbol_id = ? ORDER BY created_at DESC`)
      .all(symbolId) as BreakingChange[];
  }
}
