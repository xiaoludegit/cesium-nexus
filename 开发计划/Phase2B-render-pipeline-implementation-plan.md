# Phase 2B: Render Pipeline Intelligence（渲染管线智能）

## 目标

Phase 2A 完成了 **Problem Diagnosis First**：系统能围绕真实 Cesium 问题回答"为什么会发生、在哪里发生、如何排查、如何修复"。

Phase 2B 的核心定位是 **Render Pipeline Intelligence + Skill Dispatch**。在诊断基础上，系统应能：

```text
理解完整渲染管线（阶段间依赖）
根据用户意图分发到合适的 Skill
按 Skill 差异化组装 Context Pack v2（含 render_stage section）
检索更广的经验数据（Forum + PR Review）
```

Phase 2B 完成后，系统应能对以下场景给出更精准的回答：

```text
Primitive.update 在渲染管线的哪个阶段工作？
为什么我的 polygon flickering？（debug_skill，含 render_stage section）
Primitive 性能下降怎么排查？（performance_skill，含 PR 优化上下文）
这个 shader 编译错误怎么修？（shader_skill）
Cesium 社区里有没有人遇到过 3D Tiles jitter？（forum 检索）
```

---

## 关键设计决策

### 1. Render Pipeline Graph 扩展（非重建）

Phase 2A 已建立 9 个静态 `render_stage`（`render-stages.json`），采用架构审计推荐的 **Stage → Symbol** 反向设计（`keySymbols` 内嵌），不引入 `symbol_stage_map`。

Phase 2B 不推翻该设计，而是 **扩展** `RenderStage` 类型，增加阶段间依赖关系：

```text
render_stage
  ├── dependsOn: string[]      ← 前置阶段 ID（DAG 边）
  ├── perfHotspot?: boolean    ← 性能热点标记
  └── isOptional?: boolean      ← 是否可选阶段
```

同时新增 `RenderPipelineGraph` 类型，用于表达完整管线的拓扑结构（阶段节点 + 依赖边）。

不引入 `symbol_stage_map` 动态构建表（架构审计已证明不可行）。

### 2. Skill Dispatch 规则版（5 个硬编码 Skill）

采用架构审计 v3.1 冻结版本推荐的简化 5 步 Workflow 中的 Skill Dispatch：

```text
用户输入
  -> extractEntities()（Symbol / Version / Stage / Problem 关键词）
  -> 关键词规则匹配
  -> 选定 Skill（5 个 if/else）
  -> 无匹配 -> General Skill
```

5 个硬编码 Skill：

| Skill | 触发场景 | Token 预算 | 核心 Section |
|---|---|---|---|
| `api` | API 用法、参数、文档查询 | 4000 | symbol + source + callgraph |
| `debug` | Bug、错误、异常、闪烁 | 6000 | diagnosis + render_stage + symbol + source + issues + fixes |
| `performance` | 性能、慢、卡顿、FPS | 6000 | render_stage + callgraph + prs + issues |
| `shader` | GLSL、Shader 编译、材质 | 5000 | shader symbols + source |
| `general` | 兜底 | 4000 | symbol + source + issues |

不引入 embedding、向量 Fallback、YAML 配置化。意图歧义时选 `debug_skill`（覆盖最广）。

### 3. Context Pack v2 独立于 Phase 1 / Phase 2A

Phase 1 的 `ContextPack` 和 Phase 2A 的 `DiagnosticContextPack` 保持稳定，不破坏现有行为。

Phase 2B 新增：

```ts
SkillContextPack
```

用于 Skill 感知的 Context Pack v2，由 `packages/skills` 包中的 builder 组装。

### 4. Forum 抓取：Discourse JSON API 优先，HTML 降级

Cesium Community Forum 基于 Discourse。Discourse 提供 JSON API（`/latest.json`、`/t/{id}.json`），比 HTML 抓取更稳定。

策略：

- 优先使用 Discourse JSON API（`Accept: application/json`）
- JSON API 不可用时降级为 HTML 解析
- 过滤条件：`repliesCount >= 2 AND (hasSolution = true OR viewsCount > 200)`
- 计算 `qualityScore`：基于 `hasSolution`、`viewsCount`、`repliesCount`

### 5. Experience Node 统一检索层

引入 `experience_node` 表，统一 Issue / PR Review / Forum 三类经验数据为可检索节点（无边，边层留到 Phase 2C）。

`search_experience` 在 `experience_node` 上做 FTS5 检索，支持 `type` / `symbol` / `problem` 过滤。

---

## 数据流

```text
用户输入 "why polygon flickering, which render stage?"
  -> extractEntities() -> [symbol: PolygonGeometry, stage: ?, problem: flickering]
  -> dispatchSkill() -> debug_skill (confidence 0.85)
  -> skill debug:
       ├── diagnoseProblem() (Phase 2A 复用)
       │     -> matchedPatterns: [z_fighting, depth_precision]
       │     -> relatedStages: [depth_pass, opaque_pass, command_build_stage]
       ├── queryRenderPipeline() -> 完整管线 + 阶段间依赖
       ├── render_stage section 组装
       │     -> depth_pass.dependsOn: [command_build_stage]
       │     -> keySymbols: [Scene, DepthPlane, RenderState, ...]
       ├── ForumRepo.searchFts("flickering polygon")
       ├── ExperienceRepo.search(type=all, symbol=PolygonGeometry)
       └── truncateSkillPack(6000, skill=debug)
  -> 输出 SkillContextPack (kind="skill", skill="debug")
```

---

## 新增数据结构

### RenderStage 扩展

修改 `packages/shared/src/types.ts` 中现有 `RenderStage`：

```ts
export interface RenderStage {
  id: string;
  name: string;
  order: number;
  description: string;
  keySymbols: string[];
  symptomHints: string[];
  dependsOn: string[];        // 新增：前置阶段 ID 列表
  perfHotspot?: boolean;     // 新增：性能热点标记
  isOptional?: boolean;      // 新增：是否可选阶段
}
```

### RenderPipelineGraph（新增）

```ts
export interface RenderPipelineGraph {
  stages: RenderStage[];
  edges: RenderStageEdge[];
}

export interface RenderStageEdge {
  from: string;  // 阶段 ID
  to: string;     // 阶段 ID
  relation: "sequential" | "conditional" | "parallel";
}
```

### Skill 类型（新增）

```ts
export type SkillId = "api" | "debug" | "performance" | "shader" | "general";

export interface ExtractedEntity {
  type: "symbol" | "version" | "stage" | "problem";
  value: string;
}

export interface SkillDispatchResult {
  skill: SkillId;
  confidence: number;
  matchedKeywords: string[];
  extractedEntities: ExtractedEntity[];
}

export type SkillSection =
  | "symbol"
  | "source"
  | "callgraph"
  | "issues"
  | "render_stage"
  | "diagnosis"
  | "forum"
  | "experience"
  | "fixes";

export interface SkillRetrievalHints {
  includeDiagnosis: boolean;
  includeRenderStages: boolean;
  includeForum: boolean;
  includeExperience: boolean;
  callgraphDepth: number;
  issueLimit: number;
  forumLimit: number;
}

export interface SkillConfig {
  id: SkillId;
  name: string;
  description: string;
  triggerKeywords: string[];
  tokenBudget: number;
  sections: SkillSection[];
  retrieval: SkillRetrievalHints;
}
```

### ForumPost（新增）

```ts
export interface ForumPost {
  id: number;
  topicId: number;
  title: string;
  body: string;
  author: string;
  repliesCount: number;
  viewsCount: number;
  hasSolution: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  url: string;
  qualityScore: number;
}

export interface ForumSearchResult {
  post: ForumPost;
  score: number;
}
```

### PullRequestRecord（新增）

```ts
export interface PullRequestRecord {
  id: number;
  repo: string;
  number: number;
  title: string;
  body: string;
  state: string;          // "closed" / "merged" / "open"
  mergedAt: string | null;
  author: string;
  labels: string[];
  reviewComments: number;
  filesChanged: number;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  closingIssueReferences: number[];
}

export interface PRSearchResult {
  pr: PullRequestRecord;
  score: number;
}
```

### ExperienceNode（新增）

```ts
export type ExperienceNodeType = "issue" | "pr_review" | "forum";

export interface ExperienceNode {
  id: string;
  type: ExperienceNodeType;
  title: string;
  url: string;
  source: string;            // repo slug 或 "community-forum"
  summary: string;
  relatedSymbols: string[];
  tags: string[];
  qualityScore: number;
  publishedAt: string;
}

export interface ExperienceSearchResult {
  node: ExperienceNode;
  score: number;
}
```

### SkillContextPack（Context Pack v2，新增）

```ts
export interface SkillContextPackMetadata {
  skill: SkillId;
  totalTokens: number;
  truncated: boolean;
  tokenBudget: number;
  sectionsIncluded: SkillSection[];
  symbolResolved?: string;
}

export interface SkillContextPack {
  kind: "skill";
  skill: SkillId;
  query: string;
  dispatch: SkillDispatchResult;
  symbol?: SymbolRecord;
  source: SourceSnippet[];
  callgraph: Edge[];
  issues: IssueRecord[];
  renderStages?: RenderStage[];
  diagnosis?: DiagnosisResult;
  forum?: ForumPost[];
  experience?: ExperienceNode[];
  metadata: SkillContextPackMetadata;
}
```

---

## 新增静态数据

### Render Stages 扩展

修改：

```text
data/problem-kb/render-stages.json
```

为现有 9 个阶段补充 `dependsOn` / `perfHotspot` / `isOptional` 字段，并新增 2–3 个阶段使管线完整：

| id | 阶段 | dependsOn | 新增标记 |
|---|---|---|---|
| `update_stage` | Update Stage | `[]` | perfHotspot: true |
| `culling_stage` | Frustum Culling Stage | `["update_stage"]` | 新增 |
| `command_build_stage` | Command Build Stage | `["culling_stage"]` | perfHotspot: true |
| `depth_pass` | Depth Pass | `["command_build_stage"]` | isOptional: true |
| `opaque_pass` | Opaque Pass | `["depth_pass"]` | |
| `translucent_pass` | Translucent Pass | `["opaque_pass"]` | |
| `classification_stage` | Classification Stage | `["opaque_pass"]` | |
| `picking_stage` | Picking Stage | `["translucent_pass"]` | isOptional: true |
| `tileset_traversal_stage` | 3D Tiles Traversal | `["update_stage"]` | perfHotspot: true |
| `shader_compile_stage` | Shader Compile Stage | `[]` | isOptional: true |
| `post_process_stage` | Post-Process Stage | `["translucent_pass"]` | 新增 |
| `primitive_release_stage` | Primitive Release / Destroy | `[]` | 新增 |

### Skill Configs（新增）

```text
data/skills/skill-configs.json
```

5 个 Skill 的硬编码配置（triggerKeywords、tokenBudget、sections、retrieval hints）。

### Evaluation Dataset（新增）

```text
data/evaluation/phase2b-skill-cases.json
```

至少 15 个 case，覆盖 5 个 Skill 的分发验证：

```ts
{
  query: string;
  expectedSkill: SkillId;
  expectedEntities?: ExtractedEntity[];
}
```

```text
data/evaluation/phase2b-forum-snr-samples.json
```

20 个随机 Forum 样本，用于人工评估信噪比，每个标注：

```ts
{
  topicId: number;
  title: string;
  expectedUseful: boolean;  // 人工标注
  actualFiltered: boolean;   // 过滤器是否保留
}
```

---

## 新增包

### packages/skills

职责：

- 关键词规则 + 实体抽取 → Skill 分发
- Skill 配置加载与校验
- Skill 感知 Context Pack v2 组装
- 按 Skill 差异化 Token 预算

不负责：

- CLI 参数解析
- MCP tool 注册
- SQLite schema 初始化
- 网络抓取

包结构：

```text
packages/skills/src/
  index.ts
  skill-router.ts          # dispatchSkill + extractEntities
  skill-configs.ts         # loadSkillConfigs + validate
  entity-extractor.ts      # Symbol/Version/Stage/Problem 抽取
  context-pack-builder.ts  # SkillContextPack 组装
  token-budget.ts          # 按 Skill 差异化预算截断
  pipeline-query.ts        # RenderPipelineGraph 构建
  skill-router.test.ts
  entity-extractor.test.ts
  context-pack-builder.test.ts
  token-budget.test.ts
  pipeline-query.test.ts
  evaluation.test.ts
```

依赖：

```json
{
  "@cesium-nexus/shared": "workspace:*",
  "@cesium-nexus/storage": "workspace:*",
  "@cesium-nexus/context-pack": "workspace:*",
  "@cesium-nexus/diagnosis": "workspace:*"
}
```

---

## 实施步骤

### Step 1（P2B-1）：扩展 shared types — Render Pipeline

修改：

```text
packages/shared/src/types.ts
```

新增 / 修改：

- `RenderStage` 扩展 `dependsOn` / `perfHotspot` / `isOptional`
- `RenderPipelineGraph`
- `RenderStageEdge`

验收：

```bash
pnpm typecheck
```

---

### Step 2（P2B-1）：扩展 Render Stages 静态数据

修改：

```text
data/problem-kb/render-stages.json
```

为现有 9 个阶段补充 `dependsOn` / `perfHotspot` / `isOptional`，新增 `culling_stage` / `post_process_stage` / `primitive_release_stage`。

验收：

```text
render-stages.json 至少 11 条
每个阶段 dependsOn 引用的 ID 必须存在
DAG 无环（校验函数验证）
```

---

### Step 3（P2B-1）：Pipeline Query 函数

修改：

```text
packages/diagnosis/src/knowledge-loader.ts
packages/diagnosis/src/index.ts
```

新增导出：

```ts
buildRenderPipelineGraph(stages: RenderStage[]): RenderPipelineGraph
validatePipelineDAG(graph: RenderPipelineGraph): boolean  // 无环检测
getStageDependencies(stageId: string, stages: RenderStage[]): RenderStage[]
getDownstreamStages(stageId: string, stages: RenderStage[]): RenderStage[]
```

`buildRenderPipelineGraph` 从 `dependsOn` 字段推导 `RenderStageEdge`：

```text
stage.dependsOn 中的每个 ID -> edge(from=dep, to=stage, relation="sequential")
```

验收：

```bash
pnpm test packages/diagnosis/src/knowledge-loader.test.ts
```

---

### Step 4（P2B-2）：扩展 shared types — Skill + Experience

修改：

```text
packages/shared/src/types.ts
```

新增：

- `SkillId` / `SkillSection` / `SkillRetrievalHints` / `SkillConfig`
- `ExtractedEntity` / `SkillDispatchResult`
- `ForumPost` / `ForumSearchResult`
- `PullRequestRecord` / `PRSearchResult`
- `ExperienceNodeType` / `ExperienceNode` / `ExperienceSearchResult`
- `SkillContextPack` / `SkillContextPackMetadata`

验收：

```bash
pnpm typecheck
```

---

### Step 5（P2B-2）：新增 packages/skills + Skill Router

新增：

```text
packages/skills/package.json
packages/skills/tsconfig.json
packages/skills/tsup.config.ts
packages/skills/src/index.ts
```

新增 `data/skills/skill-configs.json`（5 个 Skill 配置）。

实现 `skill-router.ts`：

```ts
loadSkillConfigs(filePath?: string): SkillConfig[]
extractEntities(query: string, symbolRepo?: SymbolRepo): ExtractedEntity[]
dispatchSkill(
  query: string,
  configs: SkillConfig[],
  options?: { symbolRepo?: SymbolRepo; stages?: RenderStage[] },
): SkillDispatchResult
```

匹配策略：

| 来源 | 权重 |
|---|---|
| Skill trigger keyword match | 高 |
| 实体类型暗示（problem → debug/performance） | 中 |
| Stage 关键词 → shader/performance | 中 |
| Version 关键词 → api | 低 |
| Category keyword | 低 |

实体抽取规则：

- Symbol 实体：查询 `SymbolRepo.findByName()`，命中真实符号
- Version 实体：正则 `1\.\d{2,3}` 或 `1.xxx`
- Stage 实体：匹配 render stage 的 `symptomHints` / `name`
- Problem 实体：复用 `matchProblemPatterns()`

验收：

```text
"how to use Primitive API" -> api_skill
"why polygon flickering" -> debug_skill
"Primitive performance slow" -> performance_skill
"shader compile error" -> shader_skill
"hello world" -> general_skill
```

---

### Step 6（P2B-2）：Entity Extractor

新增：

```text
packages/skills/src/entity-extractor.ts
packages/skills/src/entity-extractor.test.ts
```

导出：

```ts
extractEntities(query: string, options?: {
  symbolRepo?: SymbolRepo;
  stages?: RenderStage[];
  patterns?: ProblemPattern[];
}): ExtractedEntity[]
```

抽取逻辑：

- Symbol：`/[A-Z][a-zA-Z]+\.[a-zA-Z]+/` 或 `[A-Z][a-zA-Z]+` → 查 SymbolRepo 验证
- Version：`/1\.\d{2,3}(\.\d+)?/`
- Stage：匹配 `symptomHints` token
- Problem：匹配 `ProblemPattern.triggerKeywords`

验收：

```bash
pnpm test packages/skills/src/entity-extractor.test.ts
```

---

### Step 7（P2B-3）：GitHub PR Sync — Indexer

新增：

```text
packages/indexer/src/github/github-prs.ts
packages/indexer/src/github/github-prs.test.ts
```

复用 `githubFetch` / `parseNextLink` / `GitHubRateLimitError`。

导出：

```ts
export interface SyncPRsOptions {
  owner: string;
  repo: string;
  token?: string;
  since?: string | null;
}

export interface SyncPRResult {
  prs: PullRequestRecord[];
  totalPages: number;
  maxUpdatedAt: string | null;
}

export async function syncPRs(opts: SyncPRsOptions): Promise<SyncPRResult>
export function mapGitHubPR(item: GitHubPRItem, repo: string): PullRequestRecord
```

PR API 端点：`/repos/{owner}/{repo}/pulls?state=closed&sort=updated&direction=asc`。

过滤条件：

- `merged_at != null`（仅 merged PR）
- `review_comments >= 1` 或 `labels` 包含 `performance` / `bugfix`

修改 `packages/indexer/src/index.ts` 导出 `syncPRs` / `mapGitHubPR`。

验收：

```bash
pnpm test packages/indexer/src/github/github-prs.test.ts
```

---

### Step 8（P2B-3）：PullRequestRepo — Storage

修改：

```text
packages/storage/src/schema.ts
```

新增表：

```sql
CREATE TABLE IF NOT EXISTS pull_requests (
  id INTEGER PRIMARY KEY,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  state TEXT,
  merged_at TEXT,
  author TEXT,
  labels TEXT,
  review_comments INTEGER,
  files_changed INTEGER,
  created_at TEXT,
  updated_at TEXT,
  html_url TEXT,
  closing_issue_refs TEXT,
  UNIQUE(repo, number)
);

CREATE VIRTUAL TABLE IF NOT EXISTS prs_fts
  USING fts5(title, body, content='pull_requests', content_rowid='id');
-- + triggers（同 issues_fts 模式）
```

新增：

```text
packages/storage/src/pr-repo.ts
packages/storage/src/pr-repo.test.ts
```

导出：

```ts
export class PullRequestRepo {
  upsertMany(prs: PullRequestRecord[]): number
  searchFts(keyword: string, options?: { limit?: number }): PRSearchResult[]
  getSyncCursor(repo: string): string | null
  setSyncCursor(repo: string, timestamp: string): void
  clear(repo?: string): void
  totalCount(): number
}
```

修改 `packages/storage/src/index.ts` 导出 `PullRequestRepo`。

验收：

```bash
pnpm test packages/storage/src/pr-repo.test.ts
```

---

### Step 9（P2B-4）：Forum Crawler — Indexer

新增：

```text
packages/indexer/src/forum/forum-crawler.ts
packages/indexer/src/forum/forum-crawler.test.ts
```

Cesium Community Forum（`https://community.cesium.com`）基于 Discourse。

导出：

```ts
export interface CrawlForumOptions {
  baseUrl?: string;         // 默认 "https://community.cesium.com"
  maxPages?: number;       // 默认 10
  minReplies?: number;     // 默认 2
  minViews?: number;       // 默认 200
  category?: string;       // 可选分类过滤
}

export interface CrawlForumResult {
  posts: ForumPost[];
  totalPages: number;
  filtered: number;        // 被过滤的低质量帖子数
}

export async function crawlForum(opts: CrawlForumOptions): Promise<CrawlForumResult>
export function parseDiscourseTopic(raw: DiscourseTopicJSON, baseUrl: string): ForumPost
export function computeForumQualityScore(post: Partial<ForumPost>): number
```

抓取策略：

1. 请求 `/latest.json?page=N` 获取 topic 列表
2. 对每个 topic 请求 `/t/{id}.json` 获取完整内容
3. 过滤：`repliesCount >= 2 AND (hasSolution OR viewsCount > 200)`
4. 计算 `qualityScore`：`hasSolution ? 0.9 : 0.0` + `min(viewsCount / 1000, 0.1)`

降级策略：

- JSON API 返回非 JSON → 降级为 HTML 解析（`cheerio` 或正则提取 `<script>` 中的 `PreloadStore` 数据）
- 抓取失败时抛出 `ForumCrawlError`，不阻断其他数据源

修改 `packages/indexer/src/index.ts` 导出 `crawlForum` / `parseDiscourseTopic` / `computeForumQualityScore`。

验收：

```bash
pnpm test packages/indexer/src/forum/forum-crawler.test.ts
```

---

### Step 10（P2B-4）：ForumRepo — Storage

修改：

```text
packages/storage/src/schema.ts
```

新增表：

```sql
CREATE TABLE IF NOT EXISTS forum_posts (
  id INTEGER PRIMARY KEY,
  topic_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  author TEXT,
  replies_count INTEGER,
  views_count INTEGER,
  has_solution INTEGER,    -- 0 / 1
  tags TEXT,
  created_at TEXT,
  updated_at TEXT,
  url TEXT,
  quality_score REAL
);

CREATE VIRTUAL TABLE IF NOT EXISTS forum_fts
  USING fts5(title, body, content='forum_posts', content_rowid='id');
-- + triggers
```

新增：

```text
packages/storage/src/forum-repo.ts
packages/storage/src/forum-repo.test.ts
```

导出：

```ts
export class ForumRepo {
  upsertMany(posts: ForumPost[]): number
  searchFts(keyword: string, options?: { limit?: number; minQuality?: number }): ForumSearchResult[]
  getSyncCursor(key: string): string | null
  setSyncCursor(key: string, value: string): void
  clear(): void
  totalCount(): number
}
```

`searchFts` 使用 `bm25(forum_fts)` 排序，支持 `minQuality` 过滤。

修改 `packages/storage/src/index.ts` 导出 `ForumRepo`。

验收：

```bash
pnpm test packages/storage/src/forum-repo.test.ts
```

---

### Step 11（P2B-5）：ExperienceNode 统一检索层

修改：

```text
packages/storage/src/schema.ts
```

新增表：

```sql
CREATE TABLE IF NOT EXISTS experience_node (
  id TEXT PRIMARY KEY,        -- "{type}:{sourceId}"
  type TEXT NOT NULL,         -- "issue" | "pr_review" | "forum"
  title TEXT NOT NULL,
  url TEXT,
  source TEXT,
  summary TEXT,
  related_symbols TEXT,       -- JSON array
  tags TEXT,                  -- JSON array
  quality_score REAL,
  published_at TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS experience_fts
  USING fts5(title, summary, content='experience_node', content_rowid='id');
-- + triggers
```

新增：

```text
packages/storage/src/experience-repo.ts
packages/storage/src/experience-repo.test.ts
```

导出：

```ts
export class ExperienceRepo {
  upsertMany(nodes: ExperienceNode[]): number
  searchFts(
    keyword: string,
    options?: {
      limit?: number;
      type?: ExperienceNodeType;
      symbol?: string;       // 过滤 related_symbols 包含此 symbol
      minQuality?: number;
    },
  ): ExperienceSearchResult[]
  totalCount(): number
  countByType(): Record<ExperienceNodeType, number>
  clear(): void
}

export function buildExperienceNode(
  type: ExperienceNodeType,
  source: { id: number | string; title: string; body: string; url: string; ... },
  relatedSymbols?: string[],
): ExperienceNode
```

新增 **Experience Node Builder**（同步任务）：

```text
packages/indexer/src/experience-node-builder.ts
```

```ts
export function buildExperienceNodesFromIssues(issues: IssueRecord[]): ExperienceNode[]
export function buildExperienceNodesFromPRs(prs: PullRequestRecord[]): ExperienceNode[]
export function buildExperienceNodesFromForum(posts: ForumPost[]): ExperienceNode[]
export function rebuildExperienceIndex(
  issueRepo: IssueRepo,
  prRepo: PullRequestRepo,
  forumRepo: ForumRepo,
  experienceRepo: ExperienceRepo,
): { issues: number; prs: number; forum: number; total: number }
```

`rebuildExperienceIndex` 清空 `experience_node` 表后从三张源表全量重建。

修改 `packages/storage/src/index.ts` 导出 `ExperienceRepo` / `buildExperienceNode`。

验收：

```bash
pnpm test packages/storage/src/experience-repo.test.ts
pnpm test packages/indexer/src/experience-node-builder.test.ts
```

---

### Step 12（P2B-6）：Context Pack v2 Builder

新增：

```text
packages/skills/src/context-pack-builder.ts
packages/skills/src/context-pack-builder.test.ts
```

导出：

```ts
export interface BuildSkillPackOptions {
  query: string;
  symbolRepo: SymbolRepo;
  callGraphRepo: CallGraphRepo;
  issueRepo: IssueRepo;
  prRepo: PullRequestRepo;
  forumRepo: ForumRepo;
  experienceRepo: ExperienceRepo;
  patterns: ProblemPattern[];
  stages: RenderStage[];
  configs: SkillConfig[];
  budget?: number;
}

export function buildSkillContextPack(options: BuildSkillPackOptions): SkillContextPack
```

组装逻辑：

1. `dispatchSkill(query, configs, { symbolRepo, stages })` → 选定 Skill
2. 根据 `skillConfig.sections` 决定包含哪些 section
3. `api_skill`：resolve symbol → source → callgraph（depth from config）
4. `debug_skill`：`diagnoseProblem()` → render_stages（从 matchedPatterns.relatedStages + `getStageDependencies`）→ symbol → source → issues → fixes
5. `performance_skill`：render_stages（perfHotspot=true）→ callgraph（depth+1）→ prs（性能相关 merged PR）→ issues
6. `shader_skill`：shader_compile_stage → keySymbols source → issues
7. `general_skill`：symbol → source → issues
8. 所有 skill：可选追加 `forum` 和 `experience` section
9. `truncateSkillPack(pack, config.tokenBudget, skill)` → 截断
10. 附加 `metadata.sectionsIncluded`

---

### Step 13（P2B-6）：Skill Token Budget

新增：

```text
packages/skills/src/token-budget.ts
packages/skills/src/token-budget.test.ts
```

导出：

```ts
export function estimateSkillTokens(pack: SkillContextPack): number
export function truncateSkillPack(
  pack: SkillContextPack,
  budget: number,
  skill: SkillId,
): SkillContextPack
```

按 Skill 差异化的 section 预算：

| Skill | symbol | source | callgraph | issues | render_stage | diagnosis | forum | experience |
|---|---|---|---|---|---|---|---|---|
| api | 500 | 2500 | 500 | 500 | — | — | — | — |
| debug | 400 | 2000 | 400 | 800 | 600 | 800 | 400 | 600 |
| performance | 300 | 1500 | 800 | 600 | 800 | — | 400 | 1000 |
| shader | 500 | 3000 | 300 | 500 | 400 | — | 300 | — |
| general | 500 | 2000 | 400 | 800 | — | — | — | 300 |

截断顺序（最不重要的先丢）：

1. experience
2. forum
3. callgraph
4. issues
5. source（保留主符号 source）
6. render_stage description
7. diagnosis fixSuggestions

即使预算很小，必须保留：

- `skill` / `query` / `dispatch`
- `metadata`

验收：

```bash
pnpm test packages/skills/src/token-budget.test.ts
```

---

### Step 14（P2B-7）：CLI 命令

新增：

```text
packages/cli/src/commands/forum-cmd.ts
packages/cli/src/commands/skill-cmd.ts
packages/cli/src/commands/pipeline-cmd.ts
```

修改：

```text
packages/cli/src/index.ts
packages/cli/package.json  # 新增 @cesium-nexus/skills 依赖
```

新增命令：

```bash
# Forum
cesium sync:forum                    # 抓取 Forum 帖子入库
cesium forum search <keywords>       # 全文搜索 Forum

# Skills
cesium skills list                   # 列出 5 个 Skill 及配置
cesium dispatch "<query>"            # 显示 Skill 分发结果（调试用）

# Pipeline
cesium pipeline                      # 输出完整渲染管线图（含依赖关系）
cesium pipeline <stage_id>           # 查看某阶段及其上下游依赖

# Experience
cesium experience search <keywords>  # 跨源经验检索
cesium experience rebuild             # 重建 experience_node 索引
```

`cesium forum search` 输出：

```text
Found 5 result(s) for "flickering polygon":

  [solved] Polygon flickering issue
    replies: 12  views: 1,234  quality: 0.95
    https://community.cesium.com/t/...
```

`cesium pipeline` 输出（树状 + 依赖标注）：

```text
Cesium Render Pipeline:

  1. Update Stage [perf]
       dependsOn: —
       keySymbols: Scene, Primitive, Cesium3DTileset
  2. Frustum Culling Stage
       dependsOn: <- update_stage
  3. Command Build Stage [perf]
       dependsOn: <- culling_stage
  ...
```

验收：

```bash
pnpm test packages/cli/src
```

DB 依赖测试按既有模式 skip；`skills list`、`pipeline`、`forum search`（无 DB 时报错提示）必须始终可测。

---

### Step 15（P2B-8）：MCP Tools

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
export async function handleSearchForum(
  forumRepo: ForumRepo,
  input: { query: string; limit?: number; minQuality?: number },
): Promise<ToolResponse>

export async function handleSearchExperience(
  experienceRepo: ExperienceRepo,
  input: {
    query: string;
    limit?: number;
    type?: "issue" | "pr_review" | "forum";
    symbol?: string;
    minQuality?: number;
  },
): Promise<ToolResponse>

export async function handleDispatchSkill(
  input: { query: string },
): Promise<ToolResponse>

export async function handleBuildSkillPack(
  symbolRepo: SymbolRepo,
  callGraphRepo: CallGraphRepo,
  issueRepo: IssueRepo,
  prRepo: PullRequestRepo,
  forumRepo: ForumRepo,
  experienceRepo: ExperienceRepo,
  input: { query: string; budget?: number },
): Promise<ToolResponse>
```

新增 MCP tools：

```text
search_forum
search_experience
dispatch_skill         # 调试用，可选对外暴露
build_skill_pack       # Skill 感知 Context Pack v2
```

`search_forum` input：

```json
{
  "query": "polygon flickering",
  "limit": 10,
  "minQuality": 0.5
}
```

`search_experience` input：

```json
{
  "query": "Primitive performance",
  "type": "pr_review",
  "symbol": "Primitive",
  "minQuality": 0.7
}
```

MCP tools/list 应返回 **11 个工具**：

```text
search_symbol
get_source
search_issue
trace_callgraph
build_context_pack
diagnose_problem
query_render_stage
search_forum
search_experience
dispatch_skill
build_skill_pack
```

`registerTools` 需接收新增的 `prRepo` / `forumRepo` / `experienceRepo`。

验收：

```bash
pnpm test packages/mcp/src/handlers.test.ts packages/mcp/src/server.test.ts packages/mcp/src/e2e-stdio.test.ts
```

MCP server 运行期间仍不得使用 `console.log` 污染 stdout。

---

### Step 16（P2B-9）：Evaluation

新增：

```text
packages/skills/src/evaluation.test.ts
```

读取 `data/evaluation/phase2b-skill-cases.json`。

每个 case 验证：

- `dispatchSkill()` 返回的 `expectedSkill` 正确
- 命中的 skill `confidence > 0`
- `extractedEntities` 覆盖 `expectedEntities`（如有）

新增 Forum SNR 评估：

```text
packages/indexer/src/forum/forum-snr.test.ts
```

读取 `data/evaluation/phase2b-forum-snr-samples.json`（20 个样本），验证：

- 过滤器保留的帖子中 `expectedUseful = true` 的占比 > 70%

验收：

```bash
pnpm test packages/skills/src/evaluation.test.ts
pnpm test packages/indexer/src/forum/forum-snr.test.ts
```

---

### Step 17（P2B-10）：README / CHANGELOG / Roadmap 更新

修改：

```text
README.md
CHANGELOG.md
future-roadmap.md
```

README 新增：

```bash
cesium forum search "polygon flickering"
cesium skills list
cesium dispatch "why polygon flickering"
cesium pipeline
cesium pipeline depth_pass
cesium experience search "Primitive performance"
```

MCP Tools Reference 新增：

```text
search_forum
search_experience
dispatch_skill
build_skill_pack
```

CHANGELOG 新增：

```text
v0.3.0 (Unreleased)
Phase 2B Render Pipeline Intelligence
```

future-roadmap 更新：

- Phase 2B = Render Pipeline Intelligence（标记完成）
- Phase 2C = Semantic Retrieval
- Phase 2D = Agent Context System

技术栈演进表更新：

| 组件 | Phase 2A | Phase 2B |
|---|---|---|
| MCP Tools | 7 个 | 11 个 |
| Context Pack | 4 sections（+ diagnosis） | 9 sections（按 Skill 差异化） |
| 数据源 | Issue | Issue + PR Review + Forum |
| Skill Dispatch | — | 5 个硬编码 |

---

## 依赖关系

```text
skills
  ├── @cesium-nexus/shared
  ├── @cesium-nexus/storage
  ├── @cesium-nexus/context-pack
  └── @cesium-nexus/diagnosis

cli
  └── @cesium-nexus/skills

mcp
  └── @cesium-nexus/skills

indexer
  ├── @cesium-nexus/storage (已有)
  └── 新增 forum / pr / experience-node 模块（内部）
```

`storage` 不依赖 `skills`。
`context-pack` 不依赖 `skills`。
`diagnosis` 不依赖 `skills`。
Phase 1 的 `build_context_pack` 行为不变。
Phase 2A 的 `diagnose_problem` / `query_render_stage` 行为不变。

---

## 子里程碑与依赖

| 子里程碑 | 内容 | 依赖 |
|---|---|---|
| P2B-1 | Render Pipeline Graph 扩展（Step 1–3） | 无 |
| P2B-2 | Skill Dispatch 包（Step 4–6） | P2B-1 |
| P2B-3 | GitHub PR Sync（Step 7–8） | 无 |
| P2B-4 | Forum Crawler（Step 9–10） | 无 |
| P2B-5 | Experience Node 统一检索（Step 11） | P2B-3, P2B-4 |
| P2B-6 | Context Pack v2 Builder（Step 12–13） | P2B-1, P2B-2, P2B-5 |
| P2B-7 | CLI 命令（Step 14） | P2B-2, P2B-4, P2B-1 |
| P2B-8 | MCP Tools（Step 15） | P2B-4, P2B-5, P2B-6 |
| P2B-9 | Evaluation（Step 16） | 全部 |
| P2B-10 | Docs（Step 17） | 全部 |

可并行的子里程碑：P2B-1 / P2B-3 / P2B-4 完全独立，可同时开发。

---

## 验收标准

以下命令通过：

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm run build
```

### 核心验收

**Context Pack（debug_skill）包含 render_stage section：**

```bash
cesium dispatch "why polygon flickering"
# -> skill: debug, confidence: 0.85
```

```bash
cesium build-skill-pack "why polygon flickering"
# 或 MCP build_skill_pack
# -> SkillContextPack
#    .skill = "debug"
#    .renderStages 非空（包含 depth_pass, opaque_pass, command_build_stage）
#    .renderStages[].dependsOn 非空
#    .diagnosis 非空
#    .metadata.sectionsIncluded 包含 "render_stage"
```

**Forum 数据信噪比 > 70%：**

- `cesium sync:forum` 成功抓取并入库
- `cesium forum search "flickering"` 返回结果
- 20 个随机样本人工评估，过滤器保留的帖子中有效信息占比 > 70%

**Skill Dispatch 准确率：**

```text
"how to use Primitive API"         -> api_skill
"why polygon flickering"            -> debug_skill
"Primitive performance slow"       -> performance_skill
"shader compile error GLSL"        -> shader_skill
"hello world"                      -> general_skill
```

**MCP 验收：**

- `tools/list` 包含 11 个工具
- `search_forum` 返回 `{ success: true, data: { results: [...] } }`
- `search_experience` 支持 `type` / `symbol` 过滤
- `build_skill_pack` 返回 `{ success: true, data: { kind: "skill", skill: "debug", ... } }`

**Pipeline 验收：**

```bash
cesium pipeline
# 输出完整管线图，11+ 阶段，含依赖关系
cesium pipeline depth_pass
# 输出 depth_pass 阶段及其上游依赖
```

---

## 风险与缓解

| 风险 | 影响 | 概率 | 缓解 |
|---|---|---|---|
| Discourse JSON API 结构变更或被封 | Forum 数据中断 | 中 | HTML 降级解析；抓取器隔离为独立模块；失败告警不阻断 |
| Forum 帖子质量差，SNR < 70% | Context Pack 混入噪声 | 中 | `minQuality` 过滤 + `hasSolution` 优先 + views/replies 阈值 |
| Skill Dispatch 误判 | 检索策略错配 | 中 | 意图歧义选 debug_skill；记录分发决策日志；weekly 复盘 |
| PR 数据量过大，Token 超限 | LLM 收到不完整上下文 | 中 | per-skill section budget；PR body 截断；优先 review comments |
| experience_node 重建慢 | 同步耗时 | 低 | 全量重建仅手动触发；日常增量同步直接写源表 |
| Render Stage DAG 有环 | 管线查询死循环 | 低 | `validatePipelineDAG` 无环检测；启动时校验 |

---

## 非目标

Phase 2B 禁止实现：

- Embedding / 向量检索
- Experience Graph 边层（`fixes` / `released_in` / `mentions`）
- Problem Mining Pipeline
- Skill YAML 配置化 / 用户自定义 Skill
- Structured Answer 多格式解析器
- Agent Workflow（自动多步推理）
- GitHub Discussion 数据源
- Blog 数据源
- Cross-version Diff
- Shader Symbol 独立索引表（`shader_symbol`）
- Auto Fix / Auto Patch

以上能力分别留到 Phase 2C / 2D / Phase 3。

---

## Progress

| Step | 内容 | 子里程碑 | 状态 |
|---|---|---|---|
| 1 | 扩展 RenderStage 类型（dependsOn / perfHotspot / isOptional） | P2B-1 | ⬜ 待开始 |
| 2 | 扩展 render-stages.json（11+ 阶段 + 依赖） | P2B-1 | ⬜ 待开始 |
| 3 | Pipeline Query 函数（DAG 构建 + 无环检测） | P2B-1 | ⬜ 待开始 |
| 4 | 扩展 shared types（Skill / Forum / PR / Experience / SkillContextPack） | P2B-2 | ⬜ 待开始 |
| 5 | 新增 packages/skills + Skill Router | P2B-2 | ⬜ 待开始 |
| 6 | Entity Extractor（Symbol / Version / Stage / Problem） | P2B-2 | ⬜ 待开始 |
| 7 | GitHub PR Sync（indexer github-prs.ts） | P2B-3 | ⬜ 待开始 |
| 8 | PullRequestRepo + pull_requests 表 + FTS5 | P2B-3 | ⬜ 待开始 |
| 9 | Forum Crawler（Discourse JSON API + HTML 降级） | P2B-4 | ⬜ 待开始 |
| 10 | ForumRepo + forum_posts 表 + FTS5 | P2B-4 | ⬜ 待开始 |
| 11 | ExperienceNode 统一检索层 + Builder | P2B-5 | ⬜ 待开始 |
| 12 | Context Pack v2 Builder（skill 感知） | P2B-6 | ⬜ 待开始 |
| 13 | Skill Token Budget（per-skill 差异化） | P2B-6 | ⬜ 待开始 |
| 14 | CLI：forum / skills / pipeline / experience | P2B-7 | ⬜ 待开始 |
| 15 | MCP：search_forum / search_experience / dispatch_skill / build_skill_pack | P2B-8 | ⬜ 待开始 |
| 16 | Evaluation（Skill 分发 + Forum SNR） | P2B-9 | ⬜ 待开始 |
| 17 | README / CHANGELOG / Roadmap 更新 | P2B-10 | ⬜ 待开始 |
