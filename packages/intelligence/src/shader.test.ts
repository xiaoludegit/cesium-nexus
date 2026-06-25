/**
 * Phase 3A2: Shader Intelligence Tests
 *
 * Tests for:
 * - GLSL Scanner
 * - Shader Repository
 * - Shader Index Builder
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import Database from "better-sqlite3";
import {
  GlslScanner,
  ShaderRepo,
  initShaderSchema,
  ShaderIndexBuilder,
} from "../src/index.js";

// Mock GLSL content
const MOCK_GLSL = `
/**
 * Gets the model vertex normal.
 * @returns {vec3} The normal in model coordinates.
 */
vec3 czm_modelVertexNormal()
{
    return normalize(czm_modelNormal * normal);
}

/**
 * Model color uniform.
 */
uniform vec4 czm_modelColor;

/**
 * Vertex position varying.
 */
varying vec3 v_positionEC;

struct czm_modelMaterial
{
    vec3 diffuse;
    float alpha;
};

#define czm_maxAmbient 1.0

const float czm_epsilon7 = 0.0000001;
`;

describe("Phase 3A2: Shader Intelligence", () => {
  let db: InstanceType<typeof Database>;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cesium-shader-test-"));
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    initShaderSchema(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("GLSL Scanner", () => {
    it("should extract symbols from GLSL content", () => {
      const scanner = new GlslScanner();

      // Create a mock GLSL file
      const glslPath = path.join(tmpDir, "test.glsl");
      fs.writeFileSync(glslPath, MOCK_GLSL);

      const symbols = scanner.scanFile(glslPath);

      // Should find various symbol types
      expect(symbols.length).toBeGreaterThan(0);

      // Check for function
      const func = symbols.find((s) => s.name === "czm_modelVertexNormal");
      expect(func).toBeDefined();
      expect(func!.type).toBe("function");
      expect(func!.docComment).toContain("model vertex normal");

      // Check for uniform
      const uniform = symbols.find((s) => s.name === "czm_modelColor");
      expect(uniform).toBeDefined();
      expect(uniform!.type).toBe("uniform");

      // Check for varying
      const varying = symbols.find((s) => s.name === "v_positionEC");
      expect(varying).toBeDefined();
      expect(varying!.type).toBe("varying");

      // Check for struct
      const struct = symbols.find((s) => s.name === "czm_modelMaterial");
      expect(struct).toBeDefined();
      expect(struct!.type).toBe("struct");

      // Check for define
      const define = symbols.find((s) => s.name === "czm_maxAmbient");
      expect(define).toBeDefined();
      expect(define!.type).toBe("define");

      // Check for const
      const constVal = symbols.find((s) => s.name === "czm_epsilon7");
      expect(constVal).toBeDefined();
      expect(constVal!.type).toBe("const");
    });

    it("should scan directory recursively", async () => {
      const scanner = new GlslScanner();

      // Create mock directory structure
      const shadersDir = path.join(tmpDir, "Shaders", "Model");
      fs.mkdirSync(shadersDir, { recursive: true });

      fs.writeFileSync(path.join(shadersDir, "ModelVS.glsl"), MOCK_GLSL);
      fs.writeFileSync(path.join(shadersDir, "ModelFS.glsl"), MOCK_GLSL);

      const symbols = await scanner.scanDirectory(path.join(tmpDir, "Shaders"));

      // Should find symbols from both files
      expect(symbols.length).toBeGreaterThan(0);
    });
  });

  describe("Shader Repository", () => {
    it("should store and retrieve shader symbols", () => {
      const repo = new ShaderRepo(db);

      const shader = {
        id: "shader/czm_modelVertexNormal",
        name: "czm_modelVertexNormal",
        type: "function" as const,
        file: "Source/Shaders/Model/ModelVS.glsl",
        source: "vec3 czm_modelVertexNormal() { ... }",
        relatedJsSymbols: [],
        startLine: 1,
        endLine: 5,
      };

      repo.upsertShader(shader);
      const retrieved = repo.getShader("shader/czm_modelVertexNormal");

      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe("czm_modelVertexNormal");
      expect(retrieved!.type).toBe("function");
    });

    it("should search by name pattern", () => {
      const repo = new ShaderRepo(db);

      repo.upsertShader({
        id: "shader/czm_model1",
        name: "czm_modelVertexNormal",
        type: "function",
        file: "test.glsl",
        source: "",
        relatedJsSymbols: [],
        startLine: 1,
        endLine: 1,
      });

      repo.upsertShader({
        id: "shader/czm_model2",
        name: "czm_modelColor",
        type: "uniform",
        file: "test.glsl",
        source: "",
        relatedJsSymbols: [],
        startLine: 10,
        endLine: 10,
      });

      const results = repo.searchByName("czm_model");
      expect(results.length).toBe(2);
    });

    it("should filter by type", () => {
      const repo = new ShaderRepo(db);

      repo.upsertShader({
        id: "shader/uniform1",
        name: "czm_testUniform",
        type: "uniform",
        file: "test.glsl",
        source: "",
        relatedJsSymbols: [],
        startLine: 1,
        endLine: 1,
      });

      repo.upsertShader({
        id: "shader/func1",
        name: "czm_testFunc",
        type: "function",
        file: "test.glsl",
        source: "",
        relatedJsSymbols: [],
        startLine: 10,
        endLine: 20,
      });

      const uniforms = repo.getByType("uniform");
      expect(uniforms.length).toBe(1);
      expect(uniforms[0].name).toBe("czm_testUniform");
    });

    it("should calculate statistics", () => {
      const repo = new ShaderRepo(db);

      repo.upsertShader({
        id: "shader/test1",
        name: "czm_test1",
        type: "uniform",
        file: "file1.glsl",
        source: "",
        relatedJsSymbols: ["js/Model"],
        startLine: 1,
        endLine: 1,
      });

      repo.upsertShader({
        id: "shader/test2",
        name: "czm_test2",
        type: "function",
        file: "file2.glsl",
        source: "",
        relatedJsSymbols: [],
        startLine: 1,
        endLine: 10,
      });

      const stats = repo.getStats();
      expect(stats.totalSymbols).toBe(2);
      expect(stats.byType["uniform"]).toBe(1);
      expect(stats.byType["function"]).toBe(1);
      expect(stats.relatedSymbols).toBe(1);
    });
  });

  describe("Shader Index Builder", () => {
    it("should build index from mock source", async () => {
      const builder = new ShaderIndexBuilder(db);

      // Create mock Cesium source structure
      const cesiumDir = path.join(tmpDir, "cesium");
      const shadersDir = path.join(
        cesiumDir,
        "packages",
        "engine",
        "Source",
        "Shaders",
        "Model"
      );
      fs.mkdirSync(shadersDir, { recursive: true });
      fs.writeFileSync(path.join(shadersDir, "ModelVS.glsl"), MOCK_GLSL);

      const index = await builder.build(cesiumDir);

      expect(index.symbols.size).toBeGreaterThan(0);
      expect(index.byName.has("czm_modelVertexNormal")).toBe(true);
    });

    it("should check if index exists", () => {
      const builder = new ShaderIndexBuilder(db);
      expect(builder.exists()).toBe(false);

      // Add a shader
      const repo = new ShaderRepo(db);
      repo.upsertShader({
        id: "shader/test",
        name: "czm_test",
        type: "function",
        file: "test.glsl",
        source: "",
        relatedJsSymbols: [],
        startLine: 1,
        endLine: 1,
      });

      expect(builder.exists()).toBe(true);
    });
  });
});
