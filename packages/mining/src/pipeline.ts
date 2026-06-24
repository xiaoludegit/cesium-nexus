/**
 * MiningPipeline — orchestrates the full problem mining flow:
 *
 *   EmbeddingSearchProvider → CosineThresholdClusterer
 *   → CanonicalProblem builder → Drafter → Scorer → MiningStore
 *
 * Strongly depends on QdrantEmbeddingProvider; no graceful fallback.
 * If vector data is unavailable, the pipeline fails fast.
 */

import type {
  CanonicalProblem,
  Cluster,
  ClusterConfig,
  EmbeddingSearchProvider,
  MiningRunStats,
  ProblemCandidate,
  VectorRecord,
} from "./types.js";
import { CosineThresholdClusterer } from "./discovery/cosine-clusterer.js";
import { buildCanonicalProblems } from "./discovery/canonical-problem.js";
import { Drafter } from "./drafting/drafter.js";
import type { DrafterOptions } from "./drafting/drafter.js";
import { Scorer } from "./drafting/scorer.js";
import { MiningStore } from "./review/mining-store.js";
import type BetterSqlite3 from "better-sqlite3";
import { buildCandidate } from "./drafting/candidate-factory.js";

export interface MiningPipelineOptions {
  provider: EmbeddingSearchProvider;
  clustererConfig: ClusterConfig;
  drafter: Drafter;
  scorer: Scorer;
  store: MiningStore;
  db: BetterSqlite3.Database;
  /** Vector scope to fetch (default: { entityType: "issue" }) */
  vectorScope?: { entityType: "issue" | "experience" | "pattern" | "stage"; since?: number };
}

export interface PipelineResult {
  clusters: Cluster[];
  canonicalProblems: CanonicalProblem[];
  candidates: ProblemCandidate[];
  stats: MiningRunStats;
}

export class MiningPipeline {
  private readonly provider: EmbeddingSearchProvider;
  private readonly clustererConfig: ClusterConfig;
  private readonly drafter: Drafter;
  private readonly scorer: Scorer;
  private readonly store: MiningStore;
  private readonly db: BetterSqlite3.Database;
  private readonly vectorScope: { entityType: "issue" | "experience" | "pattern" | "stage"; since?: number };

  constructor(opts: MiningPipelineOptions) {
    this.provider = opts.provider;
    this.clustererConfig = opts.clustererConfig;
    this.drafter = opts.drafter;
    this.scorer = opts.scorer;
    this.store = opts.store;
    this.db = opts.db;
    this.vectorScope = opts.vectorScope ?? { entityType: "issue" };
  }

  /**
   * Run the full mining pipeline.
   *
   * Steps:
   * 1. Fetch vectors from provider
   * 2. Cluster vectors (cosine threshold)
   * 3. Build CanonicalProblems from clusters
   * 4. Draft PatternCandidates via LLM
   * 5. Score candidates against existing patterns (duplicate detection)
   * 6. Store everything in SQLite
   */
  async run(): Promise<PipelineResult> {
    const startTime = Date.now();

    // Step 1: Fetch vectors
    const vectors = await this.provider.listVectors(this.vectorScope);
    if (vectors.length === 0) {
      throw new Error(
        `No vectors found for scope ${JSON.stringify(this.vectorScope)}. ` +
          "Ensure Qdrant is running and data has been synced.",
      );
    }

    // Step 2: Cluster
    const clusterer = new CosineThresholdClusterer({
      provider: this.provider,
      config: this.clustererConfig,
    });
    const clusters = await clusterer.cluster(vectors);

    // Step 3: Build CanonicalProblems
    const canonicalProblems = buildCanonicalProblems({
      clusters,
      experienceIdByMemberId: (memberId) => {
        // Extract numeric ID from memberId like "issue:12345"
        const m = memberId.match(/^issue:(\d+)$/);
        return m ? parseInt(m[1], 10) : null;
      },
      issueIdByMemberId: (memberId) => {
        const m = memberId.match(/^issue:(\d+)$/);
        return m ? parseInt(m[1], 10) : null;
      },
    });

    // Persist canonical problems
    this.store.upsertCanonicalMany(canonicalProblems);

    // Step 4: Draft candidates via LLM
    // Gather member summaries from vector payloads
    const memberSummariesByClusterId = new Map<string, string[]>();
    for (const cluster of clusters) {
      const summaries: string[] = [];
      for (const memberId of cluster.memberIds) {
        const vec = vectors.find((v) => v.id === memberId);
        if (vec?.payload) {
          const title = (vec.payload.title as string) || "";
          const bodyPreview = (vec.payload.body as string) || "";
          summaries.push(`${title}${bodyPreview ? `\n  ${bodyPreview.slice(0, 200)}` : ""}`);
        }
      }
      memberSummariesByClusterId.set(cluster.id, summaries);
    }

    const draftResults = await this.drafter.draftBatch(
      clusters.map((c) => ({
        canonical: canonicalProblems.find((cp) => cp.clusterIds.includes(c.id))!,
        cluster: c,
        memberSummaries: memberSummariesByClusterId.get(c.id) ?? [],
      })),
    );

    // Step 5: Score candidates (duplicate detection)
    // Load existing patterns for comparison
    const existingPatterns = await this.loadExistingPatternVectors();
    const scoredResults = this.scorer.scoreBatch(
      draftResults.map((dr) => dr.input),
      existingPatterns,
    );

    // Step 6: Store candidates
    const candidates: ProblemCandidate[] = [];
    for (let i = 0; i < draftResults.length; i++) {
      const dr = draftResults[i]!;
      const scored = scoredResults[i]!;

      const input = {
        ...dr.input,
        dupOf: scored.result.dupOf,
        llmRaw: dr.llmRaw,
        qualityScore: scored.result.bestScore,
      };

      const candidate = buildCandidate(input);
      this.store.upsertCandidate(candidate);
      candidates.push(candidate);
    }

    const durationMs = Date.now() - startTime;

    const stats: MiningRunStats = {
      totalVectors: vectors.length,
      totalClusters: clusters.length,
      totalCanonicalProblems: canonicalProblems.length,
      totalCandidates: candidates.length,
      durationMs,
      threshold: this.clustererConfig.threshold,
    };

    return {
      clusters,
      canonicalProblems,
      candidates,
      stats,
    };
  }

  /**
   * Load existing problem patterns with their vectors for duplicate detection.
   * Uses the provider to fetch pattern vectors from Qdrant.
   */
  private async loadExistingPatternVectors(): Promise<Array<{ id: string; vector: Float32Array }>> {
    const patterns = await this.provider.listVectors({ entityType: "pattern" });

    return patterns.map((p) => ({
      id: (p.payload.pattern_id as string) || p.id,
      vector: p.vector,
    }));
  }
}
