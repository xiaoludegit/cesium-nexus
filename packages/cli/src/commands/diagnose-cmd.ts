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
    .option("--hybrid", "Enable hybrid search (keyword + vector semantic)", false)
    .option("--qdrant-url <url>", "Qdrant server URL", "http://localhost:6333")
    .action(
      async (
        problem: string,
        opts: { db: string; limit: string; budget: string; hybrid: boolean; qdrantUrl: string },
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

        let vectorScores: Record<string, number> | undefined;
        let experienceSearchFn: ((query: string, limit: number) => Promise<{ nodeId: string; nodeType: string; title: string; url: string; score: number }[]>) | undefined;

        if (opts.hybrid) {
          try {
            const { getQdrantClient, embedText, semanticSearch, searchKnowledgeBase } = await import(
              "@cesium-nexus/vector"
            );
            const client = getQdrantClient(opts.qdrantUrl);
            const queryEmbedding = await embedText(problem);

            const patternResults = await semanticSearch(client, queryEmbedding, {
              type: "cesium-problem-pattern",
              limit: patterns.length,
            });

            if (patternResults.length > 0) {
              vectorScores = {};
              for (const r of patternResults) {
                vectorScores[r.nodeId] = r.score;
              }
            }

            experienceSearchFn = async (q: string, lim: number) => {
              const results = await searchKnowledgeBase(q, client, {
                type: "cesium-experience",
                limit: lim,
              });
              return results.map((r) => ({
                nodeId: r.nodeId,
                nodeType: r.nodeType,
                title: r.title,
                url: r.url,
                score: r.score,
              }));
            };
          } catch (err) {
            console.error("Warning: hybrid search unavailable —", err instanceof Error ? err.message : String(err));
            console.error("Falling back to keyword-only mode.\n");
          }
        }

        const result = await diagnoseProblem({
          query: problem,
          patterns,
          stages,
          symbolRepo,
          callGraphRepo,
          issueRepo,
          limit,
          budget,
          vectorScores,
          experienceSearchFn,
        });

        db.close();

        if (result.matchedPatterns.length === 0) {
          console.log("No matching problem patterns found.");
          return;
        }

        console.log(`\n=== Diagnosis: ${problem} ===\n`);

        console.log("Possible Causes:");
        for (const m of result.matchedPatterns) {
          const vecInfo = m.vectorScore != null ? ` (vector: ${m.vectorScore.toFixed(2)})` : "";
          console.log(`  [${m.pattern.id}] ${m.pattern.name} — score: ${m.score.toFixed(1)}${vecInfo}`);
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

        if (result.relatedExperiences && result.relatedExperiences.length > 0) {
          console.log("\nRelated Experiences:");
          for (const exp of result.relatedExperiences) {
            console.log(`  [${exp.nodeType}] ${exp.title} (score: ${exp.score.toFixed(2)})`);
            if (exp.url) console.log(`    ${exp.url}`);
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

  pkb
    .command("embed")
    .description("Embed problem patterns and render stages to Qdrant")
    .option("--qdrant-url <url>", "Qdrant server URL", "http://localhost:6333")
    .action(async (opts: { qdrantUrl: string }) => {
      try {
        const patterns = await loadProblemPatterns();
        const stages = await loadRenderStages();

        const { getQdrantClient, embedAllPKB } = await import(
          "@cesium-nexus/vector"
        );
        const client = getQdrantClient(opts.qdrantUrl);

        const result = await embedAllPKB(patterns, stages, client);
        console.log(
          `Embedded ${result.totalPatterns} problem patterns and ${result.totalStages} render stages to Qdrant (eng-knowledge)`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          (err as NodeJS.ErrnoException).code === "ECONNREFUSED" ||
          msg.includes("ECONNREFUSED") ||
          msg.includes("ENOTFOUND") ||
          /Qdrant/i.test(msg)
        ) {
          console.error(`Error: Qdrant unreachable — ${msg.split("\n")[0]}`);
        } else {
          console.error(
            "Error: vector embedding unavailable.\n" +
              "  Hint: ensure 'sharp' native binary is built for this platform.\n" +
              "        Add 'sharp' to pnpm.onlyBuiltDependencies, then 'pnpm install';\n" +
              "        or run 'pnpm rebuild sharp' in the repo root.\n" +
              `  Details:\n${msg
                .split("\n")
                .map((l) => "    " + l)
                .join("\n")}`,
          );
        }
        process.exitCode = 1;
      }
    });

  pkb
    .command("search <query>")
    .description("Semantic search across knowledge base (patterns, stages, experiences)")
    .option("--type <type>", "Filter by type: pattern, stage, experience")
    .option("--limit <n>", "Max results", "10")
    .option("--qdrant-url <url>", "Qdrant server URL", "http://localhost:6333")
    .action(
      async (
        query: string,
        opts: { type?: string; limit: string; qdrantUrl: string },
      ) => {
        try {
          const limit = parseInt(opts.limit, 10);

          const typeMap: Record<string, string> = {
            pattern: "cesium-problem-pattern",
            stage: "cesium-render-stage",
            experience: "cesium-experience",
          };
          const qdrantType = opts.type ? typeMap[opts.type] : undefined;

          const { getQdrantClient, searchKnowledgeBase } = await import(
            "@cesium-nexus/vector"
          );
          const client = getQdrantClient(opts.qdrantUrl);

          const results = await searchKnowledgeBase(query, client, {
            limit,
            type: qdrantType,
          });

          if (results.length === 0) {
            console.log("No results found.");
            return;
          }

          console.log(`Found ${results.length} results:\n`);
          for (const r of results) {
            console.log(`  [${r.nodeType}] ${r.title} (score: ${r.score.toFixed(3)})`);
            if (r.url) console.log(`    ${r.url}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (
            (err as NodeJS.ErrnoException).code === "ECONNREFUSED" ||
            msg.includes("ECONNREFUSED") ||
            msg.includes("ENOTFOUND") ||
            /Qdrant/i.test(msg)
          ) {
            console.error(`Error: Qdrant unreachable — ${msg.split("\n")[0]}`);
          } else {
            console.error(
              "Error: vector semantic search unavailable.\n" +
                "  Hint: ensure 'sharp' native binary is built for this platform.\n" +
                "        Add 'sharp' to pnpm.onlyBuiltDependencies, then 'pnpm install';\n" +
                "        or run 'pnpm rebuild sharp' in the repo root.\n" +
                `  Details:\n${msg
                  .split("\n")
                  .map((l) => "    " + l)
                  .join("\n")}`,
            );
          }
          process.exitCode = 1;
        }
      },
    );

  // ── pkb mine — trigger problem mining pipeline ──────────────────
  pkb
    .command("mine")
    .description(
      "Run the problem mining pipeline: cluster → canonical → draft → score → store",
    )
    .option("--since <date>", "Only mine issues updated since date (ISO 8601)", undefined)
    .option("--threshold <n>", "Cosine clustering threshold (0.85|0.90|0.95)", "0.90")
    .option("--min-cluster <n>", "Minimum cluster size", "2")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .option("--qdrant-url <url>", "Qdrant server URL", "http://localhost:6333")
    .option("--llm-backend <type>", "LLM backend: ollama | openai", "ollama")
    .option("--ollama-url <url>", "Ollama server URL", "http://localhost:11434")
    .option("--ollama-model <model>", "Ollama model name", "qwen2.5:7b")
    .action(async (opts: Record<string, string>) => {
      try {
        const { MiningStore } = await import("@cesium-nexus/mining");
        const {
          MiningPipeline,
          OllamaBackend,
          Scorer,
          QdrantEmbeddingProvider,
        } = await import("@cesium-nexus/mining");

        const Database = (await import("better-sqlite3")).default;
        const db = new Database(path.resolve(opts.db || "./database/cesium.db"));

        const store = new MiningStore(db);

        // Initialize mining schema
        db.exec(`
          CREATE TABLE IF NOT EXISTS canonical_problem (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, aliases TEXT NOT NULL,
            representative_issue_id INTEGER, cluster_ids TEXT NOT NULL,
            experience_ids TEXT NOT NULL, confidence REAL NOT NULL,
            status TEXT DEFAULT 'candidate', created_at INTEGER NOT NULL,
            reviewed_at INTEGER
          );
          CREATE TABLE IF NOT EXISTS problem_candidate (
            id TEXT PRIMARY KEY, canonical_id TEXT NOT NULL, cluster_id TEXT NOT NULL,
            draft_alias TEXT NOT NULL, draft_symptoms TEXT NOT NULL,
            draft_symbols TEXT NOT NULL, draft_category TEXT, llm_raw TEXT,
            quality_score REAL, dup_of TEXT, status TEXT DEFAULT 'pending',
            reviewed_at INTEGER, created_at INTEGER NOT NULL,
            source_count INTEGER NOT NULL DEFAULT 0, issue_count INTEGER NOT NULL DEFAULT 0,
            forum_count INTEGER NOT NULL DEFAULT 0, experience_count INTEGER NOT NULL DEFAULT 0
          );
        `);

        // Setup LLM backend
        const llmBackend = new OllamaBackend({
          url: opts.ollamaUrl || "http://localhost:11434",
          model: opts.ollamaModel || "qwen2.5:7b",
        });

        // Setup embedding provider
        const provider = new QdrantEmbeddingProvider({
          url: opts.qdrantUrl || "http://localhost:6333",
        });

        // Setup components
        const drafter = new (await import("@cesium-nexus/mining")).Drafter({
          llm: llmBackend,
        });
        const scorer = new Scorer({ threshold: parseFloat(opts.threshold || "0.90") });

        // Run pipeline
        const pipeline = new MiningPipeline({
          provider,
          clustererConfig: {
            threshold: parseFloat(opts.threshold || "0.90"),
            minClusterSize: parseInt(opts.minCluster || "2", 10),
            maxClusterSize: 50,
          },
          drafter,
          scorer,
          store,
          db,
          vectorScope: opts.since
            ? { entityType: "issue", since: new Date(opts.since).getTime() }
            : { entityType: "issue" },
        });

        const result = await pipeline.run();

        console.log(`Mining complete:`);
        console.log(`  Vectors:    ${result.stats.totalVectors}`);
        console.log(`  Clusters:   ${result.stats.totalClusters}`);
        console.log(`  Canonical:  ${result.stats.totalCanonicalProblems}`);
        console.log(`  Candidates: ${result.stats.totalCandidates}`);
        console.log(`  Duration:   ${result.stats.durationMs}ms`);
        console.log(`  Threshold:  ${result.stats.threshold}`);

        // Show candidates
        const candidates = store.listCandidates();
        if (candidates.length > 0) {
          console.log(`\nCandidates:`);
          for (const c of candidates) {
            const dupInfo = c.dupOf ? ` (dup_of: ${c.dupOf})` : "";
            console.log(`  ${c.id}${dupInfo}`);
            console.log(`    aliases: ${(c.draftAlias || []).slice(0, 3).join(", ")}`);
            console.log(`    category: ${c.draftCategory || "N/A"}`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || /Qdrant/i.test(msg)) {
          console.error(`Error: Qdrant unreachable — ${msg.split("\n")[0]}`);
          console.error("  Hint: start Qdrant with `docker run -d -p 6333:6333 qdrant/qdrant`");
        } else if (msg.includes("ollama") || msg.includes("11434")) {
          console.error(`Error: Ollama unreachable — ${msg.split("\n")[0]}`);
          console.error("  Hint: start Ollama with `ollama serve`");
        } else {
          console.error(`Error: ${msg}`);
        }
        process.exitCode = 1;
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
