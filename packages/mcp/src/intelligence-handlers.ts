/**
 * Phase 3C: Intelligence MCP Handlers
 *
 * MCP/CLI → Service → Intelligence/Reasoner
 */

import type { Database } from "@cesium-nexus/storage";
import { createServices } from "@cesium-nexus/service";
import type { Services } from "@cesium-nexus/service";
import type { ToolResponse } from "./handlers.js";

// Initialize services lazily
let services: Services | null = null;

function getServices(db: Database): Services {
  if (!services) {
    services = createServices(db);
  }
  return services;
}

// ─── search_migration ──────────────────────────────────────

export async function handleSearchMigration(
  db: Database,
  input: {
    from_version: string;
    to_version: string;
    symbol?: string;
  }
): Promise<ToolResponse> {
  try {
    const svc = getServices(db);
    const { from_version, to_version, symbol } = input;

    if (symbol) {
      const changes = await svc.migration.searchBySymbol(
        symbol,
        from_version,
        to_version
      );
      return {
        success: true,
        data: {
          query: { from: from_version, to: to_version, symbol },
          count: changes.length,
          breaking_changes: changes.map(formatBreakingChange),
        },
      };
    }

    const changes = await svc.migration.getBreakingChanges(
      from_version,
      to_version
    );

    return {
      success: true,
      data: {
        from: from_version,
        to: to_version,
        count: changes.length,
        breaking_changes: changes.map(formatBreakingChange),
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── search_shader ─────────────────────────────────────────

export async function handleSearchShader(
  db: Database,
  input: {
    query: string;
    type?: string;
    related_js_symbol?: string;
    render_stage?: string;
    file?: string;
  }
): Promise<ToolResponse> {
  try {
    const svc = getServices(db);
    const { query, type, related_js_symbol, render_stage, file } = input;

    const results = await svc.shader.search(query, {
      type,
      relatedJsSymbol: related_js_symbol,
      renderStage: render_stage,
      file,
    });

    return {
      success: true,
      data: {
        query,
        count: results.length,
        shaders: results.map(formatShaderSymbol),
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── compare_version ───────────────────────────────────────

export async function handleCompareVersion(
  db: Database,
  input: {
    from_version: string;
    to_version: string;
    symbol?: string;
    breaking_only?: boolean;
  }
): Promise<ToolResponse> {
  try {
    const svc = getServices(db);
    const { from_version, to_version, symbol, breaking_only } = input;

    const diff = await svc.version.diff(from_version, to_version, symbol);

    if (breaking_only) {
      return {
        success: true,
        data: {
          from: from_version,
          to: to_version,
          breaking_changes: diff.breakingChanges.map(formatBreakingChange),
        },
      };
    }

    return {
      success: true,
      data: {
        from: from_version,
        to: to_version,
        stats: diff.stats,
        added: diff.added.length,
        removed: diff.removed.length,
        modified: diff.modified.length,
        breaking_changes: diff.breakingChanges.map(formatBreakingChange),
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── diagnose_root_cause ───────────────────────────────────

export async function handleDiagnoseRootCause(
  db: Database,
  input: {
    query: string;
    verbose?: boolean;
    min_confidence?: number;
  }
): Promise<ToolResponse> {
  try {
    const svc = getServices(db);
    const { query, verbose, min_confidence } = input;

    const result = await svc.diagnosis.diagnose(query, {
      verbose,
      minConfidence: min_confidence,
    });

    const explanation = result.explanation;

    return {
      success: true,
      data: {
        query,
        summary: explanation.summary,
        primary_cause: explanation.primaryCause,
        contributing_factors: explanation.contributingFactors,
        evidence_summary: explanation.evidenceSummary,
        suggested_actions: explanation.suggestedActions,
        confidence: explanation.confidence,
        grade: getGrade(explanation.confidence),
        evidence_count: result.evidence.length,
        ...(verbose && {
          evidence: result.rankedEvidence.map((e) => ({
            type: e.evidence.type,
            source: e.evidence.source,
            description: e.evidence.description,
            score: e.score,
            explanation: e.explanation,
          })),
        }),
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Helper Functions ──────────────────────────────────────

function formatBreakingChange(bc: any) {
  return {
    symbol: bc.symbolName,
    change_type: bc.changeType,
    description: bc.description,
    migration_guide: bc.migrationGuide,
  };
}

function formatShaderSymbol(s: any) {
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    file: s.file,
    related_js_symbols: s.relatedJsSymbols,
    related_render_stage: s.relatedRenderStage,
  };
}

function getGrade(confidence: number): string {
  if (confidence >= 0.9) return "A";
  if (confidence >= 0.7) return "B";
  if (confidence >= 0.5) return "C";
  if (confidence >= 0.3) return "D";
  return "F";
}
