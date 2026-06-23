# Future Roadmap — cesium-nexus

本文档归档所有不在当前 MVP（Phase 1: Can Query）范围内的功能。待 MVP 交付并通过验收后，按优先级依次推进。

---

## Phase 2A: Problem Diagnosis ✅ 完成

**目标：** Debug First / Problem Diagnosis First — 让系统能围绕真实 Cesium 问题回答"为什么会发生、在哪里发生、如何排查、如何修复"。

### 已实现功能

| 功能 | 状态 |
|---|---|
| Problem KB（静态 JSON） | ✅ 10 个问题模式 |
| Render Stage KB（静态 JSON） | ✅ 9 个诊断阶段 |
| Diagnosis Matcher（关键词匹配） | ✅ |
| DiagnosticContextPack | ✅ Token budget 6000 |
| `cesium diagnose` / `cesium pkb list` / `cesium stage` | ✅ |
| `diagnose_problem` / `query_render_stage` MCP tools | ✅ |

---

## Phase 2B: Render Pipeline Intelligence ✅ 完成

**目标：** 在 Problem Diagnosis 基础上，Agent 能理解完整渲染管线，回答"explain / why"类问题。

### 已实现功能

| 功能 | 状态 |
|---|---|
| Render Pipeline Graph（完整版） | ✅ 12 个阶段 + DAG 依赖 + 环检测 |
| Skill Dispatch（规则版） | ✅ 5 个 Skill + 关键词评分 + 实体增强 |
| Context Pack v2 | ✅ Skill 差异化 Token 预算 + 渐进截断 |
| Forum Crawler（Discourse JSON API） | ✅ 质量评分过滤 |
| GitHub PR Sync（merged） | ✅ 增量游标 |
| Experience Node（统一检索层） | ✅ type/symbol/quality 过滤 |
| `@cesium-nexus/skills` 包 | ✅ router + extractor + builder + budget |

### 已实现 MCP Tools

| Tool | 状态 |
|---|---|
| `search_forum` | ✅ |
| `search_experience` | ✅ |
| `dispatch_skill` | ✅ |
| `build_skill_pack` | ✅ |

### 已实现 CLI 命令

```bash
cesium forum sync                          # 爬取 Forum
cesium forum search <keywords>             # 搜索 Forum
cesium skills list                         # 列出技能配置
cesium dispatch <query>                    # 查看技能分发结果
cesium skill-pack <query>                  # 构建 Skill-aware Context Pack v2
cesium pipeline [stage_id]                 # 查看渲染管线 DAG
```

---

## Phase 2C: Experience Graph ✅ 完成

**目标：** 在已有 ExperienceNode 基础上，建立节点间的关联边（`fixes`），形成可遍历的经验图谱。

### 已实现功能

| 功能 | 状态 |
|---|---|
| `experience_edge` 表（SQLite） | ✅ `fixes` 确定性边 |
| Edge Builder（PR closingIssueReferences → fixes 边） | ✅ |
| BFS 图遍历（downstream / upstream / connected） | ✅ depth-limited, cycle-safe |
| `getExperienceChain` 查询 | ✅ |
| `ExperienceEdgeStats` 统计 | ✅ |

### 已实现 MCP Tools

| Tool | 状态 |
|---|---|
| `get_experience_chain` | ✅ |

### 已实现 CLI 命令

```bash
cesium experience search <keywords>        # FTS5 检索
cesium experience rebuild                  # 全量重建节点 + 边
cesium experience chain <node_id>          # 查看经验链
cesium experience stats                    # 图谱统计
```

---

## Phase 2C+: Qdrant Vector Search Integration ✅ 完成

**目标：** 将 Experience Graph 与向量语义检索结合，支持基于语义相似性的推断性边和语义搜索。

### 已实现功能

| 功能 | 状态 |
|---|---|
| `@cesium-nexus/vector` 包 | ✅ embedding + Qdrant client |
| 本地 ONNX Embedding（Xenova/all-MiniLM-L6-v2, 384 维） | ✅ |
| 全量 Embed Experience Nodes | ✅ batch upsert |
| `references` 推断边（cosine > 0.85） | ✅ |
| 语义搜索（query → embed → Qdrant search） | ✅ |
| 动态 import 避免 eager loading `sharp` | ✅ |

### 已实现 MCP Tools

| Tool | 状态 |
|---|---|
| `semantic_search_experience` | ✅ |

### 已实现 CLI 命令

```bash
cesium experience embed                          # 全量 embed 到 Qdrant
cesium experience semantic <query>               # 语义搜索
cesium experience references                     # 构建 references 边
```

---

## Phase 2D: Diagnosis Retrieval Enhancement ✅ 完成

**目标：** 将向量语义检索集成到 diagnosis 管线，实现 Hybrid Search（关键词 + 向量）+ Score Fusion + Experience 统一召回。

### 已实现功能

| 功能 | 状态 |
|---|---|
| Hybrid Matcher（6 信号：alias/keyword/symptom/symbol/category + vector） | ✅ WEIGHT_VECTOR=3, threshold=0.75 |
| PKB 向量化（Problem Patterns + Render Stages embed 到 Qdrant） | ✅ `embed-pkb.ts` |
| 统一语义搜索（跨 pattern/stage/experience） | ✅ `searchKnowledgeBase` |
| Score Fusion（`DiagnosisMatch.vectorScore`） | ✅ |
| Experience 统一召回（`relatedExperiences` in DiagnosticContextPack） | ✅ |
| Token Budget 集成（relatedExperiences 截断优先级） | ✅ |
| `semanticSearch` 泛化过滤条件 | ✅ 多类型支持 |
| Graceful fallback（Qdrant 不可用时降级为 keyword-only） | ✅ |

### 已实现 CLI 命令

```bash
cesium pkb embed                                  # Embed patterns + stages 到 Qdrant
cesium pkb search <query>                         # 统一语义搜索（--type pattern|stage|experience）
cesium diagnose <problem> --hybrid                # Hybrid 诊断（向量 + 关键词 + 经验召回）
```

### 已实现 MCP 增强

| Tool | 变更 |
|---|---|
| `diagnose_problem` | ✅ 新增 `hybrid` 参数（tool count 保持 13） |

---

## Phase 2E: Problem Mining Pipeline

**目标：** 从 issue/forum 数据中自动挖掘高频问题模式，生成 PKB 候选，实现知识库自动扩展。

### 新增功能

| 功能 | 说明 |
|---|---|
| 自动 Pattern 发现 | 从 issue/forum 数据中挖掘高频问题模式 |
| Pattern 建议生成 | 基于向量聚类发现新的 problem pattern 候选 |
| Pattern 质量评估 | 评估现有 pattern 的覆盖率和命中率 |
| 自动 KB 扩展 | 将高置信度挖掘结果追加到 `problem-patterns.json` |

---

## Phase 3: Can Diagnose

**目标：** Agent 能主动推断根因、给出可操作的修复建议，并能比较版本间的差异。

### 新增功能

| 功能 | 说明 |
|---|---|
| Migration Skill | 跨版本 Breaking Change 查询 |
| Shader Skill | GLSL shader symbol 检索 |
| Cross-version Diff | 两版本间 Symbol diff 比较 |

### 新增 MCP Tools

| Tool | 说明 |
|---|---|
| `search_shader` | 搜索 GLSL shader symbol |
| `compare_version` | 两版本 Symbol diff |

### 新增 CLI 命令

```bash
cesium pkb review                    # 审核 Mining Pipeline 候选问题
cesium pkb mine --since <date>       # 触发问题挖掘
cesium experience chain <node_id>    # 展开经验链路
cesium diff <symbol> <v1> <v2>      # 版本 diff
```

### 新增数据源

- GitHub Discussion（GraphQL API）
- Cesium Blog（HTML 抓取）
- Problem Mining Pipeline 产出

### 新增数据结构

```sql
shader_symbol (id, shader_name, type, file, related_js_symbol, description)

problem_candidate (id, source_issues, cluster_keywords, llm_draft, status, reviewed_at)

-- experience_node 新增 type: github_discussion / blog / commit
-- experience_edge 新增 inferred 边: mentions / references / supersedes
```

### 验收标准

- Mining Pipeline 每周产出 5–10 个候选，人工确认 2+ 个/周
- 向量检索在语义相似问题上召回率比全文检索提升 > 20%
- Migration Skill 能正确处理 1.118 → 1.130 的 Breaking Change
- 10 个真实用户问题端到端答案质量评估通过

**预估工时：** 5–6 周（1 人）

---

## MVP 明确不实现的功能

以下功能在当前阶段（MVP / Phase 1）**禁止实现**，统一归入后续 Phase：

| 功能 | 归入 Phase | 理由 |
|---|---|---|
| ~~Problem KB~~ | ~~Phase 2~~ → ✅ Phase 2A 已实现 | 静态 JSON + 关键词匹配 |
| ~~Skill Router / Dispatch~~ | ~~Phase 2D~~ → ✅ Phase 2B 已实现 | 5 个 Skill 硬编码 + 关键词评分 |
| Experience Graph | Phase 2C+ → ✅ Phase 2C 已实现（fixes 边）+ Phase 2C+ 已实现（references 推断边） | 确定性边 + BFS 遍历 + 语义相似边 |
| ~~Render Graph~~ | ~~Phase 2~~ → ✅ Phase 2A 已实现（简化版） | 9 个诊断阶段 → Phase 2B 扩展为 12 阶段 DAG |
| Loop Agent | — | 不在规划范围内 |
| Auto Fix / Auto Patch | — | 不在规划范围内 |
| Auto Code Generation | — | 不在规划范围内 |
| ~~Forum Crawler~~ | ~~Phase 2B~~ → ✅ Phase 2B 已实现 | Discourse JSON API + 质量评分 |
| Blog Sync | Phase 3 (P2) | 数据量少，Release Note 已覆盖官方信息 |
| GitHub Discussion | Phase 3 (P2) | 与 Issue/Forum 高度重叠 |
| Intent 向量 Fallback | — | 已删除：关键词规则 + General Skill 兜底足够 |
| Skill YAML 配置化 | P1+ | 内置 Skill 硬编码就够，配置化是扩展性需求 |
| Structured Answer 解析器 | P1+ | LLM 返回 Markdown 即可 |
| `classify_intent` MCP 工具 | — | 已删除：内部 logging 即可，不对外暴露 |
| L3 Experience Graph 缓存 | P1+ | 节点规模有限时查询足够快 |

---

## 技术栈演进

| 组件 | MVP (Phase 1) | Phase 2A | Phase 2B | Phase 3 |
|---|---|---|---|---|
| 全文检索 | SQLite FTS5 | SQLite FTS5 | SQLite FTS5 | SQLite FTS5 + Qdrant 向量 ✅ |
| AST 解析 | ts-morph + Babel Parser | 同左 | 同左 | 同左 |
| MCP Tools | 5 个 | 7 个 | 11 个 | 13 个 ✅ |
| Context Pack | 4 sections | 4 sections | 5+ sections (skill-aware) | 6+ sections |
| Token Budget | 4000–6000（硬编码） | 6000（diagnosis） | 4000–6000（按 Skill 差异化） | 同左 |
| Problem KB | — | 静态 JSON + 关键词匹配 | 同左 | 静态 JSON + 向量化 |

---

## 参考文档

- 架构审计报告：[`设计文档/Cesium-Architecture-Review-v3.md`](./设计文档/Cesium-Architecture-Review-v3.md)
- MVP 实施计划：[`开发计划/plan.md`](./开发计划/plan.md)
- **后续计划（Phase 2D 收尾 + Phase 2E）：[`开发计划/follow-up-plan.md`](./开发计划/follow-up-plan.md)**
- 项目 README：[`README.md`](./README.md)

---

**总工时估算（三阶段）：** 约 14–16 周（1 人），或 8–10 周（2 人并行）
