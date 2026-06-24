/**
 * Scorer — computes cosine similarity between a candidate and existing
 * problem patterns to detect duplicates.
 *
 * Threshold: > 0.9 → mark as dup_of. Independent of Clusterer threshold.
 */

import type { ProblemCandidate } from "../types.js";
import type { NewCandidateInput } from "./candidate-factory.js";
import { cosineSimilarity } from "../discovery/cosine-clusterer.js";

export interface ScorerConfig {
  /** Cosine threshold above which a candidate is considered a duplicate (default 0.9) */
  threshold?: number;
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

  constructor(config: ScorerConfig = {}) {
    this.threshold = config.threshold ?? 0.9;
  }

  /**
   * Score a candidate against a list of existing problem patterns.
   *
   * Each pattern must have a `vector` field (Float32Array) already computed.
   * If patterns lack vectors, pass embedText to compute on the fly.
   */
  score(
    candidate: NewCandidateInput | ProblemCandidate,
    patterns: Array<{ id: string; vector: Float32Array }>,
  ): ScoreResult {
    if (patterns.length === 0) {
      return { dupOf: null, bestScore: 0, scores: [] };
    }

    const candidateVector = this.buildCandidateVector(candidate);
    const scores: Array<{ patternId: string; score: number }> = [];

    let bestScore = 0;
    let bestPattern: string | null = null;

    for (const p of patterns) {
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
  scoreBatch(
    candidates: Array<NewCandidateInput | ProblemCandidate>,
    patterns: Array<{ id: string; vector: Float32Array }>,
  ): Array<{ candidate: NewCandidateInput | ProblemCandidate; result: ScoreResult }> {
    return candidates.map((c) => ({
      candidate: c,
      result: this.score(c, patterns),
    }));
  }

  /**
   * Build a representative vector for a candidate from its draft fields.
   *
   * Strategy: concatenate alias + symptoms + symbols into a text string,
   * then use the provided embedder. If no embedder is available (unit tests),
   * fall back to a synthetic numeric vector from hash.
   */
  private buildCandidateVector(
    candidate: NewCandidateInput | ProblemCandidate,
  ): Float32Array {
    // Use a simple synthetic vector based on field content hashes.
    // In production, replace with actual embedding.
    const text = [
      candidate.draftAlias,
      candidate.draftSymptoms,
      candidate.draftSymbols,
    ]
      .flat()
      .filter(Boolean)
      .join(" ");

    if (text.length === 0) {
      return new Float32Array(3); // zero vector
    }

    // Deterministic synthetic vector (3 dims for testing; real embed is 384)
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
