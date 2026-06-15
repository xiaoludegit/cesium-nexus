Cesium AI Expert v3.1 实施计划

你是资深 TypeScript 架构师、代码智能系统工程师、RAG/Agent 专家。

目标：

根据已冻结的 Cesium AI Expert v3.1 架构，实现 MVP。

重要原则：

不允许扩展功能
不允许设计 v4/v5
不允许增加新的大型模块
优先保证可运行
每完成一个 Milestone 必须等待 Review
严格按照 Milestone 顺序推进
项目目标

构建一个面向 CesiumJS 的代码智能系统。

目标能力：

用户问题
↓
MCP Tool
↓
Symbol Search
↓
Source Retrieval
↓
Issue Retrieval
↓
CallGraph
↓
Context Pack
↓
LLM分析

MVP 不实现：

自动修复
自动写代码
Loop Agent
Problem Mining
Forum抓取
Experience Graph
技术栈
Language:
TypeScript

Runtime:
Node.js 22+

Database:
SQLite

Vector DB:
Qdrant（预留接口）

Parser:
ts-morph
Babel Parser

CLI:
Commander

MCP:
Model Context Protocol SDK

Testing:
Vitest

Package Manager:
pnpm
Monorepo结构
cesium-ai-expert/

packages/

  parser/
  indexer/
  storage/
  cli/
  mcp/
  context-pack/
  shared/

data/

  cesium/

database/

docs/
Milestone 1 ✅ 完成
Symbol Index

目标：

建立 Cesium 符号数据库。

实现：

> 📝 执行更新：Cesium 源码改为 git submodule 放在 `data/cesium/`，CLI 默认 `--cesium-root ./data/cesium`。切换版本通过 `cd data/cesium && git checkout <tag>` 实现，更新版本通过 `git submodule update --remote`。

扫描：

packages/engine/Source
packages/widgets/Source

> 📝 执行更新：新增 widgets/Source。理由：Viewer.js 位于 packages/widgets/Source/Viewer/Viewer.js，不在 engine 下，而验收标准要求 Viewer 可被索引。不扩展扫描范围则验收无法通过。

提取：

Class
Function
Method
Enum
Constant

Symbol Schema

interface SymbolRecord {
  id: string

  name: string

  kind:
    | "class"
    | "function"
    | "method"
    | "enum"
    | "constant"

  filePath: string

  startLine: number

  endLine: number

  docComment?: string

  exports: string[]

  imports: string[]

  parentClass?: string  // 📝 执行更新：新增字段，标注 method 所属 class，为 M4 CallGraph 预留
}

SQLite

symbols
symbols_fts（FTS5 全文索引）

> 📝 执行更新：M1 提前建立 FTS5 虚拟表及同步触发器。理由：M2 searchSource 需要全文检索能力，提前建表避免 M2 做数据迁移，成本极低（多 3 行 SQL）。

CLI

cesium index:symbols

验收标准

Viewer
Scene
Camera

可正确索引
Milestone 2 ✅ 完成
Source Retrieval

目标：

根据 Symbol 获取源码。

实现：

> 📝 执行更新：`getSymbol`/`getSource`/`searchSource` 三个函数直接实现为 CLI 子命令，底层通过 `SymbolRepo` 的 `findByName`/`findById`/`searchSource` 方法查询。`source` 命令参数改为 `symbolId`（而非 name），因为同名符号可能有多个，用 ID 精确匹配更可靠。`search` 命令默认搜索源码正文（`source_code` + `source_fts` 表），加 `--name-only` 可退化为符号名搜索。

getSymbol(name) → `cesium symbol <name>`
getSource(symbolId) → `cesium source <symbolId>`
searchSource(keyword) → `cesium search <keyword>`

CLI

cesium symbol Viewer

cesium source 45a23cf59985

cesium search DrawCommand

cesium search DrawCommand --name-only

> 📝 审核整改：新增 E2E 集成测试 `e2e-source-retrieval.test.ts`（7 个用例），对真实 Cesium 索引库做端到端验证，覆盖 `executeCommand` 等仅存在于源码正文的关键词。修复 `searchSource`/`searchFts` 的 FTS5 查询词转义——将输入拆分为 alphanumeric token 并用双引号包裹，防止 `Object.freeze` 等含 `.` 的查询触发 FTS5 列引用语法错误。

验收标准

返回：

源码片段
文件路径
行号
Milestone 3 ✅ 完成
Issue Index

目标：

建立 GitHub Issue 本地索引。

实现：

> 📝 执行更新：`IssueRecord` 扩展为包含 `repo`/`number`/`assignees`/`author`/`comments`/`closedAt`/`htmlUrl` 等字段，支持多仓库。新增 `meta` 表存储同步游标（`github_issues_last_sync`），不依赖 `MAX(updated_at)`。FTS5 使用 `bm25()` 排序，`searchFts` 支持 `state` 过滤。GitHub API 使用 Node 22 原生 `fetch()`，不引入 octokit。`githubFetch()` 统一处理 Authorization、User-Agent、Rate Limit。

同步：

CesiumGS/cesium

Schema

interface IssueRecord {
  id: number
  repo: string
  number: number
  title: string
  state: string
  labels: string[]
  assignees: string[]
  author: string
  comments: number
  body: string
  createdAt: string
  updatedAt: string
  closedAt: string | null
  htmlUrl: string
}

CLI

cesium sync:issues

cesium issue DrawCommand

验收标准

能够搜索：

DrawCommand

Primitive

Camera

相关 Issue。

Milestone 4 ⬜ 待开始
CallGraph

目标：

建立轻量调用关系。

限制：

最大深度：
2

Schema

interface Edge {
  source: string
  target: string
}

CLI

cesium trace Viewer

cesium trace Primitive.update

验收标准

输出：

upstream

downstream

关系。

Milestone 5 ⬜ 待开始
MCP Server

目标：

提供 LLM 工具调用能力。

Tool

search_symbol

get_source

search_issue

trace_callgraph

返回结构：

{
  "success": true,
  "data": {}
}

验收标准

Claude Desktop

Codex CLI

均可正常调用。

Milestone 6 ⬜ 待开始
Context Pack

目标：

构建标准上下文。

输出结构

{
  "symbol": {},

  "source": [],

  "callgraph": [],

  "issues": []
}

Tool

build_context_pack

CLI

cesium context <symbol>

验收标准

针对：

Primitive.update

生成完整 Context Pack。

非目标

当前阶段禁止实现：

Problem KB

Skill Router

Experience Graph

Render Graph

Loop Agent

Auto Fix

Auto Patch

Forum Crawler

Blog Sync

统一放入：

future-roadmap.md
开发规则

每完成一个 Milestone：

必须输出：

## 完成内容

## 修改文件

## 数据结构

## CLI示例

## 测试结果

## 风险

## 下一步建议

然后停止。

等待人工 Review。

禁止自动进入下一阶段。