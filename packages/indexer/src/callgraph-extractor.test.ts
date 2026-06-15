import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CallGraphExtractor, buildSymbolMap } from "./callgraph-extractor.js";
import type { SymbolRecord, CallEdge } from "@cesium-nexus/shared";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

const FIXTURES_DIR = path.join(os.tmpdir(), "cesium-nexus-callgraph-test");

function writeFixture(name: string, content: string): string {
  const filePath = path.join(FIXTURES_DIR, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

describe("CallGraphExtractor", () => {
  let extractor: CallGraphExtractor;
  const files: string[] = [];

  beforeAll(() => {
    // Create a temp directory with fixture files
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });

    // Fixture: class with methods that call this.method()
    files.push(
      writeFixture(
        "Scene.js",
        `
export class Scene {
  update() {
    this.updateFrameState();
    this.render();
  }

  updateFrameState() {
    // leaf
  }

  render() {
    // leaf
  }
}
`,
      ),
    );

    // Fixture: static method call and new Class()
    files.push(
      writeFixture(
        "Camera.js",
        `
import { Cartesian3 } from "./Cartesian3.js";
import { Matrix4 } from "./Matrix4.js";

export class Camera {
  constructor() {
    this.position = new Cartesian3();
  }

  update() {
    const pos = Cartesian3.clone(this.position);
    const mat = Matrix4.multiply(this.viewMatrix, this.projMatrix);
  }
}
`,
      ),
    );

    // Fixture: Cartesian3 with static method
    files.push(
      writeFixture(
        "Cartesian3.js",
        `
export class Cartesian3 {
  constructor(x, y, z) {
    this.x = x || 0;
    this.y = y || 0;
    this.z = z || 0;
  }

  static clone(cartesian) {
    return new Cartesian3(cartesian.x, cartesian.y, cartesian.z);
  }
}
`,
      ),
    );

    // Fixture: Matrix4 with static method
    files.push(
      writeFixture(
        "Matrix4.js",
        `
export class Matrix4 {
  static multiply(left, right) {
    return new Matrix4();
  }
}
`,
      ),
    );

    extractor = new CallGraphExtractor(FIXTURES_DIR);
    extractor.loadFiles(files);
  });

  afterAll(() => {
    // Cleanup
    fs.rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });

  function buildTestSymbolMap(): Map<string, SymbolRecord> {
    const symbols: SymbolRecord[] = [
      { id: "scene-cls", name: "Scene", kind: "class", filePath: "Scene.js", startLine: 1, endLine: 20, exports: [], imports: [] },
      { id: "scene-update", name: "update", kind: "method", filePath: "Scene.js", startLine: 2, endLine: 6, exports: [], imports: [], parentClass: "Scene" },
      { id: "scene-updatefs", name: "updateFrameState", kind: "method", filePath: "Scene.js", startLine: 8, endLine: 9, exports: [], imports: [], parentClass: "Scene" },
      { id: "scene-render", name: "render", kind: "method", filePath: "Scene.js", startLine: 11, endLine: 13, exports: [], imports: [], parentClass: "Scene" },
      { id: "camera-cls", name: "Camera", kind: "class", filePath: "Camera.js", startLine: 1, endLine: 15, exports: [], imports: [] },
      { id: "camera-update", name: "update", kind: "method", filePath: "Camera.js", startLine: 8, endLine: 12, exports: [], imports: [], parentClass: "Camera" },
      { id: "camera-ctor", name: "constructor", kind: "method", filePath: "Camera.js", startLine: 5, endLine: 7, exports: [], imports: [], parentClass: "Camera" },
      { id: "cart3-cls", name: "Cartesian3", kind: "class", filePath: "Cartesian3.js", startLine: 1, endLine: 15, exports: [], imports: [] },
      { id: "cart3-clone", name: "clone", kind: "method", filePath: "Cartesian3.js", startLine: 10, endLine: 12, exports: [], imports: [], parentClass: "Cartesian3" },
      { id: "mat4-cls", name: "Matrix4", kind: "class", filePath: "Matrix4.js", startLine: 1, endLine: 8, exports: [], imports: [] },
      { id: "mat4-multiply", name: "multiply", kind: "method", filePath: "Matrix4.js", startLine: 3, endLine: 5, exports: [], imports: [], parentClass: "Matrix4" },
    ];
    return buildSymbolMap(symbols);
  }

  it("should resolve this.method() calls", () => {
    const symbolMap = buildTestSymbolMap();
    const { edges, stats } = extractor.extract(symbolMap);

    // Scene.update calls this.updateFrameState() and this.render()
    const sceneUpdateEdges = edges.filter(
      (e) => e.sourceName === "Scene.update" && e.edgeType === "call",
    );

    const targets = sceneUpdateEdges.map((e) => e.targetName).sort();
    expect(targets).toContain("Scene.updateFrameState");
    expect(targets).toContain("Scene.render");
  });

  it("should resolve new Class() as construct", () => {
    const symbolMap = buildTestSymbolMap();
    const { edges } = extractor.extract(symbolMap);

    const constructEdges = edges.filter((e) => e.edgeType === "construct");
    const targets = constructEdges.map((e) => e.targetName);
    expect(targets).toContain("Cartesian3");
  });

  it("should resolve Class.staticMethod() as static_call", () => {
    const symbolMap = buildTestSymbolMap();
    const { edges } = extractor.extract(symbolMap);

    const staticEdges = edges.filter((e) => e.edgeType === "static_call");
    const targets = staticEdges.map((e) => e.targetName);
    // Cartesian3.clone() and Matrix4.multiply() should be static calls
    expect(targets.some((t) => t.includes("Cartesian3") || t.includes("clone"))).toBe(true);
  });

  it("should skip bare function calls", () => {
    // Write a fixture with a bare function call
    const bareFile = writeFixture(
      "Bare.js",
      `
export function doSomething() {
  update(); // bare call — should be skipped
}
`,
    );

    const bareExtractor = new CallGraphExtractor(FIXTURES_DIR);
    bareExtractor.loadFiles([bareFile]);

    const symbols: SymbolRecord[] = [
      { id: "bare-fn", name: "doSomething", kind: "function", filePath: "Bare.js", startLine: 1, endLine: 3, exports: [], imports: [] },
    ];
    const symbolMap = buildSymbolMap(symbols);
    const { stats } = bareExtractor.extract(symbolMap);

    expect(stats.skippedDynamicCalls).toBeGreaterThan(0);

    fs.rmSync(bareFile, { force: true });
  });

  it("should produce stats with correct counts", () => {
    const symbolMap = buildTestSymbolMap();
    const { stats } = extractor.extract(symbolMap);

    expect(stats.filesScanned).toBe(files.length);
    expect(stats.resolvedCalls).toBeGreaterThan(0);
    expect(stats.constructCalls).toBeGreaterThanOrEqual(1); // at least new Cartesian3()
    expect(stats.unresolvedCalls).toBeGreaterThanOrEqual(0);
  });

  it("should not produce edges for unresolved targets", () => {
    // Empty symbol map — nothing should resolve
    const symbolMap = new Map<string, SymbolRecord>();
    const { edges } = extractor.extract(symbolMap);

    // No symbols in map, so no edges should have valid sourceId/targetId
    expect(edges.length).toBe(0);
  });
});

describe("buildSymbolMap", () => {
  it("should create key from parentClass.name for methods", () => {
    const symbols: SymbolRecord[] = [
      { id: "m1", name: "update", kind: "method", filePath: "f.js", startLine: 1, endLine: 5, exports: [], imports: [], parentClass: "Scene" },
    ];
    const map = buildSymbolMap(symbols);
    expect(map.has("Scene.update")).toBe(true);
    expect(map.get("Scene.update")?.id).toBe("m1");
  });

  it("should use name as key for classes", () => {
    const symbols: SymbolRecord[] = [
      { id: "c1", name: "Camera", kind: "class", filePath: "f.js", startLine: 1, endLine: 10, exports: [], imports: [] },
    ];
    const map = buildSymbolMap(symbols);
    expect(map.has("Camera")).toBe(true);
  });
});
