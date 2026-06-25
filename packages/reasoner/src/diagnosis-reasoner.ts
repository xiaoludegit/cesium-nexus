/**
 * Diagnosis Reasoner
 *
 * Integrates Evidence Collector, Evidence Ranker, and Explanation Generator
 * to provide root cause diagnosis.
 */

import type {
  DiagnosisResult,
  DiagnosisOptions,
} from "./types.js";
import { EvidenceCollector } from "./evidence-collector.js";
import { EvidenceRanker } from "./evidence-ranker.js";
import { ExplanationGenerator } from "./explanation-generator.js";

export class DiagnosisReasoner {
  private evidenceCollector: EvidenceCollector;
  private evidenceRanker: EvidenceRanker;
  private explanationGenerator: ExplanationGenerator;

  constructor(evidenceCollector: EvidenceCollector) {
    this.evidenceCollector = evidenceCollector;
    this.evidenceRanker = new EvidenceRanker();
    this.explanationGenerator = new ExplanationGenerator();
  }

  /**
   * Diagnose root cause for a query.
   */
  async diagnose(query: string, options: DiagnosisOptions = {}): Promise<DiagnosisResult> {
    const { verbose = false, evidenceOnly = false, minConfidence = 0 } = options;

    // Step 1: Collect evidence
    const evidence = await this.evidenceCollector.collect(query);

    // Step 2: Rank evidence
    const rankedEvidence = this.evidenceRanker.rank(evidence, {
      distance: "direct",
      timeDecay: "recent",
    });

    // Filter by minimum confidence
    const filteredEvidence = rankedEvidence.filter((e) => e.score >= minConfidence);

    // Step 3: Generate explanation
    const explanation = this.explanationGenerator.generate(filteredEvidence);

    return {
      query,
      evidence,
      rankedEvidence: filteredEvidence,
      explanation,
      confidence: explanation.confidence,
    };
  }

  /**
   * Collect evidence only (no ranking or explanation).
   */
  async collectEvidence(query: string): Promise<any[]> {
    return this.evidenceCollector.collect(query);
  }

  /**
   * Explain a diagnosis result.
   */
  explain(result: DiagnosisResult): string {
    return [
      `Query: ${result.query}`,
      "",
      `Summary: ${result.explanation.summary}`,
      "",
      `Primary Cause: ${result.explanation.primaryCause}`,
      "",
      ...result.explanation.contributingFactors.map((f) => `- ${f}`),
      "",
      `Evidence: ${result.explanation.evidenceSummary}`,
      "",
      ...result.explanation.suggestedActions.map((a) => `- ${a}`),
      "",
      `Confidence: ${(result.explanation.confidence * 100).toFixed(0)}%`,
    ].join("\n");
  }
}
