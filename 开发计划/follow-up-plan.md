# 后续计划 — cesium-nexus

> 起草时间：2026-06-23
> 第一版审核：2026-06-23（有条件通过，A-）
> 本次修订：吸收 5 个 P1 + 7 个 P2 审核意见
> 范围：Phase 2D 收尾 → Phase 2E（Problem Mining Pipeline）→ 质量与验收
> 状态：**已审核通过，可进入执行**

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
| Phase 2D Diagnosis Retrieval Enhancement | ⚠️ 代码完成、**未提交** | 18 个文件改动未 commit，CHANGELOG 已起草 v0.5.0 |
| Phase 2E Problem Mining Pipeline | 🔲 未开始 | 本文档规划对象 |
| Phase 3 Can Diagnose | 🔲 未开始 | 待 Phase 2E 完成后**单独**做范围重审 |

### 0.1 Phase 2D 未提交变更清单（必须先收尾）

```
CHANGELOG.md                          +14
README.md                             +16
future-roadmap.md                     +50
packages/cli/src/commands/diagnose-cmd.ts        +121
packages/diagnosis/src/diagnoser.test.ts         +66
packages/diagnosis/src/diagnoser.ts              +48
packages/diagnosis/src/index.ts                  +3/-1
packages/diagnosis/src/matcher.test.ts           +58
packages/diagnosis/src/matcher.ts                +24
packages/diagnosis/src/token-budget.test.ts      +30
packages/diagnosis/src/token-budget.ts           +18
packages/mcp/src/handlers.ts                     +44
packages/mcp/src/server.ts                       +3/-1
packages/shared/src/types.ts                     +8
packages/vector/src/index.ts                     +17
packages/vector/src/qdrant-client.ts             +99
packages/vector/src/semantic-search.ts           +18
packages/vector/src/types.ts                     +27
packages/vector/src/embed-pkb.ts                 (new file)
```

共计 18 个改动文件 + 1 个新文件，净增 ~625 行。

---

## 1. 阶段 0：Phase 2D 收尾（预计 0.5 天）

**目标：** 把 Phase 2D 的代码从工作区固化成一个可追溯的 commit，并补齐验收材料。

### 任务清单

| # | 任务 | 产出 |
|---|---|---|
| 0.1 | 跑全量验证：`pnpm typecheck` / `pnpm build` / `pnpm test` | 三份通过日志 |
| 0.2 | CLI 烟测：`cesium pkb embed` / `cesium pkb search <query>` / `cesium diagnose --hybrid <problem>` | 输出样例存档 |
| 0.3 | MCP 烟测：`diagnose_problem { hybrid: true }` | 响应样例 |
| 0.4 | 起草 `计划审核/Phase2D-review-2026-06-23.md`，沿用 Phase2A review 的 P1/P2 格式 | 审核文档 |
| 0.5 | 修复审核过程中发现的问题（如有） | 增量 commit |
| 0.6 | 提交 commit：`feat(Phase2D): Hybrid Diagnosis + Vector KB + Experience Recall` | commit hash 回填 CHANGELOG |
| 0.7 | Tag `v0.5.0` | 里程碑版本 |
| 0.8 | 在 `future-roadmap.md` 把 Phase 2D 行的"状态"保持 ✅，补充 commit hash + tag | 文档一致性 |

### 验收门槛

- `pnpm test` 至少 297 个通过（CHANGELOG 声称数）
- CLI `diagnose "polygon flickering" --hybrid` 返回的 `relatedExperiences` 非空
- Qdrant 不可用时 `--hybrid` 自动降级到 keyword-only（graceful fallback 验证）

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

| 周次 | 任务 | 产出 |
|---|---|---|
| **W1** | CanonicalProblem + Clusterer + Candidate Store | 新包脚手架、`canonical_problem` + `problem_candidate` 表、Cosine Threshold Clusterer、`EmbeddingSearchProvider` 抽象 |
| **W2** | Drafting + Scoring + Duplicate Detection | `Drafter`（Ollama 后端）、`Scorer`（与现有 pattern 的 cosine 去重）、自动生成 PatternCandidate |
| **W3** | Review CLI + Promotion Flow | `cesium pkb review / promote / reject / diff` 串联、`generated-patterns.json` 写入 |
| **W4** | 真实数据挖掘 + 覆盖率评估 | 在 CesiumGS/cesium 近 6 个月 issue 上做一轮完整挖掘、产出首批 accepted patterns、跑 Coverage 指标 |

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

---

## 9. 下一步

1. **立即**：执行阶段 0（Phase 2D 收尾 → commit → review → tag v0.5.0）
2. **Phase 2D Review 通过后**：启动 Phase 2E W1（CanonicalProblem + Clusterer + Candidate Store）
3. **Phase 2E W4 完成后**：起草独立的 `计划审核/Phase2E-review-*.md`，包含 Approved Rate / Coverage Gain / 去重效果
4. **Phase 2E Review 通过后**：另起 `Phase3-scope-review-*.md`，不混在一起

**审核状态：✅ 已通过（v2 修订版），可进入执行阶段。**
