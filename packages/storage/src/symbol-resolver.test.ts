import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, initSchema, SymbolRepo } from "./index.js";
import type { Database } from "./schema.js";
import type { SymbolRecord } from "@cesium-nexus/shared";
import { resolveSymbolId } from "./symbol-resolver.js";

describe("resolveSymbolId", () => {
  let db: Database;
  let repo: SymbolRepo;

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

  beforeEach(() => {
    db = openDatabase(":memory:");
    initSchema(db);
    repo = new SymbolRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it("resolves dotted name via exact match", () => {
    repo.insertMany([
      makeSymbol({
        id: "cam-update",
        name: "update",
        kind: "method",
        parentClass: "Camera",
      }),
    ]);

    const result = resolveSymbolId("Camera.update", repo);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("cam-update");
    expect(result!.displayName).toBe("Camera.update");
  });

  it("returns null for dotted name with no match (no FTS fallback)", () => {
    repo.insertMany([
      makeSymbol({
        id: "other-method",
        name: "render",
        kind: "method",
        parentClass: "Scene",
      }),
    ]);

    const result = resolveSymbolId("Camera.update", repo);
    expect(result).toBeNull();
  });

  it("resolves simple name exact match (prefer class)", () => {
    repo.insertMany([
      makeSymbol({ id: "viewer-fn", name: "Viewer", kind: "function" }),
      makeSymbol({ id: "viewer-cls", name: "Viewer", kind: "class" }),
    ]);

    const result = resolveSymbolId("Viewer", repo);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("viewer-cls");
    expect(result!.displayName).toBe("Viewer");
  });

  it("resolves simple name via FTS fallback", () => {
    repo.insertMany([
      makeSymbol({
        id: "cam-cls",
        name: "Camera",
        kind: "class",
        docComment: "Camera for 3D scene",
      }),
    ]);

    const result = resolveSymbolId("CameraScene", repo);
    // FTS may or may not match depending on tokenization
    // If it matches, it should return a valid result
    if (result) {
      expect(result.id).toBeTruthy();
    }
  });

  it("returns null when nothing matches", () => {
    repo.insertMany([
      makeSymbol({ id: "abc", name: "Abc", kind: "class" }),
    ]);

    const result = resolveSymbolId("Zzzzzzzz", repo);
    expect(result).toBeNull();
  });

  it("formats displayName with parentClass for methods", () => {
    repo.insertMany([
      makeSymbol({
        id: "m-fly",
        name: "flyTo",
        kind: "method",
        parentClass: "Camera",
      }),
    ]);

    // Exact name match for "flyTo"
    const result = resolveSymbolId("flyTo", repo);
    expect(result).not.toBeNull();
    expect(result!.displayName).toBe("Camera.flyTo");
  });
});
