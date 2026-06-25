/**
 * Diagnosis Service Implementation
 *
 * Provides diagnosis operations through Evidence Fusion Engine.
 */

import type {
  DiagnosisReasoner,
  DiagnosisResult,
  DiagnosisOptions,
} from "@cesium-nexus/reasoner";
import type { DiagnosisService } from "./types.js";

export class DiagnosisServiceImpl implements DiagnosisService {
  constructor(private diagnosisReasoner: DiagnosisReasoner) {}

  async diagnose(query: string, options?: DiagnosisOptions): Promise<DiagnosisResult> {
    return this.diagnosisReasoner.diagnose(query, options);
  }

  async collectEvidence(query: string): Promise<any[]> {
    return this.diagnosisReasoner.collectEvidence(query);
  }

  async explain(result: DiagnosisResult): Promise<string> {
    return this.diagnosisReasoner.explain(result);
  }
}
