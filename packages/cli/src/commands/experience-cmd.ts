import type { Command } from "commander";
import {
  openDatabase,
  initSchema,
  IssueRepo,
  PullRequestRepo,
  ForumRepo,
  ExperienceRepo,
  ExperienceEdgeRepo,
} from "@cesium-nexus/storage";
import {
  rebuildExperienceGraph,
  getExperienceChain,
} from "@cesium-nexus/indexer";
import * as path from "node:path";

export function registerExperienceCommands(program: Command): void {
  const experience = program
    .command("experience")
    .description("Experience graph commands");

  experience
    .command("search <keywords>")
    .description("Search experience nodes via full-text search")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .option("--limit <n>", "Max results", "10")
    .option(
      "--type <type>",
      "Filter by node type (issue, pr_review, forum)",
    )
    .option("--symbol <symbol>", "Filter by related symbol")
    .action(
      async (
        keywords: string,
        opts: { db: string; limit: string; type?: string; symbol?: string },
      ) => {
        const db = openDatabase(path.resolve(opts.db));
        initSchema(db);
        const experienceRepo = new ExperienceRepo(db);

        const results = experienceRepo.searchFts(keywords, {
          limit: parseInt(opts.limit, 10),
          type: opts.type as "issue" | "pr_review" | "forum" | undefined,
          symbol: opts.symbol,
        });

        db.close();

        if (results.length === 0) {
          console.log(`No experience nodes found for "${keywords}".`);
          return;
        }

        console.log(`Found ${results.length} result(s) for "${keywords}":\n`);
        for (const r of results) {
          console.log(`  [${r.node.type}] ${r.node.title}`);
          console.log(
            `    quality: ${r.node.qualityScore.toFixed(2)}  symbols: ${r.node.relatedSymbols.join(", ") || "none"}`,
          );
          console.log(`    ${r.node.url}`);
        }
      },
    );

  experience
    .command("rebuild")
    .description("Rebuild experience nodes and edges from indexed data")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .action(async (opts: { db: string }) => {
      const db = openDatabase(path.resolve(opts.db));
      initSchema(db);
      const issueRepo = new IssueRepo(db);
      const prRepo = new PullRequestRepo(db);
      const forumRepo = new ForumRepo(db);
      const experienceRepo = new ExperienceRepo(db);
      const edgeRepo = new ExperienceEdgeRepo(db);

      const result = rebuildExperienceGraph(
        issueRepo,
        prRepo,
        forumRepo,
        experienceRepo,
        edgeRepo,
      );

      db.close();

      console.log(
        `Rebuilt experience graph: Nodes: ${result.nodes}, Edges: ${result.edges}`,
      );
    });

  experience
    .command("chain <node_id>")
    .description("Show the experience chain (connected nodes and edges) for a node")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .option("--depth <n>", "Max traversal depth", "3")
    .action(
      async (nodeId: string, opts: { db: string; depth: string }) => {
        const db = openDatabase(path.resolve(opts.db));
        initSchema(db);
        const experienceRepo = new ExperienceRepo(db);
        const edgeRepo = new ExperienceEdgeRepo(db);

        const chain = getExperienceChain(
          nodeId,
          experienceRepo,
          edgeRepo,
          parseInt(opts.depth, 10),
        );

        db.close();

        console.log(`Chain for ${chain.rootId}:`);
        console.log(`  Nodes: ${chain.nodes.length}, Edges: ${chain.edges.length}`);

        if (chain.edges.length === 0) {
          console.log("  (no connected edges — orphan node)");
          return;
        }

        console.log("\n  Edges:");
        for (const e of chain.edges) {
          console.log(`    ${e.sourceNodeId} --[${e.edgeType}]--> ${e.targetNodeId}`);
        }

        console.log("\n  Nodes:");
        for (const n of chain.nodes) {
          console.log(`    [${n.type}] ${n.id}: ${n.title}`);
        }
      },
    );

  experience
    .command("stats")
    .description("Show experience graph statistics")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .action(async (opts: { db: string }) => {
      const db = openDatabase(path.resolve(opts.db));
      initSchema(db);
      const experienceRepo = new ExperienceRepo(db);
      const edgeRepo = new ExperienceEdgeRepo(db);

      const totalNodes = experienceRepo.totalCount();
      const stats = edgeRepo.getStats(totalNodes);

      db.close();

      console.log("Experience Graph Statistics:");
      console.log(`  Total nodes: ${stats.totalNodes}`);
      console.log(`  Total edges: ${stats.totalEdges}`);
      console.log(`  Connected nodes: ${stats.connectedNodes}`);
      console.log(`  Orphan nodes: ${stats.orphanNodes}`);
      console.log("  Edges by type:");
      for (const [type, count] of Object.entries(stats.byType)) {
        console.log(`    ${type}: ${count}`);
      }
    });

  experience
    .command("embed")
    .description("Embed all experience nodes to Qdrant for semantic search")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .option("--qdrant-url <url>", "Qdrant server URL", "http://localhost:6333")
    .action(async (opts: { db: string; qdrantUrl: string }) => {
      const { getQdrantClient, embedAllExperienceNodes } = await import(
        "@cesium-nexus/vector"
      );
      const db = openDatabase(path.resolve(opts.db));
      initSchema(db);
      const experienceRepo = new ExperienceRepo(db);
      const client = getQdrantClient(opts.qdrantUrl);

      const result = await embedAllExperienceNodes(experienceRepo, client);

      db.close();

      console.log(
        `Embedded ${result.embedded} experience nodes to Qdrant (eng-knowledge). Skipped: ${result.skipped}. Total: ${result.totalNodes}.`,
      );
    });

  experience
    .command("semantic <query>")
    .description("Semantic search over experience nodes using vector similarity")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .option("--qdrant-url <url>", "Qdrant server URL", "http://localhost:6333")
    .option("--limit <n>", "Max results", "10")
    .option("--min-score <score>", "Minimum similarity score", "0.5")
    .option("--type <type>", "Filter by node type (issue, pr_review, forum)")
    .action(
      async (
        query: string,
        opts: {
          db: string;
          qdrantUrl: string;
          limit: string;
          minScore: string;
          type?: string;
        },
      ) => {
        const { getQdrantClient, searchExperienceSemantic } = await import(
          "@cesium-nexus/vector"
        );
        const client = getQdrantClient(opts.qdrantUrl);

        const results = await searchExperienceSemantic(query, client, {
          limit: parseInt(opts.limit, 10),
          minScore: parseFloat(opts.minScore),
          type: opts.type,
        });

        if (results.length === 0) {
          console.log(`No semantic results found for "${query}".`);
          return;
        }

        console.log(
          `Found ${results.length} result(s) (top score: ${results[0]!.score.toFixed(2)}):\n`,
        );
        for (const r of results) {
          console.log(`  [${r.nodeType}] ${r.title}`);
          console.log(`    score: ${r.score.toFixed(4)}  ${r.url}`);
        }
      },
    );

  experience
    .command("references")
    .description("Build 'references' edges based on semantic similarity between experience nodes")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .option("--qdrant-url <url>", "Qdrant server URL", "http://localhost:6333")
    .option("--threshold <score>", "Minimum cosine similarity for a reference edge", "0.85")
    .action(
      async (opts: {
        db: string;
        qdrantUrl: string;
        threshold: string;
      }) => {
        const { getQdrantClient, buildReferencesEdges } = await import(
          "@cesium-nexus/vector"
        );
        const db = openDatabase(path.resolve(opts.db));
        initSchema(db);
        const experienceRepo = new ExperienceRepo(db);
        const edgeRepo = new ExperienceEdgeRepo(db);
        const client = getQdrantClient(opts.qdrantUrl);

        const threshold = parseFloat(opts.threshold);
        const result = await buildReferencesEdges(
          experienceRepo,
          client,
          edgeRepo,
          threshold,
        );

        db.close();

        console.log(
          `Built ${result.totalEdges} references edges (threshold: ${result.threshold}).`,
        );
      },
    );
}
