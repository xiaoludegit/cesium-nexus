import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * MCP Server End-to-End test via real stdio transport.
 *
 * Spawns the actual MCP server process and communicates via JSON-RPC
 * over stdin/stdout using newline-delimited JSON (the MCP SDK format).
 * Uses a temporary empty SQLite database so NO Cesium index data is required.
 *
 * These tests ALWAYS run (no conditional skip).
 */

const CLI_PATH = resolve(import.meta.dirname, "../../cli/dist/index.js");

let server: ChildProcess;
let tempDir: string;
let msgId = 0;
let stdoutBuf = "";
const pendingResponses = new Map<
  number,
  { resolve: (data: unknown) => void; reject: (err: Error) => void }
>();

/**
 * Build a newline-delimited JSON message (MCP stdio format).
 */
function buildFrame(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

/**
 * Send a JSON-RPC request and wait for the response.
 */
function sendRequest(method: string, params?: unknown): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const id = ++msgId;
    pendingResponses.set(id, { resolve: resolvePromise, reject });
    const msg = { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
    server.stdin!.write(buildFrame(msg));
  });
}

/**
 * Parse newline-delimited JSON messages from stdout buffer.
 */
function parseLines(buf: string): { parsed: unknown[]; remaining: string } {
  const parsed: unknown[] = [];
  const lines = buf.split("\n");
  // The last element is either empty (trailing \n) or an incomplete line
  const remaining = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.replace(/\r$/, "").trim();
    if (!trimmed) continue;
    try {
      parsed.push(JSON.parse(trimmed));
    } catch {
      // skip non-JSON lines (e.g. debug output)
    }
  }

  return { parsed, remaining };
}

describe("MCP Server E2E (stdio)", () => {
  beforeAll(async () => {
    // Create temp dir — better-sqlite3 will auto-create the database file on open
    tempDir = mkdtempSync(join(tmpdir(), "cesium-mcp-e2e-"));
    const dbPath = join(tempDir, "test.db");

    // Spawn the MCP server
    server = spawn("node", [CLI_PATH, "mcp", "--db", dbPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Parse stdout messages and resolve pending promises
    server.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf-8");
      const { parsed, remaining } = parseLines(stdoutBuf);
      stdoutBuf = remaining;

      for (const msg of parsed) {
        const m = msg as { id?: number; result?: unknown; error?: unknown };
        if (m.id != null && pendingResponses.has(m.id)) {
          const handler = pendingResponses.get(m.id)!;
          pendingResponses.delete(m.id);
          if (m.error) {
            handler.reject(new Error(JSON.stringify(m.error)));
          } else {
            handler.resolve(m.result);
          }
        }
      }
    });

    // Capture stderr for diagnostics on failure
    let stderrOutput = "";
    server.stderr?.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    // If the server exits unexpectedly, reject all pending requests
    server.on("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        const err = new Error(
          `MCP server exited with code ${code} (signal=${signal}). stderr: ${stderrOutput}`,
        );
        for (const [, handler] of pendingResponses) {
          handler.reject(err);
        }
        pendingResponses.clear();
      }
    });

    // Wait for server to be ready
    await new Promise((r) => setTimeout(r, 500));
  }, 15_000);

  afterAll(() => {
    if (server && !server.killed) {
      server.kill("SIGTERM");
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  });

  it(
    "initialize returns server info",
    async () => {
      const result = await sendRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "e2e-test", version: "0.1.0" },
      });

      expect(result).toBeDefined();
      const r = result as { serverInfo?: { name: string } };
      expect(r.serverInfo?.name).toBe("cesium-nexus");
    },
    15_000,
  );

  it(
    "tools/list returns 5 tools",
    async () => {
      // Send initialized notification first (required by MCP protocol)
      server.stdin!.write(
        buildFrame({ jsonrpc: "2.0", method: "notifications/initialized" }),
      );

      const result = await sendRequest("tools/list", {});

      expect(result).toBeDefined();
      const r = result as { tools?: { name: string }[] };
      expect(r.tools).toBeDefined();
      expect(r.tools!.length).toBe(5);

      const names = r.tools!.map((t) => t.name).sort();
      expect(names).toEqual([
        "build_context_pack",
        "get_source",
        "search_issue",
        "search_symbol",
        "trace_callgraph",
      ]);
    },
    15_000,
  );

  it(
    "build_context_pack returns error for unknown symbol",
    async () => {
      const result = await sendRequest("tools/call", {
        name: "build_context_pack",
        arguments: { symbol: "NonExistentXYZ123", depth: 1 },
      });

      expect(result).toBeDefined();
      const r = result as { content?: { text: string }[] };
      expect(r.content).toBeDefined();
      const parsed = JSON.parse(r.content![0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("Symbol not found");
    },
    15_000,
  );

  it("stdout has no debug pollution (no [DEBUG] output)", () => {
    // After all the messages above, verify no debug strings leaked
    expect(stdoutBuf).not.toContain("[DEBUG]");
  });
});
