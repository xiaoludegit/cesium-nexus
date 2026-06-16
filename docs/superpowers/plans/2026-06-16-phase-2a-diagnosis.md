# Phase 2A Diagnosis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 2A debug-first diagnosis loop for Cesium problems using static Problem KB matching plus existing symbol, source, callgraph, and issue retrieval.

**Architecture:** Add `@cesium-nexus/diagnosis` as a domain package that loads static JSON knowledge, matches user symptoms to problem patterns, assembles a `DiagnosticContextPack`, and truncates it to budget. CLI and MCP layers call this package while Phase 1 `build_context_pack` remains stable.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, Commander, MCP SDK, SQLite repositories from `@cesium-nexus/storage`, static JSON files under `data/`.

---

## File Structure

Create:

- `packages/diagnosis/package.json` - package manifest and workspace dependencies.
- `packages/diagnosis/tsconfig.json` - package TypeScript config.
- `packages/diagnosis/tsup.config.ts` - package build config.
- `packages/diagnosis/src/index.ts` - public exports.
- `packages/diagnosis/src/knowledge-loader.ts` - load and validate static KB JSON.
- `packages/diagnosis/src/matcher.ts` - deterministic query-to-pattern scoring.
- `packages/diagnosis/src/diagnoser.ts` - assemble `DiagnosticContextPack`.
- `packages/diagnosis/src/token-budget.ts` - estimate and truncate diagnostic packs.
- `packages/diagnosis/src/knowledge-loader.test.ts` - loader validation tests.
- `packages/diagnosis/src/matcher.test.ts` - matching tests.
- `packages/diagnosis/src/diagnoser.test.ts` - assembly tests with in-memory repos.
- `packages/diagnosis/src/token-budget.test.ts` - truncation tests.
- `data/problem-kb/problem-patterns.json` - initial static Problem KB.
- `data/problem-kb/render-stages.json` - initial diagnosis render stage map.
- `data/evaluation/phase2a-diagnosis-cases.json` - evaluation cases.
- `packages/cli/src/commands/diagnose-cmd.ts` - `diagnose`, `pkb list`, and `stage` commands.

Modify:

- `pnpm-workspace.yaml` - package discovery already covers `packages/*`; verify no change is needed.
- `packages/shared/src/types.ts` - add diagnosis shared types.
- `packages/shared/src/index.ts` - ensure new types are exported if this file uses explicit exports.
- `packages/cli/package.json` - add dependency on `@cesium-nexus/diagnosis`.
- `packages/cli/src/index.ts` - register diagnosis commands.
- `packages/cli/src/e2e-cli.test.ts` - add diagnosis CLI coverage or create diagnosis-specific CLI tests if cleaner.
- `packages/mcp/package.json` - add dependency on `@cesium-nexus/diagnosis`.
- `packages/mcp/src/handlers.ts` - add `handleDiagnoseProblem` and `handleQueryRenderStage`.
- `packages/mcp/src/handlers.test.ts` - add handler unit tests.
- `packages/mcp/src/server.ts` - register `diagnose_problem` and `query_render_stage`.
- `packages/mcp/src/server.test.ts` - assert 7 tools and tool calls.
- `packages/mcp/src/e2e-stdio.test.ts` - assert stdio tool list includes diagnosis tools.
- `README.md` - update Phase 2A command/tool docs after implementation.
- `CHANGELOG.md` - add unreleased Phase 2A entries after implementation.

---

### Task 1: Shared Diagnosis Types

**Files:**

- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/types.ts` via downstream package typecheck

- [ ] **Step 1: Add diagnosis types to shared**

Append these interfaces after `ContextPack` in `packages/shared/src/types.ts`:

```ts
export type ProblemCategory =
  | "debug"
  | "performance"
  | "rendering"
  | "terrain"
  | "tiles"
  | "shader";

export type ProblemSeverity = "low" | "medium" | "high";

export interface ProblemPattern {
  id: string;
  name: string;
  category: ProblemCategory;
  severity: ProblemSeverity;
  aliases: string[];
  triggerKeywords: string[];
  symptoms: string[];
  possibleCauses: string[];
  relatedSymbols: string[];
  relatedStages: string[];
  issueQueries: string[];
  investigationSteps: string[];
  fixSuggestions: string[];
}

export interface RenderStage {
  id: string;
  name: string;
  order: number;
  description: string;
  keySymbols: string[];
  symptomHints: string[];
}

export interface DiagnosisMatch {
  pattern: ProblemPattern;
  score: number;
  matchedKeywords: string[];
}

export interface DiagnosisMetadata {
  totalTokens: number;
  truncated: boolean;
  tokenBudget: number;
}

export interface DiagnosisResult {
  query: string;
  matchedPatterns: DiagnosisMatch[];
  renderStages: RenderStage[];
  relatedSymbols: SymbolRecord[];
  relatedSource: SourceSnippet[];
  callgraph: Edge[];
  relatedIssues: IssueRecord[];
  investigationSteps: string[];
  fixSuggestions: string[];
  metadata: DiagnosisMetadata;
}

export interface DiagnosticContextPack extends DiagnosisResult {
  kind: "diagnosis";
}
```

- [ ] **Step 2: Verify exports**

Open `packages/shared/src/index.ts`. If it already has `export * from "./types.js";`, no change is needed. If it has explicit exports, add all new diagnosis type names.

- [ ] **Step 3: Run typecheck expecting success**

Run:

```bash
pnpm typecheck
```

Expected: typecheck passes or only reports pre-existing unrelated dirty-worktree errors. If there are errors from new types, fix them before continuing.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/index.ts
git commit -m "feat: add diagnosis shared types"
```

---

### Task 2: Static Knowledge Data

**Files:**

- Create: `data/problem-kb/problem-patterns.json`
- Create: `data/problem-kb/render-stages.json`
- Create: `data/evaluation/phase2a-diagnosis-cases.json`

- [ ] **Step 1: Create initial render stages**

Create `data/problem-kb/render-stages.json`:

```json
[
  {
    "id": "update_stage",
    "name": "Update Stage",
    "order": 10,
    "description": "Scene primitives and visualizers update their state and prepare render commands for the frame.",
    "keySymbols": ["Scene", "Primitive", "GroundPrimitive", "DataSourceDisplay"],
    "symptomHints": ["entity flickering", "primitive performance", "missing visual update"]
  },
  {
    "id": "command_build_stage",
    "name": "Command Build Stage",
    "order": 20,
    "description": "Primitives create DrawCommand or related command objects consumed by the renderer.",
    "keySymbols": ["DrawCommand", "Primitive", "PrimitivePipeline", "GroundPrimitive"],
    "symptomHints": ["draw command explosion", "primitive performance", "classification conflict"]
  },
  {
    "id": "depth_pass",
    "name": "Depth Pass",
    "order": 30,
    "description": "Depth values are generated or tested before color output, affecting z-fighting and depth-test behavior.",
    "keySymbols": ["Scene", "Pass", "DepthFunction", "DrawCommand"],
    "symptomHints": ["z-fighting", "depth precision", "depth test abnormal"]
  },
  {
    "id": "opaque_pass",
    "name": "Opaque Pass",
    "order": 40,
    "description": "Opaque commands are rendered with depth testing and depth writes enabled.",
    "keySymbols": ["Scene", "Pass", "DrawCommand", "RenderState"],
    "symptomHints": ["polygon flickering", "overlapping geometry", "3D Tiles jitter"]
  },
  {
    "id": "translucent_pass",
    "name": "Translucent Pass",
    "order": 50,
    "description": "Translucent commands are blended and sorted with different depth-write behavior.",
    "keySymbols": ["Scene", "Pass", "BlendingState", "RenderState"],
    "symptomHints": ["transparent flickering", "label disappears", "depth sorting"]
  },
  {
    "id": "classification_stage",
    "name": "Classification Stage",
    "order": 60,
    "description": "Classification primitives and ground primitives interact with terrain and 3D Tiles classification paths.",
    "keySymbols": ["ClassificationPrimitive", "GroundPrimitive", "Globe", "Cesium3DTileset"],
    "symptomHints": ["terrain conflict", "groundprimitive terrain", "classification artifact"]
  },
  {
    "id": "picking_stage",
    "name": "Picking Stage",
    "order": 70,
    "description": "The scene renders or evaluates pick commands to identify objects under a screen coordinate.",
    "keySymbols": ["Scene", "Picking", "PickDepth", "DrawCommand"],
    "symptomHints": ["picking failure", "wrong object picked", "pick position undefined"]
  },
  {
    "id": "tileset_traversal_stage",
    "name": "3D Tiles Traversal Stage",
    "order": 80,
    "description": "3D Tiles traversal selects, refines, and updates visible tiles before command creation.",
    "keySymbols": ["Cesium3DTileset", "Cesium3DTile", "Cesium3DTilesetTraversal"],
    "symptomHints": ["3D Tiles loading", "3D Tiles jitter", "LOD popping"]
  },
  {
    "id": "shader_compile_stage",
    "name": "Shader Compile Stage",
    "order": 90,
    "description": "Shader programs are generated, compiled, linked, and cached before draw execution.",
    "keySymbols": ["ShaderProgram", "ShaderSource", "DrawCommand"],
    "symptomHints": ["shader compile error", "custom shader failure", "material error"]
  }
]
```

- [ ] **Step 2: Create initial problem patterns**

Create `data/problem-kb/problem-patterns.json` with these 10 patterns. Keep IDs stable because tests and CLI examples use them:

```json
[
  {
    "id": "z_fighting",
    "name": "Z-Fighting",
    "category": "rendering",
    "severity": "high",
    "aliases": ["z fighting", "z-fighting", "flickering polygon", "polygon flickering", "surface flicker"],
    "triggerKeywords": ["flicker", "flickering", "zfight", "z-fighting", "overlap", "coplanar"],
    "symptoms": ["Polygon or primitive surfaces flicker when the camera moves.", "Two surfaces appear to alternate visibility."],
    "possibleCauses": ["Coplanar or nearly coplanar geometry", "Depth precision limits at large world coordinates", "Overlapping terrain and polygon surfaces"],
    "relatedSymbols": ["PolygonGeometry", "Primitive", "GroundPrimitive", "ClassificationPrimitive", "Scene"],
    "relatedStages": ["depth_pass", "opaque_pass", "classification_stage"],
    "issueQueries": ["z fighting polygon", "polygon flickering", "GroundPrimitive flicker"],
    "investigationSteps": ["Check whether two polygons or surfaces occupy the same height.", "Test with a small height offset or clamp-to-ground disabled.", "Compare behavior with GroundPrimitive versus regular Primitive.", "Inspect whether translucent rendering changes the artifact."],
    "fixSuggestions": ["Avoid coplanar geometry when possible.", "Use a height or heightReference strategy consistent with terrain.", "Prefer GroundPrimitive or ClassificationPrimitive only when terrain classification is required.", "Reduce overlapping primitives in the same region."]
  },
  {
    "id": "depth_precision",
    "name": "Depth Precision Limitation",
    "category": "rendering",
    "severity": "high",
    "aliases": ["depth precision", "depth buffer precision", "far plane flicker", "large coordinate jitter"],
    "triggerKeywords": ["depth", "precision", "far", "near", "jitter", "flicker"],
    "symptoms": ["Objects flicker or jitter more at long camera distances.", "Artifacts change when the camera near or far range changes."],
    "possibleCauses": ["Depth buffer precision is insufficient for the camera range.", "Geometry is very far from the camera or spans a large depth range."],
    "relatedSymbols": ["Scene", "Camera", "FrustumCommands", "DrawCommand"],
    "relatedStages": ["depth_pass", "opaque_pass"],
    "issueQueries": ["depth precision Cesium flicker", "logarithmic depth buffer", "far plane flicker"],
    "investigationSteps": ["Check whether artifacts increase as the camera moves farther away.", "Test with logarithmic depth buffer enabled if available.", "Reduce unnecessary far-plane distance or split geometry ranges."],
    "fixSuggestions": ["Use Cesium depth precision features appropriate for the scene.", "Avoid huge near-to-far ratios.", "Break very large geometry into better localized primitives."]
  },
  {
    "id": "terrain_conflict",
    "name": "Terrain and Ground Geometry Conflict",
    "category": "terrain",
    "severity": "high",
    "aliases": ["terrain conflict", "groundprimitive terrain", "clamp to ground flicker", "polygon terrain conflict"],
    "triggerKeywords": ["terrain", "ground", "groundprimitive", "clamp", "classification", "penetrate"],
    "symptoms": ["Ground geometry appears to sink into or float above terrain.", "Classification or clamped polygons flicker against terrain."],
    "possibleCauses": ["Terrain LOD changes alter the sampled surface.", "GroundPrimitive classification path differs from regular polygon rendering.", "Geometry height and terrain clamping are mixed inconsistently."],
    "relatedSymbols": ["GroundPrimitive", "ClassificationPrimitive", "Globe", "TerrainProvider", "PolygonGeometry"],
    "relatedStages": ["classification_stage", "depth_pass", "update_stage"],
    "issueQueries": ["GroundPrimitive terrain flicker", "clampToGround polygon terrain", "ClassificationPrimitive terrain"],
    "investigationSteps": ["Check whether the primitive is clamped to ground or has explicit height.", "Test with terrain disabled.", "Compare GroundPrimitive with regular Primitive.", "Check whether the artifact changes as terrain tiles refine."],
    "fixSuggestions": ["Use one consistent ground strategy for the geometry.", "Avoid stacking ground primitives on the same terrain surface.", "Add explicit height only when terrain clamping is not required."]
  },
  {
    "id": "primitive_performance",
    "name": "Primitive Performance Regression",
    "category": "performance",
    "severity": "high",
    "aliases": ["primitive performance", "slow primitive", "many drawcommands", "draw command explosion"],
    "triggerKeywords": ["performance", "slow", "primitive", "drawcommand", "commands", "fps"],
    "symptoms": ["Frame rate drops when many primitives or entities are visible.", "Draw command count grows unexpectedly."],
    "possibleCauses": ["Too many individual primitives create too many commands.", "Geometry is rebuilt too often.", "Appearance or render state variation prevents batching."],
    "relatedSymbols": ["Primitive", "DrawCommand", "PrimitivePipeline", "Scene", "GeometryInstance"],
    "relatedStages": ["update_stage", "command_build_stage", "opaque_pass"],
    "issueQueries": ["Primitive performance DrawCommand", "many primitives performance", "GeometryInstance batching"],
    "investigationSteps": ["Measure primitive count and draw command count.", "Check whether geometry or appearance changes every frame.", "Compare many primitives with batched GeometryInstance usage."],
    "fixSuggestions": ["Batch static geometry into fewer primitives.", "Avoid rebuilding geometry every frame.", "Reuse appearances and render states when possible."]
  },
  {
    "id": "label_visibility",
    "name": "Label Visibility Loss",
    "category": "rendering",
    "severity": "medium",
    "aliases": ["label disappears", "label missing", "billboard disappears", "text disappears"],
    "triggerKeywords": ["label", "disappear", "missing", "billboard", "text", "visibility"],
    "symptoms": ["Labels disappear at certain distances or camera angles.", "Text appears behind terrain or other geometry."],
    "possibleCauses": ["Distance display condition hides the label.", "Depth testing against terrain hides the label.", "Translucent ordering or screen-space overlap affects display."],
    "relatedSymbols": ["Label", "LabelCollection", "Billboard", "Scene", "DistanceDisplayCondition"],
    "relatedStages": ["translucent_pass", "depth_pass", "update_stage"],
    "issueQueries": ["Label disappears Cesium", "Label depth test terrain", "DistanceDisplayCondition label"],
    "investigationSteps": ["Check distance display conditions.", "Disable depth testing against terrain for comparison.", "Test with a fixed eye offset or pixel offset.", "Check whether labels are clustered or overlapped."],
    "fixSuggestions": ["Adjust distance display conditions.", "Use disableDepthTestDistance when appropriate.", "Apply eye offset or pixel offset to avoid overlap."]
  },
  {
    "id": "tiles_jitter",
    "name": "3D Tiles Jitter",
    "category": "tiles",
    "severity": "medium",
    "aliases": ["3d tiles jitter", "tileset jitter", "tile shaking", "model jitter"],
    "triggerKeywords": ["3d", "tiles", "tileset", "jitter", "shake", "shaking"],
    "symptoms": ["3D Tiles content appears to shake or shift while moving the camera.", "The artifact is stronger for large coordinates or high zoom."],
    "possibleCauses": ["Precision issues in large coordinate transforms.", "Tile refinement changes visible content.", "Model matrix or RTC center data is inconsistent."],
    "relatedSymbols": ["Cesium3DTileset", "Cesium3DTile", "Matrix4", "Camera"],
    "relatedStages": ["tileset_traversal_stage", "update_stage", "opaque_pass"],
    "issueQueries": ["3D Tiles jitter Cesium", "tileset shaking", "RTC center jitter"],
    "investigationSteps": ["Check whether jitter appears during tile refinement.", "Inspect tileset transforms and RTC center metadata.", "Compare behavior at different camera distances."],
    "fixSuggestions": ["Validate tileset transforms and bounding volumes.", "Use correct local origins for large-coordinate content.", "Tune screen-space error if jitter is refinement-related."]
  },
  {
    "id": "tiles_loading",
    "name": "3D Tiles Loading Failure",
    "category": "tiles",
    "severity": "high",
    "aliases": ["3d tiles loading", "tileset not loading", "tile load error", "tiles fail"],
    "triggerKeywords": ["tiles", "tileset", "loading", "load", "error", "failed"],
    "symptoms": ["A tileset never becomes visible.", "Tiles fail with network or content errors."],
    "possibleCauses": ["Invalid tileset URL or CORS failure.", "Invalid tileset JSON or content paths.", "Unsupported content or missing extension support."],
    "relatedSymbols": ["Cesium3DTileset", "Resource", "RequestScheduler", "Cesium3DTile"],
    "relatedStages": ["tileset_traversal_stage", "update_stage"],
    "issueQueries": ["3D Tiles loading error Cesium", "tileset not loading", "Cesium3DTileset error"],
    "investigationSteps": ["Check browser network errors.", "Open tileset JSON and referenced content paths directly.", "Inspect tileset load error events."],
    "fixSuggestions": ["Fix URL, CORS, or asset hosting errors.", "Validate tileset JSON and relative paths.", "Use supported 3D Tiles content formats."]
  },
  {
    "id": "picking_failure",
    "name": "Picking Failure",
    "category": "debug",
    "severity": "medium",
    "aliases": ["picking failure", "pick not working", "wrong object picked", "pickposition undefined"],
    "triggerKeywords": ["pick", "picking", "pickposition", "undefined", "wrong"],
    "symptoms": ["Scene picking returns undefined.", "Picking returns a different object than expected."],
    "possibleCauses": ["Object does not write pick commands.", "Depth picking is unavailable or disabled.", "Translucent or classification objects use different pick paths."],
    "relatedSymbols": ["Scene", "PickDepth", "DrawCommand", "Primitive"],
    "relatedStages": ["picking_stage", "depth_pass", "command_build_stage"],
    "issueQueries": ["Scene pick undefined", "pickPosition undefined Cesium", "picking translucent primitive"],
    "investigationSteps": ["Check whether the object is pickable.", "Test Scene.pick and Scene.pickPosition separately.", "Check depth texture support and terrain depth settings."],
    "fixSuggestions": ["Enable required depth picking options.", "Use the correct picking API for the object type.", "Avoid relying on pickPosition for unsupported paths."]
  },
  {
    "id": "shader_compile_error",
    "name": "Shader Compile Error",
    "category": "shader",
    "severity": "high",
    "aliases": ["shader compile error", "glsl error", "custom shader error", "material shader error"],
    "triggerKeywords": ["shader", "compile", "glsl", "material", "customshader", "error"],
    "symptoms": ["The console reports shader compile or link errors.", "A primitive or material fails to render after shader customization."],
    "possibleCauses": ["Invalid GLSL syntax.", "Uniform or varying mismatch.", "Shader code depends on defines not enabled for the pass."],
    "relatedSymbols": ["ShaderProgram", "ShaderSource", "Material", "CustomShader"],
    "relatedStages": ["shader_compile_stage", "command_build_stage"],
    "issueQueries": ["ShaderProgram compile error", "CustomShader compile error Cesium", "Material GLSL error"],
    "investigationSteps": ["Capture the generated shader source from the error log.", "Check uniform names and types.", "Compare the shader path for opaque and translucent passes."],
    "fixSuggestions": ["Fix GLSL syntax and type mismatches.", "Use Cesium-supported material or custom shader hooks.", "Guard pass-specific shader code with correct defines."]
  },
  {
    "id": "lod_popping",
    "name": "LOD Popping",
    "category": "tiles",
    "severity": "medium",
    "aliases": ["lod popping", "tile popping", "model popping", "terrain popping"],
    "triggerKeywords": ["lod", "popping", "tile", "refine", "sse"],
    "symptoms": ["Tiles, terrain, or models visibly pop between levels of detail.", "Visible content changes abruptly while navigating."],
    "possibleCauses": ["Screen-space error threshold is too high.", "Tile bounding volumes or geometric error values are inaccurate.", "Refinement strategy causes abrupt replacement."],
    "relatedSymbols": ["Cesium3DTileset", "Cesium3DTile", "Globe", "QuadtreePrimitive"],
    "relatedStages": ["tileset_traversal_stage", "update_stage"],
    "issueQueries": ["LOD popping Cesium", "3D Tiles screen space error popping", "terrain tile popping"],
    "investigationSteps": ["Lower maximum screen-space error and compare.", "Inspect tileset geometricError values.", "Check whether replacement refinement is causing abrupt transitions."],
    "fixSuggestions": ["Tune maximumScreenSpaceError.", "Fix tileset bounding volumes and geometric error.", "Use refinement settings appropriate for the content."]
  }
]
```

- [ ] **Step 3: Create evaluation cases**

Create `data/evaluation/phase2a-diagnosis-cases.json`:

```json
[
  { "query": "why does my polygon flicker?", "expectedPatterns": ["z_fighting"], "expectedSymbols": ["PolygonGeometry", "Primitive"] },
  { "query": "why is z-fighting happening on overlapping polygons?", "expectedPatterns": ["z_fighting", "depth_precision"], "expectedSymbols": ["PolygonGeometry"] },
  { "query": "GroundPrimitive penetrates terrain and flickers", "expectedPatterns": ["terrain_conflict"], "expectedSymbols": ["GroundPrimitive"] },
  { "query": "Primitive performance is very slow with many objects", "expectedPatterns": ["primitive_performance"], "expectedSymbols": ["Primitive", "DrawCommand"] },
  { "query": "Label disappears when camera moves", "expectedPatterns": ["label_visibility"], "expectedSymbols": ["Label", "LabelCollection"] },
  { "query": "3D Tiles jitter while zooming", "expectedPatterns": ["tiles_jitter"], "expectedSymbols": ["Cesium3DTileset"] },
  { "query": "tileset is not loading", "expectedPatterns": ["tiles_loading"], "expectedSymbols": ["Cesium3DTileset"] },
  { "query": "Scene pickPosition returns undefined", "expectedPatterns": ["picking_failure"], "expectedSymbols": ["Scene"] },
  { "query": "Custom shader compile error in material", "expectedPatterns": ["shader_compile_error"], "expectedSymbols": ["ShaderProgram"] },
  { "query": "3D Tiles LOD popping is visible", "expectedPatterns": ["lod_popping"], "expectedSymbols": ["Cesium3DTileset"] }
]
```

- [ ] **Step 4: Commit**

```bash
git add data/problem-kb/problem-patterns.json data/problem-kb/render-stages.json data/evaluation/phase2a-diagnosis-cases.json
git commit -m "feat: add phase 2a diagnosis knowledge data"
```

---

### Task 3: Diagnosis Package Scaffold and Loader

**Files:**

- Create: `packages/diagnosis/package.json`
- Create: `packages/diagnosis/tsconfig.json`
- Create: `packages/diagnosis/tsup.config.ts`
- Create: `packages/diagnosis/src/index.ts`
- Create: `packages/diagnosis/src/knowledge-loader.ts`
- Create: `packages/diagnosis/src/knowledge-loader.test.ts`

- [ ] **Step 1: Create package manifest**

Create `packages/diagnosis/package.json`:

```json
{
  "name": "@cesium-nexus/diagnosis",
  "version": "0.1.0",
  "description": "Problem diagnosis engine for cesium-nexus",
  "license": "MIT",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@cesium-nexus/shared": "workspace:*",
    "@cesium-nexus/storage": "workspace:*"
  }
}
```

- [ ] **Step 2: Create TypeScript config**

Create `packages/diagnosis/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create build config**

Create `packages/diagnosis/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
});
```

- [ ] **Step 4: Write failing loader tests**

Create `packages/diagnosis/src/knowledge-loader.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  loadProblemPatterns,
  loadRenderStages,
  validateProblemPatterns,
  validateRenderStages,
} from "./knowledge-loader.js";

describe("knowledge-loader", () => {
  it("loads bundled problem patterns", () => {
    const patterns = loadProblemPatterns();

    expect(patterns.length).toBeGreaterThanOrEqual(10);
    expect(patterns.map((p) => p.id)).toContain("z_fighting");
    expect(patterns.map((p) => p.id)).toContain("primitive_performance");
  });

  it("loads bundled render stages", () => {
    const stages = loadRenderStages();

    expect(stages.length).toBeGreaterThanOrEqual(8);
    expect(stages.map((s) => s.id)).toContain("depth_pass");
    expect(stages.map((s) => s.id)).toContain("tileset_traversal_stage");
  });

  it("rejects duplicate pattern ids", () => {
    expect(() =>
      validateProblemPatterns([
        {
          id: "x",
          name: "One",
          category: "debug",
          severity: "low",
          aliases: [],
          triggerKeywords: ["one"],
          symptoms: ["one"],
          possibleCauses: ["one"],
          relatedSymbols: ["Scene"],
          relatedStages: ["depth_pass"],
          issueQueries: ["one"],
          investigationSteps: ["one"],
          fixSuggestions: ["one"],
        },
        {
          id: "x",
          name: "Two",
          category: "debug",
          severity: "low",
          aliases: [],
          triggerKeywords: ["two"],
          symptoms: ["two"],
          possibleCauses: ["two"],
          relatedSymbols: ["Scene"],
          relatedStages: ["depth_pass"],
          issueQueries: ["two"],
          investigationSteps: ["two"],
          fixSuggestions: ["two"],
        },
      ]),
    ).toThrow("Duplicate problem pattern id: x");
  });

  it("rejects duplicate render stage ids", () => {
    expect(() =>
      validateRenderStages([
        {
          id: "depth_pass",
          name: "Depth Pass",
          order: 1,
          description: "Depth",
          keySymbols: ["Scene"],
          symptomHints: ["depth"],
        },
        {
          id: "depth_pass",
          name: "Depth Pass Again",
          order: 2,
          description: "Depth again",
          keySymbols: ["Scene"],
          symptomHints: ["depth"],
        },
      ]),
    ).toThrow("Duplicate render stage id: depth_pass");
  });
});
```

- [ ] **Step 5: Run failing test**

Run:

```bash
pnpm test packages/diagnosis/src/knowledge-loader.test.ts
```

Expected: fails because `knowledge-loader.ts` does not exist.

- [ ] **Step 6: Implement loader**

Create `packages/diagnosis/src/knowledge-loader.ts`:

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import type { ProblemPattern, RenderStage } from "@cesium-nexus/shared";

const DEFAULT_PROBLEM_PATH = path.resolve(
  process.cwd(),
  "data/problem-kb/problem-patterns.json",
);
const DEFAULT_STAGE_PATH = path.resolve(
  process.cwd(),
  "data/problem-kb/render-stages.json",
);

export function loadProblemPatterns(filePath = DEFAULT_PROBLEM_PATH): ProblemPattern[] {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as ProblemPattern[];
  return validateProblemPatterns(raw);
}

export function loadRenderStages(filePath = DEFAULT_STAGE_PATH): RenderStage[] {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as RenderStage[];
  return validateRenderStages(raw);
}

export function validateProblemPatterns(patterns: ProblemPattern[]): ProblemPattern[] {
  const seen = new Set<string>();

  for (const pattern of patterns) {
    if (seen.has(pattern.id)) {
      throw new Error(`Duplicate problem pattern id: ${pattern.id}`);
    }
    seen.add(pattern.id);

    requireNonEmpty(pattern.id, "pattern.id");
    requireNonEmpty(pattern.name, `pattern ${pattern.id}.name`);
    requireNonEmptyArray(pattern.triggerKeywords, `pattern ${pattern.id}.triggerKeywords`);
    requireNonEmptyArray(pattern.symptoms, `pattern ${pattern.id}.symptoms`);
    requireNonEmptyArray(pattern.possibleCauses, `pattern ${pattern.id}.possibleCauses`);
    requireNonEmptyArray(pattern.relatedSymbols, `pattern ${pattern.id}.relatedSymbols`);
    requireNonEmptyArray(pattern.relatedStages, `pattern ${pattern.id}.relatedStages`);
    requireNonEmptyArray(pattern.issueQueries, `pattern ${pattern.id}.issueQueries`);
    requireNonEmptyArray(pattern.investigationSteps, `pattern ${pattern.id}.investigationSteps`);
    requireNonEmptyArray(pattern.fixSuggestions, `pattern ${pattern.id}.fixSuggestions`);
  }

  return patterns;
}

export function validateRenderStages(stages: RenderStage[]): RenderStage[] {
  const seen = new Set<string>();

  for (const stage of stages) {
    if (seen.has(stage.id)) {
      throw new Error(`Duplicate render stage id: ${stage.id}`);
    }
    seen.add(stage.id);

    requireNonEmpty(stage.id, "stage.id");
    requireNonEmpty(stage.name, `stage ${stage.id}.name`);
    requireNonEmpty(stage.description, `stage ${stage.id}.description`);
    requireNonEmptyArray(stage.keySymbols, `stage ${stage.id}.keySymbols`);
    requireNonEmptyArray(stage.symptomHints, `stage ${stage.id}.symptomHints`);
  }

  return stages;
}

function requireNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing ${field}`);
  }
}

function requireNonEmptyArray(value: string[], field: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Missing ${field}`);
  }
}
```

- [ ] **Step 7: Export loader**

Create `packages/diagnosis/src/index.ts`:

```ts
export {
  loadProblemPatterns,
  loadRenderStages,
  validateProblemPatterns,
  validateRenderStages,
} from "./knowledge-loader.js";
```

- [ ] **Step 8: Run loader tests**

Run:

```bash
pnpm test packages/diagnosis/src/knowledge-loader.test.ts
```

Expected: all loader tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/diagnosis
git commit -m "feat: add diagnosis knowledge loader"
```

---

### Task 4: Deterministic Problem Matcher

**Files:**

- Create: `packages/diagnosis/src/matcher.ts`
- Create: `packages/diagnosis/src/matcher.test.ts`
- Modify: `packages/diagnosis/src/index.ts`

- [ ] **Step 1: Write failing matcher tests**

Create `packages/diagnosis/src/matcher.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadProblemPatterns } from "./knowledge-loader.js";
import { matchProblemPatterns, normalizeQuery } from "./matcher.js";

describe("matcher", () => {
  const patterns = loadProblemPatterns();

  it("normalizes useful tokens", () => {
    expect(normalizeQuery("Why is GroundPrimitive z-fighting with 3D Tiles?")).toEqual([
      "why",
      "is",
      "groundprimitive",
      "z",
      "fighting",
      "with",
      "3d",
      "tiles",
    ]);
  });

  it("matches polygon flickering to z-fighting first", () => {
    const matches = matchProblemPatterns("why does my polygon flicker?", patterns);

    expect(matches[0]?.pattern.id).toBe("z_fighting");
    expect(matches[0]?.matchedKeywords.length).toBeGreaterThan(0);
  });

  it("matches primitive performance", () => {
    const matches = matchProblemPatterns("primitive performance slow many drawcommands", patterns);

    expect(matches.map((m) => m.pattern.id)).toContain("primitive_performance");
  });

  it("matches label disappearance", () => {
    const matches = matchProblemPatterns("label disappears when camera moves", patterns);

    expect(matches[0]?.pattern.id).toBe("label_visibility");
  });

  it("does not invent diagnosis for unrelated input", () => {
    const matches = matchProblemPatterns("how do I change the application theme?", patterns);

    expect(matches).toEqual([]);
  });
});
```

- [ ] **Step 2: Run failing matcher tests**

Run:

```bash
pnpm test packages/diagnosis/src/matcher.test.ts
```

Expected: fails because matcher is not implemented.

- [ ] **Step 3: Implement matcher**

Create `packages/diagnosis/src/matcher.ts`:

```ts
import type { DiagnosisMatch, ProblemPattern } from "@cesium-nexus/shared";

const MIN_SCORE = 4;

export function normalizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/z-fighting/g, "z fighting")
    .replace(/3d tiles/g, "3d tiles")
    .match(/[a-z0-9]+/g) ?? [];
}

export function matchProblemPatterns(
  query: string,
  patterns: ProblemPattern[],
  limit = 5,
): DiagnosisMatch[] {
  const tokens = normalizeQuery(query);
  const tokenSet = new Set(tokens);
  const normalizedQuery = tokens.join(" ");

  const matches = patterns
    .map((pattern) => scorePattern(pattern, normalizedQuery, tokenSet))
    .filter((match) => match.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.pattern.id.localeCompare(b.pattern.id))
    .slice(0, limit);

  return matches;
}

function scorePattern(
  pattern: ProblemPattern,
  normalizedQuery: string,
  tokenSet: Set<string>,
): DiagnosisMatch {
  let score = 0;
  const matchedKeywords = new Set<string>();

  for (const alias of pattern.aliases) {
    const normalizedAlias = normalizeQuery(alias).join(" ");
    if (normalizedAlias && normalizedQuery.includes(normalizedAlias)) {
      score += 8;
      matchedKeywords.add(alias);
    }
  }

  for (const keyword of pattern.triggerKeywords) {
    const keywordTokens = normalizeQuery(keyword);
    if (keywordTokens.length > 0 && keywordTokens.every((token) => tokenSet.has(token))) {
      score += 4;
      matchedKeywords.add(keyword);
    }
  }

  for (const symptom of pattern.symptoms) {
    const symptomTokens = normalizeQuery(symptom);
    const hits = symptomTokens.filter((token) => tokenSet.has(token)).length;
    if (hits >= 2) {
      score += Math.min(6, hits);
      matchedKeywords.add(symptom);
    }
  }

  for (const symbol of pattern.relatedSymbols) {
    const symbolTokens = normalizeQuery(symbol);
    if (symbolTokens.length > 0 && symbolTokens.every((token) => tokenSet.has(token))) {
      score += 2;
      matchedKeywords.add(symbol);
    }
  }

  if (tokenSet.has(pattern.category)) {
    score += 1;
    matchedKeywords.add(pattern.category);
  }

  return {
    pattern,
    score,
    matchedKeywords: [...matchedKeywords],
  };
}
```

- [ ] **Step 4: Export matcher**

Add to `packages/diagnosis/src/index.ts`:

```ts
export { matchProblemPatterns, normalizeQuery } from "./matcher.js";
```

- [ ] **Step 5: Run matcher tests**

Run:

```bash
pnpm test packages/diagnosis/src/matcher.test.ts
```

Expected: matcher tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/diagnosis/src/matcher.ts packages/diagnosis/src/matcher.test.ts packages/diagnosis/src/index.ts
git commit -m "feat: match cesium problem patterns"
```

---

### Task 5: Diagnostic Pack Token Budget

**Files:**

- Create: `packages/diagnosis/src/token-budget.ts`
- Create: `packages/diagnosis/src/token-budget.test.ts`
- Modify: `packages/diagnosis/src/index.ts`

- [ ] **Step 1: Write failing budget tests**

Create `packages/diagnosis/src/token-budget.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { DiagnosticContextPack } from "@cesium-nexus/shared";
import { estimateDiagnosticTokens, truncateDiagnosticPack } from "./token-budget.js";

describe("diagnosis token budget", () => {
  it("estimates tokens", () => {
    expect(estimateDiagnosticTokens(makePack())).toBeGreaterThan(0);
  });

  it("preserves core diagnosis fields under small budgets", () => {
    const pack = truncateDiagnosticPack(makePack(), 300);

    expect(pack.kind).toBe("diagnosis");
    expect(pack.matchedPatterns.length).toBe(1);
    expect(pack.relatedSymbols.length).toBe(1);
    expect(pack.investigationSteps.length).toBeGreaterThan(0);
    expect(pack.fixSuggestions.length).toBeGreaterThan(0);
    expect(pack.metadata.truncated).toBe(true);
    expect(pack.metadata.tokenBudget).toBe(300);
  });

  it("does not mark small packs truncated when they fit", () => {
    const pack = truncateDiagnosticPack(makePack(), 6000);

    expect(pack.metadata.truncated).toBe(false);
  });
});

function makePack(): DiagnosticContextPack {
  return {
    kind: "diagnosis",
    query: "polygon flickering",
    matchedPatterns: [
      {
        pattern: {
          id: "z_fighting",
          name: "Z-Fighting",
          category: "rendering",
          severity: "high",
          aliases: ["z fighting"],
          triggerKeywords: ["flicker"],
          symptoms: ["Polygon flickers"],
          possibleCauses: ["Coplanar geometry", "Depth precision"],
          relatedSymbols: ["Primitive"],
          relatedStages: ["depth_pass"],
          issueQueries: ["z fighting"],
          investigationSteps: ["Check overlap"],
          fixSuggestions: ["Avoid coplanar surfaces"],
        },
        score: 10,
        matchedKeywords: ["flicker"],
      },
    ],
    renderStages: [
      {
        id: "depth_pass",
        name: "Depth Pass",
        order: 1,
        description: "x".repeat(2000),
        keySymbols: ["Scene"],
        symptomHints: ["flicker"],
      },
    ],
    relatedSymbols: [
      {
        id: "primitive",
        name: "Primitive",
        kind: "class",
        filePath: "packages/engine/Source/Scene/Primitive.js",
        startLine: 1,
        endLine: 2,
        exports: [],
        imports: [],
      },
    ],
    relatedSource: [
      {
        symbol: "Primitive",
        file: "Primitive.js",
        lineStart: 1,
        lineEnd: 2,
        code: "x".repeat(4000),
      },
    ],
    callgraph: Array.from({ length: 100 }, (_, index) => ({
      source: `A${index}`,
      target: `B${index}`,
    })),
    relatedIssues: [
      {
        id: 1,
        repo: "CesiumGS/cesium",
        number: 1,
        title: "Polygon flicker",
        body: "x".repeat(4000),
        state: "closed",
        labels: [],
        assignees: [],
        author: "user",
        comments: 0,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
        closedAt: "2024-01-02T00:00:00Z",
        htmlUrl: "https://github.com/CesiumGS/cesium/issues/1",
      },
    ],
    investigationSteps: ["Check overlap", "Test terrain disabled"],
    fixSuggestions: ["Avoid coplanar surfaces", "Use a consistent ground strategy"],
    metadata: {
      totalTokens: 0,
      truncated: false,
      tokenBudget: 6000,
    },
  };
}
```

- [ ] **Step 2: Run failing budget tests**

Run:

```bash
pnpm test packages/diagnosis/src/token-budget.test.ts
```

Expected: fails because `token-budget.ts` does not exist.

- [ ] **Step 3: Implement budget module**

Create `packages/diagnosis/src/token-budget.ts`:

```ts
import type { DiagnosticContextPack, IssueRecord, SourceSnippet } from "@cesium-nexus/shared";

export function estimateDiagnosticTokens(pack: DiagnosticContextPack): number {
  return estimateText(JSON.stringify({
    kind: pack.kind,
    query: pack.query,
    matchedPatterns: pack.matchedPatterns,
    renderStages: pack.renderStages,
    relatedSymbols: pack.relatedSymbols,
    callgraph: pack.callgraph,
    investigationSteps: pack.investigationSteps,
    fixSuggestions: pack.fixSuggestions,
  })) + pack.relatedSource.reduce((sum, source) => sum + estimateText(source.code) + 20, 0)
    + pack.relatedIssues.reduce((sum, issue) => sum + estimateText(issue.title) + estimateText(issue.body) + 30, 0);
}

export function truncateDiagnosticPack(
  pack: DiagnosticContextPack,
  budget = 6000,
): DiagnosticContextPack {
  let next: DiagnosticContextPack = {
    ...pack,
    relatedSource: [...pack.relatedSource],
    relatedIssues: [...pack.relatedIssues],
    callgraph: [...pack.callgraph],
    renderStages: pack.renderStages.map((stage) => ({ ...stage })),
    fixSuggestions: [...pack.fixSuggestions],
    investigationSteps: [...pack.investigationSteps],
  };
  let truncated = false;

  if (estimateDiagnosticTokens(next) > budget) {
    truncated = true;
    next = { ...next, relatedSource: trimSource(next.relatedSource, 1600) };
  }
  if (estimateDiagnosticTokens(next) > budget) {
    next = { ...next, relatedIssues: trimIssues(next.relatedIssues, 1200) };
  }
  if (estimateDiagnosticTokens(next) > budget) {
    const edges = [...next.callgraph];
    while (edges.length > 20 && estimateDiagnosticTokens({ ...next, callgraph: edges }) > budget) {
      edges.pop();
    }
    next = { ...next, callgraph: edges };
  }
  if (estimateDiagnosticTokens(next) > budget) {
    next = {
      ...next,
      renderStages: next.renderStages.map((stage) => ({
        ...stage,
        description: truncateText(stage.description, 80),
      })),
    };
  }
  if (estimateDiagnosticTokens(next) > budget && next.fixSuggestions.length > 3) {
    next = { ...next, fixSuggestions: next.fixSuggestions.slice(0, 3) };
  }
  if (estimateDiagnosticTokens(next) > budget && next.investigationSteps.length > 3) {
    next = { ...next, investigationSteps: next.investigationSteps.slice(0, 3) };
  }

  const totalTokens = estimateDiagnosticTokens(next);

  return {
    ...next,
    metadata: {
      totalTokens,
      truncated,
      tokenBudget: budget,
    },
  };
}

function trimSource(sources: SourceSnippet[], maxTokensPerSource: number): SourceSnippet[] {
  return sources.slice(0, 3).map((source) => ({
    ...source,
    code: truncateText(source.code, maxTokensPerSource),
  }));
}

function trimIssues(issues: IssueRecord[], maxTokensPerIssue: number): IssueRecord[] {
  return issues.slice(0, 5).map((issue) => ({
    ...issue,
    body: truncateText(issue.body, maxTokensPerIssue),
  }));
}

function truncateText(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... [truncated]`;
}

function estimateText(text: string): number {
  return Math.ceil(text.length / 4);
}
```

- [ ] **Step 4: Export budget helpers**

Add to `packages/diagnosis/src/index.ts`:

```ts
export {
  estimateDiagnosticTokens,
  truncateDiagnosticPack,
} from "./token-budget.js";
```

- [ ] **Step 5: Run budget tests**

Run:

```bash
pnpm test packages/diagnosis/src/token-budget.test.ts
```

Expected: budget tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/diagnosis/src/token-budget.ts packages/diagnosis/src/token-budget.test.ts packages/diagnosis/src/index.ts
git commit -m "feat: add diagnostic pack token budget"
```

---

### Task 6: Diagnosis Assembly

**Files:**

- Create: `packages/diagnosis/src/diagnoser.ts`
- Create: `packages/diagnosis/src/diagnoser.test.ts`
- Modify: `packages/diagnosis/src/index.ts`

- [ ] **Step 1: Write failing diagnoser tests**

Create `packages/diagnosis/src/diagnoser.test.ts` with in-memory SQLite repos:

```ts
import { describe, expect, it } from "vitest";
import { openDatabase, initSchema, SymbolRepo, IssueRepo, CallGraphRepo } from "@cesium-nexus/storage";
import type { CallEdge, IssueRecord, SymbolRecord } from "@cesium-nexus/shared";
import { diagnoseProblem, queryRenderStages } from "./diagnoser.js";
import { loadProblemPatterns, loadRenderStages } from "./knowledge-loader.js";

describe("diagnoser", () => {
  it("assembles a diagnostic pack for polygon flickering", () => {
    const repos = makeRepos();
    const result = diagnoseProblem(repos.symbolRepo, repos.callGraphRepo, repos.issueRepo, {
      query: "why does my polygon flicker?",
      patterns: loadProblemPatterns(),
      stages: loadRenderStages(),
      tokenBudget: 6000,
    });

    expect(result.kind).toBe("diagnosis");
    expect(result.matchedPatterns[0]?.pattern.id).toBe("z_fighting");
    expect(result.renderStages.map((s) => s.id)).toContain("depth_pass");
    expect(result.relatedSymbols.map((s) => s.name)).toContain("Primitive");
    expect(result.relatedSource.length).toBeGreaterThan(0);
    expect(result.callgraph.length).toBeGreaterThan(0);
    expect(result.relatedIssues.length).toBeGreaterThan(0);
    expect(result.investigationSteps.length).toBeGreaterThan(0);
    expect(result.fixSuggestions.length).toBeGreaterThan(0);
    repos.db.close();
  });

  it("returns empty diagnosis without inventing a match", () => {
    const repos = makeRepos();
    const result = diagnoseProblem(repos.symbolRepo, repos.callGraphRepo, repos.issueRepo, {
      query: "how do I change app theme?",
      patterns: loadProblemPatterns(),
      stages: loadRenderStages(),
    });

    expect(result.matchedPatterns).toEqual([]);
    expect(result.relatedSymbols).toEqual([]);
    expect(result.investigationSteps).toEqual([]);
    repos.db.close();
  });

  it("queries stages by problem id and stage id", () => {
    const patterns = loadProblemPatterns();
    const stages = loadRenderStages();

    expect(queryRenderStages({ problemId: "z_fighting", patterns, stages }).map((s) => s.id)).toContain("depth_pass");
    expect(queryRenderStages({ stageId: "depth_pass", patterns, stages }).map((s) => s.id)).toEqual(["depth_pass"]);
  });
});

function makeRepos() {
  const db = openDatabase(":memory:");
  initSchema(db);
  const symbolRepo = new SymbolRepo(db);
  const issueRepo = new IssueRepo(db);
  const callGraphRepo = new CallGraphRepo(db);

  const symbols: SymbolRecord[] = [
    symbol("primitive", "Primitive"),
    symbol("polygon", "PolygonGeometry"),
    symbol("draw", "DrawCommand"),
    symbol("scene", "Scene"),
  ];
  symbolRepo.insertMany(symbols);
  symbolRepo.insertSourceFts(symbols.map((s) => ({
    symbolId: s.id,
    name: s.name,
    filePath: s.filePath,
    startLine: s.startLine,
    endLine: s.endLine,
    code: `export class ${s.name} { update() { return "source"; } }`,
  })));

  const edges: CallEdge[] = [
    {
      sourceId: "primitive",
      targetId: "draw",
      sourceName: "Primitive",
      targetName: "DrawCommand",
      edgeType: "construct",
    },
  ];
  callGraphRepo.insertEdges(edges);

  const issue: IssueRecord = {
    id: 1,
    repo: "CesiumGS/cesium",
    number: 1,
    title: "Polygon flickering caused by z fighting",
    body: "A polygon flickers when it overlaps another surface.",
    state: "closed",
    labels: ["bug"],
    assignees: [],
    author: "user",
    comments: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
    closedAt: "2024-01-02T00:00:00Z",
    htmlUrl: "https://github.com/CesiumGS/cesium/issues/1",
  };
  issueRepo.upsertMany([issue]);

  return { db, symbolRepo, issueRepo, callGraphRepo };
}

function symbol(id: string, name: string): SymbolRecord {
  return {
    id,
    name,
    kind: "class",
    filePath: `packages/engine/Source/${name}.js`,
    startLine: 1,
    endLine: 10,
    exports: [],
    imports: [],
  };
}
```

- [ ] **Step 2: Run failing diagnoser tests**

Run:

```bash
pnpm test packages/diagnosis/src/diagnoser.test.ts
```

Expected: fails because `diagnoser.ts` does not exist.

- [ ] **Step 3: Implement diagnoser**

Create `packages/diagnosis/src/diagnoser.ts`:

```ts
import type {
  DiagnosticContextPack,
  Edge,
  IssueRecord,
  ProblemPattern,
  RenderStage,
  SourceSnippet,
  SymbolRecord,
} from "@cesium-nexus/shared";
import type { CallGraphRepo, IssueRepo, SymbolRepo } from "@cesium-nexus/storage";
import { resolveSymbolId } from "@cesium-nexus/storage";
import { matchProblemPatterns } from "./matcher.js";
import { truncateDiagnosticPack } from "./token-budget.js";

export interface DiagnoseOptions {
  query: string;
  patterns: ProblemPattern[];
  stages: RenderStage[];
  limit?: number;
  depth?: number;
  issueLimit?: number;
  tokenBudget?: number;
}

export function diagnoseProblem(
  symbolRepo: SymbolRepo,
  callGraphRepo: CallGraphRepo,
  issueRepo: IssueRepo,
  options: DiagnoseOptions,
): DiagnosticContextPack {
  const matches = matchProblemPatterns(options.query, options.patterns, options.limit ?? 5);

  if (matches.length === 0) {
    return truncateDiagnosticPack({
      kind: "diagnosis",
      query: options.query,
      matchedPatterns: [],
      renderStages: [],
      relatedSymbols: [],
      relatedSource: [],
      callgraph: [],
      relatedIssues: [],
      investigationSteps: [],
      fixSuggestions: [],
      metadata: { totalTokens: 0, truncated: false, tokenBudget: options.tokenBudget ?? 6000 },
    }, options.tokenBudget ?? 6000);
  }

  const relatedStages = collectStages(matches.flatMap((m) => m.pattern.relatedStages), options.stages);
  const relatedSymbols = collectSymbols(matches.flatMap((m) => m.pattern.relatedSymbols), symbolRepo);
  const relatedSource = collectSource(relatedSymbols, symbolRepo);
  const callgraph = collectCallgraph(relatedSymbols, callGraphRepo, options.depth ?? 2);
  const relatedIssues = collectIssues(matches.flatMap((m) => m.pattern.issueQueries), issueRepo, options.issueLimit ?? 5);
  const investigationSteps = unique(matches.flatMap((m) => m.pattern.investigationSteps));
  const fixSuggestions = unique(matches.flatMap((m) => m.pattern.fixSuggestions));

  return truncateDiagnosticPack({
    kind: "diagnosis",
    query: options.query,
    matchedPatterns: matches,
    renderStages: relatedStages,
    relatedSymbols,
    relatedSource,
    callgraph,
    relatedIssues,
    investigationSteps,
    fixSuggestions,
    metadata: { totalTokens: 0, truncated: false, tokenBudget: options.tokenBudget ?? 6000 },
  }, options.tokenBudget ?? 6000);
}

export function queryRenderStages(options: {
  stageId?: string;
  problemId?: string;
  patterns: ProblemPattern[];
  stages: RenderStage[];
}): RenderStage[] {
  if (options.stageId) {
    const exactStage = options.stages.filter((stage) => stage.id === options.stageId);
    if (exactStage.length > 0 || !options.problemId) {
      return exactStage;
    }
  }

  if (options.problemId) {
    const pattern = options.patterns.find((item) => item.id === options.problemId);
    if (!pattern) return [];
    return collectStages(pattern.relatedStages, options.stages);
  }

  return [...options.stages].sort((a, b) => a.order - b.order);
}

function collectStages(ids: string[], stages: RenderStage[]): RenderStage[] {
  const idSet = new Set(ids);
  return stages.filter((stage) => idSet.has(stage.id)).sort((a, b) => a.order - b.order);
}

function collectSymbols(names: string[], symbolRepo: SymbolRepo): SymbolRecord[] {
  const records: SymbolRecord[] = [];
  const seen = new Set<string>();

  for (const name of unique(names)) {
    const resolved = resolveSymbolId(name, symbolRepo);
    if (!resolved || seen.has(resolved.id)) continue;
    const record = symbolRepo.findById(resolved.id);
    if (!record) continue;
    seen.add(record.id);
    records.push(record);
  }

  return records;
}

function collectSource(symbols: SymbolRecord[], symbolRepo: SymbolRepo): SourceSnippet[] {
  return symbols.flatMap((symbol) => {
    const source = symbolRepo.getSourceBySymbolId(symbol.id);
    if (!source) return [];
    return [{
      symbol: symbol.parentClass ? `${symbol.parentClass}.${symbol.name}` : symbol.name,
      file: source.filePath,
      lineStart: source.startLine,
      lineEnd: source.endLine,
      code: source.code,
    }];
  });
}

function collectCallgraph(symbols: SymbolRecord[], callGraphRepo: CallGraphRepo, depth: number): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();

  for (const symbol of symbols.slice(0, 3)) {
    for (const edge of callGraphRepo.getDownstream(symbol.id, depth)) {
      const key = `${edge.sourceName}->${edge.targetName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: edge.sourceName, target: edge.targetName });
    }
  }

  return edges;
}

function collectIssues(queries: string[], issueRepo: IssueRepo, limit: number): IssueRecord[] {
  const issues: IssueRecord[] = [];
  const seen = new Set<number>();

  for (const query of unique(queries)) {
    for (const result of issueRepo.searchFts(query, { limit, state: "closed" })) {
      if (seen.has(result.issue.id)) continue;
      seen.add(result.issue.id);
      issues.push(result.issue);
      if (issues.length >= limit) return issues;
    }
  }

  return issues;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
```

- [ ] **Step 4: Export diagnoser**

Add to `packages/diagnosis/src/index.ts`:

```ts
export {
  diagnoseProblem,
  queryRenderStages,
  type DiagnoseOptions,
} from "./diagnoser.js";
```

- [ ] **Step 5: Run diagnosis package tests**

Run:

```bash
pnpm test packages/diagnosis/src
```

Expected: all diagnosis tests pass.

- [ ] **Step 6: Run build**

Run:

```bash
pnpm --filter @cesium-nexus/diagnosis build
```

Expected: diagnosis package builds.

- [ ] **Step 7: Commit**

```bash
git add packages/diagnosis
git commit -m "feat: assemble diagnostic context packs"
```

---

### Task 7: CLI Diagnosis Commands

**Files:**

- Create: `packages/cli/src/commands/diagnose-cmd.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/package.json`
- Test: `packages/cli/src/e2e-cli.test.ts` or new `packages/cli/src/diagnose-cli.test.ts`

- [ ] **Step 1: Add CLI dependency**

In `packages/cli/package.json`, add:

```json
"@cesium-nexus/diagnosis": "workspace:*"
```

inside `dependencies`.

- [ ] **Step 2: Write CLI command module**

Create `packages/cli/src/commands/diagnose-cmd.ts`:

```ts
import type { Command } from "commander";
import {
  openDatabase,
  initSchema,
  SymbolRepo,
  IssueRepo,
  CallGraphRepo,
} from "@cesium-nexus/storage";
import {
  diagnoseProblem,
  loadProblemPatterns,
  loadRenderStages,
  queryRenderStages,
} from "@cesium-nexus/diagnosis";
import * as path from "node:path";

export function registerDiagnoseCommands(program: Command): void {
  program
    .command("diagnose <problem...>")
    .description("Diagnose a Cesium rendering or runtime problem")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .option("--limit <n>", "Max matched problem patterns", "5")
    .option("--budget <n>", "Token budget", "6000")
    .action((problem: string[], opts: { db: string; limit: string; budget: string }) => {
      const limit = parsePositiveInt(opts.limit, "--limit");
      const budget = parsePositiveInt(opts.budget, "--budget");
      const db = openDatabase(path.resolve(opts.db));
      initSchema(db);

      const result = diagnoseProblem(
        new SymbolRepo(db),
        new CallGraphRepo(db),
        new IssueRepo(db),
        {
          query: problem.join(" "),
          patterns: loadProblemPatterns(),
          stages: loadRenderStages(),
          limit,
          tokenBudget: budget,
        },
      );

      printDiagnosis(result);
      db.close();
    });

  const pkb = program.command("pkb").description("Problem KB utilities");
  pkb
    .command("list")
    .description("List known problem patterns")
    .action(() => {
      for (const pattern of loadProblemPatterns()) {
        console.log(`${pattern.id}\t${pattern.category}\t${pattern.name}\t${pattern.aliases.join(", ")}`);
      }
    });

  program
    .command("stage <id>")
    .description("Show render stages by stage id or problem id")
    .action((id: string) => {
      const patterns = loadProblemPatterns();
      const stages = loadRenderStages();
      const result = queryRenderStages({
        stageId: id,
        problemId: id,
        patterns,
        stages,
      });

      if (result.length === 0) {
        console.log(`No render stages found for: ${id}`);
        return;
      }

      for (const stage of result) {
        console.log(`\n${stage.id}: ${stage.name}`);
        console.log(stage.description);
        console.log(`key symbols: ${stage.keySymbols.join(", ")}`);
        console.log(`symptom hints: ${stage.symptomHints.join(", ")}`);
      }
    });
}

function parsePositiveInt(value: string, label: string): number {
  const parsed = parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.error(`Error: ${label} must be a positive integer`);
    process.exit(1);
  }
  return parsed;
}

function printDiagnosis(result: ReturnType<typeof diagnoseProblem>): void {
  console.log(`\nDiagnosis for: ${result.query}\n`);
  console.log("Possible Causes");
  for (const cause of [...new Set(result.matchedPatterns.flatMap((match) => match.pattern.possibleCauses))]) {
    console.log(`- ${cause}`);
  }
  console.log("\nRender Stages");
  for (const stage of result.renderStages) {
    console.log(`- ${stage.name} (${stage.id})`);
  }
  console.log("\nRelated Symbols");
  for (const symbol of result.relatedSymbols) {
    console.log(`- ${symbol.parentClass ? `${symbol.parentClass}.` : ""}${symbol.name} (${symbol.filePath}:${symbol.startLine})`);
  }
  console.log("\nRelated Source");
  for (const source of result.relatedSource.slice(0, 5)) {
    console.log(`- ${source.symbol} (${source.file}:${source.lineStart}-${source.lineEnd})`);
  }
  console.log("\nRelated Issues");
  for (const issue of result.relatedIssues) {
    console.log(`- #${issue.number} ${issue.title} ${issue.htmlUrl}`);
  }
  console.log("\nInvestigation Steps");
  for (const step of result.investigationSteps) {
    console.log(`- ${step}`);
  }
  console.log("\nPossible Fixes");
  for (const fix of result.fixSuggestions) {
    console.log(`- ${fix}`);
  }
}
```

- [ ] **Step 3: Register CLI commands**

Modify `packages/cli/src/index.ts`:

```ts
import { registerDiagnoseCommands } from "./commands/diagnose-cmd.js";
```

and add after `registerContextCommand(program);`:

```ts
registerDiagnoseCommands(program);
```

- [ ] **Step 4: Add CLI test**

Add tests to the existing CLI E2E file, or create `packages/cli/src/diagnose-cli.test.ts` using the existing CLI test style. Cover:

```ts
expect(output).toContain("Possible Causes");
expect(output).toContain("Render Stages");
expect(output).toContain("Related Symbols");
expect(output).toContain("Investigation Steps");
expect(output).toContain("Possible Fixes");
```

For `pkb list`, assert output contains `z_fighting`.

For `stage z_fighting`, assert output contains `Depth Pass`.

- [ ] **Step 5: Run CLI tests**

Run:

```bash
pnpm test packages/cli/src
```

Expected: CLI tests pass. If database-backed `diagnose` cannot run in CI, follow existing E2E skip behavior for missing DB and keep `pkb list` / `stage` always tested.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/package.json packages/cli/src/index.ts packages/cli/src/commands/diagnose-cmd.ts packages/cli/src/e2e-cli.test.ts packages/cli/src/diagnose-cli.test.ts
git commit -m "feat: add diagnosis cli commands"
```

---

### Task 8: MCP Diagnosis Tools

**Files:**

- Modify: `packages/mcp/package.json`
- Modify: `packages/mcp/src/handlers.ts`
- Modify: `packages/mcp/src/handlers.test.ts`
- Modify: `packages/mcp/src/server.ts`
- Modify: `packages/mcp/src/server.test.ts`
- Modify: `packages/mcp/src/e2e-stdio.test.ts`

- [ ] **Step 1: Add MCP dependency**

In `packages/mcp/package.json`, add:

```json
"@cesium-nexus/diagnosis": "workspace:*"
```

inside `dependencies`.

- [ ] **Step 2: Write failing handler tests**

Add tests in `packages/mcp/src/handlers.test.ts`:

```ts
describe("handleDiagnoseProblem", () => {
  it("returns a diagnostic pack", async () => {
    const result = await handleDiagnoseProblem(symbolRepo, callGraphRepo, issueRepo, {
      problem: "polygon flickering",
      limit: 5,
      budget: 6000,
    });

    expect(result.success).toBe(true);
    expect((result.data as { kind: string }).kind).toBe("diagnosis");
  });
});

describe("handleQueryRenderStage", () => {
  it("returns stages for problem id", async () => {
    const result = await handleQueryRenderStage({ problemId: "z_fighting" });

    expect(result.success).toBe(true);
    expect((result.data as { stages: unknown[] }).stages.length).toBeGreaterThan(0);
  });
});
```

Use the existing test fixtures in `handlers.test.ts` for repos.

- [ ] **Step 3: Implement handlers**

Modify `packages/mcp/src/handlers.ts` imports:

```ts
import {
  diagnoseProblem,
  loadProblemPatterns,
  loadRenderStages,
  queryRenderStages,
} from "@cesium-nexus/diagnosis";
```

Add:

```ts
export async function handleDiagnoseProblem(
  symbolRepo: SymbolRepo,
  callGraphRepo: CallGraphRepo,
  issueRepo: IssueRepo,
  input: { problem: string; limit?: number; budget?: number },
): Promise<ToolResponse> {
  try {
    const result = diagnoseProblem(symbolRepo, callGraphRepo, issueRepo, {
      query: input.problem,
      patterns: loadProblemPatterns(),
      stages: loadRenderStages(),
      limit: input.limit,
      tokenBudget: input.budget,
    });

    return { success: true, data: result };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function handleQueryRenderStage(input: {
  stageId?: string;
  problemId?: string;
}): Promise<ToolResponse> {
  try {
    const stages = queryRenderStages({
      stageId: input.stageId,
      problemId: input.problemId,
      patterns: loadProblemPatterns(),
      stages: loadRenderStages(),
    });

    return { success: true, data: { stages } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
```

- [ ] **Step 4: Register MCP tools**

Modify imports in `packages/mcp/src/server.ts`:

```ts
handleDiagnoseProblem,
handleQueryRenderStage,
```

Then add tools after `build_context_pack`:

```ts
server.tool(
  "diagnose_problem",
  "Diagnose a Cesium rendering or runtime problem and return a Diagnostic Context Pack.",
  {
    problem: z.string().min(1),
    limit: z.number().int().min(1).max(10).default(5),
    budget: z.number().int().min(100).default(6000),
  },
  async (input) => {
    const result = await handleDiagnoseProblem(
      symbolRepo,
      callGraphRepo,
      issueRepo,
      input,
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      isError: !result.success,
    };
  },
);

server.tool(
  "query_render_stage",
  "Return diagnosis-oriented render stage records by stage id or problem id.",
  {
    stageId: z.string().min(1).optional(),
    problemId: z.string().min(1).optional(),
  },
  async (input) => {
    const result = await handleQueryRenderStage(input);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      isError: !result.success,
    };
  },
);
```

Update comments that say "5 tools" to "7 tools".

- [ ] **Step 5: Update MCP server tests**

In `packages/mcp/src/server.test.ts`, update tool count expectations to 7 and assert names include:

```ts
expect(toolNames).toContain("diagnose_problem");
expect(toolNames).toContain("query_render_stage");
```

Add a `client.callTool` test for `query_render_stage` using `{ problemId: "z_fighting" }`.

Add a `client.callTool` test for `diagnose_problem` using `{ problem: "polygon flickering" }`.

- [ ] **Step 6: Update stdio E2E test**

In `packages/mcp/src/e2e-stdio.test.ts`, update expected tool count and assert the two new tool names are listed.

- [ ] **Step 7: Run MCP tests**

Run:

```bash
pnpm test packages/mcp/src/handlers.test.ts packages/mcp/src/server.test.ts packages/mcp/src/e2e-stdio.test.ts
```

Expected: MCP tests pass and stdio output remains clean JSON-RPC.

- [ ] **Step 8: Commit**

```bash
git add packages/mcp/package.json packages/mcp/src/handlers.ts packages/mcp/src/handlers.test.ts packages/mcp/src/server.ts packages/mcp/src/server.test.ts packages/mcp/src/e2e-stdio.test.ts
git commit -m "feat: expose diagnosis mcp tools"
```

---

### Task 9: Evaluation Dataset Tests

**Files:**

- Create: `packages/diagnosis/src/evaluation.test.ts`

- [ ] **Step 1: Write evaluation test**

Create `packages/diagnosis/src/evaluation.test.ts`:

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { loadProblemPatterns } from "./knowledge-loader.js";
import { matchProblemPatterns } from "./matcher.js";

interface EvalCase {
  query: string;
  expectedPatterns: string[];
  expectedSymbols: string[];
}

describe("phase 2a diagnosis evaluation cases", () => {
  const cases = JSON.parse(
    fs.readFileSync(
      path.resolve(process.cwd(), "data/evaluation/phase2a-diagnosis-cases.json"),
      "utf8",
    ),
  ) as EvalCase[];
  const patterns = loadProblemPatterns();

  it("has at least 10 cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  for (const item of cases) {
    it(`matches expected pattern for: ${item.query}`, () => {
      const matches = matchProblemPatterns(item.query, patterns);
      const matchedIds = matches.map((match) => match.pattern.id);

      expect(matchedIds.some((id) => item.expectedPatterns.includes(id))).toBe(true);

      const relatedSymbols = new Set(matches.flatMap((match) => match.pattern.relatedSymbols));
      expect(item.expectedSymbols.some((symbol) => relatedSymbols.has(symbol))).toBe(true);
    });
  }
});
```

- [ ] **Step 2: Run evaluation tests**

Run:

```bash
pnpm test packages/diagnosis/src/evaluation.test.ts
```

Expected: all evaluation cases pass. If a case fails, update pattern aliases or trigger keywords, not test expectations, unless the expectation conflicts with the approved spec.

- [ ] **Step 3: Commit**

```bash
git add packages/diagnosis/src/evaluation.test.ts data/evaluation/phase2a-diagnosis-cases.json data/problem-kb/problem-patterns.json
git commit -m "test: add phase 2a diagnosis evaluation cases"
```

---

### Task 10: Documentation Updates

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `future-roadmap.md`

- [ ] **Step 1: Update README current stage**

Change current stage to Phase 2A in `README.md`:

```markdown
**Current stage:** v0.2.0 Phase 2A - Problem Diagnosis
```

- [ ] **Step 2: Add CLI examples**

Add:

```bash
cesium diagnose "why does my polygon flicker?"
cesium pkb list
cesium stage z_fighting
```

- [ ] **Step 3: Add MCP tools to README**

Add rows:

```markdown
| `diagnose_problem` | `{ problem, limit?, budget? }` | Diagnostic Context Pack with causes, stages, symbols, source, issues, investigation steps, fixes |
| `query_render_stage` | `{ stageId? problemId? }` | Diagnosis-oriented render stage records |
```

- [ ] **Step 4: Add changelog entry**

Add:

```markdown
## v0.2.0 (Unreleased)

### Added

- Phase 2A Problem Diagnosis with static Problem KB and diagnosis-oriented render stage mapping
- `@cesium-nexus/diagnosis` package for deterministic problem matching and Diagnostic Context Pack assembly
- CLI commands: `cesium diagnose`, `cesium pkb list`, `cesium stage`
- MCP tools: `diagnose_problem`, `query_render_stage`
- Phase 2A evaluation dataset covering 10 common Cesium debugging problems
```

- [ ] **Step 5: Update roadmap**

In `future-roadmap.md`, mark Phase 2A as split from the broader Phase 2 plan. State that Forum crawler, Experience Graph, and semantic retrieval remain in Phase 2B/2C.

- [ ] **Step 6: Commit**

```bash
git add README.md CHANGELOG.md future-roadmap.md
git commit -m "docs: document phase 2a diagnosis workflow"
```

---

### Task 11: Full Verification

**Files:**

- No code changes unless verification exposes a bug.

- [ ] **Step 1: Run diagnosis tests**

Run:

```bash
pnpm test packages/diagnosis/src
```

Expected: all diagnosis tests pass.

- [ ] **Step 2: Run MCP and CLI focused tests**

Run:

```bash
pnpm test packages/mcp/src packages/cli/src
```

Expected: MCP and CLI tests pass, with existing DB-dependent CLI tests skipped only when their existing skip conditions apply.

- [ ] **Step 3: Run full test suite**

Run:

```bash
pnpm test
```

Expected: full suite passes.

- [ ] **Step 4: Run typecheck, lint, and build**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm run build
```

Expected: all pass.

- [ ] **Step 5: Manual CLI smoke checks**

Run:

```bash
pnpm --filter @cesium-nexus/cli build
node packages/cli/dist/index.js pkb list
node packages/cli/dist/index.js stage z_fighting
node packages/cli/dist/index.js diagnose "why does my polygon flicker?"
```

Expected:

- `pkb list` includes `z_fighting`
- `stage z_fighting` includes `Depth Pass`
- `diagnose` includes Possible Causes, Render Stages, Related Symbols, Investigation Steps, Possible Fixes

- [ ] **Step 6: Commit fixes if verification required changes**

If verification required fixes:

```bash
git add <changed-files>
git commit -m "fix: stabilize phase 2a diagnosis verification"
```

If no fixes were needed, do not create an empty commit.

---

## Execution Notes

- Keep static KB data hand-authored and deterministic.
- Do not add embeddings, vector search, semantic retrieval, reranking, crawler code, or database migrations.
- Do not modify existing Phase 1 `ContextPack` behavior except for imports or docs needed to coexist with `DiagnosticContextPack`.
- When a real Cesium database is unavailable, unit tests should still cover matcher, loader, token budget, and in-memory diagnosis assembly.
- CLI tests that require a real indexed database should follow the existing skip pattern rather than failing CI.

## Final Acceptance

Phase 2A is complete when these inputs produce useful diagnosis results:

```text
why does Polygon flicker?
why does z-fighting happen?
why is Primitive performance bad?
why do 3D Tiles jitter?
why does Label disappear?
```

Each output includes:

- problem causes
- related source
- related callgraph
- related issues
- investigation steps
- fix suggestions

The final verification commands are:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm run build
```
