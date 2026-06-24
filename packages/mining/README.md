# @cesium-nexus/mining

Problem Mining Pipeline — clusters issue / forum / experience data into **CanonicalProblems** and drafts **PatternCandidates** for human review.

## Architecture

```
EmbeddingSearchProvider (Qdrant)
  → CosineThresholdClusterer (greedy seed, configurable threshold)
  → CanonicalProblem builder
  → Drafter (LLMBackend: Ollama default / OpenAI-compatible fallback)
  → Scorer (cosine dedup against existing patterns, >0.9 → dup_of)
  → MiningStore (SQLite: canonical_problem + problem_candidate tables)
```

## Data Flow

```
Issue vectors (Qdrant)
  ↓ cluster (cosine threshold)
Clusters (≥ minClusterSize members)
  ↓ buildCanonicalProblems
CanonicalProblems (deduplicated problem concepts)
  ↓ Drafter (LLM)
PatternCandidates (drafted with aliases, symptoms, symbols, category)
  ↓ Scorer (cosine vs existing patterns)
Candidates marked dup_of if similar to existing pattern
  ↓ MiningStore
Persisted to SQLite for review
```

## CLI Usage

```bash
# Run mining pipeline (requires Qdrant + Ollama)
cesium pkb mine \
  --since 2026-01-01 \
  --threshold 0.90 \
  --min-cluster 2 \
  --qdrant-url http://localhost:6333 \
  --ollama-url http://localhost:11434 \
  --ollama-model qwen2.5:7b

# List existing problem patterns
cesium pkb list

# Embed patterns to Qdrant
cesium pkb embed

# Semantic search
cesium pkb search "z-fighting"
```

## Programmatic API

```typescript
import {
  MiningPipeline,
  MiningStore,
  OllamaBackend,
  Drafter,
  Scorer,
  QdrantEmbeddingProvider,
} from "@cesium-nexus/mining";
import Database from "better-sqlite3";

const db = new Database("./database/cesium.db");
const store = new MiningStore(db);

const provider = new QdrantEmbeddingProvider({ url: "http://localhost:6333" });
const llm = new OllamaBackend({ url: "http://localhost:11434" });
const drafter = new Drafter({ llm });
const scorer = new Scorer({ threshold: 0.9 });

const pipeline = new MiningPipeline({
  provider,
  clustererConfig: { threshold: 0.9, minClusterSize: 2, maxClusterSize: 50 },
  drafter,
  scorer,
  store,
  db,
  vectorScope: { entityType: "issue" },
});

const result = await pipeline.run();
console.log(result.stats);
// { totalVectors: 2000, totalClusters: 15, totalCanonicalProblems: 15, totalCandidates: 15, durationMs: 4500, threshold: 0.9 }
```

## Types

### CanonicalProblem

```typescript
interface CanonicalProblem {
  id: string;
  title: string;
  aliases: string[];
  representativeIssueId: number | null;
  clusterIds: string[];
  experienceIds: string[];
  confidence: number; // 0..1
  status: "candidate" | "reviewed" | "accepted";
  createdAt: number;
  reviewedAt: number | null;
}
```

### ProblemCandidate

```typescript
interface ProblemCandidate {
  id: string;
  canonicalId: string;
  clusterId: string;
  draftAlias: string[];
  draftSymptoms: string[];
  draftSymbols: string[];
  draftCategory: string | null;
  llmRaw: string | null;
  qualityScore: number | null;
  dupOf: string | null; // pattern id if duplicate detected
  status: "pending" | "approved" | "rejected";
  reviewedAt: number | null;
  createdAt: number;
  sourceCount: number;
  issueCount: number;
  forumCount: number;
  experienceCount: number;
}
```

## Testing

```bash
pnpm test -- packages/mining
```

**65 tests in this package** (`@cesium-nexus/mining`) covering:
- `CosineThresholdClusterer` — greedy seed clustering, threshold enforcement, size limits
- `CanonicalProblem` factory — sequential IDs, experience/issue ID mapping
- `CandidateFactory` — build, source count aggregation, llmRaw/dupOf preservation
- `MiningStore` — CRUD, stats, status transitions
- `OllamaBackend` — prompt format, retry, error handling, URL cleanup
- `OpenAICompatibleBackend` — chat format, auth headers, error handling
- `Drafter` — prompt structure, markdown fence parsing, fallback on invalid JSON, batch error tolerance
- `Scorer` — cosine dedup, threshold respect, best-match selection, zero-vector handling
- `MiningPipeline` — full E2E flow, empty vectors error, noise point dropping, member summary passing

## Decisions

- **Cosine threshold clustering** over HDBSCAN — faster, more controllable, sufficient for ~2000 issues
- **LLMBackend abstraction** — Ollama default (offline), OpenAI-compatible fallback (LM Studio, vLLM, remote)
- **Scorer threshold independent** from Clusterer — separate config, default 0.9
- **Pipeline strong dependency on Qdrant** — no graceful fallback; fails fast with helpful error message
- **Prompt template as TS string constant** — no YAML/JSON config to avoid premature abstraction
