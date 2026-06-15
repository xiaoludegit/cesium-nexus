import type { CallEdge } from "@cesium-nexus/shared";
import type BetterSqlite3 from "better-sqlite3";
import type { Database } from "./schema.js";

interface CallEdgeRow {
  source_id: string;
  target_id: string;
  source_name: string;
  target_name: string;
  edge_type: string;
  weight: number;
}

export class CallGraphRepo {
  private upsertStmt: BetterSqlite3.Statement;
  private downstreamStmt: BetterSqlite3.Statement;
  private upstreamStmt: BetterSqlite3.Statement;

  constructor(private db: Database) {
    this.upsertStmt = db.prepare(`
      INSERT OR REPLACE INTO call_edges
        (source_id, target_id, source_name, target_name, edge_type, weight)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.downstreamStmt = db.prepare(`
      SELECT * FROM call_edges WHERE source_id = ?
    `);
    this.upstreamStmt = db.prepare(`
      SELECT * FROM call_edges WHERE target_id = ?
    `);
  }

  insertEdges(edges: CallEdge[]): number {
    const tx = this.db.transaction((items: CallEdge[]) => {
      let count = 0;
      for (const e of items) {
        this.upsertStmt.run(
          e.sourceId,
          e.targetId,
          e.sourceName,
          e.targetName,
          e.edgeType,
          e.weight ?? 1,
        );
        count++;
      }
      return count;
    });
    return tx(edges);
  }

  getDownstream(symbolId: string, depth = 2): CallEdge[] {
    const result: CallEdge[] = [];
    const visited = new Set<string>();
    const queue: { id: string; currentDepth: number }[] = [
      { id: symbolId, currentDepth: 0 },
    ];
    visited.add(symbolId);

    while (queue.length > 0) {
      const { id, currentDepth } = queue.shift()!;
      if (currentDepth >= depth) continue;

      const rows = this.downstreamStmt.all(id) as CallEdgeRow[];
      for (const row of rows) {
        result.push(this.rowToEdge(row));
        if (!visited.has(row.target_id)) {
          visited.add(row.target_id);
          queue.push({ id: row.target_id, currentDepth: currentDepth + 1 });
        }
      }
    }

    return result;
  }

  getUpstream(symbolId: string, depth = 2): CallEdge[] {
    const result: CallEdge[] = [];
    const visited = new Set<string>();
    const queue: { id: string; currentDepth: number }[] = [
      { id: symbolId, currentDepth: 0 },
    ];
    visited.add(symbolId);

    while (queue.length > 0) {
      const { id, currentDepth } = queue.shift()!;
      if (currentDepth >= depth) continue;

      const rows = this.upstreamStmt.all(id) as CallEdgeRow[];
      for (const row of rows) {
        result.push(this.rowToEdge(row));
        if (!visited.has(row.source_id)) {
          visited.add(row.source_id);
          queue.push({ id: row.source_id, currentDepth: currentDepth + 1 });
        }
      }
    }

    return result;
  }

  clear(): void {
    this.db.exec(`DELETE FROM call_edges`);
  }

  totalCount(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) as count FROM call_edges`)
      .get() as { count: number };
    return row.count;
  }

  private rowToEdge(row: CallEdgeRow): CallEdge {
    return {
      sourceId: row.source_id,
      targetId: row.target_id,
      sourceName: row.source_name,
      targetName: row.target_name,
      edgeType: row.edge_type as "call" | "construct" | "static_call",
      weight: row.weight,
    };
  }
}
