import type { Command } from "commander";
import { resolveDbPath } from "../config.js";

export function registerMcpCommand(program: Command): void {
  program
    .command("mcp")
    .description("Start MCP server (stdio transport)")
    .option("--db <path>", "SQLite database path")
    .action(async (opts: { db: string }) => {
      const { startServer } = await import("@cesium-nexus/mcp");
      await startServer(resolveDbPath(opts.db));
    });
}
