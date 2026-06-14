# cesium-nexus

> **Cesium AI Expert** — A knowledge-base CLI and MCP server that turns Cesium's source code, API docs, issues, and community data into structured context for AI agents.

**当前阶段：v3.1 MVP（Phase 1 — Can Query）**

本文档描述当前 MVP 的实现范围。完整设计蓝图和延后功能见 [future-roadmap.md](./future-roadmap.md)。

---

## What This Is

Cesium is a large, fast-moving codebase. Understanding why `Primitive.update` creates hundreds of `DrawCommand`s every frame, or why z-fighting appears after upgrading from 1.118 to 1.130, requires cross-referencing source code, call graphs, GitHub issues, and release notes simultaneously.

`cesium-nexus` does that cross-referencing automatically. It builds a local knowledge base from Cesium's source and community data, exposes it via a CLI for humans and an MCP server for AI agents, and assembles **Context Packs** — structured JSON payloads that give an LLM exactly the information it needs to answer a Cesium question well.

---

## Architecture Overview (MVP)

```
Agent (Claude / Codex / Hermes)
        │
        ▼
  MCP Server (stdio)
        │
  ┌─────┴──────────────────────────────────┐
  │          Retrieval Layer               │
  │                                        │
  │  SQLite                                │
  │  ─────────                             │
  │  symbol                                │
  │  call_graph                            │
  │  issue (FTS5)                          │
  │  source (FTS5)                         │
  └─────┬──────────────────────────────────┘
        │
  ┌─────┴──────────────────────────────────┐
  │         Context Pack Builder           │
  │  symbol + source + call_graph + issues │
  │  Token budget: 4000–6000               │
  └────────────────────────────────────────┘
        │
        ▼
   LLM Reasoning → Markdown Answer
```

**MVP 数据源：**

- Cesium source code (GitHub, multi-version: 1.100–present)
- GitHub Issues (closed + fixed, ~2000)

**延后到后续 Phase 的数据源：** GitHub Releases, Community Forum, GitHub PRs, Blog, GitHub Discussion（详见 [future-roadmap.md](./future-roadmap.md)）。

---

## Quick Start

### Prerequisites

- Node.js ≥ 22
- pnpm ≥ 9
- Git (for source download)

### Install

```bash
# Clone and install
git clone https://github.com/your-org/cesium-nexus
cd cesium-nexus
pnpm install
pnpm run build
```

### Build the knowledge base

```bash
# Index Cesium symbols (packages/engine/Source)
cesium index:symbols

# Sync GitHub Issues
cesium sync:issues

# Check index status
cesium status
```

First-time indexing takes 10–20 minutes. Subsequent `cesium sync:issues` runs are incremental.

### Use the CLI

```bash
# Look up a symbol
cesium symbol Viewer

# Get source code for a symbol (use ID from 'symbol' command output)
cesium source 45a23cf59985

# Full-text search across source code (searches actual code, not just names)
cesium search DrawCommand

# Search only symbol names and doc comments
cesium search DrawCommand --name-only

# Search issues
cesium issue DrawCommand

# Trace the call graph
cesium trace Viewer
cesium trace Primitive.update
```

### Use as an MCP server (for AI agents)

Add to your MCP config (`~/.config/claude/claude_desktop_config.json` or equivalent):

```json
{
  "mcpServers": {
    "cesium": {
      "command": "cesium-nexus",
      "args": ["mcp"],
      "env": {}
    }
  }
}
```

The server starts on stdio and exposes all MCP tools automatically.

---

## CLI Reference (MVP)

### Index Management

| Command | Description |
|---|---|
| `cesium index:symbols` | Scan `packages/engine/Source`, extract symbols into SQLite |
| `cesium sync:issues` | Sync CesiumGS/cesium GitHub Issues (incremental) |
| `cesium status` | Show index health: record counts, last sync |

### Symbol & Source

| Command | Description |
|---|---|
| `cesium symbol <name>` | Get symbol detail: kind, file path, line range, doc comment, imports/exports |
| `cesium source <symbolId>` | Get source code for a symbol (use ID from `symbol` output) |
| `cesium search <keyword>` | Full-text search across source code text (FTS5). Add `--name-only` for symbol name search |

### Call Graph

| Command | Description |
|---|---|
| `cesium trace <symbol>` | Trace upstream/downstream call relationships (max depth 2) |

### Issue Search

| Command | Description |
|---|---|
| `cesium issue <keywords>` | Full-text search across indexed GitHub Issues |

### Context Pack

| Command | Description |
|---|---|
| `cesium context <symbol>` | Build a Context Pack (structured JSON) for a symbol |

---

## MCP Tools Reference (MVP)

When running as an MCP server (`cesium mcp`), the following tools are available to agents:

| Tool | Input | Output |
|---|---|---|
| `search_symbol` | `{ query, limit? }` | Symbol candidate list with name, kind, file path |
| `get_source` | `{ symbol_id }` | Source code snippet + file path + line range |
| `search_issue` | `{ query, limit? }` | Issue results with title, state, labels, body |
| `trace_callgraph` | `{ symbol, direction?, depth? }` | Upstream/downstream call relationships |
| `build_context_pack` | `{ symbol }` | Full Context Pack JSON: `{symbol, source, callgraph, issues}` |

All tools return JSON with a standard envelope:

```json
{
  "success": true,
  "data": {}
}
```

**延后到后续 Phase 的 MCP tools：** `compare_version`, `diagnose_problem`, `query_render_stage`, `search_forum`, `search_experience`, `search_source`（详见 [future-roadmap.md](./future-roadmap.md)）。

---

## Context Pack Format (MVP)

`build_context_pack` tool and `cesium context` command return a structured JSON object consumed by an LLM:

```json
{
  "symbol": {
    "name": "Primitive.update",
    "kind": "method",
    "filePath": "Source/Scene/Primitive.js",
    "startLine": 1423,
    "endLine": 1456,
    "docComment": "...",
    "imports": [],
    "exports": []
  },

  "source": [
    {
      "symbol": "Primitive.update",
      "file": "Source/Scene/Primitive.js",
      "lineStart": 1423,
      "lineEnd": 1456,
      "code": "..."
    }
  ],

  "callgraph": [
    { "source": "Primitive.update", "target": "PrimitivePipeline.combineGeometry" },
    { "source": "Primitive.update", "target": "DrawCommand" }
  ],

  "issues": [
    {
      "id": 12345,
      "title": "Performance degradation with many Primitives",
      "state": "closed",
      "labels": ["bug", "performance"],
      "body": "..."
    }
  ]
}
```

Token budget: 4000–6000 tokens. Hardcoded section limits with truncation on overflow.

---

## Project Structure

```
cesium-nexus/
├── packages/
│   ├── parser/              # AST parsing: ts-morph + Babel Parser
│   │   └── src/
│   │       ├── symbol-extractor.ts   # Class/Function/Method/Enum/Constant extraction
│   │       └── callgraph-builder.ts  # Lightweight call edge extraction (max depth 2)
│   │
│   ├── indexer/             # Knowledge base construction pipelines
│   │   └── src/
│   │       ├── cesium-source.ts     # Scan packages/engine/Source
│   │       └── github-issues.ts      # GitHub Issues API sync (incremental)
│   │
│   ├── storage/             # SQLite data layer
│   │   └── src/
│   │       ├── schema.ts            # Table definitions + FTS5 virtual tables
│   │       ├── symbol-repo.ts       # Symbol CRUD + queries
│   │       ├── callgraph-repo.ts    # CallGraph traversal (BFS, depth-limited)
│   │       └── issue-repo.ts        # Issue queries + full-text search
│   │
│   ├── cli/                 # CLI entry point (Commander)
│   │   └── src/
│   │       ├── index.ts             # Main CLI entry
│   │       └── commands/
│   │           ├── index-cmd.ts     # cesium index:symbols
│   │           ├── sync-cmd.ts      # cesium sync:issues
│   │           ├── symbol-cmd.ts    # cesium symbol / source / search
│   │           ├── trace-cmd.ts     # cesium trace
│   │           └── issue-cmd.ts     # cesium issue
│   │
│   ├── mcp/                 # MCP server (stdio transport)
│   │   └── src/
│   │       ├── server.ts            # MCP server setup
│   │       └── tools/
│   │           ├── search-symbol.ts
│   │           ├── get-source.ts
│   │           ├── search-issue.ts
│   │           ├── trace-callgraph.ts
│   │           └── build-context-pack.ts
│   │
│   ├── context-pack/        # Context Pack builder
│   │   └── src/
│   │       ├── builder.ts           # Assemble context pack from retrieval results
│   │       └── token-budget.ts      # Section-level token limits + truncation
│   │
│   └── shared/              # Shared types and utilities
│       └── src/
│           ├── types.ts             # SymbolRecord, IssueRecord, Edge, ContextPack
│           └── utils.ts
│
├── data/
│   └── cesium/              # Cesium source cache (gitignored)
│       ├── 1.120/
│       ├── 1.125/
│       └── 1.130/
│
├── database/                # SQLite databases (gitignored)
│   └── cesium.db            # symbols, call_graph, issues + FTS5 indexes
│
├── docs/                    # Design documents
│   ├── future-roadmap.md
│   └── ...
│
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.json
└── README.md
```

---

## Configuration

`cesium-nexus` reads from `~/.cesium-nexus/config.json` (created on first run):

```json
{
  "versions": ["1.120", "1.125", "1.130"],
  "defaultVersion": "1.130",

  "github": {
    "token": "ghp_...",
    "repo": "CesiumGS/cesium",
    "rateLimit": {
      "requestsPerHour": 4000,
      "retryOnLimit": true
    }
  },

  "sync": {
    "issueFilter": {
      "state": "closed",
      "labels": ["bug", "performance", "rendering", "terrain", "imagery"]
    }
  }
}
```

Environment variable overrides:

```bash
CESIUM_CLI_GITHUB_TOKEN=ghp_...
CESIUM_CLI_DB_PATH=/custom/path/database
```

---

## Development

### Stack

| Layer | Library |
|---|---|
| Language | TypeScript |
| Runtime | Node.js 22+ |
| Package Manager | pnpm |
| CLI framework | `commander` |
| MCP server | `@modelcontextprotocol/sdk` |
| Database | `better-sqlite3` (with FTS5) |
| AST parsing | `ts-morph` + `@babel/parser` |
| Testing | `vitest` |

### Setup

```bash
pnpm install
pnpm run build          # compile TypeScript
pnpm run dev            # watch mode
pnpm test               # vitest
```

### Testing strategy

Unit tests cover: AST parser output correctness (Symbol extraction for Class/Function/Method/Enum/Constant), CallGraph edge extraction (depth limits), Issue sync and FTS5 search, Token budget truncation logic, Context Pack section assembly.

Integration tests cover: End-to-end `cesium symbol Viewer` against a real indexed version, MCP tool round-trip for each of the 5 tools, Context Pack output validates against JSON schema.

```bash
pnpm run test:unit
pnpm run test:integration    # requires a pre-built index
pnpm run test:mcp            # spins up MCP server, runs tool calls
```

---

## Data Schemas (MVP)

### SymbolRecord

```typescript
interface SymbolRecord {
  id: string
  name: string
  kind: "class" | "function" | "method" | "enum" | "constant"
  filePath: string
  startLine: number
  endLine: number
  docComment?: string
  exports: string[]
  imports: string[]
}
```

### IssueRecord

```typescript
interface IssueRecord {
  id: number
  title: string
  state: string
  labels: string[]
  body: string
  createdAt: string
  updatedAt: string
}
```

### Edge (CallGraph)

```typescript
interface Edge {
  source: string
  target: string
}
```

### SQLite Schema

```sql
CREATE TABLE symbols (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,          -- class | function | method | enum
  file_path TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  doc_comment TEXT,
  exports TEXT,                -- JSON array
  imports TEXT                 -- JSON array
);

CREATE TABLE call_edges (
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  PRIMARY KEY (source, target)
);

CREATE TABLE issues (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  labels TEXT,                 -- JSON array
  body TEXT,
  created_at TEXT,
  updated_at TEXT
);

-- Full-text search indexes
CREATE VIRTUAL TABLE symbols_fts USING fts5(name, doc_comment, content=symbols, content_rowid=rowid);
CREATE VIRTUAL TABLE source_fts USING fts5(name, code, content='external');
CREATE VIRTUAL TABLE issues_fts USING fts5(title, body, content=issues, content_rowid=rowid);
```

---

## Milestones (MVP — Phase 1: Can Query)

| Milestone | Goal | Key Deliverables | Status |
|---|---|---|---|
| **M1: Symbol Index** | Build Cesium symbol database | Scan `packages/engine/Source`, extract symbols, store in SQLite | ✅ Done |
| **M2: Source Retrieval** | Retrieve source code by symbol | `symbol`, `source`, `search` (source FTS) + CLI | ✅ Done |
| **M3: Issue Index** | Build local GitHub Issue index | Sync CesiumGS/cesium issues, FTS5 search + CLI | ⬜ Planned |
| **M4: CallGraph** | Build lightweight call relationships | Max depth 2, simple Edge schema + CLI | ⬜ Planned |
| **M5: MCP Server** | Provide LLM tool-calling capability | 4 tools: `search_symbol`, `get_source`, `search_issue`, `trace_callgraph` | ⬜ Planned |
| **M6: Context Pack** | Build standard context packages | Output: `{symbol, source, callgraph, issues}` | ⬜ Planned |

See [future-roadmap.md](./future-roadmap.md) for Phase 2 (Can Explain) and Phase 3 (Can Diagnose) milestones.

### Acceptance Criteria

**M1**: Viewer, Scene, Camera can be correctly indexed.
**M2**: Returns source code snippet, file path, and line numbers.
**M3**: Can search DrawCommand, Primitive, Camera related issues.
**M4**: Outputs upstream/downstream relationships.
**M5**: Claude Desktop and Codex CLI can call tools successfully.
**M6**: Generates complete Context Pack for `Primitive.update`.

---

## Design Documents

| Document | Location |
|---|---|
| 架构审计报告 | [`设计文档/Cesium-Architecture-Review-v3.md`](./设计文档/Cesium-Architecture-Review-v3.md) |
| 实施计划 | [`开发计划/plan.md`](./开发计划/plan.md) |
| 延后功能路线图 | [`future-roadmap.md`](./future-roadmap.md) |

---

## FAQ

**Why not just use the Cesium API docs website?**
The docs tell you what an API does, not why it behaves a certain way, what issues have been filed against it, or how it connects to the rest of the render pipeline. This tool answers the "why" questions.

**Why not use a general-purpose code search tool (Sourcegraph, grep.app)?**
Those tools search within a single codebase. This tool cross-references source code with GitHub issues and version history simultaneously, and packages it for LLM consumption with a token budget.

**Does this send my code to any external service?**
The indexer downloads Cesium's public source from GitHub. Your own code is never sent anywhere.

**How do I keep the knowledge base up to date?**
Run `cesium sync:issues` on a schedule (weekly is sufficient). New Cesium versions require `cesium index:symbols` after downloading the source.

---

## License

MIT
