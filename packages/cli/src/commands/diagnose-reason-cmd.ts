/**
 * Diagnose Reason Command
 *
 * Extends the existing diagnose command with --reason option
 * to use Evidence Fusion Engine for root cause diagnosis.
 */

import type { Command } from "commander";
import {
  openDatabase,
  initSchema,
  SymbolRepo,
  IssueRepo,
  CallGraphRepo,
} from "@cesium-nexus/storage";
import {
  loadProblemPatterns,
  loadRenderStages,
} from "@cesium-nexus/diagnosis";
import { EvidenceCollector, DiagnosisReasoner } from "@cesium-nexus/reasoner";
import * as path from "node:path";

export function registerDiagnoseReasonCommand(program: Command): void {
  program
    .command("diagnose-reason")
    .description("Diagnose root cause using Evidence Fusion Engine")
    .argument("<query>", "Problem description")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .option("--verbose", "Show detailed evidence", false)
    .option("--evidence-only", "Show only evidence chain", false)
    .option("--min-confidence <n>", "Minimum confidence threshold", "0.3")
    .option("--cesium-root <path>", "Path to Cesium source", "./data/cesium")
    .action(
      async (
        query: string,
        opts: {
          db: string;
          verbose: boolean;
          evidenceOnly: boolean;
          minConfidence: string;
          cesiumRoot: string;
        }
      ) => {
        const dbPath = path.resolve(opts.db);
        const db = openDatabase(dbPath);
        initSchema(db);

        const minConfidence = parseFloat(opts.minConfidence);

        // Create evidence collector
        const collector = new EvidenceCollector(db);

        // Create diagnosis reasoner
        const reasoner = new DiagnosisReasoner(collector);

        console.log(`\nDiagnosing: "${query}"\n`);

        const result = await reasoner.diagnose(query, {
          verbose: opts.verbose,
          evidenceOnly: opts.evidenceOnly,
          minConfidence,
        });

        // Output based on mode
        if (opts.evidenceOnly) {
          outputEvidenceOnly(result);
        } else if (opts.verbose) {
          outputVerbose(result);
        } else {
          outputDefault(result);
        }

        db.close();
      }
    );
}

function outputDefault(result: any): void {
  const { explanation } = result;

  console.log("PONYTAIL REPORT");
  console.log("─".repeat(50));
  console.log(`Score: ${(explanation.confidence * 100).toFixed(0)}%`);
  console.log(`Grade: ${getGrade(explanation.confidence)}`);
  console.log();
  console.log(`Summary: ${explanation.summary}`);
  console.log();
  console.log(`Primary Cause: ${explanation.primaryCause}`);
  console.log();

  if (explanation.contributingFactors.length > 0) {
    console.log("Contributing Factors:");
    for (const factor of explanation.contributingFactors) {
      console.log(`  - ${factor}`);
    }
    console.log();
  }

  console.log(`Evidence: ${explanation.evidenceSummary}`);
  console.log();

  console.log("Suggested Actions:");
  for (const action of explanation.suggestedActions) {
    console.log(`  - ${action}`);
  }
}

function outputVerbose(result: any): void {
  outputDefault(result);

  console.log("\n" + "═".repeat(50));
  console.log("DETAILED EVIDENCE");
  console.log("═".repeat(50));

  for (const ranked of result.rankedEvidence) {
    console.log(`\n[${ranked.evidence.type.toUpperCase()}] ${ranked.evidence.source}`);
    console.log(`  Score: ${ranked.score.toFixed(2)}`);
    console.log(`  Description: ${ranked.evidence.description}`);
    console.log(`  Explanation: ${ranked.explanation}`);

    if (ranked.evidence.metadata) {
      console.log(`  Metadata: ${JSON.stringify(ranked.evidence.metadata, null, 2)}`);
    }
  }
}

function outputEvidenceOnly(result: any): void {
  console.log("EVIDENCE CHAIN");
  console.log("═".repeat(50));

  for (const ranked of result.rankedEvidence) {
    console.log(`[${ranked.evidence.type}] ${ranked.evidence.source} (score: ${ranked.score.toFixed(2)})`);
  }
}

function getGrade(confidence: number): string {
  if (confidence >= 0.9) return "A";
  if (confidence >= 0.7) return "B";
  if (confidence >= 0.5) return "C";
  if (confidence >= 0.3) return "D";
  return "F";
}
