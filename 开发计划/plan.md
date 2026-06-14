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
Milestone 1
Symbol Index

目标：

建立 Cesium 符号数据库。

实现：

扫描：

packages/engine/Source

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

  filePath: string

  startLine: number

  endLine: number

  docComment?: string

  exports: string[]

  imports: string[]
}

SQLite

symbols

CLI

cesium index:symbols

验收标准

Viewer
Scene
Camera

可正确索引
Milestone 2
Source Retrieval

目标：

根据 Symbol 获取源码。

实现：

getSymbol(name)

getSource(symbolId)

searchSource(keyword)

CLI

cesium symbol Viewer

cesium source Viewer

cesium search DrawCommand

验收标准

返回：

源码片段
文件路径
行号
Milestone 3
Issue Index

目标：

建立 GitHub Issue 本地索引。

同步：

CesiumGS/cesium

Schema

interface IssueRecord {
  id: number

  title: string

  state: string

  labels: string[]

  body: string

  createdAt: string

  updatedAt: string
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

Milestone 4
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

Milestone 5
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

Milestone 6
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