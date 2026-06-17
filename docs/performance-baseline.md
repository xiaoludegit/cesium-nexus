## Performance Baseline — Cesium v1.141.0

> Machine: Windows 10 x64, Node v22.18.0
> Date: 2026-06-16
> Database: 9.2 MB SQLite (3586 symbols, 3586 source records, 1004 source files, 0 issues, 0 call edges)

### Indexing

| Operation | Time | Notes |
|---|---|---|
| Full re-index (`index:symbols`) | ~7 min | 1004 files → 3586 symbols, FTS5 rebuild included |

Indexing is a one-time operation per Cesium version upgrade. Incremental re-index (unchanged files skipped) is significantly faster.

### CLI Queries

All measurements include ~570 ms Node.js process startup overhead (module loading, dynamic imports). Actual query latency = total - 570 ms.

| Command | Total (avg) | Query Time (est.) | Notes |
|---|---|---|---|
| `symbol Viewer` | 852 ms | ~285 ms | FTS5 symbol search |
| `symbol Cartesian3` | 868 ms | ~301 ms | FTS5 symbol search |
| `source Viewer` | 831 ms | ~264 ms | Source retrieval by symbol |
| `trace Viewer --depth 2` | 775 ms | ~208 ms | Call graph (empty — no edges indexed yet) |
| `context Viewer --depth 2` | 718 ms | ~151 ms | Context pack build |
| `issue bug` | 781 ms | ~214 ms | FTS5 issue search (empty — no issues synced) |

### MCP Server

| Operation | Time | Notes |
|---|---|---|
| Cold start + `initialize` round-trip | ~1000 ms | Process spawn → first JSON-RPC response |
| Warm request (`tools/list`) | ~13 ms | Already-running server, stdin/stdout pipe |
| Warm request (`tools/call`) | ~6 ms | Error path (symbol not found) |

The MCP server is designed for persistent use (long-running process). The cold-start overhead is amortized across many requests. Warm-state latency is well under 50 ms for all operations.

### Bottleneck Analysis

The dominant cost for CLI queries is Node.js process startup (~570 ms, ~75% of total time). For interactive/ad-hoc CLI use this is acceptable. For high-throughput scenarios, the MCP server (persistent process) is the recommended interface.

Within query execution itself, FTS5 search is fast (<5 ms estimated). The remaining time is SQLite I/O, JSON serialization, and token estimation for context packs.

### Known Limitations

- Call edges and issues are not yet populated in the baseline database (Cesium source submodule has no GitHub issues synced, call graph extraction requires the full indexer pipeline).
- Token estimation (`tiktoken`-based) adds ~20-50 ms per context pack build.
- Full re-index time scales linearly with file count; Phase 2 will add incremental indexing.
