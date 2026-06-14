import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { openDatabase, initSchema, SymbolRepo } from "./index.js";
import type { Database } from "./schema.js";
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
});
