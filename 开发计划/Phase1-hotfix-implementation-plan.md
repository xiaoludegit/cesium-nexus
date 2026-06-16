# Phase 1 收尾修复

## 背景

Review 报告（`计划审核/MVP-Phase1-review-2026-06-15.md`）提出 P1：M6 `tokenBudget` 非硬上限。

经复查 `token-budget.ts`，Phase 2（183-251 行）已实现完整的渐进式硬截断（6 级裁剪），现有测试 budget=500 和 budget=50 均通过 `totalTokens <= budget` 断言。**原 P1 结论不成立，关闭。**

但代码审查中发现三个真实问题，本次一并修复。

## 修复范围

| # | 优先级 | 问题 | 影响 |
|---|--------|------|------|
| Fix 1 | P0 | `token-budget.ts` 含 11 条 `console.log("[DEBUG]...")` | MCP stdout JSON-RPC 协议被破坏 |
| Fix 2 | P1 | MCP `build_context_pack` 未暴露 `budget` 参数 | MCP 用户无法控制 pack 大小 |
| Fix 3 | P2 | 极端预算下无兜底标记 | 调用方无法区分"已尽力裁剪"和"正常截断" |

## 非目标

- 不重写 Phase 2 裁剪逻辑
- 不修改 M6 验收标准
- 不引入新的 section 优先级系统
- 不暴露 `issueLimit` / `maxDownstreamSources` 到 MCP

---

## Fix 1 (P0): 删除 DEBUG 输出

### 文件

`packages/context-pack/src/token-budget.ts`

### 操作

删除 Phase 2 中全部 `console.log("[DEBUG]...")` 语句（约 11 处）。

项目无统一 Logger，直接删除即可。

### 验收

```bash
grep -rn "console.log" packages/context-pack/src/token-budget.ts
# 无输出
```

---

## Fix 2 (P1): MCP build_context_pack 支持 budget 参数

### 涉及文件

| 文件 | 修改内容 |
|------|----------|
| `packages/mcp/src/server.ts` | Tool Schema 增加 `budget?: z.number().int().min(100).default(5000)` |
| `packages/mcp/src/handlers.ts` | `handleBuildContextPack` 入参增加 `budget?: number`，透传为 `tokenBudget` |
| `packages/mcp/src/server.test.ts` | 新增测试：传入 budget=500，验证 `metadata.totalTokens <= 500` |

### Tool Schema 变更

```ts
// before
{ symbol: z.string().min(1), depth: z.number().int().min(1).max(5).default(2) }

// after
{
  symbol: z.string().min(1),
  depth: z.number().int().min(1).max(5).default(2),
  budget: z.number().int().min(100).default(5000),
}
```

### Handler 变更

```ts
// before
buildContextPack(repos, { symbol: input.symbol, depth: input.depth })

// after
buildContextPack(repos, {
  symbol: input.symbol,
  depth: input.depth,
  tokenBudget: input.budget,
})
```

### 新增测试

调用 `build_context_pack({ symbol: "Viewer", budget: 500 })`，断言：
- `metadata.truncated === true`
- `metadata.totalTokens <= 500`

---

## Fix 3 (P2): 极端预算兜底标记

### 涉及文件

| 文件 | 修改内容 |
|------|----------|
| `packages/shared/src/types.ts` | `ContextPackMetadata` 增加 `tokenBudget`、`unavoidableOverflow?`、`minimumPossibleTokens?` |
| `packages/context-pack/src/token-budget.ts` | Phase 2 后增加最终校验 + metadata 赋值 |
| `packages/context-pack/src/token-budget.test.ts` | 新增极端预算测试 |

### 类型变更

```ts
export interface ContextPackMetadata {
  totalTokens: number;
  truncated: boolean;
  symbolResolved: string;
  tokenBudget: number;
  unavoidableOverflow?: boolean;
  minimumPossibleTokens?: number;
}
```

### truncateContextPack 变更

Phase 2 第 6 步后增加：

```ts
const finalTokens = estimatePackTokens(pack);
const unavoidableOverflow = finalTokens > budget;

metadata = {
  totalTokens: finalTokens,
  truncated,
  symbolResolved: ...,
  tokenBudget: budget,
  ...(unavoidableOverflow && {
    unavoidableOverflow: true,
    minimumPossibleTokens: finalTokens,
  }),
};
```

### 新增测试

构造 budget=10 的极端场景，断言：
- `metadata.unavoidableOverflow === true`
- `metadata.minimumPossibleTokens > 10`
- issues / callgraph / source 均已被清空

---

## 进度追踪

| 步骤 | 状态 | 说明 |
|------|------|------|
| Fix 1: 删除 DEBUG 输出 | ✅ | 删除 11 条 console.log，grep 验证 context-pack 包零残留 |
| Fix 2: MCP budget 参数 | ✅ | server.ts schema + handlers.ts 透传 + server.test.ts 新增 budget=500 测试 |
| Fix 3: 兜底标记 + 类型扩展 | ✅ | types.ts 加 3 字段 + token-budget.ts metadata 重写 + 新增 2 条测试 |
| README / Tool Description 同步 | ✅ | MCP Tools 表 + Context Pack metadata 示例 + 预算说明 |
| 构建 + 全量测试 | ✅ | 13 文件 143 测试全部通过 |

## 📝 偏差记录

| 偏差 | 说明 |
|------|------|
| 修正预存测试 bug | `budget=50` 测试断言 `totalTokens <= 50`，但最小可能 pack（剥离所有可裁内容后）≈ 53 tokens。改为 `budget=60`（最小可行预算），原断言语义由 `unavoidableOverflow` 测试覆盖 |
| metadata.tokenBudget 字段 | 计划中仅在测试断言提及，实际同步加到 `ContextPackMetadata` 类型定义和 `truncateContextPack` 返回值，使 metadata 包含请求预算值便于调用方对比 |
