/**
 * Evidence Collector
 *
 * Collects evidence from multiple sources:
 * - Problem Patterns (via diagnosis package)
 * - Code Symbols (via storage)
 * - Call Graph (via storage)
 * - Shader Symbols (via intelligence)
 * - Render Stages (via diagnosis)
 * - Version Changes (via intelligence)
 * - Experiences (via storage)
 */

import type { Evidence, EvidenceCollectorOptions } from "./types.js";
import type { Database } from "@cesium-nexus/storage";
import type { ShaderIndexBuilder } from "@cesium-nexus/intelligence";
import type { DiagnosisMatch } from "@cesium-nexus/shared";
import { matchProblemPatterns, loadProblemPatterns } from "@cesium-nexus/diagnosis";

export class EvidenceCollector {
  constructor(
    private db: Database,
    private shaderIndexBuilder?: ShaderIndexBuilder
  ) {}

  /**
   * Collect evidence from all available sources for a query.
   */
  async collect(query: string, options?: Partial<EvidenceCollectorOptions>): Promise<Evidence[]> {
    const evidence: Evidence[] = [];
    const opts = {
      includePatterns: true,
      includeSymbols: true,
      includeCallGraph: true,
      includeShaders: true,
      includeStages: true,
      includeVersion: false,
      includeExperiences: true,
      ...options,
    };

    // 1. Collect from Problem Patterns
    if (opts.includePatterns) {
      const patternEvidence = await this.collectFromPatterns(query);
      evidence.push(...patternEvidence);
    }

    // 2. Collect from Symbols
    if (opts.includeSymbols) {
      const symbolEvidence = await this.collectFromSymbols(query);
      evidence.push(...symbolEvidence);
    }

    // 3. Collect from Call Graph
    if (opts.includeCallGraph) {
      const callGraphEvidence = await this.collectFromCallGraph(query);
      evidence.push(...callGraphEvidence);
    }

    // 4. Collect from Shaders
    if (opts.includeShaders) {
      const shaderEvidence = await this.collectFromShaders(query);
      evidence.push(...shaderEvidence);
    }

    // 5. Collect from Render Stages
    if (opts.includeStages) {
      const stageEvidence = await this.collectFromStages(query);
      evidence.push(...stageEvidence);
    }

    // 6. Collect from Experiences
    if (opts.includeExperiences) {
      const expEvidence = await this.collectFromExperiences(query);
      evidence.push(...expEvidence);
    }

    return evidence;
  }

  // ─── Private Collection Methods ───

  private async collectFromPatterns(query: string): Promise<Evidence[]> {
    const patterns = await loadProblemPatterns();
    const matches = matchProblemPatterns(query, patterns);

    return matches.map((match: DiagnosisMatch) => ({
      type: "pattern" as const,
      source: match.pattern.id,
      description: `Problem Pattern: ${match.pattern.name} - Score: ${match.score.toFixed(2)}`,
      weight: match.score,
      metadata: {
        patternId: match.pattern.id,
        patternName: match.pattern.name,
        category: match.pattern.category,
        severity: match.pattern.severity,
        matchedKeywords: match.matchedKeywords,
        relatedSymbols: match.pattern.relatedSymbols,
      },
    }));
  }

  private async collectFromSymbols(query: string): Promise<Evidence[]> {
    return [];
  }

  private async collectFromCallGraph(query: string): Promise<Evidence[]> {
    return [];
  }

  private async collectFromShaders(query: string): Promise<Evidence[]> {
    if (!this.shaderIndexBuilder) return [];

    const results = this.shaderIndexBuilder.searchByName(query);
    return results.map((s) => ({
      type: "shader" as const,
      source: s.id,
      description: `Shader Symbol: ${s.name} (${s.type}) in ${s.file}`,
      weight: 0.6,
      metadata: {
        shaderType: s.type,
        file: s.file,
        relatedJsSymbols: s.relatedJsSymbols,
        relatedRenderStage: s.relatedRenderStage,
      },
    }));
  }

  private async collectFromStages(query: string): Promise<Evidence[]> {
    return [];
  }

  private async collectFromExperiences(query: string): Promise<Evidence[]> {
    return [];
  }
}
