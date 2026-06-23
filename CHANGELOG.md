# Changelog

All notable changes to this project will be documented in this file.

## v0.5.0 (2026-06-23) — commit `e04a5ea`, tag `v0.5.0`

### Added — Phase 2D: Diagnosis Retrieval Enhancement

- **Hybrid Matcher** — 6th signal (vector semantic similarity, weight 3) added to `matchProblemPatterns`, `VECTOR_STRONG_THRESHOLD = 0.75` gate
- **PKB Vectorization** — `embedProblemPatterns` / `embedRenderStages` embed problem patterns and render stages to Qdrant (384 dim)
- **Unified Search** — `searchKnowledgeBase` searches across all node types (pattern/stage/experience), `semanticSearch` generalized filter
- **Experience Recall** — `diagnoseProblem` accepts `experienceSearchFn` for vector-based experience node recall in diagnosis output
- **Score Fusion** — `DiagnosisMatch.vectorScore` field, keyword + cosine similarity weighted combination
- **Token Budget** — `relatedExperiences` integrated into truncation pipeline (priority between issues and callgraph)
- **CLI commands**: `cesium pkb embed`, `cesium pkb search <query>`, `cesium diagnose --hybrid`
- **MCP `diagnose_problem`** — New `hybrid` parameter for vector-enhanced diagnosis (tool count stays 13)
- 297 tests passing (was 286)

## v0.4.0 (Unreleased)

### Added — Phase 2C+: Qdrant Vector Search Integration

- **`@cesium-nexus/vector` package** (new) — Local ONNX embedding (Xenova/all-MiniLM-L6-v2, 384 dim) + Qdrant client
- **Semantic Search** — `semanticSearch` embeds query → searches `eng-knowledge` collection with `project: "cesium-nexus"` filter
- **Experience Embedding** — `embedAllExperienceNodes` batch-embeds all experience nodes (title + summary) into Qdrant vectors
- **`references` Edges** — `buildReferencesEdges` infers semantic similarity edges (cosine > 0.85) between experience nodes
- **`ExperienceEdgeType`** — Extended from `"fixes"` to `"fixes" | "references"`
- **MCP tool**: `semantic_search_experience` (`{ query, limit?, minScore?, type? }`) — vector semantic search (13 tools total, was 12)
- **CLI commands**: `cesium experience embed`, `cesium experience semantic <query>`, `cesium experience references`
- Dynamic imports for `@xenova/transformers` to avoid eager `sharp` module loading
- 286 tests passing, 10 packages (was 9)

## v0.3.0 (Unreleased)

### Added — Phase 2C: Experience Graph

- **Experience Edge** — `experience_edge` table with `fixes` edge type (PR → Issue), auto-built from `closingIssueReferences`
- **`ExperienceEdgeRepo`** — BFS traversal (downstream/upstream/connected), depth-limited, cycle-safe, edge statistics
- **Edge Builder** — `buildFixesEdges` constructs deterministic edges from merged PRs, `rebuildExperienceGraph` rebuilds nodes + edges
- **Graph Traversal** — `getExperienceChain` returns bidirectional BFS chain with connected nodes and edges
- **MCP tool**: `get_experience_chain` (`{ nodeId, maxDepth? }`) — experience graph traversal (12 tools total, was 11)
- **CLI commands**: `cesium experience search`, `cesium experience rebuild`, `cesium experience chain <node_id>`, `cesium experience stats`
- 286 tests passing (was 282)

## v0.2.0 (Unreleased)

### Added — Phase 2B: Render Pipeline Intelligence

- **Render Pipeline Graph** — Extended render stages from 9 to 12 with full dependency DAG (dependsOn, perfHotspot, isOptional), Kahn's algorithm cycle detection, upstream/downstream traversal
- **`@cesium-nexus/skills` package** (new) — Skill dispatch router, entity extractor, token budget manager, skill-aware context pack builder
- **Skill Dispatch** — 5 hardcoded skills (api / debug / performance / shader / general), keyword scoring + entity-based boosting, JSON config (`data/skills/skill-configs.json`)
- **Context Pack v2** — Skill-aware context assembly with per-skill token budgets, progressive truncation (experience → forum → callgraph → issues → source → stages → diagnosis)
- **Forum Crawler** — Discourse JSON API crawler with quality scoring (`hasSolution`, `viewsCount`)
- **GitHub PR Sync** — Merged PR sync via GitHub REST API with incremental cursor
- **Experience Node** — Unified search layer over Issues, PR Reviews, and Forum posts with type/symbol/quality filters
- **Storage**: 3 new tables with FTS5 (`pull_requests`, `forum_posts`, `experience_node`) + `PullRequestRepo`, `ForumRepo`, `ExperienceRepo`
- **CLI commands**: `cesium forum sync`, `cesium forum search`, `cesium skills list`, `cesium dispatch <query>`, `cesium skill-pack <query>`, `cesium pipeline [stage_id]`
- **MCP tools**: `search_forum`, `search_experience`, `dispatch_skill`, `build_skill_pack` (11 tools total, was 7)
- **Pipeline CLI** — `cesium pipeline` displays full render pipeline DAG with dependency visualization
- 9 packages (was 8), 282 tests passing

### Added — Phase 2A: Problem Diagnosis

- **Problem Knowledge Base** — 10 static problem patterns (z-fighting, depth precision, terrain conflict, primitive performance, label visibility, tiles jitter, tiles loading, picking failure, shader compile error, LOD popping)
- **Render Stage KB** — 9 diagnostic render stages with key symbols and symptom hints
- **`@cesium-nexus/diagnosis` package** — Knowledge loader, symptom matcher, diagnosis assembler, token budget truncation
- **CLI commands**: `cesium diagnose "<problem>"`, `cesium pkb list`, `cesium stage <id>`
- **MCP tools**: `diagnose_problem` (symptom → diagnostic context pack), `query_render_stage` (stage/problem ID → render stages)
- **Evaluation dataset** — 12 test cases validating pattern matching and symbol resolution
- 7 MCP tools total (was 5), 8 packages (was 7)

## v0.1.0 (2025-06-16)

### Added

- **M1 Symbol Index** — Scan Cesium source, extract Class/Function/Method/Enum/Constant into SQLite with FTS5
- **M2 Source Retrieval** — Symbol lookup, source code retrieval, full-text search (FTS5) across source code
- **M3 Issue Index** — Sync CesiumGS/cesium GitHub Issues (incremental), FTS5 search with BM25 ranking
- **M4 CallGraph** — Lightweight call edge extraction (call/construct/static_call), BFS traversal with depth limit
- **M5 MCP Server** — 4 MCP tools (`search_symbol`, `get_source`, `search_issue`, `trace_callgraph`) via stdio transport
- **M6 Context Pack** — `build_context_pack` MCP tool + `cesium context` CLI, 4-section structured JSON with token budget truncation
- CLI commands: `cesium index:symbols`, `cesium sync:issues`, `cesium symbol`, `cesium source`, `cesium search`, `cesium issue`, `cesium trace`, `cesium context`, `cesium mcp`
- pnpm monorepo with 7 packages: shared, parser, storage, indexer, cli, mcp, context-pack
- ESLint flat config + TypeScript strict mode
- GitHub Actions CI pipeline
