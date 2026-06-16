# M5 验收报告

验收日期：2026-06-15
验收范围：`M5-implementation-plan.md` 执行结果、MCP server/handler、CLI `mcp` 命令、storage 前置能力、README 同步。

## 结论

M5 功能验收通过。

本阶段目标是提供 4 个 MCP 工具调用能力：

- `search_symbol`
- `get_source`
- `search_issue`
- `trace_callgraph`

验收确认：4 个工具已注册，协议层可通过 SDK Client 完成 `initialize`、`tools/list`、`tools/call`，并返回统一 JSON envelope。

## 验收命令

```bash
pnpm.cmd test
```

结果：

- 11 个 test files passed
- 98 个 tests passed
- 包含新增 MCP handler 单测和 MCP protocol integration 测试

```bash
pnpm.cmd run build
```

结果：

- workspace build passed
- `shared`、`parser`、`storage`、`indexer`、`context-pack`、`mcp`、`cli` 均构建成功

## 核心验收点

| 验收项 | 结果 | 说明 |
|---|---|---|
| 4 个 MCP 工具注册 | 通过 | `tools/list` 返回 `search_symbol`、`get_source`、`search_issue`、`trace_callgraph` |
| MCP 协议集成测试 | 通过 | 使用 SDK `Client + InMemoryTransport`，覆盖 handshake、list tools、call tools |
| Zod 输入 schema | 通过 | `query/symbol_id/symbol` 使用 `.min(1)`；`limit` 为 1..100；`depth` 为 1..10 |
| 标准 JSON envelope | 通过 | handler 返回 `{ success, data?, error? }` |
| 错误不抛到协议外 | 通过 | handler 内部 try/catch，错误转换为 `{ success: false, error }` |
| stdio 无 `console.log` 污染 | 通过 | `packages/mcp` 和 CLI `mcp-cmd.ts` 未发现实际 `console.log` |
| `get_source` storage 前置能力 | 通过 | `SymbolRepo.getSourceBySymbolId()` 已实现，MCP handler 已复用 |
| `trace_callgraph` 共享 resolver | 通过 | resolver 已抽到 `packages/storage/src/symbol-resolver.ts`，CLI trace 和 MCP 复用 |
| README 同步 | 通过 | M5 工具列表只包含 4 个工具；`build_context_pack` 已标注为 M6 planned |

## 代码检查摘要

- `packages/mcp/src/server.ts`
  - 注册 4 个 MCP tools。
  - 使用 Zod schema 限制输入边界。
  - `startServer()` 使用 `StdioServerTransport`。

- `packages/mcp/src/handlers.ts`
  - 抽出纯 handler。
  - 统一返回 `ToolResponse`。
  - 复用 `SymbolRepo`、`IssueRepo`、`CallGraphRepo` 和 `resolveSymbolId()`。

- `packages/mcp/src/server.test.ts`
  - 使用 SDK Client 和 `InMemoryTransport` 做真实协议层测试。
  - 覆盖 `tools/list` 和 4 个工具的 `tools/call`。

- `packages/storage/src/symbol-resolver.ts`
  - 保留 M4 语义：带点号输入只做精确匹配，不做 FTS fallback。
  - 简单名称先 `findByName()`，再 FTS fallback。

- `README.md`
  - `cesium mcp` 配置示例已更新。
  - `MCP Tools Reference (M5)` 已对齐 4 个已实现工具。
  - `build_context_pack` 已移到 M6 planned。

## 轻微遗留项

以下两项不阻塞 M5 主验收，但建议后续补齐以让计划清单更严丝合缝：

1. Handler 层空输入测试未完全覆盖

   当前 MCP 协议层已经通过 Zod 拦截空输入，例如 `search_symbol` 的空 `query` 会返回 tool error。但 `handlers.test.ts` 未覆盖计划中提到的“纯 handler 空 query 返回 `success:false`”。

2. `getSourceBySymbolId()` 缺少 repo 级直接单测

   当前该方法已被 `handleGetSource()` 间接覆盖，但 `symbol-repo.test.ts` 没有直接测试 “symbolId 存在返回完整 source，symbolId 不存在返回 undefined”。

## 最终判断

M5 可以收。

当前实现已经满足 AI Agent 通过 MCP stdio 调用 Cesium knowledge-base 4 个核心工具的要求，并可作为 M6 Context Pack 的基础设施继续推进。
