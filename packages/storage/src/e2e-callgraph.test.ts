import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, initSchema, CallGraphRepo, SymbolRepo } from "@cesium-nexus/storage";
import type { Database } from "@cesium-nexus/storage";
import type { CallEdge, SymbolRecord } from "@cesium-nexus/shared";

describe("M4 E2E: Call Graph with cycle handling", () => {
  let db: Database;
  let callGraphRepo: CallGraphRepo;
  let symbolRepo: SymbolRepo;

  beforeEach(() => {
    db = openDatabase(":memory:");
    initSchema(db);
    callGraphRepo = new CallGraphRepo(db);
    symbolRepo = new SymbolRepo(db);

    // Insert symbols
    const symbols: SymbolRecord[] = [
      { id: "sym-a", name: "A", kind: "class", filePath: "A.js", startLine: 1, endLine: 10, exports: ["A"], imports: [] },
      { id: "sym-b", name: "B", kind: "class", filePath: "B.js", startLine: 1, endLine: 10, exports: ["B"], imports: [] },
      { id: "sym-c", name: "C", kind: "class", filePath: "C.js", startLine: 1, endLine: 10, exports: ["C"], imports: [] },
      { id: "sym-a-run", name: "run", kind: "method", filePath: "A.js", startLine: 2, endLine: 5, exports: [], imports: [], parentClass: "A" },
      { id: "sym-b-exec", name: "exec", kind: "method", filePath: "B.js", startLine: 2, endLine: 5, exports: [], imports: [], parentClass: "B" },
      { id: "sym-c-calc", name: "calc", kind: "method", filePath: "C.js", startLine: 2, endLine: 5, exports: [], imports: [], parentClass: "C" },
    ];
    symbolRepo.insertMany(symbols);

    // Build cycle: A.run → B.exec → C.calc → A.run
    const edges: CallEdge[] = [
      { sourceId: "sym-a-run", targetId: "sym-b-exec", sourceName: "A.run", targetName: "B.exec", edgeType: "call" },
      { sourceId: "sym-b-exec", targetId: "sym-c-calc", sourceName: "B.exec", targetName: "C.calc", edgeType: "call" },
      { sourceId: "sym-c-calc", targetId: "sym-a-run", sourceName: "C.calc", targetName: "A.run", edgeType: "call" },
    ];
    callGraphRepo.insertEdges(edges);
  });

  afterEach(() => {
    db.close();
  });

  it("downstream from A.run should traverse full cycle without infinite loop", () => {
    const edges = callGraphRepo.getDownstream("sym-a-run", 5);
    // A.run → B.exec (depth 0), B.exec → C.calc (depth 1), C.calc → A.run (depth 2, but A.run is visited)
    expect(edges).toHaveLength(3);
    const targets = edges.map((e) => e.targetName);
    expect(targets).toContain("B.exec");
    expect(targets).toContain("C.calc");
    expect(targets).toContain("A.run"); // the cycle-back edge
  });

  it("upstream from A.run should trace back through cycle", () => {
    const edges = callGraphRepo.getUpstream("sym-a-run", 5);
    // Upstream: C.calc → A.run (depth 0), B.exec → C.calc (depth 1), A.run → B.exec (depth 2, A.run visited)
    expect(edges).toHaveLength(3);
    const sources = edges.map((e) => e.sourceName);
    expect(sources).toContain("C.calc");
    expect(sources).toContain("B.exec");
    expect(sources).toContain("A.run");
  });

  it("downstream at depth 1 should only show direct children", () => {
    const edges = callGraphRepo.getDownstream("sym-a-run", 1);
    expect(edges).toHaveLength(1);
    expect(edges[0].targetName).toBe("B.exec");
  });

  it("downstream at depth 3 should capture full chain", () => {
    const edges = callGraphRepo.getDownstream("sym-a-run", 3);
    expect(edges).toHaveLength(3);
  });

  it("should support construct and static_call edge types", () => {
    const extraEdges: CallEdge[] = [
      { sourceId: "sym-a-run", targetId: "sym-b", sourceName: "A.run", targetName: "B", edgeType: "construct" },
      { sourceId: "sym-a-run", targetId: "sym-c-calc", sourceName: "A.run", targetName: "C.calc", edgeType: "static_call" },
    ];
    callGraphRepo.insertEdges(extraEdges);

    const edges = callGraphRepo.getDownstream("sym-a-run", 1);
    expect(edges.length).toBeGreaterThanOrEqual(3); // B.exec + B (construct) + C.calc (static)
    const edgeTypes = edges.map((e) => e.edgeType);
    expect(edgeTypes).toContain("call");
    expect(edgeTypes).toContain("construct");
    expect(edgeTypes).toContain("static_call");
  });
});
