# Phase 2A: Problem Diagnosis（Cesium 问题诊断）

## 目标

Phase 2A 的核心定位是 **Debug First / Problem Diagnosis First**。

本阶段不以 API 文档问答为核心，也不以渲染管线教学为核心。目标是让系统能够围绕真实 Cesium 问题回答：

```text
为什么会发生？
在哪里发生？
如何排查？
如何修复？
```

用户输入例如：

```text
为什么我的 polygon 出现 flickering？
```

系统输出应包含：

- Possible Causes
- Render Stages
- Related Symbols
- Related Source
- Related Issues
- Investigation Steps
- Possible Fixes

本阶段完成后，系统应能对以下问题给出有价值诊断：

```text
Polygon Flickering
Z-Fighting
Primitive 性能下降
3D Tiles 抖动
Label 消失
GroundPrimitive 与 Terrain 冲突
Depth Test 异常
Picking Failure
Shader Compile Error
LOD Popping
```

---

## 关键设计决策

### 1. Problem KB 优先

Phase 2A 采用静态 Problem KB 作为诊断入口。

```text
用户症状
  -> ProblemPattern 规则匹配
  -> 相关 Symbol / Source / CallGraph / Issue
  -> Render Stage 辅助说明
  -> Diagnostic Context Pack
```

不引入 embedding、vector search、semantic retrieval、rerank 或 Agent workflow。

原因：

- 可控
- 可解释
- 可测试
- 可快速验收
- 与 Phase 1 已有检索能力直接衔接

### 2. Render Stage 只做诊断辅助

本阶段会建立轻量 `renderStages` 静态数据，但不做完整 Render Pipeline Intelligence。

Render Stage 的职责是回答：

```text
这个问题大概发生在哪个渲染阶段？
哪些核心 Symbol 相关？
```

不是回答：

```text
完整 Cesium 渲染管线如何教学式展开？
```

完整管线智能留到 Phase 2B。

### 3. Context Pack v2 独立于 Phase 1 ContextPack

Phase 1 的 `ContextPack` 保持稳定，不破坏现有 `build_context_pack`。

Phase 2A 新增：

```ts
DiagnosticContextPack
```

用于 `diagnose_problem` 和 `cesium diagnose`。

---

## 数据流

```text
用户输入 "why polygon flickering"
  -> normalizeQuery()
  -> matchProblemPatterns()
  -> 命中 z_fighting / depth_precision / terrain_conflict
  -> relatedSymbols:
       PolygonGeometry / Primitive / GroundPrimitive / ClassificationPrimitive / Scene
  -> SymbolRepo:
       resolve symbol + source snippet
  -> CallGraphRepo:
       downstream / upstream edges
  -> IssueRepo:
       issueQueries FTS search
  -> renderStages:
       depth_pass / opaque_pass / classification_stage
  -> investigationSteps + fixSuggestions
  -> truncateDiagnosticPack(6000 tokens)
  -> 输出 DiagnosticContextPack
```

---

## 新增数据结构

### ProblemPattern

新增到 `packages/shared/src/types.ts`：

```ts
export interface ProblemPattern {
  id: string;
  name: string;
  category: "debug" | "performance" | "rendering" | "terrain" | "tiles" | "shader";
  severity: "low" | "medium" | "high";
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
```

### RenderStage

```ts
export interface RenderStage {
  id: string;
  name: string;
  order: number;
  description: string;
  keySymbols: string[];
  symptomHints: string[];
}
```

### DiagnosticContextPack

```ts
export interface DiagnosticContextPack {
  kind: "diagnosis";
  query: string;
  matchedPatterns: DiagnosisMatch[];
  renderStages: RenderStage[];
  relatedSymbols: SymbolRecord[];
  relatedSource: SourceSnippet[];
  callgraph: Edge[];
  relatedIssues: IssueRecord[];
  investigationSteps: string[];
  fixSuggestions: string[];
  metadata: {
    totalTokens: number;
    truncated: boolean;
    tokenBudget: number;
  };
}
```

---

## 新增静态数据

### Problem KB

新增：

```text
data/problem-kb/problem-patterns.json
```

初版收录 10 个问题模式：

| id | 问题 |
|---|---|
| `z_fighting` | Z-Fighting / Polygon Flickering |
| `depth_precision` | 深度精度不足 |
| `terrain_conflict` | Terrain 与 GroundPrimitive 冲突 |
| `primitive_performance` | Primitive 性能下降 |
| `label_visibility` | Label 消失 |
| `tiles_jitter` | 3D Tiles 抖动 |
| `tiles_loading` | 3D Tiles 加载失败 |
| `picking_failure` | Picking 失败 |
| `shader_compile_error` | Shader 编译错误 |
| `lod_popping` | LOD Popping |

### Render Stage KB

新增：

```text
data/problem-kb/render-stages.json
```

初版收录诊断相关阶段：

| id | 阶段 |
|---|---|
| `update_stage` | Update Stage |
| `command_build_stage` | Command Build Stage |
| `depth_pass` | Depth Pass |
| `opaque_pass` | Opaque Pass |
| `translucent_pass` | Translucent Pass |
| `classification_stage` | Classification Stage |
| `picking_stage` | Picking Stage |
| `tileset_traversal_stage` | 3D Tiles Traversal Stage |
| `shader_compile_stage` | Shader Compile Stage |

### Evaluation Dataset

新增：

```text
data/evaluation/phase2a-diagnosis-cases.json
```

至少 10 个 case，每个 case 包含：

```ts
{
  query: string;
  expectedPatterns: string[];
  expectedSymbols: string[];
}
```

---

## 新增包

新增：

```text
packages/diagnosis/
```

职责：

- 读取静态 KB
- 校验静态 KB
- 匹配用户症状到 ProblemPattern
- 组装 DiagnosticContextPack
- token budget 截断

不负责：

- CLI 参数解析
- MCP tool 注册
- SQLite schema 初始化
- 网络抓取
- 向量检索

包结构：

```text
packages/diagnosis/src/
  index.ts
  knowledge-loader.ts
  matcher.ts
  diagnoser.ts
  token-budget.ts
  knowledge-loader.test.ts
  matcher.test.ts
  diagnoser.test.ts
  token-budget.test.ts
  evaluation.test.ts
```

---

## 实施步骤

### Step 1：扩展 shared types

修改：

```text
packages/shared/src/types.ts
```

新增：

- `ProblemCategory`
- `ProblemSeverity`
- `ProblemPattern`
- `RenderStage`
- `DiagnosisMatch`
- `DiagnosisMetadata`
- `DiagnosisResult`
- `DiagnosticContextPack`

验收：

```bash
pnpm typecheck
```

---

### Step 2：新增静态 KB 数据

新增：

```text
data/problem-kb/problem-patterns.json
data/problem-kb/render-stages.json
data/evaluation/phase2a-diagnosis-cases.json
```

要求：

- ProblemPattern ID 稳定，不随意重命名
- aliases 覆盖英文和常见 Cesium 术语
- relatedSymbols 使用 Cesium 中真实 Symbol 名称
- relatedStages 必须能在 `render-stages.json` 中找到
- issueQueries 面向已有 Issue FTS 查询

验收：

```text
problem-patterns.json 至少 10 条
render-stages.json 至少 8 条
phase2a-diagnosis-cases.json 至少 10 条
```

---

### Step 3：新增 diagnosis package

新增：

```text
packages/diagnosis/package.json
packages/diagnosis/tsconfig.json
packages/diagnosis/tsup.config.ts
packages/diagnosis/src/index.ts
```

依赖：

```json
{
  "@cesium-nexus/shared": "workspace:*",
  "@cesium-nexus/storage": "workspace:*"
}
```

验收：

```bash
pnpm --filter @cesium-nexus/diagnosis build
```

---

### Step 4：Knowledge Loader

新增：

```text
packages/diagnosis/src/knowledge-loader.ts
packages/diagnosis/src/knowledge-loader.test.ts
```

导出：

```ts
loadProblemPatterns(filePath?: string): ProblemPattern[]
loadRenderStages(filePath?: string): RenderStage[]
validateProblemPatterns(patterns: ProblemPattern[]): ProblemPattern[]
validateRenderStages(stages: RenderStage[]): RenderStage[]
```

校验规则：

- ID 不能为空
- ID 不能重复
- `triggerKeywords` 不能为空
- `symptoms` 不能为空
- `possibleCauses` 不能为空
- `relatedSymbols` 不能为空
- `relatedStages` 不能为空
- `investigationSteps` 不能为空
- `fixSuggestions` 不能为空

验收：

```bash
pnpm test packages/diagnosis/src/knowledge-loader.test.ts
```

---

### Step 5：Problem Matcher

新增：

```text
packages/diagnosis/src/matcher.ts
packages/diagnosis/src/matcher.test.ts
```

导出：

```ts
normalizeQuery(query: string): string[]
matchProblemPatterns(
  query: string,
  patterns: ProblemPattern[],
  limit?: number,
): DiagnosisMatch[]
```

匹配策略：

| 来源 | 权重 |
|---|---|
| alias phrase match | 高 |
| trigger keyword match | 中 |
| symptom token overlap | 中 |
| related symbol mention | 低 |
| category keyword match | 低 |

返回结果必须包含：

```ts
matchedKeywords: string[]
```

用于解释为什么命中。

验收：

```text
"polygon flickering" -> z_fighting
"primitive performance slow" -> primitive_performance
"label disappears" -> label_visibility
无关输入 -> []
```

测试：

```bash
pnpm test packages/diagnosis/src/matcher.test.ts
```

---

### Step 6：DiagnosticContextPack Token Budget

新增：

```text
packages/diagnosis/src/token-budget.ts
packages/diagnosis/src/token-budget.test.ts
```

导出：

```ts
estimateDiagnosticTokens(pack: DiagnosticContextPack): number
truncateDiagnosticPack(
  pack: DiagnosticContextPack,
  budget?: number,
): DiagnosticContextPack
```

默认预算：

```text
6000 tokens
```

裁剪顺序：

1. related source
2. related issue bodies
3. callgraph
4. render stage descriptions
5. fix suggestions
6. investigation steps

即使预算很小，也必须保留：

- matched pattern id/name
- possible causes
- related symbol names
- investigation steps
- fix suggestions
- metadata

验收：

```bash
pnpm test packages/diagnosis/src/token-budget.test.ts
```

---

### Step 7：Diagnosis Assembly

新增：

```text
packages/diagnosis/src/diagnoser.ts
packages/diagnosis/src/diagnoser.test.ts
```

导出：

```ts
diagnoseProblem(
  symbolRepo: SymbolRepo,
  callGraphRepo: CallGraphRepo,
  issueRepo: IssueRepo,
  options: DiagnoseOptions,
): DiagnosticContextPack

queryRenderStages(options: {
  stageId?: string;
  problemId?: string;
  patterns: ProblemPattern[];
  stages: RenderStage[];
}): RenderStage[]
```

组装逻辑：

1. `matchProblemPatterns()`
2. 合并 `relatedStages`
3. 解析 `relatedSymbols`
4. 获取 source snippets
5. 获取 callgraph edges
6. 使用 `issueQueries` 搜索 Issue
7. 合并 investigation steps
8. 合并 fix suggestions
9. `truncateDiagnosticPack()`

无匹配时：

```ts
matchedPatterns: []
relatedSymbols: []
relatedSource: []
callgraph: []
relatedIssues: []
investigationSteps: []
fixSuggestions: []
```

不得编造诊断结果。

验收：

```bash
pnpm test packages/diagnosis/src/diagnoser.test.ts
```

---

### Step 8：Evaluation Dataset 测试

新增：

```text
packages/diagnosis/src/evaluation.test.ts
```

读取：

```text
data/evaluation/phase2a-diagnosis-cases.json
```

每个 case 验证：

- 至少命中一个 expected pattern
- 命中的 pattern 至少包含一个 expected symbol

验收：

```bash
pnpm test packages/diagnosis/src/evaluation.test.ts
```

---

### Step 9：CLI 命令

新增：

```text
packages/cli/src/commands/diagnose-cmd.ts
```

修改：

```text
packages/cli/package.json
packages/cli/src/index.ts
```

新增命令：

```bash
cesium diagnose "<problem>"
cesium pkb list
cesium stage <problem_id|stage_id>
```

`cesium diagnose` 输出章节：

```text
Possible Causes
Render Stages
Related Symbols
Related Source
Related Issues
Investigation Steps
Possible Fixes
```

`cesium pkb list` 输出：

```text
id / category / name / aliases
```

`cesium stage z_fighting` 应支持 problem id fallback，输出 z_fighting 关联的 render stages。

验收：

```bash
pnpm test packages/cli/src
```

如果测试环境没有真实 Cesium DB，DB 依赖测试按既有模式 skip；`pkb list` 与 `stage` 必须始终可测。

---

### Step 10：MCP Tools

修改：

```text
packages/mcp/package.json
packages/mcp/src/handlers.ts
packages/mcp/src/server.ts
packages/mcp/src/handlers.test.ts
packages/mcp/src/server.test.ts
packages/mcp/src/e2e-stdio.test.ts
```

新增 handler：

```ts
handleDiagnoseProblem(
  symbolRepo: SymbolRepo,
  callGraphRepo: CallGraphRepo,
  issueRepo: IssueRepo,
  input: { problem: string; limit?: number; budget?: number },
): Promise<ToolResponse>

handleQueryRenderStage(input: {
  stageId?: string;
  problemId?: string;
}): Promise<ToolResponse>
```

新增 MCP tools：

```text
diagnose_problem
query_render_stage
```

`diagnose_problem` input：

```json
{
  "problem": "polygon flickering",
  "limit": 5,
  "budget": 6000
}
```

MCP tools/list 应返回 7 个工具：

```text
search_symbol
get_source
search_issue
trace_callgraph
build_context_pack
diagnose_problem
query_render_stage
```

验收：

```bash
pnpm test packages/mcp/src/handlers.test.ts packages/mcp/src/server.test.ts packages/mcp/src/e2e-stdio.test.ts
```

MCP server 运行期间仍不得使用 `console.log` 污染 stdout。

---

### Step 11：README / CHANGELOG / Roadmap 更新

修改：

```text
README.md
CHANGELOG.md
future-roadmap.md
```

README 新增：

```bash
cesium diagnose "why does my polygon flicker?"
cesium pkb list
cesium stage z_fighting
```

MCP Tools Reference 新增：

```text
diagnose_problem
query_render_stage
```

CHANGELOG 新增：

```text
v0.2.0 (Unreleased)
Phase 2A Problem Diagnosis
```

future-roadmap 标注：

- Phase 2A = Problem Diagnosis
- Phase 2B = Render Pipeline Intelligence
- Phase 2C = Semantic Retrieval
- Phase 2D = Agent Context System

---

## 依赖关系

```text
diagnosis
  ├── @cesium-nexus/shared
  └── @cesium-nexus/storage

cli
  └── @cesium-nexus/diagnosis

mcp
  └── @cesium-nexus/diagnosis
```

`storage` 不依赖 `diagnosis`。

`context-pack` 不依赖 `diagnosis`。

Phase 1 的 `build_context_pack` 行为不变。

---

## 验收标准

以下命令通过：

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm run build
```

以下输入均能返回有价值诊断：

```text
why does Polygon flicker?
why does z-fighting happen?
why is Primitive performance bad?
why do 3D Tiles jitter?
why does Label disappear?
```

每个诊断输出必须包含：

- 问题原因
- 相关源码
- 相关调用链
- 相关 Issue
- 排查步骤
- 修复建议

CLI 验收：

```bash
cesium pkb list
cesium stage z_fighting
cesium diagnose "why does my polygon flicker?"
```

MCP 验收：

- tools/list 包含 7 个工具
- `diagnose_problem` 返回 `{ success: true, data: { kind: "diagnosis", ... } }`
- `query_render_stage` 可按 `problemId` 或 `stageId` 查询

---

## 非目标

Phase 2A 禁止实现：

- Embedding
- Vector Search
- Semantic Retrieval
- Rerank
- Agent Workflow
- Multi-Pack Merge
- Forum Crawler
- PR Review Ingestion
- Problem Mining
- SQLite schema migration for Problem KB
- Auto Fix / Auto Patch
- 完整 Render Pipeline Intelligence

以上能力分别留到 Phase 2B / 2C / 2D。

---

## Progress

| Step | 内容 | 状态 |
|---|---|---|
| 1 | 扩展 shared diagnosis types | 待开始 |
| 2 | 新增静态 Problem KB / Render Stage / Evaluation 数据 | 待开始 |
| 3 | 新增 `@cesium-nexus/diagnosis` package | 待开始 |
| 4 | Knowledge Loader + 校验测试 | 待开始 |
| 5 | Problem Matcher + 规则匹配测试 | 待开始 |
| 6 | DiagnosticContextPack token budget | 待开始 |
| 7 | Diagnosis Assembly | 待开始 |
| 8 | Evaluation Dataset 测试 | 待开始 |
| 9 | CLI: diagnose / pkb list / stage | 待开始 |
| 10 | MCP: diagnose_problem / query_render_stage | 待开始 |
| 11 | README / CHANGELOG / Roadmap 更新 | 待开始 |
