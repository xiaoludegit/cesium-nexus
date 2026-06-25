# CHANGELOG

## Phase 3 — Code Intelligence (2026-06-25)

### Phase 3A1: Version Intelligence
- **Symbol Snapshot**: Version-specific symbol indexing with SHA1 identity
- **Symbol Diff Engine**: Cross-version symbol comparison
- **Breaking Change Detector**: Identifies removed/renamed/signature_changed
- **CLI**: `cesium snapshot`, `cesium diff`
- Commit: `d565861` + `c93dd21`

### Phase 3A2: Shader Intelligence
- **GLSL Scanner**: Scans `.glsl` files for shader symbols
- **Shader Index Builder**: Indexes uniforms, varyings, functions, structs, defines
- **Shader-JS Linker**: Associates shader symbols with JS symbols and render stages
- **CLI**: `cesium shader`
- Commit: `0ac02ce` + `773afbb`

### Phase 3B: Evidence Fusion Engine
- **Evidence Collector**: Gathers evidence from patterns, symbols, shaders, stages, experiences
- **Evidence Ranker**: Rule-based ranking (type weight × distance × time decay)
- **Explanation Generator**: Human-readable root cause explanations
- **Diagnosis Reasoner**: Integrated diagnosis with confidence scoring
- **CLI**: `cesium diagnose-reason`
- Commit: `536a903`

### Phase 3C: Service Layer + MCP Tools
- **Service Layer**: `@cesium-nexus/service` — MCP/CLI → Service → Intelligence/Reasoner
- **MCP Tools** (4 new, 17 total): `search_migration`, `search_shader`, `compare_version`, `diagnose_root_cause`
- **Code Review Fixes**: Explicit DI, type safety, removed `any` casts
- Commits: `8410370` + `f7cf1c0` + `a7d53b6`

### E2E Validation
- **10/10** queries return correct root cause pattern
- **455 tests** passed (36 test files)
- **Performance**: All queries < 10ms

---

## Phase 2E — Problem Mining Pipeline (2026-06-24)

- Issue Intent Classification (bug vs feature vs question)
- LLM-based problem drafting with quality scoring
- Mining Pipeline: discover → classify → draft → promote
- CLI: `cesium mining`
- Commit: `2f09eae`, 408 tests

---

## Phase 2D — Diagnosis Retrieval Enhancement (2026-06-23)

- Hybrid diagnosis: keyword + vector semantic search
- PKB embedding to Qdrant
- Experience recall enhancement
- Tag: `v0.5.0`, commit `e04a5ea`, 297 tests

---

## Phase 2C — Experience Graph (2026-06-23)

- Unified experience index (issues, PRs, forum)
- `fixes` deterministic edges + BFS traversal
- Qdrant vector search (384-dim ONNX embed)
- `references` inferred edges from semantic similarity

---

## Phase 2B — Render Pipeline Intelligence (2026-06-23)

- 12-stage render pipeline DAG
- 5 Skills: api/debug/performance/shader/general
- Skill-aware Context Pack v2
- Forum crawler (Discourse API)

---

## Phase 2A — Problem Diagnosis (2026-06-22)

- Problem Knowledge Base (10 patterns)
- Symptom-to-pattern matching
- Diagnostic Context Pack
- CLI: `cesium diagnose`
- Commit: `d06e479`, 239 tests

---

## Phase 1 — Foundation (2026-06-20)

- Symbol indexing (AST parsing)
- Call graph extraction
- GitHub Issues sync
- Context Pack builder
- MCP server (13 tools)
