/**
 * Phase 3B: Evidence Fusion Engine Types
 */

// Evidence types collected from multiple sources
export type EvidenceType =
  | "pattern"
  | "symbol"
  | "callgraph"
  | "shader"
  | "stage"
  | "version"
  | "experience";

export interface Evidence {
  type: EvidenceType;
  source: string; // ID of the source entity
  description: string;
  weight: number; // 0..1, base weight for ranking
  metadata?: Record<string, unknown>;
}

// Ranked evidence after scoring
export interface RankedEvidence {
  evidence: Evidence;
  score: number; // Combined score after ranking
  explanation: string; // Why this evidence matters
}

// Diagnosis explanation output
export interface DiagnosisExplanation {
  summary: string; // One-line summary
  primaryCause: string; // Main root cause
  contributingFactors: string[]; // Secondary causes
  evidenceSummary: string; // Evidence chain description
  suggestedActions: string[]; // Recommended actions
  confidence: number; // 0..1 overall confidence
}

// Full diagnosis result
export interface DiagnosisResult {
  query: string;
  evidence: Evidence[];
  rankedEvidence: RankedEvidence[];
  explanation: DiagnosisExplanation;
  confidence: number; // 0..1 overall confidence
}

// Evidence collector options
export interface EvidenceCollectorOptions {
  query: string;
  includePatterns?: boolean;
  includeSymbols?: boolean;
  includeCallGraph?: boolean;
  includeShaders?: boolean;
  includeStages?: boolean;
  includeVersion?: boolean;
  includeExperiences?: boolean;
}

// Diagnosis options
export interface DiagnosisOptions {
  verbose?: boolean;
  evidenceOnly?: boolean;
  minConfidence?: number;
}
