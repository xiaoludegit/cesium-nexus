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
  diagnoseProblem,
  queryRenderStages,
} from "@cesium-nexus/diagnosis";
import * as path from "node:path";

export function registerDiagnoseCommand(program: Command): void {
  program
    .command("diagnose <problem>")
    .description("Diagnose a Cesium problem and output a Diagnostic Context Pack")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .option("--limit <n>", "Max matched patterns", "5")
    .option("--budget <n>", "Token budget", "6000")
    .action(
      async (
        problem: string,
        opts: { db: string; limit: string; budget: string },
      ) => {
        const limit = parseInt(opts.limit, 10);
        if (!Number.isInteger(limit) || limit < 1) {
          console.error("Error: --limit must be a positive integer");
          process.exit(1);
        }

        const budget = parseInt(opts.budget, 10);
        if (!Number.isInteger(budget) || budget < 1000) {
          console.error("Error: --budget must be an integer >= 1000");
          process.exit(1);
        }

        const patterns = await loadProblemPatterns();
        const stages = await loadRenderStages();

        const db = openDatabase(path.resolve(opts.db));
        initSchema(db);

        const symbolRepo = new SymbolRepo(db);
        const callGraphRepo = new CallGraphRepo(db);
        const issueRepo = new IssueRepo(db);

        const result = await diagnoseProblem({
          query: problem,
          patterns,
          stages,
          symbolRepo,
          callGraphRepo,
          issueRepo,
          limit,
          budget,
        });

        db.close();

        if (result.matchedPatterns.length === 0) {
          console.log("No matching problem patterns found.");
          return;
        }

        console.log(`\n=== Diagnosis: ${problem} ===\n`);

        console.log("Possible Causes:");
        for (const m of result.matchedPatterns) {
          console.log(`  [${m.pattern.id}] ${m.pattern.name}`);
          for (const cause of m.pattern.possibleCauses) {
            console.log(`    - ${cause}`);
          }
        }

        if (result.renderStages.length > 0) {
          console.log("\nRender Stages:");
          for (const s of result.renderStages) {
            console.log(`  ${s.order}. ${s.name} — ${s.description}`);
          }
        }

        if (result.relatedSymbols.length > 0) {
          console.log("\nRelated Symbols:");
          for (const s of result.relatedSymbols) {
            console.log(`  ${s.name} (${s.kind}) — ${s.filePath}:${s.startLine}`);
          }
        }

        if (result.relatedSource.length > 0) {
          console.log("\nRelated Source:");
          for (const s of result.relatedSource) {
            console.log(`  --- ${s.symbol} (${s.file}:${s.lineStart}-${s.lineEnd}) ---`);
            const lines = s.code.split("\n").slice(0, 10);
            for (const line of lines) {
              console.log(`    ${line}`);
            }
            if (s.code.split("\n").length > 10) {
              console.log(`    ... (${s.code.split("\n").length - 10} more lines)`);
            }
          }
        }

        if (result.relatedIssues.length > 0) {
          console.log("\nRelated Issues:");
          for (const i of result.relatedIssues) {
            console.log(`  #${i.number} [${i.state}] ${i.title}`);
            console.log(`    ${i.htmlUrl}`);
          }
        }

        if (result.investigationSteps.length > 0) {
          console.log("\nInvestigation Steps:");
          for (const step of result.investigationSteps) {
            console.log(`  ${step}`);
          }
        }

        if (result.fixSuggestions.length > 0) {
          console.log("\nPossible Fixes:");
          for (const fix of result.fixSuggestions) {
            console.log(`  ${fix}`);
          }
        }

        console.log(`\n[metadata] tokens: ${result.metadata.totalTokens}/${result.metadata.tokenBudget}, truncated: ${result.metadata.truncated}`);
      },
    );

  const pkb = program
    .command("pkb")
    .description("Problem Knowledge Base commands");

  pkb
    .command("list")
    .description("List all problem patterns")
    .action(async () => {
      const patterns = await loadProblemPatterns();
      console.log("id / category / name / aliases\n");
      for (const p of patterns) {
        console.log(`${p.id} | ${p.category} | ${p.name}`);
        console.log(`  aliases: ${p.aliases.join(", ")}`);
      }
    });

  program
    .command("stage <id>")
    .description("Query render stages by stage ID or problem pattern ID")
    .action(async (id: string) => {
      const patterns = await loadProblemPatterns();
      const stages = await loadRenderStages();

      const directMatch = stages.filter((s) => s.id === id);
      if (directMatch.length > 0) {
        for (const s of directMatch) {
          console.log(`${s.order}. ${s.name}`);
          console.log(`   ${s.description}`);
          console.log(`   key symbols: ${s.keySymbols.join(", ")}`);
          console.log(`   symptom hints: ${s.symptomHints.join(", ")}`);
        }
        return;
      }

      const related = queryRenderStages({ problemId: id, patterns, stages });
      if (related.length > 0) {
        console.log(`Render stages related to "${id}":\n`);
        for (const s of related) {
          console.log(`${s.order}. ${s.name}`);
          console.log(`   ${s.description}`);
        }
        return;
      }

      console.log(`No stage or pattern found for "${id}".`);
    });
}
