import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  openDatabase,
  initSchema,
  SymbolRepo,
  IssueRepo,
  CallGraphRepo,
} from "@cesium-nexus/storage";
import {
  handleSearchSymbol,
  handleGetSource,
  handleSearchIssue,
  handleTraceCallgraph,
  handleBuildContextPack,
} from "./handlers.js";

/**
 * Register the 5 Cesium knowledge-base tools on an existing McpServer.
 * Exported for testing with :memory: databases.
 */
export function registerTools(
  server: McpServer,
  repos: {
    symbolRepo: SymbolRepo;
    issueRepo: IssueRepo;
    callGraphRepo: CallGraphRepo;
  },
): void {
  const { symbolRepo, issueRepo, callGraphRepo } = repos;

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
}

/**
 * Create an MCP server with 5 Cesium knowledge-base tools.
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
