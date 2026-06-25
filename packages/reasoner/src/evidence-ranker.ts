/**
 * Evidence Ranker
 *
 * Ranks evidence based on:
 * 1. Evidence type weight (pattern > symbol > callgraph > shader > stage > version > experience)
 * 2. Association distance (direct > indirect > inferred)
 * 3. Time decay (recent > historical)
 * 4. Source reliability
 */

import type { Evidence, RankedEvidence } from "./types.js";

// Evidence type weights
const TYPE_WEIGHTS: Record<string, number> = {
  pattern: 1.0,
  symbol: 0.8,
  callgraph: 0.7,
  shader: 0.6,
  stage: 0.5,
  version: 0.4,
  experience: 0.3,
};

// Distance decay factors
const DISTANCE_DECAY = {
  direct: 1.0,
  indirect: 0.7,
  inferred: 0.4,
};

export class EvidenceRanker {
  /**
   * Rank evidence by combined score.
   */
  rank(evidence: Evidence[], options?: {
    distance?: "direct" | "indirect" | "inferred";
    timeDecay?: "recent" | "historical";
  }): RankedEvidence[] {
    const {
      distance = "direct",
      timeDecay = "recent",
    } = options || {};

    const distanceFactor = DISTANCE_DECAY[distance];
    const timeFactor = timeDecay === "recent" ? 1.0 : 0.6;

    // Score each evidence
    const scored: Array<Evidence & { score: number; explanation: string }> = [];

    for (const e of evidence) {
      // Base score from type weight
      const typeWeight = TYPE_WEIGHTS[e.type] || 0.5;

      // Combined score
      const score = typeWeight * distanceFactor * timeFactor * e.weight;

      // Generate explanation
      const explanation = this.generateExplanation(e, score);

      scored.push({
        ...e,
        score,
        explanation,
      });
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return scored.map((s) => ({
      evidence: {
        type: s.type,
        source: s.source,
        description: s.description,
        weight: s.weight,
        metadata: s.metadata,
      },
      score: Math.round(s.score * 100) / 100,
      explanation: s.explanation,
    }));
  }

  /**
   * Generate human-readable explanation for evidence.
   */
  private generateExplanation(evidence: Evidence, score: number): string {
    const templates: Record<string, string> = {
      pattern: `匹配到已知问题模式: ${evidence.source} (置信度: ${(score * 100).toFixed(0)}%)`,
      symbol: `相关代码符号: ${evidence.source}`,
      callgraph: `调用链关联: ${evidence.description}`,
      shader: `相关 Shader: ${evidence.source}`,
      stage: `渲染阶段关联: ${evidence.source}`,
      version: `版本变更: ${evidence.source}`,
      experience: `历史经验: ${evidence.description}`,
    };

    return templates[evidence.type] || evidence.description;
  }
}
