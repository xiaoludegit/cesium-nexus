import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  openDatabase,
  initSchema,
  SymbolRepo,
  IssueRepo,
  CallGraphRepo,
  PullRequestRepo,
  ForumRepo,
  ExperienceRepo,
  ExperienceEdgeRepo,
} from "@cesium-nexus/storage";
import {
  handleSearchSymbol,
  handleGetSource,
  handleSearchIssue,
  handleTraceCallgraph,
  handleBuildContextPack,
  handleDiagnoseProblem,
  handleQueryRenderStage,
  handleSearchForum,
  handleSearchExperience,
  handleDispatchSkill,
  handleBuildSkillPack,
  handleGetExperienceChain,
  handleSemanticSearchExperience,
} from "./handlers.js";
import {
  handleSearchMigration,
  handleSearchShader,
  handleCompareVersion,
  handleDiagnoseRootCause,
} from "./intelligence-handlers.js";
import type { Database } from "@cesium-nexus/storage";

/**
 * Register the 13 Cesium knowledge-base tools on an existing McpServer.
 * Exported for testing with :memory: databases.
 */
export function registerTools(
  server: McpServer,
  repos: {
    symbolRepo: SymbolRepo;
    issueRepo: IssueRepo;
    callGraphRepo: CallGraphRepo;
    prRepo: PullRequestRepo;
    forumRepo: ForumRepo;
    experienceRepo: ExperienceRepo;
    experienceEdgeRepo: ExperienceEdgeRepo;
  },
): void {
  const {
    symbolRepo,
    issueRepo,
    callGraphRepo,
    prRepo,
    forumRepo,
    experienceRepo,
    experienceEdgeRepo,
  } = repos;

  // ── search_symbol ──────────────────────────────────────────
  server.tool(
    "search_symbol",
    "Search Cesium symbols (classes, functions, methods, enums) by name or doc comment",
    {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(100).default(10),
    },
    async (input) => {
      const result = await handleSearchSymbol(symbolRepo, input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.success,
      };
    },
  );

  // ── get_source ─────────────────────────────────────────────
  server.tool(
    "get_source",
    "Get source code for a Cesium symbol by its ID",
    {
      symbol_id: z.string().min(1),
    },
    async (input) => {
      const result = await handleGetSource(symbolRepo, input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.success,
      };
    },
  );

  // ── search_issue ───────────────────────────────────────────
  server.tool(
    "search_issue",
    "Search Cesium GitHub issues via full-text search on title and body",
    {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(100).default(10),
      state: z.enum(["open", "closed"]).optional(),
    },
    async (input) => {
      const result = await handleSearchIssue(issueRepo, input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.success,
      };
    },
  );

  // ── trace_callgraph ────────────────────────────────────────
  server.tool(
    "trace_callgraph",
    "Trace upstream/downstream call graph for a Cesium symbol",
    {
      symbol: z.string().min(1),
      direction: z.enum(["down", "up"]).default("down"),
      depth: z.number().int().min(1).max(10).default(2),
    },
    async (input) => {
      const result = await handleTraceCallgraph(
        symbolRepo,
        callGraphRepo,
        input,
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.success,
      };
    },
  );

  // ── build_context_pack ─────────────────────────────────────
  server.tool(
    "build_context_pack",
    "Build a structured Context Pack for a Cesium symbol (symbol + source + callgraph + issues). Accepts an optional token budget to control output size.",
    {
      symbol: z.string().min(1),
      depth: z.number().int().min(1).max(5).default(2),
      budget: z.number().int().min(100).default(5000),
    },
    async (input) => {
      const result = await handleBuildContextPack(
        symbolRepo,
        callGraphRepo,
        issueRepo,
        input,
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.success,
      };
    },
  );

  // ── diagnose_problem ────────────────────────────────────────
  server.tool(
    "diagnose_problem",
    "Diagnose a Cesium problem by matching symptoms to known patterns and assembling a diagnostic context pack with causes, related source, issues, and fix suggestions. Set hybrid=true to enhance with vector semantic search and experience recall.",
    {
      problem: z.string().min(1),
      limit: z.number().int().min(1).max(20).default(5),
      budget: z.number().int().min(1000).default(6000),
      hybrid: z.boolean().default(false),
    },
    async (input) => {
      const result = await handleDiagnoseProblem(
        symbolRepo,
        callGraphRepo,
        issueRepo,
        input,
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.success,
      };
    },
  );

  // ── query_render_stage ──────────────────────────────────────
  server.tool(
    "query_render_stage",
    "Query Cesium render stages by stage ID or problem pattern ID for diagnostic context",
    {
      stageId: z.string().optional(),
      problemId: z.string().optional(),
    },
    async (input) => {
      const result = await handleQueryRenderStage(input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.success,
      };
    },
  );

  // ── search_forum ──────────────────────────────────────────
  server.tool(
    "search_forum",
    "Search Cesium community forum posts via full-text search with quality filtering",
    {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(100).default(10),
      minQuality: z.number().min(0).max(1).optional(),
    },
    async (input) => {
      const result = await handleSearchForum(forumRepo, input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.success,
      };
    },
  );

  // ── search_experience ─────────────────────────────────────
  server.tool(
    "search_experience",
    "Search unified experience index (issues, PR reviews, forum posts) with type and symbol filtering",
    {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(100).default(10),
      type: z.enum(["issue", "pr_review", "forum"]).optional(),
      symbol: z.string().optional(),
      minQuality: z.number().min(0).max(1).optional(),
    },
    async (input) => {
      const result = await handleSearchExperience(experienceRepo, input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.success,
      };
    },
  );

  // ── dispatch_skill ────────────────────────────────────────
  server.tool(
    "dispatch_skill",
    "Dispatch a user query to the most appropriate skill (api, debug, performance, shader, general) based on keyword and entity analysis",
    {
      query: z.string().min(1),
    },
    async (input) => {
      const result = await handleDispatchSkill(symbolRepo, input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.success,
      };
    },
  );

  // ── build_skill_pack ──────────────────────────────────────
  server.tool(
    "build_skill_pack",
    "Build a skill-aware Context Pack v2 that assembles diagnosis, render stages, source, issues, forum posts, and experience data tailored to the dispatched skill",
    {
      query: z.string().min(1),
      budget: z.number().int().min(1000).default(6000),
    },
    async (input) => {
      const result = await handleBuildSkillPack(
        symbolRepo,
        callGraphRepo,
        issueRepo,
        prRepo,
        forumRepo,
        experienceRepo,
        input,
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.success,
      };
    },
  );

  // ── get_experience_chain ────────────────────────────────────
  server.tool(
    "get_experience_chain",
    "Traverse the experience graph from a given node, returning connected nodes and edges (fix chains linking PRs to issues)",
    {
      nodeId: z.string().min(1),
      maxDepth: z.number().int().min(1).max(10).default(3),
    },
    async (input) => {
      const result = await handleGetExperienceChain(
        experienceRepo,
        experienceEdgeRepo,
        input,
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.success,
      };
    },
  );

  // ── semantic_search_experience ─────────────────────────────
  server.tool(
    "semantic_search_experience",
    "Semantic search over experience nodes using vector similarity (Qdrant). Returns nodes ranked by cosine similarity to the query.",
    {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(50).default(10),
      minScore: z.number().min(0).max(1).optional(),
      type: z.enum(["issue", "pr_review", "forum"]).optional(),
    },
    async (input) => {
      const result = await handleSemanticSearchExperience(input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.success,
      };
    },
  );

  // ─── search_migration ──────────────────────────────────────
  server.tool(
    "search_migration",
    "Search for breaking changes between Cesium versions",
    {
      from_version: z.string().min(1),
      to_version: z.string().min(1),
      symbol: z.string().optional(),
    },
    async (input) => {
      const db = symbolRepo.constructor.prototype.constructor.name === 'SymbolRepo'
        ? (symbolRepo as any).db
        : undefined;
      if (!db) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "Database not available" }) }],
          isError: true,
        };
      }
      const result = await handleSearchMigration(db, input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.success,
      };
    },
  );

  // ─── search_shader ─────────────────────────────────────────
  server.tool(
    "search_shader",
    "Search shader symbols and diagnose shader issues",
    {
      query: z.string().min(1),
      type: z.enum(["uniform", "varying", "function", "struct", "define", "const"]).optional(),
      related_js_symbol: z.string().optional(),
      render_stage: z.string().optional(),
      file: z.string().optional(),
    },
    async (input) => {
      const db = (symbolRepo as any).db;
      if (!db) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "Database not available" }) }],
          isError: true,
        };
      }
      const result = await handleSearchShader(db, input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.success,
      };
    },
  );

  // ─── compare_version ───────────────────────────────────────
  server.tool(
    "compare_version",
    "Compare symbols between two Cesium versions",
    {
      from_version: z.string().min(1),
      to_version: z.string().min(1),
      symbol: z.string().optional(),
      breaking_only: z.boolean().default(false),
    },
    async (input) => {
      const db = (symbolRepo as any).db;
      if (!db) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "Database not available" }) }],
          isError: true,
        };
      }
      const result = await handleCompareVersion(db, input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.success,
      };
    },
  );

  // ─── diagnose_root_cause ───────────────────────────────────
  server.tool(
    "diagnose_root_cause",
    "Diagnose root cause of a Cesium issue using Evidence Fusion Engine",
    {
      query: z.string().min(1),
      verbose: z.boolean().default(false),
      min_confidence: z.number().min(0).max(1).default(0.3),
    },
    async (input) => {
      const db = (symbolRepo as any).db;
      if (!db) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "Database not available" }) }],
          isError: true,
        };
      }
      const result = await handleDiagnoseRootCause(db, input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.success,
      };
    },
  );
}

/**
 * Create an MCP server with Cesium knowledge-base tools.
 *
 * No console.log during server lifetime — stdout is the JSON-RPC channel.
 */
export function createServer(dbPath: string): McpServer {
  const db = openDatabase(dbPath);
  initSchema(db);

  const server = new McpServer({
    name: "cesium-nexus",
    version: "0.1.0",
  });

  registerTools(server, {
    symbolRepo: new SymbolRepo(db),
    issueRepo: new IssueRepo(db),
    callGraphRepo: new CallGraphRepo(db),
    prRepo: new PullRequestRepo(db),
    forumRepo: new ForumRepo(db),
    experienceRepo: new ExperienceRepo(db),
    experienceEdgeRepo: new ExperienceEdgeRepo(db),
  });

  return server;
}

/**
 * Start the MCP server on stdio transport.
 * Must NOT use console.log — stdout is the JSON-RPC channel.
 */
export async function startServer(dbPath: string): Promise<void> {
  const server = createServer(dbPath);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
