import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, initSchema, CallGraphRepo } from "./index.js";
import type { Database } from "./schema.js";
import type { CallEdge } from "@cesium-nexus/shared";

describe("CallGraphRepo", () => {
  let db: Database;
  let repo: CallGraphRepo;

  beforeEach(() => {
    db = openDatabase(":memory:");
    initSchema(db);
    repo = new CallGraphRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  function makeEdge(overrides: Partial<CallEdge> = {}): CallEdge {
    return {
      sourceId: "src-001",
      targetId: "tgt-001",
      sourceName: "Scene.update",
      targetName: "FrameState.update",
      edgeType: "call",
      weight: 1,
      ...overrides,
    };
  }

  describe("insertEdges", () => {
    it("should insert edges in batch", () => {
      const edges: CallEdge[] = [
        makeEdge({ sourceId: "a", targetId: "b" }),
        makeEdge({ sourceId: "b", targetId: "c" }),
        makeEdge({ sourceId: "c", targetId: "d" }),
      ];
      const count = repo.insertEdges(edges);
      expect(count).toBe(3);
      expect(repo.totalCount()).toBe(3);
    });

    it("should upsert on duplicate (same source_id, target_id, edge_type)", () => {
      const edge1 = makeEdge({ sourceId: "a", targetId: "b", weight: 1 });
      const edge2 = makeEdge({ sourceId: "a", targetId: "b", weight: 2 });
      repo.insertEdges([edge1]);
      repo.insertEdges([edge2]);
      expect(repo.totalCount()).toBe(1);

      // Verify the weight was updated
      const downstream = repo.getDownstream("a", 1);
      expect(downstream).toHaveLength(1);
      expect(downstream[0].weight).toBe(2);
    });

    it("should allow same source/target with different edge_type", () => {
      const edges: CallEdge[] = [
        makeEdge({ sourceId: "a", targetId: "b", edgeType: "call" }),
        makeEdge({ sourceId: "a", targetId: "b", edgeType: "static_call" }),
      ];
      repo.insertEdges(edges);
      expect(repo.totalCount()).toBe(2);
    });
  });

  describe("getDownstream", () => {
    it("should return direct children at depth 1", () => {
      repo.insertEdges([
        makeEdge({ sourceId: "a", targetId: "b", sourceName: "A.run", targetName: "B.exec" }),
        makeEdge({ sourceId: "a", targetId: "c", sourceName: "A.run", targetName: "C.init" }),
        makeEdge({ sourceId: "b", targetId: "d", sourceName: "B.exec", targetName: "D.calc" }),
      ]);

      const result = repo.getDownstream("a", 1);
      expect(result).toHaveLength(2);
      const targets = result.map((e) => e.targetId).sort();
      expect(targets).toEqual(["b", "c"]);
    });

    it("should return children up to depth 2 by default", () => {
      repo.insertEdges([
        makeEdge({ sourceId: "a", targetId: "b" }),
        makeEdge({ sourceId: "b", targetId: "c" }),
        makeEdge({ sourceId: "c", targetId: "d" }),
      ]);

      const result = repo.getDownstream("a");
      // depth=2 default: a→b (depth 0→1), b→c (depth 1→2), c→d skipped (depth 2 >= 2)
      expect(result).toHaveLength(2);
      const targets = result.map((e) => e.targetId);
      expect(targets).toContain("b");
      expect(targets).toContain("c");
    });

    it("should handle cycle without infinite loop", () => {
      // A → B → C → A (cycle)
      repo.insertEdges([
        makeEdge({ sourceId: "a", targetId: "b" }),
        makeEdge({ sourceId: "b", targetId: "c" }),
        makeEdge({ sourceId: "c", targetId: "a" }),
      ]);

      // Should not throw or hang
      const result = repo.getDownstream("a", 5);
      expect(result.length).toBeGreaterThanOrEqual(2);
      // visited set prevents re-visiting 'a', so we get a→b, b→c, c→a = 3 edges
      expect(result).toHaveLength(3);
    });

    it("should return empty for node with no downstream", () => {
      repo.insertEdges([
        makeEdge({ sourceId: "a", targetId: "b" }),
      ]);

      const result = repo.getDownstream("b", 2);
      expect(result).toHaveLength(0);
    });
  });

  describe("getUpstream", () => {
    it("should return direct parents at depth 1", () => {
      repo.insertEdges([
        makeEdge({ sourceId: "a", targetId: "c" }),
        makeEdge({ sourceId: "b", targetId: "c" }),
        makeEdge({ sourceId: "c", targetId: "d" }),
      ]);

      const result = repo.getUpstream("c", 1);
      expect(result).toHaveLength(2);
      const sources = result.map((e) => e.sourceId).sort();
      expect(sources).toEqual(["a", "b"]);
    });

    it("should traverse upstream with depth 2", () => {
      repo.insertEdges([
        makeEdge({ sourceId: "a", targetId: "b" }),
        makeEdge({ sourceId: "b", targetId: "c" }),
        makeEdge({ sourceId: "c", targetId: "d" }),
      ]);

      // Upstream from d: c→d (depth 1), b→c (depth 2)
      const result = repo.getUpstream("d", 2);
      expect(result).toHaveLength(2);
    });

    it("should handle cycle in upstream without infinite loop", () => {
      repo.insertEdges([
        makeEdge({ sourceId: "a", targetId: "b" }),
        makeEdge({ sourceId: "b", targetId: "c" }),
        makeEdge({ sourceId: "c", targetId: "a" }),
      ]);

      const result = repo.getUpstream("a", 10);
      // Upstream from a: c→a (depth 1), b→c (depth 2), a→b but a is visited
      expect(result).toHaveLength(3);
    });
  });

  describe("clear", () => {
    it("should remove all edges", () => {
      repo.insertEdges([
        makeEdge({ sourceId: "a", targetId: "b" }),
        makeEdge({ sourceId: "b", targetId: "c" }),
      ]);
      expect(repo.totalCount()).toBe(2);

      repo.clear();
      expect(repo.totalCount()).toBe(0);
    });
  });
});
