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

## Phase 2B: Render Pipeline Intelligence

**目标：** 在 Problem Diagnosis 基础上，Agent 能理解完整渲染管线，回答"explain / why"类问题。

### 新增功能

| 功能 | 说明 |
|---|---|
| Render Pipeline Graph（完整版） | 扩展 render_stage 到完整管线，增加 stage 间依赖关系 |
| Skill Dispatch（规则版） | 5 个 Skill 硬编码（api / debug / performance / shader / general），关键词规则 + 实体抽取 |
| Context Pack v2 | 新增 `render_stage` section，Token 预算按 Skill 差异化 |

### 新增 MCP Tools

| Tool | 说明 |
|---|---|
| `search_forum` | 全文搜索 Forum 帖子 |
| `search_experience` | 在 experience_node 中检索，支持 type / symbol / problem 过滤 |

### 新增 CLI 命令

```bash
cesium forum search <keywords>   # 搜索 Forum
```

### 新增数据源

- Cesium Community Forum（HTML 抓取）
- GitHub PRs（merged，description + review comments）

### 验收标准

- Context Pack（debug_skill）包含 render_stage section
- Forum 数据接入后信噪比 > 70%（人工评估 20 个随机样本）

**预估工时：** 3–4 周（1 人）

---

## Phase 2C: Semantic Retrieval

**目标：** 引入向量检索，让语义相似的问题能被召回。

### 新增功能

| 功能 | 说明 |
|---|---|
| Qdrant 向量检索 | Issue / Problem 向量化，语义搜索 |
| Experience Graph 扩展 | 新增 `forum` / `pr_review` node type |
| Experience Graph 边层 | 仅建 `certain` 边（`fixes` / `released_in`） |

### 新增 MCP Tools

| Tool | 说明 |
|---|---|
| `search_experience` | 在 experience_node 中检索，支持 type / symbol / problem 过滤 |

### 验收标准

- 向量检索在语义相似问题上召回率比全文检索提升 > 20%

**预估工时：** 2–3 周（1 人）

---

## Phase 2D: Agent Context System

**目标：** 完整的 Agent 上下文系统，支持 Skill Dispatch 和 Experience Graph。

### 新增功能

| 功能 | 说明 |
|---|---|
| Skill Dispatch（规则版） | 5 个 Skill 硬编码（api / debug / performance / shader / general），关键词规则 + 实体抽取 |
| Experience Graph 完整 | inferred 边（`mentions` / `references` / `supersedes`） + 图遍历查询 |

---

## Phase 3: Can Diagnose

**目标：** Agent 能主动推断根因、给出可操作的修复建议，并能比较版本间的差异。Problem Mining Pipeline 上线，PKB 可自动扩充。

### 新增功能

| 功能 | 说明 |
|---|---|
| Problem Mining Pipeline | 从 Issue/PR/Forum 自动挖掘问题候选 + 人工审核 CLI |
| Experience Graph 完整 | inferred 边（`mentions` / `references` / `supersedes`） + 图遍历查询 |
| Qdrant 向量检索 | Issue / Problem 向量化，语义搜索 |
| Migration Skill | 跨版本 Breaking Change 查询 |
| Shader Skill | GLSL shader symbol 检索 |
| `get_experience_chain` | 图遍历：返回 fix → PR → release 完整链路 |
| Cross-version Diff | 两版本间 Symbol diff 比较 |

### 新增 MCP Tools

| Tool | 说明 |
|---|---|
| `get_experience_chain` | 展开经验节点关联图 |
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
| Skill Router / Dispatch | Phase 2D | MVP 仅做检索，不做意图分类 |
| Experience Graph | Phase 2C+ | 先积累节点数据，再建边 |
| ~~Render Graph~~ | ~~Phase 2~~ → ✅ Phase 2A 已实现（简化版） | 9 个诊断阶段 |
| Loop Agent | — | 不在规划范围内 |
| Auto Fix / Auto Patch | — | 不在规划范围内 |
| Auto Code Generation | — | 不在规划范围内 |
| Forum Crawler | Phase 2B | HTML 抓取成本高，优先级低于 Issue |
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
| 全文检索 | SQLite FTS5 | SQLite FTS5 | SQLite FTS5 | SQLite FTS5 + Qdrant 向量 |
| AST 解析 | ts-morph + Babel Parser | 同左 | 同左 | 同左 |
| MCP Tools | 5 个 | 7 个 | 9 个 | 12+ 个 |
| Context Pack | 4 sections | 4 sections | 5 sections | 6+ sections |
| Token Budget | 4000–6000（硬编码） | 6000（diagnosis） | 5000–6000（按 Skill 差异化） | 同左 |
| Problem KB | — | 静态 JSON + 关键词匹配 | 同左 | 静态 JSON + 向量化 |

---

## 参考文档

- 架构审计报告：[`设计文档/Cesium-Architecture-Review-v3.md`](./设计文档/Cesium-Architecture-Review-v3.md)
- MVP 实施计划：[`开发计划/plan.md`](./开发计划/plan.md)
- 项目 README：[`README.md`](./README.md)

---

**总工时估算（三阶段）：** 约 14–16 周（1 人），或 8–10 周（2 人并行）
