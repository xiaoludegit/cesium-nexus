import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  openDatabase,
  initSchema,
  SymbolRepo,
  IssueRepo,
  CallGraphRepo,
} from "@cesium-nexus/storage";
import type { Database } from "@cesium-nexus/storage";
import type { SymbolRecord, IssueRecord } from "@cesium-nexus/shared";
import { registerTools } from "./server.js";

describe("MCP Protocol Integration", () => {
  let db: Database;
  let server: McpServer;
  let client: Client;

  function makeSymbol(overrides: Partial<SymbolRecord> = {}): SymbolRecord {
    return {
      id: Math.random().toString(36).slice(2, 14),
      name: "TestSymbol",
      kind: "class",
      filePath: "src/test.js",
      startLine: 1,
      endLine: 10,
      docComment: "A test symbol",
      exports: [],
      imports: [],
      parentClass: undefined,
      ...overrides,
    };
  }

  beforeEach(async () => {
    db = openDatabase(":memory:");
    initSchema(db);

    const symbolRepo = new SymbolRepo(db);
    const issueRepo = new IssueRepo(db);
    const callGraphRepo = new CallGraphRepo(db);

    // Insert test fixtures
    symbolRepo.insertMany([
      makeSymbol({
        id: "viewer-id",
        name: "Viewer",
        kind: "class",
        docComment: "The main 3D viewer widget",
      }),
      makeSymbol({
        id: "camera-id",
        name: "Camera",
        kind: "class",
        docComment: "The camera for the scene",
      }),
    ]);
    symbolRepo.insertSourceFts([
      {
        symbolId: "viewer-id",
        name: "Viewer",
        filePath: "src/Viewer.js",
        startLine: 1,
        endLine: 100,
        code: "function Viewer(container) { this.scene = new Scene(); }",
      },
    ]);

    const issue: IssueRecord = {
      id: 1,
      repo: "CesiumGS/cesium",
      number: 1,
      title: "Viewer rendering bug",
      body: "The viewer does not render correctly on some GPUs",
      state: "open",
      labels: ["bug"],
      assignees: [],
      author: "tester",
      comments: 2,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-05T00:00:00Z",
      closedAt: null,
      htmlUrl: "https://github.com/CesiumGS/cesium/issues/1",
    };
    issueRepo.upsertMany([issue]);

    callGraphRepo.insertEdges([
      {
        sourceId: "viewer-id",
        targetId: "camera-id",
        sourceName: "Viewer",
        targetName: "Camera",
        edgeType: "construct",
        weight: 1,
      },
    ]);

    // Create server and register tools
    server = new McpServer({
      name: "cesium-nexus-test",
      version: "0.1.0",
    });
    registerTools(server, { symbolRepo, issueRepo, callGraphRepo });

    // Create linked transport pair and connect
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({
      name: "test-client",
      version: "1.0.0",
    });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    db.close();
  });

  // ── Tests ─────────────────────────────────────────────────

  it("initialize handshake succeeds", () => {
    // If we got here, beforeEach completed without error —
    // the MCP initialize handshake already succeeded via client.connect()
    expect(client).toBeDefined();
  });

  it("tools/list returns 5 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);
  });

  it("tools/list contains correct tool names", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "build_context_pack",
      "get_source",
      "search_issue",
      "search_symbol",
      "trace_callgraph",
    ]);
  });

  it("tools/call search_symbol returns results", async () => {
    const result = await client.callTool({
      name: "search_symbol",
      arguments: { query: "Viewer", limit: 5 },
    });

    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: string; text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBeGreaterThanOrEqual(1);
  });

  it("tools/call get_source returns source code", async () => {
    const result = await client.callTool({
      name: "get_source",
      arguments: { symbol_id: "viewer-id" },
    });

    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: string; text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed.success).toBe(true);
    expect(parsed.data.code).toContain("Viewer");
  });

  it("tools/call search_issue returns results", async () => {
    const result = await client.callTool({
      name: "search_issue",
      arguments: { query: "rendering", limit: 5 },
    });

    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: string; text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBeGreaterThanOrEqual(1);
  });

  it("tools/call trace_callgraph returns edges", async () => {
    const result = await client.callTool({
      name: "trace_callgraph",
      arguments: { symbol: "Viewer", direction: "down", depth: 2 },
    });

    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: string; text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBeGreaterThanOrEqual(1);
  });

  it("tools/call build_context_pack returns ContextPack", async () => {
    const result = await client.callTool({
      name: "build_context_pack",
      arguments: { symbol: "Viewer", depth: 2 },
    });

    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: string; text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed.success).toBe(true);
    const pack = parsed.data;
    expect(pack.symbol).toBeDefined();
    expect(pack.symbol.name).toBe("Viewer");
    expect(pack.source).toBeDefined();
    expect(pack.callgraph).toBeDefined();
    expect(pack.metadata).toBeDefined();
    expect(pack.metadata.symbolResolved).toBe("Viewer");
  });

  it("tools/call build_context_pack returns error for unknown symbol", async () => {
    const result = await client.callTool({
      name: "build_context_pack",
      arguments: { symbol: "NonExistentXYZ" },
    });

    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: string; text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("Symbol not found");
  });

  it("tools/call with invalid input returns error", async () => {
    const result = await client.callTool({
      name: "search_symbol",
      arguments: { query: "" },
    });

    // Zod validation failure results in isError
    expect(result.isError).toBe(true);
  });
});
