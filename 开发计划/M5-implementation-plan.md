# M5: MCP Server（LLM 工具调用能力）

目标：

为 AI Agent（Claude Desktop、Codex CLI、Hermes）提供 MCP 工具调用能力。

本阶段实现 4 个核心工具，对应已有 CLI 能力：

```text
search_symbol   → cesium symbol / search --name-only
get_source      → cesium source
search_issue    → cesium issue
trace_callgraph → cesium trace
```

📝 `build_context_pack` 留到 M6，不在本阶段实现。

原则：

* 复用已有 Repo 层（SymbolRepo / CallGraphRepo / IssueRepo）
* 不新增业务逻辑，只做 MCP 协议适配
* 标准 JSON 信封：`{ success: true, data: {} }`
* 错误不抛异常，返回 `{ success: false, error: "..." }`
* **MCP server 运行期间不得使用 console.log**（stdout 是 JSON-RPC 通道），日志只写 console.error

---

# Step 1：依赖安装

MCP 包新增依赖：

```json
{
  "zod": "^4.4.0"
}
```

📝 使用 zod ^4.4.0 与当前 lockfile 中 @modelcontextprotocol/sdk@1.29.0 搭配的 zod@4.4.3 保持一致，避免 pnpm 装出两套。

CLI 包新增依赖：

```json
{
  "@cesium-nexus/mcp": "workspace:*"
}
```

---

# Step 2：Storage 前置补充

📝 审核 P1：`get_source` 依赖了当前不存在的 Repo 方法。

在 `packages/storage/src/symbol-repo.ts` 新增：

```ts
getSourceBySymbolId(symbolId: string): SourceCodeEntry | undefined
```

```ts
interface SourceCodeEntry {
  symbolId: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  code: string;
}
```

逻辑：

```sql
SELECT * FROM source_code WHERE symbol_id = ?
```

测试覆盖：

- symbolId 存在时返回完整条目
- symbolId 不存在时返回 undefined

---

# Step 3：符号解析器抽取

📝 审核 P1：`trace_callgraph` 不能复用 CLI 私有函数，MCP 不应依赖 CLI。

从 `packages/cli/src/commands/trace-cmd.ts` 的 `resolveSymbolId()` 抽取到：

```text
packages/storage/src/symbol-resolver.ts
```

```ts
export function resolveSymbolId(
  input: string,
  symbolRepo: SymbolRepo,
): ResolvedSymbol | null
```

```ts
export interface ResolvedSymbol {
  id: string;
  displayName: string;
}
```

保留 M4 整改语义：

- 带点号输入精确匹配失败即返回 null
- 简单名称先 findByName，再 FTS fallback

CLI `trace-cmd.ts` 改为导入此函数，删除内部实现。
MCP `trace_callgraph` 也导入此函数。

测试：

- 带点号精确匹配成功
- 带点号找不到返回 null
- 简单名称匹配
- FTS fallback

---

# Step 4：MCP 工具 Handler 层

📝 审核 P2：抽出纯函数 handler，单测直接验证。

新增：

```text
packages/mcp/src/handlers.ts
```

导出 4 个 handler 函数：

```ts
export function handleSearchSymbol(
  symbolRepo: SymbolRepo,
  input: { query: string; limit?: number },
): Promise<ToolResponse>

export function handleGetSource(
  symbolRepo: SymbolRepo,
  input: { symbol_id: string },
): Promise<ToolResponse>

export function handleSearchIssue(
  issueRepo: IssueRepo,
  input: { query: string; limit?: number; state?: "open" | "closed" },
): Promise<ToolResponse>

export function handleTraceCallgraph(
  symbolRepo: SymbolRepo,
  callGraphRepo: CallGraphRepo,
  input: { symbol: string; direction?: "down" | "up"; depth?: number },
): Promise<ToolResponse>
```

统一返回类型：

```ts
interface ToolResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}
```

所有 handler 内部 try/catch，错误返回 `{ success: false, error }`。

---

# Step 5：MCP Server 注册

新增：

```text
packages/mcp/src/server.ts
```

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
```

创建 server + 注册 4 个工具：

```ts
export function createServer(dbPath: string): McpServer {
  const db = openDatabase(dbPath);
  initSchema(db);
  const symbolRepo = new SymbolRepo(db);
  const issueRepo = new IssueRepo(db);
  const callGraphRepo = new CallGraphRepo(db);

  const server = new McpServer({
    name: "cesium-nexus",
    version: "0.1.0",
  });

  // search_symbol
  server.tool("search_symbol", "Search Cesium symbols by name or doc comment", {
    query: z.string().min(1),
    limit: z.number().int().min(1).max(100).default(10),
  }, async (input) => { ... });

  // get_source
  server.tool("get_source", "Get source code for a symbol by ID", {
    symbol_id: z.string().min(1),
  }, async (input) => { ... });

  // search_issue
  server.tool("search_issue", "Search GitHub issues via full-text search", {
    query: z.string().min(1),
    limit: z.number().int().min(1).max(100).default(10),
    state: z.enum(["open", "closed"]).optional(),
  }, async (input) => { ... });

  // trace_callgraph
  server.tool("trace_callgraph", "Trace upstream/downstream call graph for a symbol", {
    symbol: z.string().min(1),
    direction: z.enum(["down", "up"]).default("down"),
    depth: z.number().int().min(1).max(10).default(2),
  }, async (input) => { ... });

  return server;
}
```

📝 输入 schema 加了边界约束：`.min(1)` / `.int()` / `.min().max()`，与 CLI 校验一致。

启动函数：

```ts
export async function startServer(dbPath: string): Promise<void> {
  const server = createServer(dbPath);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

📝 **MCP server 运行期间严禁 console.log**。所有诊断日志使用 `console.error`。

---

# Step 6：MCP 包导出

更新：

```text
packages/mcp/src/index.ts
```

```ts
export { createServer, startServer } from "./server.js";
```

---

# Step 7：CLI cesium mcp 命令

新增：

```text
packages/cli/src/commands/mcp-cmd.ts
```

```ts
program
  .command("mcp")
  .description("Start MCP server (stdio transport)")
  .option("--db <path>", "SQLite database path", "./database/cesium.db")
  .action(async (opts) => {
    const { startServer } = await import("@cesium-nexus/mcp");
    await startServer(path.resolve(opts.db));
  });
```

在 CLI 入口注册 `registerMcpCommand(program)`。

📝 mcp-cmd.ts 使用 dynamic import 延迟加载 MCP SDK，避免 `cesium symbol` 等普通命令也加载 MCP 依赖。

---

# Step 8：单元测试（Handler 层）

新增：

```text
packages/mcp/src/handlers.test.ts
```

使用 `:memory:` DB + `initSchema()`，插入最小 fixture：

```ts
// fixture: 3 symbols + 2 source_code entries + 2 issues + 3 call_edges
```

覆盖：

| 测试项 | 验证 |
|---|---|
| handleSearchSymbol 找到结果 | success=true, data.results 非空 |
| handleSearchSymbol 无结果 | success=true, data.results=[] |
| handleSearchSymbol 空 query | success=false, error |
| handleGetSource 找到 | success=true, data.code 非空 |
| handleGetSource 找不到 | success=false, error="Symbol not found" |
| handleSearchIssue 找到 | success=true, data.results 非空 |
| handleSearchIssue state 过滤 | open 只返回 open |
| handleTraceCallgraph downstream | success=true, data.edges 非空 |
| handleTraceCallgraph upstream | success=true, data.edges 非空 |
| handleTraceCallgraph symbol 不存在 | success=false, error |
| handleTraceCallgraph 空 call_edges | success=true, data.edges=[] |

---

# Step 9：协议集成测试

新增：

```text
packages/mcp/src/server.test.ts
```

使用 SDK Client + InMemoryTransport（或 StdioClientTransport 连接子进程）：

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
```

覆盖：

| 测试项 | 验证 |
|---|---|
| initialize 握手成功 | 无异常 |
| tools/list 返回 4 个工具 | tools.length === 4 |
| tools/list 包含正确名称 | search_symbol, get_source, search_issue, trace_callgraph |
| tools/call search_symbol | 返回正确 content 结构 |
| tools/call get_source | 返回正确 content 结构 |

📝 审核 P1：验收不再用无效的 echo JSON-RPC 命令，改为 SDK Client 真实协议验证。

---

# Step 10：CLI trace-cmd 重构

将 `trace-cmd.ts` 中的 `resolveSymbolId` 删除，改为导入 `packages/storage` 的共享版本：

```ts
import { resolveSymbolId } from "@cesium-nexus/storage";
```

确保 CLI trace 行为不变。

---

# Step 11：README 更新

更新 MCP Tools Reference：

- 移除 `build_context_pack`，标注为 "M6 — Planned"
- 4 个 M5 工具标注为已实现
- MCP 配置示例更新为 `cesium mcp` 命令
- 移除 "M5 — Planned" 标记

---

# 验收标准

以下全部通过：

```bash
pnpm test          # 全部测试通过（含新增 handler 单测 + 协议集成测试）
pnpm run build     # workspace 构建通过
```

满足：

* 4 个工具正确注册（SDK Client tools/list 验证）
* 输入 schema 使用 Zod 定义，含边界约束
* 输出使用标准 JSON 信封
* 错误不崩溃，返回 `{ success: false, error }`
* MCP server 运行期间无 console.log 污染 stdout
* handler 单测通过
* 协议集成测试通过
* README 同步更新

M5 完成后应能够支撑：

```text
Agent (Claude Desktop / Codex CLI / Hermes)
  ↓
MCP Tool (stdio JSON-RPC)
  ↓
Handler → Repo (Symbol / CallGraph / Issue)
  ↓
SQLite
```

作为 M6 Context Pack 的基础设施。

## Progress

| Step | 内容 | 状态 |
|---|---|---|
| 1 | 依赖安装 (zod ^4.4 + CLI→MCP 依赖) | ✅ 完成 |
| 2 | Storage 前置补充 (getSourceBySymbolId) | ✅ 完成 |
| 3 | 符号解析器抽取 (symbol-resolver.ts) | ✅ 完成 |
| 4 | MCP 工具 Handler 层 (handlers.ts) | ✅ 完成 |
| 5 | MCP Server 注册 (server.ts + 4 工具) | ✅ 完成 |
| 6 | MCP 包导出 | ✅ 完成 |
| 7 | CLI cesium mcp 命令 | ✅ 完成 |
| 8 | 单元测试 (Handler 层, :memory: DB) | ✅ 完成 |
| 9 | 协议集成测试 (SDK Client + InMemoryTransport) | ✅ 完成 |
| 10 | CLI trace-cmd 重构 (导入共享 resolver) | ✅ 完成 |
| 11 | README 更新 (4 工具 + 移除 build_context_pack) | ✅ 完成 |
