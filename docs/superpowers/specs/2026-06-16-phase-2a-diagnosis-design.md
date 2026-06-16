# Phase 2A Diagnosis Design

## Goal

Phase 2A makes `cesium-nexus` useful for Cesium problem diagnosis. The system should answer "why did this happen, where does it happen, how do I investigate it, and how can I fix it?" for common real Cesium failures.

Phase 2A is not an API documentation assistant and is not a render pipeline teaching system. API explanation and render pipeline intelligence can grow from this work, but the first acceptance target is debug-oriented diagnosis.

## Scope

Phase 2A builds a deterministic diagnosis loop:

```text
user symptom
-> static Problem KB match
-> related render stages
-> related symbols, source, callgraph, issues
-> investigation steps and fix suggestions
-> Diagnostic Context Pack
```

The implementation uses static JSON knowledge and rule-based matching. It does not use embeddings, vector search, semantic retrieval, reranking, agent workflows, or multi-pack merge.

## User-Facing Behavior

For an input such as:

```text
why is my polygon flickering?
```

The system returns a diagnostic result with:

- possible causes such as z-fighting, depth precision, overlapping geometry, terrain conflict, and `GroundPrimitive` limitations
- render stages such as depth pass, opaque pass, translucent pass, update stage, or command build stage
- related symbols such as `PolygonGeometry`, `Primitive`, `GroundPrimitive`, `ClassificationPrimitive`, and `Scene`
- related source snippets from the existing source index
- related callgraph edges from the existing call graph index
- related GitHub Issues from the existing issue index
- investigation steps in a recommended order
- fix suggestions that a Cesium developer can try

## Architecture

Add a dedicated diagnosis domain package:

```text
packages/diagnosis
```

This package owns:

- static knowledge loading
- static knowledge validation
- deterministic problem matching
- diagnostic result assembly
- Diagnostic Context Pack truncation

It does not own CLI argument parsing, MCP protocol registration, or database schema initialization.

The package consumes existing Phase 1 repositories:

- `SymbolRepo` for symbol lookup and source snippets
- `CallGraphRepo` for upstream and downstream call relationships
- `IssueRepo` for issue search

Phase 1 `ContextPack` remains stable. Phase 2A introduces a separate `DiagnosticContextPack` shape so existing `build_context_pack` behavior does not regress.

## Data Files

Create these static data files:

```text
data/problem-kb/problem-patterns.json
data/problem-kb/render-stages.json
data/evaluation/phase2a-diagnosis-cases.json
```

`problem-patterns.json` contains 10-12 initial problem patterns:

- flickering polygon
- z-fighting
- depth precision
- picking failure
- terrain conflict
- primitive performance
- shader compile error
- 3D Tiles loading
- 3D Tiles jitter
- LOD popping
- label visibility
- depth test abnormal

`render-stages.json` contains 8-10 diagnosis-oriented render stages. It is not a complete render pipeline model. Each stage exists only to help explain where a problem is likely to occur.

`phase2a-diagnosis-cases.json` contains at least 10 real evaluation cases used for acceptance review.

## Shared Types

Extend `packages/shared/src/types.ts` with diagnosis types:

```ts
export interface ProblemPattern {
  id: string;
  name: string;
  category: "debug" | "performance" | "rendering" | "terrain" | "tiles" | "shader";
  severity: "low" | "medium" | "high";
  aliases: string[];
  triggerKeywords: string[];
  symptoms: string[];
  possibleCauses: string[];
  relatedSymbols: string[];
  relatedStages: string[];
  issueQueries: string[];
  investigationSteps: string[];
  fixSuggestions: string[];
}

export interface RenderStage {
  id: string;
  name: string;
  order: number;
  description: string;
  keySymbols: string[];
  symptomHints: string[];
}

export interface DiagnosisMatch {
  pattern: ProblemPattern;
  score: number;
  matchedKeywords: string[];
}

export interface DiagnosisMetadata {
  totalTokens: number;
  truncated: boolean;
  tokenBudget: number;
}

export interface DiagnosisResult {
  query: string;
  matchedPatterns: DiagnosisMatch[];
  renderStages: RenderStage[];
  relatedSymbols: SymbolRecord[];
  relatedSource: SourceSnippet[];
  callgraph: Edge[];
  relatedIssues: IssueRecord[];
  investigationSteps: string[];
  fixSuggestions: string[];
  metadata: DiagnosisMetadata;
}

export interface DiagnosticContextPack extends DiagnosisResult {
  kind: "diagnosis";
}
```

## Matching Rules

The matcher is deterministic and explainable.

Normalize the query by lowercasing, splitting alphanumeric terms, and preserving useful Cesium identifiers such as `GroundPrimitive`, `3D Tiles`, and `z-fighting` through alias entries.

Score each pattern with:

- alias match: high weight
- trigger keyword match: medium weight
- symptom phrase match: medium weight
- related symbol mention: low weight
- category keyword match: low weight

Return the top matches above a minimum threshold. The result must include `matchedKeywords` so reviewers can understand why a pattern matched.

If no pattern reaches the threshold, return an empty match list with a successful response and diagnostic metadata. Do not invent a diagnosis.

## Diagnostic Assembly

Given matched patterns:

1. Merge related render stage IDs and load matching `RenderStage` records.
2. Merge related symbol names and resolve them through `SymbolRepo`.
3. Retrieve source snippets for resolved symbols.
4. Retrieve callgraph edges for the strongest related symbols.
5. Search issues using each pattern's `issueQueries`.
6. Deduplicate investigation steps and fix suggestions while preserving pattern order.
7. Apply token truncation.

Related source should prefer the primary symbols from the strongest matched pattern before secondary patterns.

Related issues should prefer closed/fixed issues when available, but Phase 2A can use the existing issue search interface without adding new issue schema fields.

## Diagnostic Context Pack Budget

The default budget is 6000 tokens.

Truncation order:

1. related source
2. related issue bodies
3. callgraph
4. render stage descriptions
5. fix suggestions
6. investigation steps

Even under a small budget, keep:

- matched pattern IDs and names
- possible causes from matched patterns
- related symbol names
- investigation step titles
- fix suggestion titles
- metadata

## CLI Commands

Add:

```bash
cesium diagnose "<problem>"
cesium pkb list
cesium stage <problem_id|stage_id>
```

`cesium diagnose` prints a human-readable diagnosis with sections:

- Possible Causes
- Render Stages
- Related Symbols
- Related Source
- Related Issues
- Investigation Steps
- Possible Fixes

`cesium pkb list` prints known problem pattern IDs, names, categories, and aliases.

`cesium stage <problem_id|stage_id>` prints render stage details. If a problem ID is provided, it prints the stages related to that problem.

## MCP Tools

Add:

```text
diagnose_problem
query_render_stage
```

`diagnose_problem` input:

```json
{
  "problem": "polygon flickering",
  "limit": 5,
  "budget": 6000
}
```

`diagnose_problem` output uses the existing tool envelope:

```json
{
  "success": true,
  "data": {
    "kind": "diagnosis"
  }
}
```

`query_render_stage` accepts either a `stageId` or `problemId` and returns matching render stage records.

After Phase 2A, `tools/list` should include:

- `search_symbol`
- `get_source`
- `search_issue`
- `trace_callgraph`
- `build_context_pack`
- `diagnose_problem`
- `query_render_stage`

## Milestones

### P2A-1 Diagnosis Domain and Static KB

Build `packages/diagnosis`, add shared diagnosis types, add static data files, implement knowledge loading and deterministic matching.

Acceptance examples:

```text
"polygon flickering" -> z_fighting, depth_precision, terrain_conflict
"primitive performance slow" -> primitive_performance
"label disappears" -> label_visibility
```

### P2A-2 Diagnosis Assembly

Connect matched patterns to existing Phase 1 retrieval repositories and return a full `DiagnosticContextPack`.

Acceptance: `diagnoseProblem("polygon flickering")` returns matched patterns, render stages, symbols, source, callgraph, issues, investigation steps, fix suggestions, and metadata.

### P2A-3 Diagnostic Context Pack v2

Stabilize `DiagnosticContextPack` and token truncation behavior.

Acceptance: small budgets still preserve matched patterns, possible causes, related symbols, investigation steps, fix suggestions, and `metadata.truncated = true`.

### P2A-4 CLI

Add `diagnose`, `pkb list`, and `stage` commands.

Acceptance: `cesium diagnose "why polygon flickering"` prints all required diagnosis sections.

### P2A-5 MCP Tools

Add `diagnose_problem` and `query_render_stage` to the MCP server.

Acceptance: MCP protocol tests show 7 tools and `diagnose_problem` returns a standard success envelope.

### P2A-6 Evaluation Dataset

Add a 10-20 case evaluation dataset and tests or review helpers that verify each case hits useful diagnosis output.

Acceptance:

- each case matches at least one expected pattern
- each case returns at least one related symbol
- the five core acceptance questions return investigation steps and fix suggestions

## Phase 2A Acceptance Questions

Phase 2A is complete when these questions return valuable diagnosis results:

```text
why does Polygon flicker?
why does z-fighting happen?
why is Primitive performance bad?
why do 3D Tiles jitter?
why does Label disappear?
```

Each answer must include:

- problem causes
- related source
- related callgraph
- related issues
- investigation steps
- fix suggestions

## Explicit Non-Goals

Phase 2A does not implement:

- embedding
- vector search
- semantic retrieval
- reranking
- agent workflow
- multi-pack merge
- automatic code fixes
- full render pipeline intelligence
- Forum crawler
- PR review ingestion
- SQLite schema migration for problem patterns

## Follow-On Phases

Phase 2B: Render Pipeline Intelligence focused on `Primitive.update`, `FrameState`, `DrawCommand`, and pass pipeline reasoning.

Phase 2C: Semantic Retrieval with embedding, hybrid search, and reranking.

Phase 2D: Agent Context System with context routing, multi-pack merge, Hermes integration, and Claude Code integration.
