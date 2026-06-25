# Phase 3 Architecture — cesium-nexus

> 架构设计：2026-06-25
> 基于：Phase 3 Scope Review + 架构收敛讨论
> 状态：**待审核**

---

## 1. 问题分析

### 1.1 原方案的问题

原 Phase 3 Scope Review 提出三个独立功能：

```
Migration Skill    = Version Knowledge
Shader Skill       = Rendering Knowledge
Cross-version Diff = Evolution Knowledge
```

**问题：**

| # | 问题 | 影响 |
|---|------|------|
| 1 | **碎片化** | 三个独立模块 → `migration-repo.ts` / `shader-repo.ts` / `diff-repo.ts` → 20 个 Repo 失控 |
| 2 | **重叠** | Migration 和 Diff 高度重叠，Diff 是 Migration 的底层能力 |
| 3 | **范围窄** | Shader Skill = GLSL 索引，无法回答"为什么 shader compile fail" |
| 4 | **缺根因** | 三个功能都不是根因推断，Phase 3 目标"增强诊断深度"未达成 |

### 1.2 核心洞察

三个功能的**共同点**是：

```
Code Intelligence Layer
```

即：

```
Knowledge Graph
      ↓
Code Intelligence
      ↓
Diagnosis / Migration / Diff / Root Cause
```

如果不先抽象这一层，后面会出现：

```
20 个 Repo
20 个 MCP Tool
开始失控
```

---

## 2. 架构设计

### 2.1 三层架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Phase 3C: User Skills                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Migration   │  │   Shader    │  │   Version Diff      │ │
│  │    Skill     │  │   Skill     │  │      Skill          │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                     │            │
├─────────┼────────────────┼─────────────────────┼────────────┤
│         ▼                ▼                     ▼            │
│                  Phase 3B: Diagnosis Reasoner               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Root Cause Inference Engine               │  │
│  │  Problem Pattern → Symbol → Version → Shader → Root   │  │
│  └──────────────────────────┬───────────────────────────┘  │
│                             │                              │
├─────────────────────────────┼──────────────────────────────┤
│                             ▼                              │
│               Phase 3A: Code Intelligence                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ Symbol Index  │  │ Shader Index │  │ Version Index    │ │
│  │ (已有)        │  │ (新增)        │  │ (新增)            │ │
│  └──────────────┘  └──────────────┘  └──────────────────┘ │
│  ┌──────────────┐  ┌──────────────┐                        │
│  │  Call Graph   │  │ Render Stage │                        │
│  │ (已有)        │  │ (已有)        │                        │
│  └──────────────┘  └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 设计原则

| 原则 | 说明 |
|------|------|
| **统一能力层** | 所有 Code Intelligence 能力集中在 `packages/intelligence` |
| **单一数据源** | Symbol / Shader / Version 共享同一个 Index 体系 |
| **Reasoner 驱动** | User Skills 是 Reasoner 的表现形式，不是独立模块 |
| **渐进增强** | 先建基础层，再建推理层，最后建用户层 |

---

## 3. Phase 3A: Code Intelligence Foundation

### 3.1 目标

建立统一的 Code Intelligence 能力层，为后续推理和用户技能提供基础。

### 3.2 模块设计

```
packages/intelligence/
  ├─ src/
  │    ├─ symbol-index.ts          # 符号索引（复用现有 SymbolRepo）
  │    ├─ shader-index.ts          # Shader 索引（新增）
  │    ├─ version-index.ts         # 版本索引（新增）
  │    ├─ render-graph.ts          # 渲染图谱（复用现有 RenderPipeline）
  │    └─ types.ts                 # 统一类型定义
  ├─ package.json
  └─ tsconfig.json
```

### 3.3 Shader Index

**目标：** 建立 GLSL Shader 的完整索引，支持 Shader Symbol → JS Symbol → Render Stage 关联。

**数据结构：**

```typescript
interface ShaderSymbol {
  id: string;                    // "shader/czm_modelVertexNormal"
  name: string;                  // "czm_modelVertexNormal"
  type: 'uniform' | 'varying' | 'function' | 'struct' | 'define';
  file: string;                  // "Source/Shaders/Model/ModelVS.glsl"
  source: string;                // GLSL 源码
  relatedJsSymbols: string[];    // 关联的 JS Symbol ID（如 VertexAttribute）
  relatedRenderStage: string;    // 关联的 Render Stage（如 "model"）
  docComment?: string;           // GLSL 注释
}

interface ShaderIndex {
  symbols: Map<string, ShaderSymbol>;
  byName: Map<string, ShaderSymbol[]>;
  byFile: Map<string, ShaderSymbol[]>;
  byRelatedJs: Map<string, ShaderSymbol[]>;
}
```

**索引范围：**

```
packages/engine/Source/Shaders/**/*.glsl
packages/engine/Source/Shaders/**/*.glsl.js
packages/engine/Source/Scene/Model/**/*.js (提取 GLSL 字符串)
```

**关联逻辑：**

```
Shader Symbol
  ├── relatedJsSymbols: ["symbol/VertexAttribute", "symbol/DrawCommand"]
  ├── relatedRenderStage: "model"
  └── relatedCallGraph: ["Model.update", "Model.draw"]
```

### 3.4 Version Index

**目标：** 建立版本快照和 Diff 能力，支持跨版本符号变更查询。

**数据结构：**

```typescript
interface SymbolSnapshot {
  id: string;                    // "snapshot/1.118/Camera/update"
  version: string;               // "1.118"
  symbolId: string;              // "symbol/Camera/update"
  name: string;                  // "update"
  kind: 'class' | 'function' | 'method' | 'enum' | 'constant';
  filePath: string;
  startLine: number;
  endLine: number;
  docComment?: string;
  sourceCode?: string;
  snapshotAt: number;
}

interface VersionDiff {
  fromVersion: string;
  toVersion: string;
  added: SymbolSnapshot[];
  removed: SymbolSnapshot[];
  modified: {
    before: SymbolSnapshot;
    after: SymbolSnapshot;
    changeType: 'signature' | 'implementation' | 'doc' | 'location';
  }[];
  breakingChanges: BreakingChange[];
}

interface BreakingChange {
  symbolId: string;
  changeType: 'removed' | 'renamed' | 'signature_changed' | 'behavior_changed';
  description: string;
  migrationGuide?: string;
}
```

**存储：**

```sql
-- 符号快照表
CREATE TABLE symbol_snapshot (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  symbol_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  doc_comment TEXT,
  source_code TEXT,
  snapshot_at INTEGER NOT NULL,
  UNIQUE(version, symbol_id)
);

-- 版本变更表
CREATE TABLE breaking_change (
  id TEXT PRIMARY KEY,
  from_version TEXT NOT NULL,
  to_version TEXT NOT NULL,
  symbol_id TEXT NOT NULL,
  change_type TEXT NOT NULL,
  description TEXT NOT NULL,
  migration_guide TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_snapshot_version ON symbol_snapshot(version);
CREATE INDEX idx_snapshot_symbol ON symbol_snapshot(symbol_id);
CREATE INDEX idx_breaking_version ON breaking_change(from_version, to_version);
```

### 3.5 Render Graph 增强

**目标：** 将现有 RenderPipeline Graph 与 Shader Index 关联，形成完整的渲染知识图谱。

**增强内容：**

```typescript
interface RenderStageNode {
  id: string;                    // "stage/opaque"
  name: string;
  description: string;
  relatedShaderSymbols: string[]; // 关联的 Shader Symbol ID
  relatedJsSymbols: string[];     // 关联的 JS Symbol ID（DrawCommand, Pass 等）
  upstream: string[];             // 上游 Stage
  downstream: string[];           // 下游 Stage
}

interface RenderGraph {
  stages: Map<string, RenderStageNode>;
  shaderToStage: Map<string, string[]>;  // Shader → Stage 映射
  jsToStage: Map<string, string[]>;      // JS Symbol → Stage 映射
}
```

---

## 4. Phase 3B: Diagnosis Reasoner

### 4.1 目标

建立根因推断引擎，能够综合 Problem Pattern、Code Symbol、Version Diff、Shader、Render Stage 进行联合推理。

### 4.2 模块设计

```
packages/reasoner/
  ├─ src/
  │    ├─ diagnosis-reasoner.ts    # 根因推断引擎
  │    ├─ evidence-collector.ts    # 证据收集器
  │    ├─ hypothesis-generator.ts  # 假设生成器
  │    ├─ confidence-scorer.ts     # 置信度评分
  │    └─ types.ts
  ├─ package.json
  └─ tsconfig.json
```

### 4.3 推理流程

```
用户问题
  ↓
Evidence Collector（证据收集）
  ├─ Problem Pattern 匹配
  ├─ Symbol 检索
  ├─ Call Graph 遍历
  ├─ Shader Symbol 关联
  ├─ Render Stage 定位
  └─ Version Diff 检查（如有版本信息）
  ↓
Hypothesis Generator（假设生成）
  ├─ 从 Problem Pattern 推断可能原因
  ├─ 从 Call Graph 推断调用链问题
  ├─ 从 Shader 关联推断渲染问题
  └─ 从 Version Diff 推断回归问题
  ↓
Confidence Scorer（置信度评分）
  ├─ 证据强度
  ├─ 假设一致性
  └─ 历史匹配度
  ↓
Root Cause（根因输出）
  ├─ Primary Cause（主因）
  ├─ Contributing Factors（协因）
  ├─ Evidence Chain（证据链）
  └─ Suggested Actions（建议操作）
```

### 4.4 数据结构

```typescript
interface DiagnosisContext {
  query: string;
  problemPattern?: ProblemPattern;
  relatedSymbols: SymbolRecord[];
  callGraph: CallGraphPath[];
  shaderSymbols: ShaderSymbol[];
  renderStages: RenderStageNode[];
  versionDiff?: VersionDiff;
  relatedExperiences: ExperienceNode[];
}

interface RootCauseHypothesis {
  id: string;
  description: string;
  confidence: number;           // 0..1
  evidence: Evidence[];
  suggestedActions: string[];
}

interface Evidence {
  type: 'pattern' | 'symbol' | 'callgraph' | 'shader' | 'stage' | 'version' | 'experience';
  source: string;               // 来源 ID
  description: string;
  weight: number;               // 0..1
}

interface DiagnosisResult {
  primaryCause: RootCauseHypothesis;
  contributingFactors: RootCauseHypothesis[];
  evidenceChain: Evidence[];
  suggestedActions: string[];
  confidence: number;
}
```

### 4.5 示例：Billboard Flicker

**用户问题：** "Billboard flickering when zoom"

**Reasoner 推理过程：**

```
Evidence Collector:
  ├─ Problem Pattern: billboard_draw_order (confidence: 0.85)
  ├─ Symbol: Billboard.update, BillboardCollection.draw
  ├─ Call Graph: Billboard.update → BillboardCollection.update → DrawCommand
  ├─ Shader: czm_billboardVertex, czm_billboardFragment
  ├─ Render Stage: translucent pass (draw order)
  └─ Related Experience: z_fighting pattern

Hypothesis Generator:
  ├─ H1: Depth Test Conflict (confidence: 0.7)
  │     Evidence: z_fighting pattern + translucent pass
  ├─ H2: Draw Order Issue (confidence: 0.6)
  │     Evidence: billboard_draw_order + DrawCommand
  └─ H3: ClampToGround Interference (confidence: 0.4)
        Evidence: Billboard.groundPosition

Confidence Scorer:
  └─ Primary Cause: H1 (Depth Test Conflict)
      Contributing: H2 (Draw Order)
      Confidence: 0.75
```

**输出：**

```json
{
  "primaryCause": {
    "description": "Depth test conflict in translucent pass",
    "confidence": 0.75,
    "evidence": [
      {"type": "pattern", "source": "billboard_draw_order", "description": "Known draw order issue"},
      {"type": "stage", "source": "translucent", "description": "Translucent pass renders after opaque"},
      {"type": "shader", "source": "czm_billboardFragment", "description": "Fragment shader uses depth test"}
    ],
    "suggestedActions": [
      "Check RenderState.depthTest",
      "Verify DrawCommand.renderState",
      "Review translucent pass ordering"
    ]
  },
  "contributingFactors": [
    {
      "description": "Billboard ground position may cause z-fighting",
      "confidence": 0.4,
      "evidence": [...]
    }
  ]
}
```

---

## 5. Phase 3C: User Skills

### 5.1 目标

将 Reasoner 的能力以用户友好的形式暴露，包括 CLI 和 MCP Tools。

### 5.2 Migration Skill

**底层依赖：** Version Index + Breaking Change Detector

**CLI：**

```bash
cesium migrate 1.118 1.130
# 输出：
# Breaking Changes (1.118 → 1.130):
#   1. [REMOVED] Scene.pickTranslucentDepth (use Scene.pick instead)
#   2. [CHANGED] Camera.setView signature changed
#   3. [ADDED] Primitive.showBoundingVolume
# Migration Guide:
#   - Replace Scene.pickTranslucentDepth() with Scene.pick()
#   - Update Camera.setView() calls to use new options parameter
```

**MCP Tool：**

```typescript
{
  name: "search_migration",
  description: "Search for breaking changes between versions",
  inputSchema: {
    type: "object",
    properties: {
      fromVersion: { type: "string", description: "Source version" },
      toVersion: { type: "string", description: "Target version" },
      symbol: { type: "string", description: "Filter by symbol name" }
    }
  }
}
```

### 5.3 Shader Skill

**底层依赖：** Shader Index + Render Graph

**CLI：**

```bash
cesium shader czm_modelVertexNormal
# 输出：
# Shader Symbol: czm_modelVertexNormal
#   Type: varying
#   File: Source/Shaders/Model/ModelVS.glsl
#   Related JS Symbols:
#     - VertexAttribute (normal)
#     - Model.update
#   Related Render Stage: model
#   Description: Model vertex normal in model coordinates

cesium shader --explain "shader compile fail"
# 输出：
# Diagnosis:
#   Problem Pattern: shader_compile_error
#   Related Shaders: czm_modelVertexNormal, czm_modelFragment
#   Possible Causes:
#     1. GLSL version mismatch (check #version directive)
#     2. Missing uniform declaration
#     3. Varying type mismatch between VS and FS
#   Evidence Chain:
#     shader_compile_error → czm_modelVertexNormal → Model.draw → DrawCommand
```

**MCP Tool：**

```typescript
{
  name: "search_shader",
  description: "Search shader symbols and diagnose shader issues",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Shader name or issue description" },
      type: { type: "string", enum: ["uniform", "varying", "function", "struct", "define"] },
      relatedJsSymbol: { type: "string", description: "Filter by related JS symbol" }
    }
  }
}
```

### 5.4 Version Diff Skill

**底层依赖：** Version Index + Breaking Change Detector

**CLI：**

```bash
cesium diff Camera 1.118 1.130
# 输出：
# Camera Changes (1.118 → 1.130):
#   Added:
#     - Camera.pickEllipsoid (new method)
#   Modified:
#     - Camera.setView (signature changed)
#       Before: setView(options: CameraViewOptions)
#       After: setView(options: CameraViewOptions, convert?: boolean)
#   Removed:
#     - Camera.getRectangle (deprecated)
#
# Breaking Changes:
#   - Camera.setView signature changed (affects 3 files in your codebase)

cesium diff --breaking 1.118 1.130
# 输出：仅显示 Breaking Changes
```

**MCP Tool：**

```typescript
{
  name: "compare_version",
  description: "Compare symbols between two Cesium versions",
  inputSchema: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Filter by symbol name" },
      fromVersion: { type: "string" },
      toVersion: { type: "string" },
      breakingOnly: { type: "boolean", default: false }
    }
  }
}
```

---

## 6. 实施计划

### 6.1 Phase 3A: Code Intelligence Foundation（2 周）

| 周次 | 任务 | 产出 |
|------|------|------|
| W1 | Shader Index | `shader-index.ts` + `shader_symbol` 表 + `cesium shader` CLI |
| W2 | Version Index | `version-index.ts` + `symbol_snapshot` 表 + `breaking_change` 表 + `cesium snapshot` CLI |

**验收标准：**
- `cesium shader czm_model` 返回 ≥ 10 个 shader symbol
- `cesium snapshot 1.118` 生成版本快照
- Shader Symbol 能关联到 JS Symbol 和 Render Stage

### 6.2 Phase 3B: Diagnosis Reasoner（2 周）

| 周次 | 任务 | 产出 |
|------|------|------|
| W3 | Evidence Collector + Hypothesis Generator | `diagnosis-reasoner.ts` + 证据收集 + 假设生成 |
| W4 | Confidence Scorer + Integration | 置信度评分 + 与现有 Diagnosis 系统集成 |

**验收标准：**
- `cesium diagnose --reason "billboard flicker"` 返回根因分析
- 根因包含 Primary Cause + Contributing Factors + Evidence Chain
- 10 个端到端问题中 ≥ 8 个返回有意义的根因

### 6.3 Phase 3C: User Skills（1 周）

| 周次 | 任务 | 产出 |
|------|------|------|
| W5 | MCP Tools + CLI 集成 | `search_migration` / `search_shader` / `compare_version` |

**验收标准：**
- MCP 16 tools 全部可用
- `cesium migrate` / `cesium shader` / `cesium diff` CLI 正常工作
- 10 个端到端问题验收通过

### 6.4 总工时

```
Phase 3A: 2 周（Code Intelligence Foundation）
Phase 3B: 2 周（Diagnosis Reasoner）
Phase 3C: 1 周（User Skills）
─────────────────────────────────────────
总计:     5 周（1 人）
```

---

## 7. 验收标准

### 7.1 Phase 3A 验收

| 指标 | 目标 |
|------|------|
| Shader Symbol 数量 | ≥ 200 个 |
| Version Snapshot | ≥ 2 个版本（1.118, 1.130） |
| Shader → JS Symbol 关联率 | ≥ 80% |
| 性能：`cesium shader` | < 500ms |

### 7.2 Phase 3B 验收

| 指标 | 目标 |
|------|------|
| 端到端问题诊断 | 10 个问题中 ≥ 8 个返回正确根因 |
| 根因置信度 | ≥ 0.6（主因） |
| 证据链完整性 | ≥ 3 个证据/根因 |
| 性能：`cesium diagnose --reason` | < 3s |

### 7.3 Phase 3C 验收

| 指标 | 目标 |
|------|------|
| MCP Tools | 16 个全部可用 |
| Migration Skill | `cesium migrate 1.118 1.130` 返回 ≥ 5 条 Breaking Changes |
| Shader Skill | `cesium shader czm_model` 返回 ≥ 10 个 symbol |
| Version Diff | `cesium diff Camera 1.118 1.130` < 30s |
| 测试 | ≥ 100 个新测试，总测试 ≥ 500 |

---

## 8. 与原方案对比

| 维度 | 原方案 | 新方案 |
|------|--------|--------|
| **架构** | 三个独立 Skill | 三层统一架构 |
| **模块数** | 3 个 Repo | 2 个 Repo（intelligence + reasoner） |
| **MCP Tools** | 3 个（平级） | 3 个（Reasoner 的表现形式） |
| **根因推断** | 无 | Diagnosis Reasoner |
| **扩展性** | 每新增功能加 Repo | 在 Intelligence 层扩展 |
| **工时** | 3.5 周 | 5 周（+1.5 周，但获得根因推断能力） |

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Shader 解析复杂 | Shader Index 覆盖不全 | 优先解析 `czm_*` 命名的 symbol |
| Version Snapshot 耗时 | `cesium snapshot` > 60s | 缓存 snapshot，仅增量更新 |
| Reasoner 推理不准确 | 根因置信度低 | 人工审核 + 持续优化 |
| 工时增加 | 比原方案多 1.5 周 | 根因推断能力值得投入 |

---

## 10. 待决策项

| # | 决策项 | 建议 |
|---|--------|------|
| 1 | Phase 3 架构确认 | 采用三层架构（Intelligence → Reasoner → Skills） |
| 2 | 实施顺序 | Phase 3A → 3B → 3C |
| 3 | 工时确认 | 5 周（比原方案多 1.5 周） |
| 4 | 是否需要 Phase 3 实施计划 | 审核通过后起草 `Phase3-implementation-plan.md` |

---

## 11. 总结

**Phase 3 架构设计核心思想：**

```
不是三个独立 Skill
而是统一的 Code Intelligence 体系
  ↓
不是直接暴露功能
而是通过 Reasoner 提供根因推断
  ↓
不是 20 个 Repo 失控
而是 2 个核心 Repo（intelligence + reasoner）
  ↓
不是回答"命中了什么 pattern"
而是回答"为什么发生、如何修复"
```

**这决定了后面半年内整个 cesium-nexus 的能力边界。**

---

**下一步：** 用户审核通过后，起草 `开发计划/Phase3-implementation-plan.md`。
