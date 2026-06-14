import { describe, it, expect, beforeAll } from "vitest";
import { SymbolExtractor } from "./symbol-extractor.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

// Cesium source is a git submodule at <project-root>/data/cesium
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CESIUM_ROOT = path.resolve(__dirname, "../../../data/cesium");

const hasSubmodule = existsSync(path.join(CESIUM_ROOT, "packages/engine/Source"));

describe.skipIf(!hasSubmodule)("SymbolExtractor", () => {
  let extractor: SymbolExtractor;

  beforeAll(() => {
    extractor = new SymbolExtractor();
  });

  describe("Camera.js — function constructor class", () => {
    it("should extract Camera as a class via @alias tag", () => {
      const symbols = extractor.extractFile(
        `${CESIUM_ROOT}/packages/engine/Source/Scene/Camera.js`,
        CESIUM_ROOT,
      );
      const camera = symbols.find((s) => s.name === "Camera" && s.kind === "class");
      expect(camera).toBeDefined();
      expect(camera!.kind).toBe("class");
      expect(camera!.filePath).toBe("packages/engine/Source/Scene/Camera.js");
      expect(camera!.docComment).toBeTruthy();
      expect(camera!.imports.length).toBeGreaterThan(0);
    });

    it("should extract prototype methods", () => {
      const symbols = extractor.extractFile(
        `${CESIUM_ROOT}/packages/engine/Source/Scene/Camera.js`,
        CESIUM_ROOT,
      );
      const methods = symbols.filter((s) => s.kind === "method");
      expect(methods.length).toBeGreaterThan(10);
      // flyTo is a well-known Camera method
      const flyTo = methods.find((m) => m.name === "flyTo");
      expect(flyTo).toBeDefined();
      expect(flyTo!.parentClass).toBe("Camera");
    });
  });

  describe("Intersect.js — enum", () => {
    it("should extract Intersect as an enum", () => {
      const symbols = extractor.extractFile(
        `${CESIUM_ROOT}/packages/engine/Source/Core/Intersect.js`,
        CESIUM_ROOT,
      );
      const intersect = symbols.find((s) => s.name === "Intersect");
      expect(intersect).toBeDefined();
      expect(intersect!.kind).toBe("enum");
    });
  });

  describe("defined.js — standalone function", () => {
    it("should extract defined as a function", () => {
      const symbols = extractor.extractFile(
        `${CESIUM_ROOT}/packages/engine/Source/Core/defined.js`,
        CESIUM_ROOT,
      );
      const defined = symbols.find((s) => s.name === "defined");
      expect(defined).toBeDefined();
      expect(defined!.kind).toBe("function");
    });
  });

  describe("Viewer.js — ES6 class in widgets package", () => {
    it("should extract Viewer as a class", () => {
      const symbols = extractor.extractFile(
        `${CESIUM_ROOT}/packages/widgets/Source/Viewer/Viewer.js`,
        CESIUM_ROOT,
      );
      const viewer = symbols.find((s) => s.name === "Viewer" && s.kind === "class");
      expect(viewer).toBeDefined();
      expect(viewer!.kind).toBe("class");
      expect(viewer!.filePath).toContain("packages/widgets");
    });
  });

  describe("ID generation", () => {
    it("should generate stable deterministic IDs", () => {
      const symbols1 = extractor.extractFile(
        `${CESIUM_ROOT}/packages/engine/Source/Core/Intersect.js`,
        CESIUM_ROOT,
      );
      const symbols2 = extractor.extractFile(
        `${CESIUM_ROOT}/packages/engine/Source/Core/Intersect.js`,
        CESIUM_ROOT,
      );
      expect(symbols1[0].id).toBe(symbols2[0].id);
      expect(symbols1[0].id).toMatch(/^[a-f0-9]{12}$/);
    });
  });
});
