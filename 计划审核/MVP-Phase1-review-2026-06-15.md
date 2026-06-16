# MVP Phase 1 总体验收 Review

审核日期：2026-06-15
审核范围：MVP Phase 1 六个里程碑 M1-M6 的当前实现、计划文档、README、测试与构建结果。

## 结论

MVP Phase 1 的六个里程碑从结构、命令、MCP 工具、测试覆盖和文档同步上基本齐全。

当前仍有 1 个 P1 问题：M6 的 `tokenBudget` 参数没有真正作为最终 Context Pack 的硬上限生效，只在超预算时设置 `metadata.truncated = true`。因此，严格按 M6 “Token 预算截断生效”的验收标准看，Phase 1 仍建议修复该问题后再作为完全收口版本。

## Findings

### P1: `tokenBudget` does not actually cap final Context Pack size

位置：

- `packages/context-pack/src/token-budget.ts`

问题：

`truncateContextPack(pack, budget)` 当前使用固定 section budgets：

- symbol: 500
- source: 3000
- callgraph: 500
- issues: 1000

这些 section budgets 总计约 5000 tokens。调用方传入的 `budget` 只在最终统计后检查：

```ts
const totalTokens = estimatePackTokens(pack);
if (totalTokens > budget) {
  truncated = true;
}
```

也就是说，当 `totalTokens > budget` 时，函数只标记 `metadata.truncated = true`，但不会继续裁剪内容让最终 pack 落到预算内。

影响：

- `cesium context Viewer --budget 1000` 仍可能输出远超 1000 estimated tokens 的 Context Pack。
- MCP `build_context_pack` 如果未来暴露 token budget，也会继承同样语义问题。
- 这与 M6 验收标准 “Token 预算截断生效” 不完全一致。

建议：

- 明确 `tokenBudget` 是硬上限还是软提示。
- 如果是硬上限，应在 section-level truncation 后继续进行 total-budget truncation，直到 `estimatePackTokens(pack) <= budget`，或在无法满足时明确记录不可再裁剪原因。
- 补一条测试：构造大 pack，传入小 `tokenBudget`，断言最终 `metadata.totalTokens <= tokenBudget`。

## Verification

```bash
pnpm.cmd test
```

结果：

- 13 test files passed
- 138 tests passed

```bash
pnpm.cmd run build
```

结果：

- workspace build passed
- `shared`、`parser`、`storage`、`indexer`、`context-pack`、`mcp`、`cli` 构建成功

## Milestone Check

| Milestone | 状态 | 说明 |
|---|---|---|
| M1 Symbol Index | 通过 | symbol schema、SQLite 存储、parser 测试存在 |
| M2 Source Retrieval | 通过 | source FTS、source retrieval E2E 测试存在 |
| M3 Issue Index | 通过 | GitHub issue sync、FTS search、state filter 测试存在 |
| M4 CallGraph | 通过 | CallEdge、extractor、BFS upstream/downstream 测试存在 |
| M5 MCP Server | 通过 | 5 个工具中的前 4 个 M5 工具已接入 MCP；SDK Client 协议测试存在 |
| M6 Context Pack | 有条件通过 | `build_context_pack`、`cesium context`、builder/token-budget 测试存在；但 token budget 硬截断语义存在 P1 缺口 |

## Confirmed Deliverables

- README 已标记 M1-M6 为 Done。
- `开发计划/plan.md` 已标记 M1-M6 为完成。
- CLI 已注册 `cesium context <symbol>`。
- MCP `tools/list` 已覆盖 5 个工具：
  - `search_symbol`
  - `get_source`
  - `search_issue`
  - `trace_callgraph`
  - `build_context_pack`
- `build_context_pack` 能返回 `{ symbol, source, callgraph, issues, metadata }`。
- 缺失 section 时返回空数组，不崩溃。
- 符号不存在时返回明确错误。

## Open Question

`tokenBudget` 应该是硬上限，还是只表示 “如果超过预算就标记 truncated” 的软提示？

当前实现是软提示；M6 计划和验收标准更像硬上限。

## Final Judgment

MVP Phase 1 主链路已经成型，可以支撑 “Can Query” 的基础目标。

建议在正式宣布 Phase 1 完全收口前，修复 M6 token budget 的硬截断语义，或修改验收标准明确它只是软预算提示。
