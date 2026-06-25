/**
 * Explanation Generator
 *
 * Generates human-readable explanations from ranked evidence.
 * Uses template-based generation for consistency.
 */

import type { RankedEvidence, DiagnosisExplanation } from "./types.js";

// Explanation templates
const TEMPLATES = {
  pattern: {
    primary: "匹配到已知问题模式: {name}",
    contributing: "问题模式: {name} - {description}",
    summary: "根据问题模式 {name} 的分析",
  },
  symbol: {
    primary: "相关代码符号: {name}",
    contributing: "符号: {name} ({kind})",
    summary: "涉及符号 {name}",
  },
  callgraph: {
    primary: "调用链: {path}",
    contributing: "调用链: {path}",
    summary: "通过调用链 {path} 关联",
  },
  shader: {
    primary: "相关 Shader: {name}",
    contributing: "Shader: {name} ({type})",
    summary: "涉及 Shader {name}",
  },
  stage: {
    primary: "渲染阶段: {name}",
    contributing: "渲染阶段: {name}",
    summary: "在渲染阶段 {name} 中",
  },
  version: {
    primary: "版本变更: {from} → {to}",
    contributing: "版本变更: {change}",
    summary: "涉及版本变更 {from} → {to}",
  },
  experience: {
    primary: "历史经验: {summary}",
    contributing: "历史经验: {summary}",
    summary: "基于历史经验: {summary}",
  },
};

export class ExplanationGenerator {
  /**
   * Generate diagnosis explanation from ranked evidence.
   */
  generate(rankedEvidence: RankedEvidence[]): DiagnosisExplanation {
    if (rankedEvidence.length === 0) {
      return {
        summary: "未找到相关证据",
        primaryCause: "无",
        contributingFactors: [],
        evidenceSummary: "无证据",
        suggestedActions: ["请提供更多详细信息"],
        confidence: 0,
      };
    }

    // Primary cause is the highest-ranked evidence
    const primary = rankedEvidence[0];
    const contributing = rankedEvidence.slice(1, 4);

    // Generate summary
    const summary = this.generateSummary(primary);

    // Generate primary cause
    const primaryCause = this.generatePrimaryCause(primary);

    // Generate contributing factors
    const contributingFactors = contributing.map((e) =>
      this.generateContributingFactor(e)
    );

    // Generate evidence summary
    const evidenceSummary = this.generateEvidenceSummary(rankedEvidence);

    // Generate suggested actions
    const suggestedActions = this.generateSuggestedActions(primary, contributing);

    // Calculate overall confidence
    const confidence = this.calculateConfidence(rankedEvidence);

    return {
      summary,
      primaryCause,
      contributingFactors,
      evidenceSummary,
      suggestedActions,
      confidence,
    };
  }

  private generateSummary(primary: RankedEvidence): string {
    const template = TEMPLATES[primary.evidence.type];
    if (!template) return primary.evidence.description;

    return template.summary.replace("{name}", primary.evidence.source);
  }

  private generatePrimaryCause(primary: RankedEvidence): string {
    const template = TEMPLATES[primary.evidence.type];
    if (!template) return primary.evidence.description;

    return template.primary.replace("{name}", primary.evidence.source);
  }

  private generateContributingFactor(evidence: RankedEvidence): string {
    const template = TEMPLATES[evidence.evidence.type];
    if (!template) return evidence.evidence.description;

    return template.contributing
      .replace("{name}", evidence.evidence.source)
      .replace("{description}", evidence.evidence.description)
      .replace("{type}", evidence.evidence.metadata?.type as string || "")
      .replace("{kind}", evidence.evidence.metadata?.kind as string || "");
  }

  private generateEvidenceSummary(evidence: RankedEvidence[]): string {
    const types = new Set(evidence.map((e) => e.evidence.type));
    const typeNames = Array.from(types).join(", ");
    return `共 ${evidence.length} 条证据 (${typeNames})`;
  }

  private generateSuggestedActions(
    primary: RankedEvidence,
    contributing: RankedEvidence[]
  ): string[] {
    const actions: string[] = [];

    // Primary cause actions
    switch (primary.evidence.type) {
      case "pattern":
        actions.push(`检查问题模式 "${primary.evidence.source}" 的解决方案`);
        actions.push("验证相关符号的配置");
        break;
      case "shader":
        actions.push(`检查 Shader "${primary.evidence.source}" 的编译状态`);
        actions.push("验证 GLSL 版本兼容性");
        break;
      case "version":
        actions.push("检查版本变更文档");
        actions.push("验证 Breaking Changes 的影响");
        break;
      default:
        actions.push("查看更多相关证据");
    }

    // Contributing factor actions
    for (const e of contributing.slice(0, 2)) {
      actions.push(`参考: ${e.explanation}`);
    }

    return actions;
  }

  private calculateConfidence(evidence: RankedEvidence[]): number {
    if (evidence.length === 0) return 0;

    // Primary confidence weighted by score
    const primaryScore = evidence[0].score;

    // Bonus for multiple evidence types
    const types = new Set(evidence.map((e) => e.evidence.type));
    const diversityBonus = Math.min(types.size * 0.05, 0.2);

    // Confidence capped at 1.0
    return Math.min(primaryScore + diversityBonus, 1.0);
  }
}
