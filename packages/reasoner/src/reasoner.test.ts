/**
 * Phase 3B: Evidence Fusion Engine Tests
 *
 * Tests for:
 * - Evidence Ranker
 * - Explanation Generator
 * - Diagnosis Reasoner
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  EvidenceRanker,
  ExplanationGenerator,
  DiagnosisReasoner,
  EvidenceCollector,
} from "../src/index.js";
import type { Evidence, RankedEvidence } from "../src/index.js";

describe("Phase 3B: Evidence Fusion Engine", () => {
  describe("Evidence Ranker", () => {
    let ranker: EvidenceRanker;

    beforeEach(() => {
      ranker = new EvidenceRanker();
    });

    it("should rank evidence by type weight", () => {
      const evidence: Evidence[] = [
        {
          type: "experience",
          source: "exp-1",
          description: "Historical experience",
          weight: 0.8,
        },
        {
          type: "pattern",
          source: "pattern-1",
          description: "Problem pattern match",
          weight: 0.9,
        },
        {
          type: "shader",
          source: "shader-1",
          description: "Shader symbol",
          weight: 0.7,
        },
      ];

      const ranked = ranker.rank(evidence);

      // Pattern should be ranked highest (weight 1.0)
      expect(ranked[0].evidence.type).toBe("pattern");
      // Shader should be ranked second (weight 0.6)
      expect(ranked[1].evidence.type).toBe("shader");
      // Experience should be ranked third (weight 0.3)
      expect(ranked[2].evidence.type).toBe("experience");
    });

    it("should generate explanations for each evidence", () => {
      const evidence: Evidence[] = [
        {
          type: "pattern",
          source: "z-fighting",
          description: "Z-fighting pattern",
          weight: 0.9,
        },
      ];

      const ranked = ranker.rank(evidence);

      expect(ranked[0].explanation).toContain("问题模式");
    });

    it("should return empty array for empty input", () => {
      const ranked = ranker.rank([]);
      expect(ranked).toEqual([]);
    });

    it("should sort by score descending", () => {
      const evidence: Evidence[] = [
        {
          type: "experience",
          source: "exp-1",
          description: "Low weight",
          weight: 0.3,
        },
        {
          type: "pattern",
          source: "pattern-1",
          description: "High weight",
          weight: 1.0,
        },
        {
          type: "symbol",
          source: "symbol-1",
          description: "Medium weight",
          weight: 0.7,
        },
      ];

      const ranked = ranker.rank(evidence);

      // Scores should be in descending order
      for (let i = 1; i < ranked.length; i++) {
        expect(ranked[i].score).toBeLessThanOrEqual(ranked[i - 1].score);
      }
    });
  });

  describe("Explanation Generator", () => {
    let generator: ExplanationGenerator;

    beforeEach(() => {
      generator = new ExplanationGenerator();
    });

    it("should generate explanation from ranked evidence", () => {
      const ranked: RankedEvidence[] = [
        {
          evidence: {
            type: "pattern",
            source: "z-fighting",
            description: "Z-fighting issue",
            weight: 0.9,
          },
          score: 0.9,
          explanation: "Pattern match",
        },
        {
          evidence: {
            type: "shader",
            source: "czm_depth",
            description: "Depth shader",
            weight: 0.6,
          },
          score: 0.6,
          explanation: "Shader related",
        },
      ];

      const explanation = generator.generate(ranked);

      expect(explanation.summary).toBeDefined();
      expect(explanation.primaryCause).toBeDefined();
      expect(explanation.contributingFactors).toBeDefined();
      expect(explanation.evidenceSummary).toBeDefined();
      expect(explanation.suggestedActions).toBeDefined();
      expect(explanation.confidence).toBeGreaterThan(0);
      expect(explanation.confidence).toBeLessThanOrEqual(1);
    });

    it("should handle empty evidence", () => {
      const explanation = generator.generate([]);

      expect(explanation.summary).toBe("未找到相关证据");
      expect(explanation.confidence).toBe(0);
    });

    it("should generate contributing factors from secondary evidence", () => {
      const ranked: RankedEvidence[] = [
        {
          evidence: {
            type: "pattern",
            source: "primary",
            description: "Primary cause",
            weight: 1.0,
          },
          score: 1.0,
          explanation: "Primary",
        },
        {
          evidence: {
            type: "shader",
            source: "secondary",
            description: "Secondary cause",
            weight: 0.6,
          },
          score: 0.6,
          explanation: "Secondary",
        },
      ];

      const explanation = generator.generate(ranked);

      expect(explanation.contributingFactors.length).toBe(1);
    });
  });

  describe("Diagnosis Reasoner", () => {
    it("should be instantiable", () => {
      // Mock database
      const mockDb = {} as any;

      const collector = new EvidenceCollector(mockDb);
      const reasoner = new DiagnosisReasoner(collector);

      expect(reasoner).toBeDefined();
    });
  });
});
