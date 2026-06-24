# Phase 2E W2 代码审查报告

**审查对象**：`35dfb60 feat(mining): W2 - Drafting + Scoring + Duplicate Detection`
**审查日期**：2026-06-23
**审查人**：QoderCN
**涉及包**：`@cesium-nexus/mining`（W1 基础上新增 4 文件 + 4 测试 + 1 pipeline + README）
**测试基线**：`pnpm test` 通过 356 / skip 11（W1 基线 327，W2 +29 测试）

---

## 0. 总体评价

**结论：Conditional Approval B+**（必须修复 P1 后方可进入 W3；P2 建议本轮同步处理）

W2 整体结构清晰，与 W1 的四层架构（Cluster → Canonical → Candidate → Pattern）咬合良好。`LLMBackend` 抽象遵守了 P2-5（默认 Ollama / OpenAI Compatible fallback / 无 OpenAI 强绑 / 无 function calling）。测试覆盖真实，29 个新增用例均能体现设计意图。**但存在 2 个 P1 问题**（一个会导致 pipeline 在生产环境崩溃，一个让 Scorer 的去重形同虚设），必须在进入 W3 CLI 串联前修复。

---

## 1. P1 必改（阻塞 W3）

### P1-1 ⛔ Drafter.systemPrompt 声明了但从未发送

**位置**：`packages/mining/src/drafting/drafter.ts:60-82`

```ts
constructor(opts: DrafterOptions) {
  this.llm = opts.llm;
  this.systemPrompt = opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;  // 存储
}
async draft(...) {
  const userPrompt = DRAFTER_USER_TEMPLATE(...);
  const raw = await this.llm.complete(userPrompt, { ... });        // 仅发 userPrompt
}
```

**问题**：`systemPrompt` 被存入 `this` 但 `draft()` 里从未把它拼到 prompt 中。`LLMBackend.complete(prompt)` 又是单参数接口，无 system 通道。结果是：
- Ollama 收到的 prompt 完全没有 "You are a CesiumJS expert analyst..." 的专家人设，仅靠 user template 里 "## Task" 指令驱动。
- 默认 `DEFAULT_SYSTEM_PROMPT` 形同死代码；自定义 `systemPrompt` 也被默默丢弃。
- 测试 `drafter.test.ts:190-221 "uses custom system prompt when provided"` 的注释承认 "The system prompt is not sent in the current implementation"，断言只验证 drafter 没崩、没验证 systemPrompt 生效。

**修复方案（二选一）**：
- **方案 A（推荐）**：把 systemPrompt 前置拼接到 userPrompt：`await this.llm.complete(this.systemPrompt + "\n\n" + userPrompt, ...)`。保持 `LLMBackend` 接口单一。
- **方案 B**：扩展 `LLMBackend` 增加可选 `system?: string` 参数，Ollama 用 `system` 字段、OpenAI Compatible 用 `messages[0].role="system"`。更正规但破坏 W2 "no function calling" 的极简约定。

---

### P1-2 ⛔ Pipeline 用非空断言查 canonical → 集群分配错位时会崩溃

**位置**：`packages/mining/src/pipeline.ts:129-135`

```ts
const draftResults = await this.drafter.draftBatch(
  clusters.map((c) => ({
    canonical: canonicalProblems.find((cp) => cp.clusterIds.includes(c.id))!,  // ⚠️
    cluster: c,
    ...
  })),
);
```

**问题**：
1. `!` 非空断言假设 `buildCanonicalProblems` 一定为每个 cluster 生成一个 canonical。若上游逻辑改动（例如 cluster 被过滤、canonical 合并）导致 `find` 返回 undefined，pipeline 会在 LLM 调用时抛 `TypeError: Cannot read properties of undefined`，且错误栈难以定位到根因。
2. 外层还有 `draftBatch` 的 try/catch，但 catch 里会写入 `Drafter error: ...`，掩盖了真正的 pipeline 编排 bug。

**修复**：显式检查并跳过（或抛带上下文的 Error）：

```ts
const canonical = canonicalProblems.find((cp) => cp.clusterIds.includes(c.id));
if (!canonical) {
  throw new Error(`Pipeline invariant violated: cluster ${c.id} has no canonical problem`);
}
```

---

### P1-3 ⛔ Scorer.buildCandidateVector 是 3 维合成 → 与 384 维真实 pattern 向量余弦恒为 0

**位置**：`packages/mining/src/drafting/scorer.ts:89-122`

```ts
private buildCandidateVector(candidate): Float32Array {
  // Deterministic synthetic vector (3 dims for testing; real embed is 384)
  const dims = 3;
  const vec = new Float32Array(dims);
  for (let i = 0; i < text.length; i++) { ... }
  ...
}
```

**问题**：`loadExistingPatternVectors()` 从 Qdrant 取回的是 `embedText()` 产出的 384 维归一化向量。`cosineSimilarity` 在两向量维度不一致时会因内积循环短边而产出一个无意义的值（或 NaN），去重判断 `> 0.9` 在生产环境**永远不会触发**，所有 candidate 的 `dup_of` 都是 null。测试通过是因为测试用例里 pattern 向量也是 3 维的——测试和生产用的不是同一个维度空间。

**修复**：
- 注入 `embedText: (text: string) => Promise<Float32Array>`（来自 `@cesium-nexus/vector`）到 `Scorer`；缺省回退到当前合成器（仅测试用，加 `_UNSAFE_testOnly` 命名）。
- 或让 Scorer 依赖 `EmbeddingSearchProvider.embedText()`（已在 `types.ts` 声明），把 candidate 的 alias+symptoms+symbols 拼成字符串后真实嵌入。
- 同步加一个测试：用 384 维随机 pattern 向量 + 嵌入后的 candidate 验证 `dup_of` 触发。

---

### P1-4 ⛔ Pipeline memberId 解析硬编码 `^issue:(\d+)$` → 实际向量 ID 格式不匹配

**位置**：`packages/mining/src/pipeline.ts:99-107`

```ts
experienceIdByMemberId: (memberId) => {
  const m = memberId.match(/^issue:(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
},
issueIdByMemberId: (memberId) => {
  const m = memberId.match(/^issue:(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
},
```

**问题**：
1. `experienceIdByMemberId` 和 `issueIdByMemberId` 用了完全相同的正则——前者永远不会匹配到 experience（因为 memberId 都是 `issue:*`）。
2. `pipeline.test.ts` 用的 vector id 是 `"issue:1"`（冒号），但 W1 的 `canonical-problem.ts` 约定以及 `QdrantEmbeddingProvider` 实际写入的 id 格式需要确认（可能是 `github-issue/NNNN` 或纯数字）。一旦生产 id 不是 `issue:\d+`，所有 `representativeIssueId` 都是 null，`CanonicalProblem` 失去与 issue 的关联。
3. 两个回调本应区分 issue / experience，但目前逻辑完全相同。

**修复**：
- 与 `@cesium-nexus/vector/src/embed-pkb.ts` / indexer 写入侧对齐，明确 vector id schema（例如 `github-issue/<number>`、`forum/<id>`、`experience/<uuid>`）。
- 把正则抽成 `parseVectorId(id): { kind, numericId }` 工具函数，issueIdByMemberId 和 experienceIdByMemberId 按 kind 分发。
- 加一个 pipeline 测试用例覆盖真实 id 格式。

---

## 2. P2 建议（本轮顺手修）

### P2-1 CLI `pkb mine` 把建表 DDL 又写了一遍

**位置**：`packages/cli/src/commands/diagnose-cmd.ts:344-361`

`MiningStore` 构造函数已经 `CREATE TABLE IF NOT EXISTS`（`packages/mining/src/review/mining-store.ts:13,27`）。CLI 里再 `db.exec(...)` 重复一遍 schema，将来加字段时两处都要改。

**修复**：删掉 CLI 里的 `db.exec(...)` 块，只 `new MiningStore(db)`。`MiningStore` 构造即初始化 schema。

### P2-2 CLI `--llm-backend <type>` 选项声明了但永远走 Ollama

**位置**：`packages/cli/src/commands/diagnose-cmd.ts:325,364-367`

```ts
.option("--llm-backend <type>", "LLM backend: ollama | openai", "ollama")
...
const llmBackend = new OllamaBackend({ ... });  // 未读 opts.llmBackend
```

**修复**：根据 `opts.llmBackend` 分支构造 backend（OpenAICompatibleBackend 需要 `--openai-base-url` / `--openai-api-key` 选项）；或直接删除该选项，等 W3 需要时再加。

### P2-3 CLI `--since <date>` 没有校验

```ts
vectorScope: opts.since
  ? { entityType: "issue", since: new Date(opts.since).getTime() }
  : ...
```

`new Date("garbage").getTime()` 返回 `NaN`，会悄悄传给 provider。加一行 `if (Number.isNaN(since)) throw ...`。

### P2-4 Pipeline O(N²) 查 member summary

**位置**：`pipeline.ts:119` — `vectors.find((v) => v.id === memberId)` 对每个 cluster 的每个 member 都线性扫 2000+ 条向量。

**修复**：先 `const byId = new Map(vectors.map(v => [v.id, v]))`，O(1) 查。

### P2-5 Drafter parseDraft 去 fence 只处理首尾

```ts
const jsonStr = raw.replace(/^```(?:json)?\s*/im, "").replace(/\s*```$/im, "").trim();
```

如果 LLM 在 JSON 前后都写了 prose（"Here is the answer:\n```json\n{...}\n```\nLet me know..."），当前正则会漏掉中段。建议用单个非贪婪 `/```(?:json)?\s*([\s\S]*?)\s*```/` 抽 fence 内容，匹配不到再 fallback。

### P2-6 pipeline.test.ts 用 CommonJS `require`

```ts
const Database = require("better-sqlite3");
```

NodeNext + strict 下 `require` 不一定可用。改用 `import Database from "better-sqlite3"`（其他 mining 测试文件已用 ESM）。

### P2-7 README 测试数与实际不符

README 写 "59 tests"，`pnpm test` 实际 W2 基线是 356（mining 包 59 = W1 30 + W2 29，仅 mining 内部统计 59 是对的）。在 README 顶部明确 "59 tests in this package" 避免歧义。

### P2-8 `Drafter.draftBatch` 失败时写 `draftSymptoms: ["Drafter error: ..."]` 到 store

错误症状会被下游当成真实症状参与 cosine 去重、审核展示。建议加显式 `failedDraft: true` 标记，让 W3 review CLI 能一眼过滤。

---

## 3. 架构 / 约定合规检查

| 检查项 | 结论 |
|---|---|
| LLMBackend 只暴露 `complete(prompt, opts)`，无 function calling | ✅ 合规 |
| 默认 Ollama / OpenAI Compatible 备选 | ✅ 合规（但 CLI 侧未接通，P2-2） |
| Cosine Threshold 聚类，HDBSCAN 延后 | ✅ 合规 |
| Drafter 产 `NewCandidateInput` | ✅ 合规 |
| Scorer 阈值 0.9、独立于 Clusterer | ✅ 合规（但 P1-3 让去重实际失效存疑） |
| Pipeline fail-fast 不强求 graceful fallback | ✅ 合规 |
| 无 OpenAI 强绑 | ✅ 合规 |
| 无 YAML/JSON 配置，prompt 为 TS 常量 | ✅ 合规 |
| 4 层数据模型（Cluster / Canonical / Candidate / Pattern）完整 | ✅ 合规 |

---

## 4. 测试覆盖度

| 文件 | 用例数 | 评价 |
|---|---|---|
| `llm-backend.test.ts` | 10 | 覆盖 Ollama/OpenAI 双 backend、重试、URL 清理、auth header、空 choices。充分。 |
| `drafter.test.ts` | 6 | 覆盖 JSON/fence/prose/batch 错误恢复。systemPrompt 测试是空断言（见 P1-1）。 |
| `scorer.test.ts` | 8 | 覆盖阈值、正交、best-match、空候选、ProblemCandidate。维度问题未覆盖（P1-3）。 |
| `pipeline.test.ts` | 5 | 覆盖完整 E2E、空向量、最小 cluster、噪声丢弃、summary 传递。id 格式只用 `"issue:N"`（P1-4）。 |

**总计 29 个新增用例，结构清晰，fake provider / fake LLM 隔离干净**。但两个测试盲区与 P1 问题强相关，修复 P1 时需同步补用例。

---

## 5. 下一步建议

1. **立即**：修 P1-1 ~ P1-4（每个都是 ~10 行改动，总工作量 < 1h）
2. **本轮顺手**：P2-1 ~ P2-8（CLI schema 重复、--llm-backend 未用、--since 校验、O(N²)、fence 正则、ESM import、README 数、failedDraft 标记）
3. **修完后**：重跑 `pnpm test`，把 mining 测试数从 59 提到 ≥ 63（每个 P1 补 1 个回归用例）
4. **提交**：`feat(mining): W2 - Drafting + Scoring + Dedup (review fixes)`
5. **然后**：进入 W3（`pkb review / promote / reject / diff` CLI 串联）

**审核状态：⚠️ Conditional B+（修 P1 后自动升为 Approved，可进入 W3）。**
