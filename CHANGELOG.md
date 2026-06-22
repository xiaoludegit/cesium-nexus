# Changelog

All notable changes to this project will be documented in this file.

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
