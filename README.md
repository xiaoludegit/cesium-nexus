# cesium-nexus

> **Cesium AI Expert** — A knowledge-base CLI and MCP server that turns Cesium's source code, API docs, issues, and community data into structured context for AI agents.

**当前阶段：v0.5.0（Phase 2D — Diagnosis Retrieval Enhancement）**

本文档描述当前 MVP 的实现范围。完整设计蓝图和延后功能见 [future-roadmap.md](./future-roadmap.md)。

---

## What This Is

Cesium is a large, fast-moving codebase. Understanding why `Primitive.update` creates hundreds of `DrawCommand`s every frame, or why z-fighting appears after upgrading from 1.118 to 1.130, requires cross-referencing source code, call graphs, GitHub issues, and release notes simultaneously.

`cesium-nexus` does that cross-referencing automatically. It builds a local knowledge base from Cesium's source and community data, exposes it via a CLI for humans and an MCP server for AI agents, and assembles **Context Packs** — structured JSON payloads that give an LLM exactly the information it needs to answer a Cesium question well.

---

## Architecture Overview

```
Agent (Claude / Codex / Hermes)
        │
        ▼
  MCP Server (stdio) — 13 tools
        │
  ┌─────┴──────────────────────────────────┐
  │          Skill Dispatch                │
  │  api / debug / performance / shader /  │
  │  general (keyword scoring + entities)  │
  └─────┬──────────────────────────────────┘
        │
  ┌─────┴──────────────────────────────────┐
  │          Retrieval Layer               │
  │                                        │
  │  SQLite (FTS5)          Qdrant (384d)  │
  │  ──────────────         ──────────────  │
  │  symbol / call_graph    eng-knowledge   │
  │  issue / source         (cosine sim)    │
  │  pull_requests / forum  cesium-experience│
  │  experience_node / edge                 │
  │                                        │
  │  Problem KB + Render Pipeline (JSON)   │
  └─────┬──────────────────────────────────┘
        │
  ┌─────┴──────────────────────────────────┐
  │     Context Pack v2 (Skill-aware)      │
  │  symbol + source + callgraph + issues  │
  │  + render_stages + diagnosis           │
  │  + forum + experience                  │
  │  Token budget: 4000–6000 (per skill)   │
  └────────────────────────────────────────┘
        │
        ▼
   LLM Reasoning → Markdown Answer
```

**数据源：**

- Cesium source code (GitHub, multi-version: 1.100–present)
- GitHub Issues (closed + fixed, ~2000)
- GitHub PRs (merged, incremental sync)
- Cesium Community Forum (Discourse API, quality-filtered)
- Problem Knowledge Base (static JSON, 10 patterns)
- Render Pipeline (static JSON, 12 stages with DAG)
- Qdrant Vector DB (`eng-knowledge` collection, 384-dim Cosine, `Xenova/all-MiniLM-L6-v2`)

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
# Index Cesium symbols (packages/engine/Source + packages/widgets/Source)
cesium index:symbols

# Sync GitHub Issues (first sync needs a token: 5000 req/h)
cesium sync:issues --token ghp_xxx

# Subsequent syncs are incremental
cesium sync:issues
```

First-time indexing takes 5–10 minutes. Subsequent `cesium sync:issues` runs are incremental.

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

# Search issues (FTS5 + BM25 ranking)
cesium issue DrawCommand
cesium issue terrain --state open --limit 10

# Trace call graph (tree output)
cesium trace Camera.update
cesium trace Camera.update --depth 3
cesium trace Camera.update --direction up

# Build a Context Pack (structured JSON for LLM consumption)
cesium context Primitive.update
cesium context Viewer --depth 3

# Diagnose a Cesium problem (Phase 2A)
cesium diagnose "why does my polygon flicker?"

# List all problem patterns in the knowledge base
cesium pkb list

# Query render stages by stage ID or problem pattern ID
cesium stage z_fighting
cesium stage depth_pass

# Crawl and search Cesium community forum (Phase 2B)
cesium forum sync --max-pages 10
cesium forum search "z-fighting flickering"

# Skill dispatch and skill-aware context pack (Phase 2B)
cesium dispatch "why does my polygon flicker?"
cesium skill-pack "how to use Viewer.render?" --budget 6000

# View render pipeline DAG (Phase 2B)
cesium pipeline
cesium pipeline update_stage

# Experience graph (Phase 2C)
cesium experience rebuild
cesium experience search "z-fighting"
cesium experience chain "issue:12345"
cesium experience stats

# Vector semantic search (Phase 2C+)
cesium experience embed
cesium experience semantic "z-fighting flickering polygon"
cesium experience references

# Hybrid diagnosis + PKB embedding (Phase 2D)
cesium pkb embed
cesium pkb search "tiles shaking near ground"
cesium diagnose "my tileset jitters near terrain" --hybrid
```

### Use as an MCP server (for AI agents)

Add to your MCP config (`~/.config/claude/claude_desktop_config.json` or equivalent):

```json
{
  "mcpServers": {
    "cesium": {
      "command": "node",
      "args": ["path/to/cesium-nexus/packages/cli/dist/index.js", "mcp"],
      "env": {}
    }
  }
}
```

The server starts on stdio and exposes all MCP tools automatically.

---

## CLI Reference

### Index Management

| Command | Description |
|---|---|
| `cesium index:symbols` | Scan Cesium source, extract symbols into SQLite |
| `cesium sync:issues` | Sync CesiumGS/cesium GitHub Issues (incremental, `--full` for rebuild) |

### Symbol & Source

| Command | Description |
|---|---|
| `cesium symbol <name>` | Get symbol detail: kind, file path, line range, doc comment, imports/exports |
| `cesium source <symbolId>` | Get source code for a symbol (use ID from `symbol` output) |
| `cesium search <keyword>` | Full-text search across source code text (FTS5). Add `--name-only` for symbol name search |

### Issue Search

| Command | Description |
|---|---|
| `cesium issue <keywords>` | Full-text search across indexed GitHub Issues (BM25 ranking, `--state`, `--limit`) |

### Call Graph

| Command | Description |
|---|---|
| `cesium trace <symbol>` | Trace call graph (tree output). `--depth N` (default 2), `--direction up\|down` (default down) |

### Context Pack

| Command | Description |
|---|---|
| `cesium context <symbol>` | Build a Context Pack (structured JSON) for a symbol. `--depth N`, `--issue-limit N`, `--budget N` |

### Diagnosis (Phase 2A / 2D)

| Command | Description |
|---|---|
| `cesium diagnose <problem>` | Diagnose a Cesium problem: matched patterns, related source, issues, investigation steps, fix suggestions. `--hybrid` enables vector semantic search + experience recall |
| `cesium pkb list` | List all problem patterns in the Problem Knowledge Base |
| `cesium pkb embed` | Embed problem patterns and render stages to Qdrant for semantic search |
| `cesium pkb search <query>` | Semantic search across knowledge base (patterns, stages, experiences). `--type pattern\|stage\|experience` |
| `cesium stage <id>` | Query render stages by stage ID or problem pattern ID |

### Forum (Phase 2B)

| Command | Description |
|---|---|
| `cesium forum sync` | Crawl Cesium community forum and index posts (`--max-pages`, `--min-replies`, `--min-views`) |
| `cesium forum search <keywords>` | Search forum posts via FTS5 (`--limit`, `--min-quality`) |

### Skills & Context Pack v2 (Phase 2B)

| Command | Description |
|---|---|
| `cesium skills list` | List all available skills and their configurations |
| `cesium dispatch <query>` | Show which skill a query would be dispatched to |
| `cesium skill-pack <query>` | Build a skill-aware Context Pack v2 (`--budget N`) |

### Render Pipeline (Phase 2B)

| Command | Description |
|---|---|
| `cesium pipeline [stage_id]` | Display the render pipeline DAG or a specific stage's dependencies |

### Experience Graph (Phase 2C)

| Command | Description |
|---|---|
| `cesium experience search <keywords>` | Search experience nodes via FTS5 (`--type`, `--symbol`, `--limit`) |
| `cesium experience rebuild` | Rebuild experience nodes and edges from indexed data |
| `cesium experience chain <node_id>` | Show connected nodes and edges (fix chains) for a node (`--depth N`) |
| `cesium experience stats` | Show experience graph statistics (nodes, edges, connected, orphan) |

### Vector Semantic Search (Phase 2C+)

| Command | Description |
|---|---|
| `cesium experience embed` | Embed all experience nodes to Qdrant for semantic search |
| `cesium experience semantic <query>` | Semantic search using vector similarity (`--limit`, `--min-score`, `--type`) |
| `cesium experience references` | Build `references` edges from semantic similarity (`--threshold`) |

### MCP Server

| Command | Description |
|---|---|
| `cesium mcp` | Start MCP server on stdio transport (for AI agents). `--db <path>` for custom DB |

---

## MCP Tools Reference

When running as an MCP server (`cesium mcp`), the following tools are available to agents:

| Tool | Input | Output |
|---|---|---|
| `search_symbol` | `{ query, limit? }` | Symbol candidate list with name, kind, file path |
| `get_source` | `{ symbol_id }` | Source code snippet + file path + line range |
| `search_issue` | `{ query, limit?, state? }` | Issue results with title, state, labels, body |
| `trace_callgraph` | `{ symbol, direction?, depth? }` | Upstream/downstream call relationships |
| `build_context_pack` | `{ symbol, depth?, budget? }` | Full Context Pack: `{symbol, source, callgraph, issues}` with token budget truncation |
| `diagnose_problem` | `{ problem, limit?, budget? }` | Diagnostic Context Pack: matched patterns, related source, issues, investigation steps, fix suggestions |
| `query_render_stage` | `{ stageId?, problemId? }` | Render stages by stage ID or problem pattern ID |
| `search_forum` | `{ query, limit?, minQuality? }` | Forum post results with quality scores |
| `search_experience` | `{ query, limit?, type?, symbol?, minQuality? }` | Unified experience search across issues, PRs, and forum posts |
| `dispatch_skill` | `{ query }` | Skill dispatch result: best skill, confidence, matched keywords, extracted entities |
| `build_skill_pack` | `{ query, budget? }` | Skill-aware Context Pack v2 with diagnosis, render stages, forum, and experience data |
| `get_experience_chain` | `{ nodeId, maxDepth? }` | Experience graph traversal: connected nodes and edges (fix chains linking PRs to issues) |
| `semantic_search_experience` | `{ query, limit?, minScore?, type? }` | Semantic search over experience nodes using Qdrant vector similarity (cosine) |

All tools return JSON with a standard envelope:

```json
{
  "success": true,
  "data": {}
}
```

**延后到后续 Phase 的 MCP tools：** `compare_version`, `search_source`（详见 [future-roadmap.md](./future-roadmap.md)）。

---

## Context Pack Format (M6)

The `build_context_pack` MCP tool and `cesium context` CLI command return a structured JSON object consumed by an LLM:

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
  ],

  "metadata": {
    "totalTokens": 3420,
    "truncated": false,
    "symbolResolved": "Primitive.update",
    "tokenBudget": 5000
  }
}
```

Token budget: configurable via `--budget N` (CLI) or `budget` parameter (MCP), default 5000 tokens. Phase 1 applies per-section limits; Phase 2 progressively trims content (downstream sources → main source → issues → callgraph → docComment → optional symbol fields) until `totalTokens ≤ budget`. When the budget is smaller than the minimum possible pack, `metadata.unavoidableOverflow` is set to `true` with `metadata.minimumPossibleTokens` indicating the floor.

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
│   │       ├── cesium-source.ts        # Scan packages/engine/Source
│   │       ├── github/
│   │       │   ├── github-issues.ts      # GitHub Issues API sync (incremental)
│   │       │   └── github-prs.ts         # GitHub PRs sync (merged, incremental)
│   │       ├── forum/
│   │       │   └── forum-crawler.ts      # Discourse forum crawler
│   │       ├── experience-node-builder.ts # Unified experience index builder
│   │       └── experience-edge-builder.ts # Experience graph edge builder + traversal
│   │
│   ├── storage/             # SQLite data layer
│   │   └── src/
│   │       ├── schema.ts            # Table definitions + FTS5 virtual tables
│   │       ├── symbol-repo.ts       # Symbol CRUD + queries
│   │       ├── symbol-resolver.ts   # Shared symbol name→ID resolution
│   │       ├── callgraph-repo.ts    # CallGraph traversal (BFS, depth-limited)
│   │       ├── issue-repo.ts        # Issue queries + full-text search
│   │       ├── pr-repo.ts           # Pull request storage + FTS5
│   │       ├── forum-repo.ts        # Forum post storage + FTS5
│   │       ├── experience-repo.ts   # Experience node unified search
│   │       └── experience-edge-repo.ts # Experience edge BFS traversal + stats
│   │
│   ├── cli/                 # CLI entry point (Commander)
│   │   └── src/
│   │       ├── index.ts             # Main CLI entry
│   │       └── commands/
│   │           ├── index-cmd.ts     # cesium index:symbols
│   │           ├── sync-cmd.ts      # cesium sync:issues
│   │           ├── symbol-cmd.ts    # cesium symbol / source / search
│   │           ├── trace-cmd.ts     # cesium trace
│   │           ├── issue-cmd.ts     # cesium issue
│   │           ├── mcp-cmd.ts       # cesium mcp (start MCP server)
│   │           ├── context-cmd.ts   # cesium context (build Context Pack)
│   │           ├── diagnose-cmd.ts  # cesium diagnose / pkb list / stage
│   │           ├── forum-cmd.ts     # cesium forum sync / search
│   │           ├── skill-cmd.ts     # cesium skills / dispatch / skill-pack
│   │           ├── pipeline-cmd.ts  # cesium pipeline
│   │           └── experience-cmd.ts # cesium experience search/rebuild/chain/stats/embed/semantic/references
│   │
│   ├── mcp/                 # MCP server (stdio transport)
│   │   └── src/
│   │       ├── handlers.ts          # Pure handler functions (13 tools)
│   │       └── server.ts            # MCP server setup + tool registration
│   │
│   ├── context-pack/        # Context Pack v1 builder
│   │   └── src/
│   │       ├── builder.ts           # Assemble context pack from retrieval results
│   │       └── token-budget.ts      # Section-level token limits + truncation
│   │
│   ├── diagnosis/           # Problem Diagnosis Engine
│   │   └── src/
│   │       ├── knowledge-loader.ts  # Load and validate Problem KB + Render Stage JSON + Pipeline DAG
│   │       ├── matcher.ts           # Symptom-to-pattern keyword matching
│   │       ├── diagnoser.ts         # Assemble DiagnosticContextPack
│   │       └── token-budget.ts      # Diagnosis-specific token truncation
│   │
│   ├── skills/              # Skill Dispatch + Context Pack v2
│   │   └── src/
│   │       ├── skill-router.ts      # Skill dispatch (keyword scoring + entity boosting)
│   │       ├── entity-extractor.ts  # Extract entities (symbol, version, stage, problem)
│   │       ├── context-pack-builder.ts # Skill-aware context pack assembly
│   │       └── token-budget.ts      # Progressive truncation for skill packs
│   │
│   ├── vector/              # Vector Search (Qdrant + Embedding)
│   │   └── src/
│   │       ├── embedding.ts         # Local ONNX embedding (Xenova/all-MiniLM-L6-v2, 384 dim)
│   │       ├── qdrant-client.ts     # Qdrant client (eng-knowledge collection)
│   │       ├── embed-experience.ts  # Batch embed experience nodes
│   │       ├── semantic-search.ts   # Semantic search + references edge builder
│   │       └── types.ts             # VectorSearchResult, QdrantExperiencePayload
│   │
│   └── shared/              # Shared types and utilities
│       └── src/
│           ├── types.ts             # All types: SymbolRecord, IssueRecord, SkillConfig, etc.
│           └── utils.ts
│
├── data/
│   ├── cesium/              # Cesium source cache (gitignored)
│   ├── problem-kb/          # Problem Knowledge Base (static JSON)
│   │   ├── problem-patterns.json
│   │   └── render-stages.json       # 12 stages with DAG dependencies
│   ├── skills/              # Skill configurations
│   │   └── skill-configs.json       # 5 skills: api/debug/performance/shader/general
│   └── evaluation/          # Evaluation datasets
│       └── phase2a-diagnosis-cases.json
│
├── database/                # SQLite databases (gitignored)
│   └── cesium.db            # symbols, call_graph, issues, PRs, forum, experience + FTS5
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
| Vector DB | `@qdrant/js-client-rest` (Qdrant) |
| Embedding | `@xenova/transformers` (ONNX, all-MiniLM-L6-v2) |
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

Unit tests cover: AST parser output correctness (Symbol extraction for Class/Function/Method/Enum/Constant), CallGraph edge extraction (depth limits), Issue sync and FTS5 search, Token budget truncation logic, Context Pack section assembly, MCP handler functions (13 tools with :memory: DB), Problem Diagnosis matching and assembly, Skill dispatch routing and entity extraction, Render Pipeline DAG validation and traversal, Experience Edge builder and BFS graph traversal.

Integration tests cover: End-to-end `cesium symbol Viewer` against a real indexed version, MCP protocol integration (SDK Client + InMemoryTransport for tools/list and tools/call), Context Pack output with metadata validation.

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
  parentClass?: string
}
```

### IssueRecord

```typescript
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
```

### CallEdge (CallGraph)

```typescript
type CallEdgeType = "call" | "construct" | "static_call";

interface CallEdge {
  sourceId: string
  targetId: string
  sourceName: string
  targetName: string
  edgeType: CallEdgeType
  weight?: number
}
```

### SQLite Schema

```sql
CREATE TABLE symbols (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,          -- class | function | method | enum | constant
  file_path TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  doc_comment TEXT,
  exports TEXT,                -- JSON array
  imports TEXT,                -- JSON array
  parent_class TEXT            -- enclosing class name (for methods)
);

CREATE TABLE call_edges (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  target_name TEXT NOT NULL,
  edge_type TEXT NOT NULL,     -- call | construct | static_call
  weight REAL DEFAULT 1,
  PRIMARY KEY (source_id, target_id, edge_type)
);

CREATE TABLE issues (
  id INTEGER PRIMARY KEY,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  state TEXT,
  labels TEXT,                 -- JSON array
  assignees TEXT,              -- JSON array
  author TEXT,
  comments INTEGER,
  created_at TEXT,
  updated_at TEXT,
  closed_at TEXT,
  html_url TEXT,
  UNIQUE(repo, number)
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Full-text search indexes
CREATE VIRTUAL TABLE symbols_fts USING fts5(name, doc_comment, content=symbols, content_rowid=rowid);
CREATE VIRTUAL TABLE source_fts USING fts5(code, content=source_code, content_rowid=rowid);
CREATE VIRTUAL TABLE issues_fts USING fts5(title, body, content=issues, content_rowid=id);
```

---

## Milestones

| Milestone | Goal | Key Deliverables | Status |
|---|---|---|---|
| **M1: Symbol Index** | Build Cesium symbol database | Scan `packages/engine/Source`, extract symbols, store in SQLite | ✅ Done |
| **M2: Source Retrieval** | Retrieve source code by symbol | `symbol`, `source`, `search` (source FTS) + CLI | ✅ Done |
| **M3: Issue Index** | Build local GitHub Issue index | Sync CesiumGS/cesium issues, FTS5 search + CLI | ✅ Done |
| **M4: CallGraph** | Build lightweight call relationships | CallEdge schema, TypeChecker resolution, BFS traversal + `trace` CLI | ✅ Done |
| **M5: MCP Server** | Provide LLM tool-calling capability | 4 tools + `cesium mcp` | ✅ Done |
| **M6: Context Pack** | Build standard context packages | `build_context_pack` MCP tool, 4-section structured JSON | ✅ Done |
| **Phase 2A** | Problem Diagnosis | Problem KB (10 patterns), Render Stage KB (9 stages), `diagnose_problem` MCP tool | ✅ Done |
| **Phase 2B** | Render Pipeline Intelligence | Pipeline DAG (12 stages), Skill Dispatch (5 skills), Context Pack v2, Forum Crawler, PR Sync, Experience Node, 4 new MCP tools | ✅ Done |
| **Phase 2C** | Experience Graph | Experience Edge (fixes), BFS traversal, `get_experience_chain` MCP tool, `experience` CLI commands, 12 MCP tools total | ✅ Done |
| **Phase 2C+** | Qdrant Vector Search | `@cesium-nexus/vector` package, embedding (384-dim), semantic search, `references` edges, `semantic_search_experience` MCP tool, 13 MCP tools total | ✅ Done |
| **Phase 2D** | Diagnosis Retrieval Enhancement | Hybrid matcher (keyword + vector), PKB vectorization, experience recall, score fusion, `diagnose --hybrid` CLI, `diagnose_problem` hybrid MCP param | ✅ Done |

See [future-roadmap.md](./future-roadmap.md) for Phase 2E (Problem Mining Pipeline) and Phase 3 milestones.

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
