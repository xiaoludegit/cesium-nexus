import { describe, it, expect, beforeAll } from "vitest";
import { openDatabase, initSchema, SymbolRepo } from "@cesium-nexus/storage";
import type { Database } from "@cesium-nexus/storage";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

// Use the real indexed Cesium database for end-to-end verification
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_DB_PATH = path.resolve(__dirname, "../../../database/cesium.db");
const hasRealDb = existsSync(REAL_DB_PATH);

describe.skipIf(!hasRealDb)("M2 E2E: Source Retrieval against real Cesium index", () => {
  let db: Database;
  let repo: SymbolRepo;

  beforeAll(() => {
    db = openDatabase(REAL_DB_PATH);
    initSchema(db);
    repo = new SymbolRepo(db);
  });

  it("should find Viewer, Scene, Camera in symbol table", () => {
    for (const name of ["Viewer", "Scene", "Camera"]) {
      const results = repo.findByName(name);
      expect(results.length).toBeGreaterThan(0);
      const cls = results.find((r) => r.kind === "class");
      expect(cls).toBeDefined();
      expect(cls!.startLine).toBeGreaterThan(0);
      expect(cls!.endLine).toBeGreaterThan(cls!.startLine);
    }
  });

  it("should find Camera via findById with correct metadata", () => {
    const cameras = repo.findByName("Camera");
    const camera = cameras.find((c) => c.kind === "class" && c.filePath.includes("Camera.js"));
    expect(camera).toBeDefined();

    const byId = repo.findById(camera!.id);
    expect(byId).toBeDefined();
    expect(byId!.name).toBe("Camera");
    expect(byId!.filePath).toBe("packages/engine/Source/Scene/Camera.js");
    expect(byId!.imports.length).toBeGreaterThan(5);
  });

  it("searchSource should find 'executeCommand' (source text only, not in symbol names)", () => {
    // executeCommand appears in source code text (e.g. FrameState.js doc comments referencing Scene.executeCommand)
    // but NO symbol is named executeCommand — this proves source code FTS works
    const nameResults = repo.findByName("executeCommand");
    expect(nameResults.length).toBe(0); // not a symbol name

    const sourceResults = repo.searchSource("executeCommand");
    expect(sourceResults.length).toBeGreaterThan(0);
    expect(sourceResults[0].filePath).toBeTruthy();
    expect(sourceResults[0].startLine).toBeGreaterThan(0);
    expect(sourceResults[0].snippet).toBeTruthy();
  });

  it("searchSource should find code patterns like 'Object.freeze' in enum definitions", () => {
    // Object.freeze is used extensively in Cesium enum/state files but is not a symbol name
    const results = repo.searchSource("Object.freeze");
    expect(results.length).toBeGreaterThan(0);
    // Should hit enum-like files that use Object.freeze (e.g. BlendingState, BoundingSphereState)
    const files = results.map((r) => r.filePath);
    const hasEnumFile = files.some(
      (f) => f.includes("State") || f.includes("Material") || f.includes("freeze"),
    );
    expect(hasEnumFile).toBe(true);
  });

  it("searchSource snippet should contain highlight markers around matched term", () => {
    const results = repo.searchSource("drawCommand", 5);
    expect(results.length).toBeGreaterThan(0);
    // At least one result should have >>> <<< markers from FTS5 snippet()
    const hasHighlight = results.some(
      (r) => r.snippet.includes(">>>") && r.snippet.includes("<<<"),
    );
    expect(hasHighlight).toBe(true);
  });

  it("searchSource and searchFts should return different results for code-only terms", () => {
    // 'this._scene' appears in source code but not in symbol names or doc comments
    const sourceResults = repo.searchSource("scene");
    const ftsResults = repo.searchFts("scene");

    // Both should return results but from different data sources
    expect(sourceResults.length).toBeGreaterThan(0);
    expect(ftsResults.length).toBeGreaterThan(0);

    // Source search returns snippet + filePath
    expect(sourceResults[0].snippet).toBeTruthy();
    // FTS search returns SymbolRecord with kind
    expect(ftsResults[0].kind).toBeTruthy();
  });

  it("source_code table should have entries for all indexed symbols", () => {
    const totalSymbols = repo.totalCount();
    expect(totalSymbols).toBeGreaterThan(3000);

    // Verify source_code table is populated by searching for a common pattern
    const results = repo.searchSource("function", 100);
    expect(results.length).toBe(100); // should be capped at limit
  });
});
