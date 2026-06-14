import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { openDatabase, initSchema, SymbolRepo } from "./index.js";
import type { Database } from "./schema.js";
import type { SourceFtsEntry } from "./symbol-repo.js";
import type { SymbolRecord } from "@cesium-nexus/shared";
import * as path from "node:path";
import * as fs from "node:fs";

const TEST_DB_PATH = path.resolve("database/test-cesium.db");

function makeSymbol(overrides: Partial<SymbolRecord> = {}): SymbolRecord {
  return {
    id: "test-" + Math.random().toString(36).slice(2, 14),
    name: "TestSymbol",
    kind: "class",
    filePath: "packages/engine/Source/Test/TestSymbol.js",
    startLine: 1,
    endLine: 50,
    docComment: "A test symbol for unit testing.",
    exports: ["TestSymbol"],
    imports: ["../Core/defined.js"],
    ...overrides,
  };
}

describe("SymbolRepo", () => {
  let db: Database;
  let repo: SymbolRepo;

  beforeAll(() => {
    const dir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

    db = openDatabase(TEST_DB_PATH);
    initSchema(db);
    repo = new SymbolRepo(db);
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    // Clean WAL/SHM files
    for (const ext of ["-wal", "-shm"]) {
      const p = TEST_DB_PATH + ext;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  it("should batch insert symbols", () => {
    const symbols = [
      makeSymbol({ id: "sym-001", name: "Camera", kind: "class" }),
      makeSymbol({ id: "sym-002", name: "Scene", kind: "class" }),
      makeSymbol({ id: "sym-003", name: "update", kind: "method", parentClass: "Camera" }),
    ];
    const count = repo.insertMany(symbols);
    expect(count).toBe(3);
    expect(repo.totalCount()).toBe(3);
  });

  it("should find symbols by name", () => {
    const results = repo.findByName("Camera");
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("Camera");
    expect(results[0].kind).toBe("class");
    expect(results[0].exports).toEqual(["TestSymbol"]);
  });

  it("should find a symbol by ID", () => {
    const result = repo.findById("sym-001");
    expect(result).toBeDefined();
    expect(result!.name).toBe("Camera");
    expect(result!.kind).toBe("class");
  });

  it("should return undefined for non-existent ID", () => {
    const result = repo.findById("non-existent-id");
    expect(result).toBeUndefined();
  });

  it("should count symbols by kind", () => {
    const counts = repo.countByKind();
    expect(counts["class"]).toBe(2);
    expect(counts["method"]).toBe(1);
  });

  it("should search via FTS5", () => {
    const results = repo.searchFts("Camera");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe("Camera");
  });

  it("should search FTS5 with doc_comment content", () => {
    const results = repo.searchFts("test symbol");
    expect(results.length).toBeGreaterThan(0);
  });

  it("should handle empty FTS query gracefully", () => {
    const results = repo.searchFts("");
    expect(results).toEqual([]);
  });

  it("should insert source code snippets into source_fts", () => {
    const entries: SourceFtsEntry[] = [
      {
        symbolId: "sym-001",
        name: "Camera",
        filePath: "packages/engine/Source/Scene/Camera.js",
        startLine: 81,
        endLine: 100,
        code: "function Camera(scene) {\n  this._scene = scene;\n  this.executeCommand = function() {};\n}",
      },
      {
        symbolId: "sym-002",
        name: "Scene",
        filePath: "packages/engine/Source/Scene/Scene.js",
        startLine: 130,
        endLine: 150,
        code: "function Scene(canvas, contextOptions) {\n  this._canvas = canvas;\n  this.render = function() {};\n}",
      },
    ];
    const count = repo.insertSourceFts(entries);
    expect(count).toBe(2);
  });

  it("should search source code text (not just symbol names)", () => {
    // "executeCommand" only appears in code text, not in symbol name "Camera"
    const results = repo.searchSource("executeCommand");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].symbolId).toBe("sym-001");
    expect(results[0].name).toBe("Camera");
    expect(results[0].filePath).toContain("Camera.js");
    expect(results[0].snippet).toBeTruthy();
  });

  it("should return snippet with highlight markers", () => {
    const results = repo.searchSource("render");
    expect(results.length).toBeGreaterThan(0);
    // snippet should contain highlight markers >>> and <<<
    expect(results[0].snippet).toMatch(/>>>.*<<<|【.*】/);
  });

  it("should handle empty source search query gracefully", () => {
    const results = repo.searchSource("");
    expect(results).toEqual([]);
  });

  it("should clear source_fts data", () => {
    repo.clearSourceFts();
    const results = repo.searchSource("executeCommand");
    expect(results).toEqual([]);
  });
});
