import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openDatabase,
  initSchema,
  SymbolRepo,
  IssueRepo,
  CallGraphRepo,
} from "@cesium-nexus/storage";
import type { Database } from "@cesium-nexus/storage";
import type {
  SymbolRecord,
  CallEdge,
  IssueRecord,
  ContextPack,
} from "@cesium-nexus/shared";
import { buildContextPack } from "./builder.js";
import type { BuildOptions, BuildError } from "./builder.js";

describe("buildContextPack", () => {
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

  function makeIssue(overrides: Partial<IssueRecord> = {}): IssueRecord {
    return {
      id: 1,
      repo: "CesiumGS/cesium",
      number: 1,
      title: "Test issue",
      body: "Short body",
      state: "open",
      labels: [],
      assignees: [],
      author: "user1",
      comments: 0,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      closedAt: null,
      htmlUrl: "https://github.com/CesiumGS/cesium/issues/1",
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

  // ── Complete 4-section output ───────────────────────────

  it("returns a full ContextPack with all 4 sections", () => {
    const viewer = makeSymbol({
      id: "cls-viewer",
      name: "Viewer",
      kind: "class",
      filePath: "src/Viewer.js",
      startLine: 1,
      endLine: 100,
      docComment: "The main 3D viewer widget",
    });
    const destroy = makeSymbol({
      id: "fn-destroy",
      name: "destroy",
      kind: "function",
      filePath: "src/destroy.js",
      startLine: 1,
      endLine: 20,
    });
    symbolRepo.insertMany([viewer, destroy]);

    // Source code for both
    symbolRepo.insertSourceFts([
      {
        symbolId: "cls-viewer",
        name: "Viewer",
        filePath: "src/Viewer.js",
        startLine: 1,
        endLine: 100,
        code: "function Viewer(container) { this.container = container; }",
      },
      {
        symbolId: "fn-destroy",
        name: "destroy",
        filePath: "src/destroy.js",
        startLine: 1,
        endLine: 20,
        code: "function destroy() { this.container = null; }",
      },
    ]);

    // Call graph: Viewer → destroy
    callGraphRepo.insertEdges([
      makeEdge({
        sourceId: "cls-viewer",
        targetId: "fn-destroy",
        sourceName: "Viewer",
        targetName: "destroy",
        edgeType: "call",
      }),
    ]);

    // Issue mentioning Viewer
    issueRepo.upsertMany([
      makeIssue({
        id: 101,
        number: 101,
        title: "Viewer crashes on resize",
        body: "When resizing the Viewer widget, it sometimes crashes.",
      }),
    ]);

    const result = buildContextPack(symbolRepo, callGraphRepo, issueRepo, {
      symbol: "Viewer",
    });

    expect("error" in result).toBe(false);
    const pack = result as ContextPack;

    // Symbol section
    expect(pack.symbol.name).toBe("Viewer");
    expect(pack.symbol.kind).toBe("class");

    // Source section: main + downstream
    expect(pack.source.length).toBe(2);
    expect(pack.source[0].symbol).toBe("Viewer");
    expect(pack.source[1].symbol).toBe("destroy");

    // Callgraph section
    expect(pack.callgraph.length).toBe(1);
    expect(pack.callgraph[0].source).toBe("Viewer");
    expect(pack.callgraph[0].target).toBe("destroy");

    // Issues section
    expect(pack.issues.length).toBeGreaterThanOrEqual(1);
    expect(pack.issues[0].title).toContain("Viewer");

    // Metadata
    expect(pack.metadata).toBeDefined();
    expect(pack.metadata!.symbolResolved).toBe("Viewer");
    expect(typeof pack.metadata!.totalTokens).toBe("number");
    expect(typeof pack.metadata!.truncated).toBe("boolean");
  });

  // ── Symbol not found → error ────────────────────────────

  it("returns error when symbol does not exist", () => {
    const result = buildContextPack(symbolRepo, callGraphRepo, issueRepo, {
      symbol: "NonExistentSymbol",
    });

    expect("error" in result).toBe(true);
    const err = result as BuildError;
    expect(err.error).toContain("Symbol not found");
  });

  // ── Source missing → empty array ────────────────────────

  it("returns empty source array when no source code available", () => {
    const sym = makeSymbol({
      id: "no-source",
      name: "NoSource",
      kind: "class",
    });
    symbolRepo.insertMany([sym]);

    const result = buildContextPack(symbolRepo, callGraphRepo, issueRepo, {
      symbol: "NoSource",
    });

    expect("error" in result).toBe(false);
    const pack = result as ContextPack;
    expect(pack.source).toEqual([]);
    expect(pack.symbol.name).toBe("NoSource");
  });

  // ── Callgraph empty → empty array ──────────────────────

  it("returns empty callgraph when no edges exist", () => {
    const sym = makeSymbol({
      id: "lonely",
      name: "LonelyClass",
      kind: "class",
    });
    symbolRepo.insertMany([sym]);

    const result = buildContextPack(symbolRepo, callGraphRepo, issueRepo, {
      symbol: "LonelyClass",
    });

    expect("error" in result).toBe(false);
    const pack = result as ContextPack;
    expect(pack.callgraph).toEqual([]);
  });

  // ── Issues empty → empty array ─────────────────────────

  it("returns empty issues array when no matching issues exist", () => {
    const sym = makeSymbol({
      id: "obscure",
      name: "ObscureHelper",
      kind: "function",
    });
    symbolRepo.insertMany([sym]);

    const result = buildContextPack(symbolRepo, callGraphRepo, issueRepo, {
      symbol: "ObscureHelper",
    });

    expect("error" in result).toBe(false);
    const pack = result as ContextPack;
    expect(pack.issues).toEqual([]);
  });

  // ── Class-level symbol (no parentClass) ─────────────────

  it("searches issues by symbol name for class-level symbols", () => {
    const camera = makeSymbol({
      id: "cls-camera",
      name: "Camera",
      kind: "class",
      parentClass: undefined,
    });
    symbolRepo.insertMany([camera]);

    issueRepo.upsertMany([
      makeIssue({
        id: 201,
        number: 201,
        title: "Camera flyTo broken on mobile",
        body: "The Camera flyTo animation stutters on mobile devices.",
      }),
    ]);

    const result = buildContextPack(symbolRepo, callGraphRepo, issueRepo, {
      symbol: "Camera",
    });

    expect("error" in result).toBe(false);
    const pack = result as ContextPack;
    expect(pack.metadata!.symbolResolved).toBe("Camera");
    expect(pack.issues.length).toBeGreaterThanOrEqual(1);
    expect(pack.issues[0].title).toContain("Camera");
  });

  // ── Method-level symbol (with parentClass) ──────────────

  it("searches issues by parentClass for method-level symbols", () => {
    const parent = makeSymbol({
      id: "cls-primitive",
      name: "Primitive",
      kind: "class",
    });
    const method = makeSymbol({
      id: "meth-update",
      name: "update",
      kind: "method",
      parentClass: "Primitive",
    });
    symbolRepo.insertMany([parent, method]);

    issueRepo.upsertMany([
      makeIssue({
        id: 301,
        number: 301,
        title: "Primitive rendering artifacts",
        body: "Visual artifacts appear when Primitive updates its geometry.",
      }),
    ]);

    const result = buildContextPack(symbolRepo, callGraphRepo, issueRepo, {
      symbol: "Primitive.update",
    });

    expect("error" in result).toBe(false);
    const pack = result as ContextPack;
    expect(pack.metadata!.symbolResolved).toBe("Primitive.update");
    // Should find issue about "Primitive"
    expect(pack.issues.length).toBeGreaterThanOrEqual(1);
  });

  // ── Dotted name not found → error ───────────────────────

  it("returns error for dotted name with no match", () => {
    const result = buildContextPack(symbolRepo, callGraphRepo, issueRepo, {
      symbol: "Foo.bar",
    });

    expect("error" in result).toBe(true);
    const err = result as BuildError;
    expect(err.error).toContain("Symbol not found");
  });

  // ── Downstream source inclusion limit ───────────────────

  it("limits downstream sources to maxDownstreamSources", () => {
    const main = makeSymbol({
      id: "main-cls",
      name: "Main",
      kind: "class",
    });
    symbolRepo.insertMany([main]);

    // Create 5 downstream targets with source code
    const targets = Array.from({ length: 5 }, (_, i) =>
      makeSymbol({
        id: `target-${i}`,
        name: `Target${i}`,
        kind: "function",
      }),
    );
    symbolRepo.insertMany(targets);

    symbolRepo.insertSourceFts([
      {
        symbolId: "main-cls",
        name: "Main",
        filePath: "main.js",
        startLine: 1,
        endLine: 10,
        code: "class Main {}",
      },
      ...targets.map((t, i) => ({
        symbolId: t.id,
        name: t.name,
        filePath: `target${i}.js`,
        startLine: 1,
        endLine: 10,
        code: `function ${t.name}() {}`,
      })),
    ]);

    callGraphRepo.insertEdges(
      targets.map((t) =>
        makeEdge({
          sourceId: "main-cls",
          targetId: t.id,
          sourceName: "Main",
          targetName: t.name,
        }),
      ),
    );

    const result = buildContextPack(symbolRepo, callGraphRepo, issueRepo, {
      symbol: "Main",
      maxDownstreamSources: 2,
    });

    expect("error" in result).toBe(false);
    const pack = result as ContextPack;
    // main + up to 2 downstream
    expect(pack.source.length).toBeLessThanOrEqual(3);
    expect(pack.source[0].symbol).toBe("Main");
  });

  // ── Token budget truncation ─────────────────────────────

  it("sets metadata.truncated = true when budget is tight", () => {
    const sym = makeSymbol({
      id: "big-sym",
      name: "BigClass",
      kind: "class",
      docComment: "short doc",
    });
    symbolRepo.insertMany([sym]);
    symbolRepo.insertSourceFts([
      {
        symbolId: "big-sym",
        name: "BigClass",
        filePath: "big.js",
        startLine: 1,
        endLine: 1000,
        code: "x".repeat(8000), // 2000 tokens
      },
    ]);

    const result = buildContextPack(symbolRepo, callGraphRepo, issueRepo, {
      symbol: "BigClass",
      tokenBudget: 100, // very tight budget
    });

    expect("error" in result).toBe(false);
    const pack = result as ContextPack;
    expect(pack.metadata!.truncated).toBe(true);
  });

  it("sets metadata.truncated = false when budget is generous", () => {
    const sym = makeSymbol({
      id: "small-sym",
      name: "SmallClass",
      kind: "class",
    });
    symbolRepo.insertMany([sym]);
    symbolRepo.insertSourceFts([
      {
        symbolId: "small-sym",
        name: "SmallClass",
        filePath: "small.js",
        startLine: 1,
        endLine: 5,
        code: "class S {}",
      },
    ]);

    const result = buildContextPack(symbolRepo, callGraphRepo, issueRepo, {
      symbol: "SmallClass",
      tokenBudget: 50000,
    });

    expect("error" in result).toBe(false);
    const pack = result as ContextPack;
    expect(pack.metadata!.truncated).toBe(false);
  });

  // ── Default options ─────────────────────────────────────

  it("uses default options when none specified", () => {
    const sym = makeSymbol({
      id: "default-sym",
      name: "DefaultClass",
      kind: "class",
    });
    symbolRepo.insertMany([sym]);

    const result = buildContextPack(symbolRepo, callGraphRepo, issueRepo, {
      symbol: "DefaultClass",
    });

    expect("error" in result).toBe(false);
    const pack = result as ContextPack;
    expect(pack.metadata).toBeDefined();
    expect(pack.metadata!.symbolResolved).toBe("DefaultClass");
  });
});
