import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openDatabase,
  initSchema,
  SymbolRepo,
  IssueRepo,
  CallGraphRepo,
} from "@cesium-nexus/storage";
import type { Database } from "@cesium-nexus/storage";
import type { SymbolRecord, CallEdge, IssueRecord } from "@cesium-nexus/shared";
import {
  handleSearchSymbol,
  handleGetSource,
  handleSearchIssue,
  handleTraceCallgraph,
  handleBuildContextPack,
} from "./handlers.js";

describe("MCP Handlers", () => {
  let db: Database;
  let symbolRepo: SymbolRepo;
  let issueRepo: IssueRepo;
  let callGraphRepo: CallGraphRepo;

  // ── Fixture helpers ─────────────────────────────────────

  function makeSymbol(overrides: Partial<SymbolRecord> = {}): SymbolRecord {
    return {
      id: Math.random().toString(36).slice(2, 14),
      name: "TestSymbol",
      kind: "class",
      filePath: "src/test.js",
      startLine: 1,
      endLine: 10,
      docComment: "A test symbol",
      exports: [],
      imports: [],
      parentClass: undefined,
      ...overrides,
    };
  }

  function makeEdge(overrides: Partial<CallEdge> = {}): CallEdge {
    return {
      sourceId: "src-1",
      targetId: "tgt-1",
      sourceName: "Source",
      targetName: "Target",
      edgeType: "call",
      weight: 1,
      ...overrides,
    };
  }

  // ── Setup / Teardown ────────────────────────────────────

  beforeEach(() => {
    db = openDatabase(":memory:");
    initSchema(db);
    symbolRepo = new SymbolRepo(db);
    issueRepo = new IssueRepo(db);
    callGraphRepo = new CallGraphRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── handleSearchSymbol ──────────────────────────────────

  describe("handleSearchSymbol", () => {
    it("returns matching symbols", async () => {
      const sym = makeSymbol({
        id: "sym-1",
        name: "Viewer",
        kind: "class",
        docComment: "The main 3D viewer widget",
      });
      symbolRepo.insertMany([sym]);

      const result = await handleSearchSymbol(symbolRepo, {
        query: "Viewer",
        limit: 10,
      });

      expect(result.success).toBe(true);
      const data = result.data as { results: unknown[]; count: number };
      expect(data.count).toBeGreaterThanOrEqual(1);
      expect(data.results.length).toBeGreaterThanOrEqual(1);
    });

    it("returns empty results for no match", async () => {
      const sym = makeSymbol({ id: "sym-1", name: "Viewer" });
      symbolRepo.insertMany([sym]);

      const result = await handleSearchSymbol(symbolRepo, {
        query: "NonExistentSymbolXYZ",
        limit: 10,
      });

      expect(result.success).toBe(true);
      const data = result.data as { results: unknown[]; count: number };
      expect(data.count).toBe(0);
    });

    it("respects limit parameter", async () => {
      const symbols = Array.from({ length: 5 }, (_, i) =>
        makeSymbol({ id: `sym-${i}`, name: `Widget${i}`, kind: "class" }),
      );
      symbolRepo.insertMany(symbols);

      const result = await handleSearchSymbol(symbolRepo, {
        query: "Widget",
        limit: 2,
      });

      expect(result.success).toBe(true);
      const data = result.data as { results: unknown[] };
      expect(data.results.length).toBeLessThanOrEqual(2);
    });
  });

  // ── handleGetSource ─────────────────────────────────────

  describe("handleGetSource", () => {
    it("returns source code for existing symbol", async () => {
      const sym = makeSymbol({
        id: "src-sym-1",
        name: "Camera",
        kind: "class",
      });
      symbolRepo.insertMany([sym]);
      symbolRepo.insertSourceFts([
        {
          symbolId: "src-sym-1",
          name: "Camera",
          filePath: "src/Camera.js",
          startLine: 1,
          endLine: 50,
          code: "function Camera() { this.position = {}; }",
        },
      ]);

      const result = await handleGetSource(symbolRepo, {
        symbol_id: "src-sym-1",
      });

      expect(result.success).toBe(true);
      const data = result.data as { code: string; name: string };
      expect(data.code).toContain("Camera");
      expect(data.name).toBe("Camera");
    });

    it("returns error for non-existent symbol", async () => {
      const result = await handleGetSource(symbolRepo, {
        symbol_id: "does-not-exist",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Symbol not found");
    });

    it("returns error when source_code is missing for existing symbol", async () => {
      const sym = makeSymbol({
        id: "no-source-sym",
        name: "NoSource",
        kind: "class",
      });
      symbolRepo.insertMany([sym]);

      const result = await handleGetSource(symbolRepo, {
        symbol_id: "no-source-sym",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Source code not available");
    });
  });

  // ── handleSearchIssue ───────────────────────────────────

  describe("handleSearchIssue", () => {
    const issues: IssueRecord[] = [
      {
        id: 100,
        repo: "CesiumGS/cesium",
        number: 100,
        title: "Fix camera flyTo animation",
        body: "Camera flyTo does not work correctly with terrain",
        state: "open",
        labels: ["bug"],
        assignees: [],
        author: "user1",
        comments: 3,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-10T00:00:00Z",
        closedAt: null,
        htmlUrl: "https://github.com/CesiumGS/cesium/issues/100",
      },
      {
        id: 200,
        repo: "CesiumGS/cesium",
        number: 200,
        title: "Add terrain provider support",
        body: "Need to support custom terrain providers",
        state: "closed",
        labels: ["feature"],
        assignees: [],
        author: "user2",
        comments: 5,
        createdAt: "2024-02-01T00:00:00Z",
        updatedAt: "2024-02-15T00:00:00Z",
        closedAt: "2024-02-15T00:00:00Z",
        htmlUrl: "https://github.com/CesiumGS/cesium/issues/200",
      },
    ];

    it("returns matching issues", async () => {
      issueRepo.upsertMany(issues);

      const result = await handleSearchIssue(issueRepo, {
        query: "camera",
        limit: 10,
      });

      expect(result.success).toBe(true);
      const data = result.data as { results: unknown[]; count: number };
      expect(data.count).toBeGreaterThanOrEqual(1);
    });

    it("filters by state", async () => {
      issueRepo.upsertMany(issues);

      const result = await handleSearchIssue(issueRepo, {
        query: "terrain",
        limit: 10,
        state: "closed",
      });

      expect(result.success).toBe(true);
      const data = result.data as {
        results: { state: string; title: string }[];
      };
      for (const r of data.results) {
        expect(r.state).toBe("closed");
      }
    });

    it("returns empty results for no match", async () => {
      issueRepo.upsertMany(issues);

      const result = await handleSearchIssue(issueRepo, {
        query: "nonexistenttopicxyz",
        limit: 10,
      });

      expect(result.success).toBe(true);
      const data = result.data as { count: number };
      expect(data.count).toBe(0);
    });
  });

  // ── handleTraceCallgraph ────────────────────────────────

  describe("handleTraceCallgraph", () => {
    it("returns downstream edges", async () => {
      const sym = makeSymbol({
        id: "cls-a",
        name: "ClassA",
        kind: "class",
      });
      symbolRepo.insertMany([sym]);

      callGraphRepo.insertEdges([
        makeEdge({
          sourceId: "cls-a",
          targetId: "cls-b",
          sourceName: "ClassA",
          targetName: "ClassB",
          edgeType: "call",
        }),
        makeEdge({
          sourceId: "cls-b",
          targetId: "cls-c",
          sourceName: "ClassB",
          targetName: "ClassC",
          edgeType: "construct",
        }),
      ]);

      const result = await handleTraceCallgraph(
        symbolRepo,
        callGraphRepo,
        { symbol: "ClassA", direction: "down", depth: 2 },
      );

      expect(result.success).toBe(true);
      const data = result.data as {
        edges: unknown[];
        count: number;
        symbol: string;
      };
      expect(data.symbol).toBe("ClassA");
      expect(data.count).toBe(2);
    });

    it("returns upstream edges", async () => {
      const sym = makeSymbol({
        id: "cls-c",
        name: "ClassC",
        kind: "class",
      });
      symbolRepo.insertMany([sym]);

      callGraphRepo.insertEdges([
        makeEdge({
          sourceId: "cls-a",
          targetId: "cls-c",
          sourceName: "ClassA",
          targetName: "ClassC",
          edgeType: "call",
        }),
      ]);

      const result = await handleTraceCallgraph(
        symbolRepo,
        callGraphRepo,
        { symbol: "ClassC", direction: "up", depth: 2 },
      );

      expect(result.success).toBe(true);
      const data = result.data as { edges: unknown[]; count: number };
      expect(data.count).toBe(1);
    });

    it("returns error for non-existent symbol", async () => {
      const result = await handleTraceCallgraph(
        symbolRepo,
        callGraphRepo,
        { symbol: "DoesNotExist", direction: "down", depth: 2 },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Symbol not found");
    });

    it("returns empty edges when no call relations exist", async () => {
      const sym = makeSymbol({
        id: "lonely",
        name: "LonelyClass",
        kind: "class",
      });
      symbolRepo.insertMany([sym]);

      const result = await handleTraceCallgraph(
        symbolRepo,
        callGraphRepo,
        { symbol: "LonelyClass", direction: "down", depth: 2 },
      );

      expect(result.success).toBe(true);
      const data = result.data as { edges: unknown[]; count: number };
      expect(data.count).toBe(0);
    });
  });

  // ── handleBuildContextPack ──────────────────────────────

  describe("handleBuildContextPack", () => {
    it("returns a full ContextPack for a known symbol", async () => {
      const viewer = makeSymbol({
        id: "cp-viewer",
        name: "Viewer",
        kind: "class",
        filePath: "src/Viewer.js",
        startLine: 1,
        endLine: 100,
        docComment: "The main 3D viewer widget",
      });
      symbolRepo.insertMany([viewer]);
      symbolRepo.insertSourceFts([
        {
          symbolId: "cp-viewer",
          name: "Viewer",
          filePath: "src/Viewer.js",
          startLine: 1,
          endLine: 100,
          code: "function Viewer(container) { this.scene = new Scene(); }",
        },
      ]);

      const result = await handleBuildContextPack(
        symbolRepo,
        callGraphRepo,
        issueRepo,
        { symbol: "Viewer" },
      );

      expect(result.success).toBe(true);
      const pack = result.data as {
        symbol: { name: string };
        source: unknown[];
        callgraph: unknown[];
        issues: unknown[];
        metadata: { symbolResolved: string; truncated: boolean };
      };
      expect(pack.symbol.name).toBe("Viewer");
      expect(pack.source.length).toBeGreaterThanOrEqual(1);
      expect(pack.metadata).toBeDefined();
      expect(pack.metadata.symbolResolved).toBe("Viewer");
    });

    it("returns error for non-existent symbol", async () => {
      const result = await handleBuildContextPack(
        symbolRepo,
        callGraphRepo,
        issueRepo,
        { symbol: "NonExistentXYZ" },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Symbol not found");
    });

    it("returns pack with empty arrays when data is missing", async () => {
      const sym = makeSymbol({
        id: "cp-empty",
        name: "EmptyClass",
        kind: "class",
      });
      symbolRepo.insertMany([sym]);

      const result = await handleBuildContextPack(
        symbolRepo,
        callGraphRepo,
        issueRepo,
        { symbol: "EmptyClass" },
      );

      expect(result.success).toBe(true);
      const pack = result.data as {
        source: unknown[];
        callgraph: unknown[];
        issues: unknown[];
      };
      expect(pack.source).toEqual([]);
      expect(pack.callgraph).toEqual([]);
      expect(pack.issues).toEqual([]);
    });
  });
});
