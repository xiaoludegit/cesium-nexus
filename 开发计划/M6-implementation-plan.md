# M6: Context Pack（标准上下文包构建）

## 目标

为 MCP Agent 提供结构化的 **Context Pack**：给定一个 Cesium 符号名，自动组装 `{symbol, source, callgraph, issues}` 四段式 JSON 上下文，供 LLM 直接消费。

交付物：
- `build_context_pack` MCP 工具（第 5 个工具）
- `cesium context <symbol>` CLI 命令
- Token 预算截断机制（4000–6000 tokens）

## 关键设计决策

### 数据流

```
用户输入 "Primitive.update"
  ↓
resolveSymbolId() → SymbolRecord
  ↓
┌─ symbol section: SymbolRecord 元数据
├─ source section: getSourceBySymbolId() 获取主符号源码 + 下游源码（最多 3 个）
├─ callgraph section: getDownstream(depth=2) 转 Edge[] (name pairs)
└─ issues section: searchFts(className) 搜索相关 Issue（按 BM25 排序）
  ↓
Token 预算截断（5000 tokens 总预算）
  ↓
输出 ContextPack JSON
```

### Token 预算分配

| Section | 预算 (tokens) | 截断策略 |
|---|---|---|
| symbol | 500 | 截断 docComment，移除 exports/imports 超长部分 |
| source | 3000 | 主符号完整保留；下游源码按优先级截断行数 |
| callgraph | 500 | 截断边数量 |
| issues | 1000 | 截断 body 长度，减少 issue 数量 |
| **Total** | **5000** | — |

Token 估算：`Math.ceil(text.length / 4)`（英文 4 chars ≈ 1 token）。

### Issue 搜索策略

- 若符号有 `parentClass`（如 `Primitive.update`），用 `parentClass` 名搜索 Issue
- 若无 `parentClass`（如 `Viewer`），用符号名搜索
- 可选：合并两个搜索词（`className + methodName`），取 top N
- 限制 `limit: 5`，按 BM25 排序

### 下游源码包含策略

- 主符号源码始终包含
- 从 downstream edges 中取 unique target symbols
- 每个 target 尝试 `getSourceBySymbolId(targetId)`
- 最多包含 3 个下游源码片段
- 若总 source tokens 超 3000，从最远的下游开始截断

### ContextPack 输出格式

```typescript
interface ContextPack {
  symbol: SymbolRecord;
  source: SourceSnippet[];
  callgraph: Edge[];
  issues: IssueRecord[];
  metadata: {
    totalTokens: number;
    truncated: boolean;
    symbolResolved: string;
  };
}
```

`metadata` 是新增字段（shared types 中已有 ContextPack 需要扩展），告知 LLM 数据是否被截断以及实际 token 数。

---

## 实施步骤

### Step 1：扩展 shared types

在 `packages/shared/src/types.ts` 中：
- 给 `ContextPack` 添加可选 `metadata` 字段
- 新增 `ContextPackMetadata` 接口

```typescript
export interface ContextPackMetadata {
  totalTokens: number;
  truncated: boolean;
  symbolResolved: string;
}

export interface ContextPack {
  symbol: SymbolRecord;
  source: SourceSnippet[];
  callgraph: Edge[];
  issues: IssueRecord[];
  metadata?: ContextPackMetadata;
}
```

### Step 2：ContextPackBuilder 核心实现

新增 `packages/context-pack/src/builder.ts`：

```typescript
export interface BuildOptions {
  symbol: string;           // 用户输入（如 "Primitive.update"）
  depth?: number;           // callgraph 深度，默认 2
  issueLimit?: number;      // Issue 数量，默认 5
  maxDownstreamSources?: number; // 下游源码数量，默认 3
  tokenBudget?: number;     // 总 token 预算，默认 5000
}

export function buildContextPack(
  symbolRepo: SymbolRepo,
  callGraphRepo: CallGraphRepo,
  issueRepo: IssueRepo,
  options: BuildOptions,
): ContextPack | { error: string }
```

内部逻辑：
1. `resolveSymbolId()` 解析符号
2. 收集 4 个 section 的原始数据
3. `estimateTokens()` 计算各 section token 数
4. `truncateToBudget()` 按优先级截断
5. 附加 `metadata`

新增 `packages/context-pack/src/token-budget.ts`：

```typescript
export function estimateTokens(text: string): number
export function truncateText(text: string, maxTokens: number): { text: string; truncated: boolean }
export function truncateContextPack(pack: ContextPack, budget: number): ContextPack
```

### Step 3：Context Pack 包导出

更新 `packages/context-pack/src/index.ts`：
```typescript
export { buildContextPack } from "./builder.js";
export type { BuildOptions } from "./builder.js";
export { estimateTokens, truncateText } from "./token-budget.js";
```

### Step 4：MCP Handler — handleBuildContextPack

在 `packages/mcp/src/handlers.ts` 新增：

```typescript
export async function handleBuildContextPack(
  symbolRepo: SymbolRepo,
  callGraphRepo: CallGraphRepo,
  issueRepo: IssueRepo,
  input: { symbol: string; depth?: number },
): Promise<ToolResponse>
```

### Step 5：MCP Server 注册第 5 个工具

在 `packages/mcp/src/server.ts` 的 `registerTools()` 中新增：

```typescript
server.tool(
  "build_context_pack",
  "Build a structured Context Pack for a Cesium symbol (symbol + source + callgraph + issues)",
  {
    symbol: z.string().min(1),
    depth: z.number().int().min(1).max(5).default(2),
  },
  async (input) => { ... }
);
```

MCP 包需要新增 `@cesium-nexus/context-pack` 依赖。

### Step 6：CLI cesium context 命令

新增 `packages/cli/src/commands/context-cmd.ts`：

```bash
cesium context Primitive.update
cesium context Viewer --depth 3
cesium context Camera --json          # 纯 JSON 输出（给脚本用）
```

CLI 包需要新增 `@cesium-nexus/context-pack` 依赖。

### Step 7：Context Pack Builder 单元测试

新增 `packages/context-pack/src/builder.test.ts`：

使用 `:memory:` DB + fixture，覆盖：
- 完整 4 section 输出
- 符号不存在 → error
- 源码缺失 → source 为空数组
- callgraph 为空 → callgraph 为空数组
- issues 为空 → issues 为空数组
- 类级符号（如 `Viewer`）
- 方法级符号（如 `Primitive.update`）

### Step 8：Token Budget 单元测试

新增 `packages/context-pack/src/token-budget.test.ts`：
- estimateTokens 基本准确性
- truncateText 正确截断
- 超预算时 metadata.truncated = true
- 未超预算时 metadata.truncated = false

### Step 9：MCP Handler + 协议集成测试更新

更新 `packages/mcp/src/handlers.test.ts`：
- 新增 handleBuildContextPack 测试用例

更新 `packages/mcp/src/server.test.ts`：
- tools/list 应返回 5 个工具（新增 build_context_pack）
- tools/call build_context_pack 返回正确结构

### Step 10：README 更新

- MCP Tools 表新增 `build_context_pack`（标注已实现）
- 移除 "M6 planned tool" 标注
- Milestones 表 M6 → ✅ Done
- CLI Reference 新增 `cesium context`
- Context Pack Format 部分从 "Planned" 改为已实现
- Project Structure 更新 context-pack 目录
- 测试策略更新

---

## 依赖关系

```
context-pack (新增依赖)
  ├── @cesium-nexus/shared (已有)
  └── @cesium-nexus/storage (已有)

mcp (新增依赖)
  └── @cesium-nexus/context-pack (workspace:*)

cli (新增依赖)
  └── @cesium-nexus/context-pack (workspace:*)
```

---

## 验收标准

```bash
pnpm test          # 全部测试通过（含新增 builder + token-budget 单测）
pnpm run build     # workspace 构建通过
```

满足：

* `buildContextPack("Primitive.update", ...)` 返回完整 4-section ContextPack
* Token 预算截断生效（metadata.truncated 正确标记）
* MCP `build_context_pack` 工具可列出、可调用
* CLI `cesium context <symbol>` 输出 JSON
* 符号不存在时返回明确错误
* 各 section 缺失数据时返回空数组（不崩溃）
* README 同步更新

---

## 非目标（M6 不做）

以下功能属于 Phase 2+，M6 禁止实现：

- Problem KB / diagnosis / render_stage section
- Skill Dispatch / Intent 分类
- Experience Graph
- Token 预算按 Skill 差异化
- 向量化搜索（Qdrant）
- Forum / Blog / Discussion 数据源

---

## Progress

| Step | 内容 | 状态 |
|---|---|---|
| 1 | 扩展 shared types (ContextPackMetadata) | ✅ 完成 |
| 2 | ContextPackBuilder 核心 + token-budget | ✅ 完成 |
| 3 | Context Pack 包导出 | ✅ 完成 |
| 4 | MCP Handler — handleBuildContextPack | ✅ 完成 |
| 5 | MCP Server 注册第 5 个工具 | ✅ 完成 |
| 6 | CLI cesium context 命令 | ✅ 完成 |
| 7 | Builder 单元测试 | ✅ 完成 |
| 8 | Token Budget 单元测试 | ✅ 完成 |
| 9 | MCP 测试更新 (handler + 协议集成) | ✅ 完成 |
| 10 | README 更新 | ✅ 完成 |
