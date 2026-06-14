# cesium-nexus

> **Cesium AI Expert** — A knowledge-base CLI and MCP server that turns Cesium's source code, API docs, issues, and community data into structured context for AI agents.

---

## What This Is

Cesium is a large, fast-moving codebase. Understanding why `Primitive.update` creates hundreds of `DrawCommand`s every frame, or why z-fighting appears after upgrading from 1.118 to 1.130, requires cross-referencing source code, call graphs, GitHub issues, community forum threads, and release notes simultaneously.

`cesium-nexus` does that cross-referencing automatically. It builds a local knowledge base from Cesium's source and community data, exposes it via a CLI for humans and an MCP server for AI agents, and assembles **Context Packs** — structured JSON payloads that give an LLM exactly the information it needs to answer a Cesium question well.

---

## Architecture Overview

```
Agent (Claude / Codex / Hermes)
        │
        ▼
  MCP Server (stdio)
        │
  ┌─────┴──────────────────────────────────┐
  │            Skill Dispatch              │
  │  api | debug | performance | shader    │
  │  migration | general                   │
  └─────┬──────────────────────────────────┘
        │
  ┌─────┴──────────────────────────────────┐
  │         Problem Diagnosis              │
  │  Problem KB → matched_problem          │
  │             → diagnostic_steps         │
  └─────┬──────────────────────────────────┘
        │
  ┌─────┴──────────────────────────────────┐
  │          Retrieval Layer               │
  │                                        │
  │  SQLite        Tantivy      Qdrant     │
  │  ─────────     ───────      ──────     │
  │  symbol        API docs     semantic   │
  │  call_graph    issues       search     │
  │  diff/map      release      (P1)       │
  │                forum                   │
  └─────┬──────────────────────────────────┘
        │
  ┌─────┴──────────────────────────────────┐
  │         Context Pack Builder           │
  │  symbol + call_graph + diagnosis       │
  │  render_stage + experience_nodes       │
  │  Token budget: 4000–6000               │
  └────────────────────────────────────────┘
        │
        ▼
   LLM Reasoning → Structured Answer
```

**Data sources indexed:**

- Cesium source code (GitHub, multi-version: 1.100–present)
- GitHub Issues (closed + fixed, ~2000)
- GitHub Releases (full history, ~30 entries)
- Cesium Community Forum (solved threads)
- GitHub PRs (merged, description + review comments)

---

## Quick Start

### Prerequisites

- Node.js ≥ 20
- Git (for source download)

### Install

```bash
npm install -g cesium-nexus
```

Or run from source:

```bash
git clone https://github.com/your-org/cesium-nexus
cd cesium-nexus
npm install
npm run build
```

### Build the knowledge base

```bash
# Download and index Cesium 1.130 source
cesium index --version 1.130

# Sync community data (issues, releases, forum)
cesium sync

# Check index status
cesium status
```

First-time build takes 10–20 minutes. Subsequent `cesium sync` runs are incremental and take under a minute.

### Use the CLI

```bash
# Look up a symbol
cesium search Primitive.update

# Full symbol detail with JSDoc and source location
cesium explain Primitive.update

# Trace the call graph downstream
cesium trace Primitive.update --depth 5 --direction downstream

# Compare a symbol across versions
cesium diff Primitive 1.118 1.130

# Search issues
cesium issue search "DrawCommand performance"

# Diagnose a problem by symptom
cesium diagnose "flickering polygons after terrain load"

# Build a context pack for an LLM
cesium context Primitive.update --version 1.130 --skill debug
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

## CLI Reference

### Index Management

| Command | Description |
|---|---|
| `cesium index --version <v>` | Download and index a Cesium version |
| `cesium index --all` | Index all configured versions |
| `cesium sync` | Incremental sync of community data (issues, forum, releases) |
| `cesium status` | Show index health: version coverage, record counts, last sync |
| `cesium versions` | List all indexed Cesium versions |

### Symbol Lookup

| Command | Description |
|---|---|
| `cesium search <name>` | Fuzzy search symbols by name |
| `cesium explain <symbol>` | Full detail: signature, JSDoc, file location, deprecation |
| `cesium trace <symbol>` | Call graph traversal |
| `cesium diff <symbol> <v1> <v2>` | Cross-version symbol diff |

**`cesium trace` options:**

```
--direction   upstream | downstream | both  (default: downstream)
--depth       max traversal depth           (default: 4)
--confidence  certain | all                 (default: all)
--module      limit to module path          (e.g. Source/Scene)
```

### Knowledge Base Queries

| Command | Description |
|---|---|
| `cesium issue search <keywords>` | Full-text search across indexed issues |
| `cesium forum search <keywords>` | Full-text search across forum threads |
| `cesium release <version>` | Show release notes for a version |
| `cesium diagnose "<symptom>"` | Match symptom to known problem model |
| `cesium stage <problem-id>` | Show render pipeline stages for a problem |
| `cesium pkb list` | List all Problem KB entries |

### Context Pack

| Command | Description |
|---|---|
| `cesium context <symbol>` | Build a Context Pack for a symbol |

**`cesium context` options:**

```
--version   Cesium version        (default: latest indexed)
--skill     api|debug|performance|shader|migration|general
--format    json | markdown       (default: json)
--output    file path             (default: stdout)
```

---

## MCP Tools Reference

When running as an MCP server (`cesium mcp`), the following tools are available to agents:

| Tool | Input | Output |
|---|---|---|
| `search_api` | `{ query, limit? }` | Symbol candidate list |
| `get_symbol_detail` | `{ symbol_id }` | Full symbol record + JSDoc |
| `search_source` | `{ query, module?, limit? }` | Source code full-text results |
| `trace_call` | `{ symbol, direction?, depth?, confidence?, module? }` | Call graph tree |
| `compare_version` | `{ symbol, from_version, to_version }` | Structured diff |
| `search_issue` | `{ query, limit? }` | Issue results with summaries |
| `search_forum` | `{ query, limit? }` | Forum thread results |
| `diagnose_problem` | `{ symptom }` | Matched problem model + steps |
| `query_render_stage` | `{ problem_id? , stage_id? }` | Stage + key symbols |
| `search_experience` | `{ query, types?, symbol?, problem? }` | Experience node results |
| `build_context` | `{ symbol, version?, skill? }` | Full Context Pack JSON |

All tools return JSON. Disambiguation candidates are returned as structured lists, never as errors.

---

## Context Pack Format

`build_context` and `cesium context` return a structured JSON object consumed directly by an LLM:

```json
{
  "skill_meta": {
    "skill": "debug_skill",
    "intent": "debug",
    "token_budget": 6000,
    "token_used": 4820
  },

  "diagnosis": {
    "matched_problem": "performance_degradation",
    "confidence": "high",
    "diagnostic_steps": [
      { "step": 1, "check": "...", "expected_result": "..." }
    ],
    "related_settings": ["requestRenderMode"]
  },

  "symbol": {
    "name": "Primitive.update",
    "signature": "update(frameState: FrameState): void",
    "deprecated": false,
    "since_version": "1.0",
    "jsdoc": { "params": [], "returns": "void", "see": [] }
  },

  "render_stage": {
    "primary_stage": { "id": "update", "order": 1 },
    "also_affects": [
      { "id": "command_build", "order": 3, "perf_hotspot": true,
        "key_symbols": ["PrimitivePipeline.combineGeometry", "DrawCommand"] }
    ]
  },

  "call_graph": {
    "downstream": [
      { "name": "PrimitivePipeline.combineGeometry", "confidence": "certain" },
      { "name": "DrawCommand", "confidence": "certain" }
    ],
    "shader_boundary": ["PrimitiveVS", "PrimitiveFS"]
  },

  "critical_snippets": [
    {
      "symbol": "Primitive.update",
      "file": "Source/Scene/Primitive.js",
      "line_start": 1423,
      "line_end": 1456,
      "reason": "DrawCommand rebuild decision logic"
    }
  ],

  "experience_nodes": [
    {
      "type": "issue",
      "title": "Performance degradation with many Primitives",
      "quality_score": 0.87,
      "url": "https://github.com/CesiumGS/cesium/issues/12345"
    }
  ],

  "meta": {
    "version": "1.130",
    "generated_at": "2025-03-01T08:00:00Z",
    "cache_hit": false
  }
}
```

---

## Problem Knowledge Base

The Problem KB maps known Cesium problem patterns to diagnostic steps, related symbols, and render pipeline stages. It is the core of the `debug` and `performance` skills.

Current problem models (15 at launch):

**Rendering Artifacts** — z-fighting, depth-precision, flicker, black-tiles

**Resource Management** — memory-leak, texture-leak, tile-cache-overflow

**Performance** — performance-degradation, excessive-draw-calls, cpu-gpu-sync-stall, tile-load-thrashing

**Data / Loading** — tile-not-rendering, imagery-provider-error, terrain-gap

### Extending the Problem KB

```bash
# Run the automated mining pipeline (requires sync data)
cesium pkb mine --since 2024-01-01

# Review auto-generated candidates
cesium pkb review
# Interactive: approve / edit / reject each candidate

# Manually add a problem model
cesium pkb add --from-file my-problem.json
```

Problem model schema (`my-problem.json`):

```json
{
  "id": "your-problem-id",
  "category": "rendering_artifact | resource_management | performance | data_loading",
  "name": "Human-readable name",
  "aliases": ["alternate term", "another alias"],
  "trigger_keywords": ["keyword1", "keyword2"],
  "symptom_desc": "Description of what the user sees",
  "root_cause": "Why this happens",
  "diagnostic_steps": [
    { "step": 1, "check": "What to check", "expected_result": "What correct looks like" }
  ],
  "related_symbols": ["Symbol.name"],
  "related_stages": ["command_build"],
  "related_settings": ["cesiumOptionName"],
  "severity": "critical | high | medium | low"
}
```

---

## Project Structure

```
cesium-nexus/
├── src/
│   ├── cli/                    # CLI entry point and command definitions
│   │   ├── index.ts            # Main CLI entry (commander.js)
│   │   ├── commands/
│   │   │   ├── index-cmd.ts    # cesium index
│   │   │   ├── sync-cmd.ts     # cesium sync
│   │   │   ├── search-cmd.ts   # cesium search / explain / trace / diff
│   │   │   ├── issue-cmd.ts    # cesium issue
│   │   │   ├── diagnose-cmd.ts # cesium diagnose / stage / pkb
│   │   │   └── context-cmd.ts  # cesium context
│   │   └── mcp-server.ts       # MCP server entry (stdio transport)
│   │
│   ├── indexer/                # Knowledge base construction
│   │   ├── downloader.ts       # Cesium source download + version management
│   │   ├── ast-parser.ts       # Babel AST traversal → Symbol / CallGraph
│   │   ├── jsdoc-extractor.ts  # JSDoc structured extraction
│   │   ├── shader-parser.ts    # GLSL shader symbol extraction
│   │   └── sync/
│   │       ├── github-issues.ts      # GitHub Issues API sync
│   │       ├── github-releases.ts    # GitHub Releases API sync
│   │       ├── github-prs.ts         # GitHub PRs API sync
│   │       └── forum-scraper.ts      # Cesium Forum HTML scraper
│   │
│   ├── db/                     # Data layer
│   │   ├── schema.ts           # SQLite schema definitions (better-sqlite3)
│   │   ├── migrations/         # Schema migration files
│   │   ├── symbol-repo.ts      # Symbol CRUD + queries
│   │   ├── callgraph-repo.ts   # CallGraph BFS traversal
│   │   ├── diff-engine.ts      # Cross-version symbol diff
│   │   ├── experience-repo.ts  # Experience nodes queries
│   │   └── problem-repo.ts     # Problem KB queries
│   │
│   ├── search/                 # Search engines
│   │   ├── tantivy.ts          # Tantivy full-text index wrapper
│   │   └── qdrant.ts           # Qdrant vector index wrapper (P1)
│   │
│   ├── skill/                  # Skill Dispatch + Retrieval
│   │   ├── dispatcher.ts       # Keyword rules + entity extraction → Skill
│   │   ├── skills/
│   │   │   ├── api-skill.ts
│   │   │   ├── debug-skill.ts
│   │   │   ├── performance-skill.ts
│   │   │   ├── shader-skill.ts
│   │   │   ├── migration-skill.ts
│   │   │   └── general-skill.ts
│   │   └── retrieval-planner.ts # Merge Skill strategy + Diagnosis output → query tasks
│   │
│   ├── diagnosis/              # Problem Diagnosis layer
│   │   ├── pkb-matcher.ts      # Keyword match against Problem KB
│   │   └── render-stage.ts     # Stage → key_symbols lookup
│   │
│   ├── context/                # Context Pack builder
│   │   ├── builder.ts          # Assemble context.json from retrieval results
│   │   ├── token-budget.ts     # Section-level token limits + truncation
│   │   └── cache.ts            # L2 Context Pack cache (SQLite)
│   │
│   └── pkb/                    # Problem KB management
│       ├── mining-pipeline.ts  # Auto-mine candidates from Issue/PR/Forum
│       └── review-cli.ts       # Interactive approve/edit/reject UI
│
├── data/
│   ├── problem-kb/             # Static Problem KB JSON files
│   │   ├── rendering-artifacts/
│   │   │   ├── z-fighting.json
│   │   │   ├── depth-precision.json
│   │   │   ├── flicker.json
│   │   │   └── black-tiles.json
│   │   ├── resource-management/
│   │   │   ├── memory-leak.json
│   │   │   ├── texture-leak.json
│   │   │   └── tile-cache-overflow.json
│   │   ├── performance/
│   │   │   ├── performance-degradation.json
│   │   │   ├── excessive-draw-calls.json
│   │   │   ├── cpu-gpu-sync-stall.json
│   │   │   └── tile-load-thrashing.json
│   │   └── data-loading/
│   │       ├── tile-not-rendering.json
│   │       ├── imagery-provider-error.json
│   │       └── terrain-gap.json
│   │
│   └── render-stages/          # Static render pipeline stage definitions
│       └── stages.json         # 10 stage records with key_symbols
│
├── repository/                 # Cesium source cache (gitignored)
│   ├── 1.120/
│   ├── 1.125/
│   └── 1.130/
│
├── .cesium-db/                 # SQLite databases (gitignored)
│   ├── metadata.db             # symbol / call_graph / file / symbol_map / etc.
│   ├── experience.db           # experience_node / experience_edge
│   ├── problem.db              # problem / problem_issue_link
│   └── context-cache.db        # Context Pack cache
│
├── .cesium-index/              # Tantivy full-text indexes (gitignored)
│   ├── api/
│   ├── source/
│   ├── issues/
│   ├── forum/
│   └── experience/
│
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
      "minComments": 3,
      "labels": ["bug", "performance", "rendering", "terrain", "imagery"]
    },
    "forumFilter": {
      "minReplies": 2,
      "requireSolution": false,
      "minViews": 100
    }
  },

  "contextPack": {
    "defaultTokenBudget": 5000,
    "skillBudgets": {
      "debug": 6000,
      "performance": 6000,
      "api": 4000,
      "migration": 5000,
      "shader": 5000,
      "general": 4000
    }
  },

  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "apiKey": "${OPENAI_API_KEY}"
  }
}
```

Environment variable overrides:

```bash
CESIUM_CLI_GITHUB_TOKEN=ghp_...
CESIUM_CLI_DB_PATH=/custom/path/.cesium-db
OPENAI_API_KEY=sk-...
```

---

## Development

### Stack

| Layer | Library |
|---|---|
| CLI framework | `commander` |
| MCP server | `@modelcontextprotocol/sdk` |
| SQLite | `better-sqlite3` |
| Full-text search | `@napi-rs/tantivy` |
| Vector search | `@qdrant/js-client-rest` (P1) |
| AST parsing | `@babel/parser` + `@babel/traverse` |
| HTTP client | `undici` |
| Testing | `vitest` |
| Build | `tsup` |

### Setup

```bash
npm install
npm run build          # compile TypeScript
npm run dev            # watch mode
npm test               # vitest
npm run lint           # eslint
```

### Testing strategy

Unit tests cover: AST parser output correctness, CallGraph BFS traversal (cycle detection, depth limits, confidence filtering), Problem KB keyword matching, Token budget truncation logic, Context Pack section assembly.

Integration tests cover: End-to-end `cesium explain Primitive.update` against a real indexed version, MCP tool round-trip for each of the 11 tools, Context Pack output validates against JSON schema.

```bash
npm run test:unit
npm run test:integration    # requires a pre-built index
npm run test:mcp            # spins up MCP server, runs tool calls
```

---

## Milestones

| Milestone | Focus | Status |
|---|---|---|
| **M1: Can Query** | Symbol lookup, CallGraph, Issue/Release search, MCP (7 tools) | 🚧 In Progress |
| **M2: Can Explain** | Problem KB, Render Stages, Forum data, Skill Dispatch, Context Pack v2 | ⬜ Planned |
| **M3: Can Diagnose** | Experience Graph edges, Problem Mining Pipeline, vector search, Migration Skill | ⬜ Planned |

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full v3.1 design and the audit report at [`ARCHITECTURE_REVIEW.md`](./ARCHITECTURE_REVIEW.md).

---

## FAQ

**Why not just use the Cesium API docs website?**
The docs tell you what an API does, not why it behaves a certain way, what issues have been filed against it, or how it connects to the rest of the render pipeline. This tool answers the "why" questions.

**Why not use a general-purpose code search tool (Sourcegraph, grep.app)?**
Those tools search within a single codebase. This tool cross-references source code with GitHub issues, community forum knowledge, and version history simultaneously, and packages it for LLM consumption with a token budget.

**Can I use this with Cesium Ion / CesiumJS versions not listed?**
Run `cesium index --version <version>` for any released version. The system is designed for CesiumJS (the open-source library). CesiumJS and Cesium Ion server-side code are different things.

**Does this send my code to any external service?**
The indexer downloads Cesium's public source from GitHub. Your own code is never sent anywhere. Embedding API calls (P1 feature, optional) send Cesium text summaries to your configured provider (OpenAI by default). The LLM call in `cesium context` goes to your configured model endpoint.

**How do I keep the knowledge base up to date?**
Run `cesium sync` on a schedule (weekly is sufficient for most teams). New Cesium versions require `cesium index --version <new>` manually, which takes 10–20 minutes.

---

## License

MIT
