import type {
  ExperienceEdge,
  ExperienceEdgeType,
  ExperienceEdgeStats,
} from "@cesium-nexus/shared";
import type BetterSqlite3 from "better-sqlite3";
import type { Database } from "./schema.js";

interface EdgeRow {
  id: string;
  source_node_id: string;
  target_node_id: string;
  edge_type: string;
  confidence: number;
  created_at: string;
  metadata: string | null;
}

export class ExperienceEdgeRepo {
  private upsertStmt: BetterSqlite3.Statement;
  private downstreamStmt: BetterSqlite3.Statement;
  private upstreamStmt: BetterSqlite3.Statement;
  private totalCountStmt: BetterSqlite3.Statement;

  constructor(private db: Database) {
    this.upsertStmt = db.prepare(`
      INSERT OR REPLACE INTO experience_edge
        (id, source_node_id, target_node_id, edge_type, confidence, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.downstreamStmt = db.prepare(`
      SELECT * FROM experience_edge WHERE source_node_id = ?
    `);
    this.upstreamStmt = db.prepare(`
      SELECT * FROM experience_edge WHERE target_node_id = ?
    `);
    this.totalCountStmt = db.prepare(
      `SELECT COUNT(*) as count FROM experience_edge`,
    );
  }

  upsertMany(edges: ExperienceEdge[]): number {
    const tx = this.db.transaction((items: ExperienceEdge[]) => {
      let count = 0;
      for (const e of items) {
        this.upsertStmt.run(
          e.id,
          e.sourceNodeId,
          e.targetNodeId,
          e.edgeType,
          e.confidence,
          e.createdAt,
          e.metadata ? JSON.stringify(e.metadata) : null,
        );
        count++;
      }
      return count;
    });
    return tx(edges);
  }

  getDownstream(nodeId: string, maxDepth = 3): ExperienceEdge[] {
    const result: ExperienceEdge[] = [];
    const visited = new Set<string>();
    const queue: { id: string; depth: number }[] = [
      { id: nodeId, depth: 0 },
    ];
    visited.add(nodeId);

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;

      const rows = this.downstreamStmt.all(id) as EdgeRow[];
      for (const row of rows) {
        result.push(this.rowToEdge(row));
        if (!visited.has(row.target_node_id)) {
          visited.add(row.target_node_id);
          queue.push({ id: row.target_node_id, depth: depth + 1 });
        }
      }
    }

    return result;
  }

  getUpstream(nodeId: string, maxDepth = 3): ExperienceEdge[] {
    const result: ExperienceEdge[] = [];
    const visited = new Set<string>();
    const queue: { id: string; depth: number }[] = [
      { id: nodeId, depth: 0 },
    ];
    visited.add(nodeId);

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;

      const rows = this.upstreamStmt.all(id) as EdgeRow[];
      for (const row of rows) {
        result.push(this.rowToEdge(row));
        if (!visited.has(row.source_node_id)) {
          visited.add(row.source_node_id);
          queue.push({ id: row.source_node_id, depth: depth + 1 });
        }
      }
    }

    return result;
  }

  getConnected(nodeId: string, maxDepth = 3): ExperienceEdge[] {
    const downstream = this.getDownstream(nodeId, maxDepth);
    const upstream = this.getUpstream(nodeId, maxDepth);

    const seen = new Set<string>();
    const merged: ExperienceEdge[] = [];
    for (const e of [...downstream, ...upstream]) {
      if (!seen.has(e.id)) {
        seen.add(e.id);
        merged.push(e);
      }
    }
    return merged;
  }

  totalCount(): number {
    const row = this.totalCountStmt.get() as { count: number };
    return row.count;
  }

  countByType(): Record<ExperienceEdgeType, number> {
    const stmt = this.db.prepare(
      `SELECT edge_type, COUNT(*) as count FROM experience_edge GROUP BY edge_type`,
    );
    const rows = stmt.all() as { edge_type: string; count: number }[];
    const result: Record<ExperienceEdgeType, number> = { fixes: 0 };
    for (const row of rows) {
      if (row.edge_type in result) {
        result[row.edge_type as ExperienceEdgeType] = row.count;
      }
    }
    return result;
  }

  getStats(totalNodes: number): ExperienceEdgeStats {
    const totalEdges = this.totalCount();
    const byType = this.countByType();

    const connectedStmt = this.db.prepare(`
      SELECT COUNT(DISTINCT node_id) as count FROM (
        SELECT source_node_id AS node_id FROM experience_edge
        UNION
        SELECT target_node_id AS node_id FROM experience_edge
      )
    `);
    const connectedNodes = (connectedStmt.get() as { count: number }).count;

    return {
      totalEdges,
      byType,
      connectedNodes,
      orphanNodes: totalNodes - connectedNodes,
      totalNodes,
    };
  }

  clear(): void {
    this.db.exec(`DELETE FROM experience_edge`);
  }

  private rowToEdge(row: EdgeRow): ExperienceEdge {
    return {
      id: row.id,
      sourceNodeId: row.source_node_id,
      targetNodeId: row.target_node_id,
      edgeType: row.edge_type as ExperienceEdgeType,
      confidence: row.confidence,
      createdAt: row.created_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}
