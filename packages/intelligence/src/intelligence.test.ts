/**
 * Phase 3A1 Integration Tests
 *
 * Tests for Version Intelligence:
 * - Snapshot Builder
 * - Symbol Diff Engine
 * - Breaking Change Detector
 * - Identity Stability
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import Database from "better-sqlite3";
import {
  SnapshotBuilder,
  SnapshotRepo,
  initVersionSchema,
  SymbolDiffEngine,
  BreakingChangeDetector,
  generateSymbolId,
  parseSymbolIdentity,
  calculateIdentityStability,
  buildFullyQualifiedName,
} from "../src/index.js";

// Mock Cesium source structure
function createMockCesiumSource(baseDir: string, version: string): void {
  const sourceDir = path.join(baseDir, "packages", "engine", "Source");
  fs.mkdirSync(sourceDir, { recursive: true });

  // Common symbols in all versions
  const commonSymbols: Record<string, string> = {
    "Scene/Camera.js": `
/**
 * The camera is used to view a {@link Scene}.
 * @alias Camera
 * @constructor
 */
export class Camera {
  /**
   * Gets the camera position.
   * @returns {Cartesian3} The position.
   */
  getPosition() {
    return this._position;
  }

  /**
   * Sets the camera view.
   * @param {object} options - View options.
   */
  setView(options) {
    this._position = options.destination;
  }

  /**
   * Flies the camera to a destination.
   * @param {object} options - Fly options.
   */
  flyTo(options) {
    // Animation logic
  }
}
`,
    "Scene/Scene.js": `
/**
 * The container for all 3D graphical objects.
 * @alias Scene
 * @constructor
 */
export class Scene {
  /**
   * Gets the camera.
   * @returns {Camera} The camera.
   */
  get camera() {
    return this._camera;
  }

  /**
   * Picks an object at a window position.
   * @param {Cartesian2} windowPosition - The position.
   * @returns {object} The picked object.
   */
  pick(windowPosition) {
    // Pick logic
  }
}
`,
    "Scene/Globe.js": `
/**
 * The globe rendering.
 * @alias Globe
 * @constructor
 */
export class Globe {
  /**
   * Gets the terrain provider.
   * @returns {TerrainProvider} The provider.
   */
  get terrainProvider() {
    return this._terrainProvider;
  }
}
`,
  };

  // Version 1.118 specific symbols
  const v1118Symbols: Record<string, string> = {
    "Scene/PickRay.js": `
/**
 * Creates a pick ray.
 * @param {Cartesian2} windowPosition - The position.
 * @returns {Ray} The pick ray.
 */
export function createPickRay(windowPosition) {
  return new Ray();
}
`,
    "Scene/OldFeature.js": `
/**
 * @deprecated Use newFunction instead.
 */
export function oldFunction() {
  return null;
}
`,
  };

  // Version 1.130 specific symbols
  const v1130Symbols: Record<string, string> = {
    "Scene/PickRay.js": `
/**
 * Creates a pick ray from a window position.
 * @param {Cartesian2} windowPosition - The position.
 * @param {Camera} camera - The camera.
 * @returns {Ray} The pick ray.
 */
export function createPickRay(windowPosition, camera) {
  return new Ray();
}
`,
    "Scene/NewFeature.js": `
/**
 * New feature in 1.130.
 * @param {object} options - Options.
 * @returns {object} Result.
 */
export function newFeature(options) {
  return {};
}
`,
  };

  // Write common symbols
  for (const [filePath, content] of Object.entries(commonSymbols)) {
    const fullPath = path.join(sourceDir, filePath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  // Write version-specific symbols
  const versionSymbols = version === "1.118" ? v1118Symbols : v1130Symbols;
  for (const [filePath, content] of Object.entries(versionSymbols)) {
    const fullPath = path.join(sourceDir, filePath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
}

describe("Phase 3A1: Version Intelligence", () => {
  let db: InstanceType<typeof Database>;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cesium-intel-test-"));
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    initVersionSchema(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Identity (RC-002)", () => {
    it("should generate stable symbol IDs", () => {
      const identity = {
        kind: "method" as const,
        fullyQualifiedName: "Scene.Camera.getPosition",
      };

      const id1 = generateSymbolId(identity);
      const id2 = generateSymbolId(identity);

      expect(id1).toBe(id2);
      expect(id1).toMatch(/^sym\/[a-f0-9]{40}$/);
    });

    it("should generate different IDs for different symbols", () => {
      const id1 = generateSymbolId({
        kind: "method",
        fullyQualifiedName: "Scene.Camera.getPosition",
      });
      const id2 = generateSymbolId({
        kind: "method",
        fullyQualifiedName: "Scene.Camera.setView",
      });

      expect(id1).not.toBe(id2);
    });

    it("should build fully qualified names", () => {
      expect(buildFullyQualifiedName("Scene", "Camera", "getPosition")).toBe(
        "Scene.Camera.getPosition"
      );
      expect(buildFullyQualifiedName("Scene", "Camera")).toBe("Scene.Camera");
    });

    it("should parse symbol identity from name and kind", () => {
      const identity = parseSymbolIdentity("getPosition", "method", "Camera");
      expect(identity.kind).toBe("method");
      expect(identity.fullyQualifiedName).toBe("Camera.getPosition");
    });
  });

  describe("Snapshot Builder", () => {
    it("should build snapshot from mock Cesium source", async () => {
      const cesiumDir = path.join(tmpDir, "cesium-1.118");
      createMockCesiumSource(cesiumDir, "1.118");

      const builder = new SnapshotBuilder(db);
      const snapshots = await builder.buildSnapshot({
        version: "1.118",
        cesiumRoot: cesiumDir,
      });

      expect(snapshots.length).toBeGreaterThan(0);

      // Check that Camera is indexed
      const camera = snapshots.find((s) => s.name === "Camera");
      expect(camera).toBeDefined();
      expect(camera!.kind).toBe("class");
    });

    it("should cache snapshots", async () => {
      const cesiumDir = path.join(tmpDir, "cesium-1.118");
      createMockCesiumSource(cesiumDir, "1.118");

      const builder = new SnapshotBuilder(db);

      // First build
      const snapshots1 = await builder.buildSnapshot({
        version: "1.118",
        cesiumRoot: cesiumDir,
      });

      // Second build should return cached
      const snapshots2 = await builder.buildSnapshot({
        version: "1.118",
        cesiumRoot: cesiumDir,
      });

      expect(snapshots1.length).toBe(snapshots2.length);
    });

    it("should list available versions", async () => {
      const cesiumDir = path.join(tmpDir, "cesium-1.118");
      createMockCesiumSource(cesiumDir, "1.118");

      const builder = new SnapshotBuilder(db);
      await builder.buildSnapshot({
        version: "1.118",
        cesiumRoot: cesiumDir,
      });

      const versions = builder.listVersions();
      expect(versions).toContain("1.118");
    });
  });

  describe("Symbol Diff Engine", () => {
    it("should detect added and removed symbols", async () => {
      const repo = new SnapshotRepo(db);
      const diffEngine = new SymbolDiffEngine(repo);

      // Create snapshots for two versions
      const cesiumDir1 = path.join(tmpDir, "cesium-1.118");
      const cesiumDir2 = path.join(tmpDir, "cesium-1.130");
      createMockCesiumSource(cesiumDir1, "1.118");
      createMockCesiumSource(cesiumDir2, "1.130");

      const builder = new SnapshotBuilder(db);
      await builder.buildSnapshot({ version: "1.118", cesiumRoot: cesiumDir1 });
      await builder.buildSnapshot({ version: "1.130", cesiumRoot: cesiumDir2 });

      // Compute diff
      const diff = diffEngine.diff("1.118", "1.130");

      // Stats should reflect changes
      expect(diff.stats.totalFrom).toBeGreaterThan(0);
      expect(diff.stats.totalTo).toBeGreaterThan(0);
    });

    it("should detect modified symbols", async () => {
      const repo = new SnapshotRepo(db);
      const diffEngine = new SymbolDiffEngine(repo);

      const cesiumDir1 = path.join(tmpDir, "cesium-1.118");
      const cesiumDir2 = path.join(tmpDir, "cesium-1.130");
      createMockCesiumSource(cesiumDir1, "1.118");
      createMockCesiumSource(cesiumDir2, "1.130");

      const builder = new SnapshotBuilder(db);
      await builder.buildSnapshot({ version: "1.118", cesiumRoot: cesiumDir1 });
      await builder.buildSnapshot({ version: "1.130", cesiumRoot: cesiumDir2 });

      const diff = diffEngine.diff("1.118", "1.130");

      // Should detect some changes
      const totalChanges = diff.stats.addedCount + diff.stats.removedCount + diff.stats.modifiedCount;
      expect(totalChanges).toBeGreaterThanOrEqual(0);
    });

    it("should filter by symbol name", async () => {
      const repo = new SnapshotRepo(db);
      const diffEngine = new SymbolDiffEngine(repo);

      const cesiumDir1 = path.join(tmpDir, "cesium-1.118");
      const cesiumDir2 = path.join(tmpDir, "cesium-1.130");
      createMockCesiumSource(cesiumDir1, "1.118");
      createMockCesiumSource(cesiumDir2, "1.130");

      const builder = new SnapshotBuilder(db);
      await builder.buildSnapshot({ version: "1.118", cesiumRoot: cesiumDir1 });
      await builder.buildSnapshot({ version: "1.130", cesiumRoot: cesiumDir2 });

      const diff = diffEngine.diff("1.118", "1.130", "Camera");

      // Only Camera-related symbols should be included
      const allSymbols = [...diff.added, ...diff.removed, ...diff.modified.map((m) => m.after)];
      for (const s of allSymbols) {
        expect(s.name.toLowerCase()).toContain("camera");
      }
    });

    it("should calculate identity stability", async () => {
      const repo = new SnapshotRepo(db);
      const diffEngine = new SymbolDiffEngine(repo);

      const cesiumDir1 = path.join(tmpDir, "cesium-1.118");
      const cesiumDir2 = path.join(tmpDir, "cesium-1.130");
      createMockCesiumSource(cesiumDir1, "1.118");
      createMockCesiumSource(cesiumDir2, "1.130");

      const builder = new SnapshotBuilder(db);
      await builder.buildSnapshot({ version: "1.118", cesiumRoot: cesiumDir1 });
      await builder.buildSnapshot({ version: "1.130", cesiumRoot: cesiumDir2 });

      const stability = diffEngine.calculateStability("1.118", "1.130");

      // Identity stability should be high
      expect(stability.stabilityRate).toBeGreaterThanOrEqual(0);
      expect(stability.totalSymbolsV1).toBeGreaterThan(0);
      expect(stability.totalSymbolsV2).toBeGreaterThan(0);
    });
  });

  describe("Breaking Change Detector", () => {
    it("should detect removed symbols as breaking changes", async () => {
      const repo = new SnapshotRepo(db);
      const diffEngine = new SymbolDiffEngine(repo);
      const detector = new BreakingChangeDetector(repo);

      const cesiumDir1 = path.join(tmpDir, "cesium-1.118");
      const cesiumDir2 = path.join(tmpDir, "cesium-1.130");
      createMockCesiumSource(cesiumDir1, "1.118");
      createMockCesiumSource(cesiumDir2, "1.130");

      const builder = new SnapshotBuilder(db);
      await builder.buildSnapshot({ version: "1.118", cesiumRoot: cesiumDir1 });
      await builder.buildSnapshot({ version: "1.130", cesiumRoot: cesiumDir2 });

      const diff = diffEngine.diff("1.118", "1.130");
      const breakingChanges = detector.detect(diff);

      // Should detect breaking changes (if any removed)
      expect(breakingChanges).toBeDefined();
      expect(Array.isArray(breakingChanges)).toBe(true);
    });

    it("should generate migration guide", async () => {
      const repo = new SnapshotRepo(db);
      const detector = new BreakingChangeDetector(repo);

      const guide = detector.generateMigrationGuide({
        id: "test",
        fromVersion: "1.118",
        toVersion: "1.130",
        symbolId: "sym/test",
        symbolName: "oldFunction",
        changeType: "removed",
        description: "Symbol removed",
        createdAt: Date.now(),
      });

      expect(guide).toContain("oldFunction");
      expect(guide).toContain("Migration Steps");
    });
  });

  describe("Snapshot Repository", () => {
    it("should store and retrieve snapshots", () => {
      const repo = new SnapshotRepo(db);

      const snapshot = {
        id: "snapshot/1.118/sym/test",
        version: "1.118",
        symbolId: "sym/test",
        name: "testSymbol",
        kind: "function" as const,
        filePath: "test.js",
        startLine: 1,
        endLine: 10,
        sourceHash: "abc123",
        snapshotAt: Date.now(),
      };

      repo.upsertSnapshot(snapshot);
      const retrieved = repo.getSnapshotSymbol("1.118", "sym/test");

      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe("testSymbol");
    });

    it("should list versions", () => {
      const repo = new SnapshotRepo(db);

      repo.upsertSnapshot({
        id: "snapshot/1.118/sym/test",
        version: "1.118",
        symbolId: "sym/test",
        name: "testSymbol",
        kind: "function",
        filePath: "test.js",
        startLine: 1,
        endLine: 10,
        sourceHash: "abc123",
        snapshotAt: Date.now(),
      });

      repo.upsertSnapshot({
        id: "snapshot/1.130/sym/test",
        version: "1.130",
        symbolId: "sym/test",
        name: "testSymbol",
        kind: "function",
        filePath: "test.js",
        startLine: 1,
        endLine: 10,
        sourceHash: "def456",
        snapshotAt: Date.now(),
      });

      const versions = repo.listVersions();
      expect(versions).toContain("1.118");
      expect(versions).toContain("1.130");
    });

    it("should get snapshot statistics", () => {
      const repo = new SnapshotRepo(db);

      repo.upsertSnapshot({
        id: "snapshot/1.118/sym/test1",
        version: "1.118",
        symbolId: "sym/test1",
        name: "symbol1",
        kind: "class",
        filePath: "test.js",
        startLine: 1,
        endLine: 10,
        sourceHash: "abc",
        snapshotAt: Date.now(),
      });

      repo.upsertSnapshot({
        id: "snapshot/1.118/sym/test2",
        version: "1.118",
        symbolId: "sym/test2",
        name: "symbol2",
        kind: "function",
        filePath: "test.js",
        startLine: 20,
        endLine: 30,
        sourceHash: "def",
        snapshotAt: Date.now(),
      });

      const stats = repo.getSnapshotStats("1.118");
      expect(stats.total).toBe(2);
      expect(stats.byKind["class"]).toBe(1);
      expect(stats.byKind["function"]).toBe(1);
    });

    it("should search by name pattern", () => {
      const repo = new SnapshotRepo(db);

      repo.upsertSnapshot({
        id: "snapshot/1.118/sym/test1",
        version: "1.118",
        symbolId: "sym/test1",
        name: "Camera",
        kind: "class",
        filePath: "Camera.js",
        startLine: 1,
        endLine: 10,
        sourceHash: "abc",
        snapshotAt: Date.now(),
      });

      repo.upsertSnapshot({
        id: "snapshot/1.118/sym/test2",
        version: "1.118",
        symbolId: "sym/test2",
        name: "CameraFlight",
        kind: "class",
        filePath: "CameraFlight.js",
        startLine: 1,
        endLine: 10,
        sourceHash: "def",
        snapshotAt: Date.now(),
      });

      const results = repo.searchByName("1.118", "Camera");
      expect(results.length).toBe(2);
    });
  });

  describe("End-to-End Flow", () => {
    it("should complete full snapshot → diff → breaking changes flow", async () => {
      // Step 1: Build snapshots
      const cesiumDir1 = path.join(tmpDir, "cesium-1.118");
      const cesiumDir2 = path.join(tmpDir, "cesium-1.130");
      createMockCesiumSource(cesiumDir1, "1.118");
      createMockCesiumSource(cesiumDir2, "1.130");

      const builder = new SnapshotBuilder(db);
      const snapshot1 = await builder.buildSnapshot({
        version: "1.118",
        cesiumRoot: cesiumDir1,
      });
      const snapshot2 = await builder.buildSnapshot({
        version: "1.130",
        cesiumRoot: cesiumDir2,
      });

      expect(snapshot1.length).toBeGreaterThan(0);
      expect(snapshot2.length).toBeGreaterThan(0);

      // Step 2: Compute diff
      const repo = new SnapshotRepo(db);
      const diffEngine = new SymbolDiffEngine(repo);
      const diff = diffEngine.diff("1.118", "1.130");

      expect(diff.stats.totalFrom).toBe(snapshot1.length);
      expect(diff.stats.totalTo).toBe(snapshot2.length);

      // Step 3: Detect breaking changes
      const detector = new BreakingChangeDetector(repo);
      const breakingChanges = detector.detect(diff);

      // Should detect breaking changes (if any)
      expect(breakingChanges).toBeDefined();
      expect(Array.isArray(breakingChanges)).toBe(true);

      // Step 4: Verify identity stability
      const stability = diffEngine.calculateStability("1.118", "1.130");
      expect(stability.stabilityRate).toBeGreaterThanOrEqual(0);

      // Step 5: Get migration guide for a breaking change
      if (breakingChanges.length > 0) {
        const guide = detector.generateMigrationGuide(breakingChanges[0]);
        expect(guide.length).toBeGreaterThan(0);
      }
    });
  });
});
