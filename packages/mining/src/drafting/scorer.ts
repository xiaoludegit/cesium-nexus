/**
 * Scorer — computes cosine similarity between a candidate and existing
 * problem patterns to detect duplicates.
 *
 * Threshold: > 0.9 → mark as dup_of. Independent of Clusterer threshold.
 *
 * Candidate vectors are built via an injected `textEmbedder` (real 384-dim
 * embeddings from @cesium-nexus/vector). If no embedder is supplied, falls
 * back to a deterministic 3-dim synthetic vector — only for unit tests.
 */

import type { ProblemCandidate } from "../types.js";
import type { NewCandidateInput } from "./candidate-factory.js";
import { cosineSimilarity } from "../discovery/cosine-clusterer.js";

export type TextEmbedder = (text: string) => Promise<Float32Array>;

export interface ScorerConfig {
  /** Cosine threshold above which a candidate is considered a duplicate (default 0.9) */
  threshold?: number;
  /**
   * Real embedding function (e.g. `provider.embedText`). If provided, the
   * candidate's alias+symptoms+symbols text is embedded into the same vector
   * space as existing patterns so cosine dedup is meaningful.
   *
   * If omitted, Scorer falls back to a deterministic 3-dim synthetic vector
   * — suitable only for unit tests that pass 3-dim pattern vectors.
   */
  textEmbedder?: TextEmbedder;
}

export interface ScoreResult {
  /** Best-matching existing pattern id, or null if below threshold */
  dupOf: string | null;
  /** Cosine similarity to the best-matching pattern */
  bestScore: number;
  /** All pattern scores for audit */
  scores: Array<{ patternId: string; score: number }>;
}

export class Scorer {
  private readonly threshold: number;
  private readonly textEmbedder?: TextEmbedder;

  constructor(config: ScorerConfig = {}) {
    this.threshold = config.threshold ?? 0.9;
    this.textEmbedder = config.textEmbedder;
  }

  /**
   * Score a candidate against a list of existing problem patterns.
   *
   * Each pattern must have a `vector` field (Float32Array) already computed
   * in the same embedding space as the candidate.
   */
  async score(
    candidate: NewCandidateInput | ProblemCandidate,
    patterns: Array<{ id: string; vector: Float32Array }>,
  ): Promise<ScoreResult> {
    if (patterns.length === 0) {
      return { dupOf: null, bestScore: 0, scores: [] };
    }

    const candidateVector = await this.buildCandidateVector(candidate);
    const scores: Array<{ patternId: string; score: number }> = [];

    let bestScore = 0;
    let bestPattern: string | null = null;

    for (const p of patterns) {
      if (p.vector.length !== candidateVector.length) {
        // Dimension mismatch — skip rather than produce a garbage cosine.
        continue;
      }
      const sim = cosineSimilarity(candidateVector, p.vector);
      scores.push({ patternId: p.id, score: sim });
      if (sim > bestScore) {
        bestScore = sim;
        bestPattern = p.id;
      }
    }

    return {
      dupOf: bestScore > this.threshold ? bestPattern : null,
      bestScore,
      scores,
    };
  }

  /**
   * Score a batch of candidates. Returns scored candidates with dupOf filled.
   */
  async scoreBatch(
    candidates: Array<NewCandidateInput | ProblemCandidate>,
    patterns: Array<{ id: string; vector: Float32Array }>,
  ): Promise<Array<{ candidate: NewCandidateInput | ProblemCandidate; result: ScoreResult }>> {
    const results: Array<{ candidate: NewCandidateInput | ProblemCandidate; result: ScoreResult }> = [];
    for (const c of candidates) {
      results.push({ candidate: c, result: await this.score(c, patterns) });
    }
    return results;
  }

  /**
   * Build a representative vector for a candidate from its draft fields.
   *
   * With a real `textEmbedder`: concatenates alias+symptoms+symbols into a
   * text string and embeds it (384 dims, same space as patterns).
   *
   * Without an embedder (unit tests only): falls back to a deterministic
   * synthetic 3-dim vector based on character codes.
   */
  private async buildCandidateVector(
    candidate: NewCandidateInput | ProblemCandidate,
  ): Promise<Float32Array> {
    const text = [
      candidate.draftAlias,
      candidate.draftSymptoms,
      candidate.draftSymbols,
    ]
      .flat()
      .filter(Boolean)
      .join(" ");

    if (this.textEmbedder && text.length > 0) {
      return await this.textEmbedder(text);
    }

    if (text.length === 0) {
      return new Float32Array(3); // zero vector
    }

    // Deterministic synthetic vector (3 dims, test only)
    const dims = 3;
    const vec = new Float32Array(dims);
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      vec[charCode % dims] += charCode;
    }

    // Normalize
    let norm = 0;
    for (let i = 0; i < dims; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < dims; i++) vec[i] /= norm;

    return vec;
  }
}
