import type { Command } from "commander";
import * as path from "node:path";

export function registerMcpCommand(program: Command): void {
  program
    .command("mcp")
    .description("Start MCP server (stdio transport)")
    .option("--db <path>", "SQLite database path", "./database/cesium.db")
    .action(async (opts: { db: string }) => {
      const { startServer } = await import("@cesium-nexus/mcp");
      await startServer(path.resolve(opts.db));
    });
}
