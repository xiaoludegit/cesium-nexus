# 后续计划 — cesium-nexus

> 起草时间：2026-06-23
> 第一版审核：2026-06-23（有条件通过，A-）
> v2 修订：吸收 5 个 P1 + 7 个 P2 审核意见（同日晚）
> v3 修订：2026-06-23，回填已完成工作的 commit hash，标注 W1 完成
> 范围：Phase 2D 收尾 → Phase 2E（Problem Mining Pipeline）→ 质量与验收
> 状态：**执行中** — Phase 2D 收尾 ✅ / Phase 2E W1 ✅ / W2 ✅ / W3 ✅ / 待启动 W4

本文档是对 [`future-roadmap.md`](../future-roadmap.md) 的细化执行计划。

> **项目目标（审核锚点）：** 不是做一个 Cesium 百科，而是构建一个能够**持续提升诊断能力**的 Diagnosis System。所有 Phase 2E 的设计与取舍都以此为判据。

---

## 0. 当前状态盘点

| 阶段 | 状态 | 备注 |
|---|---|---|
| Phase 2A Problem Diagnosis | ✅ 已验收（commit `d06e479`） | 含 P1 修复 + 239 tests |
| Phase 2B Render Pipeline Intelligence | ✅ 完成 | 12-stage DAG + 5 Skills |
| Phase 2C Experience Graph | ✅ 完成 | `fixes` 确定性边 + BFS |
| Phase 2C+ Qdrant Vector Search | ✅ 完成 | 384 维 ONNX embed + `references` 推断边 |
| Phase 2D Diagnosis Retrieval Enhancement | ✅ 完成 + 已发布 | commit `e04a5ea`，tag `v0.5.0`，297 tests |
| Phase 2E Problem Mining Pipeline | 🟡 W3 已完成 | W1 `ae32352` / W2 + W3 待 commit，374 passed |
| Phase 3 Can Diagnose | 🔲 未开始 | 待 Phase 2E 完成后**单独**做范围重审 |

### 0.0 进度日志

| 时间 | 事项 | Commit |
|---|---|---|
| 2026-06-23 | Phase 2D 收尾 — commit + tag `v0.5.0` | `e04a5ea` / `c69ab03` / `aa050c8` |
| 2026-06-23 | Phase 2D Review 通过（无 P1，2 个 P2 环境项） | [`计划审核/Phase2D-review-2026-06-23.md`](../计划审核/Phase2D-review-2026-06-23.md) |
| 2026-06-23 | P2-1 + P2-2 sharp graceful（dynamic import + CLI friendly error） | `6e81c48` |
| 2026-06-23 | Phase 2E W1 — `@cesium-nexus/mining` 包脚手架 + 4 层架构 | `ae32352` |
| 2026-06-24 | Phase 2E W2 — LLMBackend + Drafter + Scorer + Pipeline | (待 commit) |
| 2026-06-24 | Phase 2E W2 Review — 4 P1 + 8 P2 → 全部修复，360 tests pass | (待 commit) |
| 2026-06-24 | Phase 2E W3 — Promoter + Review CLI + 6 个新子命令，374 tests pass | (待 commit) |
| 2026-06-24 | **W4 待启动** — 真实数据挖掘 + Coverage 评估 | — |

### 0.1 W1 已落地的文件清单

```
packages/mining/
  ├─ package.json                       (+@qdrant/js-client-rest, +better-sqlite3)
  ├─ tsconfig.json
  ├─ tsup.config.ts
  └─ src/
       ├─ types.ts                      (CanonicalProblem / ProblemCandidate / Cluster / EmbeddingSearchProvider / VectorScope / ...)
       ├─ index.ts
       ├─ discovery/
       │    ├─ cosine-clusterer.ts      (+ cosine-clusterer.test.ts, 10 tests)
       │    ├─ canonical-problem.ts     (+ canonical-problem.test.ts, 5 tests)
       │    └─ qdrant-embedding-provider.ts
       ├─ drafting/
       │    └─ candidate-factory.ts     (+ candidate-factory.test.ts, 4 tests)
       └─ review/
            └─ mining-store.ts          (+ mining-store.test.ts, 11 tests)

pnpm-lock.yaml                          (updated)
tsconfig.json                           (root references 加 vector + mining)
```

测试总计：**374 passed / 11 skipped**（W0 基线 297 → W1 327 → W2 360 → W3 374）。

---

## 1. 阶段 0：Phase 2D 收尾 ✅ 完成

**已交付（2026-06-23）：**

- commit `e04a5ea` — `feat(Phase2D): Hybrid Diagnosis + Vector KB + Experience Recall`（21 files, 1463 行）
- commit `c69ab03` — `chore: mark v0.5.0 released (2026-06-23)`
- commit `aa050c8` — `docs: roadmap 技术栈列头对齐实际 Phase + 补 Phase2D review 链接`
- tag `v0.5.0`
- 审核文档：[`计划审核/Phase2D-review-2026-06-23.md`](../计划审核/Phase2D-review-2026-06-23.md)（无 P1，2 个 P2 环境项）

**验收门槛（已达成）：**
- ✅ `pnpm test` 297 通过
- ✅ CLI `diagnose "polygon flickering" --hybrid` 返回 z_fighting（graceful fallback 到 keyword-only）
- ✅ MCP 13 tools 齐全，`diagnose_problem { hybrid: true }` 响应完整

**P2 跟进（已在 commit `6e81c48` 中修复）：**
- P2-1 sharp 环境 → `embedding.ts` 改 dynamic import + CLI `pkb embed` / `pkb search` friendly error
- P2-2 `searchKnowledgeBase` 无 fallback → 调用方 try/catch 已覆盖

> 原阶段 0 的 8 项任务清单（0.1–0.8）已归档到 git history，不再列出。

---

## 2. 阶段 1：Phase 2E — Problem Mining Pipeline（预计 4 周）

### 2.1 目标

让系统能**从 issue / forum 数据中自动发现高频问题模式**，持续提升 Diagnosis System 的覆盖率。

**关键区分（审核 P1-1）：**

```
Issue
  ↓ 向量聚类
Cluster                 ← 数据层，纯数学
  ↓ 聚合命名
CanonicalProblem        ← 概念层，代表一个"真实问题"
  ↓ LLM 草拟 + 人工审核
PatternCandidate        ← 建议层，可被拒绝
  ↓ promote
Pattern (problem-patterns.json)  ← 生效层
```

> CanonicalProblem 是**去重的关键**。没有它，"z-fighting / polygon flicker / depth fighting" 会被当作 3 个独立 pattern 进入 PKB，污染诊断结果。

### 2.2 模块架构（P2-1：拆层）

```
packages/mining/
  ├─ src/
  │    ├─ discovery/        ← 聚类 & 发现问题
  │    │    ├─ embedding-provider.ts     (P1-2: 抽象接口)
  │    │    ├─ cosine-clusterer.ts         (P2-2: 先用 cosine threshold)
  │    │    └─ canonical-problem.ts      (P1-1: 概念实体)
  │    ├─ drafting/         ← LLM 草拟 PatternCandidate
  │    │    ├─ drafter.ts
  │    │    ├─ llm-backend.ts            (P2-5: Ollama / OpenAI-compatible)
  │    │    └─ scorer.ts
  │    ├─ review/           ← 人工审核
  │    │    ├─ candidate-repo.ts         (P1-3: 含来源统计)
  │    │    └─ review-cli.ts             (P2-3: terminal prompt, 不做 TUI)
  │    └─ promotion/        ← 安全落库
  │         └─ promoter.ts               (P1-4: 写入 generated-patterns.json)
  ├─ package.json
  └─ README.md
```

### 2.3 新增核心实体（P1-1：CanonicalProblem）

```ts
// packages/mining/src/discovery/canonical-problem.ts
interface CanonicalProblem {
  id: string;                       // "canonical/z-fighting" 等稳定 ID
  title: string;                    // 标准化标题
  aliases: string[];                // 已知的同义表达
  representativeIssueId: number;    // 最具代表性的 issue
  clusterIds: string[];             // 合并了哪些 cluster
  experienceIds: string[];          // 关联的 experience 节点
  confidence: number;               // 0..1，基于 cluster 规模与内聚度
  status: "candidate" | "reviewed" | "accepted";
  createdAt: number;
  reviewedAt?: number;
}
```

**作用：**

- Cluster → CanonicalProblem 是**多对一合并**（多个相似 cluster 归一到同一"真实问题"）
- CanonicalProblem → PatternCandidate 是**一对多草稿**（同一问题可试多种 pattern 表述）
- PatternCandidate → Pattern 是**人工确认后 1:1 落地**

### 2.4 Embedding 抽象（P1-2：Clusterer 不绑 Qdrant）

```ts
// packages/mining/src/discovery/embedding-provider.ts
interface EmbeddingSearchProvider {
  // 在已有向量集合中按 cosine 检索
  search(query: EmbeddingQuery): Promise<EmbeddingHit[]>;
  // 批量取出某类实体的向量（用于聚类）
  listVectors(scope: VectorScope): Promise<VectorRecord[]>;
}

interface EmbeddingQuery {
  text?: string;
  vector?: Float32Array;
  topK: number;
  minScore?: number;
  filter?: Record<string, unknown>;
}

interface VectorScope {
  entityType: "experience" | "issue" | "pattern" | "stage";
  since?: number;
}
```

当前实现：`QdrantEmbeddingProvider`（复用 `@cesium-nexus/vector`）。
未来替换：`SqliteVectorProvider` / `PgVectorProvider` / `MilvusProvider` 都不影响 Clusterer。

> Clusterer 只依赖 `EmbeddingSearchProvider`，不 import `QdrantClient`。

### 2.5 聚类算法（P2-2：先不上 HDBSCAN）

Phase 2E 使用 **Cosine Threshold Clustering**：

```ts
// packages/mining/src/discovery/cosine-clusterer.ts
interface ClusterConfig {
  threshold: number;    // 默认 0.90，可在 0.85/0.90/0.95 三档实验
  minClusterSize: number;  // 默认 5
  maxClusterSize: number;  // 默认 50，避免吞并
}
```

**理由：**
- 当前数据量 ~2000 issues，HDBSCAN 80% 时间在调参
- Cosine threshold 可控、可解释、可复现
- 通过 `--threshold` 参数做扫描，对照已有 10 个 pattern 作为 ground truth

**HDBSCAN 放 Phase 3+ 评估条件：** 数据量 > 1 万条 或 CanonicalProblem > 50 个。

### 2.6 候选数据表（P1-3：来源统计）

```sql
CREATE TABLE canonical_problem (
  id                     TEXT PRIMARY KEY,
  title                  TEXT NOT NULL,
  aliases                TEXT NOT NULL,      -- JSON array
  representative_issue_id INTEGER,
  cluster_ids            TEXT NOT NULL,      -- JSON array
  experience_ids         TEXT NOT NULL,      -- JSON array
  confidence             REAL NOT NULL,
  status                 TEXT DEFAULT 'candidate',
  created_at             INTEGER NOT NULL,
  reviewed_at            INTEGER
);
CREATE INDEX idx_canonical_status ON canonical_problem(status);

CREATE TABLE problem_candidate (
  id                TEXT PRIMARY KEY,
  canonical_id      TEXT NOT NULL REFERENCES canonical_problem(id),
  cluster_id        TEXT NOT NULL,
  draft_alias       TEXT NOT NULL,      -- JSON array
  draft_symptoms    TEXT NOT NULL,      -- JSON array
  draft_symbols     TEXT NOT NULL,      -- JSON array
  draft_category    TEXT,
  llm_raw           TEXT,               -- LLM 原始回复留痕
  quality_score     REAL,
  dup_of            TEXT,               -- 去重指向的已有 pattern id（如有）
  status            TEXT DEFAULT 'pending',
  reviewed_at       INTEGER,
  created_at        INTEGER NOT NULL,

  -- P1-3: 来源统计（review 时直接展示）
  source_count      INTEGER NOT NULL DEFAULT 0,
  issue_count       INTEGER NOT NULL DEFAULT 0,
  forum_count       INTEGER NOT NULL DEFAULT 0,
  experience_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_candidate_status ON problem_candidate(status);
CREATE INDEX idx_candidate_canonical ON problem_candidate(canonical_id);
```

### 2.7 安全 Promote 流程（P1-4：不直接改主 JSON）

```
approve (review CLI)
   ↓
promoter.ts
   ↓
data/pkb/generated-patterns.json   ← 追加写入
   ↓
人工 diff + merge
   ↓
data/pkb/problem-patterns.json     ← 人工确认后合入
   ↓
cesium pkb embed                   ← 重新 embed 到 Qdrant
```

**约束：**

- `promoter.ts` **永不写** `problem-patterns.json`
- `generated-patterns.json` 是**建议清单**，包含完整 pattern 草稿 + 来源统计 + canonical link
- 提供 `cesium pkb diff` 命令，展示 `generated` vs `current` 的差异，辅助 merge
- merge 完成后由 `cesium pkb embed` 触发向量化

**理由：** 避免 git conflict / 重复 pattern / 误覆盖。审核轨迹清晰。

### 2.8 LLM 后端（P2-5：本地优先，禁止强绑 OpenAI）

```ts
// packages/mining/src/drafting/llm-backend.ts
interface LLMBackend {
  complete(prompt: string, opts?: LLMOptions): Promise<string>;
}

class OllamaBackend implements LLMBackend { /* 默认 */ }
class OpenAICompatibleBackend implements LLMBackend { /* fallback */ }
```

**配置：**

```json
{
  "llm": {
    "backend": "ollama",
    "ollama": { "model": "qwen2.5:7b", "url": "http://localhost:11434" },
    "openai": { "model": "gpt-4o-mini", "baseUrl": "..." }
  }
}
```

- 默认 `ollama`，保持离线能力
- 支持任何 OpenAI-compatible endpoint（本地 LM Studio、vLLM、远端均可）
- **禁止**直接依赖 `openai` SDK 的特有 API（function calling 等不用）

### 2.9 CLI 命令

```bash
# 触发一次挖掘（手动，P2-4：不做 cron）
cesium pkb mine --since <date> [--threshold 0.90] [--min-cluster 5]

# 审核工作台（terminal prompt，P2-3：不做 TUI）
cesium pkb review

# 查看 generated vs current 差异
cesium pkb diff

# 把 approved 候选写入 generated-patterns.json（P1-4）
cesium pkb promote <candidate_id>

# 标记拒绝
cesium pkb reject <candidate_id>

# 聚类 / 通过率 / 覆盖率统计（含 P2-7 指标）
cesium pkb mining-stats
```

### 2.10 MCP Tools

本阶段**不新增** MCP tool（保持 13 个）：
- 挖掘是人工低频操作，CLI 足够
- Agent 如需查询候选，可用 `search_experience` + 现有过滤替代
- 避免 Phase 2 的工具膨胀

### 2.11 任务排期（按 1 人 × 4 周）

| 周次 | 状态 | 任务 | 产出 |
|---|---|---|---|
| **W1** | ✅ `ae32352` | CanonicalProblem + Clusterer + Candidate Store | 新包脚手架、`canonical_problem` + `problem_candidate` 表、Cosine Threshold Clusterer、`EmbeddingSearchProvider` 抽象 |
| **W2** | ✅ 2026-06-24 | Drafting + Scoring + Duplicate Detection | `LLMBackend`（Ollama + OpenAI-compatible）、`Drafter`（system+user prompt 拼接）、`Scorer`（async + 可注入 384 维 textEmbedder）、`MiningPipeline` 编排器、`cesium pkb mine` CLI、374 tests |
| **W3** | ✅ 2026-06-24 | Review CLI + Promotion Flow | `Promoter`（generated-patterns.json 幂等写入 + 冲突检测）、`cesium pkb review/promote/approve/reject/diff/mining-stats`、14 个 promoter 测试 |
| **W4** | 🔲 | 真实数据挖掘 + 覆盖率评估 | 在 CesiumGS/cesium 近 6 个月 issue 上做一轮完整挖掘、产出首批 accepted patterns、跑 Coverage 指标 |

### 2.11.1 W1 实际产出（commit `ae32352`，2026-06-23）

| 模块 | 文件 | 说明 |
|---|---|---|
| 包脚手架 | `packages/mining/package.json` / `tsconfig.json` / `tsup.config.ts` | 依赖 `@cesium-nexus/{shared,storage,vector}` + `@qdrant/js-client-rest` + `better-sqlite3` |
| 类型 | `src/types.ts` | `CanonicalProblem` / `ProblemCandidate` / `Cluster` / `ClusterConfig` / `EmbeddingSearchProvider` / `VectorRecord` / `EmbeddingHit` / `VectorScope` / `MiningRunStats` |
| discovery | `src/discovery/cosine-clusterer.ts` | `CosineThresholdClusterer`（greedy seed + 全成员 cosine 阈值）+ `cosineSimilarity` 导出 |
| discovery | `src/discovery/canonical-problem.ts` | `buildCanonicalProblems` 工厂 + `resetCanonicalSeq` 测试辅助 |
| discovery | `src/discovery/qdrant-embedding-provider.ts` | `QdrantEmbeddingProvider` 实现 `EmbeddingSearchProvider`（search + listVectors + embedText） |
| drafting | `src/drafting/candidate-factory.ts` | `buildCandidate` 工厂（默认 pending + source 统计聚合）+ `resetCandidateSeq` |
| review | `src/review/mining-store.ts` | `MiningStore`：schema init + upsert/list/get/setStatus/stats 全套 |
| 测试 | 4 个 `*.test.ts` | 共 30 tests（clusterer 10 / canonical 5 / candidate 4 / store 11） |
| 配置 | 根 `tsconfig.json` | references 新增 `packages/vector`（之前缺失）+ `packages/mining` |

**W1 决策记录（实施过程中的取舍）：**
- Clusterer 使用 greedy seed 算法（每个 seed 吸纳所有 pairwise cosine ≥ threshold 的成员），而非"先两两相似度图再连通分量"，避免 O(N²) 内存；对 2000 issues 足够快
- `CanonicalProblem.confidence` 暂用 `(clusterScore × 0.5 + size × 0.05)` 线性公式，cap 在 1.0；W4 真实数据上可能需要调
- `MiningStore` 把 `canonical_problem` + `problem_candidate` 合并到一个类，避免 schema init 竞争；如果未来要跨包复用，再拆出独立 repo
- `QdrantEmbeddingProvider.listVectors` 用 `scroll` 分页 + `next_page_offset` 收窄为 `string|number|undefined`（Qdrant SDK 类型允许 null/Record，需要显式过滤）

### 2.11.2 W2 实际产出（2026-06-24，待 commit）

| 模块 | 文件 | 说明 |
|---|---|---|
| drafting | `src/drafting/llm-backend.ts` | `LLMBackend` 接口 + `OllamaBackend`（默认 + 指数退避 retry）+ `OpenAICompatibleBackend`，均通过 fetch 调用，不依赖 openai SDK |
| drafting | `src/drafting/drafter.ts` | system + user prompt 拼接（P1-1 修复）、非贪婪 fence 抽取（P2-5）、失败草稿 `failedDraft: true` 落库（P2-8） |
| drafting | `src/drafting/scorer.ts` | `score()`/`scoreBatch()` async，可注入 `textEmbedder: TextEmbedder`，384 维真实向量去重 + 维度不匹配保护（P1-3 重写） |
| pipeline | `src/pipeline.ts` | `parseNodeId()` dispatch（github-issue/N 或 experience/id）、`canonicalByClusterId` 不变量校验（P1-2）、`vectorsById` O(1) 摘要查找（P2-4） |
| types | `src/types.ts` | `ProblemCandidate.failedDraft: boolean` |
| review | `src/review/mining-store.ts` | `failed_draft` 列 + `listCandidatesByStatus(limit, offset)` + `countCandidates(status?)`（W3 预留） |
| CLI | `packages/cli/src/commands/diagnose-cmd.ts` | `cesium pkb mine --since --threshold --min-cluster --llm-backend --openai-*` 全套开关；去除重复 DDL（P2-1）；since ISO 校验（P2-2） |
| 测试 | 4 个新/重写 `*.test.ts` | 新增 pipeline 不变量回归、scorer 384 维真实 textEmbedder + dim mismatch skip、drafter fence / 失败路径 |

**W2 决策记录：**
- `LLMBackend` 仅暴露 `complete(prompt, opts)`，不使用 function calling，满足"禁止强绑 OpenAI"约束
- `Drafter` prompt 模板保持 TypeScript 模板字符串，未做 YAML/JSON 配置化
- `Scorer` 的 textEmbedder 通过依赖注入而非硬绑 `QdrantEmbeddingProvider`，让 scorer 测试可纯函数化
- `MiningPipeline` 仍强依赖 `QdrantEmbeddingProvider`，无 vector 时直接抛出 sharp 环境修复提示
- W2 Review 产出 4 P1 + 8 P2，全部在当日晚修复，360 tests pass

### 2.11.3 W3 实际产出（2026-06-24，待 commit）

| 模块 | 文件 | 说明 |
|---|---|---|
| promotion | `src/promotion/promoter.ts`（新增，~286 行） | `GeneratedPattern`（extends `ProblemPattern` + 溯源字段）、`PromoteInput`、`promoteCandidate`（幂等 append/replace + id 冲突检测）、`buildGeneratedPattern`（纯函数）、`loadGeneratedPatterns`（ENOENT→[]）、`diffGenerated`（added/updated/unchanged） |
| promotion | `src/promotion/promoter.test.ts`（新增，~300 行） | 14 个测试覆盖 build/promote/diff 三条路径，含"同 candidateId 幂等"、"不同 candidateId 同 id 冲突抛错"、"pretty-print JSON" 等回归 |
| review | `src/review/mining-store.ts` | `listCandidatesByStatus(status, limit, offset)` + `countCandidates(status?)`，供 review / mining-stats CLI 使用 |
| index | `src/index.ts` | 导出 `promoteCandidate / buildGeneratedPattern / loadGeneratedPatterns / diffGenerated / GeneratedPattern / PromoteInput / ScorerConfig / TextEmbedder` |
| CLI | `packages/cli/src/commands/diagnose-cmd.ts` | 新增 `cesium pkb review` / `promote <id>` / `approve <id>` / `reject <id>` / `diff` / `mining-stats` 六个子命令 + `printCandidateDetail` 结构类型 helper |

**W3 决策记录：**
- `promoter.ts` 永不写 `problem-patterns.json`（严守 P1-4）；仅写 `generated-patterns.json`
- `GeneratedPattern` 在 `ProblemPattern` 基础上追加 `candidateId / canonicalId / clusterId / promotedAt / sourceCount`，便于 review 溯源
- `promoteCandidate` 冲突检测采用"相同 id 但不同 candidateId → 抛错"语义，避免覆盖他人 promote
- `sanitizeId` 将非 alnum 字符统一替换为 `_`，因此 `candidate/1` 落库为 `candidate_1`（已在测试期望中反映）
- `normalizeCategory` 把未知 category 归一为 `"debug"`（保守默认，避免 schema 错误）
- CLI 形态保持 terminal prompt（P2-3），未引入 TUI
- 本阶段未新增 MCP tool（遵守 §2.10 约束）

### 2.11.4 W4 任务拆解（待启动，预计 1 周）

**目标：** 在 CesiumGS/cesium 近 6 个月 issue 上跑一次完整挖掘，产出首批可 promote 的 candidate，并测量 Phase 2D → Phase 2E 的 Coverage 提升。

| # | 任务 | 文件 | 测试 / 验收 |
|---|---|---|---|
| W4.1 | **Phase 2D Coverage 基线**：在最近 500 条 issue 上用 `matchProblemPatterns`（Hybrid Matcher）跑一遍，记录命中率 | 新增 `packages/diagnosis/src/evaluation.coverage.test.ts` 或 CLI `cesium pkb coverage --baseline` | 基线数字写入 `计划审核/Phase2E-review-*.md` §1 |
| W4.2 | **真实数据抓取**：`cesium pkb fetch --repo CesiumGS/cesium --since 6m` 把 issue 落库到 `cesium.db` | 扩展 `packages/indexer/src/github/github-issues.ts` 或 CLI 包壳 | e2e guard 覆盖 fetch 命令注册 |
| W4.3 | **端到端挖掘**：`cesium pkb mine --since 6m --threshold 0.90 --llm-backend ollama`，产出 ≥ 5 个 candidate | CLI 串联 provider → clusterer → canonical → drafter → scorer → store | store 中 candidate 数 ≥ 1；accepted 目标 ≥ 5 |
| W4.4 | **Review + Promote 实战**：`cesium pkb review` 逐个过，`promote` accepted 到 `generated-patterns.json` | 人工 | `generated-patterns.json` 首批 ≥ 5 条 |
| W4.5 | **人工 merge**：把 `generated-patterns.json` 合入 `problem-patterns.json`（保留 review 轨迹） | 手工编辑 + git diff 留痕 | PR 描述包含 review 截图 |
| W4.6 | **Phase 2E Coverage 结果**：在同样 500 条 issue 上重测命中率，对比基线 | 同 W4.1 | 提升 ≥ 15pp（硬指标 §2.12） |
| W4.7 | **Approved Rate / FP 抽样 / Canonical 去重评估**：填 §2.12 硬指标 | 人工统计 | 写入 review 文档 |
| W4.8 | **性能基线实测**：`cesium pkb mine --since 6m` 耗时（不含 LLM） | CLI 输出 | < 60s（硬指标 §2.12） |

**W4 决策预设（实施时若偏离需回填 §2.11.5）：**
- 目标仓库：`CesiumGS/cesium`（GitHub issue 主库），forum 暂不在本轮范围
- 时间窗：近 6 个月（`--since` 取值 = today - 180d）
- LLM 后端：默认 Ollama（`qwen2.5:7b`），若本地不可用则 fallback 到 OpenAI Compatible
- Coverage 基线测量与 Phase 2E 结果测量必须使用**同一批** 500 条 issue（同 seed），避免抽样偏差
- W4 结束时**不自动**启动 Phase 3 Scope Review，需用户明确指令

### 2.12 验收标准（P1-5 + P2-7）

**硬指标（全部必须）：**

- [ ] **Approved Rate ≥ 20%**：`accepted / total_candidates ≥ 0.20`
- [ ] **False Positive Rate ≤ 50%**：被 reject 的候选中，人工复查 20 个，明显是噪声的 ≤ 10 个
- [ ] **Problem Coverage 提升 ≥ 15pp**：在最近 500 条 issue 上，当前 PKB 命中率 vs 扩充后命中率之差（见 P2-7）
- [ ] **Accepted 绝对数 ≥ 5**：至少 5 个新 pattern 进入 `generated-patterns.json`（待人工 merge）
- [ ] **CanonicalProblem 去重有效**：同义 cluster 被合并到同一 canonical 的比例 ≥ 70%（人工抽样 20 个 canonical 评估）
- [ ] **回归测试 ≥ 15 个**：覆盖 mining 包的 discovery / drafting / review / promotion 四层
- [ ] **性能基线**：`cesium pkb mine --since 6m` 在 ~2000 issue 上 < 60s（不含 LLM 推理）
- [ ] **审核文档**：`计划审核/Phase2E-review-*.md` 自查通过

**Problem Coverage 指标（P2-7）：**

```
coverage = (# 被至少 1 个 pattern 命中的 issue) / (500)
```

测量方式：用 `matchProblemPatterns`（Hybrid Matcher）在最近 500 条 issue 标题+正文上跑一遍，统计命中率。
Phase 2D 基线需要在 W4 前测量一次（预计 ~15–20%），Phase 2E 目标是提升到 ≥ 30–35%。

### 2.13 已知风险

| 风险 | 缓解 |
|---|---|
| 聚类粒度不稳（过细/过粗） | cosine threshold 三档扫描（0.85/0.90/0.95），对照 10 个现有 pattern |
| LLM 草稿质量参差 | 草稿只作建议，`review` 强制确认；保留 `llm_raw` 字段审计 |
| 与现有 pattern 重复 | Scorer 强制计算与已有 pattern 的 cosine，> 0.9 自动标 `dup_of` |
| CanonicalProblem 合并错误 | `canonical_id` 允许 review 时手工调整，`canonical_problem.cluster_ids` 保留合并痕迹 |
| Ollama 本地 LLM 响应慢 | 提供 batch 模式 + 进度显示；单次挖掘允许断点续跑 |

---

## 3. 阶段 2：质量与收尾（预计 1 周）

### 3.1 端到端验收场景

设计 10 个真实用户问题做端到端评估（覆盖 5 个 Skill）：

| # | 问题 | 预期 Skill | 预期命中 pattern |
|---|---|---|---|
| Q1 | "polygon flickering when zoom" | debug | z_fighting |
| Q2 | "terrain tiles popping at horizon" | debug | lod_popping / tiles_jitter |
| Q3 | "scene.pick returns undefined on 3D tileset" | debug | picking_failure |
| Q4 | "how does the render loop schedule jobs" | api | — |
| Q5 | "slow when rendering 10k labels" | performance | label_visibility / primitive_performance |
| Q6 | "GLSL fragment shader fails to compile on Safari" | shader | shader_compile_error |
| Q7 | "depth precision in globe view" | debug | depth_precision |
| Q8 | "migration from 1.118 to 1.130" | general | — |
| Q9 | "camera flyTo animation jitter" | debug | tiles_jitter |
| Q10 | "how to disable terrain depth test" | api | terrain_conflict |

### 3.2 性能基线补充

在 `docs/performance-baseline.md` 追加 Phase 2D / 2E 基线：

- `cesium diagnose --hybrid <query>`（Qdrant 冷启动）< 2.5s
- `cesium diagnose --hybrid <query>`（Qdrant 热）< 800ms
- `cesium pkb search <query>` < 500ms
- `cesium pkb mine --since 6m` 在 2k 数据上 < 60s（不含 LLM）
- `cesium pkb mining-stats` < 2s

### 3.3 文档补齐

- `README.md` 追加 Phase 2D / 2E 命令速查
- `CHANGELOG.md` v0.6.0 entry（Phase 2E 完成时）
- `future-roadmap.md` Phase 2E 行标 ✅ 并回填 commit hash + tag

### 3.4 Phase 2E 独立 Review（P2-6）

起草独立的 `计划审核/Phase2E-review-2026-*.md`，必须包含：

1. **Approved Rate**：accepted / total 比例
2. **False Positive 抽查**：20 个 rejected 候选复查
3. **Problem Coverage Gain**：Phase 2D 基线 vs Phase 2E 结果
4. **CanonicalProblem 去重效果**：抽样 20 个 canonical 的合并准确率
5. **LLM 草稿质量**：抽样 10 个 accepted 候选，评估草稿可用性
6. **性能**：`cesium pkb mine` 实际耗时

> 与 Phase 3 范围重审**严格分离**（P2-6）。验收 ≠ 规划。

---

## 4. 阶段 3：Phase 3 范围重审（独立进行，Phase 2E 验收后）

Phase 2E Review 通过后，**另起**一份 `计划审核/Phase3-scope-review-*.md`，重新评估：

**保留评估：**
- Migration Skill / Shader Skill / Cross-version Diff

**重新评估：**
- Blog Sync / GitHub Discussion — 是否真的与 issue/forum 互补？可先做 1 周数据采样
- `CanonicalProblem` 层是否已经能支撑 Phase 3 的跨版本问题关联

**新增评估项：**
- 是否引入 LLM-based Skill Router（替代当前 keyword scoring）
- 是否引入 HDBSCAN（基于 Phase 2E 的数据量决定）

决策产出：`开发计划/Phase3-implementation-plan.md`（不在本文档范围内）。

---

## 5. 总体时间线

```
  W0.5             W1  W2  W3  W4              W5              W6+
 ────┼──────────────┼───┼───┼───┼───────────────┼───────────────┼──────
  Phase 2D 收尾  Phase 2E (Mining Pipeline)   Phase 2E Review   Phase 3
  commit         W1 Canonical + Clusterer     独立验收文档       Scope Review
  review         W2 Drafter + Scorer          Coverage 测量      (另起)
  tag v0.5.0     W3 Review CLI + Promote      v0.6.0
                 W4 真实数据 + Coverage
```

**总预估：** 5.5 周（1 人）

- Phase 2D 收尾：0.5 天
- Phase 2E 主体：4 周
- Phase 2E 收尾 + Review：1 周
- Phase 3 决策：另行评估，不在本次工时内

---

## 6. 审核前明确不启动的工作

为遵守"计划通过前不动手"，以下工作**在 Phase 2D 收尾完成前不做**：

- ❌ 创建 `packages/mining/` 目录或任何骨架代码
- ❌ 新增 `canonical_problem` / `problem_candidate` 表 migration
- ❌ 修改 `problem-patterns.json` 或 `generated-patterns.json`
- ❌ 安装聚类 / LLM 新依赖
- ❌ 起草 Phase 2E 审核文档（先完成 Phase 2D 审核）
- ❌ Phase 3 范围讨论（与 Phase 2E 解耦）

**允许立即做的：**

- ✅ Phase 2D 未提交变更的 commit + review + tag v0.5.0（属于"阶段 0 收尾"）

---

## 7. 待决策项（已在本版定稿）

| # | 决策项 | 结论（审核批复） |
|---|---|---|
| 1 | LLM 路线 | 默认 Ollama，支持 OpenAI Compatible，禁止强绑 OpenAI（P2-5） |
| 2 | Review CLI 形态 | terminal prompt，不做 TUI（P2-3） |
| 3 | 是否定时挖掘 | 否，手动 `cesium pkb mine`（P2-4） |
| 4 | Phase 3 审查是否合并 | 否，与 Phase 2E Review 严格分离（P2-6） |

---

## 8. 审核修订记录

### 2026-06-23 v2（吸收 P1+P2）

| ID | 类型 | 修订点 |
|---|---|---|
| P1-1 | 必改 | 新增 `CanonicalProblem` 层，区分 Cluster / Canonical / Candidate / Pattern 四层 |
| P1-2 | 必改 | `EmbeddingSearchProvider` 抽象接口，Clusterer 不绑 Qdrant |
| P1-3 | 必改 | `problem_candidate` 新增 `source_count` / `issue_count` / `forum_count` / `experience_count` |
| P1-4 | 必改 | Promote 写 `generated-patterns.json`，人工 merge 到 `problem-patterns.json` |
| P1-5 | 必改 | 验收新增 Approved Rate ≥ 20%、False Positive ≤ 50% 硬指标 |
| P2-1 | 建议 | mining 包按 `discovery / drafting / review / promotion` 拆层 |
| P2-2 | 建议 | Phase 2E 用 Cosine Threshold，HDBSCAN 放 Phase 3+ |
| P2-3 | 建议 | Review CLI 用 terminal prompt，不做 TUI |
| P2-4 | 建议 | 手动挖掘，不做 cron |
| P2-5 | 建议 | 默认 Ollama，OpenAI Compatible fallback |
| P2-6 | 建议 | Phase 2E Review 与 Phase 3 Scope Review 严格分离 |
| P2-7 | 建议 | 新增 `Problem Coverage` 指标，500 issue 命中率 ≥ +15pp |

### 2026-06-23 v3（进度回填，无新决策）

- header 状态更新为"执行中 — Phase 2D 收尾 ✅ / Phase 2E W1 ✅ / 待启动 W2"
- 新增 §0.0 进度日志 + §0.1 W1 已落地文件清单
- §1 阶段 0 压缩为归档引用（已交付 commits + tag + 审核链接）
- §2.11 任务排期表加"状态"列，W1 标 ✅；新增 §2.11.1 W1 实际产出 + W1 决策记录；新增 §2.11.2 W2 任务拆解
- §9 下一步 更新为当前真实状态

### 2026-06-24 v4（W2 + W3 完成回填，无新决策）

- header 状态更新为"执行中 — Phase 2D 收尾 ✅ / Phase 2E W1 ✅ / W2 ✅ / W3 ✅ / 待启动 W4"
- §0.0 进度日志追加 W2 / W2 Review / W3 三条（commit hash 待回填）
- §2.11 任务排期表 W2 / W3 状态改 ✅，W4 描述加"待启动"
- 原 §2.11.2（W2 任务拆解）替换为 §2.11.2 W2 实际产出 + §2.11.3 W3 实际产出 + §2.11.4 W4 任务拆解
- §9 下一步 表更新：W2 / W3 标 ✅，W4 加粗为当前待启动项
- 测试基线：W2 完成 360 tests pass → W3 完成 374 tests pass（W0 基线 297）

---

## 9. 下一步

| # | 阶段 | 状态 | 备注 |
|---|---|---|---|
| 1 | Phase 2D 收尾 | ✅ 完成 | commits `e04a5ea` / `c69ab03` / `aa050c8`，tag `v0.5.0`，review 通过 |
| 2 | Phase 2E W1 | ✅ 完成 | commit `ae32352`，mining 包脚手架 + 4 层架构，30 新测试 |
| 3 | Phase 2E W2 | ✅ 完成 | LLMBackend + Drafter + Scorer + Pipeline + `cesium pkb mine`；W2 Review 4 P1 + 8 P2 全部修复，360 tests pass |
| 4 | Phase 2E W3 | ✅ 完成 | Promoter + Review/Promote/Approve/Reject/Diff/Mining-stats CLI，374 tests pass（+14 新测试） |
| 5 | **Phase 2E W4** | 🔲 待启动 | 真实数据挖掘 + Coverage 评估（见 §2.11.4） |
| 6 | Phase 2E Review | 🔲 | 独立审核文档（Approved Rate / Coverage Gain / 去重效果） |
| 7 | Phase 3 Scope Review | 🔲 | Phase 2E 通过后**另起**，不合并 |

**当前阻塞：无。待用户指令启动 W4。**
