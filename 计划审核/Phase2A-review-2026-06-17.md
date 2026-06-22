# Phase 2A 审核结论（2026-06-17）

## 总体结论

Phase 2A 的主体结构已经实现：新增了 `packages/diagnosis`、静态 Problem KB、诊断匹配、诊断上下文组装、token budget 裁剪、CLI 命令以及 MCP tools。类型检查、构建和主要测试均已通过，基础使用路径可以运行。

但当前不建议直接标记为完全验收通过。审核发现 2 个 P1 级问题，会影响 Phase 2A 作为诊断 MCP tool 的可靠性：

1. token budget 裁剪后仍可能超预算。
2. matcher 缺少最小匹配阈值，弱查询会产生噪声诊断。

这两个问题修复后，再进行最终验收更稳妥。

## P1：Token Budget 裁剪后仍可能超预算

位置：

```text
packages/diagnosis/src/token-budget.ts
```

问题：

`truncateDiagnosticPack()` 会按顺序裁剪 `relatedSource`、`relatedIssues`、`callgraph`、`renderStages`，随后只对 `fixSuggestions` 和 `investigationSteps` 中过长的单条文本做截断，但不会在总 token 仍然超预算时继续删减条目。

实际 CLI 烟测中，以下命令返回的 `metadata.totalTokens` 超过了 `metadata.tokenBudget`：

```bash
node packages/cli/dist/index.js diagnose "tiles" --db database/cesium.db --limit 5 --budget 1000
```

结果中出现：

```text
[metadata] tokens: 1734/1000, truncated: true
```

另一个例子：

```bash
node packages/cli/dist/index.js diagnose "camera" --db database/cesium.db --limit 5 --budget 1000
```

结果中出现：

```text
[metadata] tokens: 1751/1000, truncated: true
```

影响：

- 违反 Phase 2A 的 token budget 契约。
- MCP 消费方可能收到超过预算的诊断包。
- `metadata.truncated = true` 不能代表结果已经满足预算。

建议：

- 在裁剪最后增加强校验：如果 `estimateDiagnosticTokens(result) > budget`，继续按保留优先级裁剪。
- 可以先裁剪/删除低优先级的 `fixSuggestions` 和 `investigationSteps` 条目，但保留每个 matched pattern 的核心诊断信息。
- 如果达到最小可保留结构后仍超预算，应在 metadata 中明确标记不可避免溢出，例如类似 Phase 1 的 `unavoidableOverflow` / `minimumPossibleTokens` 思路。
- 增加回归测试：构造多 pattern、大量 steps/fixes 的 pack，断言普通预算下最终 `totalTokens <= budget`。

## P1：Matcher 缺少最小匹配阈值

位置：

```text
packages/diagnosis/src/matcher.ts
```

问题：

`matchProblemPatterns()` 当前接受所有 `score > 0` 的匹配。由于 related symbol、category、symptom token overlap 都能产生分数，很多弱查询会返回多个不够确定的诊断。

实际 CLI 烟测：

```bash
node packages/cli/dist/index.js diagnose "camera" --db database/cesium.db --limit 5 --budget 1000
```

返回了：

```text
label_visibility
tiles_jitter
depth_precision
lod_popping
z_fighting
```

另一个例子：

```bash
node packages/cli/dist/index.js diagnose "primitive" --db database/cesium.db --limit 5 --budget 1000
```

返回了：

```text
primitive_performance
z_fighting
terrain_conflict
picking_failure
shader_compile_error
```

影响：

- 弱查询会被解释成多个具体诊断，违背“不要编造诊断”的设计原则。
- 后续 `diagnoseProblem()` 会合并所有 matched patterns 的 symbols、source、callgraph、issues，导致诊断包噪声变大。
- token budget 问题会被进一步放大。

建议：

- 为 matcher 增加最小阈值，例如要求 `score >= 3` 或至少命中 alias / trigger keyword / symptom phrase 中的强信号。
- 将 `relatedSymbols` 命中保持为低权重辅助信号，不应单独触发诊断。
- 增加测试覆盖：
  - `camera` 不应直接返回多个诊断，除非查询包含具体症状。
  - `tiles` 这类宽泛类别词不应返回 5 个问题。
  - `polygon flickering`、`shader compile error`、`scene.pick returns undefined` 等强症状仍应稳定命中。

## P2：诊断组装对所有匹配模式一次性展开符号

位置：

```text
packages/diagnosis/src/diagnoser.ts
```

问题：

`diagnoseProblem()` 当前会合并所有 matched patterns 的 `relatedSymbols`，再统一查 symbol、source 和 callgraph。这个实现简单，但在弱匹配较多时会快速放大噪声。

影响：

- 宽泛查询下 `relatedSymbols` 过多。
- `relatedSource` 和 `callgraph` 更容易消耗预算。
- 最强匹配的核心符号没有明显优先级。

建议：

- 修复 matcher 阈值后，这个问题会明显缓解。
- 后续可按 matchedPatterns 排序优先处理最强 pattern 的 symbols。
- 在 budget 较低时，优先保留最强 pattern 的 source/callgraph。

## 已验证通过的内容

执行过以下验证命令：

```bash
pnpm.cmd run typecheck
```

结果：通过。

```bash
pnpm.cmd run build
```

结果：通过。

```bash
pnpm.cmd run test -- packages/diagnosis/src packages/mcp/src/server.test.ts packages/mcp/src/e2e-stdio.test.ts
```

结果：

```text
20 passed test files
232 passed tests
5 skipped
```

CLI 烟测：

```bash
node packages/cli/dist/index.js pkb list
node packages/cli/dist/index.js stage z_fighting
node packages/cli/dist/index.js diagnose "polygon flickering" --db database/cesium.db --limit 2 --budget 2000
node packages/cli/dist/index.js diagnose "what is the weather today" --db database/cesium.db
```

结果：

- `pkb list` 可列出静态 KB。
- `stage z_fighting` 可返回相关 render stages。
- `polygon flickering` 可返回诊断结果。
- 无关查询会返回 `No matching problem patterns found.`。

## 建议处理顺序

1. 先修复 matcher 最小阈值，减少弱匹配噪声。
2. 再修复 token budget 强约束，保证最终 metadata 不超预算。
3. 补充对应回归测试。
4. 重新运行 typecheck、build、diagnosis 测试、MCP server 测试和 CLI 烟测。
5. 通过后再做 Phase 2A 最终验收。

## 最终判定

当前 Phase 2A 可以认为”结构完成、基础功能可运行”，但还不能认为”验收完成”。建议修复上述 P1 问题后再进入最终验收或提交。

---

## 最终验收（2026-06-22）

### P1 修复验证

P1 修复已在 commit `d06e479`（feat(Phase2A): 问题诊断系统 + P1 修复）中合入。本次验收对该 commit 进行了完整验证。

#### P1-1: Matcher 最小匹配阈值 — 已修复

- `matcher.ts` 第 124 行：`if (score > 0 && hasStrong)` 已要求至少命中 alias / trigger keyword / symptom phrase（2+ token overlap）中的强信号。
- `relatedSymbols` 和 `category` 命中仅提供低权重辅助分，不触发 `hasStrong`，不会单独产生诊断匹配。
- 烟测验证：
  - `diagnose “camera”` → “No matching problem patterns found.”（不再返回 5 个噪声诊断）
  - `diagnose “tiles”` → 仅返回 `tiles_jitter` 一个精确匹配
- 回归测试：`matcher.test.ts` 已覆盖弱查询过滤和强症状查询命中。

#### P1-2: Token Budget 硬上限 — 已修复

- `token-budget.ts` 第 201–214 行：新增 “Final hard-cap enforcement” 阶段，当裁剪后仍超预算时，依次丢弃 `fixSuggestions` 和 `investigationSteps`。
- 第 216–239 行：计算 `minimumPossibleTokens`，并在无法进一步裁剪时标记 `unavoidableOverflow: true`。
- 烟测验证：
  - `diagnose “tiles” --budget 1000` → `tokens: 988/1000`（在预算内）
  - `diagnose “camera” --budget 1000` → 无匹配，不产生超预算包
- 回归测试：`token-budget.test.ts` 已覆盖硬上限校验（200/500/1000/2000 多档预算）、`unavoidableOverflow` 标记和最小裁剪结构。

### 测试套件

```bash
pnpm run typecheck  # 通过
pnpm run build      # 通过
pnpm run test       # 20 test files, 239 passed, 5 skipped
```

测试数从审核时的 232 增长到 239（+7 回归测试）。

### 验收结论

**Phase 2A 验收通过。** 两个 P1 问题已修复并配有回归测试，烟测和全量测试均通过。Phase 2A（问题诊断系统）正式完成。
