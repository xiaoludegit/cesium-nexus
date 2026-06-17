# Changelog

All notable changes to this project will be documented in this file.

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
