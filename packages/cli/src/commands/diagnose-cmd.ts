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
import { resolveDbPath } from "../config.js";

export function registerDiagnoseCommand(program: Command): void {
  program
    .command("diagnose <problem>")
    .description("Diagnose a Cesium problem and output a Diagnostic Context Pack")
    .option("--db <path>", "SQLite database path")
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

        const db = openDatabase(resolveDbPath(opts.db));
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
    .command("embed:issues")
    .description("Embed GitHub issues from SQLite to Qdrant (for mining)")
    .option("--db <path>", "SQLite database path")
    .option("--repo <slug>", "Issue repo slug (owner/repo)", "CesiumGS/cesium")
    .option("--since <iso>", "Only embed issues updated since ISO date")
    .option("--limit <n>", "Cap on number of issues embedded", (v: string) => parseInt(v, 10))
    .option("--qdrant-url <url>", "Qdrant server URL", "http://localhost:6333")
    .action(
      async (opts: {
        db: string;
        repo: string;
        since?: string;
        limit?: number;
        qdrantUrl: string;
      }) => {
        if (opts.since && isNaN(Date.parse(opts.since))) {
          console.error(`Invalid --since value: ${opts.since}`);
          process.exit(1);
        }
        const resolvedDb = resolveDbPath(opts.db);
        console.log(`Database: ${resolvedDb}`);
        console.log(`Repo:     ${opts.repo}`);
        if (opts.since) console.log(`Since:    ${opts.since}`);
        if (opts.limit) console.log(`Limit:    ${opts.limit}`);
        console.log(`Qdrant:   ${opts.qdrantUrl}\n`);

        try {
          const db = openDatabase(resolvedDb);
          initSchema(db);
          const issueRepo = new IssueRepo(db);
          const issues = issueRepo.listRecent(opts.repo, {
            since: opts.since,
            limit: opts.limit,
          });
          db.close();

          if (issues.length === 0) {
            console.log("No issues found. Run `cesium sync:issues --since <iso>` first.");
            return;
          }

          const { getQdrantClient, embedIssues } = await import(
            "@cesium-nexus/vector"
          );
          const client = getQdrantClient(opts.qdrantUrl);

          const result = await embedIssues(issues, client);
          console.log(
            `\nEmbedded ${result.embedded} / ${result.totalIssues} issues to Qdrant (cesium-issue); skipped ${result.skipped}`,
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
            console.error(`Error: ${msg}`);
          }
          process.exitCode = 1;
        }
      },
    );

  pkb
    .command("coverage")
    .description(
      "Measure Problem Coverage: run Hybrid Matcher over a set of issues and report hit rate",
    )
    .option("--db <path>", "SQLite database path")
    .option("--repo <slug>", "Issue repo slug (owner/repo)", "CesiumGS/cesium")
    .option("--since <iso>", "Only consider issues updated since ISO date")
    .option("--limit <n>", "Max issues to evaluate", "500", (v: string) => parseInt(v, 10))
    .option("--threshold <n>", "Minimum match score to count as a hit", "5", (v: string) =>
      parseInt(v, 10),
    )
    .option("--output <path>", "Write detailed JSON report to this path")
    .option("--label <name>", "Label this measurement (e.g. phase2d-baseline, phase2e-result)")
    .action(
      async (opts: {
        db: string;
        repo: string;
        since?: string;
        limit: number;
        threshold: number;
        output?: string;
        label?: string;
      }) => {
        if (opts.since && isNaN(Date.parse(opts.since))) {
          console.error(`Invalid --since value: ${opts.since}`);
          process.exit(1);
        }
        const resolvedDb = resolveDbPath(opts.db);
        console.log(`Database: ${resolvedDb}`);
        console.log(`Repo:     ${opts.repo}`);
        if (opts.since) console.log(`Since:    ${opts.since}`);
        console.log(`Limit:    ${opts.limit}`);
        console.log(`Threshold: score >= ${opts.threshold}`);
        if (opts.label) console.log(`Label:    ${opts.label}`);
        console.log("");

        const db = openDatabase(resolvedDb);
        initSchema(db);
        const issueRepo = new IssueRepo(db);
        const issues = issueRepo.listRecent(opts.repo, {
          since: opts.since,
          limit: opts.limit,
        });
        db.close();

        if (issues.length === 0) {
          console.log("No issues found. Run `cesium sync:issues --since <iso>` first.");
          return;
        }

        const patterns = await loadProblemPatterns();
        const { matchProblemPatterns } = await import("@cesium-nexus/diagnosis");

        const hits: {
          issue: number;
          title: string;
          url: string;
          matched: { id: string; name: string; score: number }[];
        }[] = [];
        const hitPatternCounts = new Map<string, number>();
        let hitIssues = 0;

        for (const issue of issues) {
          const query = `${issue.title}\n${issue.body ?? ""}`.slice(0, 4000);
          const matches = matchProblemPatterns(query, patterns);
          const qualified = matches
            .filter((m) => m.score >= opts.threshold)
            .slice(0, 3)
            .map((m) => ({
              id: m.pattern.id,
              name: m.pattern.name,
              score: Number(m.score.toFixed(2)),
            }));

          if (qualified.length > 0) {
            hitIssues++;
            hits.push({
              issue: issue.number,
              title: issue.title,
              url: issue.htmlUrl,
              matched: qualified,
            });
            for (const m of qualified) {
              hitPatternCounts.set(m.id, (hitPatternCounts.get(m.id) ?? 0) + 1);
            }
          }
        }

        const coverage = hitIssues / issues.length;
        const uniquePatternsHit = hitPatternCounts.size;

        console.log("=== Coverage Report ===");
        console.log(`Evaluated issues: ${issues.length}`);
        console.log(`Hit issues:       ${hitIssues}`);
        console.log(`Coverage:         ${(coverage * 100).toFixed(2)}%`);
        console.log(`Unique patterns hit: ${uniquePatternsHit} / ${patterns.length}`);
        console.log("");
        console.log("Top-10 patterns by hit count:");
        const top = [...hitPatternCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);
        for (const [id, count] of top) {
          console.log(`  ${id}: ${count} issues`);
        }

        if (opts.output) {
          const { writeFile } = await import("node:fs/promises");
          const report = {
            label: opts.label ?? "coverage",
            timestamp: new Date().toISOString(),
            repo: opts.repo,
            since: opts.since ?? null,
            evaluated: issues.length,
            hitIssues,
            coverage,
            uniquePatternsHit,
            totalPatterns: patterns.length,
            threshold: opts.threshold,
            patternHits: Object.fromEntries(hitPatternCounts),
            hits,
          };
          await writeFile(opts.output, JSON.stringify(report, null, 2));
          console.log(`\nReport written to ${opts.output}`);
        }
      },
    );

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
    .option("--db <path>", "SQLite database path")
    .option("--qdrant-url <url>", "Qdrant server URL", "http://localhost:6333")
    .option("--llm-backend <type>", "LLM backend: ollama | openai", "ollama")
    .option("--ollama-url <url>", "Ollama server URL", "http://localhost:11434")
    .option("--ollama-model <model>", "Ollama model name", "qwen2.5:7b")
    .option("--openai-base-url <url>", "OpenAI-compatible base URL (when --llm-backend openai)", "http://localhost:8080")
    .option("--openai-api-key <key>", "OpenAI-compatible API key (optional)", undefined)
    .option("--openai-model <model>", "OpenAI-compatible model name", "gpt-4o-mini")
    .option("--intent-filter <type>", "Only mine issues with this intent: bug|feature_request|enhancement|refactor|unknown", "bug")
    .option("--classifier <type>", "Intent classifier: rule|llm|hybrid", "rule")
    .action(async (opts: Record<string, string>) => {
      try {
        const {
          MiningStore,
          MiningPipeline,
          OllamaBackend,
          OpenAICompatibleBackend,
          Scorer,
          Drafter,
          QdrantEmbeddingProvider,
          RuleBasedClassifier,
          LLMClassifier,
        } = await import("@cesium-nexus/mining");
        const { getQdrantClient } = await import("@cesium-nexus/vector");

        const Database = (await import("better-sqlite3")).default;
        const db = new Database(resolveDbPath(opts.db));
        const store = new MiningStore(db); // creates tables if missing

        // Validate --since
        let sinceMs: number | undefined;
        if (opts.since) {
          sinceMs = new Date(opts.since).getTime();
          if (Number.isNaN(sinceMs)) {
            console.error(`Error: --since "${opts.since}" is not a valid ISO 8601 date`);
            process.exitCode = 1;
            return;
          }
        }

        // Validate --intent-filter
        const validIntents = ["bug", "feature_request", "enhancement", "refactor", "unknown"];
        const intentFilter = opts.intentFilter || "bug";
        if (!validIntents.includes(intentFilter)) {
          console.error(`Error: --intent-filter must be one of: ${validIntents.join(", ")}`);
          process.exitCode = 1;
          return;
        }

        // Setup LLM backend
        const backendType = (opts.llmBackend || "ollama").toLowerCase();
        const llmBackend =
          backendType === "openai"
            ? new OpenAICompatibleBackend({
                baseUrl: opts.openaiBaseUrl || "http://localhost:8080",
                apiKey: opts.openaiApiKey,
                model: opts.openaiModel || "gpt-4o-mini",
                headers: (opts.openaiBaseUrl || "").includes("openrouter.ai")
                  ? {
                      "HTTP-Referer": "https://cesium-nexus.local",
                      "X-Title": "cesium-nexus",
                    }
                  : undefined,
              })
            : new OllamaBackend({
                url: opts.ollamaUrl || "http://localhost:11434",
                model: opts.ollamaModel || "qwen2.5:7b",
              });

        // Setup embedding provider (uses Qdrant client from @cesium-nexus/vector)
        const qdrantClient = getQdrantClient(opts.qdrantUrl || "http://localhost:6333");
        const provider = new QdrantEmbeddingProvider({ client: qdrantClient });

        // Setup intent classifier
        const classifierType = (opts.classifier || "rule").toLowerCase();
        let classifier;
        if (classifierType === "llm") {
          classifier = new LLMClassifier({ llm: llmBackend });
        } else if (classifierType === "hybrid") {
          // hybrid: rule-based first, LLM fallback for low confidence
          const ruleClassifier = new RuleBasedClassifier();
          const llmClassifier = new LLMClassifier({ llm: llmBackend, fallbackThreshold: 0.6 });
          classifier = {
            classify: (issue: any) => ruleClassifier.classify(issue),
            classifyBatch: (issues: any[]) => {
              const ruleResults = ruleClassifier.classifyBatch(issues);
              // For now, just use rule-based; async LLM fallback requires different API
              return ruleResults;
            },
          };
        } else {
          classifier = new RuleBasedClassifier();
        }

        // Setup components
        const drafter = new Drafter({ llm: llmBackend });
        const scorer = new Scorer({
          threshold: parseFloat(opts.threshold || "0.90"),
          textEmbedder: (text: string) => provider.embedText(text),
        });

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
          vectorScope: sinceMs != null
            ? { entityType: "issue", since: sinceMs }
            : { entityType: "issue" },
          classifier,
          intentFilter: intentFilter as any,
        });

        const result = await pipeline.run();

        console.log(`Mining complete:`);
        console.log(`  Vectors:    ${result.stats.totalVectors}`);
        console.log(`  Clusters:   ${result.stats.totalClusters}`);
        console.log(`  Canonical:  ${result.stats.totalCanonicalProblems}`);
        console.log(`  Candidates: ${result.stats.totalCandidates}`);
        console.log(`  Duration:   ${result.stats.durationMs}ms`);
        console.log(`  Threshold:  ${result.stats.threshold}`);
        console.log(`  Classified: ${result.stats.totalClassified}`);
        console.log(`  Filtered:   ${result.stats.filteredByIntent} (non-${intentFilter})`);

        // Show candidates
        const candidates = store.listCandidates();
        if (candidates.length > 0) {
          console.log(`\nCandidates:`);
          for (const c of candidates) {
            const dupInfo = c.dupOf ? ` (dup_of: ${c.dupOf})` : "";
            const failInfo = c.failedDraft ? " [DRAFT FAILED]" : "";
            console.log(`  ${c.id}${dupInfo}${failInfo}`);
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

  // ── pkb review — list pending candidates for human review ─────────
  pkb
    .command("review")
    .description("List pending problem candidates for review")
    .option("--status <status>", "Filter by status: pending | approved | rejected", "pending")
    .option("--limit <n>", "Max candidates to display", "20")
    .option("--offset <n>", "Offset for pagination", "0")
    .option("--detail <id>", "Show full detail for a specific candidate", undefined)
    .option("--db <path>", "SQLite database path")
    .action(async (opts: Record<string, string>) => {
      try {
        const { MiningStore } = await import("@cesium-nexus/mining");
        const Database = (await import("better-sqlite3")).default;
        const db = new Database(resolveDbPath(opts.db));
        const store = new MiningStore(db);

        if (opts.detail) {
          const c = store.getCandidate(opts.detail);
          if (!c) {
            console.log(`Candidate "${opts.detail}" not found.`);
            return;
          }
          const canonical = store.getCanonical(c.canonicalId);
          printCandidateDetail(c, canonical);
          return;
        }

        const status = (opts.status || "pending") as "pending" | "approved" | "rejected";
        const limit = parseInt(opts.limit || "20", 10);
        const offset = parseInt(opts.offset || "0", 10);
        if (!Number.isInteger(limit) || limit < 1) {
          console.error("Error: --limit must be a positive integer");
          process.exitCode = 1;
          return;
        }

        const total = store.countCandidates(status);
        const candidates = store.listCandidatesByStatus(status, limit, offset);

        if (candidates.length === 0) {
          console.log(`No candidates with status "${status}" (total=${total}).`);
          return;
        }

        console.log(
          `Candidates [${status}]  showing ${offset + 1}..${offset + candidates.length} of ${total}\n`,
        );
        for (const c of candidates) {
          const canonical = store.getCanonical(c.canonicalId);
          const dupTag = c.dupOf ? ` dup_of=${c.dupOf}` : "";
          const failTag = c.failedDraft ? " [DRAFT FAILED]" : "";
          const srcTag = `src=${c.sourceCount}(i=${c.issueCount}/f=${c.forumCount}/e=${c.experienceCount})`;
          console.log(
            `  ${c.id}  (${c.draftCategory || "?"})${dupTag}${failTag}`,
          );
          console.log(`    canonical : ${canonical?.title || "(untitled)"}  [${c.canonicalId}]`);
          console.log(`    aliases   : ${c.draftAlias.slice(0, 6).join(", ")}`);
          console.log(`    symptoms  : ${c.draftSymptoms.length}  symbols: ${c.draftSymbols.length}  ${srcTag}`);
          if (c.dupOf) console.log(`    hint      : likely duplicate of "${c.dupOf}"`);
          console.log();
        }
        console.log(
          `Next: cesium pkb review --offset ${offset + limit} --limit ${limit} --status ${status}`,
        );
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });

  // ── pkb promote — write approved candidate into generated-patterns ──
  pkb
    .command("promote <candidateId>")
    .description(
      "Promote an approved candidate into data/problem-kb/generated-patterns.json",
    )
    .option("--pattern-id <id>", "Override the generated pattern id", undefined)
    .option("--pattern-name <name>", "Override the generated pattern name", undefined)
    .option("--severity <sev>", "Severity: low | medium | high", "medium")
    .option(
      "--generated-path <path>",
      "Path to generated-patterns.json",
      "./data/problem-kb/generated-patterns.json",
    )
    .option("--db <path>", "SQLite database path")
    .action(async (candidateId: string, opts: Record<string, string>) => {
      try {
        const { MiningStore, promoteCandidate } = await import("@cesium-nexus/mining");
        const Database = (await import("better-sqlite3")).default;
        const db = new Database(resolveDbPath(opts.db));
        const store = new MiningStore(db);

        const candidate = store.getCandidate(candidateId);
        if (!candidate) {
          console.error(`Error: candidate "${candidateId}" not found`);
          process.exitCode = 1;
          return;
        }
        if (candidate.status !== "approved") {
          console.error(
            `Error: candidate "${candidateId}" has status "${candidate.status}"; only "approved" candidates can be promoted. ` +
              `Run 'cesium pkb approve ${candidateId}' first.`,
          );
          process.exitCode = 1;
          return;
        }
        if (candidate.failedDraft) {
          console.error(
            `Error: candidate "${candidateId}" had a failed LLM draft — cannot promote.`,
          );
          process.exitCode = 1;
          return;
        }

        const canonical = store.getCanonical(candidate.canonicalId);
        if (!canonical) {
          console.error(`Error: canonical "${candidate.canonicalId}" not found`);
          process.exitCode = 1;
          return;
        }

        const entry = await promoteCandidate(
          {
            candidate,
            canonical,
            patternId: opts.patternId,
            patternName: opts.patternName,
            severity: (opts.severity as "low" | "medium" | "high") || "medium",
          },
          path.resolve(opts.generatedPath || "./data/problem-kb/generated-patterns.json"),
        );

        // Mark canonical as accepted on first promote
        if (canonical.status !== "accepted") {
          store.setCanonicalStatus(canonical.id, "accepted");
        }

        console.log(`Promoted "${candidateId}" → pattern "${entry.id}"`);
        console.log(`  file: ${opts.generatedPath}`);
        console.log(`  name: ${entry.name}`);
        console.log(`  category: ${entry.category} / severity: ${entry.severity}`);
        console.log(`  aliases: ${entry.aliases.join(", ")}`);
        console.log(
          `\nNext: run 'cesium pkb diff' to inspect, then manually merge into problem-patterns.json.`,
        );
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });

  // ── pkb approve / reject — status transitions ───────────────────
  pkb
    .command("approve <candidateId>")
    .description("Mark a pending candidate as approved (does not write to generated-patterns)")
    .option("--db <path>", "SQLite database path")
    .action(async (candidateId: string, opts: Record<string, string>) => {
      await transitionStatus(candidateId, "approved", opts);
    });

  pkb
    .command("reject <candidateId>")
    .description("Mark a candidate as rejected")
    .option("--db <path>", "SQLite database path")
    .action(async (candidateId: string, opts: Record<string, string>) => {
      await transitionStatus(candidateId, "rejected", opts);
    });

  async function transitionStatus(
    candidateId: string,
    to: "approved" | "rejected",
    opts: Record<string, string>,
  ): Promise<void> {
    try {
      const { MiningStore } = await import("@cesium-nexus/mining");
      const Database = (await import("better-sqlite3")).default;
      const db = new Database(resolveDbPath(opts.db));
      const store = new MiningStore(db);

      const candidate = store.getCandidate(candidateId);
      if (!candidate) {
        console.error(`Error: candidate "${candidateId}" not found`);
        process.exitCode = 1;
        return;
      }
      if (candidate.status === to) {
        console.log(`Candidate "${candidateId}" already "${to}".`);
        return;
      }

      store.setStatus(candidateId, to);
      console.log(`Candidate "${candidateId}" marked as ${to}.`);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }

  // ── pkb diff — compare generated-patterns vs current problem-patterns ──
  pkb
    .command("diff")
    .description("Show generated patterns vs current problem-patterns.json")
    .option(
      "--generated-path <path>",
      "Path to generated-patterns.json",
      "./data/problem-kb/generated-patterns.json",
    )
    .action(async (opts: Record<string, string>) => {
      try {
        const { diffGenerated } = await import("@cesium-nexus/mining");
        const genPath = path.resolve(
          opts.generatedPath || "./data/problem-kb/generated-patterns.json",
        );

        let current;
        try {
          current = await loadProblemPatterns();
        } catch (err) {
          console.error(
            `Error loading problem-patterns.json: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exitCode = 1;
          return;
        }

        const diff = await diffGenerated(genPath, current);

        console.log(`Generated patterns diff (${genPath})\n`);
        console.log(`  added    : ${diff.added.length}`);
        console.log(`  updated  : ${diff.updated.length}`);
        console.log(`  unchanged: ${diff.unchanged.length}`);
        console.log();

        if (diff.added.length > 0) {
          console.log("=== ADDED (not yet in problem-patterns.json) ===");
          for (const g of diff.added) {
            console.log(`  + ${g.id}  (${g.category}/${g.severity})`);
            console.log(`      name      : ${g.name}`);
            console.log(`      candidate : ${g.candidateId}  promoted ${g.promotedAt}`);
            console.log(`      aliases   : ${g.aliases.slice(0, 5).join(", ")}`);
            console.log(`      symptoms  : ${g.symptoms.length}  symbols: ${g.relatedSymbols.length}`);
          }
          console.log();
        }

        if (diff.updated.length > 0) {
          console.log("=== UPDATED (id matches but content differs) ===");
          for (const { generated, current: c } of diff.updated) {
            console.log(`  ~ ${generated.id}`);
            if (generated.name !== c.name) {
              console.log(`      name    : "${c.name}" → "${generated.name}"`);
            }
            if (generated.category !== c.category) {
              console.log(`      category: "${c.category}" → "${generated.category}"`);
            }
            if (generated.severity !== c.severity) {
              console.log(`      severity: "${c.severity}" → "${generated.severity}"`);
            }
          }
          console.log();
        }

        if (diff.added.length === 0 && diff.updated.length === 0) {
          console.log("No differences. Manual merge is up to date.");
        } else {
          console.log(
            "Merge manually into data/problem-kb/problem-patterns.json, then run `cesium pkb embed`.",
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          console.log("No generated-patterns.json yet. Run `cesium pkb promote <id>` first.");
        } else {
          console.error(`Error: ${msg}`);
          process.exitCode = 1;
        }
      }
    });

  // ── pkb mining-stats — counts across canonical + candidate tables ─
  pkb
    .command("mining-stats")
    .description("Show counts for canonical problems and candidates by status")
    .option("--db <path>", "SQLite database path")
    .action(async (opts: Record<string, string>) => {
      try {
        const { MiningStore } = await import("@cesium-nexus/mining");
        const Database = (await import("better-sqlite3")).default;
        const db = new Database(resolveDbPath(opts.db));
        const store = new MiningStore(db);

        const s = store.stats();
        console.log("Canonical problems:");
        console.log(`  candidate : ${s.canonical.candidate}`);
        console.log(`  reviewed  : ${s.canonical.reviewed}`);
        console.log(`  accepted  : ${s.canonical.accepted}`);
        console.log();
        console.log("Problem candidates:");
        console.log(`  pending   : ${s.candidates.pending}`);
        console.log(`  approved  : ${s.candidates.approved}`);
        console.log(`  rejected  : ${s.candidates.rejected}`);
        const total = s.candidates.pending + s.candidates.approved + s.candidates.rejected;
        const approvedRate = total > 0 ? s.candidates.approved / total : 0;
        console.log();
        console.log(`Approved rate : ${approvedRate.toFixed(2)} (${s.candidates.approved}/${total})`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
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

/**
 * Render a full detail view of a ProblemCandidate + its CanonicalProblem.
 *
 * Uses structural typing rather than importing from @cesium-nexus/mining at
 * module scope, since that package is dynamically imported on-demand.
 */
function printCandidateDetail(
  c: {
    id: string;
    canonicalId: string;
    clusterId: string;
    draftAlias: string[];
    draftSymptoms: string[];
    draftSymbols: string[];
    draftCategory: string | null;
    llmRaw: string | null;
    qualityScore: number | null;
    dupOf: string | null;
    failedDraft: boolean;
    status: string;
    reviewedAt: number | null;
    createdAt: number;
    sourceCount: number;
    issueCount: number;
    forumCount: number;
    experienceCount: number;
  },
  canonical: {
    id: string;
    title: string;
    aliases: string[];
    representativeIssueId: number | null;
    confidence: number;
    status: string;
  } | null,
): void {
  console.log(`=== Candidate ${c.id} ===\n`);
  console.log(`status      : ${c.status}${c.failedDraft ? " [DRAFT FAILED]" : ""}`);
  console.log(`canonical   : ${canonical?.title || "(untitled)"}  [${c.canonicalId}]`);
  if (canonical) {
    console.log(`  aliases   : ${canonical.aliases.join(", ") || "(none)"}`);
    console.log(
      `  rep issue : ${canonical.representativeIssueId != null ? `#${canonical.representativeIssueId}` : "(none)"}`,
    );
    console.log(`  confidence: ${canonical.confidence.toFixed(2)}  status: ${canonical.status}`);
  }
  console.log(`cluster     : ${c.clusterId}`);
  console.log(`category    : ${c.draftCategory || "N/A"}`);
  console.log(`dup_of      : ${c.dupOf || "(none)"}`);
  console.log(`quality     : ${c.qualityScore?.toFixed(3) ?? "N/A"}`);
  console.log(`created     : ${new Date(c.createdAt).toISOString()}`);
  console.log(
    `sources     : total=${c.sourceCount}  issue=${c.issueCount}  forum=${c.forumCount}  experience=${c.experienceCount}`,
  );
  console.log();
  console.log(`aliases (${c.draftAlias.length}):`);
  for (const a of c.draftAlias) console.log(`  - ${a}`);
  console.log(`\nsymptoms (${c.draftSymptoms.length}):`);
  for (const s of c.draftSymptoms) console.log(`  - ${s}`);
  console.log(`\nsymbols (${c.draftSymbols.length}):`);
  for (const s of c.draftSymbols) console.log(`  - ${s}`);
  if (c.llmRaw) {
    console.log(`\n--- LLM raw response ---\n${c.llmRaw}\n--- end ---`);
  }
}
