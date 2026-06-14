# Future Roadmap — cesium-nexus

本文档归档所有不在当前 MVP（Phase 1: Can Query）范围内的功能。待 MVP 交付并通过验收后，按优先级依次推进。

---

## Phase 2: Can Explain

**目标：** 在"能查"基础上，Agent 能理解 Symbol 的用途、在渲染管线中的位置、以及历史上出过什么问题，回答"explain / why"类问题。

### 新增功能

| 功能 | 说明 |
|---|---|
| Problem KB（静态版） | 10–15 个问题模型的 JSON 文件，关键词匹配，不做向量化 |
| Render Pipeline Graph（简化版） | `render_stage` 静态表（10 行），Stage → Symbol 反向设计（`key_symbols` 字段） |
| Skill Dispatch（规则版） | 5 个 Skill 硬编码（api / debug / performance / shader / general），关键词规则 + 实体抽取 |
| Context Pack v2 | 新增 `diagnosis` + `render_stage` section，Token 预算升至 5000–6000 |
| Forum 数据接入 | Cesium Community Forum HTML 抓取，按 reply_count + solved 过滤 |
| Experience Graph 扩展 | 新增 `forum` / `pr_review` node type |
| Experience Graph 边层 | 仅建 `certain` 边（`fixes` / `released_in`） |

### 新增 MCP Tools

| Tool | 说明 |
|---|---|
| `diagnose_problem` | 输入症状描述，返回 PKB 匹配结果 + diagnostic_steps |
| `query_render_stage` | 输入 problem_id 或 stage_id，返回阶段 + key_symbols |
| `search_forum` | 全文搜索 Forum 帖子 |
| `search_experience` | 在 experience_node 中检索，支持 type / symbol / problem 过滤 |

### 新增 CLI 命令

```bash
cesium diagnose "<symptom>"      # 问题诊断
cesium stage <problem_id>        # 查看渲染阶段
cesium pkb list                  # 列出所有问题模型
cesium forum search <keywords>   # 搜索 Forum
```

### 新增数据源

- Problem KB（JSON 文件，手工维护）
- Cesium Community Forum（HTML 抓取）
- render_stage 静态数据（10 行，手工录入）
- GitHub PRs（merged，description + review comments）

### 新增数据结构

```sql
problem (id, category, name, aliases, trigger_keywords,
         symptom_desc, root_cause, diagnostic_steps,
         related_symbols, related_stages, related_settings, severity)

render_stage (id, name, order, description, is_optional,
              perf_hotspot, key_symbols, symptom_hints)

experience_edge (from_node_id, to_node_id, relation, confidence, created_at)
-- experience_node 表新增 type=forum / pr_review
```

### 验收标准

- 输入 "flickering polygon"，`diagnose_problem` 返回 z-fighting 问题模型和 3 个诊断步骤
- Context Pack（debug_skill）包含 diagnosis + render_stage section
- Forum 数据接入后信噪比 > 70%（人工评估 20 个随机样本）

**预估工时：** 4–5 周（1 人）

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
| Problem KB | Phase 2 | 需要 Skill Dispatch 配合，MVP 不需要 |
| Skill Router / Dispatch | Phase 2 | MVP 仅做检索，不做意图分类 |
| Experience Graph | Phase 2+ | 先积累节点数据，再建边 |
| Render Graph | Phase 2 | 需要人工标注 key_symbols，MVP 不做 |
| Loop Agent | — | 不在规划范围内 |
| Auto Fix / Auto Patch | — | 不在规划范围内 |
| Auto Code Generation | — | 不在规划范围内 |
| Forum Crawler | Phase 2 | HTML 抓取成本高，优先级低于 Issue |
| Blog Sync | Phase 3 (P2) | 数据量少，Release Note 已覆盖官方信息 |
| GitHub Discussion | Phase 3 (P2) | 与 Issue/Forum 高度重叠 |
| Intent 向量 Fallback | — | 已删除：关键词规则 + General Skill 兜底足够 |
| Skill YAML 配置化 | P1+ | 内置 Skill 硬编码就够，配置化是扩展性需求 |
| Structured Answer 解析器 | P1+ | LLM 返回 Markdown 即可 |
| `classify_intent` MCP 工具 | — | 已删除：内部 logging 即可，不对外暴露 |
| L3 Experience Graph 缓存 | P1+ | 节点规模有限时查询足够快 |

---

## 技术栈演进

| 组件 | MVP (Phase 1) | Phase 2 | Phase 3 |
|---|---|---|---|
| 全文检索 | SQLite FTS5 | SQLite FTS5 | SQLite FTS5 + Qdrant 向量 |
| AST 解析 | ts-morph + Babel Parser | 同左 | 同左 |
| MCP Tools | 5 个 | 9 个 | 12+ 个 |
| Context Pack | 4 sections | 6 sections | 6+ sections |
| Token Budget | 4000–6000（硬编码） | 5000–6000（按 Skill 差异化） | 同左 |
| Problem KB | — | 静态 JSON + 关键词匹配 | 静态 JSON + 向量化 |

---

## 参考文档

- 架构审计报告：[`设计文档/Cesium-Architecture-Review-v3.md`](./设计文档/Cesium-Architecture-Review-v3.md)
- MVP 实施计划：[`开发计划/plan.md`](./开发计划/plan.md)
- 项目 README：[`README.md`](./README.md)

---

**总工时估算（三阶段）：** 约 14–16 周（1 人），或 8–10 周（2 人并行）
