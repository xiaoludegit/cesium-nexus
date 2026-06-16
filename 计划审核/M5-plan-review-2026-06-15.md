# M5 计划审核报告

审核日期：2026-06-15  
审核范围：`开发计划/M5-implementation-plan.md`、当前 `packages/mcp` / `packages/cli` / `packages/storage` 实现、README 里的 MCP 描述。  
审核方式：只读计划审核 + 当前代码能力对照 + 基线测试/构建验证。未修改业务代码。

## 结论

M5 计划方向正确：只做 MCP 协议适配，先交付 4 个工具，`build_context_pack` 留到 M6，这个边界是合理的。  
但计划里有几处执行风险，需要先补清楚，否则执行 AI 容易在 `get_source`、`trace_callgraph`、MCP 验收命令和 README 同步上踩坑。

## 基线验证

当前 M4 后代码基线验证：

```bash
pnpm.cmd test
```

结果：
- 8 个测试文件通过
- 71 / 71 tests passed

```bash
pnpm.cmd run build
```

结果：
- workspace 构建通过
- `shared`、`parser`、`storage`、`indexer`、`context-pack`、`mcp`、`cli` 全部成功

## 计划问题与修改建议

### P1 `get_source` 计划依赖了当前不存在的 Repo 方法

位置：`开发计划/M5-implementation-plan.md:125-140`  
现状：
- 计划要求 `get_source` 用 `SymbolRepo.findById + source_code`
- 但当前 `SymbolRepo` 只暴露 `findById()`、`searchSource()`，没有 `getSourceBySymbolId()` 或等价方法
- MCP 包如果直接 `db.prepare("SELECT ... FROM source_code")`，就违反了计划里的“复用 Repo 层，不新增业务逻辑”

建议：
- 在 M5 计划里新增一个前置小步骤：给 `SymbolRepo` 增加 `getSourceBySymbolId(symbolId)`，返回 `{ symbolId, name, filePath, startLine, endLine, code } | undefined`
- `get_source` 工具只调用 `symbolRepo.findById()` 和 `symbolRepo.getSourceBySymbolId()`
- 补测试覆盖：symbol 存在但 source_code 缺失时返回明确错误，而不是空 code

### P1 `trace_callgraph` 不能直接复用 `trace-cmd.ts` 内部解析逻辑

位置：`开发计划/M5-implementation-plan.md:226-234`  
现状：
- 计划写“复用 trace-cmd.ts 的 resolveSymbolId 逻辑”
- 当前 `resolveSymbolId()` 是 `trace-cmd.ts` 文件内私有函数，没有导出
- MCP 包不应该依赖 CLI 包，否则会形成方向错误的依赖：`cli -> mcp`，同时 `mcp -> cli`

建议：
- 把符号解析逻辑抽到 storage 或 shared 层，例如 `packages/storage/src/symbol-resolver.ts`
- CLI `trace` 和 MCP `trace_callgraph` 都复用同一个 resolver
- resolver 要保留 M4 整改后的语义：带点号输入精确匹配失败即失败，不做 FTS fallback

### P1 MCP stdio 不能向 stdout 打普通日志

位置：`开发计划/M5-implementation-plan.md:47-78`、`286-313`  
现状：
- MCP 使用 `StdioServerTransport`
- stdio transport 的 stdout 是 JSON-RPC 通道，任何 `console.log` 都可能污染协议流
- 计划没有明确禁止工具和启动流程向 stdout 写日志

建议：
- 在计划 Step 2 或 Step 7 增加约束：MCP server 运行期间不得使用 `console.log`
- 启动日志、错误诊断写 `console.error` 或完全不输出
- 测试里增加 `tools/list` 协议调用，确保 stdout 只包含 MCP JSON-RPC 响应

### P1 验收命令不是有效 MCP 握手

位置：`开发计划/M5-implementation-plan.md:372-385`  
现状：
- 计划给出的验收命令：
```bash
echo '{"jsonrpc":"2.0","method":"tools/list"}' | node ./packages/cli/dist/index.js mcp
```
- MCP 协议通常需要先 `initialize`，再发送 `notifications/initialized`，然后才能 `tools/list`
- 这个命令也缺少 JSON-RPC `id`

建议：
- 把验收改成使用 SDK `Client + StdioClientTransport` 的自动化测试
- 或给出完整 JSON-RPC 序列：`initialize` -> `notifications/initialized` -> `tools/list`
- `server.test.ts` 至少要验证真实协议层可以列出 4 个工具

### P2 Zod 版本计划与当前 lock 状态不一致

位置：`开发计划/M5-implementation-plan.md:25-43`  
现状：
- 计划写新增 `zod: ^3.25.0`
- 当前 lock 里 `@modelcontextprotocol/sdk@1.29.0` 已经搭配 `zod@4.4.3`
- SDK peer range 是 `^3.25 || ^4.0`

建议：
- M5 计划改为添加直接依赖 `zod: ^4.4.3`，与当前 lock 保持一致
- 或明确使用 `^3.25 || ^4.0`，避免 pnpm 装出两套 zod

### P2 工具输入 schema 缺少边界约束

位置：`开发计划/M5-implementation-plan.md:82-90`、`173-183`、`214-223`  
现状：
- `limit`、`depth` 只写了 `z.number().optional().default(...)`
- M3/M4 已经修过 CLI 的非法数字问题，MCP 也应同等约束

建议：
- `limit`: `z.number().int().min(1).max(100).default(10)`
- `depth`: `z.number().int().min(1).max(10).default(2)`
- `query` / `symbol_id` / `symbol`: 加 `.min(1)`
- 对空 query 返回 `{ success: false, error }` 或空结果要在计划里明确

### P2 README 仍把 `build_context_pack` 放在 MCP 工具列表里

位置：`README.md` 的 MCP Tools Reference  
现状：
- 用户本次明确要求 M5 只做 4 个工具，`build_context_pack` 留到 M6
- 当前 README 仍列了 `build_context_pack`

建议：
- M5 Step 11 明确要求 README 移除 M5 工具表里的 `build_context_pack`
- 可以在 “Upcoming M6” 单独列它，避免验收时误认为 M5 漏实现

### P2 MCP 包测试方案需要更具体

位置：`开发计划/M5-implementation-plan.md:331-350`  
现状：
- 计划写“通过 SDK 的测试工具或直接调用 handler 验证”
- `McpServer` 注册后的 tool handler 是内部结构，直接调用不稳定

建议：
- 抽出纯函数 handler，例如 `createToolHandlers(db)`，单元测试直接测这些函数
- 再用 SDK Client 做一层协议集成测试，验证 `tools/list` 和 `tools/call`
- 避免测试依赖 `McpServer` 私有字段

### P2 缺少数据库 fixture 约定

位置：`开发计划/M5-implementation-plan.md:331-350`  
现状：
- 4 个工具都依赖 SQLite 数据
- 计划没有说明测试 DB 如何构造

建议：
- 在测试步骤明确：使用 `:memory:` DB，调用 `initSchema()`
- 插入最小 symbols、source_code、issues、call_edges fixture
- 不依赖 `database/cesium.db`，避免本地状态影响测试

### P3 验收里写了 lint，但项目没有 lint 脚本

位置：`开发计划/M5-implementation-plan.md:387-395`  
现状：
- 根 `package.json` 没有 `lint` script
- 计划写“lint 通过”

建议：
- 要么 M5 增加 lint 脚本和配置
- 要么验收标准改成当前已有的 `pnpm.cmd test` + `pnpm.cmd run build`

## 建议调整后的执行顺序

1. 先补 storage 小接口：`SymbolRepo.getSourceBySymbolId()` 和共享 `resolveSymbolId()`。
2. 再实现 MCP 纯 handler 层，统一 JSON 信封和输入校验。
3. 用 `McpServer.registerTool()` 注册 4 个工具。
4. 增加 CLI `cesium mcp`，确保 stdio 无普通 stdout 日志。
5. 写 `:memory:` DB handler 单测。
6. 写 SDK Client 协议集成测试，验证 4 个工具真实可列出、可调用。
7. 更新 README，只列 M5 的 4 个工具，把 `build_context_pack` 放到 M6。

## 最终判断

M5 计划可以执行，但建议先按上面 P1/P2 修改计划细节。  
最关键的三个前置修正是：
- 明确 `get_source` 的 storage API
- 抽出 `trace_callgraph` 和 CLI 共用的符号解析器
- 改掉无效的 MCP 验收命令，改为真实 initialize + tools/list / tools/call 验证
