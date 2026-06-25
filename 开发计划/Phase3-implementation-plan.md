# Phase 3 Implementation Plan — cesium-nexus

> 创建时间：2026-06-25
> 基于：Phase 3 Architecture Freeze v1.0
> 状态：**待审核**

---

## 1. 概述

### 1.1 目标

建立统一的 Code Intelligence 体系，通过 Evidence Fusion Engine 实现根因推断能力。

### 1.2 架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Phase 3C: User Skills                   │
│         Migration / Shader / Diff (Reasoner 消费者)         │
├─────────────────────────────────────────────────────────────┤
│              Phase 3B: Evidence Fusion Engine                │
│     Evidence Collector → Evidence Ranker → Explanation       │
├─────────────────────────────────────────────────────────────┤
│               Phase 3A: Code Intelligence                   │
│   Phase 3A1: Version Index  │  Phase 3A2: Shader Index      │
├─────────────────────────────────────────────────────────────┤
│                    Existing Knowledge Layer                  │
│   Symbol Index / Call Graph / Render Graph / Experience      │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 总工时

| 阶段 | 周次 | 工时 |
|------|------|------|
| Phase 3A1 | W1-W2 | 1.5 周 |
| Phase 3A2 | W3 | 1 周 |
| Phase 3B | W4-W5 | 2 周 |
| Phase 3C | W6 | 1 周 |
| **总计** | | **6 周** |

---

## 2. Phase 3A1: Version Intelligence（W1-W2）

### 2.1 目标

建立版本快照和 Diff 能力，支持跨版本符号变更查询和 Breaking Change 检测。

### 2.2 任务拆解

| # | 任务 | 文件 | 测试 / 验收 |
|---|------|------|-------------|
| 3A1.1 | **Symbol Snapshot 表** | `packages/storage/src/schema.sql` | 表创建成功，索引正常 |
| 3A1.2 | **Snapshot Builder** | `packages/intelligence/src/snapshot-builder.ts` | 扫描指定版本的 Symbol 并落库 |
| 3A1.3 | **Symbol Diff Engine** | `packages/intelligence/src/symbol-diff-engine.ts` | 两个版本的 Symbol Diff 计算 |
| 3A1.4 | **Breaking Change Detector** | `packages/intelligence/src/breaking-change-detector.ts` | 检测 removed/renamed/signature_changed |
| 3A1.5 | **CLI: `cesium snapshot`** | `packages/cli/src/commands/snapshot-cmd.ts` | 生成版本快照 |
| 3A1.6 | **CLI: `cesium diff`** | `packages/cli/src/commands/diff-cmd.ts` | 两版本 Symbol Diff |
| 3A1.7 | **Git Submodule 版本切换** | `packages/intelligence/src/version-utils.ts` | 安全 checkout + restore |

### 2.3 数据结构

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

### 2.4 核心接口

```typescript
// packages/intelligence/src/types.ts
interface SymbolSnapshot {
  id: string;
  version: string;
  symbolId: string;
  name: string;
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

// packages/intelligence/src/snapshot-builder.ts
interface SnapshotBuilder {
  buildSnapshot(version: string): Promise<SymbolSnapshot[]>;
  getSnapshot(version: string): Promise<SymbolSnapshot[]>;
  snapshotExists(version: string): Promise<boolean>;
}

// packages/intelligence/src/symbol-diff-engine.ts
interface SymbolDiffEngine {
  diff(fromVersion: string, toVersion: string): Promise<VersionDiff>;
}

// packages/intelligence/src/breaking-change-detector.ts
interface BreakingChangeDetector {
  detect(diff: VersionDiff): Promise<BreakingChange[]>;
  generateMigrationGuide(change: BreakingChange): Promise<string>;
}
```

### 2.5 CLI 命令

```bash
# 生成版本快照
cesium snapshot 1.118
cesium snapshot 1.130

# 两版本 Symbol Diff
cesium diff Camera 1.118 1.130
cesium diff --breaking 1.118 1.130
cesium diff --format markdown 1.118 1.130

# 查看已快照版本
cesium snapshot --list
```

### 2.6 验收标准

| 指标 | 目标 |
|------|------|
| 版本快照 | ≥ 2 个版本（1.118, 1.130） |
| Symbol 数量 | 每版本 ≥ 3000 个 Symbol |
| Diff 性能 | `cesium diff Camera 1.118 1.130` < 30s |
| Breaking Change 检测 | 能识别 removed/renamed/signature_changed |
| 测试 | ≥ 20 个新测试 |

### 2.7 W1 任务

| # | 任务 | 产出 |
|---|------|------|
| 3A1.1 | Symbol Snapshot 表创建 | schema.sql 更新 |
| 3A1.2 | Snapshot Builder 核心 | `snapshot-builder.ts` |
| 3A1.3 | Git Submodule 版本切换 | `version-utils.ts` |
| 3A1.4 | CLI `cesium snapshot` | `snapshot-cmd.ts` |

### 2.8 W2 任务

| # | 任务 | 产出 |
|---|------|------|
| 3A1.5 | Symbol Diff Engine | `symbol-diff-engine.ts` |
| 3A1.6 | Breaking Change Detector | `breaking-change-detector.ts` |
| 3A1.7 | CLI `cesium diff` | `diff-cmd.ts` |
| 3A1.8 | 集成测试 | e2e 测试覆盖 |

---

## 3. Phase 3A2: Shader Intelligence（W3）

### 3.1 目标

建立 GLSL Shader 的完整索引，支持 Shader Symbol → JS Symbol → Render Stage 关联。

### 3.2 任务拆解

| # | 任务 | 文件 | 测试 / 验收 |
|---|------|------|-------------|
| 3A2.1 | **Shader Symbol 表** | `packages/storage/src/schema.sql` | 表创建成功 |
| 3A2.2 | **GLSL Scanner** | `packages/intelligence/src/glsl-scanner.ts` | 扫描 .glsl 文件提取 symbol |
| 3A2.3 | **Shader Index** | `packages/intelligence/src/shader-index.ts` | 索引构建 + 查询 |
| 3A2.4 | **JS Symbol 关联** | `packages/intelligence/src/shader-js-linker.ts` | Shader → JS Symbol 关联 |
| 3A2.5 | **CLI: `cesium shader`** | `packages/cli/src/commands/shader-cmd.ts` | Shader 查询 |

### 3.3 数据结构

```sql
-- Shader Symbol 表
CREATE TABLE shader_symbol (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  file TEXT NOT NULL,
  source TEXT NOT NULL,
  related_js_symbols TEXT,
  related_render_stage TEXT,
  doc_comment TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_shader_name ON shader_symbol(name);
CREATE INDEX idx_shader_type ON shader_symbol(type);
CREATE INDEX idx_shader_file ON shader_symbol(file);
```

### 3.4 核心接口

```typescript
// packages/intelligence/src/types.ts
interface ShaderSymbol {
  id: string;
  name: string;
  type: 'uniform' | 'varying' | 'function' | 'struct' | 'define';
  file: string;
  source: string;
  relatedJsSymbols: string[];
  relatedRenderStage?: string;
  docComment?: string;
}

interface ShaderIndex {
  symbols: Map<string, ShaderSymbol>;
  byName: Map<string, ShaderSymbol[]>;
  byFile: Map<string, ShaderSymbol[]>;
  byRelatedJs: Map<string, ShaderSymbol[]>;
}

// packages/intelligence/src/glsl-scanner.ts
interface GlslScanner {
  scanDirectory(dir: string): Promise<ShaderSymbol[]>;
  scanFile(filePath: string): Promise<ShaderSymbol[]>;
}

// packages/intelligence/src/shader-index.ts
interface ShaderIndexBuilder {
  build(): Promise<ShaderIndex>;
  getByName(name: string): Promise<ShaderSymbol[]>;
  getByRelatedJs(jsSymbolId: string): Promise<ShaderSymbol[]>;
  getByRenderStage(stage: string): Promise<ShaderSymbol[]>;
}

// packages/intelligence/src/shader-js-linker.ts
interface ShaderJsLinker {
  link(shaders: ShaderSymbol[], symbols: SymbolRecord[]): Promise<ShaderSymbol[]>;
}
```

### 3.5 索引范围

```
packages/engine/Source/Shaders/**/*.glsl
packages/engine/Source/Shaders/**/*.glsl.js
packages/engine/Source/Scene/Model/**/*.js (提取 GLSL 字符串)
packages/widgets/Source/**/*.js (如有 shader 引用)
```

### 3.6 关联逻辑

```
Shader Symbol (czm_modelVertexNormal)
  ├── byName: 精确匹配 shader 名称
  ├── byFile: 按文件路径查找
  ├── byRelatedJs: 通过代码分析关联 JS Symbol
  │     ├── 查找引用该 shader 的 JS 文件
  │     ├── 提取相关 JS Symbol（如 VertexAttribute）
  │     └── 关联到 Render Stage（如 "model"）
  └── byRenderStage: 通过 Render Pipeline 关联
```

### 3.7 CLI 命令

```bash
# 查询 Shader Symbol
cesium shader czm_modelVertexNormal
cesium shader --type uniform
cesium shader --file ModelVS.glsl

# 查看关联
cesium shader --related VertexAttribute
cesium shader --stage model

# 重建索引
cesium shader --rebuild
```

### 3.8 验收标准

| 指标 | 目标 |
|------|------|
| Shader Symbol 数量 | ≥ 200 个 |
| 可关联 Symbol | ≥ 100 个（有明确 JS 调用者） |
| 关联成功率 | ≥ 80%（可建立关联的 Symbol 中） |
| 查询性能 | `cesium shader czm_model` < 500ms |
| 测试 | ≥ 15 个新测试 |

---

## 4. Phase 3B: Evidence Fusion Engine（W4-W5）

### 4.1 目标

建立证据融合引擎，能够综合 Problem Pattern、Code Symbol、Version Diff、Shader、Render Stage 进行根因推断。

### 4.2 任务拆解

| # | 任务 | 文件 | 测试 / 验收 |
|---|------|------|-------------|
| 3B.1 | **Evidence Collector** | `packages/reasoner/src/evidence-collector.ts` | 收集多源证据 |
| 3B.2 | **Evidence Ranker** | `packages/reasoner/src/evidence-ranker.ts` | 基于规则的证据排序 |
| 3B.3 | **Explanation Generator** | `packages/reasoner/src/explanation-generator.ts` | 生成人类可读的解释 |
| 3B.4 | **Diagnosis Reasoner** | `packages/reasoner/src/diagnosis-reasoner.ts` | 整合三个组件 |
| 3B.5 | **CLI: `cesium diagnose --reason`** | `packages/cli/src/commands/diagnose-cmd.ts` | 根因诊断命令 |

### 4.3 模块设计

```
packages/reasoner/
  ├─ src/
  │    ├─ evidence-collector.ts      # 证据收集
  │    ├─ evidence-ranker.ts         # 证据排序
  │    ├─ explanation-generator.ts   # 解释生成
  │    ├─ diagnosis-reasoner.ts      # 整合器
  │    └─ types.ts
  ├─ package.json
  └─ tsconfig.json
```

### 4.4 核心接口

```typescript
// packages/reasoner/src/types.ts
interface Evidence {
  type: 'pattern' | 'symbol' | 'callgraph' | 'shader' | 'stage' | 'version' | 'experience';
  source: string;
  description: string;
  weight: number;
  metadata?: Record<string, unknown>;
}

interface RankedEvidence {
  evidence: Evidence;
  score: number;
  explanation: string;
}

interface DiagnosisExplanation {
  summary: string;
  primaryCause: string;
  contributingFactors: string[];
  evidenceSummary: string;
  suggestedActions: string[];
}

interface DiagnosisResult {
  query: string;
  evidence: Evidence[];
  rankedEvidence: RankedEvidence[];
  explanation: DiagnosisExplanation;
  confidence: number;
}

// packages/reasoner/src/evidence-collector.ts
interface EvidenceCollector {
  collect(query: string): Promise<Evidence[]>;
  collectFromPattern(pattern: ProblemPattern): Promise<Evidence[]>;
  collectFromSymbol(symbol: SymbolRecord): Promise<Evidence[]>;
  collectFromVersion(versionDiff: VersionDiff): Promise<Evidence[]>;
}

// packages/reasoner/src/evidence-ranker.ts
interface EvidenceRanker {
  rank(evidence: Evidence[]): RankedEvidence[];
}

// packages/reasoner/src/explanation-generator.ts
interface ExplanationGenerator {
  explain(ranked: RankedEvidence[]): DiagnosisExplanation;
}

// packages/reasoner/src/diagnosis-reasoner.ts
interface DiagnosisReasoner {
  diagnose(query: string): Promise<DiagnosisResult>;
}
```

### 4.5 Evidence Ranker 排序规则

```typescript
// 基于规则的排序（非机器学习）
const RANKING_RULES = {
  // 证据类型权重
  typeWeights: {
    pattern: 1.0,      // Problem Pattern 匹配最高
    symbol: 0.8,       // Symbol 直接关联
    callgraph: 0.7,    // Call Graph 关联
    shader: 0.6,       // Shader 关联
    stage: 0.5,        // Render Stage 关联
    version: 0.4,      // Version 变更
    experience: 0.3,   // 经验关联
  },
  
  // 关联距离衰减
  distanceDecay: {
    direct: 1.0,       // 直接关联
    indirect: 0.7,     // 间接关联
    inferred: 0.4,     // 推断关联
  },
  
  // 时间衰减
  timeDecay: {
    recent: 1.0,       // 最近变更
    historical: 0.6,   // 历史变更
  },
};
```

### 4.6 Explanation Generator 模板

```typescript
// 基于模板的解释生成
const EXPLANATION_TEMPLATES = {
  pattern: "匹配到已知问题模式: {pattern_name}",
  symbol: "相关代码符号: {symbol_name} ({symbol_kind})",
  callgraph: "调用链: {caller} → {callee}",
  shader: "相关 Shader: {shader_name} ({shader_type})",
  stage: "渲染阶段: {stage_name}",
  version: "版本变更: {from_version} → {to_version}",
  experience: "历史经验: {experience_summary}",
};
```

### 4.7 CLI 命令

```bash
# 根因诊断
cesium diagnose --reason "billboard flickering"
cesium diagnose --reason "shader compile fail" --verbose

# 查看证据链
cesium diagnose --reason "z-fighting" --evidence-only
```

### 4.8 验收标准

| 指标 | 目标 |
|------|------|
| 端到端诊断 | 10 个问题中 ≥ 8 个返回正确根因 |
| 证据链完整性 | ≥ 3 个证据/根因 |
| 解释可读性 | 人类可理解的一句话总结 |
| 性能 | `cesium diagnose --reason` < 3s |
| 测试 | ≥ 25 个新测试 |

### 4.9 W4 任务

| # | 任务 | 产出 |
|---|------|------|
| 3B.1 | Evidence Collector 核心 | `evidence-collector.ts` |
| 3B.2 | Evidence 类型定义 | `types.ts` |
| 3B.3 | Pattern 证据收集 | `collectFromPattern` |
| 3B.4 | Symbol 证据收集 | `collectFromSymbol` |

### 4.10 W5 任务

| # | 任务 | 产出 |
|---|------|------|
| 3B.5 | Evidence Ranker | `evidence-ranker.ts` |
| 3B.6 | Explanation Generator | `explanation-generator.ts` |
| 3B.7 | Diagnosis Reasoner 整合 | `diagnosis-reasoner.ts` |
| 3B.8 | CLI `cesium diagnose --reason` | `diagnose-cmd.ts` 更新 |
| 3B.9 | 端到端测试 | 10 个问题验收 |

---

## 5. Phase 3C: User Skills（W6）

### 5.1 目标

将 Evidence Fusion Engine 的能力以 MCP Tools 形式暴露。

### 5.2 任务拆解

| # | 任务 | 文件 | 测试 / 验收 |
|---|------|------|-------------|
| 3C.1 | **MCP Tool: `search_migration`** | `packages/mcp/src/handlers.ts` | 跨版本 Breaking Change 查询 |
| 3C.2 | **MCP Tool: `search_shader`** | `packages/mcp/src/handlers.ts` | Shader Symbol 检索 |
| 3C.3 | **MCP Tool: `compare_version`** | `packages/mcp/src/handlers.ts` | 两版本 Symbol Diff |
| 3C.4 | **MCP Tool: `diagnose_root_cause`** | `packages/mcp/src/handlers.ts` | 根因诊断 |
| 3C.5 | **集成测试** | `packages/mcp/src/*.test.ts` | 4 个新 tool 测试 |

### 5.3 MCP Tools 设计

```typescript
// search_migration
{
  name: "search_migration",
  description: "Search for breaking changes between Cesium versions",
  inputSchema: {
    type: "object",
    properties: {
      fromVersion: { type: "string", description: "Source version" },
      toVersion: { type: "string", description: "Target version" },
      symbol: { type: "string", description: "Filter by symbol name" }
    },
    required: ["fromVersion", "toVersion"]
  }
}

// search_shader
{
  name: "search_shader",
  description: "Search shader symbols and diagnose shader issues",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Shader name or issue description" },
      type: { type: "string", enum: ["uniform", "varying", "function", "struct", "define"] },
      relatedJsSymbol: { type: "string", description: "Filter by related JS symbol" }
    },
    required: ["query"]
  }
}

// compare_version
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
    },
    required: ["fromVersion", "toVersion"]
  }
}

// diagnose_root_cause
{
  name: "diagnose_root_cause",
  description: "Diagnose root cause of a Cesium issue",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Issue description" },
      verbose: { type: "boolean", default: false }
    },
    required: ["query"]
  }
}
```

### 5.4 验收标准

| 指标 | 目标 |
|------|------|
| MCP Tools | 17 个全部可用（现有 13 + 新增 4） |
| Tool 响应 | 所有 tool < 5s |
| 测试 | ≥ 10 个新测试 |

---

## 6. ADR（架构决策记录）

### 6.1 ADR-001: Why Intelligence Layer

**背景：** Phase 3 需要 Version Intelligence、Shader Intelligence 等多个索引能力。

**决策：** 建立统一的 `packages/intelligence` 层，而非多个独立 Repo。

**理由：**
- 避免 20 个 Repo 失控
- 统一索引接口，便于 Reasoner 消费
- 共享 Symbol Index、Call Graph 等已有能力

**后果：**
- 所有索引能力集中在 intelligence 包
- 新增索引能力只需扩展 intelligence 包

### 6.2 ADR-002: Why Reasoner Instead of More Skills

**背景：** 原计划直接实现 Migration Skill、Shader Skill、Diff Skill。

**决策：** 先建立 Evidence Fusion Reasoner，Skills 作为 Reasoner 的消费者。

**理由：**
- 根因推断 > 功能堆砌
- Reasoner 提供统一的推理能力
- Skills 只是 Reasoner 的表现形式

**后果：**
- 新增 Skill 只需调用 Reasoner
- 推理能力可复用

### 6.3 ADR-003: Why Version Intelligence First

**背景：** Phase 3A 可以先做 Shader Index 或 Version Index。

**决策：** Version Intelligence 优先（Phase 3A1），Shader Intelligence 其次（Phase 3A2）。

**理由：**
- Migration、Diff、Breaking Change 均依赖 Version Index
- Version Index 是后续所有能力的基础
- Shader Index 相对独立，可以并行

**后果：**
- Phase 3A1 完成后即可支持 Migration/Diff
- Phase 3A2 可以与 Phase 3B 并行

---

## 7. 验收标准总览

### 7.1 Phase 3A1 验收

| 指标 | 目标 |
|------|------|
| 版本快照 | ≥ 2 个版本（1.118, 1.130） |
| Symbol 数量 | 每版本 ≥ 3000 个 |
| Diff 性能 | < 30s |
| Breaking Change | 能识别 3 种变更类型 |
| 测试 | ≥ 20 个 |

### 7.2 Phase 3A2 验收

| 指标 | 目标 |
|------|------|
| Shader Symbol | ≥ 200 个 |
| 可关联 Symbol | ≥ 100 个 |
| 关联成功率 | ≥ 80% |
| 查询性能 | < 500ms |
| 测试 | ≥ 15 个 |

### 7.3 Phase 3B 验收

| 指标 | 目标 |
|------|------|
| 端到端诊断 | ≥ 8/10 正确 |
| 证据链 | ≥ 3 个/根因 |
| 解释可读性 | 人类可理解 |
| 性能 | < 3s |
| 测试 | ≥ 25 个 |

### 7.4 Phase 3C 验收

| 指标 | 目标 |
|------|------|
| MCP Tools | 17 个 |
| Tool 响应 | < 5s |
| 测试 | ≥ 10 个 |

### 7.5 总体验收

| 指标 | 目标 |
|------|------|
| 总测试 | ≥ 500 个（现有 408 + 新增 ~100） |
| 端到端问题 | 10 个 ≥ 8 个正确 |
| 文档 | README + CHANGELOG 更新 |
| ADR | 3 个 |

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Git Submodule checkout 慢 | Snapshot 耗时 > 60s | 缓存 snapshot，仅增量更新 |
| GLSL 解析复杂 | Shader Index 覆盖不全 | 优先解析 `czm_*` 命名的 symbol |
| Symbol ID 跨版本不稳定 | Diff 结果不准确 | 使用 `name + kind + file` 作为稳定标识 |
| Evidence Ranker 规则不准确 | 排序结果不理想 | 人工审核 + 持续优化规则 |
| 工时超预期 | 6 周不够 | Phase 3A2 可与 Phase 3B 并行 |

---

## 9. 依赖关系

```
Phase 3A1 (Version Intelligence)
    ↓
Phase 3A2 (Shader Intelligence) ←── 可与 3A1 并行
    ↓
Phase 3B (Evidence Fusion Engine) ←── 依赖 3A1 + 3A2
    ↓
Phase 3C (MCP Tools) ←── 依赖 3B
```

---

## 10. 总结

**Phase 3 实施计划核心：**

```
Phase 3A1 (W1-W2): Version Intelligence
  → 建立版本快照 + Diff + Breaking Change

Phase 3A2 (W3): Shader Intelligence
  → 建立 Shader 索引 + JS Symbol 关联

Phase 3B (W4-W5): Evidence Fusion Engine
  → 证据收集 + 排序 + 解释

Phase 3C (W6): MCP Tools
  → search_migration / search_shader / compare_version / diagnose_root_cause
```

**关键决策：**

- 统一 Intelligence 层，避免 Repo 失控
- Evidence Fusion Engine，而非过度设计的 Reasoner
- Version Intelligence 优先，作为后续能力基础

**总工时：** 6 周（1 人）

---

**下一步：** 用户审核通过后，开始执行 Phase 3A1。
