# Cesium Engineering CLI — 架构审计报告

**文档版本**：Architecture Review v1.0  
**审计对象**：Cesium Engineering CLI v3.0  
**审计视角**：工程负责人 / 系统落地可行性  
**审计结论**：见第 8 节

---

## 执行摘要

v3 架构在概念完整性上达到了"Cesium AI Expert"的设计目标，整体方向正确。但从工程落地视角审查，存在三个核心问题：**模块并发设计导致 MVP 无法聚焦**、**两个模块的实现难度被系统性低估**、**一个模块的维护成本将在 6 个月后失控**。

本报告不新增功能，仅对现有设计做取舍裁决，并重构开发路线。

---

## 1. MVP 可落地性分析

### 1.1 模块分级裁决

```
┌────────────────────────────────────────────────────────────────┐
│                    模块优先级矩阵                                │
│                                                                │
│  高价值 ┤ Context Pack v2 ★  Problem KB ★   Skill Router ★   │
│        │ (简化版)            (静态初版)       (规则版)          │
│        │                                                       │
│  中价值 ┤ Render Pipeline    Experience      Workflow           │
│        │ Graph (简化)        Graph (分阶段)  (部分用Prompt替代) │
│        │                                                       │
│  低价值 ┤ symbol_stage_map   experience_edge  Structured        │
│  /高成本│ (启发式版)          图遍历           Answer 解析器     │
└────────┬───────────────────────────────────────────────────────┘
         低成本                                              高成本
```

**必须保留（MVP 核心）**：

| 模块 | 保留理由 | MVP 形态 |
|---|---|---|
| Symbol / CallGraph / Diff (v2) | 检索基础，无可替代 | 完整实现 |
| Problem KB | 是 Debug/Performance Skill 的核心价值，无 PKB 则诊断能力等于零 | 静态 JSON 文件初版，10–15 个问题模型，不做向量化 |
| Skill Router（规则版） | Intent 分类是 Context Pack 差异化的前提 | 仅做关键词规则 + 实体抽取，**删除向量 Fallback** |
| Context Pack v2（简化） | 对 LLM 输入质量影响最大的模块 | 保留 diagnosis + call_graph + symbol，**删除 render_stage section** |
| Experience Graph（节点层） | issue + release_note 两种 node type 足够支撑 MVP | 只建 experience_node 表，**不建 experience_edge** |

**应推迟（P1，第二阶段）**：

| 模块 | 推迟理由 |
|---|---|
| Render Pipeline Graph（symbol_stage_map） | 准确性严重依赖人工标注，MVP 阶段用 PKB 的 related_stages 静态字段替代 |
| Experience Graph 图遍历（experience_edge） | 边的质量直接影响链路可信度，需要先积累节点数据再建边 |
| Skill YAML 配置化 / 用户自定义 Skill | 内置 Skill 硬编码就足够，配置化是扩展性需求，MVP 不需要 |
| Structured Answer 按 Skill 差异化解析器 | LLM 输出 Markdown 即可，结构化 JSON 解析是工程细节，不影响核心价值 |

**应删除（当前版本不实现）**：

| 模块 | 删除理由 |
|---|---|
| Intent 分类的向量 Fallback | 需要 Embedding 推理，增加冷启动成本；关键词规则 + General Skill fallback 足够 |
| Blog 数据源（Experience Graph） | 数据量少、更新频率低、抓取需额外工程；Release Note 已能覆盖官方权威信息 |
| github_discussion node type | 与 issue / forum 高度重叠，清洗成本不低，优先级排最末 |
| `classify_intent` MCP 工具 | 调试用途，不对 Agent 暴露；内部 logging 即可 |
| L3 Experience Graph 查询缓存 | 在 Experience Graph 节点规模有限的 MVP 阶段，查询本身足够快，缓存过早引入维护复杂度 |

**应简化（降低实现复杂度）**：

| 模块 | 当前设计 | 简化方案 |
|---|---|---|
| Problem KB | SQLite 表 + Qdrant 向量 + 预计算关联表 | 静态 JSON 文件 + 关键词匹配，向量化推迟到 P1 |
| Render Pipeline Graph | symbol_stage_map（动态构建） | render_stage 表（静态，10行）+ problem 表的 related_stages 字段（替代 symbol 级别映射） |
| quality_score | 6 种类型各一套公式 | issue/forum 基于 `reactions_count`，pr 基于 `merged`，其余固定分值；一个函数搞定 |
| Context Pack Token 预算分配器 | 按 Skill 差异化的复杂分配器 | 硬编码每个 Section 的 max_token 上限，超限截断；Skill 差异通过"包含哪些 Section"控制，不做权重计算 |

### 1.2 优先级三级划分

```
P0（MVP 必须实现）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓ AST 解析 + Symbol / CallGraph / Diff 数据层（v2 完整）
  ✓ 全文检索（Tantivy）：API / Source / Issue / Release
  ✓ Problem KB 静态版（JSON 文件，10–15 个问题模型）
  ✓ Skill Router 规则版（关键词 + 实体抽取，5 个硬编码 Skill）
  ✓ Experience Graph 节点层（issue + release_note 两种 type）
  ✓ Context Pack v2（symbol + call_graph + diagnosis + experience_nodes）
  ✓ Agent Workflow（简化 5 步版，见第 5 节）
  ✓ MCP 核心工具（8 个，见第 5 节）

P1（第二阶段）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ○ Render Pipeline Graph（render_stage 静态表 + 有限 symbol_stage_map）
  ○ Experience Graph 边层（fixes / resolves / released_in 三种 certain 边）
  ○ Problem Mining Pipeline（从 Issue/PR 自动挖掘新问题模式）
  ○ Qdrant 向量检索（Symbol / Issue / Problem 向量化）
  ○ Skill Router 向量 Fallback
  ○ Forum / PR Review node type（Experience Graph 扩展）

P2（长期规划）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  △ Blog / GitHub Discussion 数据源
  △ symbol_stage_map 精细化（启发式 → 注解驱动）
  △ Skill YAML 配置化 + 用户自定义 Skill
  △ Structured Answer 多格式差异化解析
  △ 多 Embedding 模型切换（Gemini / BGE）
```

---

## 2. Render Pipeline Graph 审计

### 2.1 核心问题：Symbol → Stage Mapping 不现实

**审计结论：当前方向反了，且高估了自动化程度。**

v3 设计的 `symbol_stage_map` 是 Symbol 驱动的映射（给定一个 Symbol，找它属于哪个 Stage），这个方向在 Cesium 代码库中有两个致命问题：

**问题一：大量 Symbol 跨多个阶段**。Cesium 的 `Scene.update()` 在一次调用中依次触发 update → culling → command_build → execute 全链路。按当前设计，它的 role 会同时是 `trigger(update)` + `trigger(command_build)` + `trigger(execute_commands)`，这个映射对 LLM 毫无信息量——相当于说"这个函数参与了所有阶段"。

**问题二：启发式规则准确率极低**。v3 描述的"函数名包含 update/cull/execute"规则，在 Cesium 实际代码里会产生大量噪声。`BoundingSphere.computePlaneDistances()` 函数名无特征词，但在 culling 阶段关键；`Primitive.update()` 名字叫 update，但它主要的工作在 command_build 阶段。人工补标注意味着要给 Cesium 3000+ 个 public Symbol 中的核心 200 个写 JSDoc，工作量约 3–5 人天，且需要深度 Cesium 内核知识，不是通用工程师能完成的。

### 2.2 推荐方案：反转为 Stage → Symbol Mapping

**将建模单元从 Symbol 改为 Stage，Stage 主动标注"哪些 Symbol 在我这里工作"。**

```
render_stage 表（静态，人工维护 10 行，一次性工作）：

  id              = "command_build"
  name            = "DrawCommand Build"
  order           = 3
  perf_hotspot    = true
  description     = "每个可见 Primitive 调用 update() 生成 DrawCommand 列表"
  key_symbols     = JSON array  ← 核心改变：Stage 直接列举关键 Symbol（人工填写 5–10 个）
  symptom_hints   = JSON array  ← 该阶段出问题时的典型症状关键词
```

`key_symbols` 字段示例（`command_build` 阶段）：

```json
{
  "key_symbols": [
    "Primitive.update",
    "PrimitivePipeline.combineGeometry",
    "DrawCommand",
    "Cesium3DTileset._requestTiles"
  ],
  "symptom_hints": ["draw call", "命令", "DrawCommand 过多", "批量合并"]
}
```

**这个设计的优势**：

- 10 个阶段 × 平均 5–8 个 key_symbols = 约 70 行 JSON，人工一次性填写，不需要脚本构建
- 查询方向变为：用户问题命中某阶段的 `symptom_hints` → 返回该阶段的 `key_symbols` 作为检索种子 → 进入 CallGraph / Symbol 检索
- 完全不需要 `symbol_stage_map` 表，消除了这个高风险的自动化构建步骤

**与 PKB 的协作关系**：

```
problem.related_stages = ["command_build"]
  ↓
render_stage["command_build"].key_symbols = ["Primitive.update", "DrawCommand", ...]
  ↓
直接追加到 Retrieval Planner 的 Symbol 检索列表
```

PKB 的 `related_stages` 字段已经做了"问题 → 阶段"的映射，RPG 只需要补充"阶段 → 核心 Symbol 种子"，两者组合完全替代了原来的 `symbol_stage_map` 双向图。

### 2.3 MVP 的 RPG 实现成本

- 数据结构：SQLite 1 张表（render_stage），10 行记录，手工录入
- 查询接口：按 stage_id 查 key_symbols，1 个 SQLite 查询
- 实现工时：0.5 天

---

## 3. Problem Knowledge Base 审计

### 3.1 人工维护成本分析

**短期（0–6 个月）**：10–15 个问题模型，每个模型需要：

- 收集症状描述：约 2h / 个（需要翻阅 Issue / Forum）
- 写 diagnostic_steps：约 1h / 个（需要实际验证）
- 关联 Symbol / Stage：约 0.5h / 个

**总计首次建设成本**：约 15 个 × 3.5h = 52.5h，约 1.5 人周

**中期（6–18 个月）**：Cesium 每月发版，每版本可能带来新的问题模式（新功能 bug、性能退化）。如果纯人工维护，预计每月新增 1–3 个问题模型，每年累积约 20–30 个，维护成本约 2–4h / 月，可接受。

**但存在一个隐患**：问题的 `related_symbols` 和 `related_stages` 字段需要随版本同步更新（API 重命名后旧 stable_id 失效），这部分如果没有自动化工具辅助，会在版本积累后逐渐腐化。

### 3.2 自动化可行性评估

能自动化的部分（可信度高）：

- **候选问题发现**：从 Issue 标题 + label（bug / performance / rendering）中挖掘新问题候选，人工审核确认 ✓
- **`related_symbols` 关联**：从 Issue 正文中提取出现的 Cesium symbol 名（正则匹配 symbol 表），自动填充候选列表，人工确认 ✓
- **版本变更同步**：当 symbol_map 检测到 symbol 重命名时，自动触发告警"以下 problem 的 related_symbols 可能失效，请人工确认" ✓

不能自动化的部分（需人工）：

- `diagnostic_steps`：需要领域专家知识，无法从文本自动生成可靠步骤
- `root_cause`：因果推断，LLM 可以起草但必须人工验证
- 问题模型的最终录入决策

### 3.3 Problem Mining Pipeline 设计

这是一个**辅助人工决策**的工具，而不是全自动写入 PKB。

```
输入来源：GitHub Issue（每日增量）/ PR（每周增量）/ Forum（每周增量）

Step 1: 候选过滤
  条件：issue.labels 包含 [bug, performance, rendering, terrain, imagery]
       AND issue.comments_count >= 3（有社区讨论，非无效 issue）
       AND issue.state = closed（已有结论，问题边界清晰）
  预期：每月约 50–100 个 Issue 进入候选

Step 2: 症状聚类
  用 TF-IDF 或简单 embedding 对候选 Issue 标题做聚类
  相似度 > 0.85 的 Issue 归为同一候选问题模式
  输出：问题模式候选列表，每个候选包含：
    - 代表性 Issue 列表（Top 3 by quality_score）
    - 高频词汇（自动提取的 symptom_keywords 候选）
    - 关联 Symbol 候选（从 Issue 正文正则提取）

Step 3: LLM 起草
  对每个候选问题模式，调用 LLM：
  Prompt: "以下是 {N} 个相关的 Cesium Issue，请起草一个问题模型，
           包含：symptom_desc / root_cause / diagnostic_steps(3条)
           注意：diagnostic_steps 必须是可操作的检查步骤，不是原理描述"
  输出：problem 模型草稿（JSON）

Step 4: 人工审核界面（CLI 工具）
  命令：cesium pkb review
  展示：候选问题模式 + LLM 草稿 + 原始 Issue 列表
  操作：
    [a] 接受（写入 PKB）
    [e] 编辑后接受
    [m] 合并到已有问题模型
    [r] 拒绝
  预期审核效率：10 分钟 / 个候选（有 LLM 起草辅助）

Step 5: 写入 & 版本标注
  确认的问题模型写入 problem 表
  记录 source_issues（挖掘来源）和 created_version（发现时的 Cesium 版本）
  触发 problem.symptom_embedding 重新向量化（P1 阶段启用）
```

**成本估算**：

- Pipeline 开发工时：4–6 天（Step 1–3 自动化脚本 + Step 4 CLI 界面）
- 月度运营成本：每月审核约 10–20 个候选，约 2–3h
- 是否 MVP 必须：**否**，MVP 阶段人工直接写 JSON 文件，Mining Pipeline 在 P1 阶段实现

---

## 4. Experience Graph 审计

### 4.1 六类数据源的价值 / 质量 / 成本矩阵

| 数据源 | 对 Agent 的价值 | 数据质量 | 清洗/接入成本 | 优先级 |
|---|---|---|---|---|
| **Issue（closed/fixed）** | ★★★★★ | 高（有明确的问题+解决方案） | 低（GitHub API 直接拉取） | **P0** |
| **Release Note** | ★★★★★ | 极高（官方权威，Breaking Change 来源） | 极低（GitHub Releases API） | **P0** |
| **PR Review（merged）** | ★★★★☆ | 高（有代码层面的修复上下文） | 低（GitHub API） | **P1** |
| **Forum（有解决方案的帖子）** | ★★★★☆ | 中（信噪比约 60%，需过滤无回答帖） | 中（需要 HTML 抓取 + 清洗） | **P1** |
| **GitHub Discussion** | ★★★☆☆ | 中（与 Forum / Issue 高度重叠） | 中（GitHub GraphQL API） | **P2** |
| **Blog** | ★★★☆☆ | 高（官方技术博客内容质量好） | 中（HTML 抓取，更新频率低） | **P2** |

### 4.2 数据质量补充说明

**Issue 的陷阱**：open 状态的 Issue（未解决）对 Agent 的价值是负面的——它会让 Agent 给出"这是个已知 bug，没有解决方案"的错误结论。MVP 阶段只索引 `state=closed AND closed_as_fixed（有 fix 标记或关联 PR）` 的 Issue。

**Forum 的陷阱**：Cesium Community Forum 中约 40% 的帖子没有被标记为"Solved"，但实际上提问者已经解决了（只是没有关闭）。过滤条件应为 `replies_count >= 2 AND (marked_as_solution = true OR views_count > 200)`，不能只看 `marked_as_solution`。

**PR Review 的价值被低估**：PR 的 description 和 review comments 通常包含"为什么这样改"的因果推断，这是 Issue 和 Release Note 都没有的信息。在性能优化类问题中，merged PR 的 description 是 Context Pack 中最有价值的单一数据源。

### 4.3 建设顺序

**Phase 1（P0，MVP）**：

```
数据源：Issue (closed+fixed) + Release Note
接入方式：GitHub Releases API + Issues API（增量游标）
数据结构：experience_node 表，type 限定为 issue / release_note
边：暂不建，仅建节点
全文索引：Tantivy 覆盖 title + summary
工时估算：3–4 天（包含增量同步 Pipeline）
节点规模预估：Issue ~2000 个，Release Note ~30 个
```

**Phase 2（P1）**：

```
数据源：PR Review (merged) + Forum (has_solution)
接入方式：GitHub PRs API + Forum HTML 抓取
边建设：只建 certain 边（fixes: PR closing_issues / released_in: commit→release）
全文索引：扩展到 pr_review / forum node type
工时估算：5–7 天（Forum 抓取是主要工作量）
```

**Phase 3（P2）**：

```
数据源：GitHub Discussion + Blog
边建设：inferred 边（mentions / references），基于 URL 正则
质量分精细化
工时估算：4–5 天
```

---

## 5. Agent Workflow 审计

### 5.1 各步骤的实现必要性

```
当前 Workflow（8步）：
User Query → [1]Intent → [2]Skill Router → [3]Problem Diagnosis 
→ [4]Retrieval Planning → [5]Parallel Retrieval 
→ [6]Context Pack Build → [7]LLM Reasoning → [8]Structured Answer
```

**逐步审计**：

| 步骤 | MVP 必须实现 | 可用 Prompt 临时替代 | 需要真实系统实现 |
|---|---|---|---|
| [1] Intent Classification | **是**，但仅关键词版 | 向量 Fallback 可推迟 | 关键词规则 + 实体抽取 |
| [2] Skill Router | **是**（5个 Skill 硬编码） | 配置化可推迟 | 5 个 if/else 分支即可 |
| [3] Problem Diagnosis | **是**（PKB 匹配） | 可用 System Prompt 描述问题模式（质量差 50%） | PKB JSON 文件 + 关键词查询 |
| [4] Retrieval Planning | **是**（简化版） | 可合并进 Skill Router | Skill 配置的静态策略映射 |
| [5] Parallel Retrieval | **是** | 不可替代，是系统核心 | SQLite + Tantivy 实际查询 |
| [6] Context Pack Build | **是**（简化版） | 可用 JSON 拼接脚本简化 | 必须实现，是质量关键路径 |
| [7] LLM Reasoning | **是** | 不可替代 | 调用 LLM API |
| [8] Structured Answer | **否（MVP）** | LLM 直接返回 Markdown 即可 | 结构化 JSON 解析器推迟到 P1 |

### 5.2 MVP 简化 Workflow（5步）

```
User Query
    │
    ▼
[1] Skill Dispatch（合并 Intent + Router）
    关键词规则 → 选定 Skill（5个 if/else）
    实体抽取 → 识别 Symbol / Version / Problem 关键词
    无匹配 → General Skill
    │
    ▼
[2] Problem Diagnosis（仅当 Skill = debug / performance）
    PKB JSON 文件关键词查询（< 10ms）
    → matched_problem + diagnostic_steps + related_symbols
    无匹配 → 跳过，直接进入检索
    │
    ▼
[3] Retrieval（按 Skill 策略并发执行）
    Symbol 检索 + CallGraph（必选）
    Issue / Release 检索（必选）
    Forum 检索（api / debug Skill 选用）
    PKB 关联 Symbol 补充检索（diagnosis 命中时）
    │
    ▼
[4] Context Pack Build
    按 Section 优先级组装
    硬编码 Token 上限截断
    │
    ▼
[5] LLM Call
    System Prompt（Cesium Expert 角色）
    User Prompt（Query + Context Pack JSON）
    返回 Markdown 响应
```

**步骤 [3]、[4] 是必须真实实现的**，其余步骤可以从极简版本出发迭代。

### 5.3 System Prompt 可以临时替代的内容

MVP 阶段，以下逻辑**可以写进 System Prompt 而不是写进系统代码**：

```
"当你收到 Context Pack 时，请：
 1. 先查看 diagnosis section，如果存在，沿 diagnostic_steps 进行推理
 2. 如果 render_stage section 不存在，根据 call_graph 自行推断渲染阶段
 3. 引用 experience_nodes 时，优先引用 quality_score > 0.8 的条目
 4. 如果你不确定根因，明确说'需要更多信息'，不要猜测"
```

这样可以把 [3] Problem Diagnosis 的"诊断步骤注入"逻辑暂时放到 Prompt 层面，等验证效果后再固化到系统层。

---

## 6. 开发路线重构

### Milestone 1：能查（Query）

**目标**：Agent 能通过 MCP 工具查到 Cesium 的 Symbol、API、Issue、Release 信息，并得到结构化响应。

**功能目标**：
- 按名称搜索 Symbol，返回签名 / JSDoc / 源码位置
- 全文搜索 Issue 和 Release Note
- 查询 Symbol 的调用链（下游 3 层）
- 查询两个版本之间的 Symbol 差异

**数据来源**：
- Cesium 源码（GitHub，1.100–1.130 各版本）
- GitHub Issues API（closed，取 2000 条）
- GitHub Releases API（全量，约 30 条）

**数据结构**：

```sql
-- 核心表（来自 v2）
symbol (id, name, type, module, version, file, line_start, line_end,
        signature, description, visibility, deprecated, since_version,
        parent_class, stable_id)

file (id, path, version, hash, module)

call_graph (caller, callee, file, line, edge_type, confidence)

inheritance (child_symbol, parent_symbol, relation)

symbol_map (stable_id, version, symbol_id)

-- 新增（Milestone 1）
experience_node (id, type, title, url, source, published_at,
                 summary, related_symbols, tags, version_range, quality_score)
-- type 仅限：issue / release_note
```

**MCP Tools（Milestone 1，共 7 个）**：

```
search_api           → 模糊搜索 Symbol，返回候选列表
get_symbol_detail    → 按 id 返回 Symbol 完整信息
search_source        → 全文搜索源码
trace_call           → 调用链查询（direction / maxDepth / minConfidence）
compare_version      → 两版本 Symbol diff
search_issue         → 全文搜索 Issue（Tantivy）
build_context        → 组装 Context Pack（简化版：symbol + call_graph + issues）
```

**CLI 命令（Milestone 1）**：

```bash
cesium search <name>                    # 搜索 Symbol
cesium explain <symbol>                 # 符号详情 + 调用链
cesium trace <symbol> [--depth N]       # 调用链展开
cesium diff <symbol> <v1> <v2>         # 版本 diff
cesium issue search <keywords>          # 搜索 Issue
```

**验收标准**：

```
□ 给定 "Primitive.update"，返回正确的签名、JSDoc、文件位置
□ trace_call 返回 3 层调用链，confidence 标注正确
□ 两版本 diff 能正确识别签名变化和新增/删除 Symbol
□ Issue 全文搜索在 < 200ms 内返回 Top-10 结果
□ build_context 输出的 Context Pack 可直接作为 LLM 输入（Token < 4000）
□ 至少 3 个真实 Agent（Hermes / Codex / Claude）完成端到端查询测试
```

**工时估算**：4–5 周（1人）

---

### Milestone 2：能解释（Explain）

**目标**：在"能查"基础上，Agent 能理解"这个 Symbol 是干什么的、在渲染哪个阶段工作、历史上出过什么问题"，回答"explain / why"类问题。

**新增功能目标**：
- Problem KB 静态版接入，能对 debug/performance 类问题做症状识别
- Render Pipeline Graph（Stage → Symbol 映射，简化版）接入 Context Pack
- Forum 数据接入（Experience Graph 扩展）
- Context Pack 升级：新增 diagnosis section + render_stage section
- Skill Dispatch 正式上线（5 个 Skill）

**新增数据来源**：
- Problem KB（JSON 文件，15 个问题模型，手工维护）
- Cesium Community Forum（HTML 抓取，按 reply_count + solved 过滤）
- render_stage 静态数据（10 行，手工录入）

**新增数据结构**：

```sql
-- Problem KB（本阶段新增）
problem (id, category, name, aliases, trigger_keywords,
         symptom_desc, root_cause, diagnostic_steps,
         related_symbols, related_stages, related_settings, severity)

-- Render Pipeline Graph（简化版）
render_stage (id, name, order, description, is_optional,
              perf_hotspot, key_symbols, symptom_hints)
-- 注意：无 symbol_stage_map 表，key_symbols 直接内嵌在 render_stage

-- Experience Graph（扩展 node type）
-- experience_node 表新增 type=forum / pr_review
-- experience_edge 表（仅 certain 边：fixes / released_in）
experience_edge (from_node_id, to_node_id, relation, confidence, created_at)
```

**新增 MCP Tools（Milestone 2，共 4 个）**：

```
diagnose_problem     → 输入症状描述，返回 PKB 匹配结果 + diagnostic_steps
query_render_stage   → 输入 problem_id 或 stage_id，返回阶段 + key_symbols
search_forum         → 全文搜索 Forum（Tantivy）
search_experience    → 在 experience_node 中检索，支持 type / symbol / problem 过滤
```

**新增 CLI 命令（Milestone 2）**：

```bash
cesium diagnose "<symptom>"             # 问题诊断
cesium stage <problem_id>               # 查看渲染阶段
cesium pkb list                         # 列出所有问题模型
```

**验收标准**：

```
□ 输入 "flickering polygon"，diagnose_problem 返回 z-fighting 问题模型和 3 个诊断步骤
□ 输入 performance_degradation，query_render_stage 返回 command_build / execute_commands 阶段及 key_symbols
□ Context Pack（debug_skill）包含 diagnosis + render_stage section，Token < 5000
□ 覆盖 3 类 Skill（api / debug / performance）的 5 个真实问题端到端测试通过
□ Forum 数据接入，quality_score 过滤后信噪比 > 70%（人工评估 20 个随机样本）
```

**工时估算**：4–5 周（1人）

---

### Milestone 3：能诊断（Diagnose）

**目标**：在"能解释"基础上，Agent 能主动推断根因、给出可操作的修复建议，并能比较版本间的差异。Problem Mining Pipeline 上线，PKB 可自动扩充。

**新增功能目标**：
- Problem Mining Pipeline（自动挖掘 + 人工审核 CLI）
- Experience Graph 边层完整（inferred 边 + 图遍历查询）
- Qdrant 向量检索上线（Issue / Problem 向量化）
- Migration Skill 完整实现
- Shader Skill 接入（shader_symbol 表）
- `get_experience_chain` 接口（图遍历，返回 fix → PR → release 链路）

**新增数据来源**：
- GitHub Discussion（GraphQL API）
- Cesium Blog（HTML 抓取）
- Problem Mining Pipeline 产出（自动候选 + 人工确认）

**新增数据结构**：

```sql
-- Shader（来自 v2）
shader_symbol (id, shader_name, type, file, related_js_symbol, description)

-- Experience Graph 完整（新增 inferred 边 + 新 node type）
-- experience_node 新增 type: github_discussion / blog / commit
-- experience_edge 新增 inferred 边：mentions / references / supersedes

-- Problem Mining Pipeline 产出追踪
problem_candidate (id, source_issues, cluster_keywords, llm_draft, status, reviewed_at)
```

**新增 MCP Tools（Milestone 3）**：

```
get_experience_chain → 展开经验节点关联图（fixes / resolves / released_in）
search_shader        → 搜索 GLSL shader symbol
```

**新增 CLI 命令（Milestone 3）**：

```bash
cesium pkb review                       # 审核 Mining Pipeline 候选问题
cesium pkb mine --since <date>          # 触发问题挖掘
cesium experience chain <node_id>       # 展开经验链路
```

**验收标准**：

```
□ Problem Mining Pipeline 每周自动产出 5–10 个候选，人工审核确认 2+ 个/周
□ get_experience_chain 能返回 "Issue → fixes → PR → released_in → Release" 完整链路
□ 向量检索在语义相似问题上的召回率比纯全文检索提升 > 20%（基于 50 个测试问题集）
□ Migration Skill 能正确处理 1.118 → 1.130 的 Breaking Change 查询
□ Milestone 1–3 全覆盖：10 个真实用户问题（Cesium 社区真实 Issue）端到端答案质量评估通过
```

**工时估算**：5–6 周（1人）

---

**三个里程碑总工时估算**：约 **14–16 周（1 人）**，或 **8–10 周（2 人并行 Milestone 1 + 数据工程）**

---

## 7. 风险分析（Top 10）

```
Risk 1:
  描述：JS 动态分派导致 CallGraph 准确率低
  影响：Agent 追踪错误的调用链，给出错误的根因分析
  发生概率：高（Cesium 大量使用多态和回调）
  缓解方案：
    - edge_type 区分 static_call / dynamic_dispatch / callback
    - dynamic_dispatch 边默认不展开，仅在 Context Pack 中标注"候选实现 N 个"
    - 用实际 Cesium 源码抽样 50 个调用关系验证准确率，设置准确率下限 ≥ 70%

Risk 2:
  描述：symbol_stage_map 启发式规则覆盖率不足
  影响：RPG 功能失效，Context Pack 的 render_stage section 为空
  发生概率：高（已在第 2 节证明）
  缓解方案：
    - 放弃 symbol_stage_map，采用 Stage → Symbol（key_symbols）反向设计
    - 10 个阶段手工标注 key_symbols，一次性工作，维护成本接近零

Risk 3:
  描述：Problem KB 覆盖率不足，大量 debug 类问题无法命中 PKB
  影响：debug / performance Skill 退化为 General Skill，回答质量下降 40–60%
  发生概率：中（初期问题模型少，自然存在覆盖盲区）
  缓解方案：
    - 监控 PKB miss rate，超过 50% 时优先补录
    - General Skill 作为 fallback 保证基础可用性
    - Milestone 2 后启动 Mining Pipeline 持续扩充

Risk 4:
  描述：Intent 分类误判导致 Skill 选错
  影响：检索策略错配，Context Pack 内容偏离，LLM 无法给出正确答案
  发生概率：中（关键词规则对跨意图的问题容易误判，如"为什么 API X 这么慢"同时是 api + performance）
  缓解方案：
    - 意图歧义时选 debug_skill（覆盖最广），而非 general_skill
    - 记录每次 Skill 分发决策日志，每周人工复盘误判 case，持续更新关键词规则

Risk 5:
  描述：Forum 数据抓取被封或格式变更导致数据中断
  影响：Forum 来源的经验节点停止更新，6 个月后数据过期
  发生概率：中（社区论坛 HTML 结构可能变更）
  缓解方案：
    - Forum 抓取器隔离为独立模块，接口标准化（输入 URL，输出 normalized node）
    - 抓取失败时告警但不阻断其他数据源
    - 评估 Forum 是否有官方 API（Discourse 论坛有 REST API）

Risk 6:
  描述：Experience Graph inferred 边噪声过多，图遍历返回低质量关联
  影响：Context Pack 中混入不相关的经验节点，LLM 被误导
  发生概率：中（symbol mentions 关联是 inferred 类型，正则匹配容易误命中）
  缓解方案：
    - MVP 阶段只使用 certain 边（fixes / released_in）
    - inferred 边在 context.json 中独立标注，LLM Prompt 中说明"inferred 边仅供参考"

Risk 7:
  描述：Context Pack Token 超限，LLM 收到不完整的上下文
  影响：LLM 推理基于不完整信息，答案质量不稳定
  发生概率：中（debug_skill 的 6000 Token 预算在调用链深 + issue 多时容易超出）
  缓解方案：
    - 硬编码每个 Section 的 max_token 上限
    - 超限时截断顺序：forum → experience_nodes → source_snippet 行数缩减 → call_graph 深度减半
    - 在 skill_meta.token_used 字段记录实际使用量，设监控报警

Risk 8:
  描述：Cesium 版本升级导致 Symbol 大规模重命名，symbol_map fuzzy 匹配失效
  影响：Diff Engine 对重命名后的 Symbol 无法建立跨版本关联
  发生概率：低（Cesium 重命名频率较低，但 API 废弃重组时会出现）
  缓解方案：
    - symbol_map fuzzy 匹配加入 commit history 分析（git log 追踪文件移动）
    - 无法匹配的 Symbol 在 Diff 结果中显式标注为"身份不明，可能是重命名"
    - 不要假设 fuzzy 匹配一定正确，始终附带 confidence 字段

Risk 9:
  描述：AST 解析在 Cesium 旧版本（原型链写法）失败率高
  影响：1.100–1.105 等早期版本 Symbol 覆盖率低
  发生概率：中（Cesium 1.10x 时代仍有大量原型链写法）
  缓解方案：
    - 解析器对 Babel 报错的文件降级处理：仅提取 export 列表而非完整 AST
    - 每个版本解析完成后输出覆盖率报告（成功解析文件数 / 总文件数）
    - 允许版本间解析覆盖率不同，Symbol 数量差异在 Context Pack 中透明标注

Risk 10:
  描述：单人维护系统，知识库（PKB / symbol_stage_map）与 Cesium 实际版本脱节
  影响：Agent 给出过时的诊断建议（如引用已废弃 API 的修复方案）
  发生概率：高（中长期必然发生）
  缓解方案：
    - Problem KB 的每个 problem 记录 last_verified_version，超过 3 个版本未更新时标注"可能过时"
    - Mining Pipeline 的月度运营（2–3h/月）是维持知识库新鲜度的底线投入，不可取消
    - Cesium Release Note 自动摘要纳入 Context Pack，让 LLM 本身也能感知到版本差异
```

---

## 8. 最终结论

### 8.1 架构评分

| 维度 | 评分 | 说明 |
|---|---|---|
| **架构完整度** | 9 / 10 | 从 Symbol 到 Workflow 覆盖完整，PKB + RPG + Experience Graph 闭环逻辑清晰 |
| **工程可落地性** | 5 / 10 | symbol_stage_map 构建不可行，PKB 人工成本估算不足，Experience Graph 6类一次性建设过重，MVP 边界不清 |
| **长期扩展性** | 8 / 10 | 模块解耦合理，Stage→Symbol 反向设计后 RPG 扩展成本低，Mining Pipeline 解决 PKB 长期维护问题 |
| **MVP 友好度** | 4 / 10 | 三个里程碑等价，没有可以在 2 周内跑通的最小路径；Phase 5–7 每个都是 4–8 周工程量 |

### 8.2 推荐冻结版本

```
Freeze: v3.1
```

**冻结内容（v3.1 = v2 完整 + v3 裁剪版）**：

立即开始开发（Milestone 1 + 2）：

```
✓ v2 全部内容（Symbol / CallGraph / Diff / Context Pack v1 / Data Sync Pipeline）
✓ Experience Graph 节点层（issue + release_note，无边）
✓ Problem KB 静态 JSON（10–15 个问题模型，手工维护）
✓ Render Pipeline Graph（render_stage 10 行静态表，Stage→Symbol 反向设计）
✓ Skill Dispatch 规则版（5 个 Skill，硬编码 if/else）
✓ Context Pack v2（symbol + call_graph + diagnosis + experience_nodes，4 Section）
✓ Agent Workflow 简化 5 步版
✓ MCP Tools（11 个：v2 的 8 个 + diagnose_problem + query_render_stage + search_experience）
```

暂不实现（推迟到 Milestone 3 / P1 / P2）：

```
✗ symbol_stage_map 动态构建（替换为 render_stage.key_symbols 静态字段）
✗ experience_edge 图遍历（先建节点，边在 M3 阶段）
✗ Intent 向量 Fallback（关键词规则 + General Skill 兜底足够）
✗ Skill YAML 配置化（硬编码先行）
✗ Structured Answer 多格式解析器（LLM 返回 Markdown 即可）
✗ Blog / GitHub Discussion 数据源
✗ Problem Mining Pipeline（M3 实现，M1/M2 阶段手工维护 PKB）
✗ L3 Experience Graph 查询缓存（节点规模有限时查询足够快）
✗ classify_intent MCP 工具（内部 logging 即可，不对外暴露）
```

**v3.1 核心判断**：当前 v3.0 的架构方向完全正确，问题在于把 P0 / P1 / P2 的工作混放在了同一个阶段。v3.1 冻结版本不裁减任何模块，只是把实现顺序拨正，并修正了 Render Pipeline Graph 中不可行的 symbol_stage_map 设计。在 Milestone 1 跑通后（4–5 周），团队将有真实 Agent 使用数据来验证哪些 P1 模块最值得优先实现，避免在没有用户数据的情况下过早投入 Experience Graph 边层和向量检索等高成本功能。
