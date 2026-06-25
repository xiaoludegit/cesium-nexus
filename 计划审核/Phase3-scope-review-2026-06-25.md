# Phase 3 Scope Review — cesium-nexus

> 审核时间：2026-06-25
> 审核依据：`future-roadmap.md` + `follow-up-plan.md` §4
> 前置条件：Phase 2E 验收通过（commit `2f09eae`）

---

## 1. Phase 2E 交付回顾

| 指标 | 结果 |
|------|------|
| Coverage 基线 | 39.05%（132/338 issues, 10/10 patterns） |
| Intent Filter | ✅ 生效（238 non-bug filtered） |
| Bug Issues | 101 条进入聚类 |
| Clusters | 1（threshold=0.80） |
| Candidates | 1（billboard_draw_order，已 approved） |
| 性能 | 0.2s（不含 LLM）/ 49s（含 LLM） |
| 测试 | 408 passed / 11 skipped |

**Phase 2E 结论：** Pipeline 稳定，但数据量（338 条）和聚类效果（仅 1 个 cluster）限制了 Coverage 提升。

---

## 2. Phase 3 目标定义

### 2.1 原始目标（future-roadmap.md）

> Agent 能主动推断根因、给出可操作的修复建议，并能比较版本间的差异。

### 2.2 重新定义（基于 Phase 2E 经验）

Phase 3 应聚焦于**增强诊断深度**，而非**扩展数据源**：

| 维度 | Phase 2E | Phase 3 目标 |
|------|----------|--------------|
| 诊断广度 | 覆盖 10 个已知 pattern | 保持稳定，不追求 pattern 数量 |
| 诊断深度 | 关键词 + 向量匹配 | **根因推断** + **修复建议** |
| 版本感知 | 无 | **跨版本 Breaking Change 检测** |
| Shader 诊断 | 无 | **GLSL symbol 检索** |

---

## 3. 功能评估

### 3.1 保留功能（高优先级）

#### 3.1.1 Migration Skill（预估 1.5 周）

**目标：** 用户描述"migrate from 1.118 to 1.130"时，系统能列出 Breaking Changes + 迁移步骤。

**实现方案：**

```
用户查询: "migrate from 1.118 to 1.130"
  ↓
Skill Router → Migration Skill
  ↓
1. 解析版本号 (v1=1.118, v2=1.130)
2. 查询 CHANGELOG.md / GitHub Releases
3. 提取 Breaking Changes
4. 匹配受影响的 Symbol（CallGraph）
5. 生成迁移指南
```

**数据源：**
- `data/cesium/CHANGES.md`（已有，submodule 内）
- GitHub Releases API（增量同步）

**验收标准：**
- `cesium migrate 1.118 1.130` 列出 ≥ 5 条 Breaking Changes
- MCP `search_migration` tool 响应 < 2s

**风险：**
- CHANGES.md 格式不一致（历史版本）
- 需要解析 Markdown 结构

---

#### 3.1.2 Shader Skill（预估 1 周）

**目标：** 用户问"GLSL fragment shader fails to compile"时，系统能检索 shader symbol 并关联 JS 调用链。

**实现方案：**

```
packages/storage/src/
  └─ shader-repo.ts          # ShaderSymbol CRUD

packages/indexer/src/
  └─ shader-scanner.ts       # 扫描 *.glsl 文件，提取 symbol

data/schema.sql:
  shader_symbol (
    id TEXT PRIMARY KEY,
    shader_name TEXT,         # 如 "czm_modelVertexNormal"
    type TEXT,                # uniform / varying / function / struct
    file TEXT,                # Source/Shaders/**/*.glsl
    related_js_symbol TEXT,   # 关联的 JS Symbol（如 VertexAttribute）
    description TEXT
  )
```

**索引范围：**
- `packages/engine/Source/Shaders/**/*.glsl`
- `packages/engine/Source/Shaders/**/*.glsl.js`（内联 GLSL）

**验收标准：**
- `cesium shader czm_model` 返回 ≥ 10 个 shader symbol
- MCP `search_shader` tool 可用
- Shader symbol 能关联到 JS Symbol（如 `VertexAttribute`）

**风险：**
- GLSL 文件解析复杂（include 宏、条件编译）
- 部分 shader 以 JS 字符串形式存在（`*.glsl.js`）

---

#### 3.1.3 Cross-version Diff（预估 1 周）

**目标：** 用户问"what changed in Camera between 1.118 and 1.130"时，系统能列出 Symbol 级别的变更。

**实现方案：**

```
cesium diff Camera 1.118 1.130
  ↓
1. checkout 1.118 → index:symbols → snapshot
2. checkout 1.130 → index:symbols → snapshot
3. diff 两次 snapshot（新增/删除/修改的 Symbol）
4. 输出变更列表
```

**数据结构：**

```sql
symbol_snapshot (
  id TEXT,
  version TEXT,
  name TEXT,
  kind TEXT,
  file_path TEXT,
  start_line INTEGER,
  end_line INTEGER,
  doc_comment TEXT,
  snapshot_at INTEGER,
  PRIMARY KEY (id, version)
)
```

**验收标准：**
- `cesium diff Camera 1.118 1.130` 输出 JSON 格式的变更列表
- 支持 `--format markdown` 输出人类可读格式
- 性能：diff 两个版本 < 30s

**风险：**
- 需要频繁 checkout 不同版本（git submodule）
- 符号 ID 跨版本可能不稳定

---

### 3.2 重新评估功能（需数据验证）

#### 3.2.1 Blog Sync（建议推迟）

**原计划：** 同步 Cesium Blog 到 Experience Graph。

**评估结论：** ⚠️ **建议推迟到 Phase 3+**

**理由：**
1. **数据量有限**：Cesium Blog 更新频率 ~1 篇/月，增量价值低
2. **Release Note 覆盖**：关键信息已在 CHANGES.md 中
3. **Forum 已覆盖**：技术讨论已在 Phase 2B Forum Crawler 中
4. **ROI 低**：实现成本 ~1 周，但新增数据源 < 50 条

**替代方案：** 如果需要 Blog 数据，可在 Phase 3+ 作为 P2 任务。

---

#### 3.2.2 GitHub Discussion（建议推迟）

**原计划：** 同步 GitHub Discussion 到 Experience Graph。

**评估结论：** ⚠️ **建议推迟到 Phase 3+**

**理由：**
1. **与 Issue 高度重叠**：CesiumGS/cesium 的 Discussion 使用率低（主要是 Q&A）
2. **GraphQL API 复杂**：需要维护 GitHub App Token
3. **Phase 2E 已验证**：Issue 数据量（338 条）已足够，Discussion 增量有限
4. **Forum 已覆盖**：Discourse Forum 是主要技术讨论平台

**替代方案：** 如果 Issue 数据量增长到 1000+，可考虑引入 Discussion。

---

### 3.3 新增评估项

#### 3.3.1 LLM-based Skill Router（建议 Phase 3+ 评估）

**原方案：** 当前 keyword scoring（5 个 Skill + 关键词评分）。

**评估结论：** ⏸️ **暂不引入**

**理由：**
1. **当前 Router 稳定**：Phase 2B 已实现 5 个 Skill，keyword scoring 足够
2. **LLM 成本**：每次路由需要 1 次 LLM 调用（~200ms）
3. **Phase 2E 数据不足**：仅 10 个 pattern，不足以训练/评估 Router

**触发条件：** 当 Skill 数量 > 10 或 pattern 数量 > 50 时重新评估。

---

#### 3.3.2 HDBSCAN（建议 Phase 3+ 评估）

**原方案：** 当前 Cosine Threshold Clustering。

**评估结论：** ⏸️ **暂不引入**

**理由：**
1. **数据量不足**：Phase 2E 仅 338 条 issue，HDBSCAN 优势不明显
2. **阈值已定**：threshold=0.80 已验证有效（1 cluster）
3. **follow-up-plan.md 约束**：数据量 > 1 万条 或 CanonicalProblem > 50 个时评估

**触发条件：** 当 issue 数据量 > 10,000 条时重新评估。

---

## 4. Phase 3 范围决策

### 4.1 确认纳入

| 功能 | 优先级 | 预估工时 | 依赖 |
|------|--------|----------|------|
| Migration Skill | P0 | 1.5 周 | CHANGES.md 解析 |
| Shader Skill | P1 | 1 周 | GLSL 扫描器 |
| Cross-version Diff | P1 | 1 周 | Symbol Snapshot |

**总工时：** ~3.5 周（1 人）

### 4.2 推迟到 Phase 3+

| 功能 | 推迟理由 | 触发条件 |
|------|----------|----------|
| Blog Sync | 数据量有限，ROI 低 | 需要官方博客数据时 |
| GitHub Discussion | 与 Issue 高度重叠 | Issue > 1000 条时 |
| LLM-based Skill Router | 当前 Router 稳定 | Skill > 10 个时 |
| HDBSCAN | 数据量不足 | issue > 10,000 条时 |

### 4.3 新增评估

| 功能 | 来源 | 优先级 |
|------|------|--------|
| **10 个端到端问题验收** | follow-up-plan.md §3.1 | P0 |
| **性能基线补充** | follow-up-plan.md §3.2 | P1 |
| **文档补齐** | follow-up-plan.md §3.3 | P1 |

---

## 5. Phase 3 实施计划（草案）

### 5.1 任务排期

| 周次 | 任务 | 产出 |
|------|------|------|
| **W1** | Migration Skill | `migration-repo.ts` + `migrate` CLI + MCP `search_migration` |
| **W2** | Shader Skill | `shader-scanner.ts` + `shader-repo.ts` + `shader` CLI + MCP `search_shader` |
| **W3** | Cross-version Diff | `symbol-snapshot.ts` + `diff` CLI + MCP `compare_version` |
| **W4** | 端到端验收 + 文档 | 10 个问题验收 + performance-baseline.md + README/CHANGELOG 更新 |

### 5.2 验收标准

| 指标 | 目标 |
|------|------|
| Migration Skill | `cesium migrate 1.118 1.130` 返回 ≥ 5 条 Breaking Changes |
| Shader Skill | `cesium shader czm_model` 返回 ≥ 10 个 shader symbol |
| Cross-version Diff | `cesium diff Camera 1.118 1.130` 输出变更列表 < 30s |
| 端到端验收 | 10 个问题中 ≥ 8 个返回正确诊断 |
| 测试 | ≥ 50 个新测试，总测试 ≥ 450 |

### 5.3 MCP Tools 新增

| Tool | 说明 |
|------|------|
| `search_migration` | 跨版本 Breaking Change 查询 |
| `search_shader` | GLSL shader symbol 检索 |
| `compare_version` | 两版本 Symbol diff |

**Phase 3 结束时 MCP Tool 总数：** 16 个（现有 13 + 新增 3）

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| CHANGES.md 格式不一致 | Migration Skill 解析失败 | 手工维护关键版本的结构化数据 |
| GLSL 文件解析复杂 | Shader Skill 覆盖不全 | 优先解析 `czm_*` 命名的 symbol |
| Symbol ID 跨版本不稳定 | Diff 结果不准确 | 使用 `name + kind + file` 作为稳定标识 |
| git submodule checkout 慢 | Diff 耗时 > 30s | 缓存 snapshot，仅增量更新 |

---

## 7. 待用户决策项

| # | 决策项 | 建议 |
|---|--------|------|
| 1 | Phase 3 范围确认 | 纳入 Migration + Shader + Diff，推迟 Blog/Discussion |
| 2 | 实施顺序 | Migration → Shader → Diff → 验收 |
| 3 | 是否需要 Phase 3 实施计划 | 起草 `开发计划/Phase3-implementation-plan.md` |
| 4 | 端到端验收问题清单 | 使用 follow-up-plan.md §3.1 的 10 个问题 |

---

## 8. 审核结论

**Phase 3 范围建议：**

- ✅ **纳入：** Migration Skill / Shader Skill / Cross-version Diff
- ⚠️ **推迟：** Blog Sync / GitHub Discussion / LLM Router / HDBSCAN
- 📋 **附加：** 10 个端到端问题验收 + 性能基线 + 文档补齐

**总预估：** 3.5 周（1 人）

**下一步：** 用户审核通过后，起草 `开发计划/Phase3-implementation-plan.md`。
